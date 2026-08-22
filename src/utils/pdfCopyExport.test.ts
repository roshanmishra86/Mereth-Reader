import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { calculateSha256 } from './pdfExportProof';
import { annotationRecordToPdfExportAnnotation, exportAnnotationRecordsToPdfCopy } from './pdfCopyExport';
import type { AnnotationRecord } from './annotationTypes';

const annotation: AnnotationRecord = {
  id: 'ann-1',
  document_id: 'doc-1',
  document_version_id: 'v1',
  checksum: 'sha',
  annotation_type: 'highlight',
  page_index: 0,
  page_label: '1',
  rects: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.05 }],
  quote: 'A quote',
  prefix_text: '',
  suffix_text: '',
  text_layer_checksum: null,
  comment: 'A comment',
  color: '#ffeb3b',
  tags: ['claim'],
  deleted_at: null,
  created_at: '2026-08-21T00:00:00Z',
  updated_at: '2026-08-21T00:00:00Z',
  provenance: 'source_extracted',
};

describe('PDF copy export (FR-14.3)', () => {
  async function createSourcePdf(tempDir: string): Promise<string> {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 300]);
    const sourcePath = path.join(tempDir, 'source.pdf');
    fs.writeFileSync(sourcePath, await pdf.save());
    return sourcePath;
  }

  it('converts supported annotation records to pdf-lib export annotations', () => {
    const converted = annotationRecordToPdfExportAnnotation(annotation);
    expect(converted?.pageNumber).toBe(1);
    expect(converted?.type).toBe('highlight');
  });

  it('exports a new PDF copy and writes Reader-only metadata to a sidecar', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mereth-pdf-copy-'));
    const sourcePath = await createSourcePdf(tempDir);
    const beforeSha = calculateSha256(fs.readFileSync(sourcePath));
    const outputPath = path.join(tempDir, 'annotated.pdf');

    const result = await exportAnnotationRecordsToPdfCopy({ sourcePath, outputPath, annotations: [annotation] });
    expect(fs.existsSync(result.exportedPdfPath)).toBe(true);
    expect(fs.existsSync(result.manifestPath)).toBe(true);
    expect(calculateSha256(fs.readFileSync(sourcePath))).toBe(beforeSha);
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf-8'));
    expect(manifest.readerOnlyMetadata.exportedAnnotationIds).toEqual(['ann-1']);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('refuses to overwrite the original PDF', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mereth-pdf-copy-'));
    const sourcePath = await createSourcePdf(tempDir);
    await expect(exportAnnotationRecordsToPdfCopy({ sourcePath, outputPath: sourcePath, annotations: [annotation] }))
      .rejects.toThrow(/must never overwrite the original/);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
