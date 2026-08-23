import * as fs from "node:fs";
import * as path from "node:path";

export interface IconFileReport {
  readonly filename: string;
  readonly exists: boolean;
  readonly sizeBytes: number;
}

export interface IconSuiteAudit {
  readonly valid: boolean;
  readonly missingFiles: readonly string[];
  readonly forbiddenDirs: readonly string[];
  readonly files: readonly IconFileReport[];
  readonly svgBrandingValid: boolean;
}

export const REQUIRED_DESKTOP_ICON_FILES: readonly string[] = [
  "icon.svg",
  "128x128.png",
  "128x128@2x.png",
  "32x32.png",
  "64x64.png",
  "Square30x30Logo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square89x89Logo.png",
  "Square107x107Logo.png",
  "Square142x142Logo.png",
  "Square150x150Logo.png",
  "Square284x284Logo.png",
  "Square310x310Logo.png",
  "StoreLogo.png",
  "icon.icns",
  "icon.ico",
  "icon.png",
] as const;

export const FORBIDDEN_ICON_DIRS: readonly string[] = ["android", "ios"] as const;

export const MODERNIST_ICON_ACCENT_COLOR = "#ec3013";

/**
 * Validates the icon suite in src-tauri/icons directory.
 */
export function auditIconSuite(iconsDirPath: string): IconSuiteAudit {
  const missingFiles: string[] = [];
  const fileReports: IconFileReport[] = [];

  for (const filename of REQUIRED_DESKTOP_ICON_FILES) {
    const fullPath = path.join(iconsDirPath, filename);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      fileReports.push({
        filename,
        exists: true,
        sizeBytes: stats.size,
      });
    } else {
      missingFiles.push(filename);
      fileReports.push({
        filename,
        exists: false,
        sizeBytes: 0,
      });
    }
  }

  const forbiddenFound: string[] = [];
  for (const dirName of FORBIDDEN_ICON_DIRS) {
    const fullPath = path.join(iconsDirPath, dirName);
    if (fs.existsSync(fullPath)) {
      forbiddenFound.push(dirName);
    }
  }

  let svgBrandingValid = false;
  const svgPath = path.join(iconsDirPath, "icon.svg");
  if (fs.existsSync(svgPath)) {
    const svgContent = fs.readFileSync(svgPath, "utf-8");
    svgBrandingValid =
      svgContent.includes(MODERNIST_ICON_ACCENT_COLOR) &&
      svgContent.includes("#141211") &&
      svgContent.includes("<svg");
  }

  const valid = missingFiles.length === 0 && forbiddenFound.length === 0 && svgBrandingValid;

  return {
    valid,
    missingFiles,
    forbiddenDirs: forbiddenFound,
    files: fileReports,
    svgBrandingValid,
  };
}
