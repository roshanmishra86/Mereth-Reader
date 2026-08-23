import { memo } from 'react';
import { AnnotationRecord, PaletteEntry, paletteColorFor, paletteLabelFor, withAlpha } from '../utils/annotationTypes';
import { denormalizeGeometry } from '../utils/annotationOverlay';
import { RotationAngle, PageSize } from '../utils/viewModeUtils';

export interface AnnotationAssetVisual {
  url: string;
  caption: string;
}

interface PageAnnotationLayerProps {
  /** 1-based physical page being rendered. */
  pageNumber: number;
  /** Active annotations on THIS page (already filtered upstream). */
  annotations: AnnotationRecord[];
  /** Natural (unrotated, scale 1) page size — the denormalize base. */
  pageBaseSize: PageSize;
  scale: number;
  rotation: RotationAngle;
  selectedId: string | null;
  /** Resolved area-capture image URLs, keyed by annotation id. */
  assetsByAnnotationId: Record<string, AnnotationAssetVisual>;
  /** The user's semantic palette (FR-9.3); defaults apply when omitted. */
  palette?: PaletteEntry[];
  onSelectAnnotation: (id: string) => void;
}

interface PxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function annotationPixelRects(
  annotation: AnnotationRecord,
  pageBaseSize: PageSize,
  scale: number,
  rotation: RotationAngle
): PxRect[] {
  return annotation.rects.map((rect) =>
    denormalizeGeometry(rect, {
      pageWidthPx: pageBaseSize.width,
      pageHeightPx: pageBaseSize.height,
      scale,
      rotationDegrees: rotation,
    })
  );
}

/**
 * Durable annotation overlays (FR-9.4): every rect is re-derived from the
 * stored normalized geometry against the CURRENT scale/rotation, so highlights,
 * underlines, area crops, comment pins, and bookmarks survive zoom, resize,
 * rotation, renderer reloads, and restarts by construction (task 3.3's version
 * model decides active vs detached; a detached annotation renders ghosted and
 * is never silently re-attached to new bytes).
 *
 * The layer is pointer-transparent so text selection and scrolling keep
 * working; only the interactive affordances (pins, area crops, bookmarks)
 * re-enable pointer events on themselves.
 */
export const PageAnnotationLayer = memo(function PageAnnotationLayer({
  pageNumber,
  annotations,
  pageBaseSize,
  scale,
  rotation,
  selectedId,
  assetsByAnnotationId,
  palette,
  onSelectAnnotation,
}: PageAnnotationLayerProps) {
  if (annotations.length === 0) return null;

  return (
    <div className="annotation-layer" aria-label={`${annotations.length} annotation${annotations.length === 1 ? '' : 's'} on page ${pageNumber}`}>
      {annotations.map((annotation) => {
        const color = paletteColorFor(annotation.color, palette);
        const isSelected = annotation.id === selectedId;
        const common = {
          key: annotation.id,
          className: [
            'annotation-overlay',
            `type-${annotation.annotation_type}`,
            isSelected ? 'selected' : '',
          ]
            .filter(Boolean)
            .join(' '),
          'data-annotation-id': annotation.id,
          'data-annotation-type': annotation.annotation_type,
        };

        if (annotation.annotation_type === 'highlight' || annotation.annotation_type === 'underline') {
          const rects = annotationPixelRects(annotation, pageBaseSize, scale, rotation);
          if (rects.length === 0) return null;
          const semanticLabel = paletteLabelFor(annotation.color, palette);
          const ariaLabel = `${semanticLabel} ${annotation.annotation_type} on page ${pageNumber}: "${annotation.quote}"`;
          return (
            <span
              {...common}
              key={annotation.id}
              role="button"
              tabIndex={0}
              aria-label={ariaLabel}
              onClick={() => onSelectAnnotation(annotation.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectAnnotation(annotation.id);
                }
              }}
              style={{ cursor: 'pointer', pointerEvents: 'auto' }}
            >
              {rects.map((rect, i) => (
                <span
                  key={i}
                  className={`annotation-rect ${annotation.annotation_type === 'underline' ? 'annotation-underline' : 'annotation-highlight'}`}
                  style={
                    annotation.annotation_type === 'underline'
                      ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, borderBottomColor: color }
                      : { left: rect.left, top: rect.top, width: rect.width, height: rect.height, background: withAlpha(color, 0.45) }
                  }
                  title={`${semanticLabel}: ${annotation.quote}`}
                />
              ))}
            </span>
          );
        }

        if (annotation.annotation_type === 'area') {
          const rect = annotationPixelRects(annotation, pageBaseSize, scale, rotation)[0];
          if (!rect) return null;
          const asset = assetsByAnnotationId[annotation.id];
          const caption = asset?.caption ?? '';
          return (
            <button
              {...common}
              key={annotation.id}
              type="button"
              className={`${common.className} annotation-area`}
              style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              onClick={() => onSelectAnnotation(annotation.id)}
              aria-label={`Area capture on page ${pageNumber}${caption ? `: ${caption}` : ''}`}
            >
              {asset ? (
                <img src={asset.url} alt="" draggable={false} />
              ) : (
                <span className="area-loading">capture</span>
              )}
              {caption && <span className="area-caption">{caption}</span>}
            </button>
          );
        }

        if (annotation.annotation_type === 'comment') {
          const rect = annotationPixelRects(annotation, pageBaseSize, scale, rotation)[0];
          if (!rect) return null;
          return (
            <button
              {...common}
              key={annotation.id}
              type="button"
              className={`${common.className} annotation-pin`}
              style={{ left: rect.left + rect.width / 2 - 7, top: rect.top - 7 }}
              onClick={() => onSelectAnnotation(annotation.id)}
              title={annotation.comment}
              aria-label={`Comment on page ${pageNumber}: ${annotation.comment}`}
            >
              <span className="pin-dot" style={{ background: color }} />
            </button>
          );
        }

        if (annotation.annotation_type === 'bookmark') {
          return (
            <button
              {...common}
              key={annotation.id}
              type="button"
              className={`${common.className} annotation-bookmark`}
              style={{ top: 0, right: 0 }}
              onClick={() => onSelectAnnotation(annotation.id)}
              title="Bookmark"
              aria-label={`Bookmark on page ${pageNumber}`}
            >
              <span style={{ background: color }} />
            </button>
          );
        }

        return null;
      })}
    </div>
  );
});
