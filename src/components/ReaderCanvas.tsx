import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { calculateVirtualWindow } from '../utils/pdfUtils';
import {
  buildReaderRows,
  findRowIndexForPage,
  rotatePageSize,
  DEFAULT_PAGE_SIZE,
  ROW_GAP_PX,
  SPREAD_GAP_PX,
  LayoutMode,
  PageSize,
  ReaderRow,
  RotationAngle,
} from '../utils/viewModeUtils';
import { PdfPageCanvas } from './PdfPageCanvas';
import { AnnotationRecord, PaletteEntry } from '../utils/annotationTypes';
import { AnnotationAssetVisual } from './PageAnnotationLayer';

interface ReaderCanvasProps {
  doc: pdfjsLib.PDFDocumentProxy;
  totalPages: number;
  layoutMode: LayoutMode;
  /** Effective viewport scale (fit modes already resolved by the parent). */
  scale: number;
  rotation: RotationAngle;
  currentPage: number;
  /** Session-restored scroll offset, applied once on mount. */
  initialScrollTop: number;
  /** Page navigation command from toolbar/outline/search (nonce re-fires). */
  scrollToPageRequest: { page: number; nonce: number } | null;
  /** Scroll-driven page changes (no navigation-history side effects). */
  onPageVisible: (page: number) => void;
  /** Viewport size for fit-width / fit-page computation in the parent. */
  onViewportChange: (size: { width: number; height: number }) => void;
  /** Natural size (scale 1, user-rotation removed) of each rendered page. */
  onPageSizeMeasured: (pageNumber: number, baseSize: PageSize) => void;
  onScrollPositionChange: (scrollTop: number) => void;
  onCopySelection?: () => void;
  // Task 3.4 durable annotation overlays (FR-9.4)
  annotationsByPage?: Map<number, AnnotationRecord[]>;
  annotationAssets?: Record<string, AnnotationAssetVisual>;
  selectedAnnotationId?: string | null;
  /** User's semantic palette (FR-9.3). */
  palette?: PaletteEntry[];
  onSelectAnnotation?: (id: string) => void;
}

interface RowLayout {
  leftPage: number;
  rightPage?: number;
  top: number;
  height: number;
  width: number;
}

/**
 * Virtualized, scrollable PDF canvas.
 *
 * - single: the current page alone; the container pans when zoomed in.
 * - continuous: every page in one vertical scroll, rendered in a
 *   visible ± buffer window (calculateVirtualWindow) so a 400-page document
 *   never materializes 400 canvases.
 * - facing: cover page solo, then two-page spreads with the mockup's 2px
 *   divider gap, scrolled continuously (mockup: "Continuous scroll · spreads
 *   252–253, 254–255").
 *
 * Scroll position derives the current page; toolbar/outline/search navigation
 * issues explicit scroll commands. There is no CSS transform zoom anywhere —
 * layout, scroll offsets, and selection coordinates always agree.
 */
export function ReaderCanvas(props: ReaderCanvasProps) {
  const {
    doc,
    totalPages,
    layoutMode,
    scale,
    rotation,
    currentPage,
    initialScrollTop,
    scrollToPageRequest,
    onPageVisible,
    onViewportChange,
    onPageSizeMeasured,
    onScrollPositionChange,
    onCopySelection,
    annotationsByPage,
    annotationAssets,
    selectedAnnotationId,
    palette,
    onSelectAnnotation,
  } = props;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  // Natural page sizes measured from actual renders; estimates fill the rest.
  const baseSizesRef = useRef<Map<number, PageSize>>(new Map());
  const [sizesVersion, setSizesVersion] = useState(0);

  const currentPageRef = useRef(currentPage);
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // Mount-time capture for one-shot session restore.
  const mountPageRef = useRef(currentPage);
  const didRestoreRef = useRef(false);
  // An explicit navigation command (toolbar/outline/search/deep link) always
  // wins over restoring the saved scroll position — even when it arrives (or
  // is already present) before the restore effect's gate opens, as happens
  // with an OS "Open with" / mereth:// deep link racing session restore.
  const explicitNavRequestRef = useRef(scrollToPageRequest !== null);

  // Viewport measurement (fit math + virtualization window).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const report = () => {
      const size = { width: el.clientWidth, height: el.clientHeight };
      setViewportSize(size);
      onViewportChange(size);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onViewportChange]);

  const rows = useMemo<ReaderRow[]>(() => {
    if (layoutMode === 'single') {
      return [{ rowIndex: 0, leftPage: currentPage }];
    }
    return buildReaderRows(layoutMode, totalPages);
  }, [layoutMode, totalPages, currentPage]);

  const representativeSize = useMemo(() => {
    const sizes = baseSizesRef.current;
    return sizes.get(1) ?? sizes.values().next().value ?? DEFAULT_PAGE_SIZE;
    // sizesVersion re-runs this memo as measurements arrive.
  }, [sizesVersion]);

  const rowLayouts = useMemo((): RowLayout[] => {
    let top = 0;
    return rows.map((row) => {
      const leftBase = baseSizesRef.current.get(row.leftPage) ?? representativeSize;
      const rightBase = row.rightPage
        ? baseSizesRef.current.get(row.rightPage) ?? representativeSize
        : undefined;
      const left = rotatePageSize(leftBase, rotation);
      const right = rightBase ? rotatePageSize(rightBase, rotation) : undefined;

      const height =
        scale * (right ? Math.max(left.height, right.height) : left.height);
      const width =
        scale * (right ? left.width + SPREAD_GAP_PX + right.width : left.width);

      const layout: RowLayout = {
        leftPage: row.leftPage,
        rightPage: row.rightPage,
        top,
        height,
        width,
      };
      top += height + ROW_GAP_PX;
      return layout;
    });
  }, [rows, scale, rotation, representativeSize]);

  const totalHeight = useMemo(
    () => (rowLayouts.length > 0 ? rowLayouts[rowLayouts.length - 1].top + rowLayouts[rowLayouts.length - 1].height : 0),
    [rowLayouts]
  );
  const maxRowWidth = useMemo(
    () => rowLayouts.reduce((max, row) => Math.max(max, row.width), 0),
    [rowLayouts]
  );

  const rowHeights = useMemo(() => rowLayouts.map((row) => row.height), [rowLayouts]);

  const window_ = useMemo(
    () =>
      calculateVirtualWindow(
        scrollTop,
        viewportSize.height,
        rowHeights,
        ROW_GAP_PX,
        layoutMode === 'single' ? 0 : 2
      ),
    [scrollTop, viewportSize.height, rowHeights, layoutMode]
  );

  // rAF-throttled scroll handling: window recompute + page sync + persist.
  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollRef.current;
      if (!el) return;
      const top = el.scrollTop;
      setScrollTop(top);
      onScrollPositionChange(top);

      if (layoutMode !== 'single' && rowLayouts.length > 0) {
        const win = calculateVirtualWindow(top, el.clientHeight, rowHeights, ROW_GAP_PX, 0);
        const firstVisible = win.visibleIndices[0] ?? 0;
        const page = rowLayouts[firstVisible]?.leftPage ?? 1;
        if (page !== currentPageRef.current) {
          onPageVisible(page);
        }
      }
    });
  }, [layoutMode, rowLayouts, rowHeights, onPageVisible, onScrollPositionChange]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Explicit navigation (toolbar page input, outline, search match, deep link).
  useEffect(() => {
    if (!scrollToPageRequest) return;
    explicitNavRequestRef.current = true;
    const el = scrollRef.current;
    if (!el || rowLayouts.length === 0) return;
    const rowIndex = findRowIndexForPage(
      rowLayouts.map((row, index) => ({ rowIndex: index, leftPage: row.leftPage, rightPage: row.rightPage })),
      scrollToPageRequest.page
    );
    const target = rowLayouts[rowIndex];
    if (target) {
      el.scrollTo({ top: Math.max(0, target.top - 8) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToPageRequest?.nonce]);

  // One-shot session restore: scroll offset wins; otherwise honor the
  // restored page (e.g. page 37 with a zero offset still lands on page 37).
  useEffect(() => {
    if (didRestoreRef.current) return;
    if (viewportSize.width <= 0 || sizesVersion === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    didRestoreRef.current = true;

    // An explicit navigation request already claimed the scroll position —
    // restoring the saved session here would override it.
    if (explicitNavRequestRef.current) return;

    if (initialScrollTop > 0) {
      el.scrollTop = initialScrollTop;
      setScrollTop(initialScrollTop);
    } else if (mountPageRef.current > 1 && layoutMode !== 'single') {
      const rowIndex = findRowIndexForPage(
        rowLayouts.map((row, index) => ({ rowIndex: index, leftPage: row.leftPage, rightPage: row.rightPage })),
        mountPageRef.current
      );
      const target = rowLayouts[rowIndex];
      if (target) {
        el.scrollTop = Math.max(0, target.top - 8);
        setScrollTop(el.scrollTop);
      }
    }
  }, [viewportSize, sizesVersion, initialScrollTop, layoutMode, rowLayouts]);

  // Measure each rendered page, converted back to its natural size at scale 1
  // (rotation swap is an involution, so re-applying it un-rotates).
  const handlePageRendered = useCallback(
    (pageNumber: number, rendered: PageSize) => {
      const base = rotatePageSize(
        { width: rendered.width / scale, height: rendered.height / scale },
        rotation
      );
      const prev = baseSizesRef.current.get(pageNumber);
      if (
        !prev ||
        Math.abs(prev.width - base.width) > 0.5 ||
        Math.abs(prev.height - base.height) > 0.5
      ) {
        baseSizesRef.current.set(pageNumber, base);
        setSizesVersion((v) => v + 1);
      }
      onPageSizeMeasured(pageNumber, base);
    },
    [scale, rotation, onPageSizeMeasured]
  );

  return (
    <div
      className={`reader-scroll layout-${layoutMode}`}
      ref={scrollRef}
      onScroll={handleScroll}
      onCopy={onCopySelection}
    >
      <div
        className="reader-rows"
        style={{ height: `${totalHeight}px`, width: `${maxRowWidth}px` }}
      >
        {window_.renderIndices.map((rowIndex) => {
          const row = rowLayouts[rowIndex];
          if (!row) return null;
          return (
            <div
              key={`${row.leftPage}-${row.rightPage ?? 'solo'}`}
              className={row.rightPage ? 'reader-row spread-row' : 'reader-row'}
              style={{ top: `${row.top}px`, height: `${row.height}px`, gap: row.rightPage ? SPREAD_GAP_PX : 0 }}
            >
              <PdfPageCanvas
                doc={doc}
                pageNumber={row.leftPage}
                scale={scale}
                rotation={rotation}
                onRendered={handlePageRendered}
                annotations={annotationsByPage?.get(row.leftPage)}
                baseSize={baseSizesRef.current.get(row.leftPage) ?? representativeSize}
                annotationAssets={annotationAssets}
                selectedAnnotationId={selectedAnnotationId}
                palette={palette}
                onSelectAnnotation={onSelectAnnotation}
              />
              {row.rightPage !== undefined && (
                <PdfPageCanvas
                  doc={doc}
                  pageNumber={row.rightPage}
                  scale={scale}
                  rotation={rotation}
                  onRendered={handlePageRendered}
                  annotations={annotationsByPage?.get(row.rightPage)}
                  baseSize={baseSizesRef.current.get(row.rightPage) ?? representativeSize}
                  annotationAssets={annotationAssets}
                  selectedAnnotationId={selectedAnnotationId}
                  palette={palette}
                  onSelectAnnotation={onSelectAnnotation}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
