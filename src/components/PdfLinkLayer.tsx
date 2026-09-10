import { useEffect, useState } from 'react';
import type * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { resolvePdfDestination, resolvePdfUrl, type ResolvedPdfLinkTarget } from '../utils/pdfLinks';

type LinkItem = { id: string; rect: [number, number, number, number]; target: ResolvedPdfLinkTarget; label: string };

export function PdfLinkLayer({ doc, pageNumber, scale, rotation, onNavigate, onExternalLink }: { doc: pdfjsLib.PDFDocumentProxy; pageNumber: number; scale: number; rotation: number; onNavigate?: (page: number) => void; onExternalLink?: (url: string) => void }) {
  const [items, setItems] = useState<LinkItem[]>([]);
  useEffect(() => { let live = true; void (async () => {
    try {
    const page = await doc.getPage(pageNumber);
    const annotations = await page.getAnnotations({ intent: 'display' });
    const viewport = page.getViewport({ scale, rotation });
    const mapPoint = (x: number, y: number): [number, number] => {
      const [a,b,c,d,e,f] = viewport.transform;
      return [a*x+c*y+e, b*x+d*y+f];
    };
    const links = await Promise.all(annotations.filter((a) => a.subtype === 'Link' && Array.isArray(a.rect)).map(async (a, index) => ({
      id: `${pageNumber}-${index}`, rect: [...mapPoint(a.rect[0], a.rect[1]), ...mapPoint(a.rect[2], a.rect[3])] as [number, number, number, number],
      target: a.url ? resolvePdfUrl(a.url) : a.action && ['NextPage','PrevPage','FirstPage','LastPage'].includes(a.action) ? { kind: 'named-action', action: a.action } as ResolvedPdfLinkTarget : await resolvePdfDestination(doc, a.dest),
      label: a.title || a.url || 'PDF link',
    })));
    if (live) setItems(links);
    } catch { if (live) setItems([]); }
  })(); return () => { live = false; }; }, [doc, pageNumber, scale, rotation]);
  if (!items.length) return null;
  return <div className="pdf-link-layer" aria-label={`Links on page ${pageNumber}`}>{items.map((item) => {
    const [x1,y1,x2,y2] = item.rect;
    const style = { left: Math.min(x1,x2), top: Math.min(y1,y2), width: Math.abs(x2-x1), height: Math.abs(y2-y1) };
    const activate = () => {
      if (item.target.kind === 'page') onNavigate?.(item.target.pageNumber);
      else if (item.target.kind === 'named-action') onNavigate?.(item.target.action === 'FirstPage' ? 1 : item.target.action === 'LastPage' ? doc.numPages : item.target.action === 'NextPage' ? Math.min(doc.numPages,pageNumber+1) : Math.max(1,pageNumber-1));
    };
    return <button key={item.id} style={style} className="pdf-link-hit" disabled={item.target.kind === 'blocked'} aria-label={item.label} onClick={() => item.target.kind === 'web' ? onExternalLink?.(item.target.url) : activate()} />;
  })}</div>;
}
