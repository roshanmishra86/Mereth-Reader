import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exportAnnotatedPdfCopy, calculateSha256, parseColorRgb } from './pdfExportProof';
import { Annotation } from './annotationOverlay';

describe('R0.5 Annotated-PDF Copy Export Proofs', () => {
  const corpusPdfPath = path.resolve(process.cwd(), 'corpus', 'simple_text.pdf');

  it('parses hex colors into 0..1 RGB objects', () => {
    expect(parseColorRgb('#ff0000')).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseColorRgb('#00ff00')).toEqual({ r: 0, g: 1, b: 0 });
    expect(parseColorRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 1 });
  });

  it('exports annotated PDF copy without altering original source file fingerprint', async () => {
    const originalBytes = fs.readFileSync(corpusPdfPath);
    const originalSha = calculateSha256(originalBytes);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-export-test-'));
    const outputPdfPath = path.join(tempDir, 'exported_copy.pdf');

    const sampleAnnotations: Annotation[] = [
      {
        id: 'ann-hl-1',
        documentId: 'doc-1',
        documentVersionId: 'v1',
        pageNumber: 1,
        pageLabel: '1',
        type: 'highlight',
        geometry: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 },
        color: '#ffeb3b',
        checksum: 'sha-1',
        status: 'active',
        createdAt: '2026-08-04T12:00:00Z',
        updatedAt: '2026-08-04T12:00:00Z'
      },
      {
        id: 'ann-rect-2',
        documentId: 'doc-1',
        documentVersionId: 'v1',
        pageNumber: 1,
        pageLabel: '1',
        type: 'rectangle',
        geometry: { x: 0.2, y: 0.3, width: 0.4, height: 0.2 },
        color: '#2196f3',
        checksum: 'sha-2',
        status: 'active',
        createdAt: '2026-08-04T12:00:00Z',
        updatedAt: '2026-08-04T12:00:00Z'
      }
    ];

    const result = await exportAnnotatedPdfCopy(corpusPdfPath, outputPdfPath, sampleAnnotations);

    expect(result.sourceSha256Unchanged).toBe(true);
    expect(fs.existsSync(outputPdfPath)).toBe(true);
    expect(fs.existsSync(result.manifestPath)).toBe(true);

    // Verify source file SHA256 matches exactly
    const afterBytes = fs.readFileSync(corpusPdfPath);
    expect(calculateSha256(afterBytes)).toBe(originalSha);

    // Read export manifest sidecar
    const manifestContent = JSON.parse(fs.readFileSync(result.manifestPath, 'utf-8'));
    expect(manifestContent.sourceSha256).toBe(originalSha);
    expect(manifestContent.annotationCount).toBe(2);
    expect(manifestContent.provenance).toBe('deterministic_transform');
    expect(manifestContent.exportedFilename).toBe('exported_copy.pdf');

    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('refuses to export when output path resolves to the source PDF (FR-14.3 / RK-3)', async () => {
    await expect(exportAnnotatedPdfCopy(corpusPdfPath, corpusPdfPath, [])).rejects.toThrow(
      /must never overwrite the original/
    );
    // Also catch non-identical strings that resolve to the same file.
    await expect(
      exportAnnotatedPdfCopy(corpusPdfPath, path.resolve(corpusPdfPath), [])
    ).rejects.toThrow(/must never overwrite the original/);
  });
});
