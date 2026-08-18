pub mod db;
pub mod import;
pub mod launch;
#[cfg(debug_assertions)]
pub mod perf;

use db::{CollectionRecord, Database, Document, Job, Page, ReadingSession, Setting};
use db::annotations::{Annotation, AnnotationAsset};
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
