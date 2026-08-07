import { describe, expect, test } from "vitest";
import {
  ReadingSessionState,
  ZoomMode,
  ViewMode,
  RotationAngle,
  createDefaultReadingSession,
  validateAndSanitizeReadingSession,
  serializeReadingSession,
  deserializeReadingSession,
  zoomScaleToPercentage,
  zoomPercentageToScale,
  DEFAULT_LAYOUT_BOUNDS,
} from "./sessionRestore";

describe("sessionRestore utility", () => {
  test("zoom conversion helpers convert accurately between scale decimal and percentage", () => {
    expect(zoomScaleToPercentage(1.0)).toBe(100);
    expect(zoomScaleToPercentage(1.25)).toBe(125);
    expect(zoomScaleToPercentage(125)).toBe(125);

    expect(zoomPercentageToScale(100)).toBe(1.0);
    expect(zoomPercentageToScale(125)).toBe(1.25);
    expect(zoomPercentageToScale(1.25)).toBe(1.25);
  });

  test("createDefaultReadingSession initializes sensible defaults", () => {
    const session = createDefaultReadingSession("doc-123");
    expect(session.document_id).toBe("doc-123");
    expect(session.current_page).toBe(1);
    expect(session.zoom_mode).toBe("fit-width");
    expect(session.zoom_scale).toBe(100.0);
    expect(session.scroll_top_px).toBe(0.0);
    expect(session.left_pane_open).toBe(true);
    expect(session.left_pane_width_px).toBe(230);
    expect(session.right_pane_open).toBe(true);
    expect(session.right_pane_width_px).toBe(284);
    expect(session.view_mode).toBe("continuous");
    expect(session.rotation).toBe(0);
  });

  test("validateAndSanitizeReadingSession clamps current_page to valid bounds", () => {
    const invalidLow = validateAndSanitizeReadingSession({ document_id: "doc-1", current_page: -5 }, DEFAULT_LAYOUT_BOUNDS, 10);
    expect(invalidLow.current_page).toBe(1);

    const invalidHigh = validateAndSanitizeReadingSession({ document_id: "doc-1", current_page: 999 }, DEFAULT_LAYOUT_BOUNDS, 12);
    expect(invalidHigh.current_page).toBe(12);

    const validPage = validateAndSanitizeReadingSession({ document_id: "doc-1", current_page: 4 }, DEFAULT_LAYOUT_BOUNDS, 12);
    expect(validPage.current_page).toBe(4);
  });

  test("validateAndSanitizeReadingSession normalizes invalid modes, zoom scale, and scroll position", () => {
    const sanitized = validateAndSanitizeReadingSession({
      document_id: "doc-2",
      zoom_mode: "invalid-mode" as unknown as ZoomMode,
      zoom_scale: 1500, // exceeds max 500
      scroll_top_px: -50, // negative scroll
      view_mode: "unknown-view" as unknown as ViewMode,
      rotation: 45 as unknown as RotationAngle, // invalid rotation angle
    });

    expect(sanitized.zoom_mode).toBe("fit-width");
    expect(sanitized.zoom_scale).toBe(500);
    expect(sanitized.scroll_top_px).toBe(0);
    expect(sanitized.view_mode).toBe("continuous");
    expect(sanitized.rotation).toBe(0);
  });

  test("validateAndSanitizeReadingSession clamps pane widths within min/max layout bounds", () => {
    const bounded = validateAndSanitizeReadingSession({
      document_id: "doc-3",
      left_pane_open: true,
      left_pane_width_px: 50, // lower than min 160
      right_pane_open: true,
      right_pane_width_px: 800, // higher than max 450
    }, {
      containerWidth: 1400,
      containerHeight: 900,
      minCanvasWidth: 350,
      minPaneWidth: 160,
      maxPaneWidth: 450,
    });

    expect(bounded.left_pane_width_px).toBe(160);
    expect(bounded.right_pane_width_px).toBe(450);
  });

  test("validateAndSanitizeReadingSession prevents canvas clipping on narrow containers (1024x640 layout)", () => {
    // Narrow container width of 600px with min canvas 350px (available pane space: 250px)
    // Since 250px < minPaneWidth * 2 (320px), right pane should collapse
    const narrowLayout = validateAndSanitizeReadingSession({
      document_id: "doc-narrow",
      left_pane_open: true,
      left_pane_width_px: 250,
      right_pane_open: true,
      right_pane_width_px: 250,
    }, {
      containerWidth: 600,
      containerHeight: 640,
      minCanvasWidth: 350,
      minPaneWidth: 160,
      maxPaneWidth: 450,
    });

    expect(narrowLayout.right_pane_open).toBe(false);
    expect(narrowLayout.left_pane_width_px + 350).toBeLessThanOrEqual(600);
  });

  test("serializeReadingSession and deserializeReadingSession round-trip state correctly", () => {
    const initialSession: ReadingSessionState = {
      document_id: "doc-roundtrip",
      current_page: 8,
      zoom_mode: "custom",
      zoom_scale: 125.0,
      scroll_top_px: 420.5,
      left_pane_open: true,
      left_pane_width_px: 240,
      right_pane_open: false,
      right_pane_width_px: 280,
      view_mode: "facing",
      rotation: 90,
      updated_at: "2026-08-06T05:50:00.000Z",
    };

    const serialized = serializeReadingSession(initialSession);
    expect(typeof serialized).toBe("string");

    const restored = deserializeReadingSession(serialized, DEFAULT_LAYOUT_BOUNDS, 12);
    expect(restored).not.toBeNull();
    expect(restored?.document_id).toBe("doc-roundtrip");
    expect(restored?.current_page).toBe(8);
    expect(restored?.zoom_mode).toBe("custom");
    expect(restored?.zoom_scale).toBe(125.0);
    expect(restored?.scroll_top_px).toBe(420.5);
    expect(restored?.left_pane_open).toBe(true);
    expect(restored?.left_pane_width_px).toBe(240);
    expect(restored?.right_pane_open).toBe(false);
    expect(restored?.right_pane_width_px).toBe(280);
    expect(restored?.view_mode).toBe("facing");
    expect(restored?.rotation).toBe(90);
  });

  test("deserializeReadingSession returns null for invalid JSON string", () => {
    expect(deserializeReadingSession("invalid json")).toBeNull();
    expect(deserializeReadingSession("123")).toBeNull();
  });
});
