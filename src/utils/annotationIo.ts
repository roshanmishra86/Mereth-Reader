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
 * FR-9.7 atomic area-capture creation: sends the crop bytes plus the annotation
 * and asset records in a single IPC call. The Rust side writes the file and
 * inserts both rows, rolling back on any failure — no orphaned bitmap, no
 * row-without-bitmap, and no caller-supplied-path cleanup (PRD §15.3).
 */
export async function createAreaCapture(
  annotation: AnnotationRecord,
  asset: AnnotationAssetRecord,
  bytes: ArrayBuffer | Uint8Array
): Promise<void> {
  const payload = bytes instanceof Uint8Array ? Array.from(bytes) : Array.from(new Uint8Array(bytes));
  await invoke('db_create_area_capture', { annotation, asset, bytes: payload });
}

/** Resolves an asset row to a blob (raw bytes → Blob). */
export async function readAnnotationAssetBlob(assetId: string): Promise<Blob> {
  const bytes = await invoke<number[]>('db_read_annotation_asset_file', { assetId });
  return new Blob([new Uint8Array(bytes)], { type: 'image/png' });
}
