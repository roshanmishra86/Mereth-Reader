pub mod annotations;
pub mod migrations;

use migrations::run_migrations;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// A document record persisted in the `documents` table.
///
/// These structs are the typed boundary between the Rust persistence layer
/// and the Tauri IPC commands in `lib.rs`: they must implement `Serialize`
/// (to return rows to the webview) and `Deserialize` (to accept IPC args).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
  pub id: String,
  pub title: String,
  pub filepath: String,
  pub sha256_hash: String,
  pub page_count: i64,
  pub created_at: String,
  pub updated_at: String,
  pub provenance: String,
  #[serde(default)]
  pub author: Option<String>,
  #[serde(default)]
  pub subject: Option<String>,
  #[serde(default)]
  pub keywords: Option<String>,
  #[serde(default)]
  pub creation_date: Option<String>,
  #[serde(default)]
  pub doi: Option<String>,
  #[serde(default)]
  pub isbn: Option<String>,
  #[serde(default)]
  pub is_favourite: bool,
  #[serde(default)]
  pub is_archived: bool,
  #[serde(default)]
  pub last_opened_at: Option<String>,
  #[serde(default)]
  pub tags: Vec<String>,
  #[serde(default)]
  pub collections: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionRecord {
  pub id: String,
  pub name: String,
  #[serde(default)]
  pub description: Option<String>,
  pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
  pub id: String,
  pub document_id: String,
  pub page_number: i32,
  pub width: f64,
  pub height: f64,
  pub text_content: String,
  pub created_at: String,
  pub provenance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
  pub id: String,
  pub job_type: String,
  pub status: String,
  pub payload: String,
  pub error: Option<String>,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
  pub key: String,
  pub value: String,
  pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReadingSession {
  pub document_id: String,
  pub current_page: i32,
  pub zoom_mode: String,
  pub zoom_scale: f64,
  pub scroll_top_px: f64,
  pub left_pane_open: bool,
  pub left_pane_width_px: f64,
  pub right_pane_open: bool,
  pub right_pane_width_px: f64,
  pub view_mode: String,
  pub rotation: i32,
  pub updated_at: String,
}

pub struct Database {
  conn: Arc<Mutex<Connection>>,
  #[allow(dead_code)]
  app_dir: PathBuf,
}

const DOCUMENT_SELECT_COLS: &str = "id, title, filepath, sha256_hash, page_count, created_at, updated_at, provenance, is_favourite, is_archived, last_opened_at, tags, collections, author, subject, keywords, creation_date, doi, isbn";

fn map_row_to_document(row: &rusqlite::Row<'_>) -> rusqlite::Result<Document> {
  let is_fav_int: i32 = row.get(8).unwrap_or(0);
  let is_arch_int: i32 = row.get(9).unwrap_or(0);
  let tags_json: String = row.get(11).unwrap_or_else(|_| "[]".into());
  let collections_json: String = row.get(12).unwrap_or_else(|_| "[]".into());

  Ok(Document {
    id: row.get(0)?,
    title: row.get(1)?,
    filepath: row.get(2)?,
    sha256_hash: row.get(3)?,
    page_count: row.get(4)?,
    created_at: row.get(5)?,
    updated_at: row.get(6)?,
    provenance: row.get(7)?,
    is_favourite: is_fav_int != 0,
    is_archived: is_arch_int != 0,
    last_opened_at: row.get(10)?,
    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
    collections: serde_json::from_str(&collections_json).unwrap_or_default(),
    author: row.get(13)?,
    subject: row.get(14)?,
    keywords: row.get(15)?,
    creation_date: row.get(16)?,
    doi: row.get(17)?,
    isbn: row.get(18)?,
  })
}

/// Moves a legacy `app-data/mereth_reader.db` (and any `-wal`/`-shm`
/// sidecars) into `app-data/db/` per the PRD §15.4 layout. No-op when the new
/// path already exists or no legacy file is present. The move happens before
/// the connection opens so SQLite never sees a partially relocated database.
fn relocate_legacy_database(app_dir: &Path, new_db_path: &Path) -> Result<(), String> {
  if new_db_path.exists() {
    return Ok(());
  }
  let legacy = app_dir.join("mereth_reader.db");
  if !legacy.exists() {
    return Ok(());
  }
  let db_dir = new_db_path
    .parent()
    .ok_or("Invalid database directory")?;
  fs::create_dir_all(db_dir).map_err(|e| e.to_string())?;
  fs::rename(&legacy, new_db_path)
    .map_err(|e| format!("Failed to relocate legacy database: {e}"))?;
  for suffix in ["-wal", "-shm"] {
    let legacy_side = app_dir.join(format!("mereth_reader.db{suffix}"));
    if legacy_side.exists() {
      let new_side = db_dir.join(format!("mereth_reader.db{suffix}"));
      let _ = fs::rename(&legacy_side, &new_side);
    }
  }
  Ok(())
}

impl Database {
  pub fn new(app_dir: &Path) -> Result<Self, String> {
    fs::create_dir_all(app_dir).map_err(|e| e.to_string())?;
    let db_dir = app_dir.join("db");
    fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    let db_path = db_dir.join("mereth_reader.db");

    // PRD §15.4 places the database under `app-data/db/`. Very early builds
    // (R0.3 era) stored it at `app-data/mereth_reader.db`; relocate such a
    // legacy file (and any WAL sidecars) so existing profiles are preserved
    // and every file stays under the documented layout (task 3.1).
    relocate_legacy_database(app_dir, &db_path)?;

    // Detect whether the database file already existed BEFORE we open/create it.
    let db_existed = db_path.exists();
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    run_migrations(&mut conn, &db_dir, db_existed).map_err(|e| e.to_string())?;

    Ok(Database {
      conn: Arc::new(Mutex::new(conn)),
      app_dir: app_dir.to_path_buf(),
    })
  }

  pub fn in_memory() -> Result<Self, String> {
    let mut conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    let temp_dir = tempfile::tempdir().map_err(|e| e.to_string())?;

    run_migrations(&mut conn, temp_dir.path(), false).map_err(|e| e.to_string())?;

    Ok(Database {
      conn: Arc::new(Mutex::new(conn)),
      app_dir: temp_dir.path().to_path_buf(),
    })
  }

  pub fn get_documents(&self) -> Result<Vec<Document>, String> {
    let conn = self.conn.lock().unwrap();
    let query = format!("SELECT {} FROM documents", DOCUMENT_SELECT_COLS);
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let docs = stmt
      .query_map([], map_row_to_document)
      .map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();

    Ok(docs)
  }

  pub fn add_document(&self, doc: Document) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    let tags_json = serde_json::to_string(&doc.tags).unwrap_or_else(|_| "[]".into());
    let collections_json = serde_json::to_string(&doc.collections).unwrap_or_else(|_| "[]".into());

    conn
      .execute(
        "INSERT INTO documents (
          id, title, filepath, sha256_hash, page_count, created_at, updated_at, provenance,
          author, subject, keywords, creation_date, doi, isbn, is_favourite, is_archived,
          last_opened_at, tags, collections
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        params![
          doc.id,
          doc.title,
          doc.filepath,
          doc.sha256_hash,
          doc.page_count,
          doc.created_at,
          doc.updated_at,
          doc.provenance,
          doc.author,
          doc.subject,
          doc.keywords,
          doc.creation_date,
          doc.doi,
          doc.isbn,
          if doc.is_favourite { 1 } else { 0 },
          if doc.is_archived { 1 } else { 0 },
          doc.last_opened_at,
          tags_json,
          collections_json,
        ],
      )
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn get_document_by_hash(&self, sha256_hash: &str) -> Result<Option<Document>, String> {
    let conn = self.conn.lock().unwrap();
    let query = format!("SELECT {} FROM documents WHERE sha256_hash = ?1 LIMIT 1", DOCUMENT_SELECT_COLS);
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let mut rows = stmt
      .query_map(params![sha256_hash], map_row_to_document)
      .map_err(|e| e.to_string())?;

    if let Some(row_res) = rows.next() {
      let doc = row_res.map_err(|e| e.to_string())?;
      Ok(Some(doc))
    } else {
      Ok(None)
    }
  }

  pub fn get_document_by_id(&self, id: &str) -> Result<Option<Document>, String> {
    let conn = self.conn.lock().unwrap();
    let query = format!("SELECT {} FROM documents WHERE id = ?1 LIMIT 1", DOCUMENT_SELECT_COLS);
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let mut rows = stmt
      .query_map(params![id], map_row_to_document)
      .map_err(|e| e.to_string())?;

    if let Some(row_res) = rows.next() {
      let doc = row_res.map_err(|e| e.to_string())?;
      Ok(Some(doc))
    } else {
      Ok(None)
    }
  }

  pub fn update_document_metadata(&self, doc: Document) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    let tags_json = serde_json::to_string(&doc.tags).unwrap_or_else(|_| "[]".into());
    let collections_json = serde_json::to_string(&doc.collections).unwrap_or_else(|_| "[]".into());

    conn.execute(
      "UPDATE documents SET
        title = ?1,
        author = ?2,
        subject = ?3,
        keywords = ?4,
        creation_date = ?5,
        doi = ?6,
        isbn = ?7,
        is_favourite = ?8,
        is_archived = ?9,
        tags = ?10,
        collections = ?11,
        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?12",
      params![
        doc.title,
        doc.author,
        doc.subject,
        doc.keywords,
        doc.creation_date,
        doc.doi,
        doc.isbn,
        if doc.is_favourite { 1 } else { 0 },
        if doc.is_archived { 1 } else { 0 },
        tags_json,
        collections_json,
        doc.id,
      ],
    ).map_err(|e| e.to_string())?;

    Ok(())
  }

  pub fn toggle_favourite(&self, id: &str, is_favourite: bool) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE documents SET is_favourite = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?2",
      params![if is_favourite { 1 } else { 0 }, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn toggle_archive(&self, id: &str, is_archived: bool) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE documents SET is_archived = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?2",
      params![if is_archived { 1 } else { 0 }, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn update_last_opened(&self, id: &str) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE documents SET last_opened_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?1",
      params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn get_collections(&self) -> Result<Vec<CollectionRecord>, String> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn
      .prepare("SELECT id, name, description, created_at FROM collections ORDER BY name ASC")
      .map_err(|e| e.to_string())?;

    let collections = stmt
      .query_map([], |row| {
        Ok(CollectionRecord {
          id: row.get(0)?,
          name: row.get(1)?,
          description: row.get(2)?,
          created_at: row.get(3)?,
        })
      })
      .map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();

    Ok(collections)
  }

  pub fn add_collection(&self, collection: CollectionRecord) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO collections (id, name, description, created_at) VALUES (?1, ?2, ?3, ?4)",
      params![collection.id, collection.name, collection.description, collection.created_at],
    ).map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn rename_collection(&self, id: &str, new_name: &str) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE collections SET name = ?1 WHERE id = ?2",
      params![new_name, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn delete_collection(&self, id: &str) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM collections WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn update_document_filepath(
    &self,
    id: &str,
    new_filepath: &str,
    new_hash: Option<&str>,
  ) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    if let Some(hash) = new_hash {
      conn.execute(
        "UPDATE documents SET filepath = ?1, sha256_hash = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?3",
        params![new_filepath, hash, id],
      )
      .map_err(|e| e.to_string())?;
    } else {
      conn.execute(
        "UPDATE documents SET filepath = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?2",
        params![new_filepath, id],
      )
      .map_err(|e| e.to_string())?;
    }
    Ok(())
  }

  pub fn delete_document(&self, id: &str) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    let rows_affected = conn
      .execute("DELETE FROM documents WHERE id = ?1", params![id])
      .map_err(|e| e.to_string())?;
    if rows_affected == 0 {
      return Err(format!("Document not found: {}", id));
    }
    Ok(())
  }


  pub fn get_pages(&self, document_id: &str) -> Result<Vec<Page>, String> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn
      .prepare(
        "SELECT id, document_id, page_number, width, height, text_content, created_at, provenance
         FROM pages WHERE document_id = ?1 ORDER BY page_number ASC",
      )
      .map_err(|e| e.to_string())?;

    let pages = stmt
      .query_map(params![document_id], |row| {
        Ok(Page {
          id: row.get(0)?,
          document_id: row.get(1)?,
          page_number: row.get(2)?,
          width: row.get(3)?,
          height: row.get(4)?,
          text_content: row.get(5)?,
          created_at: row.get(6)?,
          provenance: row.get(7)?,
        })
      })
      .map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();

    Ok(pages)
  }

  pub fn add_page(&self, page: Page) -> Result<(), String> {
    let mut conn = self.conn.lock().unwrap();
    // Insert the page row and its FTS index entry atomically: a failure between
    // the two would otherwise leave search silently missing the page until a
    // full index rebuild is triggered.
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
      "INSERT INTO pages (id, document_id, page_number, width, height, text_content, created_at, provenance)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
      params![
        page.id,
        page.document_id,
        page.page_number,
        page.width,
        page.height,
        page.text_content,
        page.created_at,
        page.provenance
      ],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
      "INSERT INTO fts_document_text (document_id, page_number, text_content, provenance)
       VALUES (?1, ?2, ?3, ?4)",
      params![page.document_id, page.page_number, page.text_content, page.provenance],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn add_job(&self, job: Job) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    conn
      .execute(
        "INSERT INTO jobs (id, job_type, status, payload, error, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
          job.id,
          job.job_type,
          job.status,
          job.payload,
          job.error,
          job.created_at,
          job.updated_at
        ],
      )
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn get_jobs(&self) -> Result<Vec<Job>, String> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn
      .prepare("SELECT id, job_type, status, payload, error, created_at, updated_at FROM jobs")
      .map_err(|e| e.to_string())?;

    let jobs = stmt
      .query_map([], |row| {
        Ok(Job {
          id: row.get(0)?,
          job_type: row.get(1)?,
          status: row.get(2)?,
          payload: row.get(3)?,
          error: row.get(4)?,
          created_at: row.get(5)?,
          updated_at: row.get(6)?,
        })
      })
      .map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();

    Ok(jobs)
  }

  /// Updates a job's status and error. `updated_at` is sourced from SQLite
  /// (`strftime('%Y-%m-%dT%H:%M:%SZ','now')`) so it always reflects the real
  /// wall clock at write time — never a frozen literal.
  pub fn update_job(&self, id: &str, status: &str, error: Option<String>) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    conn
      .execute(
        "UPDATE jobs SET status = ?1, error = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?3",
        params![status, error, id],
      )
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn get_settings(&self) -> Result<Vec<Setting>, String> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn
      .prepare("SELECT key, value, updated_at FROM settings")
      .map_err(|e| e.to_string())?;

    let settings = stmt
      .query_map([], |row| {
        Ok(Setting {
          key: row.get(0)?,
          value: row.get(1)?,
          updated_at: row.get(2)?,
        })
      })
      .map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();

    Ok(settings)
  }

  /// Upserts a setting. `updated_at` is sourced from SQLite at write time
  /// (`strftime('%Y-%m-%dT%H:%M:%SZ','now')`) — never a frozen literal.
  pub fn update_setting(&self, key: &str, value: &str) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    conn
      .execute(
        "INSERT INTO settings (key, value, updated_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value],
      )
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn rebuild_fts_index(&self) -> Result<usize, String> {
    let mut conn = self.conn.lock().unwrap();
    // Wipe and refill the FTS index inside a single transaction so a mid-rebuild
    // failure rolls back to the pre-rebuild index instead of leaving it empty.
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM fts_document_text", [])
      .map_err(|e| e.to_string())?;

    let count: usize = tx
      .execute(
        "INSERT INTO fts_document_text (document_id, page_number, text_content, provenance)
         SELECT document_id, page_number, text_content, provenance FROM pages",
        [],
      )
      .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(count)
  }

  pub fn search_fts(&self, query: &str) -> Result<Vec<(String, i32, String)>, String> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn
      .prepare(
        "SELECT document_id, page_number, text_content
         FROM fts_document_text WHERE fts_document_text MATCH ?1",
      )
      .map_err(|e| e.to_string())?;

    let results = stmt
      .query_map(params![query], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
      })
      .map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();

    Ok(results)
  }

  pub fn save_reading_session(&self, session: &ReadingSession) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    let left_open_int = if session.left_pane_open { 1 } else { 0 };
    let right_open_int = if session.right_pane_open { 1 } else { 0 };

    conn
      .execute(
        "INSERT INTO reading_sessions (
          document_id, current_page, zoom_mode, zoom_scale, scroll_top_px,
          left_pane_open, left_pane_width_px, right_pane_open, right_pane_width_px,
          view_mode, rotation, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        ON CONFLICT(document_id) DO UPDATE SET
          current_page = excluded.current_page,
          zoom_mode = excluded.zoom_mode,
          zoom_scale = excluded.zoom_scale,
          scroll_top_px = excluded.scroll_top_px,
          left_pane_open = excluded.left_pane_open,
          left_pane_width_px = excluded.left_pane_width_px,
          right_pane_open = excluded.right_pane_open,
          right_pane_width_px = excluded.right_pane_width_px,
          view_mode = excluded.view_mode,
          rotation = excluded.rotation,
          updated_at = excluded.updated_at",
        params![
          session.document_id,
          session.current_page,
          session.zoom_mode,
          session.zoom_scale,
          session.scroll_top_px,
          left_open_int,
          session.left_pane_width_px,
          right_open_int,
          session.right_pane_width_px,
          session.view_mode,
          session.rotation,
          session.updated_at,
        ],
      )
      .map_err(|e| e.to_string())?;

    Ok(())
  }

  pub fn get_reading_session(&self, document_id: &str) -> Result<Option<ReadingSession>, String> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn
      .prepare(
        "SELECT document_id, current_page, zoom_mode, zoom_scale, scroll_top_px,
                left_pane_open, left_pane_width_px, right_pane_open, right_pane_width_px,
                view_mode, rotation, updated_at
         FROM reading_sessions WHERE document_id = ?1 LIMIT 1",
      )
      .map_err(|e| e.to_string())?;

    let mut rows = stmt
      .query_map(params![document_id], |row| {
        let left_open_int: i32 = row.get(5)?;
        let right_open_int: i32 = row.get(7)?;
        Ok(ReadingSession {
          document_id: row.get(0)?,
          current_page: row.get(1)?,
          zoom_mode: row.get(2)?,
          zoom_scale: row.get(3)?,
          scroll_top_px: row.get(4)?,
          left_pane_open: left_open_int != 0,
          left_pane_width_px: row.get(6)?,
          right_pane_open: right_open_int != 0,
          right_pane_width_px: row.get(8)?,
          view_mode: row.get(9)?,
          rotation: row.get(10)?,
          updated_at: row.get(11)?,
        })
      })
      .map_err(|e| e.to_string())?;

    if let Some(row_res) = rows.next() {
      let session = row_res.map_err(|e| e.to_string())?;
      Ok(Some(session))
    } else {
      Ok(None)
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use rusqlite::Connection;
  use tempfile::tempdir;
  use uuid::Uuid;

  #[test]
  fn test_wal_mode_and_fts5_support() {
    let db = Database::in_memory().unwrap();
    let conn = db.conn.lock().unwrap();

    let journal_mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
    // In-memory databases use memory journal mode, but schema checks pass
    assert!(!journal_mode.is_empty());

    // Verify fts5 virtual table exists
    let fts_check: i32 = conn
      .query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='fts_document_text'",
        [],
        |r| r.get(0),
      )
      .unwrap();
    assert_eq!(fts_check, 1);
  }

  #[test]
  fn test_provenance_constraint_enforcement() {
    let db = Database::in_memory().unwrap();

    // Valid provenance should succeed
    let valid_doc = Document {
      id: Uuid::new_v4().to_string(),
      title: "Test Legal Doc".into(),
      filepath: "/path/to/doc.pdf".into(),
      sha256_hash: "a".repeat(64),
      page_count: 5,
      created_at: "2026-08-04T13:52:57Z".into(),
      updated_at: "2026-08-04T13:52:57Z".into(),
      provenance: "source_extracted".into(),
      author: None,
      subject: None,
      keywords: None,
      creation_date: None,
      doi: None,
      isbn: None,
      is_favourite: false,
      is_archived: false,
      last_opened_at: None,
      tags: vec![],
      collections: vec![],
    };
    assert!(db.add_document(valid_doc).is_ok());

    // Invalid provenance should fail CHECK constraint
    let invalid_doc = Document {
      id: Uuid::new_v4().to_string(),
      title: "Bad Doc".into(),
      filepath: "/path/to/bad.pdf".into(),
      sha256_hash: "b".repeat(64),
      page_count: 1,
      created_at: "2026-08-04T13:52:57Z".into(),
      updated_at: "2026-08-04T13:52:57Z".into(),
      provenance: "unauthorized_origin".into(),
      author: None,
      subject: None,
      keywords: None,
      creation_date: None,
      doi: None,
      isbn: None,
      is_favourite: false,
      is_archived: false,
      last_opened_at: None,
      tags: vec![],
      collections: vec![],
    };
    assert!(db.add_document(invalid_doc).is_err());
  }

  #[test]
  fn test_fts5_indexing_and_rebuild() {
    let db = Database::in_memory().unwrap();

    let doc_id = Uuid::new_v4().to_string();

    // A page references documents(id) via a foreign key, so the parent document
    // must exist before the page is inserted (foreign-key enforcement is on).
    let doc = Document {
      id: doc_id.clone(),
      title: "FTS Test Document".into(),
      filepath: "/tmp/fts-test.pdf".into(),
      sha256_hash: "deadbeef".into(),
      page_count: 1,
      created_at: "2026-08-04T13:52:57Z".into(),
      updated_at: "2026-08-04T13:52:57Z".into(),
      provenance: "source_extracted".into(),
      author: None,
      subject: None,
      keywords: None,
      creation_date: None,
      doi: None,
      isbn: None,
      is_favourite: false,
      is_archived: false,
      last_opened_at: None,
      tags: vec![],
      collections: vec![],
    };
    db.add_document(doc).unwrap();

    let page = Page {
      id: Uuid::new_v4().to_string(),
      document_id: doc_id.clone(),
      page_number: 1,
      width: 612.0,
      height: 792.0,
      text_content: "Plaintiffs motion for summary judgment regarding breach of contract".into(),
      created_at: "2026-08-04T13:52:57Z".into(),
      provenance: "source_extracted".into(),
    };

    db.add_page(page.clone()).unwrap();

    // Search FTS5
    let results = db.search_fts("summary").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].0, doc_id);

    // Rebuild index
    let count = db.rebuild_fts_index().unwrap();
    assert_eq!(count, 1);

    // Verify search still works after rebuild
    let results_after = db.search_fts("breach").unwrap();
    assert_eq!(results_after.len(), 1);
  }

  #[test]
  fn test_no_backup_when_no_migration_needed() {
    // Regression for the audit finding "the .bak backup is overwritten on every
    // open, not just before a migration." Re-opening a database that is already
    // at the current migration version must NOT create or overwrite the backup.
    let dir = tempdir().unwrap();
    // Task 3.1 relocated the database into app-data/db/ (PRD §15.4).
    let db_path = dir.path().join("db").join("mereth_reader.db");
    let backup_path = dir.path().join("db").join("mereth_reader.db.bak");

    // First creation: brand-new database, nothing to back up.
    {
      let _db = Database::new(dir.path()).unwrap();
      assert!(db_path.exists());
    }
    assert!(!backup_path.exists());

    // Re-open at the current version: no migration runs, so no backup.
    {
      let _db2 = Database::new(dir.path()).unwrap();
    }
    assert!(
      !backup_path.exists(),
      "backup must not be created on a plain re-open"
    );
  }

  #[test]
  fn test_backup_created_before_migration_of_existing_db() {
    // A backup IS expected — but only when a migration actually runs against an
    // existing database. Simulate a pre-migration database by dropping the
    // migration metadata and all schema tables, then re-open so migration 1
    // re-runs against the existing file.
    let dir = tempdir().unwrap();
    // Task 3.1 relocated the database into app-data/db/ (PRD §15.4).
    let db_path = dir.path().join("db").join("mereth_reader.db");
    let backup_path = dir.path().join("db").join("mereth_reader.db.bak");

    // Create a valid current-version database first.
    {
      let _db = Database::new(dir.path()).unwrap();
    }
    assert!(!backup_path.exists());

    // Roll it back to a "version 0" state so the next open re-runs all
    // migrations (1..8). Children are dropped before parents; with no rows in
    // any table order is safe either way, but the FK graph stays intact.
    {
      let conn = Connection::open(&db_path).unwrap();
      for table in [
        "fts_document_text",
        "exports",
        "review_schedule",
        "review_events",
        "review_prompts",
        "evidence_blocks",
        "note_links",
        "note_revisions",
        "notes",
        "annotation_assets",
        "annotations",
        "reading_sessions",
        "pages",
        "document_versions",
        "documents",
        "collections",
        "jobs",
        "settings",
        "migration_metadata",
      ] {
        conn.execute(&format!("DROP TABLE IF EXISTS {table}"), []).unwrap();
      }
    }

    // Re-open: the file already exists and current_version is 0, so a backup of
    // the pre-migration file must be taken before migration 1 runs.
    {
      let _db = Database::new(dir.path()).unwrap();
    }
    assert!(backup_path.exists(), "backup must be created before a migration runs on an existing db");
  }

  #[test]
  fn test_jobs_and_settings_workflow() {
    let db = Database::in_memory().unwrap();

    let job = Job {
      id: "job-1".into(),
      job_type: "ocr_page".into(),
      status: "pending".into(),
      payload: "{\"page\": 1}".into(),
      error: None,
      created_at: "2026-08-04T13:52:57Z".into(),
      updated_at: "2026-08-04T13:52:57Z".into(),
    };
    db.add_job(job).unwrap();

    db.update_job("job-1", "completed", None).unwrap();
    let jobs = db.get_jobs().unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].status, "completed");
    // updated_at must be a real RFC3339-ish timestamp, not the frozen literal.
    assert!(jobs[0].updated_at.ends_with('Z'));
    assert_ne!(jobs[0].updated_at, "2026-08-04T13:52:57Z");

    db.update_setting("theme", "dark").unwrap();
    let settings = db.get_settings().unwrap();
    assert_eq!(settings.len(), 1);
    assert_eq!(settings[0].value, "dark");
    assert!(settings[0].updated_at.ends_with('Z'));
    assert_ne!(settings[0].updated_at, "2026-08-04T13:52:57Z");

    // Upsert path: updating the same key changes the value and timestamp.
    db.update_setting("theme", "light").unwrap();
    let settings_after = db.get_settings().unwrap();
    assert_eq!(settings_after.len(), 1);
    assert_eq!(settings_after[0].value, "light");
  }

  #[test]
  fn test_document_metadata_and_collections() {
    let db = Database::in_memory().unwrap();

    let doc_id = Uuid::new_v4().to_string();
    let mut doc = Document {
      id: doc_id.clone(),
      title: "Sample Legal Article".into(),
      filepath: "/docs/sample.pdf".into(),
      sha256_hash: "c".repeat(64),
      page_count: 10,
      created_at: "2026-08-06T05:39:01Z".into(),
      updated_at: "2026-08-06T05:39:01Z".into(),
      provenance: "source_extracted".into(),
      author: Some("Jane Doe".into()),
      subject: Some("Contract Law".into()),
      keywords: Some("legal, contract, summary".into()),
      creation_date: Some("2026-01-01".into()),
      doi: Some("10.1000/182".into()),
      isbn: Some("978-3-16-148410-0".into()),
      is_favourite: true,
      is_archived: false,
      last_opened_at: None,
      tags: vec!["Law".into(), "Reference".into()],
      collections: vec!["Legal Research".into()],
    };

    db.add_document(doc.clone()).unwrap();

    let fetched = db.get_document_by_id(&doc_id).unwrap().unwrap();
    assert_eq!(fetched.author, Some("Jane Doe".into()));
    assert_eq!(fetched.doi, Some("10.1000/182".into()));
    assert!(fetched.is_favourite);
    assert_eq!(fetched.tags, vec!["Law", "Reference"]);

    // Update metadata
    doc.title = "Updated Legal Title".into();
    doc.author = Some("John Smith".into());
    doc.tags.push("Urgent".into());
    db.update_document_metadata(doc).unwrap();

    let updated = db.get_document_by_id(&doc_id).unwrap().unwrap();
    assert_eq!(updated.title, "Updated Legal Title");
    assert_eq!(updated.author, Some("John Smith".into()));
    assert_eq!(updated.tags, vec!["Law", "Reference", "Urgent"]);

    // Collection record CRUD
    let col_id = Uuid::new_v4().to_string();
    let collection = CollectionRecord {
      id: col_id.clone(),
      name: "Legal Research".into(),
      description: Some("Research papers on contract law".into()),
      created_at: "2026-08-06T05:39:01Z".into(),
    };
    db.add_collection(collection).unwrap();

    let collections = db.get_collections().unwrap();
    assert_eq!(collections.len(), 1);
    assert_eq!(collections[0].name, "Legal Research");

    db.rename_collection(&col_id, "Advanced Legal Research").unwrap();
    let renamed = db.get_collections().unwrap();
    assert_eq!(renamed[0].name, "Advanced Legal Research");

    db.delete_collection(&col_id).unwrap();
    let after_del = db.get_collections().unwrap();
    assert_eq!(after_del.len(), 0);
  }

  #[test]
  fn test_favourite_archive_last_opened() {
    let db = Database::in_memory().unwrap();

    let doc_id = Uuid::new_v4().to_string();
    let doc = Document {
      id: doc_id.clone(),
      title: "Test State Toggle".into(),
      filepath: "/docs/test.pdf".into(),
      sha256_hash: "d".repeat(64),
      page_count: 3,
      created_at: "2026-08-06T05:39:01Z".into(),
      updated_at: "2026-08-06T05:39:01Z".into(),
      provenance: "source_extracted".into(),
      author: None,
      subject: None,
      keywords: None,
      creation_date: None,
      doi: None,
      isbn: None,
      is_favourite: false,
      is_archived: false,
      last_opened_at: None,
      tags: vec![],
      collections: vec![],
    };

    db.add_document(doc).unwrap();

    db.toggle_favourite(&doc_id, true).unwrap();
    let f1 = db.get_document_by_id(&doc_id).unwrap().unwrap();
    assert!(f1.is_favourite);

    db.toggle_archive(&doc_id, true).unwrap();
    let a1 = db.get_document_by_id(&doc_id).unwrap().unwrap();
    assert!(a1.is_archived);

    db.update_last_opened(&doc_id).unwrap();
    let l1 = db.get_document_by_id(&doc_id).unwrap().unwrap();
    assert!(l1.last_opened_at.is_some());
  }

  #[test]
  fn test_reading_session_save_and_restore() {
    let db = Database::in_memory().unwrap();
    let doc_id = Uuid::new_v4().to_string();

    let doc = Document {
      id: doc_id.clone(),
      title: "Session Test Document".into(),
      filepath: "/docs/session_test.pdf".into(),
      sha256_hash: "e".repeat(64),
      page_count: 20,
      created_at: "2026-08-06T05:45:00Z".into(),
      updated_at: "2026-08-06T05:45:00Z".into(),
      provenance: "source_extracted".into(),
      author: None,
      subject: None,
      keywords: None,
      creation_date: None,
      doi: None,
      isbn: None,
      is_favourite: false,
      is_archived: false,
      last_opened_at: None,
      tags: vec![],
      collections: vec![],
    };
    db.add_document(doc).unwrap();

    let initial_session = db.get_reading_session(&doc_id).unwrap();
    assert!(initial_session.is_none());

    let session = ReadingSession {
      document_id: doc_id.clone(),
      current_page: 7,
      zoom_mode: "custom".into(),
      zoom_scale: 135.5,
      scroll_top_px: 240.0,
      left_pane_open: true,
      left_pane_width_px: 240.0,
      right_pane_open: false,
      right_pane_width_px: 280.0,
      view_mode: "facing".into(),
      rotation: 180,
      updated_at: "2026-08-06T05:46:00Z".into(),
    };

    db.save_reading_session(&session).unwrap();

    let fetched = db.get_reading_session(&doc_id).unwrap().expect("Session should be present");
    assert_eq!(fetched.document_id, doc_id);
    assert_eq!(fetched.current_page, 7);
    assert_eq!(fetched.zoom_mode, "custom");
    assert_eq!(fetched.zoom_scale, 135.5);
    assert_eq!(fetched.scroll_top_px, 240.0);
    assert_eq!(fetched.left_pane_open, true);
    assert_eq!(fetched.left_pane_width_px, 240.0);
    assert_eq!(fetched.right_pane_open, false);
    assert_eq!(fetched.right_pane_width_px, 280.0);
    assert_eq!(fetched.view_mode, "facing");
    assert_eq!(fetched.rotation, 180);

    // Test upsert / update existing session
    let updated_session = ReadingSession {
      current_page: 12,
      scroll_top_px: 512.0,
      ..session
    };
    db.save_reading_session(&updated_session).unwrap();

    let fetched_updated = db.get_reading_session(&doc_id).unwrap().unwrap();
    assert_eq!(fetched_updated.current_page, 12);
    assert_eq!(fetched_updated.scroll_top_px, 512.0);
  }

  #[test]
  fn test_delete_document_removes_record_and_cascades() {
    let db = Database::in_memory().unwrap();
    let doc_id = Uuid::new_v4().to_string();

    let doc = Document {
      id: doc_id.clone(),
      title: "Delete Test".into(),
      filepath: "/docs/delete_test.pdf".into(),
      sha256_hash: "f".repeat(64),
      page_count: 2,
      created_at: "2026-08-06T12:00:00Z".into(),
      updated_at: "2026-08-06T12:00:00Z".into(),
      provenance: "source_extracted".into(),
      author: None,
      subject: None,
      keywords: None,
      creation_date: None,
      doi: None,
      isbn: None,
      is_favourite: false,
      is_archived: false,
      last_opened_at: None,
      tags: vec![],
      collections: vec![],
    };
    db.add_document(doc).unwrap();

    // Add a page so we can verify CASCADE delete
    let page = Page {
      id: Uuid::new_v4().to_string(),
      document_id: doc_id.clone(),
      page_number: 1,
      width: 612.0,
      height: 792.0,
      text_content: "Deletable page content".into(),
      created_at: "2026-08-06T12:00:00Z".into(),
      provenance: "source_extracted".into(),
    };
    db.add_page(page).unwrap();

    // Save a reading session so we can verify CASCADE delete
    let session = ReadingSession {
      document_id: doc_id.clone(),
      current_page: 1,
      zoom_mode: "fit-width".into(),
      zoom_scale: 100.0,
      scroll_top_px: 0.0,
      left_pane_open: true,
      left_pane_width_px: 260.0,
      right_pane_open: false,
      right_pane_width_px: 300.0,
      view_mode: "single".into(),
      rotation: 0,
      updated_at: "2026-08-06T12:00:00Z".into(),
    };
    db.save_reading_session(&session).unwrap();

    // Verify document exists
    assert!(db.get_document_by_id(&doc_id).unwrap().is_some());
    assert_eq!(db.get_pages(&doc_id).unwrap().len(), 1);
    assert!(db.get_reading_session(&doc_id).unwrap().is_some());

    // Delete document
    db.delete_document(&doc_id).unwrap();

    // Verify document and cascaded children are gone
    assert!(db.get_document_by_id(&doc_id).unwrap().is_none());
    assert_eq!(db.get_pages(&doc_id).unwrap().len(), 0);
    assert!(db.get_reading_session(&doc_id).unwrap().is_none());

    // Deleting a non-existent document should error
    assert!(db.delete_document(&doc_id).is_err());
  }

  #[test]
  fn test_database_lives_in_db_subdirectory_and_relocates_legacy() {
    // A fresh database lands at app-data/db/mereth_reader.db (PRD §15.4,
    // task 3.1) and nothing appears at the app-data root.
    let dir = tempdir().unwrap();
    {
      let db = Database::new(dir.path()).unwrap();
      assert!(dir.path().join("db").join("mereth_reader.db").exists());
      assert!(!dir.path().join("mereth_reader.db").exists());
      drop(db);
    }

    // A legacy database at app-data/mereth_reader.db (pre-3.1 builds) is
    // moved into db/ on open and its data is preserved.
    let dir2 = tempdir().unwrap();
    let legacy_path = dir2.path().join("mereth_reader.db");
    {
      let conn = Connection::open(&legacy_path).unwrap();
      conn
        .execute(
          "CREATE TABLE legacy_probe (id INTEGER PRIMARY KEY, note TEXT)",
          [],
        )
        .unwrap();
      conn
        .execute("INSERT INTO legacy_probe (note) VALUES ('still here')", [])
        .unwrap();
      drop(conn);
    }
    {
      let db = Database::new(dir2.path()).unwrap();
      assert!(!legacy_path.exists(), "legacy file must be moved, not copied");
      assert!(dir2.path().join("db").join("mereth_reader.db").exists());
      let conn = db.conn.lock().unwrap();
      // The pre-existing data survived the move…
      let note: String = conn
        .query_row("SELECT note FROM legacy_probe WHERE id = 1", [], |r| r.get(0))
        .unwrap();
      assert_eq!(note, "still here");
      // …and the full migration set ran on top of it.
      let rows: i64 = conn
        .query_row("SELECT count(*) FROM migration_metadata", [], |r| r.get(0))
        .unwrap();
      assert_eq!(rows, 8);
    }
  }

  #[test]
  fn test_reopening_version3_database_runs_forward_migrations_with_backup() {
    // Simulate a database at migration version 3 (the state task 2.x left
    // behind): create a current db, drop every 3.1 table and its metadata
    // rows, then re-open. The re-open must (a) back up the pre-migration
    // file, (b) apply migrations 4-8 forward, and (c) preserve existing rows.
    let dir = tempdir().unwrap();
    let doc_id = Uuid::new_v4().to_string();
    {
      let db = Database::new(dir.path()).unwrap();
      let doc = Document {
        id: doc_id.clone(),
        title: "V3 Era Document".into(),
        filepath: "/docs/v3_era.pdf".into(),
        sha256_hash: "a1".repeat(32),
        page_count: 4,
        created_at: "2026-08-04T13:52:57Z".into(),
        updated_at: "2026-08-04T13:52:57Z".into(),
        provenance: "source_extracted".into(),
        author: None,
        subject: None,
        keywords: None,
        creation_date: None,
        doi: None,
        isbn: None,
        is_favourite: false,
        is_archived: false,
        last_opened_at: None,
        tags: vec![],
        collections: vec![],
      };
      db.add_document(doc).unwrap();
      drop(db);
    }

    let db_path = dir.path().join("db").join("mereth_reader.db");
    {
      let conn = Connection::open(&db_path).unwrap();
      for table in [
        "exports",
        "review_schedule",
        "review_events",
        "review_prompts",
        "evidence_blocks",
        "note_links",
        "note_revisions",
        "notes",
        "annotation_assets",
        "annotations",
      ] {
        conn.execute(&format!("DROP TABLE IF EXISTS {table}"), []).unwrap();
      }
      conn
        .execute("DELETE FROM migration_metadata WHERE version > 3", [])
        .unwrap();
      drop(conn);
    }

    {
      let db = Database::new(dir.path()).unwrap();
      // The pre-migration file was backed up next to the database.
      assert!(dir.path().join("db").join("mereth_reader.db.bak").exists());
      // The full metadata is present again.
      let conn = db.conn.lock().unwrap();
      let rows: i64 = conn
        .query_row("SELECT count(*) FROM migration_metadata", [], |r| r.get(0))
        .unwrap();
      assert_eq!(rows, 8);
      drop(conn);
      // Pre-existing data survived the forward migration.
      let doc = db.get_document_by_id(&doc_id).unwrap().expect("document preserved");
      assert_eq!(doc.title, "V3 Era Document");
    }
  }

  #[test]
  fn test_schema_inventory_and_no_speculative_columns() {
    // Pins the 3.1 acceptance: every feature table exists with its required
    // columns, and no deferred AI/OCR behaviour leaked in as speculative
    // columns (a later additive migration is the mechanism for those).
    let db = Database::in_memory().unwrap();
    let conn = db.conn.lock().unwrap();

    let required_tables = [
      "documents",
      "document_versions",
      "pages",
      "jobs",
      "settings",
      "collections",
      "reading_sessions",
      "migration_metadata",
      "annotations",
      "annotation_assets",
      "notes",
      "note_revisions",
      "note_links",
      "evidence_blocks",
      "review_prompts",
      "review_events",
      "review_schedule",
      "exports",
      "fts_document_text",
    ];
    for table in required_tables {
      let count: i64 = conn
        .query_row(
          "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
          [table],
          |r| r.get(0),
        )
        .unwrap();
      assert_eq!(count, 1, "missing required table: {table}");
    }

    let table_columns = |conn: &Connection, table: &str| -> Vec<String> {
      let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .unwrap();
      stmt
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    };

    let required_columns: [(&str, &[&str]); 10] = [
      (
        "annotations",
        &[
          "id", "document_id", "document_version_id", "annotation_type",
          "page_index", "page_label", "rects_json", "quote", "prefix_text",
          "suffix_text", "text_layer_checksum", "comment", "color", "tags",
          "deleted_at", "created_at", "updated_at", "provenance",
        ],
      ),
      (
        "annotation_assets",
        &[
          "id", "annotation_id", "document_id", "asset_kind",
          "relative_path", "content_type", "width_px", "height_px",
          "caption", "created_at", "provenance",
        ],
      ),
      (
        "notes",
        &[
          "id", "note_type", "title", "body_markdown", "document_id",
          "deleted_at", "created_at", "updated_at", "provenance",
        ],
      ),
      (
        "note_revisions",
        &[
          "id", "note_id", "revision_number", "title", "body_markdown",
          "created_at", "provenance",
        ],
      ),
      (
        "note_links",
        &[
          "id", "note_id", "target_note_id", "target_document_id",
          "target_annotation_id", "created_at", "provenance",
        ],
      ),
      (
        "evidence_blocks",
        &[
          "id", "note_id", "source_kind", "annotation_id", "image_asset_id",
          "document_id", "page_index", "page_label", "quote", "color",
          "tags", "user_comment", "sort_order", "created_at", "provenance",
        ],
      ),
      (
        "review_prompts",
        &[
          "id", "annotation_id", "note_id", "prompt_type", "question",
          "answer", "status", "adopted_at", "cue", "priority", "paused_at",
          "created_at", "updated_at", "provenance",
        ],
      ),
      (
        "review_events",
        &[
          "id", "prompt_id", "reviewed_at", "outcome", "duration_ms",
          "user_response", "provenance",
        ],
      ),
      (
        "review_schedule",
        &[
          "prompt_id", "desired_retention", "state", "stability",
          "difficulty", "due_at", "last_reviewed_at", "last_outcome",
          "fsrs_version", "updated_at", "provenance",
        ],
      ),
      (
        "exports",
        &[
          "id", "export_kind", "destination_path", "manifest_path", "status",
          "error", "items_count", "created_at", "updated_at", "provenance",
        ],
      ),
    ];

    for (table, cols) in required_columns {
      let actual = table_columns(&conn, table);
      for col in cols {
        assert!(
          actual.iter().any(|c| c == col),
          "{table}.{col} missing (got {actual:?})"
        );
      }
      // No speculative AI/OCR columns on any R2-R4 feature table.
      for col in actual {
        let lc = col.to_lowercase();
        assert!(
          !lc.contains("embedding")
            && !lc.contains("vector")
            && !lc.contains("ocr")
            && !lc.starts_with("ai_")
            && lc != "model_id"
            && lc != "model_key",
          "speculative AI/OCR column {table}.{col}"
        );
      }
    }

    // The ten 3.1 tables are exactly the ones the migration adds — no
    // undocumented table appears in the schema.
    let known_tables: [&str; 19] = [
      "documents",
      "document_versions",
      "pages",
      "jobs",
      "settings",
      "collections",
      "reading_sessions",
      "migration_metadata",
      "annotations",
      "annotation_assets",
      "notes",
      "note_revisions",
      "note_links",
      "evidence_blocks",
      "review_prompts",
      "review_events",
      "review_schedule",
      "exports",
      "fts_document_text",
    ];
    let mut stmt = conn
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .unwrap();
    let all: Vec<String> = stmt
      .query_map([], |r| r.get(0))
      .unwrap()
      .filter_map(|r| r.ok())
      .collect();
    for name in all {
      // `sqlite_*` are SQLite internals; `fts_document_text_*` are the FTS5
      // virtual table's own shadow tables (data/index/content/docsize/
      // config), not schema tables.
      if name.starts_with("sqlite_") || name.starts_with("fts_document_text_") {
        continue;
      }
      assert!(
        known_tables.contains(&name.as_str()),
        "undocumented table in schema: {name}"
      );
    }
  }
}

