import { memo, type CSSProperties } from 'react';
import { ParsedEmbeddedAnnotation, mappedAnnotationTypeForSubtype, rgbToHex } from '../utils/embeddedAnnotations';
import { denormalizeGeometry } from '../utils/annotationOverlay';
import { RotationAngle, PageSize } from '../utils/viewModeUtils';

interface EmbeddedAnnotationLayerProps {
  /** 1-based physical page being rendered. */
  pageNumber: number;
  /**
   * Embedded (PDF-born) annotations for THIS page, already filtered to
   * supported subtypes that have not been imported this session.
   */
  items: ParsedEmbeddedAnnotation[];
  /** Natural (unrotated, scale 1) page size — the denormalize base. */
  pageBaseSize: PageSize;
  scale: number;
  rotation: RotationAngle;
  /** Called when the user clicks any embedded overlay (opens the import preview). */
  onOpenEmbeddedImport: () => void;
}

/**
 * Task 3.6 (FR-9.9) — renders standards-compliant embedded annotations as
 * SOURCE overlays: same normalized geometry as user annotations, but visually
 * distinct (dashed rects in the PDF's own colour, outline pins) so the user
 * can always tell "still in the PDF" from "mine, editable". Clicking any
 * overlay opens the explicit import preview. Pointer events are limited to
 * the overlays so text selection and scrolling keep working.
 */
export const EmbeddedAnnotationLayer = memo(function EmbeddedAnnotationLayer({
  pageNumber,
  items,
  pageBaseSize,
  scale,
  rotation,
  onOpenEmbeddedImport,
}: EmbeddedAnnotationLayerProps) {
  if (items.length === 0) return null;

  return (
    <div
      className="annotation-layer embedded-annotation-layer"
      aria-label={`${items.length} embedded PDF annotation${items.length === 1 ? '' : 's'} on page ${pageNumber}`}
    >
      {items.map((item) => {
        const mappedType = mappedAnnotationTypeForSubtype(item.subtype);
        const hex = item.colorRgb ? rgbToHex(item.colorRgb) : '#9b9797';
        const titleBits = [item.subtype, item.pageIndex + 1];
        if (item.contents) titleBits.push(item.contents);
        if (item.author) titleBits.push(item.author);
        const common = {
          key: item.sourceId,
          className: 'embedded-annot-overlay',
          'data-source-id': item.sourceId,
          'data-subtype': item.subtype,
        };

        if (mappedType === 'highlight' || mappedType === 'underline') {
          return (
            <span {...common} key={item.sourceId}>
              {item.rects.map((rect, i) => {
                const px = denormalizeGeometry(rect, {
                  pageWidthPx: pageBaseSize.width,
                  pageHeightPx: pageBaseSize.height,
                  scale,
                  rotationDegrees: rotation,
                });
                return (
                  <button
                    key={i}
                    type="button"
                    className={`embedded-rect embedded-rect-${mappedType === 'underline' ? 'underline' : 'highlight'}`}
                    style={geometryToCss(px, hex, mappedType === 'underline')}
                    onClick={onOpenEmbeddedImport}
                    title={`PDF ${item.subtype} · click to preview import → ${titleBits.join(' · ')}`}
                    aria-label={`PDF ${item.subtype} on page ${pageNumber}; click to preview import`}
                  />
                );
              })}
            </span>
          );
        }

        if (mappedType === 'comment') {
          const rect = item.rects[0];
          if (!rect) return null;
          const px = denormalizeGeometry(rect, {
            pageWidthPx: pageBaseSize.width,
            pageHeightPx: pageBaseSize.height,
            scale,
            rotationDegrees: rotation,
          });
          return (
            <button
              {...common}
              key={item.sourceId}
              type="button"
              className="embedded-pin"
              style={{ left: px.left + px.width / 2 - 8, top: px.top - 8 }}
              onClick={onOpenEmbeddedImport}
              title={`PDF ${item.subtype} note · click to preview import → ${titleBits.join(' · ')}`}
              aria-label={`PDF note on page ${pageNumber}; click to preview import`}
            >
              <span className="embedded-pin-dot" style={{ borderColor: hex }}>s</span>
            </button>
          );
        }

        return null;
      })}
    </div>
  );
});

function geometryToCss(
  px: { left: number; top: number; width: number; height: number },
  hex: string,
  underline: boolean
): CSSProperties {
  if (underline) {
    return { left: px.left, top: px.top, width: px.width, height: px.height, borderBottomColor: hex };
  }
  const rgba = `${hex}66`; // ~40% alpha for the source-style fill
  return { left: px.left, top: px.top, width: px.width, height: px.height, background: rgba };
}
