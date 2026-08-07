use rusqlite::{Connection, Result};
use std::fs;
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum MigrationError {
  #[error("Database error: {0}")]
  Sqlite(#[from] rusqlite::Error),
  #[error("IO error during database backup: {0}")]
  Io(#[from] std::io::Error),
  #[error("Migration failed: {0}")]
  Custom(String),
}

pub const ALLOWED_PROVENANCES: &[&str] = &[
  "source_extracted",
  "source_ocr",
  "user_authored",
  "ai_draft",
  "user_adopted_ai",
  "deterministic_transform",
];

/// The highest migration version this engine knows how to apply.
const LATEST_MIGRATION_VERSION: i32 = 1;

/// Runs forward-only migrations.
///
/// `db_existed` must be true only when the database file already existed on
/// disk before the caller opened the connection. A backup of the pre-migration
/// file is taken **only** when a migration is actually about to run against an
/// existing database — never on a plain re-open and never for a brand-new
/// database. This fixes the previous behaviour where `mereth_reader.db.bak`
/// was overwritten on every open.
pub fn run_migrations(conn: &mut Connection, app_dir: &Path, db_existed: bool) -> Result<(), MigrationError> {
  // Step 1: Set WAL mode. `PRAGMA journal_mode = WAL` returns a row (the new
  // mode), so read it via query_row. execute/pragma_update/execute_batch all
  // reject the returned row with "Execute returned results". In-memory
  // databases report "memory" (WAL is unsupported there); file databases report
  // "wal". Either way the pragma is applied without error.
  let _journal_mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;

  // Enable foreign-key enforcement so the schema's ON DELETE CASCADE rules are
  // honored. SQLite leaves this OFF by default; without it the FK + CASCADE
  // declarations are inert. Must be set outside a transaction (done here, before
  // any migration transaction opens). Unlike journal_mode this pragma returns
  // no rows, so `execute` is safe here.
  conn.execute("PRAGMA foreign_keys = ON", [])?;

  // Ensure the app data directory exists.
  fs::create_dir_all(app_dir)?;

  // Step 2: Initialize migration metadata table
  conn.execute(
    "CREATE TABLE IF NOT EXISTS migration_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL UNIQUE,
      applied_at TEXT NOT NULL,
      checksum TEXT NOT NULL
    );",
    [],
  )?;

  // Step 3: Determine the current applied version
  let current_version: i32 = conn
    .query_row(
      "SELECT COALESCE(MAX(version), 0) FROM migration_metadata",
      [],
      |row| row.get(0),
    )
    .unwrap_or(0);

  // Step 4: Apply pending migrations, backing up first only if needed
  if current_version < LATEST_MIGRATION_VERSION {
    // Back up the pre-migration file ONLY when migrating an existing database.
    if db_existed {
      let db_path = app_dir.join("mereth_reader.db");
      if db_path.exists() {
        let backup_path = app_dir.join("mereth_reader.db.bak");
        fs::copy(&db_path, &backup_path)?;
      }
    }

    if current_version < 1 {
      let tx = conn.transaction()?;

      tx.execute(
        "CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        filepath TEXT NOT NULL,
        sha256_hash TEXT NOT NULL,
        page_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        provenance TEXT NOT NULL CHECK(provenance IN (
          'source_extracted', 'source_ocr', 'user_authored',
          'ai_draft', 'user_adopted_ai', 'deterministic_transform'
        ))
      );",
        [],
      )?;

      tx.execute(
        "CREATE TABLE document_versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        sha256_hash TEXT NOT NULL,
        page_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        provenance TEXT NOT NULL CHECK(provenance IN (
          'source_extracted', 'source_ocr', 'user_authored',
          'ai_draft', 'user_adopted_ai', 'deterministic_transform'
        ))
      );",
        [],
      )?;

      tx.execute(
        "CREATE TABLE pages (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        text_content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        provenance TEXT NOT NULL CHECK(provenance IN (
          'source_extracted', 'source_ocr', 'user_authored',
          'ai_draft', 'user_adopted_ai', 'deterministic_transform'
        ))
      );",
        [],
      )?;

      tx.execute(
        "CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );",
        [],
      )?;

      tx.execute(
        "CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );",
        [],
      )?;

      // FTS5 index table for full-text search across document pages
      tx.execute(
        "CREATE VIRTUAL TABLE fts_document_text USING fts5(
        document_id UNINDEXED,
        page_number UNINDEXED,
        text_content,
        provenance UNINDEXED
      );",
        [],
      )?;

      // Record migration 1 completion
      tx.execute(
        "INSERT INTO migration_metadata (version, applied_at, checksum)
       VALUES (1, datetime('now'), 'migration_1_init_v1');",
        [],
      )?;

      tx.commit()?;
    }
  }

  Ok(())
}
