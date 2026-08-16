/**
 * PDF viewer runtime for Mereth Reader.
 *
 * Design contract (C8 correction round):
 * - Render-first: `loadPdfDocument` resolves as soon as the document is
 *   parsed and the outline is read. It never extracts page text up front;
 *   text extraction is a separate, cancellable, prioritized background pass
 *   (`extractPdfPageTexts`) driven by the job framework.
 * - Secure load: every document is opened with `disableScripting: true` and
 *   `isEvalSupported: false` (R0.7 / FR-8.8), with locally served cMaps and
 *   standard font data so CJK and non-embedded fonts render offline.
 * - Binary IPC: bytes arrive as an ArrayBuffer via `tauri::ipc::Response`,
 *   not as a JSON array of numbers.
 * - HiDPI: canvases render at `devicePixelRatio` (capped) and are CSS-sized
 *   back down, so pages stay sharp at 100%–200% Windows display scaling.
 * - Single zoom model: the pdf.js viewport scale is the only zoom. No CSS
 *   transform scaling anywhere in the page path.
 *
 * Local-first, strict TypeScript (no `any`).
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { invoke } from '@tauri-apps/api/core';
import { PageTextContent, OutlineItem, PDFTextItem } from './pdfUtils';
import { prioritizePageWindow } from './jobQueue';

// Configure worker using legacy worker build for cross-environment compatibility
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).toString();

/** Rendered bitmap density cap; 2 covers 200% Windows scaling. */
const MAX_OUTPUT_SCALE = 2;
/** Bound the number of parsed documents held in memory at once. */
const MAX_CACHED_DOCUMENTS = 3;

export interface LoadedPdfInfo {
  doc: pdfjsLib.PDFDocumentProxy;
  numPages: number;
  outline: OutlineItem[];
}

export interface PdfPageBaseSize {
  width: number;
  height: number;
}

interface CachedPdfEntry {
  doc: pdfjsLib.PDFDocumentProxy;
  loadingTask: pdfjsLib.PDFDocumentLoadingTask;
  outline: OutlineItem[];
  pageTextCache: Map<number, string>;
  pageItemsCache: Map<number, PDFTextItem[]>;
  pageSizeCache: Map<number, PdfPageBaseSize>;
  lastUsed: number;
}

const pdfDocCache = new Map<string, CachedPdfEntry>();

function evictDocumentCacheIfNeeded(): void {
  if (pdfDocCache.size <= MAX_CACHED_DOCUMENTS) return;
  let oldestKey: string | null = null;
  let oldestUse = Infinity;
  for (const [key, entry] of pdfDocCache) {
    if (entry.lastUsed < oldestUse) {
      oldestUse = entry.lastUsed;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) {
    const entry = pdfDocCache.get(oldestKey);
    pdfDocCache.delete(oldestKey);
    // destroy() lives on the loading task in pdf.js v6; it tears down the
    // worker transport and the document.
    entry?.loadingTask.destroy().catch(() => {});
  }
}

/**
 * Builds the enforced pdf.js load parameters. Kept pure and exported so the
 * security posture (R0.7 / FR-8.8) is unit-testable without a DOM.
 */
export interface PdfJsLoadConfig {
  data: Uint8Array;
  disableScripting: true;
  isEvalSupported: false;
  cMapUrl: string;
  cMapPacked: boolean;
  standardFontDataUrl: string;
}

export function buildPdfJsLoadConfig(
  data: Uint8Array,
  assetBaseUrl: string = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
): PdfJsLoadConfig {
  const base = assetBaseUrl.endsWith('/') ? assetBaseUrl : `${assetBaseUrl}/`;
  return {
    data,
    disableScripting: true,
    isEvalSupported: false,
    cMapUrl: `${base}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
  };
}

async function fetchPdfBytes(filepath: string): Promise<Uint8Array> {
  // The Rust command returns tauri::ipc::Response (raw bytes), which the
  // webview receives as an ArrayBuffer. The number[] branch is a defensive
  // fallback for IPC paths that JSON-serialize (and for tests).
  const raw = await invoke<ArrayBuffer | number[]>('db_get_pdf_bytes', { filepath });
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return new Uint8Array(raw as number[]);
}

/**
 * Loads and parses a PDF document. Resolves as soon as the document is ready
 * to render its first page — page text extraction is deliberately NOT part of
 * this path (see extractPdfPageTexts).
 */
export async function loadPdfDocument(filepath: string): Promise<LoadedPdfInfo | null> {
  const cached = pdfDocCache.get(filepath);
  if (cached) {
    cached.lastUsed = Date.now();
    return { doc: cached.doc, numPages: cached.doc.numPages, outline: cached.outline };
  }

  try {
    let uint8: Uint8Array;
    try {
      uint8 = await fetchPdfBytes(filepath);
    } catch {
      // Backend IPC unavailable (tests, browser dev preview) or file rejected.
      return null;
    }

    const loadingTask = pdfjsLib.getDocument(buildPdfJsLoadConfig(uint8));
    const doc = await loadingTask.promise;
    const outline = await extractOutline(doc);

    pdfDocCache.set(filepath, {
      doc,
      loadingTask,
      outline,
      pageTextCache: new Map(),
      pageItemsCache: new Map(),
      pageSizeCache: new Map(),
      lastUsed: Date.now(),
    });
    evictDocumentCacheIfNeeded();

    return { doc, numPages: doc.numPages, outline };
  } catch (err) {
    console.error('Failed to load PDF with pdfjs-dist:', err);
    return null;
  }
}

/** Drops a cached document and its derived caches (e.g. after re-import). */
export function evictPdfDocument(filepath: string): void {
  const entry = pdfDocCache.get(filepath);
  if (entry) {
    pdfDocCache.delete(filepath);
    entry.loadingTask.destroy().catch(() => {});
  }
}

function findCacheEntry(
  doc: pdfjsLib.PDFDocumentProxy
): CachedPdfEntry | undefined {
  for (const entry of pdfDocCache.values()) {
    if (entry.doc === doc) return entry;
  }
  return undefined;
}

/**
 * Natural (unrotated-by-user) page size at scale 1, including the page's own
 * /Rotate. Cached per page; used for fit math and virtualization estimates.
 */
export async function getPdfPageBaseSize(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number
): Promise<PdfPageBaseSize | null> {
  if (pageNumber < 1 || pageNumber > doc.numPages) return null;
  const entry = findCacheEntry(doc);
  const cached = entry?.pageSizeCache.get(pageNumber);
  if (cached) return cached;
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const size = { width: viewport.width, height: viewport.height };
    entry?.pageSizeCache.set(pageNumber, size);
    return size;
  } catch {
    return null;
  }
}

/**
 * Raw text items for a page (cached). Feeds the FR-8.4 copy-confidence
 * analysis so the warning reflects the real page, not placeholder data.
 */
export async function getPdfPageTextItems(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number
): Promise<PDFTextItem[]> {
  if (pageNumber < 1 || pageNumber > doc.numPages) return [];
  const entry = findCacheEntry(doc);
  const cached = entry?.pageItemsCache.get(pageNumber);
  if (cached) return cached;
  try {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items: PDFTextItem[] = [];
    for (const item of textContent.items) {
      // TextContent items are a union of TextItem and TextMarkedContent; only
      // TextItem carries a string. (The TextItem type is not re-exported from
      // the pdfjs-dist package entry, so the guard is structural.)
      if ('str' in item) {
        items.push({
          str: item.str,
          transform: item.transform,
          width: item.width,
          height: item.height,
          dir: item.dir,
          fontName: item.fontName,
        });
      }
    }
    entry?.pageItemsCache.set(pageNumber, items);
    entry?.pageTextCache.set(pageNumber, items.map((it) => it.str).join(' '));
    return items;
  } catch {
    return [];
  }
}

/** Joined text for a single page (cached). */
export async function getPdfPageText(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number
): Promise<string> {
  const entry = findCacheEntry(doc);
  const cached = entry?.pageTextCache.get(pageNumber);
  if (cached !== undefined) return cached;
  const items = await getPdfPageTextItems(doc, pageNumber);
  return items.map((it) => it.str).join(' ');
}

export interface ExtractPagesOptions {
  /** AbortSignal for clean cancellation (job framework cancel path). */
  signal?: AbortSignal;
  /** Called with the count of pages processed so far (throttled by page). */
  onProgress?: (processedPages: number, totalPages: number) => void;
  /** Reading position to prioritize (visible page ± window first). */
  prioritizeFromPage?: number;
  /** Yield to the event loop every N pages so rendering stays responsive. */
  yieldEveryPages?: number;
}

export interface ExtractPagesResult {
  pages: PageTextContent[];
  completed: boolean;
}

/**
 * Cancellable, prioritized full-text extraction for the background job
 * framework (FR-7.6). Pages around the reading position are extracted first;
 * the loop yields regularly so page rendering and scrolling stay responsive.
 * Partial results are returned on cancellation.
 */
export async function extractPdfPageTexts(
  doc: pdfjsLib.PDFDocumentProxy,
  options: ExtractPagesOptions = {}
): Promise<ExtractPagesResult> {
  const totalPages = doc.numPages;
  const order = prioritizePageWindow(totalPages, options.prioritizeFromPage ?? 1, 3);
  const yieldEvery = Math.max(1, options.yieldEveryPages ?? 4);
  const pages: PageTextContent[] = [];
  let processed = 0;

  for (const pageNumber of order) {
    if (options.signal?.aborted) {
      return { pages: sortByPage(pages), completed: false };
    }
    const text = await getPdfPageText(doc, pageNumber);
    pages.push({ pageNumber, text });
    processed++;
    options.onProgress?.(processed, totalPages);
    if (processed % yieldEvery === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return { pages: sortByPage(pages), completed: true };
}

function sortByPage(pages: PageTextContent[]): PageTextContent[] {
  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

interface ActivePageWork {
  renderTask: pdfjsLib.RenderTask | null;
  textLayer: pdfjsLib.TextLayer | null;
}

// pdf.js throws if a canvas is rendered to while a previous render on the
// same canvas is still in flight; track and cancel per-canvas work so zoom /
// page changes never trip "Cannot use same canvas during multiple render()".
const activeCanvasWork = new WeakMap<HTMLCanvasElement, ActivePageWork>();

/** Cancels any in-flight render/text-layer work bound to a canvas. */
export function cancelCanvasRender(canvas: HTMLCanvasElement): void {
  const work = activeCanvasWork.get(canvas);
  if (work) {
    work.renderTask?.cancel();
    work.textLayer?.cancel();
    activeCanvasWork.delete(canvas);
  }
}

export interface RenderPageParams {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  canvas: HTMLCanvasElement;
  /** pdf.js viewport scale — the single source of zoom truth. */
  scale: number;
  /** User rotation applied on top of the page's own /Rotate. */
  rotation?: 0 | 90 | 180 | 270;
  /** When provided, a selectable transparent text layer is rendered into it. */
  textLayerContainer?: HTMLElement;
}

/**
 * Renders a page onto a canvas at the given viewport scale, at device pixel
 * ratio for sharpness, with an optional selectable text layer.
 * Returns the CSS-pixel dimensions of the rendered page.
 */
export async function renderPdfPageToCanvas(
  params: RenderPageParams
): Promise<{ width: number; height: number } | null> {
  const { pdfDoc, pageNumber, canvas, scale, rotation = 0, textLayerContainer } = params;

  if (pageNumber < 1 || pageNumber > pdfDoc.numPages) {
    return null;
  }

  cancelCanvasRender(canvas);
  const work: ActivePageWork = { renderTask: null, textLayer: null };
  activeCanvasWork.set(canvas, work);

  try {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale, rotation });

    const outputScale = Math.min(
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      MAX_OUTPUT_SCALE
    );

    const context = canvas.getContext('2d');
    if (!context) return null;

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const renderTask = page.render({
      canvasContext: context,
      viewport,
      canvas,
      ...(outputScale !== 1
        ? { transform: [outputScale, 0, 0, outputScale, 0, 0] }
        : {}),
    });
    work.renderTask = renderTask;
    await renderTask.promise;

    if (textLayerContainer) {
      textLayerContainer.replaceChildren();
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textLayerContainer,
        viewport,
      });
      work.textLayer = textLayer;
      await textLayer.render();
    }

    return { width: viewport.width, height: viewport.height };
  } catch (err) {
    if (err instanceof Error && err.name === 'RenderingCancelledException') {
      return null;
    }
    console.error(`Failed to render page ${pageNumber}:`, err);
    return null;
  } finally {
    if (activeCanvasWork.get(canvas) === work) {
      activeCanvasWork.delete(canvas);
    }
  }
}

/**
 * Recursively parses PDF outline nodes into OutlineItem structure.
 */
async function extractOutline(doc: pdfjsLib.PDFDocumentProxy): Promise<OutlineItem[]> {
  try {
    const rawOutline = await doc.getOutline();
    if (!rawOutline) return [];
    return parsePdfJsOutlineNodes(rawOutline);
  } catch {
    return [];
  }
}

function parsePdfJsOutlineNodes(nodes: Array<Record<string, unknown>>): OutlineItem[] {
  return nodes.map((node) => {
    const title = typeof node.title === 'string' ? node.title : 'Untitled';
    const dest = typeof node.dest === 'string' ? node.dest : null;
    const rawItems = Array.isArray(node.items) ? (node.items as Array<Record<string, unknown>>) : [];
    const children = parsePdfJsOutlineNodes(rawItems);

    return {
      title,
      dest,
      items: children.length > 0 ? children : undefined,
    };
  });
}
