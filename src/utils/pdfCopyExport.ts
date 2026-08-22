import fs from 'node:fs';
import path from 'node:path';
import type { AnnotationRecord } from './annotationTypes';
import type { Annotation } from './annotationOverlay';
import { calculateSha256, exportAnnotatedPdfCopy } from './pdfExportProof';

export interface PdfCopyExportResult {
  exportedPdfPath: string;
  manifestPath: string;
  sourceSha256: string;
  exportedSha256: string;
}

export function annotationRecordToPdfExportAnnotation(annotation: AnnotationRecord): Annotation | null {
  const firstRect = annotation.rects[0];
  if (!firstRect) return null;
  const type = annotation.annotation_type === 'underline' || annotation.annotation_type === 'highlight'
    ? 'highlight'
    : annotation.annotation_type === 'area' || annotation.annotation_type === 'comment'
      ? 'rectangle'
      : null;
  if (!type) return null;
  return {
    id: annotation.id,
    documentId: annotation.document_id,
    documentVersionId: annotation.document_version_id,
    pageNumber: annotation.page_index + 1,
    pageLabel: annotation.page_label,
    type,
    geometry: firstRect,
    color: annotation.color,
    checksum: annotation.checksum,
    status: annotation.deleted_at ? 'detached' : 'active',
    createdAt: annotation.created_at,
    updatedAt: annotation.updated_at,
  };
}

export async function exportAnnotationRecordsToPdfCopy(params: {
  sourcePath: string;
  outputPath: string;
  annotations: readonly AnnotationRecord[];
}): Promise<PdfCopyExportResult> {
  if (path.resolve(params.sourcePath) === path.resolve(params.outputPath)) {
    throw new Error('Refusing to export: annotated PDF copy must never overwrite the original PDF.');
  }
  const outputPath = path.resolve(params.outputPath);
  const manifestPath = path.join(path.dirname(outputPath), 'export_manifest.json');
  try {
    const sourceBytes = fs.readFileSync(params.sourcePath);
    const sourceSha256 = calculateSha256(sourceBytes);
    const annotations = params.annotations
      .map(annotationRecordToPdfExportAnnotation)
      .filter((annotation): annotation is Annotation => annotation !== null && annotation.status === 'active');
    const result = await exportAnnotatedPdfCopy(params.sourcePath, outputPath, annotations);
    const exportedSha256 = calculateSha256(fs.readFileSync(outputPath));
    const sidecar = JSON.parse(fs.readFileSync(result.manifestPath, 'utf-8')) as Record<string, unknown>;
    sidecar.readerOnlyMetadata = {
      exportedAnnotationIds: annotations.map((annotation) => annotation.id),
      unsupportedAnnotationIds: params.annotations
        .filter((annotation) => !annotations.some((exported) => exported.id === annotation.id))
        .map((annotation) => annotation.id),
      sidecarReason: 'Reader-only note, tag, prompt, and provenance metadata cannot be embedded reliably in PDF annotations.',
    };
    fs.writeFileSync(result.manifestPath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf-8');
    return { exportedPdfPath: outputPath, manifestPath, sourceSha256, exportedSha256 };
  } catch (error) {
    for (const candidate of [outputPath, manifestPath]) {
      if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true });
    }
    throw error;
  }
}
