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

  const clipPoint = useCallback((clientX: number, clientY: number): ViewportRect | null => {
    const session = sessionRef.current;
    if (!session) return null;
    const { pageBox } = session;
    const left = Math.max(pageBox.left, Math.min(clientX, pageBox.right));
    const top = Math.max(pageBox.top, Math.min(clientY, pageBox.bottom));
    return { left, top, right: left, bottom: top };
  }, []);

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

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      const pageEl = target.closest('.pdf-page') as HTMLElement | null;
      const overlay = overlayRef.current;
      if (!pageEl || !overlay) return;
      const pageNumber = Number(pageEl.dataset.pageNumber ?? 0);
      if (!pageNumber) return;
      const rect = pageEl.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      const point = clipPoint(e.clientX, e.clientY);
      if (!point) return;
      sessionRef.current = {
        pageNumber,
        pageBox: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
        offsetX: overlayRect.left,
        offsetY: overlayRect.top,
        current: point,
      };
      renderDrag(point);
    },
    [clipPoint, renderDrag]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      const point = clipPoint(e.clientX, e.clientY);
      if (!point) return;
      const box: ViewportRect = {
        left: Math.min(session.current.left, point.left),
        top: Math.min(session.current.top, point.top),
        right: Math.max(session.current.left, point.left),
        bottom: Math.max(session.current.top, point.top),
      };
      session.current = box;
      renderDrag(box);
    },
    [clipPoint, renderDrag]
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
