import { useCallback, useEffect, useRef, useState } from 'react';
import { PageBox, ViewportRect } from '../utils/annotationAnchor';

export interface AreaCaptureResult {
  /** 1-based page containing the drag. */
  pageNumber: number;
  /** The page wrapper's in-viewport box (rotated visual space). */
  pageBox: PageBox;
  /** The drag box in viewport coordinates, clipped to the page. */
  box: ViewportRect;
}

interface AreaCaptureLayerProps {
  onComplete: (result: AreaCaptureResult) => void;
  onCancel: () => void;
}

interface DragSession {
  pageNumber: number;
  pageBox: PageBox;
  /** Overlay's own top-left, to convert viewport coords for CSS. */
  offsetX: number;
  offsetY: number;
  current: ViewportRect;
}

/**
 * FR-9.2 area capture: one drag on the page surface. The overlay watches
 * pointer events over the whole canvas container, resolves the drag's page
 * wrapper, clips the box to it, and reports the result — the caption prompt
 * and the asset round-trip happen in the parent. Escape cancels.
 */
export function AreaCaptureLayer({ onComplete, onCancel }: AreaCaptureLayerProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const [dragBoxCss, setDragBoxCss] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const renderDrag = useCallback((box: ViewportRect) => {
    const session = sessionRef.current;
    if (!session) return;
    setDragBoxCss({
      left: box.left - session.offsetX,
      top: box.top - session.offsetY,
      width: Math.max(0, box.right - box.left),
      height: Math.max(0, box.bottom - box.top),
    });
  }, []);

  /**
   * Finds the `.pdf-page` element beneath the pointer. The overlay covers the
   * whole canvas container and receives the pointer event itself, so
   * `e.target` is always the overlay — `closest('.pdf-page')` is null. We
   * instead hit-test the page elements in the overlay's parent container by
   * their viewport rects.
   */
  const pageElementAtPoint = useCallback(
    (clientX: number, clientY: number): HTMLElement | null => {
      const overlay = overlayRef.current;
      const container = overlay?.parentElement;
      if (!container) return null;
      const pages = container.querySelectorAll<HTMLElement>('.pdf-page');
      for (const page of pages) {
        const r = page.getBoundingClientRect();
        if (
          clientX >= r.left &&
          clientX <= r.right &&
          clientY >= r.top &&
          clientY <= r.bottom
        ) {
          return page;
        }
      }
      return null;
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const overlay = overlayRef.current;
      if (!overlay) return;
      const pageEl = pageElementAtPoint(e.clientX, e.clientY);
      if (!pageEl) return;
      const pageNumber = Number(pageEl.dataset.pageNumber ?? 0);
      if (!pageNumber) return;
      const rect = pageEl.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      const pageBox: PageBox = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
      // Clip the initial point to the page before starting the session.
      const point: ViewportRect = {
        left: Math.max(pageBox.left, Math.min(e.clientX, pageBox.right)),
        top: Math.max(pageBox.top, Math.min(e.clientY, pageBox.bottom)),
        right: 0,
        bottom: 0,
      };
      point.right = point.left;
      point.bottom = point.top;
      sessionRef.current = {
        pageNumber,
        pageBox,
        offsetX: overlayRect.left,
        offsetY: overlayRect.top,
        current: point,
      };
      renderDrag(point);
    },
    [pageElementAtPoint, renderDrag]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      const { pageBox, current } = session;
      const left = Math.max(pageBox.left, Math.min(e.clientX, pageBox.right));
      const top = Math.max(pageBox.top, Math.min(e.clientY, pageBox.bottom));
      const box: ViewportRect = {
        left: Math.min(current.left, left),
        top: Math.min(current.top, top),
        right: Math.max(current.left, left),
        bottom: Math.max(current.top, top),
      };
      session.current = box;
      renderDrag(box);
    },
    [renderDrag]
  );

  const handlePointerUp = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setDragBoxCss(null);
    if (!session) return;
    const { pageNumber, pageBox, current: box } = session;
    // A click without a real drag dismisses the mode.
    if (box.right - box.left < 4 || box.bottom - box.top < 4) {
      onCancel();
      return;
    }
    onComplete({ pageNumber, pageBox, box });
  }, [onCancel, onComplete]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      ref={overlayRef}
      className="area-capture-overlay"
      role="presentation"
      aria-label="Area capture — drag across the area of the page you want to capture"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {dragBoxCss && dragBoxCss.width > 0 && dragBoxCss.height > 0 && (
        <div className="area-drag-box" style={dragBoxCss} />
      )}
    </div>
  );
}
