pub mod db;
pub mod import;
pub mod launch;

use db::{CollectionRecord, Database, Document, Job, Page, ReadingSession, Setting};
use import::{compute_file_metadata, copy_to_managed_documents, FileMetadata};
use launch::{normalize_and_validate_launch_path, route_launch_args, LaunchValidationResult, SingleInstanceRoute};
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
  let lock = state.db.lock().unwrap();
  let db = lock.as_ref().ok_or("Database not initialized")?;
  db.update_document_filepath(&id, &new_filepath, new_hash.as_deref())
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
fn cmd_normalize_and_validate_launch_path(input_path: String) -> LaunchValidationResult {
  normalize_and_validate_launch_path(&input_path)
}

#[tauri::command]
fn cmd_get_initial_launch_route() -> SingleInstanceRoute {
  let args: Vec<String> = std::env::args().collect();
  route_launch_args(&args)
}

#[tauri::command]
fn import_compute_file_metadata(filepath: String) -> Result<FileMetadata, String> {
  compute_file_metadata(&filepath)
}

#[tauri::command]
fn import_copy_to_managed_library(app_handle: tauri::AppHandle, source_path: String) -> Result<String, String> {
  let app_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;
  copy_to_managed_documents(&app_dir, &source_path)
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

#[tauri::command]
fn check_file_exists(filepath: String) -> bool {
  Path::new(&filepath).exists()
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
      cmd_normalize_and_validate_launch_path,
      cmd_get_initial_launch_route,
      import_compute_file_metadata,
      import_copy_to_managed_library,
      check_file_exists,
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
