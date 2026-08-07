export type ZoomMode = "fit-width" | "fit-page" | "custom";
export type ViewMode = "single" | "continuous" | "facing";
export type RotationAngle = 0 | 90 | 180 | 270;

export interface ReadingSessionState {
  document_id: string;
  current_page: number;
  zoom_mode: ZoomMode;
  zoom_scale: number; // Stored as percentage, e.g. 100.0 = 100%
  scroll_top_px: number;
  left_pane_open: boolean;
  left_pane_width_px: number;
  right_pane_open: boolean;
  right_pane_width_px: number;
  view_mode: ViewMode;
  rotation: RotationAngle;
  updated_at?: string;
}

export interface LayoutBounds {
  containerWidth: number;
  containerHeight: number;
  minCanvasWidth?: number;
  minPaneWidth?: number;
  maxPaneWidth?: number;
}

export const DEFAULT_LAYOUT_BOUNDS: LayoutBounds = {
  containerWidth: 1024,
  containerHeight: 640,
  minCanvasWidth: 350,
  minPaneWidth: 160,
  maxPaneWidth: 450,
};

export const DEFAULT_LEFT_PANE_WIDTH = 230;
export const DEFAULT_RIGHT_PANE_WIDTH = 284;

export function zoomScaleToPercentage(scaleOrPct: number): number {
  if (scaleOrPct <= 5.0) {
    return Math.round(scaleOrPct * 100);
  }
  return Math.max(25, Math.min(500, Math.round(scaleOrPct)));
}

export function zoomPercentageToScale(scaleOrPct: number): number {
  if (scaleOrPct > 5.0) {
    return Math.round((scaleOrPct / 100) * 100) / 100;
  }
  return Math.max(0.25, Math.min(5.0, Math.round(scaleOrPct * 100) / 100));
}

export function createDefaultReadingSession(documentId: string): ReadingSessionState {
  return {
    document_id: documentId,
    current_page: 1,
    zoom_mode: "fit-width",
    zoom_scale: 100.0,
    scroll_top_px: 0.0,
    left_pane_open: true,
    left_pane_width_px: DEFAULT_LEFT_PANE_WIDTH,
    right_pane_open: true,
    right_pane_width_px: DEFAULT_RIGHT_PANE_WIDTH,
    view_mode: "continuous",
    rotation: 0,
    updated_at: new Date().toISOString(),
  };
}

export function validateAndSanitizeReadingSession(
  raw: Partial<ReadingSessionState> | null | undefined,
  bounds: LayoutBounds = DEFAULT_LAYOUT_BOUNDS,
  pageCount?: number
): ReadingSessionState {
  const defaultSession = createDefaultReadingSession(raw?.document_id || "unknown");
  if (!raw) {
    return defaultSession;
  }

  const documentId = typeof raw.document_id === "string" && raw.document_id.trim().length > 0
    ? raw.document_id.trim()
    : "unknown";

  const totalPages = typeof pageCount === "number" && pageCount > 0 ? pageCount : undefined;
  const rawPage = typeof raw.current_page === "number" && !isNaN(raw.current_page)
    ? Math.floor(raw.current_page)
    : 1;

  let currentPage = Math.max(1, rawPage);
  if (totalPages !== undefined) {
    currentPage = Math.min(currentPage, totalPages);
  }

  const validZoomModes: ZoomMode[] = ["fit-width", "fit-page", "custom"];
  const zoomMode: ZoomMode = validZoomModes.includes(raw.zoom_mode as ZoomMode)
    ? (raw.zoom_mode as ZoomMode)
    : "fit-width";

  const rawZoomScale = typeof raw.zoom_scale === "number" && !isNaN(raw.zoom_scale)
    ? raw.zoom_scale
    : 100.0;
  const zoomScale = zoomScaleToPercentage(rawZoomScale);

  const rawScrollTop = typeof raw.scroll_top_px === "number" && !isNaN(raw.scroll_top_px)
    ? raw.scroll_top_px
    : 0.0;
  const scrollTopPx = Math.max(0, rawScrollTop);

  const validViewModes: ViewMode[] = ["single", "continuous", "facing"];
  const viewMode: ViewMode = validViewModes.includes(raw.view_mode as ViewMode)
    ? (raw.view_mode as ViewMode)
    : "continuous";

  const validRotations: RotationAngle[] = [0, 90, 180, 270];
  const rotation: RotationAngle = validRotations.includes(raw.rotation as RotationAngle)
    ? (raw.rotation as RotationAngle)
    : 0;

  const minPaneW = bounds.minPaneWidth ?? DEFAULT_LAYOUT_BOUNDS.minPaneWidth!;
  const maxPaneW = bounds.maxPaneWidth ?? DEFAULT_LAYOUT_BOUNDS.maxPaneWidth!;
  const minCanvasW = bounds.minCanvasWidth ?? DEFAULT_LAYOUT_BOUNDS.minCanvasWidth!;
  const containerW = Math.max(bounds.containerWidth || 1024, 300);

  let leftPaneOpen = typeof raw.left_pane_open === "boolean" ? raw.left_pane_open : true;
  let rightPaneOpen = typeof raw.right_pane_open === "boolean" ? raw.right_pane_open : true;

  let leftWidth = typeof raw.left_pane_width_px === "number" && !isNaN(raw.left_pane_width_px)
    ? raw.left_pane_width_px
    : DEFAULT_LEFT_PANE_WIDTH;
  let rightWidth = typeof raw.right_pane_width_px === "number" && !isNaN(raw.right_pane_width_px)
    ? raw.right_pane_width_px
    : DEFAULT_RIGHT_PANE_WIDTH;

  leftWidth = Math.max(minPaneW, Math.min(maxPaneW, leftWidth));
  rightWidth = Math.max(minPaneW, Math.min(maxPaneW, rightWidth));

  if (leftPaneOpen && rightPaneOpen) {
    const totalRequired = leftWidth + rightWidth + minCanvasW;
    if (totalRequired > containerW) {
      const maxAvailablePaneSpace = containerW - minCanvasW;
      if (maxAvailablePaneSpace < minPaneW * 2) {
        rightPaneOpen = false;
        leftWidth = Math.max(minPaneW, Math.min(leftWidth, containerW - minCanvasW));
      } else {
        const ratio = maxAvailablePaneSpace / (leftWidth + rightWidth);
        leftWidth = Math.max(minPaneW, Math.floor(leftWidth * ratio));
        rightWidth = Math.max(minPaneW, Math.floor(rightWidth * ratio));
      }
    }
  } else if (leftPaneOpen) {
    if (leftWidth + minCanvasW > containerW) {
      leftWidth = Math.max(minPaneW, containerW - minCanvasW);
    }
  } else if (rightPaneOpen) {
    if (rightWidth + minCanvasW > containerW) {
      rightWidth = Math.max(minPaneW, containerW - minCanvasW);
    }
  }

  return {
    document_id: documentId,
    current_page: currentPage,
    zoom_mode: zoomMode,
    zoom_scale: zoomScale,
    scroll_top_px: scrollTopPx,
    left_pane_open: leftPaneOpen,
    left_pane_width_px: leftWidth,
    right_pane_open: rightPaneOpen,
    right_pane_width_px: rightWidth,
    view_mode: viewMode,
    rotation: rotation,
    updated_at: raw.updated_at || new Date().toISOString(),
  };
}

export function serializeReadingSession(session: ReadingSessionState): string {
  return JSON.stringify(session);
}

export function deserializeReadingSession(
  rawJson: string,
  bounds: LayoutBounds = DEFAULT_LAYOUT_BOUNDS,
  pageCount?: number
): ReadingSessionState | null {
  try {
    const parsed = JSON.parse(rawJson) as Partial<ReadingSessionState>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return validateAndSanitizeReadingSession(parsed, bounds, pageCount);
  } catch {
    return null;
  }
}
