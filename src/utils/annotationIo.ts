/**
 * Task 3.4 — the only webview→Rust routes for annotation persistence and
 * asset transport (PRD §15.3: narrow typed IPC; no SQL and no caller-supplied
 * paths cross this boundary). Functions are thin wrappers over the commands
 * registered in `src-tauri/src/lib.rs`; asset bytes travel as raw IPC
 * payloads (ArrayBuffer), not JSON number arrays.
 */

import { invoke } from '@tauri-apps/api/core';
import { AnnotationAssetRecord, AnnotationRecord } from './annotationTypes';

export async function loadDocumentAnnotations(
  documentId: string
): Promise<AnnotationRecord[]> {
  const rows = await invoke<AnnotationRecord[]>('db_get_annotations_for_document', {
    documentId,
    includeTrashed: false,
  });
  return rows ?? [];
}

export async function createAnnotation(annotation: AnnotationRecord): Promise<void> {
  await invoke('db_add_annotation', { annotation });
}

export async function updateAnnotationFields(
  id: string,
  color: string,
  comment: string,
  tags: string[]
): Promise<void> {
  await invoke('db_update_annotation_fields', { id, color, comment, tags });
}

export async function trashAnnotation(id: string): Promise<void> {
  await invoke('db_trash_annotation', { id });
}

export async function restoreAnnotation(id: string): Promise<void> {
  await invoke('db_restore_annotation', { id });
}

export async function purgeAnnotation(id: string): Promise<void> {
  await invoke('db_purge_annotation', { id });
}

export async function loadAnnotationAssets(annotationId: string): Promise<AnnotationAssetRecord[]> {
  const rows = await invoke<AnnotationAssetRecord[]>('db_get_annotation_assets', {
    annotationId,
  });
  return rows ?? [];
}

export async function addAnnotationAsset(asset: AnnotationAssetRecord): Promise<void> {
  await invoke('db_add_annotation_asset', { asset });
}

export async function deleteAnnotationAsset(id: string): Promise<void> {
  await invoke('db_delete_annotation_asset', { id });
}

/**
 * Writes the crop bytes under `app-data/annotations/` (atomic, confined). The
 * asset row is created only afterwards via `addAnnotationAsset`, so a failed
 * write never leaves a dangling row (FR-9.7).
 */
export async function writeAnnotationAssetFile(
  relativePath: string,
  bytes: ArrayBuffer | Uint8Array
): Promise<void> {
  const payload = bytes instanceof Uint8Array ? Array.from(bytes) : Array.from(new Uint8Array(bytes));
  await invoke('db_write_annotation_asset_file', { relativePath, bytes: payload });
}

/** Resolves an asset row to a blob (raw bytes → Blob). */
export async function readAnnotationAssetBlob(assetId: string): Promise<Blob> {
  const bytes = await invoke<number[]>('db_read_annotation_asset_file', { assetId });
  return new Blob([new Uint8Array(bytes)], { type: 'image/png' });
}

/** Removes a half-written crop file when row inserts failed (no-op if gone). */
export async function removeAnnotationAssetFile(relativePath: string): Promise<void> {
  await invoke('db_remove_annotation_asset_file', { relativePath });
}
