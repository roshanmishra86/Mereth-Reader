import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PDFDocument, rgb } from 'pdf-lib';
import { Annotation } from './annotationOverlay';

export interface ExportManifest {
  exportTimestamp: string;
  sourceFilename: string;
  sourceSha256: string;
  exportedFilename: string;
  exportedSha256: string;
  annotationCount: number;
  annotationsSummary: Array<{
    id: string;
    type: string;
    pageNumber: number;
  }>;
  provenance: 'deterministic_transform';
}

export interface ExportResult {
  exportedPdfPath: string;
  manifestPath: string;
  sourceSha256Unchanged: boolean;
}

/**
 * Computes SHA-256 hash of a file buffer or byte array.
 */
export function calculateSha256(buffer: Uint8Array | Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Parses hex color string like '#ffeb3b' into RGB values between 0.0 and 1.0 for pdf-lib.
 */
export function parseColorRgb(hexColor: string): { r: number; g: number; b: number } {
  let cleaned = hexColor.replace('#', '');
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map(c => c + c).join('');
  }
  if (cleaned.length !== 6) {
    return { r: 1, g: 1, b: 0 }; // Default yellow
  }
  const r = parseInt(cleaned.substring(0, 2), 16) / 255;
  const g = parseInt(cleaned.substring(2, 4), 16) / 255;
  const b = parseInt(cleaned.substring(4, 6), 16) / 255;
  return { r, g, b };
}

/**
 * Embeds annotations into a copy of the source PDF using pdf-lib, writes the file atomically,
 * and emits an export_manifest.json sidecar without altering the source file.
 */
export async function exportAnnotatedPdfCopy(
  sourcePath: string,
  outputPath: string,
  annotations: Annotation[]
): Promise<ExportResult> {
  // PRD FR-14.3 / RK-3: export must NEVER overwrite the original PDF. The
  // post-hoc SHA-256 comparison only *reports* a violation after the fact, so
  // reject identical source/destination up front before any read or write.
  if (path.resolve(sourcePath) === path.resolve(outputPath)) {
    throw new Error(
      'Refusing to export: output path resolves to the same file as the source PDF. ' +
      'Export produces a new annotated copy and must never overwrite the original (PRD FR-14.3).'
    );
  }

  const sourceBytes = fs.readFileSync(sourcePath);
  const initialSourceSha256 = calculateSha256(sourceBytes);

  // Load PDF copy into pdf-lib
  const pdfDoc = await PDFDocument.load(sourceBytes);
  const pages = pdfDoc.getPages();

  for (const ann of annotations) {
    if (ann.pageNumber < 1 || ann.pageNumber > pages.length) {
      continue;
    }

    const page = pages[ann.pageNumber - 1];
    const { width: pageW, height: pageH } = page.getSize();
    const { r, g, b } = parseColorRgb(ann.color);
    const colorObj = rgb(r, g, b);

    // Convert 0..1 normalized geometry to pdf-lib page point units
    const x = ann.geometry.x * pageW;
    const y = pageH - (ann.geometry.y + ann.geometry.height) * pageH; // PDF y-axis is inverted
    const w = ann.geometry.width * pageW;
    const h = ann.geometry.height * pageH;

    if (ann.type === 'highlight') {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: colorObj,
        opacity: 0.35
      });
    } else if (ann.type === 'rectangle') {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: colorObj,
        borderWidth: 2,
        opacity: 0.8
      });
    }
  }

  // Save modified PDF bytes
  const modifiedPdfBytes = await pdfDoc.save();
  const exportedSha256 = calculateSha256(modifiedPdfBytes);

  // Atomic write to temporary file then rename to destination
  const tempPdfPath = `${outputPath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPdfPath, modifiedPdfBytes);
  fs.renameSync(tempPdfPath, outputPath);

  // Create sidecar export manifest
  const manifestDir = path.dirname(outputPath);
  const manifestPath = path.join(manifestDir, 'export_manifest.json');
  const manifestData: ExportManifest = {
    exportTimestamp: new Date().toISOString(),
    sourceFilename: path.basename(sourcePath),
    sourceSha256: initialSourceSha256,
    exportedFilename: path.basename(outputPath),
    exportedSha256,
    annotationCount: annotations.length,
    annotationsSummary: annotations.map(a => ({
      id: a.id,
      type: a.type,
      pageNumber: a.pageNumber
    })),
    provenance: 'deterministic_transform'
  };

  const tempManifestPath = `${manifestPath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempManifestPath, JSON.stringify(manifestData, null, 2), 'utf-8');
  fs.renameSync(tempManifestPath, manifestPath);

  // Re-verify source file SHA-256 to ensure source was completely untouched
  const finalSourceBytes = fs.readFileSync(sourcePath);
  const finalSourceSha256 = calculateSha256(finalSourceBytes);

  return {
    exportedPdfPath: outputPath,
    manifestPath,
    sourceSha256Unchanged: initialSourceSha256 === finalSourceSha256
  };
}
