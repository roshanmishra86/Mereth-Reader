import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import type * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderPdfPageToCanvas, cancelCanvasRender, adoptCanvasPixels, releaseCanvasPixels, registerCanvasEviction, unregisterCanvasEviction } from '../utils/pdfViewer';
import { RotationAngle, PageSize } from '../utils/viewModeUtils';
import { AnnotationRecord, PaletteEntry } from '../utils/annotationTypes';
import { ParsedEmbeddedAnnotation } from '../utils/embeddedAnnotations';
import { PageAnnotationLayer, AnnotationAssetVisual } from './PageAnnotationLayer';
import { EmbeddedAnnotationLayer } from './EmbeddedAnnotationLayer';
import { PdfLinkLayer } from './PdfLinkLayer';

interface PdfPageCanvasProps {
  doc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  /** pdf.js viewport scale — the single source of zoom truth. */
  scale: number;
  rotation: RotationAngle;
  /** Reports the CSS-pixel size of the rendered page (for row measurements). */
  onRendered?: (pageNumber: number, size: PageSize) => void;
  // Task 3.4 durable annotation overlays (FR-9.4)
  annotations?: AnnotationRecord[];
  /** Natural (unrotated, scale 1) page size — the overlay's denormalize base. */
  baseSize?: PageSize;
  annotationAssets?: Record<string, AnnotationAssetVisual>;
  selectedAnnotationId?: string | null;
  /** User's semantic palette (FR-9.3). */
  palette?: PaletteEntry[];
  onSelectAnnotation?: (id: string) => void;
  // Task 3.6 embedded (PDF-born) annotations (FR-9.9)
  embeddedItems?: ParsedEmbeddedAnnotation[];
  onOpenEmbeddedImport?: () => void;
  onNavigateLink?: (pageNumber: number) => void;
  onExternalLink?: (url: string) => void;
}

/**
 * One rendered PDF page: a bitmap canvas (rendered at devicePixelRatio) plus
 * a transparent, selectable text layer. The wrapper is sized exactly to the
 * viewport's CSS-pixel dimensions — no CSS transform scaling, so layout,
 * scrolling, and selection coordinates always agree with what is painted.
 */
export const PdfPageCanvas = memo(function PdfPageCanvas({
  doc,
  pageNumber,
  scale,
  rotation,
  onRendered,
  annotations,
  baseSize,
  annotationAssets,
  selectedAnnotationId,
  palette,
  onSelectAnnotation,
  embeddedItems,
  onOpenEmbeddedImport,
  onNavigateLink,
  onExternalLink,
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const activeStagingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderedSize, setRenderedSize] = useState<PageSize | null>(null);
  const [renderedScale, setRenderedScale] = useState<number | null>(null);
  const [densityMultiplier, setDensityMultiplier] = useState(1);
  const [failed, setFailed] = useState(false);
  const [textLayerFailed, setTextLayerFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const onRenderedRef = useRef(onRendered);
  useEffect(() => {
    onRenderedRef.current = onRendered;
  });

  useEffect(() => {
    const visibleCanvas = canvasRef.current;
    const textLayer = textLayerRef.current;
    if (!visibleCanvas) return;
    registerCanvasEviction(visibleCanvas, () => {
      setDensityMultiplier((current) => Math.max(Number.EPSILON, current / 2));
      setRetryKey((key) => key + 1);
    });
    let isMounted = true;

    const executeRender = () => {
      setFailed(false);
      setTextLayerFailed(false);

      // Render into an offscreen staging canvas to prevent white flashing / blank canvas
      // during pdf.js rasterization. Visible canvas preserves previous bitmap at CSS scale.
      const stagingCanvas = document.createElement('canvas');
      stagingCanvas.width = 0;
      stagingCanvas.height = 0;
      if (activeStagingCanvasRef.current) {
        cancelCanvasRender(activeStagingCanvasRef.current);
      }
      activeStagingCanvasRef.current = stagingCanvas;

      renderPdfPageToCanvas({
        pdfDoc: doc,
        pageNumber,
        canvas: stagingCanvas,
        scale,
        rotation,
        swapTarget: visibleCanvas,
        densityMultiplier,
        textLayerContainer: textLayer ?? undefined,
        onBitmapRendered: (dimensions) => {
          if (!isMounted) return;
          const currentVisible = canvasRef.current;
          if (currentVisible) {
            // Synchronously blit completed staging canvas onto visible canvas
            // Resizing releases the old visible backing store. Drop it from
            // the ledger first so the replacement cannot transiently exceed
            // the aggregate budget while staging is still alive.
            releaseCanvasPixels(currentVisible);
            currentVisible.width = 0;
            currentVisible.height = 0;
            currentVisible.width = stagingCanvas.width;
            currentVisible.height = stagingCanvas.height;
            currentVisible.style.width = stagingCanvas.style.width;
            currentVisible.style.height = stagingCanvas.style.height;
            const ctx = currentVisible.getContext('2d');
            if (ctx) {
              ctx.drawImage(stagingCanvas, 0, 0);
            }
            // The backing store is now retained by the visible canvas. Update
            // accounting before dropping staging so the swap never creates an
            // unbounded second copy in the aggregate budget.
            adoptCanvasPixels(stagingCanvas, currentVisible);
            stagingCanvas.width = 0;
            stagingCanvas.height = 0;
          } else {
            releaseCanvasPixels(stagingCanvas);
            stagingCanvas.width = 0;
            stagingCanvas.height = 0;
          }
          setRenderedSize(dimensions);
          setRenderedScale(scale);
          // Fire onRendered exactly once per successful scale render
          onRenderedRef.current?.(pageNumber, dimensions);
        },
      }).then((result) => {
        // Keep the work handle until text-layer rendering ends so zoom/unmount
        // can cancel it even after its bitmap has been transferred.
        releaseCanvasPixels(stagingCanvas);
        stagingCanvas.width = 0;
        stagingCanvas.height = 0;
        if (activeStagingCanvasRef.current === stagingCanvas) activeStagingCanvasRef.current = null;
        if (!isMounted) return;
        if (result.bitmap === 'rendered') {
          setTextLayerFailed(result.textLayer === 'failed');
        } else if (result.bitmap === 'failed') {
          setFailed(true);
        }
      });
    };

    // If we already have a painted canvas at another scale, debounce sharp rerender by 100ms
    // so rapid zoom sequences scale smoothly with zero blank flicker
    const isZoomRerender = renderedScale !== null && renderedScale !== scale;
    const timerId = isZoomRerender ? window.setTimeout(executeRender, 100) : null;
    if (!isZoomRerender) {
      executeRender();
    }

    return () => {
      isMounted = false;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      if (activeStagingCanvasRef.current) {
        cancelCanvasRender(activeStagingCanvasRef.current);
        releaseCanvasPixels(activeStagingCanvasRef.current);
        activeStagingCanvasRef.current.width = 0;
        activeStagingCanvasRef.current.height = 0;
        activeStagingCanvasRef.current = null;
      }
      if (visibleCanvas) {
        cancelCanvasRender(visibleCanvas);
      }
    };
  }, [doc, pageNumber, scale, rotation, retryKey, densityMultiplier]);

  useEffect(() => {
    const mountedCanvas = canvasRef.current;
    return () => {
      const canvas = mountedCanvas;
      if (canvas) {
        cancelCanvasRender(canvas);
        releaseCanvasPixels(canvas);
        canvas.width = 0;
        canvas.height = 0;
        unregisterCanvasEviction(canvas);
      }
    };
  }, []);

  // --scale-factor feeds --total-scale-factor, which the text layer's span
  // sizing and the layer's own dimensions resolve against (pdf.js v6
  // text-layer CSS contract). It must live on this wrapper, not the layer.
  const zoomRatio = (renderedScale && renderedScale !== scale) ? scale / renderedScale : 1;
  const currentWidth = renderedSize
    ? Math.floor(renderedSize.width * zoomRatio)
    : baseSize
    ? Math.floor(baseSize.width * scale)
    : undefined;
  const currentHeight = renderedSize
    ? Math.floor(renderedSize.height * zoomRatio)
    : baseSize
    ? Math.floor(baseSize.height * scale)
    : undefined;

  const wrapperStyle: CSSProperties = {
    ['--scale-factor' as string]: scale,
    ...(currentWidth && currentHeight
      ? {
          width: `${currentWidth}px`,
          height: `${currentHeight}px`,
        }
      : {}),
  };

  const canvasStyle: CSSProperties = zoomRatio !== 1
    ? {
        transform: `scale(${zoomRatio})`,
        transformOrigin: 'top left',
      }
    : {};

  return (
    <div
      className="pdf-page"
      data-page-number={pageNumber}
      style={wrapperStyle}
    >
      <canvas ref={canvasRef} className="pdf-page-canvas" style={canvasStyle} />
      <div ref={textLayerRef} className="textLayer" />
      {renderedSize && <PdfLinkLayer doc={doc} pageNumber={pageNumber} scale={scale} rotation={rotation} onNavigate={onNavigateLink} onExternalLink={onExternalLink} />}
      {annotations && annotations.length > 0 && baseSize && (
        <PageAnnotationLayer
          pageNumber={pageNumber}
          annotations={annotations}
          pageBaseSize={baseSize}
          scale={scale}
          rotation={rotation}
          selectedId={selectedAnnotationId ?? null}
          assetsByAnnotationId={annotationAssets ?? {}}
          palette={palette}
          onSelectAnnotation={(id) => onSelectAnnotation?.(id)}
        />
      )}
      {embeddedItems && embeddedItems.length > 0 && baseSize && onOpenEmbeddedImport && (
        <EmbeddedAnnotationLayer
          pageNumber={pageNumber}
          items={embeddedItems}
          pageBaseSize={baseSize}
          scale={scale}
          rotation={rotation}
          onOpenEmbeddedImport={onOpenEmbeddedImport}
        />
      )}
      {failed && (
        <div className="pdf-page-error" role="alert">
          <span>Page {pageNumber} could not be rendered.</span>
          <button className="button secondary micro" onClick={() => setRetryKey((key) => key + 1)}>Retry page</button>
        </div>
      )}
      {textLayerFailed && !failed && (
        <div className="pdf-text-layer-warning" role="status">
          Selectable text is temporarily unavailable on page {pageNumber}. The page and area annotations still work.
        </div>
      )}
    </div>
  );
});
