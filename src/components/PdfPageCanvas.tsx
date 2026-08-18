import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import type * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderPdfPageToCanvas, cancelCanvasRender } from '../utils/pdfViewer';
import { RotationAngle, PageSize } from '../utils/viewModeUtils';
import { AnnotationRecord, PaletteEntry } from '../utils/annotationTypes';
import { ParsedEmbeddedAnnotation } from '../utils/embeddedAnnotations';
import { PageAnnotationLayer, AnnotationAssetVisual } from './PageAnnotationLayer';
import { EmbeddedAnnotationLayer } from './EmbeddedAnnotationLayer';

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
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [renderedSize, setRenderedSize] = useState<PageSize | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textLayer = textLayerRef.current;
    if (!canvas) return;
    let isMounted = true;
    setFailed(false);

    renderPdfPageToCanvas({
      pdfDoc: doc,
      pageNumber,
      canvas,
      scale,
      rotation,
      textLayerContainer: textLayer ?? undefined,
    }).then((result) => {
      if (!isMounted) return;
      if (result) {
        setRenderedSize(result);
        onRendered?.(pageNumber, result);
      } else {
        setFailed(true);
      }
    });

    return () => {
      isMounted = false;
      cancelCanvasRender(canvas);
    };
  }, [doc, pageNumber, scale, rotation, onRendered]);

  // --scale-factor feeds --total-scale-factor, which the text layer's span
  // sizing and the layer's own dimensions resolve against (pdf.js v6
  // text-layer CSS contract). It must live on this wrapper, not the layer.
  const wrapperStyle: CSSProperties = {
    ['--scale-factor' as string]: scale,
    ...(renderedSize
      ? {
          width: `${Math.floor(renderedSize.width)}px`,
          height: `${Math.floor(renderedSize.height)}px`,
        }
      : {}),
  };

  return (
    <div
      className="pdf-page"
      data-page-number={pageNumber}
      style={wrapperStyle}
    >
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <div ref={textLayerRef} className="textLayer" />
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
          Page {pageNumber} could not be rendered.
        </div>
      )}
    </div>
  );
});
