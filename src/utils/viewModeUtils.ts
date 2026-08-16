/**
 * View Modes & Rotation calculations for Mereth Reader.
 * Supports single page, continuous vertical, facing pages (two-up),
 * fit width, fit page, custom zoom (25% to 500%), and rotate view (0°, 90°, 180°, 270°).
 * Strict TypeScript without `any`.
 */

export type LayoutMode = 'single' | 'continuous' | 'facing';
export type RotationAngle = 0 | 90 | 180 | 270;
export type ZoomModeType = 'fit-width' | 'fit-page' | 'custom';

export interface ViewModeState {
  layoutMode: LayoutMode;
  zoomScale: number;
  zoomMode: ZoomModeType;
  rotation: RotationAngle;
  isFullscreen: boolean;
}

export const DEFAULT_VIEW_MODE_STATE: ViewModeState = {
  layoutMode: 'continuous',
  zoomScale: 1.0,
  zoomMode: 'custom',
  rotation: 0,
  isFullscreen: false,
};

export const MIN_ZOOM_SCALE = 0.25; // 25%
export const MAX_ZOOM_SCALE = 5.0;  // 500%
export const ZOOM_STEP = 0.25;      // 25% steps

/**
 * Calculates updated zoom scale bounded between 25% (0.25) and 500% (5.00).
 */
export function calculateZoom(
  currentScale: number,
  action: 'in' | 'out' | 'reset' | 'fit-width' | 'fit-page' | 'set',
  customValue?: number,
  containerDim?: { width: number; height: number },
  pageDim?: { width: number; height: number }
): { scale: number; mode: ZoomModeType } {
  switch (action) {
    case 'in': {
      const next = Math.min(MAX_ZOOM_SCALE, Math.round((currentScale + ZOOM_STEP) * 100) / 100);
      return { scale: next, mode: 'custom' };
    }
    case 'out': {
      const next = Math.max(MIN_ZOOM_SCALE, Math.round((currentScale - ZOOM_STEP) * 100) / 100);
      return { scale: next, mode: 'custom' };
    }
    case 'reset': {
      return { scale: 1.0, mode: 'custom' };
    }
    case 'set': {
      const val = customValue ?? 1.0;
      const clamped = Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, Math.round(val * 100) / 100));
      return { scale: clamped, mode: 'custom' };
    }
    case 'fit-width': {
      if (containerDim && pageDim && pageDim.width > 0) {
        const padding = 40;
        const targetWidth = Math.max(200, containerDim.width - padding);
        const calculatedScale = Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, targetWidth / pageDim.width));
        return { scale: Math.round(calculatedScale * 100) / 100, mode: 'fit-width' };
      }
      return { scale: 1.0, mode: 'fit-width' };
    }
    case 'fit-page': {
      if (containerDim && pageDim && pageDim.width > 0 && pageDim.height > 0) {
        const paddingW = 40;
        const paddingH = 60;
        const scaleW = (containerDim.width - paddingW) / pageDim.width;
        const scaleH = (containerDim.height - paddingH) / pageDim.height;
        const calculatedScale = Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, Math.min(scaleW, scaleH)));
        return { scale: Math.round(calculatedScale * 100) / 100, mode: 'fit-page' };
      }
      return { scale: 1.0, mode: 'fit-page' };
    }
  }
}

/**
 * Rotates view angle clockwise or counter-clockwise in 90-degree steps.
 */
export function rotateView(currentAngle: RotationAngle, direction: 'cw' | 'ccw'): RotationAngle {
  const angles: RotationAngle[] = [0, 90, 180, 270];
  const currentIndex = angles.indexOf(currentAngle);
  if (direction === 'cw') {
    return angles[(currentIndex + 1) % 4];
  } else {
    return angles[(currentIndex - 1 + 4) % 4];
  }
}

export interface FacingPagePair {
  leftPage: number;
  rightPage?: number;
}

/**
 * Generates facing page pairs (two-up layout) for a given total page count.
 * Page 1 is displayed as a single cover page, followed by pairs (2-3, 4-5, etc.).
 */
export function calculateFacingPagePairs(totalPages: number): FacingPagePair[] {
  if (totalPages <= 0) return [];
  const pairs: FacingPagePair[] = [{ leftPage: 1 }];

  for (let p = 2; p <= totalPages; p += 2) {
    if (p + 1 <= totalPages) {
      pairs.push({ leftPage: p, rightPage: p + 1 });
    } else {
      pairs.push({ leftPage: p });
    }
  }

  return pairs;
}

/**
 * Validates if layout mode change is supported for the current document.
 */
export function validateLayoutMode(
  mode: LayoutMode,
  totalPages: number
): { isSupported: boolean; message?: string } {
  if (mode === 'facing' && totalPages < 2) {
    return {
      isSupported: false,
      message: 'Facing pages layout requires at least 2 pages in the document.',
    };
  }
  return { isSupported: true };
}

export interface PageSize {
  width: number;
  height: number;
}

/** US Letter at PDF default user units — the pre-measurement estimate. */
export const DEFAULT_PAGE_SIZE: PageSize = { width: 612, height: 792 };

/** Horizontal gap between the two pages of a facing spread (mockup: 2px divider). */
export const SPREAD_GAP_PX = 2;
/** Vertical gap between rows (pages or spreads) in scroll layouts. */
export const ROW_GAP_PX = 16;
/** Breathing room inside the scroll viewport used by fit calculations. */
export const FIT_PADDING_X_PX = 48;
export const FIT_PADDING_Y_PX = 48;

/**
 * Swaps width/height for 90°/270° user rotation so fit math sees the
 * dimensions the page will actually occupy on screen.
 */
export function rotatePageSize(size: PageSize, rotation: RotationAngle): PageSize {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : size;
}

export interface FitScaleParams {
  containerWidth: number;
  containerHeight: number;
  /** Natural page size at scale 1 (already includes the page's own /Rotate). */
  pageSize: PageSize;
  mode: 'fit-width' | 'fit-page';
  layoutMode: LayoutMode;
  rotation: RotationAngle;
}

/**
 * Single source of truth for fit-width / fit-page zoom.
 *
 * - fit-width sizes the page (or the whole spread in facing mode, per the
 *   mockup's "Fit width keeps both pages whole") to the viewport width minus
 *   padding.
 * - fit-page sizes so the entire page/spread fits both axes.
 * Result is clamped to the 25%–500% zoom range. Returns null when the
 * container has not been measured yet, so callers can keep the prior scale
 * instead of flashing a wrong one.
 */
export function calculateFitScale(params: FitScaleParams): number | null {
  const { containerWidth, containerHeight, mode, layoutMode, rotation } = params;
  if (containerWidth <= 0 || containerHeight <= 0) return null;

  const rotated = rotatePageSize(params.pageSize, rotation);
  if (rotated.width <= 0 || rotated.height <= 0) return null;

  const contentWidth =
    layoutMode === 'facing' ? rotated.width * 2 + SPREAD_GAP_PX : rotated.width;
  const contentHeight = rotated.height;

  const availableWidth = Math.max(100, containerWidth - FIT_PADDING_X_PX);
  const availableHeight = Math.max(100, containerHeight - FIT_PADDING_Y_PX);

  const scaleW = availableWidth / contentWidth;
  const scaleH = availableHeight / contentHeight;
  const raw = mode === 'fit-width' ? scaleW : Math.min(scaleW, scaleH);

  const clamped = Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, raw));
  return Math.round(clamped * 100) / 100;
}

/**
 * One scrollable row of the reader: a single page in single/continuous mode,
 * or a spread (cover page solo, then pairs) in facing mode.
 */
export interface ReaderRow {
  rowIndex: number;
  leftPage: number;
  rightPage?: number;
}

/**
 * Builds the row model for a layout mode. Facing uses cover-page pairing
 * (1 solo, then 2–3, 4–5, …) via calculateFacingPagePairs.
 */
export function buildReaderRows(layoutMode: LayoutMode, totalPages: number): ReaderRow[] {
  if (totalPages <= 0) return [];
  if (layoutMode === 'facing') {
    return calculateFacingPagePairs(totalPages).map((pair, index) => ({
      rowIndex: index,
      leftPage: pair.leftPage,
      rightPage: pair.rightPage,
    }));
  }
  const rows: ReaderRow[] = [];
  for (let page = 1; page <= totalPages; page++) {
    rows.push({ rowIndex: page - 1, leftPage: page });
  }
  return rows;
}

/** Finds the row containing a page (for page → scroll-position navigation). */
export function findRowIndexForPage(rows: ReaderRow[], pageNumber: number): number {
  for (const row of rows) {
    if (row.leftPage === pageNumber || row.rightPage === pageNumber) {
      return row.rowIndex;
    }
  }
  return Math.max(0, Math.min(pageNumber - 1, rows.length - 1));
}
