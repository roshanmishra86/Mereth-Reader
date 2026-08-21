pub mod db;
pub mod import;
pub mod launch;
#[cfg(debug_assertions)]
pub mod perf;

use db::{CollectionRecord, Database, Document, Job, Page, ReadingSession, Setting};
use db::annotations::{Annotation, AnnotationAsset};
use db::evidence::EvidenceBlock;
use db::note_links::{BacklinkRecord, NoteLink};
use db::note_search::NoteSearchResult;
use db::notes::{Note, NoteRevision};
use db::versions::{DocumentVersion, PageGeometry, VersionCheckResult};
use import::{
  compute_file_metadata, copy_to_managed_documents, ensure_external_pdf_source,
  validate_pdf_filepath_basic, validate_pdf_path_for_record, FileMetadata,
};
use launch::{route_launch_args, SingleInstanceRoute};
use std::path::Path;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

pub struct AppState {
  pub db: Mutex<Option<Database>>,
}

#[tauri::command]
fn db_init(app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
  let app_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;

  let database = Database::new(&app_dir)?;
  let mut lock = state.db.lock().unwrap();
  *lock = Some(database);
  Ok(())
}

#[tauri::command]
fn db_get_documents(state: State<'_, AppState>) -> Result<Vec<Document>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_documents()
}

#[tauri::command]
fn db_get_document_by_hash(sha256_hash: String, state: State<'_, AppState>) -> Result<Option<Document>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_document_by_hash(&sha256_hash)
}

#[tauri::command]
fn db_add_document(doc: Document, state: State<'_, AppState>) -> Result<(), String> {
  // Confine the stored filepath to absolute .pdf paths (PRD §15.3 / RK-11): a
  // compromised webview must not seed the library with arbitrary on-disk paths.
  validate_pdf_filepath_basic(&doc.filepath)?;
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.add_document(doc)
}

#[tauri::command]
fn db_update_document_metadata(doc: Document, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.update_document_metadata(doc)
}

#[tauri::command]
fn db_toggle_favourite(id: String, is_favourite: bool, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.toggle_favourite(&id, is_favourite)
}

#[tauri::command]
fn db_toggle_archive(id: String, is_archived: bool, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.toggle_archive(&id, is_archived)
}

#[tauri::command]
fn db_update_last_opened(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.update_last_opened(&id)
}

#[tauri::command]
fn db_get_collections(state: State<'_, AppState>) -> Result<Vec<CollectionRecord>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_collections()
}

#[tauri::command]
fn db_add_collection(collection: CollectionRecord, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.add_collection(collection)
}

#[tauri::command]
fn db_rename_collection(id: String, name: String, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.rename_collection(&id, &name)
}

#[tauri::command]
fn db_delete_collection(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.delete_collection(&id)
}

#[tauri::command]
fn db_update_document_filepath(
  id: String,
  new_filepath: String,
  new_hash: Option<String>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  // Validate and canonicalize the relocated path (PRD §15.3 / RK-11).
  let canonical = validate_pdf_path_for_record(&new_filepath)?;
  let canonical_str = canonical.to_string_lossy().to_string();

  // Recompute the hash from the file itself so a compromised webview cannot
  // poison the dedup table with a fabricated `new_hash`. The webview-supplied
  // hash is only used as a fallback if the file can no longer be read.
  let recomputed = compute_file_metadata(&canonical_str)
    .ok()
    .filter(|m| m.exists)
    .map(|m| m.sha256_hash);
  let final_hash = recomputed.or(new_hash);

  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.update_document_filepath(&id, &canonical_str, final_hash.as_deref())
}

#[tauri::command]
fn db_delete_document(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.delete_document(&id)
}

#[tauri::command]
fn db_get_pages(document_id: String, state: State<'_, AppState>) -> Result<Vec<Page>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_pages(&document_id)
}

#[tauri::command]
fn db_add_job(job: Job, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.add_job(job)
}

#[tauri::command]
fn db_get_jobs(state: State<'_, AppState>) -> Result<Vec<Job>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_jobs()
}

#[tauri::command]
fn db_update_job(id: String, status: String, error: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.update_job(&id, &status, error)
}

#[tauri::command]
fn db_get_settings(state: State<'_, AppState>) -> Result<Vec<Setting>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_settings()
}

#[tauri::command]
fn db_update_settings(key: String, value: String, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.update_setting(&key, &value)
}

#[tauri::command]
fn db_save_settings(key: String, value: String, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.update_setting(&key, &value)
}

#[tauri::command]
fn db_rebuild_index(state: State<'_, AppState>) -> Result<usize, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.rebuild_fts_index()
}

#[tauri::command]
fn cmd_get_initial_launch_route() -> SingleInstanceRoute {
  let args: Vec<String> = std::env::args().collect();
  route_launch_args(&args)
}

#[tauri::command]
fn import_compute_file_metadata(
  app_handle: tauri::AppHandle,
  filepath: String,
) -> Result<FileMetadata, String> {
  // Confine the inspected path to an external .pdf file (PRD §15.3 / RK-11):
  // a compromised webview must not be able to hash or probe arbitrary files.
  let app_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;
  let safe_path = ensure_external_pdf_source(&app_dir, &filepath)?;
  compute_file_metadata(&safe_path)
}

#[tauri::command]
fn import_copy_to_managed_library(app_handle: tauri::AppHandle, source_path: String) -> Result<String, String> {
  let app_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;
  // Validate + canonicalize the source and ensure it is not already inside the
  // managed documents directory (PRD §15.3 / RK-11).
  let safe_path = ensure_external_pdf_source(&app_dir, &source_path)?;
  copy_to_managed_documents(&app_dir, &safe_path)
}

#[tauri::command]
fn db_save_reading_session(session: ReadingSession, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.save_reading_session(&session)
}

#[tauri::command]
fn db_get_reading_session(document_id: String, state: State<'_, AppState>) -> Result<Option<ReadingSession>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_reading_session(&document_id)
}

// Task 3.1 typed annotation persistence (PRD R2). These are the only routes
// by which the webview reaches the annotations tables — SQL never crosses IPC
// (PRD §15.3). The feature UI (selection popover, area capture, trash) lands
// with tasks 3.4/3.5; the persistence contract is in place and tested here.
#[tauri::command]
fn db_add_annotation(annotation: Annotation, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.add_annotation(&annotation)
}

#[tauri::command]
fn db_get_annotation(id: String, state: State<'_, AppState>) -> Result<Option<Annotation>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_annotation_by_id(&id)
}

#[tauri::command]
fn db_get_annotations_for_document(
  document_id: String,
  include_trashed: bool,
  state: State<'_, AppState>,
) -> Result<Vec<Annotation>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_annotations_for_document(&document_id, include_trashed)
}

#[tauri::command]
fn db_update_annotation_fields(
  id: String,
  color: String,
  comment: String,
  tags: Vec<String>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.update_annotation_fields(&id, &color, &comment, &tags)
}

#[tauri::command]
fn db_trash_annotation(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.trash_annotation(&id)
}

#[tauri::command]
fn db_restore_annotation(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.restore_annotation(&id)
}

#[tauri::command]
fn db_purge_annotation(
  app_handle: tauri::AppHandle,
  id: String,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.purge_annotation(&app_dir, &id)
}

#[tauri::command]
fn db_add_annotation_asset(
  app_handle: tauri::AppHandle,
  asset: AnnotationAsset,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.add_annotation_asset(&app_dir, &asset)
}

#[tauri::command]
fn db_get_annotation_assets(
  annotation_id: String,
  state: State<'_, AppState>,
) -> Result<Vec<AnnotationAsset>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_annotation_assets(&annotation_id)
}

#[tauri::command]
fn db_delete_annotation_asset(
  app_handle: tauri::AppHandle,
  id: String,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.delete_annotation_asset(&app_dir, &id)
}

// FR-9.7 atomic area-capture creation (task 3.4): the webview sends the crop
// bytes plus the annotation and asset records in ONE call. The Rust side
// writes the file and inserts both rows, rolling back on any failure so no
// orphaned bitmap or row-without-bitmap can survive. This replaces the former
// three-call sequence (write file → insert annotation → insert asset) whose
// gaps a process termination could leave half-finished, and eliminates the
// caller-supplied-path cleanup command (PRD §15.3: no caller-supplied paths).
#[tauri::command]
fn db_create_area_capture(
  app_handle: tauri::AppHandle,
  annotation: Annotation,
  asset: AnnotationAsset,
  bytes: Vec<u8>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.create_area_capture(&app_dir, &annotation, &asset, &bytes)
}

// Task 3.4 asset file read transport (FR-9.7): the webview reads bytes back
// through the typed asset row. The read resolves the path server-side from the
// row id, so this cannot be used as an arbitrary-file oracle.
#[tauri::command]
fn db_read_annotation_asset_file(
  app_handle: tauri::AppHandle,
  asset_id: String,
  state: State<'_, AppState>,
) -> Result<tauri::ipc::Response, String> {
  let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  let bytes = db.read_asset_file(&app_dir, &asset_id)?;
  Ok(tauri::ipc::Response::new(bytes))
}

// Task 3.3 document fingerprinting and version handling (FR-7.3, RK-2). The
// open-time flow is: check_document_version_state → (on "changed") offer
// re-anchoring → register_document_version + update_version_geometry once the
// user decides → reanchor_annotation_to_version for quote-matched annotations.
// Fingerprints and page counts are always recomputed server-side from the file.
#[tauri::command]
fn db_check_document_version_state(
  document_id: String,
  state: State<'_, AppState>,
) -> Result<VersionCheckResult, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.check_document_version_state(&document_id)
}

#[tauri::command]
fn db_register_document_version(
  document_id: String,
  state: State<'_, AppState>,
) -> Result<DocumentVersion, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.register_document_version(&document_id)
}

#[tauri::command]
fn db_update_version_geometry(
  version_id: String,
  geometry: Vec<PageGeometry>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.update_version_geometry(&version_id, &geometry)
}

#[tauri::command]
fn db_get_document_versions(
  document_id: String,
  state: State<'_, AppState>,
) -> Result<Vec<DocumentVersion>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_document_versions(&document_id)
}

#[tauri::command]
fn db_reanchor_annotation_to_version(
  annotation_id: String,
  new_version_id: String,
  new_checksum: String,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.reanchor_annotation_to_version(&annotation_id, &new_version_id, &new_checksum)
}

#[tauri::command]
fn verify_document_file_exists(document_id: String, state: State<'_, AppState>) -> Result<bool, String> {
  // Resolve the filepath server-side from the document id rather than accepting
  // a caller-supplied path (PRD §15.3 / RK-11): this cannot be used as an
  // arbitrary filesystem-existence oracle.
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  let doc = db
    .get_document_by_id(&document_id)?
    .ok_or("Document not found")?;
  Ok(Path::new(&doc.filepath).exists())
}

#[tauri::command]
fn db_get_pdf_bytes(filepath: String) -> Result<tauri::ipc::Response, String> {
  validate_pdf_filepath_basic(&filepath)?;
  let p = Path::new(&filepath);
  if !p.exists() {
    return Err(format!("File not found: {filepath}"));
  }
  // Returned as a raw binary IPC payload (application/octet-stream), which the
  // webview receives as an ArrayBuffer. Returning Vec<u8> directly would take
  // the JSON path and serialize every byte as a number — several times the
  // file size in JSON text and the dominant cost of opening a large PDF.
  let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
  Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn db_add_note(note: Note, state: State<'_, AppState>) -> Result<Note, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.add_note(&note)
}

#[tauri::command]
fn db_get_note(id: String, state: State<'_, AppState>) -> Result<Option<Note>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_note(&id)
}

#[tauri::command]
fn db_list_notes(
  include_trash: Option<bool>,
  note_type: Option<String>,
  document_id: Option<String>,
  state: State<'_, AppState>,
) -> Result<Vec<Note>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.list_notes(
    include_trash.unwrap_or(false),
    note_type.as_deref(),
    document_id.as_deref(),
  )
}

#[tauri::command]
fn db_update_note(
  id: String,
  title: String,
  body_markdown: String,
  create_revision: Option<bool>,
  state: State<'_, AppState>,
) -> Result<Note, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.update_note(&id, &title, &body_markdown, create_revision.unwrap_or(true))
}

#[tauri::command]
fn db_trash_note(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.trash_note(&id)
}

#[tauri::command]
fn db_restore_note(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.restore_note(&id)
}

#[tauri::command]
fn db_purge_note(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.purge_note(&id)
}

#[tauri::command]
fn db_get_note_revisions(note_id: String, state: State<'_, AppState>) -> Result<Vec<NoteRevision>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_note_revisions(&note_id)
}

#[tauri::command]
fn db_restore_note_revision(
  note_id: String,
  revision_number: i64,
  state: State<'_, AppState>,
) -> Result<Note, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.restore_note_revision(&note_id, revision_number)
}

#[tauri::command]
fn db_promote_scratch_note(
  id: String,
  target_type: String,
  document_id: Option<String>,
  state: State<'_, AppState>,
) -> Result<Note, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.promote_scratch_note(&id, &target_type, document_id.as_deref())
}

#[tauri::command]
fn db_add_evidence_block(
  block: EvidenceBlock,
  state: State<'_, AppState>,
) -> Result<EvidenceBlock, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.add_evidence_block(&block)
}

#[tauri::command]
fn db_get_note_evidence_blocks(
  note_id: String,
  state: State<'_, AppState>,
) -> Result<Vec<EvidenceBlock>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_note_evidence_blocks(&note_id)
}

#[tauri::command]
fn db_update_evidence_block_order(
  note_id: String,
  block_ids: Vec<String>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.update_evidence_block_order(&note_id, &block_ids)
}

#[tauri::command]
fn db_update_evidence_block_comment(
  id: String,
  user_comment: String,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.update_evidence_block_comment(&id, &user_comment)
}

#[tauri::command]
fn db_delete_evidence_block(
  id: String,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.delete_evidence_block(&id)
}

#[tauri::command]
fn db_add_note_link(
  link: NoteLink,
  state: State<'_, AppState>,
) -> Result<NoteLink, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.add_note_link(&link)
}

#[tauri::command]
fn db_get_forward_links(
  note_id: String,
  state: State<'_, AppState>,
) -> Result<Vec<NoteLink>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_forward_links(&note_id)
}

#[tauri::command]
fn db_get_note_backlinks(
  target_note_id: String,
  state: State<'_, AppState>,
) -> Result<Vec<BacklinkRecord>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.get_note_backlinks(&target_note_id)
}

#[tauri::command]
fn db_sync_note_links(
  note_id: String,
  target_note_ids: Vec<String>,
  target_doc_ids: Vec<String>,
  target_ann_ids: Vec<String>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.sync_note_links(&note_id, &target_note_ids, &target_doc_ids, &target_ann_ids)
}

#[tauri::command]
fn db_delete_note_link(
  id: String,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.delete_note_link(&id)
}

#[tauri::command]
fn db_search_notes(
  query: String,
  note_type: Option<String>,
  state: State<'_, AppState>,
) -> Result<Vec<NoteSearchResult>, String> {
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.search_notes(&query, note_type.as_deref())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(AppState {
      db: Mutex::new(None),
    })
    .invoke_handler(tauri::generate_handler![
      db_init,
      db_get_documents,
      db_get_document_by_hash,
      db_add_document,
      db_update_document_metadata,
      db_toggle_favourite,
      db_toggle_archive,
      db_update_last_opened,
      db_get_collections,
      db_add_collection,
      db_rename_collection,
      db_delete_collection,
      db_update_document_filepath,
      db_delete_document,
      db_get_pages,
      db_add_job,
      db_get_jobs,
      db_update_job,
      db_get_settings,
      db_update_settings,
      db_save_settings,
      db_rebuild_index,
      db_save_reading_session,
      db_get_reading_session,
      db_add_annotation,
      db_get_annotation,
      db_get_annotations_for_document,
      db_update_annotation_fields,
      db_trash_annotation,
      db_restore_annotation,
      db_purge_annotation,
      db_add_annotation_asset,
      db_get_annotation_assets,
      db_delete_annotation_asset,
      db_create_area_capture,
      db_read_annotation_asset_file,
      db_check_document_version_state,
      db_register_document_version,
      db_update_version_geometry,
      db_get_document_versions,
      db_reanchor_annotation_to_version,
      db_add_note,
      db_get_note,
      db_list_notes,
      db_update_note,
      db_trash_note,
      db_restore_note,
      db_purge_note,
      db_get_note_revisions,
      db_restore_note_revision,
      db_promote_scratch_note,
      db_add_evidence_block,
      db_get_note_evidence_blocks,
      db_update_evidence_block_order,
      db_update_evidence_block_comment,
      db_delete_evidence_block,
      db_add_note_link,
      db_get_forward_links,
      db_get_note_backlinks,
      db_sync_note_links,
      db_delete_note_link,
      db_search_notes,
      cmd_get_initial_launch_route,
      import_compute_file_metadata,
      import_copy_to_managed_library,
      verify_document_file_exists,
      db_get_pdf_bytes,
      #[cfg(debug_assertions)]
      perf::perf_rss_snapshot,
      #[cfg(debug_assertions)]
      perf::perf_write_report,
    ]);

  // OQ-18 (single-instance window): enforce one application instance and route
  // launch arguments — e.g. "Open with" from the OS, or a second invocation —
  // to the existing window instead of spawning a second process. The resolved
  // document path is emitted to the frontend on the `launch-route` event so the
  // reader can load it in a new tab. This wires the R0.6 single-instance routing
  // that previously existed only as untested Rust logic.
  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      let route = route_launch_args(&argv);
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("launch-route", route.clone());
      }
    }));
  }

  builder
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
