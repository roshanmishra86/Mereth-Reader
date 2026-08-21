//! Task 4.3 — Typed persistence for note links & backlinks (PRD R3, FR-10.5).
//!
//! Links connect notes to other notes, documents, and annotations using stable UUIDs.
//! Renaming titles never breaks links.

use super::Database;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NoteLink {
  pub id: String,
  pub note_id: String,
  #[serde(default)]
  pub target_note_id: Option<String>,
  #[serde(default)]
  pub target_document_id: Option<String>,
  #[serde(default)]
  pub target_annotation_id: Option<String>,
  pub created_at: String,
  pub provenance: String,
  #[serde(default)]
  pub original_provenance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BacklinkRecord {
  pub link_id: String,
  pub source_note_id: String,
  pub source_note_title: String,
  pub source_note_type: String,
  pub created_at: String,
}

const LINK_COLS: &str = "id, note_id, target_note_id, target_document_id, target_annotation_id, created_at, provenance, original_provenance";

fn map_row_to_link(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteLink> {
  Ok(NoteLink {
    id: row.get(0)?,
    note_id: row.get(1)?,
    target_note_id: row.get(2)?,
    target_document_id: row.get(3)?,
    target_annotation_id: row.get(4)?,
    created_at: row.get(5)?,
    provenance: row.get(6)?,
    original_provenance: row.get(7)?,
  })
}

pub use super::provenance::validate_provenance;

fn current_timestamp(conn: &rusqlite::Connection) -> rusqlite::Result<String> {
  conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |r| r.get(0))
}

impl Database {
  /// Adds a new link from a note to another note, document, or annotation.
  pub fn add_note_link(&self, link: &NoteLink) -> Result<NoteLink, String> {
    validate_provenance(&link.provenance)?;

    let target_count = link.target_note_id.is_some() as i32
      + link.target_document_id.is_some() as i32
      + link.target_annotation_id.is_some() as i32;

    if target_count != 1 {
      return Err("A note link must specify exactly one target (note, document, or annotation)".to_string());
    }

    let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp(&conn).map_err(|e| e.to_string())?;

    let link_id = if link.id.is_empty() {
      Uuid::new_v4().to_string()
    } else {
      link.id.clone()
    };
    let created_at = if link.created_at.is_empty() { now } else { link.created_at.clone() };

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
      &format!("INSERT INTO note_links ({LINK_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
      params![
        link_id,
        link.note_id,
        link.target_note_id,
        link.target_document_id,
        link.target_annotation_id,
        created_at,
        link.provenance,
        link.original_provenance,
      ],
    )
    .map_err(|e| format!("Failed to insert note link: {e}"))?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(NoteLink {
      id: link_id,
      note_id: link.note_id.clone(),
      target_note_id: link.target_note_id.clone(),
      target_document_id: link.target_document_id.clone(),
      target_annotation_id: link.target_annotation_id.clone(),
      created_at,
      provenance: link.provenance.clone(),
      original_provenance: link.original_provenance.clone(),
    })
  }

  /// Lists forward links originating from a note.
  pub fn get_forward_links(&self, note_id: &str) -> Result<Vec<NoteLink>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
      .prepare(&format!(
        "SELECT {LINK_COLS} FROM note_links WHERE note_id = ?1 ORDER BY created_at ASC"
      ))
      .map_err(|e| e.to_string())?;

    let rows = stmt
      .query_map(params![note_id], |r| map_row_to_link(r))
      .map_err(|e| e.to_string())?;

    let mut links = Vec::new();
    for row in rows {
      links.push(row.map_err(|e| e.to_string())?);
    }
    Ok(links)
  }

  /// Lists incoming backlinks pointing to a note with source note title and type.
  pub fn get_note_backlinks(&self, target_note_id: &str) -> Result<Vec<BacklinkRecord>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
      .prepare(
        "SELECT l.id, l.note_id, n.title, n.note_type, l.created_at
         FROM note_links l
         JOIN notes n ON l.note_id = n.id
         WHERE l.target_note_id = ?1 AND n.deleted_at IS NULL
         ORDER BY l.created_at ASC",
      )
      .map_err(|e| e.to_string())?;

    let rows = stmt
      .query_map(params![target_note_id], |r| {
        Ok(BacklinkRecord {
          link_id: r.get(0)?,
          source_note_id: r.get(1)?,
          source_note_title: r.get(2)?,
          source_note_type: r.get(3)?,
          created_at: r.get(4)?,
        })
      })
      .map_err(|e| e.to_string())?;

    let mut backlinks = Vec::new();
    for row in rows {
      backlinks.push(row.map_err(|e| e.to_string())?);
    }
    Ok(backlinks)
  }

  /// Synchronizes forward links for a note based on markdown references.
  pub fn sync_note_links(
    &self,
    note_id: &str,
    target_note_ids: &[String],
    target_doc_ids: &[String],
    target_ann_ids: &[String],
  ) -> Result<(), String> {
    let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp(&conn).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Delete existing links for this note
    tx.execute("DELETE FROM note_links WHERE note_id = ?1", params![note_id])
      .map_err(|e| e.to_string())?;

    // Insert note-to-note targets
    for target in target_note_ids {
      if target != note_id {
        let link_id = Uuid::new_v4().to_string();
        tx.execute(
          &format!("INSERT INTO note_links ({LINK_COLS}) VALUES (?1, ?2, ?3, NULL, NULL, ?4, 'user_authored', NULL)"),
          params![link_id, note_id, target, now],
        )
        .map_err(|e| e.to_string())?;
      }
    }

    // Insert note-to-doc targets
    for target in target_doc_ids {
      let link_id = Uuid::new_v4().to_string();
      tx.execute(
        &format!("INSERT INTO note_links ({LINK_COLS}) VALUES (?1, ?2, NULL, ?3, NULL, ?4, 'user_authored', NULL)"),
        params![link_id, note_id, target, now],
      )
      .map_err(|e| e.to_string())?;
    }

    // Insert note-to-ann targets
    for target in target_ann_ids {
      let link_id = Uuid::new_v4().to_string();
      tx.execute(
        &format!("INSERT INTO note_links ({LINK_COLS}) VALUES (?1, ?2, NULL, NULL, ?3, ?4, 'user_authored', NULL)"),
        params![link_id, note_id, target, now],
      )
      .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
  }

  /// Deletes a specific note link by ID.
  pub fn delete_note_link(&self, id: &str) -> Result<(), String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let affected = conn
      .execute("DELETE FROM note_links WHERE id = ?1", params![id])
      .map_err(|e| e.to_string())?;
    if affected == 0 {
      Err(format!("Note link '{id}' not found"))
    } else {
      Ok(())
    }
  }
}

#[cfg(test)]
pub mod tests {
  use super::*;
  use crate::db::notes::Note;
  use crate::db::Database;
  use tempfile::TempDir;

  fn test_db() -> (Database, TempDir) {
    let tmp = TempDir::new().unwrap();
    let db = Database::new(tmp.path()).unwrap();
    (db, tmp)
  }

  fn setup_two_notes(db: &Database) -> (String, String) {
    let note1 = Note {
      id: "note-a".to_string(),
      note_type: "concept".to_string(),
      title: "Active Recall Principle".to_string(),
      body_markdown: "Testing strengthens memory paths.".to_string(),
      document_id: None,
      deleted_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
      original_provenance: None,
    };
    let note2 = Note {
      id: "note-b".to_string(),
      note_type: "concept".to_string(),
      title: "Spacing Effect Principle".to_string(),
      body_markdown: "Spaced retrieval is superior to massed study.".to_string(),
      document_id: None,
      deleted_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
      original_provenance: None,
    };
    db.add_note(&note1).unwrap();
    db.add_note(&note2).unwrap();
    ("note-a".to_string(), "note-b".to_string())
  }

  #[test]
  fn test_note_links_and_backlinks() {
    let (db, _tmp) = test_db();
    let (note_a, note_b) = setup_two_notes(&db);

    let link = NoteLink {
      id: "link-1".to_string(),
      note_id: note_a.clone(),
      target_note_id: Some(note_b.clone()),
      target_document_id: None,
      target_annotation_id: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
      original_provenance: None,
    };

    let created = db.add_note_link(&link).unwrap();
    assert_eq!(created.id, "link-1");

    // Forward links from note_a
    let forward = db.get_forward_links(&note_a).unwrap();
    assert_eq!(forward.len(), 1);
    assert_eq!(forward[0].target_note_id.as_deref(), Some("note-b"));

    // Backlinks pointing to note_b
    let backlinks = db.get_note_backlinks(&note_b).unwrap();
    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0].source_note_id, "note-a");
    assert_eq!(backlinks[0].source_note_title, "Active Recall Principle");
  }

  #[test]
  fn test_sync_note_links() {
    let (db, _tmp) = test_db();
    let (note_a, note_b) = setup_two_notes(&db);

    db.sync_note_links(&note_a, &[note_b.clone()], &[], &[]).unwrap();

    let forward = db.get_forward_links(&note_a).unwrap();
    assert_eq!(forward.len(), 1);
    assert_eq!(forward[0].target_note_id.as_deref(), Some("note-b"));

    // Syncing with empty list removes prior links
    db.sync_note_links(&note_a, &[], &[], &[]).unwrap();
    let empty_forward = db.get_forward_links(&note_a).unwrap();
    assert_eq!(empty_forward.len(), 0);
  }
}
