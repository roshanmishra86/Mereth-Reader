import { describe, expect, it } from "vitest";
import * as path from "node:path";
import {
  auditIconSuite,
  MODERNIST_ICON_ACCENT_COLOR,
  REQUIRED_DESKTOP_ICON_FILES,
  FORBIDDEN_ICON_DIRS,
} from "./iconIntegrity";

describe("iconIntegrity", () => {
  const iconsDir = path.resolve(__dirname, "../../src-tauri/icons");

  it("verifies all required desktop icon files exist and are non-empty", () => {
    const audit = auditIconSuite(iconsDir);
    expect(audit.missingFiles).toEqual([]);
    expect(audit.forbiddenDirs).toEqual([]);
    expect(audit.svgBrandingValid).toBe(true);
    expect(audit.valid).toBe(true);
    expect(audit.files.length).toBe(REQUIRED_DESKTOP_ICON_FILES.length);

    for (const file of audit.files) {
      expect(file.exists).toBe(true);
      expect(file.sizeBytes).toBeGreaterThan(100);
    }
  });

  it("asserts Modernist palette constants and required file lists", () => {
    expect(MODERNIST_ICON_ACCENT_COLOR).toBe("#ec3013");
    expect(FORBIDDEN_ICON_DIRS).toContain("android");
    expect(FORBIDDEN_ICON_DIRS).toContain("ios");
    expect(REQUIRED_DESKTOP_ICON_FILES).toContain("icon.svg");
    expect(REQUIRED_DESKTOP_ICON_FILES).toContain("icon.ico");
    expect(REQUIRED_DESKTOP_ICON_FILES).toContain("icon.icns");
    expect(REQUIRED_DESKTOP_ICON_FILES).toContain("icon.png");
  });

  it("identifies missing files when given an empty or invalid directory", () => {
    const audit = auditIconSuite("/tmp/nonexistent-icons-dir");
    expect(audit.valid).toBe(false);
    expect(audit.missingFiles.length).toBe(REQUIRED_DESKTOP_ICON_FILES.length);
    expect(audit.svgBrandingValid).toBe(false);
  });
});
