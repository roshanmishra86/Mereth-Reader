import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { invoke } from '@tauri-apps/api/core';
import { PageTextContent, OutlineItem } from './pdfUtils';

// Configure worker using legacy worker build for cross-environment compatibility
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).toString();

const pdfDocCache = new Map<string, pdfjsLib.PDFDocumentProxy>();

export interface LoadedPdfInfo {
  doc: pdfjsLib.PDFDocumentProxy;
  numPages: number;
  extractedTexts: PageTextContent[];
  outline: OutlineItem[];
}

/**
 * Loads a PDF document using pdfjs-dist from file path or binary data.
 */
export async function loadPdfDocument(filepath: string): Promise<LoadedPdfInfo | null> {
  if (pdfDocCache.has(filepath)) {
    const doc = pdfDocCache.get(filepath)!;
    const extractedTexts = await extractAllPageTexts(doc);
    const outline = await extractOutline(doc);
    return { doc, numPages: doc.numPages, extractedTexts, outline };
  }

  try {
    let bytesArray: number[] | Uint8Array;
    try {
      bytesArray = await invoke<number[]>('db_get_pdf_bytes', { filepath });
    } catch {
      // Return null for fallback environment where backend IPC is unavailable
      return null;
    }

    const uint8 = new Uint8Array(bytesArray);
    const loadingTask = pdfjsLib.getDocument({
      data: uint8,
    });

    const doc = await loadingTask.promise;
    pdfDocCache.set(filepath, doc);

    const extractedTexts = await extractAllPageTexts(doc);
    const outline = await extractOutline(doc);

    return {
      doc,
      numPages: doc.numPages,
      extractedTexts,
      outline,
    };
  } catch (err) {
    console.error('Failed to load PDF with pdfjs-dist:', err);
    return null;
  }
}

/**
 * Renders a specific page of a PDF document onto an HTML canvas element.
 */
export async function renderPdfPageToCanvas(params: {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  canvas: HTMLCanvasElement;
  scale: number;
  rotation?: number;
}): Promise<{ width: number; height: number } | null> {
  const { pdfDoc, pageNumber, canvas, scale, rotation = 0 } = params;

  if (pageNumber < 1 || pageNumber > pdfDoc.numPages) {
    return null;
  }

  try {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale, rotation });

    const context = canvas.getContext('2d');
    if (!context) return null;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
      canvas: canvas,
    };

    await page.render(renderContext).promise;
    return { width: viewport.width, height: viewport.height };
  } catch (err) {
    console.error(`Failed to render page ${pageNumber}:`, err);
    return null;
  }
}

/**
 * Extracts text content across all pages for full-text search.
 */
async function extractAllPageTexts(doc: pdfjsLib.PDFDocumentProxy): Promise<PageTextContent[]> {
  const result: PageTextContent[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      result.push({ pageNumber: i, text });
    } catch {
      result.push({ pageNumber: i, text: '' });
    }
  }
  return result;
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
