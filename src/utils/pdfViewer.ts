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
import { mapPdfJsAnnotationData, ParsedEmbeddedAnnotation } from './embeddedAnnotations';

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

async function fetchPdfBytes(documentId: string): Promise<Uint8Array> {
  // The Rust command returns tauri::ipc::Response (raw bytes), which the
  // webview receives as an ArrayBuffer. The number[] branch is a defensive
  // fallback for IPC paths that JSON-serialize (and for tests).
  const raw = await invoke<ArrayBuffer | number[]>('db_get_pdf_bytes', { documentId });
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
export async function loadPdfDocument(documentId: string): Promise<LoadedPdfInfo | null> {
  const cached = pdfDocCache.get(documentId);
  if (cached) {
    cached.lastUsed = Date.now();
    return { doc: cached.doc, numPages: cached.doc.numPages, outline: cached.outline };
  }

  try {
    let uint8: Uint8Array;
    try {
      uint8 = await fetchPdfBytes(documentId);
    } catch {
      // Backend IPC unavailable (tests, browser dev preview) or file rejected.
      return null;
    }

    const loadingTask = pdfjsLib.getDocument(buildPdfJsLoadConfig(uint8));
    const doc = await loadingTask.promise;
    const outline = await extractOutline(doc);

    pdfDocCache.set(documentId, {
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
 * Task 3.6 (FR-9.9): page provider interface for embedded-annotation mapping,
 * kept narrow so the mapper is unit-testable with a fake page in Node while
 * the real pdf.js page satisfies it structurally.
 */
export interface EmbeddedAnnotationPageLike {
  getAnnotations(): Promise<Array<Record<string, unknown>>>;
  /** Media box in PDF space: [minX, minY, maxX, maxY]. */
  view: number[];
  /** The page's own /Rotate value. */
  rotate: number;
}

/** Maps one pdf.js page object's annotations into ParsedEmbeddedAnnotation[]. */
export async function mapPdfPageEmbeddedAnnotations(
  page: EmbeddedAnnotationPageLike,
  pageIndex: number
): Promise<ParsedEmbeddedAnnotation[]> {
  const raw = await page.getAnnotations();
  const view = page.view ?? [0, 0, 0, 0];
  const mediaWidth = Math.max(1, view[2] - view[0]);
  const mediaHeight = Math.max(1, view[3] - view[1]);
  const rotate = page.rotate ?? 0;
  const out: ParsedEmbeddedAnnotation[] = [];
  for (const item of raw) {
    const mapped = mapPdfJsAnnotationData(
      item,
      { mediaWidth, mediaHeight, rotate, mediaX: view[0], mediaY: view[1], pageIndex }
    );
    if (mapped) out.push(mapped);
  }
  return out;
}

/**
 * Embedded (PDF-born) annotations for one page (task 3.6, FR-9.9). Never
 * throws — malformed annotation dictionaries degrade to an empty list.
 */
export async function getPdfPageEmbeddedAnnotations(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number
): Promise<ParsedEmbeddedAnnotation[]> {
  if (pageNumber < 1 || pageNumber > doc.numPages) return [];
  try {
    const page = await doc.getPage(pageNumber);
    return await mapPdfPageEmbeddedAnnotations(page as unknown as EmbeddedAnnotationPageLike, pageNumber - 1);
  } catch {
    return [];
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
  /** Pages already hydrated from the versioned persistent cache. */
  skipPageNumbers?: ReadonlySet<number>;
  /** Publishes one completed page immediately; may await durable storage. */
  onPage?: (page: PageTextContent) => void | Promise<void>;
  /** Reports page-local extraction failures without aborting the document job. */
  onPageError?: (pageNumber: number, error: unknown) => void;
}

export interface ExtractPagesResult {
  pages: PageTextContent[];
  completed: boolean;
  failedPageNumbers: number[];
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
  const failedPageNumbers: number[] = [];
  let processed = options.skipPageNumbers?.size ?? 0;

  for (const pageNumber of order) {
    if (options.skipPageNumbers?.has(pageNumber)) continue;
    if (options.signal?.aborted) {
      return { pages: sortByPage(pages), completed: false, failedPageNumbers };
    }
    let text = '';
    try {
      text = await getPdfPageText(doc, pageNumber);
    } catch (error) {
      failedPageNumbers.push(pageNumber);
      options.onPageError?.(pageNumber, error);
      processed++;
      options.onProgress?.(processed, totalPages);
      if (processed % yieldEvery === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      continue;
    }
    const page = { pageNumber, text };
    pages.push(page);
    await options.onPage?.(page);
    processed++;
    options.onProgress?.(processed, totalPages);
    if (processed % yieldEvery === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return { pages: sortByPage(pages), completed: true, failedPageNumbers };
}

function sortByPage(pages: PageTextContent[]): PageTextContent[] {
  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

interface ActivePageWork {
  renderTask: pdfjsLib.RenderTask | null;
  textLayer: pdfjsLib.TextLayer | null;
  completion: Promise<void>;
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
  }
}

async function cancelAndAwaitCanvasRender(canvas: HTMLCanvasElement): Promise<void> {
  const previous = activeCanvasWork.get(canvas);
  if (!previous) return;
  previous.renderTask?.cancel();
  previous.textLayer?.cancel();
  await previous.completion.catch(() => undefined);
}

export type RenderPageResult =
  | { bitmap: 'rendered'; textLayer: 'rendered' | 'failed' | 'cancelled' | 'not_requested'; dimensions: { width: number; height: number }; errorCategory?: 'text_layer' }
  | { bitmap: 'failed'; textLayer: 'not_started'; dimensions: null; errorCategory: 'bitmap'; message: string }
  | { bitmap: 'cancelled'; textLayer: 'not_started' | 'cancelled'; dimensions: null; errorCategory: 'cancelled' };

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
): Promise<RenderPageResult> {
  const { pdfDoc, pageNumber, canvas, scale, rotation = 0, textLayerContainer } = params;

  if (pageNumber < 1 || pageNumber > pdfDoc.numPages) {
    return { bitmap: 'failed', textLayer: 'not_started', dimensions: null, errorCategory: 'bitmap', message: 'Page is outside the document.' };
  }

  await cancelAndAwaitCanvasRender(canvas);
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
  const work: ActivePageWork = { renderTask: null, textLayer: null, completion };
  activeCanvasWork.set(canvas, work);

  try {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale, rotation });

    const outputScale = Math.min(
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      MAX_OUTPUT_SCALE
    );

    const context = canvas.getContext('2d');
    if (!context) return { bitmap: 'failed', textLayer: 'not_started', dimensions: null, errorCategory: 'bitmap', message: 'Canvas is unavailable.' };

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

    let textLayerStatus: 'rendered' | 'failed' | 'cancelled' | 'not_requested' = 'not_requested';
    if (textLayerContainer) {
      try {
        textLayerContainer.replaceChildren();
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: page.streamTextContent(),
          container: textLayerContainer,
          viewport,
        });
        work.textLayer = textLayer;
        await textLayer.render();
        textLayerStatus = 'rendered';
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        textLayerStatus = name === 'AbortException' || name === 'RenderingCancelledException' ? 'cancelled' : 'failed';
        if (textLayerStatus === 'failed') console.error(`Failed to render text layer for page ${pageNumber}:`, err);
      }
    }

    return {
      bitmap: 'rendered',
      textLayer: textLayerStatus,
      dimensions: { width: viewport.width, height: viewport.height },
      ...(textLayerStatus === 'failed' ? { errorCategory: 'text_layer' as const } : {}),
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'RenderingCancelledException') {
      return { bitmap: 'cancelled', textLayer: 'not_started', dimensions: null, errorCategory: 'cancelled' };
    }
    console.error(`Failed to render page ${pageNumber}:`, err);
    return { bitmap: 'failed', textLayer: 'not_started', dimensions: null, errorCategory: 'bitmap', message: err instanceof Error ? err.message : String(err) };
  } finally {
    resolveCompletion();
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
