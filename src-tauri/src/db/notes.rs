//! Task 4.1 — typed persistence for the notes feature (PRD R3).
//!
//! This module is the typed boundary between SQLite and the rest of the app
//! for `notes` and `note_revisions` (migration 5).
//! It implements:
//! - Three distinct note roles: `source`, `concept`, `scratch` (FR-10.3)
//! - Autosave with bounded local revisions (max 20 per note, FIFO pruning) (FR-10.8)
//! - Scratch note promotion to concept or source note (FR-10.3)
//! - Trash, restore, and purge lifecycle (FR-9.8 / FR-10.1)
//! - Revision restoration without duplicating assets or corrupting linkages.

use super::Database;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const NOTE_TYPES: &[&str] = &["source", "concept", "scratch"];
pub const MAX_REVISIONS_PER_NOTE: i64 = 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Note {
  pub id: String,
  pub note_type: String,
  pub title: String,
  pub body_markdown: String,
  #[serde(default)]
  pub document_id: Option<String>,
  #[serde(default)]
  pub deleted_at: Option<String>,
  pub created_at: String,
  pub updated_at: String,
  pub provenance: String,
  #[serde(default)]
  pub original_provenance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NoteRevision {
  pub id: String,
  pub note_id: String,
  pub revision_number: i64,
  pub title: String,
  pub body_markdown: String,
  pub created_at: String,
  pub provenance: String,
  #[serde(default)]
  pub original_provenance: Option<String>,
}

const NOTE_COLS: &str = "id, note_type, title, body_markdown, document_id, deleted_at, created_at, updated_at, provenance, original_provenance";
const REVISION_COLS: &str = "id, note_id, revision_number, title, body_markdown, created_at, provenance, original_provenance";

fn map_row_to_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
  Ok(Note {
    id: row.get(0)?,
    note_type: row.get(1)?,
    title: row.get(2)?,
    body_markdown: row.get(3)?,
    document_id: row.get(4)?,
    deleted_at: row.get(5)?,
    created_at: row.get(6)?,
    updated_at: row.get(7)?,
    provenance: row.get(8)?,
    original_provenance: row.get(9)?,
  })
}

fn map_row_to_revision(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteRevision> {
  Ok(NoteRevision {
    id: row.get(0)?,
    note_id: row.get(1)?,
    revision_number: row.get(2)?,
    title: row.get(3)?,
    body_markdown: row.get(4)?,
    created_at: row.get(5)?,
    provenance: row.get(6)?,
    original_provenance: row.get(7)?,
  })
}

pub fn validate_note_type(note_type: &str) -> Result<(), String> {
  if NOTE_TYPES.contains(&note_type) {
    Ok(())
  } else {
    Err(format!(
      "Invalid note type '{note_type}'; expected one of {NOTE_TYPES:?}"
    ))
  }
}

pub use super::provenance::validate_provenance;

fn current_timestamp(conn: &rusqlite::Connection) -> rusqlite::Result<String> {
  conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |r| r.get(0))
}

impl Database {
  /// Creates a new note in the `notes` table and automatically creates revision 1 in `note_revisions`.
  pub fn add_note(&self, note: &Note) -> Result<Note, String> {
    validate_note_type(&note.note_type)?;
    validate_provenance(&note.provenance)?;

    let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp(&conn).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let note_id = if note.id.is_empty() {
      Uuid::new_v4().to_string()
    } else {
      note.id.clone()
    };

    let created_at = if note.created_at.is_empty() { now.clone() } else { note.created_at.clone() };
    let updated_at = if note.updated_at.is_empty() { now.clone() } else { note.updated_at.clone() };

    tx.execute(
      &format!("INSERT INTO notes ({NOTE_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"),
      params![
        note_id,
        note.note_type,
        note.title,
        note.body_markdown,
        note.document_id,
        note.deleted_at,
        created_at,
        updated_at,
        note.provenance,
        note.original_provenance,
      ],
    )
    .map_err(|e| format!("Failed to insert note: {e}"))?;

    // Create initial revision #1
    let revision_id = Uuid::new_v4().to_string();
    tx.execute(
      &format!("INSERT INTO note_revisions ({REVISION_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
      params![
        revision_id,
        note_id,
        1i64,
        note.title,
        note.body_markdown,
        created_at,
        note.provenance,
        note.original_provenance,
      ],
    )
    .map_err(|e| format!("Failed to create initial note revision: {e}"))?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(Note {
      id: note_id,
      note_type: note.note_type.clone(),
      title: note.title.clone(),
      body_markdown: note.body_markdown.clone(),
      document_id: note.document_id.clone(),
      deleted_at: note.deleted_at.clone(),
      created_at,
      updated_at,
      provenance: note.provenance.clone(),
      original_provenance: note.original_provenance.clone(),
    })
  }

  /// Retrieves a single note by ID.
  pub fn get_note(&self, id: &str) -> Result<Option<Note>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
      .prepare(&format!("SELECT {NOTE_COLS} FROM notes WHERE id = ?1"))
      .map_err(|e| e.to_string())?;

    let mut rows = stmt.query(params![id]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
      Ok(Some(map_row_to_note(row).map_err(|e| e.to_string())?))
    } else {
      Ok(None)
    }
  }

  /// Lists notes, optionally filtering by trash status, note type, or document ID.
  pub fn list_notes(
    &self,
    include_trash: bool,
    note_type: Option<&str>,
    document_id: Option<&str>,
  ) -> Result<Vec<Note>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let mut sql = format!("SELECT {NOTE_COLS} FROM notes WHERE 1=1");
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if !include_trash {
      sql.push_str(" AND deleted_at IS NULL");
    }

    if let Some(nt) = note_type {
      validate_note_type(nt)?;
      sql.push_str(" AND note_type = ?");
      params_vec.push(Box::new(nt.to_string()));
    }

    if let Some(doc_id) = document_id {
      sql.push_str(" AND document_id = ?");
      params_vec.push(Box::new(doc_id.to_string()));
    }

    sql.push_str(" ORDER BY updated_at DESC");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rusqlite_params: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let rows = stmt
      .query_map(rusqlite_params.as_slice(), |r| map_row_to_note(r))
      .map_err(|e| e.to_string())?;

    let mut notes = Vec::new();
    for row in rows {
      notes.push(row.map_err(|e| e.to_string())?);
    }
    Ok(notes)
  }

  /// Updates note content and optionally writes a new revision, pruning to MAX_REVISIONS_PER_NOTE (20).
  pub fn update_note(
    &self,
    id: &str,
    title: &str,
    body_markdown: &str,
    create_revision: bool,
  ) -> Result<Note, String> {
    let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp(&conn).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let existing: Note = {
      let mut stmt = tx
        .prepare(&format!("SELECT {NOTE_COLS} FROM notes WHERE id = ?1"))
        .map_err(|e| e.to_string())?;
      stmt
        .query_row(params![id], |r| map_row_to_note(r))
        .map_err(|e| format!("Note not found: {e}"))?
    };

    tx.execute(
      "UPDATE notes SET title = ?1, body_markdown = ?2, updated_at = ?3 WHERE id = ?4",
      params![title, body_markdown, now, id],
    )
    .map_err(|e| format!("Failed to update note: {e}"))?;

    if create_revision {
      let max_rev: i64 = tx
        .query_row(
          "SELECT COALESCE(MAX(revision_number), 0) FROM note_revisions WHERE note_id = ?1",
          params![id],
          |r| r.get(0),
        )
        .unwrap_or(0);

      let next_rev = max_rev + 1;
      let rev_id = Uuid::new_v4().to_string();

      tx.execute(
        &format!("INSERT INTO note_revisions ({REVISION_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
        params![
          rev_id,
          id,
          next_rev,
          title,
          body_markdown,
          now,
          existing.provenance,
          existing.original_provenance,
        ],
      )
      .map_err(|e| format!("Failed to create revision: {e}"))?;

      // Prune revisions older than the 20 most recent
      let prune_cutoff = next_rev - MAX_REVISIONS_PER_NOTE;
      if prune_cutoff > 0 {
        tx.execute(
          "DELETE FROM note_revisions WHERE note_id = ?1 AND revision_number <= ?2",
          params![id, prune_cutoff],
        )
        .map_err(|e| format!("Failed to prune revisions: {e}"))?;
      }
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(Note {
      id: id.to_string(),
      note_type: existing.note_type,
      title: title.to_string(),
      body_markdown: body_markdown.to_string(),
      document_id: existing.document_id,
      deleted_at: existing.deleted_at,
      created_at: existing.created_at,
      updated_at: now,
      provenance: existing.provenance,
      original_provenance: existing.original_provenance,
    })
  }

  /// Sets `deleted_at` to current timestamp.
  pub fn trash_note(&self, id: &str) -> Result<(), String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp(&conn).map_err(|e| e.to_string())?;
    let rows_affected = conn
      .execute(
        "UPDATE notes SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
        params![now, id],
      )
      .map_err(|e| e.to_string())?;

    if rows_affected == 0 {
      Err(format!("Note '{id}' not found or already in trash"))
    } else {
      Ok(())
    }
  }

  /// Clears `deleted_at` to restore note from trash.
  pub fn restore_note(&self, id: &str) -> Result<(), String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let rows_affected = conn
      .execute(
        "UPDATE notes SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
        params![id],
      )
      .map_err(|e| e.to_string())?;

    if rows_affected == 0 {
      Err(format!("Note '{id}' not found in trash"))
    } else {
      Ok(())
    }
  }

  /// Permanently removes a note and cascades to revisions and links.
  pub fn purge_note(&self, id: &str) -> Result<(), String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let rows_affected = conn
      .execute("DELETE FROM notes WHERE id = ?1", params![id])
      .map_err(|e| e.to_string())?;

    if rows_affected == 0 {
      Err(format!("Note '{id}' not found"))
    } else {
      Ok(())
    }
  }

  /// Returns all revisions for a note, ordered by revision_number DESC.
  pub fn get_note_revisions(&self, note_id: &str) -> Result<Vec<NoteRevision>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
      .prepare(&format!(
        "SELECT {REVISION_COLS} FROM note_revisions WHERE note_id = ?1 ORDER BY revision_number DESC"
      ))
      .map_err(|e| e.to_string())?;

    let rows = stmt
      .query_map(params![note_id], |r| map_row_to_revision(r))
      .map_err(|e| e.to_string())?;

    let mut revs = Vec::new();
    for row in rows {
      revs.push(row.map_err(|e| e.to_string())?);
    }
    Ok(revs)
  }

  /// Restores a specific revision into the active note and creates a new revision marking the restore.
  pub fn restore_note_revision(&self, note_id: &str, revision_number: i64) -> Result<Note, String> {
    let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp(&conn).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let target_rev: NoteRevision = {
      let mut stmt = tx
        .prepare(&format!(
          "SELECT {REVISION_COLS} FROM note_revisions WHERE note_id = ?1 AND revision_number = ?2"
        ))
        .map_err(|e| e.to_string())?;
      stmt
        .query_row(params![note_id, revision_number], |r| map_row_to_revision(r))
        .map_err(|e| format!("Revision not found: {e}"))?
    };

    let existing: Note = {
      let mut stmt = tx
        .prepare(&format!("SELECT {NOTE_COLS} FROM notes WHERE id = ?1"))
        .map_err(|e| e.to_string())?;
      stmt
        .query_row(params![note_id], |r| map_row_to_note(r))
        .map_err(|e| format!("Note not found: {e}"))?
    };

    tx.execute(
      "UPDATE notes SET title = ?1, body_markdown = ?2, updated_at = ?3 WHERE id = ?4",
      params![target_rev.title, target_rev.body_markdown, now, note_id],
    )
    .map_err(|e| format!("Failed to update note from revision: {e}"))?;

    let max_rev: i64 = tx
      .query_row(
        "SELECT COALESCE(MAX(revision_number), 0) FROM note_revisions WHERE note_id = ?1",
        params![note_id],
        |r| r.get(0),
      )
      .unwrap_or(0);

    let next_rev = max_rev + 1;
    let rev_id = Uuid::new_v4().to_string();

    tx.execute(
      &format!("INSERT INTO note_revisions ({REVISION_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
      params![
        rev_id,
        note_id,
        next_rev,
        target_rev.title,
        target_rev.body_markdown,
        now,
        existing.provenance,
        existing.original_provenance,
      ],
    )
    .map_err(|e| format!("Failed to record restored revision: {e}"))?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(Note {
      id: note_id.to_string(),
      note_type: existing.note_type,
      title: target_rev.title,
      body_markdown: target_rev.body_markdown,
      document_id: existing.document_id,
      deleted_at: existing.deleted_at,
      created_at: existing.created_at,
      updated_at: now,
      provenance: existing.provenance,
      original_provenance: existing.original_provenance,
    })
  }

  /// Promotes a scratch note to a concept note or source note (FR-10.3).
  pub fn promote_scratch_note(
    &self,
    id: &str,
    target_type: &str,
    document_id: Option<&str>,
  ) -> Result<Note, String> {
    if target_type != "concept" && target_type != "source" {
      return Err(format!(
        "Cannot promote scratch note to '{target_type}'; expected 'concept' or 'source'"
      ));
    }

    let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp(&conn).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let existing: Note = {
      let mut stmt = tx
        .prepare(&format!("SELECT {NOTE_COLS} FROM notes WHERE id = ?1"))
        .map_err(|e| e.to_string())?;
      stmt
        .query_row(params![id], |r| map_row_to_note(r))
        .map_err(|e| format!("Note not found: {e}"))?
    };

    if existing.note_type != "scratch" {
      return Err(format!("Note '{id}' is type '{}', not 'scratch'", existing.note_type));
    }

    tx.execute(
      "UPDATE notes SET note_type = ?1, document_id = ?2, updated_at = ?3 WHERE id = ?4",
      params![target_type, document_id, now, id],
    )
    .map_err(|e| format!("Failed to promote note: {e}"))?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(Note {
      id: id.to_string(),
      note_type: target_type.to_string(),
      title: existing.title,
      body_markdown: existing.body_markdown,
      document_id: document_id.map(|d| d.to_string()),
      deleted_at: existing.deleted_at,
      created_at: existing.created_at,
      updated_at: now,
      provenance: existing.provenance,
      original_provenance: existing.original_provenance,
    })
  }
}

#[cfg(test)]
pub mod tests {
  use super::*;
  use crate::db::Database;
  use tempfile::TempDir;

  fn test_db() -> (Database, TempDir) {
    let tmp = TempDir::new().unwrap();
    let db = Database::new(tmp.path()).unwrap();
    (db, tmp)
  }

  fn sample_note(id: &str, note_type: &str) -> Note {
    Note {
      id: id.to_string(),
      note_type: note_type.to_string(),
      title: "Testing enhances memory retention".to_string(),
      body_markdown: "## Core Claim\nRetrieval practice produces durable memory.".to_string(),
      document_id: None,
      deleted_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
      original_provenance: None,
    }
  }

  #[test]
  fn test_note_creation_and_listing() {
    let (db, _tmp) = test_db();
    let note = sample_note("n1", "concept");
    let created = db.add_note(&note).unwrap();
    assert_eq!(created.id, "n1");
    assert_eq!(created.note_type, "concept");

    let fetched = db.get_note("n1").unwrap().unwrap();
    assert_eq!(fetched.title, "Testing enhances memory retention");

    let list = db.list_notes(false, None, None).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "n1");

    let revs = db.get_note_revisions("n1").unwrap();
    assert_eq!(revs.len(), 1);
    assert_eq!(revs[0].revision_number, 1);
  }

  #[test]
  fn test_note_validation_rejects_invalid_type() {
    let (db, _tmp) = test_db();
    let mut note = sample_note("n2", "invalid_type");
    let err = db.add_note(&note).unwrap_err();
    assert!(err.contains("Invalid note type"));

    note.note_type = "concept".to_string();
    note.provenance = "bogus_provenance".to_string();
    let err2 = db.add_note(&note).unwrap_err();
    assert!(err2.contains("Invalid provenance"));
  }

  #[test]
  fn test_note_update_and_bounded_revisions_fifo() {
    let (db, _tmp) = test_db();
    let note = sample_note("n3", "concept");
    db.add_note(&note).unwrap();

    // Perform 25 updates with create_revision=true
    for i in 2..=26 {
      let updated_title = format!("Updated Title {i}");
      let updated_body = format!("Updated Body {i}");
      db.update_note("n3", &updated_title, &updated_body, true).unwrap();
    }

    let revs = db.get_note_revisions("n3").unwrap();
    // Bounded to 20 revisions maximum (FIFO pruning)
    assert_eq!(revs.len(), 20);
    assert_eq!(revs[0].revision_number, 26);
    assert_eq!(revs[19].revision_number, 7); // 26 - 20 + 1 = 7
  }

  #[test]
  fn test_scratch_promotion() {
    let (db, _tmp) = test_db();
    let note = sample_note("n4", "scratch");
    db.add_note(&note).unwrap();

    let promoted = db.promote_scratch_note("n4", "concept", None).unwrap();
    assert_eq!(promoted.note_type, "concept");

    // Re-fetching confirms persistent update
    let fetched = db.get_note("n4").unwrap().unwrap();
    assert_eq!(fetched.note_type, "concept");
  }

  #[test]
  fn test_note_trash_restore_purge() {
    let (db, _tmp) = test_db();
    let note = sample_note("n5", "source");
    db.add_note(&note).unwrap();

    db.trash_note("n5").unwrap();
    let active = db.list_notes(false, None, None).unwrap();
    assert_eq!(active.len(), 0);

    let all = db.list_notes(true, None, None).unwrap();
    assert_eq!(all.len(), 1);
    assert!(all[0].deleted_at.is_some());

    db.restore_note("n5").unwrap();
    let restored = db.list_notes(false, None, None).unwrap();
    assert_eq!(restored.len(), 1);
    assert!(restored[0].deleted_at.is_none());

    db.purge_note("n5").unwrap();
    let purged = db.get_note("n5").unwrap();
    assert!(purged.is_none());
  }

  #[test]
  fn test_restore_note_revision() {
    let (db, _tmp) = test_db();
    let note = sample_note("n6", "concept");
    db.add_note(&note).unwrap();

    db.update_note("n6", "Title V2", "Body V2", true).unwrap();
    db.update_note("n6", "Title V3", "Body V3", true).unwrap();

    let restored = db.restore_note_revision("n6", 1).unwrap();
    assert_eq!(restored.title, "Testing enhances memory retention");
    assert_eq!(restored.body_markdown, "## Core Claim\nRetrieval practice produces durable memory.");

    let revs = db.get_note_revisions("n6").unwrap();
    assert_eq!(revs.len(), 4); // v1, v2, v3, v4 (restored)
    assert_eq!(revs[0].revision_number, 4);
    assert_eq!(revs[0].title, "Testing enhances memory retention");
  }
}
