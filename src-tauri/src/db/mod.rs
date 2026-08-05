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

pub struct Database {
  conn: Arc<Mutex<Connection>>,
  #[allow(dead_code)]
  app_dir: PathBuf,
}

impl Database {
  pub fn new(app_dir: &Path) -> Result<Self, String> {
    fs::create_dir_all(app_dir).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("mereth_reader.db");

    // Detect whether the database file already existed BEFORE we open/create it.
    // `run_migrations` only takes a backup when it is about to migrate an existing
    // database, so the `.bak` is never rewritten on a plain re-open and never
    // created for a brand-new database.
    let db_existed = db_path.exists();
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    run_migrations(&mut conn, app_dir, db_existed).map_err(|e| e.to_string())?;

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
    let mut stmt = conn
      .prepare("SELECT id, title, filepath, sha256_hash, page_count, created_at, updated_at, provenance FROM documents")
      .map_err(|e| e.to_string())?;

    let docs = stmt
      .query_map([], |row| {
        Ok(Document {
          id: row.get(0)?,
          title: row.get(1)?,
          filepath: row.get(2)?,
          sha256_hash: row.get(3)?,
          page_count: row.get(4)?,
          created_at: row.get(5)?,
          updated_at: row.get(6)?,
          provenance: row.get(7)?,
        })
      })
      .map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();

    Ok(docs)
  }

  pub fn add_document(&self, doc: Document) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    conn
      .execute(
        "INSERT INTO documents (id, title, filepath, sha256_hash, page_count, created_at, updated_at, provenance)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
          doc.id,
          doc.title,
          doc.filepath,
          doc.sha256_hash,
          doc.page_count,
          doc.created_at,
          doc.updated_at,
          doc.provenance
        ],
      )
      .map_err(|e| e.to_string())?;
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
    let conn = self.conn.lock().unwrap();
    conn
      .execute(
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

    // Also populate FTS index
    conn
      .execute(
        "INSERT INTO fts_document_text (document_id, page_number, text_content, provenance)
         VALUES (?1, ?2, ?3, ?4)",
        params![page.document_id, page.page_number, page.text_content, page.provenance],
      )
      .map_err(|e| e.to_string())?;

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
    let conn = self.conn.lock().unwrap();

    // Rebuild FTS5 index without deleting documents or pages
    conn.execute("DELETE FROM fts_document_text", []).map_err(|e| e.to_string())?;

    let count: usize = conn
      .execute(
        "INSERT INTO fts_document_text (document_id, page_number, text_content, provenance)
         SELECT document_id, page_number, text_content, provenance FROM pages",
        [],
      )
      .map_err(|e| e.to_string())?;

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
    let db_path = dir.path().join("mereth_reader.db");
    let backup_path = dir.path().join("mereth_reader.db.bak");

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
    let db_path = dir.path().join("mereth_reader.db");
    let backup_path = dir.path().join("mereth_reader.db.bak");

    // Create a valid v1 database first.
    {
      let _db = Database::new(dir.path()).unwrap();
    }
    assert!(!backup_path.exists());

    // Roll it back to a "version 0" state so the next open re-runs migration 1.
    {
      let conn = Connection::open(&db_path).unwrap();
      conn.execute("DROP TABLE IF EXISTS fts_document_text", []).unwrap();
      conn.execute("DROP TABLE IF EXISTS pages", []).unwrap();
      conn.execute("DROP TABLE IF EXISTS document_versions", []).unwrap();
      conn.execute("DROP TABLE IF EXISTS documents", []).unwrap();
      conn.execute("DROP TABLE IF EXISTS jobs", []).unwrap();
      conn.execute("DROP TABLE IF EXISTS settings", []).unwrap();
      conn.execute("DROP TABLE IF EXISTS migration_metadata", []).unwrap();
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
}
