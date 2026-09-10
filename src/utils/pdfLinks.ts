import type * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export type ResolvedPdfLinkTarget =
  | { kind: 'page'; pageNumber: number }
  | { kind: 'named-action'; action: 'NextPage' | 'PrevPage' | 'FirstPage' | 'LastPage' }
  | { kind: 'web'; url: string }
  | { kind: 'blocked'; reason: string };

export async function resolvePdfDestination(doc: pdfjsLib.PDFDocumentProxy, destination: string | unknown[] | null | undefined): Promise<ResolvedPdfLinkTarget> {
  if (!destination) return { kind: 'blocked', reason: 'Missing destination' };
  const explicit = typeof destination === 'string' ? await doc.getDestination(destination) : destination;
  if (!explicit || !Array.isArray(explicit) || explicit.length === 0) return { kind: 'blocked', reason: 'Unknown destination' };
  const ref = explicit[0];
  if (typeof ref === 'number') return { kind: 'page', pageNumber: ref + 1 };
  if (ref && typeof ref === 'object') {
    try { return { kind: 'page', pageNumber: (await doc.getPageIndex(ref as { num: number; gen: number })) + 1 }; }
    catch { return { kind: 'blocked', reason: 'Unresolvable page reference' }; }
  }
  return { kind: 'blocked', reason: 'Malformed destination' };
}

export function resolvePdfUrl(url: string | null | undefined): ResolvedPdfLinkTarget {
  if (!url) return { kind: 'blocked', reason: 'Missing URL' };
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? { kind: 'web', url: parsed.href }
      : { kind: 'blocked', reason: `Blocked ${parsed.protocol} link` };
  } catch { return { kind: 'blocked', reason: 'Malformed URL' }; }
}
