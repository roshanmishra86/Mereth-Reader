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
