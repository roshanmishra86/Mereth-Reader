export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export type PageDimmingLevel = "0%" | "20%" | "40%" | "60%";
export type AppTextScale = "80%" | "100%" | "120%" | "150%";
export type ReducedMotionMode = "system" | "enabled" | "disabled";

export interface AppearancePreferences {
  theme: ThemeMode;
  pageDimming: PageDimmingLevel;
  appTextScale: AppTextScale;
  reducedMotion: ReducedMotionMode;
  calmChrome: boolean;
}

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  theme: "system",
  pageDimming: "0%",
  appTextScale: "100%",
  reducedMotion: "system",
  calmChrome: true,
};

export const DEFAULT_MIN_CANVAS_WIDTH = 350;
export const DEFAULT_LEFT_PANE_WIDTH = 230;
export const DEFAULT_RIGHT_PANE_WIDTH = 284;

/**
 * Resolves theme preference to concrete light or dark mode.
 * Respects system preference when mode is "system".
 */
export function resolveTheme(
  mode: ThemeMode | string | undefined | null,
  systemPrefersDark: boolean
): ResolvedTheme {
  const normalized = (mode || "system").toLowerCase().trim();
  if (normalized === "dark") {
    return "dark";
  }
  if (normalized === "light") {
    return "light";
  }
  return systemPrefersDark ? "dark" : "light";
}

/**
 * Converts page dimming level (percent string, float, or integer)
 * to numeric opacity value between 0.0 (0%) and 0.8 (80%).
 */
export function getPageDimmingOpacity(
  level: PageDimmingLevel | string | number | undefined | null
): number {
  if (level === undefined || level === null) {
    return 0.0;
  }
  if (typeof level === "number") {
    if (isNaN(level)) return 0.0;
    if (level > 1.0) return Math.min(0.8, Math.max(0.0, level / 100));
    return Math.min(0.8, Math.max(0.0, level));
  }
  const str = String(level).trim();
  if (str === "20%") return 0.2;
  if (str === "40%") return 0.4;
  if (str === "60%") return 0.6;
  if (str === "0%") return 0.0;

  const parsed = parseFloat(str.replace("%", ""));
  if (isNaN(parsed)) return 0.0;
  if (parsed > 1.0) return Math.min(0.8, Math.max(0.0, parsed / 100));
  return Math.min(0.8, Math.max(0.0, parsed));
}

/**
 * Returns inline CSS style properties for the page dimming overlay.
 * FR-8.6 requirement: NO default color inversion of PDF page content.
 */
export function getPageDimmingStyle(
  level: PageDimmingLevel | string | number | undefined | null
): {
  opacity: number;
  backgroundColor: string;
  pointerEvents: "none";
  preservesColor: true;
} {
  const opacity = getPageDimmingOpacity(level);
  return {
    opacity,
    backgroundColor: "#000000",
    pointerEvents: "none",
    preservesColor: true,
  };
}

/**
 * Resolves application text scale (80% to 150%) into numeric factor,
 * percentage integer, and string representation for CSS styling.
 * Independent of document zoom scale.
 */
export function resolveTextScale(
  scaleInput: AppTextScale | string | number | undefined | null
): {
  scaleFactor: number;
  percentage: number;
  fontPercentString: string;
} {
  if (scaleInput === undefined || scaleInput === null) {
    return { scaleFactor: 1.0, percentage: 100, fontPercentString: "100%" };
  }

  let numPct = 100;
  if (typeof scaleInput === "number") {
    if (!isNaN(scaleInput)) {
      numPct = scaleInput <= 2.0 ? Math.round(scaleInput * 100) : Math.round(scaleInput);
    }
  } else {
    const cleaned = String(scaleInput).trim().replace("%", "");
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed)) {
      numPct = parsed <= 2.0 ? Math.round(parsed * 100) : Math.round(parsed);
    }
  }

  // Enforce 80% to 150% boundaries per requirements
  const clampedPct = Math.max(80, Math.min(150, numPct));
  const scaleFactor = clampedPct / 100;

  return {
    scaleFactor,
    percentage: clampedPct,
    fontPercentString: `${clampedPct}%`,
  };
}

/**
 * Resolves reduced motion setting based on user preference and OS media query.
 */
export function resolveReducedMotion(
  mode: ReducedMotionMode | string | boolean | undefined | null,
  systemPrefersReduced: boolean
): boolean {
  if (typeof mode === "boolean") {
    return mode;
  }
  const normalized = (mode || "system").toLowerCase().trim();
  if (normalized === "enabled" || normalized === "true") {
    return true;
  }
  if (normalized === "disabled" || normalized === "false") {
    return false;
  }
  return systemPrefersReduced;
}

export interface ResolvePaneCollapseParams {
  containerWidth: number;
  leftRequested: boolean;
  rightRequested: boolean;
  leftWidth?: number;
  rightWidth?: number;
  minCanvasWidth?: number;
}

export interface ResolvePaneCollapseResult {
  leftPaneOpen: boolean;
  rightPaneOpen: boolean;
  collapseReason?: string;
}

/**
 * Resolves deterministic pane collapse order for 1024x640 or narrow viewports:
 * 1. Right pane collapses first if container cannot fit left + right + minCanvas.
 * 2. Left pane collapses second if container cannot fit left + minCanvas.
 * 3. Canvas & primary reader controls remain reachable.
 */
export function resolvePaneCollapseOrder(
  params: ResolvePaneCollapseParams
): ResolvePaneCollapseResult {
  const {
    containerWidth,
    leftRequested,
    rightRequested,
    leftWidth = DEFAULT_LEFT_PANE_WIDTH,
    rightWidth = DEFAULT_RIGHT_PANE_WIDTH,
    minCanvasWidth = DEFAULT_MIN_CANVAS_WIDTH,
  } = params;

  let leftOpen = leftRequested;
  let rightOpen = rightRequested;
  let collapseReason: string | undefined;

  const safeContainerWidth = Math.max(containerWidth, 100);

  if (leftOpen && rightOpen) {
    const totalRequired = leftWidth + rightWidth + minCanvasWidth;
    if (totalRequired > safeContainerWidth) {
      // Step 1: Right pane collapses first
      rightOpen = false;
      collapseReason = "Container width insufficient for both panes; right pane collapsed first.";

      // Step 2: Check if left pane + canvas still exceeds container width
      if (leftWidth + minCanvasWidth > safeContainerWidth) {
        leftOpen = false;
        collapseReason = "Container width insufficient for left pane; left pane collapsed second.";
      }
    }
  } else if (leftOpen) {
    if (leftWidth + minCanvasWidth > safeContainerWidth) {
      leftOpen = false;
      collapseReason = "Container width insufficient for left pane; left pane collapsed.";
    }
  } else if (rightOpen) {
    if (rightWidth + minCanvasWidth > safeContainerWidth) {
      rightOpen = false;
      collapseReason = "Container width insufficient for right pane; right pane collapsed.";
    }
  }

  return {
    leftPaneOpen: leftOpen,
    rightPaneOpen: rightOpen,
    collapseReason,
  };
}

/**
 * Parses raw settings rows from SQLite DB into typed AppearancePreferences.
 */
export function parseSettingsRows(
  rows: Array<{ key: string; value: string }>
): AppearancePreferences {
  const prefs: AppearancePreferences = { ...DEFAULT_APPEARANCE_PREFERENCES };

  for (const row of rows) {
    switch (row.key) {
      case "theme":
        if (row.value === "light" || row.value === "dark" || row.value === "system") {
          prefs.theme = row.value;
        }
        break;
      case "page_dimming":
        if (
          row.value === "0%" ||
          row.value === "20%" ||
          row.value === "40%" ||
          row.value === "60%"
        ) {
          prefs.pageDimming = row.value;
        }
        break;
      case "app_text_scale":
        if (
          row.value === "80%" ||
          row.value === "100%" ||
          row.value === "120%" ||
          row.value === "150%"
        ) {
          prefs.appTextScale = row.value;
        }
        break;
      case "reduced_motion":
        if (
          row.value === "system" ||
          row.value === "enabled" ||
          row.value === "disabled"
        ) {
          prefs.reducedMotion = row.value;
        }
        break;
      case "calm_chrome":
        prefs.calmChrome = row.value === "true";
        break;
    }
  }

  return prefs;
}

/**
 * Serializes setting key and value for DB storage.
 */
export function serializeSettingValue(
  key: keyof AppearancePreferences,
  val: unknown
): { key: string; value: string } {
  let dbKey = String(key);
  if (key === "pageDimming") dbKey = "page_dimming";
  if (key === "appTextScale") dbKey = "app_text_scale";
  if (key === "reducedMotion") dbKey = "reduced_motion";
  if (key === "calmChrome") dbKey = "calm_chrome";

  let strVal = String(val);
  if (typeof val === "boolean") {
    strVal = val ? "true" : "false";
  }

  return { key: dbKey, value: strVal };
}
