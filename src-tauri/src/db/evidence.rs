//! Task 4.2 — typed persistence for evidence blocks in notes (PRD R3, FR-10.1, FR-10.2).
//!
//! Evidence blocks hold immutable excerpts or area images with citations,
//! page labels, deep links, and user comments.
//! Foreign keys protect against quote loss via ON DELETE SET NULL on annotations.

use super::notes::{map_row_to_note, Note, NOTE_COLS};
use super::Database;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const SOURCE_KINDS: &[&str] = &["quote", "area_image"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CaptureToSourceNoteResult {
  pub note: Note,
  pub evidence_block: EvidenceBlock,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AttachedEvidenceBlock {
  pub quote: String,
  pub page_label: String,
  pub document_title: String,
  pub user_comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EvidenceBlock {
  pub id: String,
  pub note_id: String,
  pub source_kind: String,
  #[serde(default)]
  pub annotation_id: Option<String>,
  #[serde(default)]
  pub image_asset_id: Option<String>,
  pub document_id: String,
  pub page_index: i64,
  pub page_label: String,
  #[serde(default)]
  pub quote: String,
  #[serde(default)]
  pub color: String,
  #[serde(default)]
  pub tags: Vec<String>,
  #[serde(default)]
  pub user_comment: String,
  pub sort_order: i64,
  pub created_at: String,
  pub provenance: String,
  #[serde(default)]
  pub original_provenance: Option<String>,
}

const EVIDENCE_COLS: &str = "id, note_id, source_kind, annotation_id, image_asset_id, document_id, page_index, page_label, quote, color, tags, user_comment, sort_order, created_at, provenance, original_provenance";

fn map_row_to_evidence(row: &rusqlite::Row<'_>) -> rusqlite::Result<EvidenceBlock> {
  let tags_json: String = row.get(10)?;
  Ok(EvidenceBlock {
    id: row.get(0)?,
    note_id: row.get(1)?,
    source_kind: row.get(2)?,
    annotation_id: row.get(3)?,
    image_asset_id: row.get(4)?,
    document_id: row.get(5)?,
    page_index: row.get(6)?,
    page_label: row.get(7)?,
    quote: row.get(8)?,
    color: row.get(9)?,
    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
    user_comment: row.get(11)?,
    sort_order: row.get(12)?,
    created_at: row.get(13)?,
    provenance: row.get(14)?,
    original_provenance: row.get(15)?,
  })
}

pub fn validate_source_kind(kind: &str) -> Result<(), String> {
  if SOURCE_KINDS.contains(&kind) {
    Ok(())
  } else {
    Err(format!(
      "Invalid source kind '{kind}'; expected one of {SOURCE_KINDS:?}"
    ))
  }
}

pub use super::provenance::validate_provenance;

fn current_timestamp(conn: &rusqlite::Connection) -> rusqlite::Result<String> {
  conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |r| r.get(0))
}

impl Database {
  /// Adds a new structured evidence block to a note.
  pub fn add_evidence_block(&self, block: &EvidenceBlock) -> Result<EvidenceBlock, String> {
    validate_source_kind(&block.source_kind)?;
    validate_provenance(&block.provenance)?;

    let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp(&conn).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let block_id = if block.id.is_empty() {
      Uuid::new_v4().to_string()
    } else {
      block.id.clone()
    };

    let sort_order = if block.sort_order <= 0 {
      let max_order: i64 = tx
        .query_row(
          "SELECT COALESCE(MAX(sort_order), 0) FROM evidence_blocks WHERE note_id = ?1",
          params![block.note_id],
          |r| r.get(0),
        )
        .unwrap_or(0);
      max_order + 1
    } else {
      block.sort_order
    };

    let tags_json = serde_json::to_string(&block.tags).unwrap_or_else(|_| "[]".to_string());
    let created_at = if block.created_at.is_empty() { now } else { block.created_at.clone() };

    tx.execute(
      &format!("INSERT INTO evidence_blocks ({EVIDENCE_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)"),
      params![
        block_id,
        block.note_id,
        block.source_kind,
        block.annotation_id,
        block.image_asset_id,
        block.document_id,
        block.page_index,
        block.page_label,
        block.quote,
        block.color,
        tags_json,
        block.user_comment,
        sort_order,
        created_at,
        block.provenance,
        block.original_provenance,
      ],
    )
    .map_err(|e| format!("Failed to insert evidence block: {e}"))?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(EvidenceBlock {
      id: block_id,
      note_id: block.note_id.clone(),
      source_kind: block.source_kind.clone(),
      annotation_id: block.annotation_id.clone(),
      image_asset_id: block.image_asset_id.clone(),
      document_id: block.document_id.clone(),
      page_index: block.page_index,
      page_label: block.page_label.clone(),
      quote: block.quote.clone(),
      color: block.color.clone(),
      tags: block.tags.clone(),
      user_comment: block.user_comment.clone(),
      sort_order,
      created_at,
      provenance: block.provenance.clone(),
      original_provenance: block.original_provenance.clone(),
    })
  }

  /// Atomically captures an evidence block to a document's source note.
  /// Looks up existing non-deleted source note:
  /// `SELECT ... FROM notes WHERE note_type = 'source' AND document_id = ?1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`.
  /// If none exists, creates a new source note with title `"{document_title} — Reading Notes"` and body `"# {document_title}\n\n*By {author}*\n\n## Excerpts & Notes\n"`.
  /// Inserts the evidence_block linked to note.id with next sort_order.
  /// Returns `{ note, evidence_block }`.
  pub fn capture_annotation_to_source_note(
    &self,
    block: &EvidenceBlock,
  ) -> Result<CaptureToSourceNoteResult, String> {
    validate_source_kind(&block.source_kind)?;
    validate_provenance(&block.provenance)?;

    let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp(&conn).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let note: Note = {
      let mut stmt = tx
        .prepare(&format!(
          "SELECT {NOTE_COLS} FROM notes WHERE note_type = 'source' AND document_id = ?1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1"
        ))
        .map_err(|e| e.to_string())?;
      let existing = stmt
        .query_row(params![block.document_id], |r| map_row_to_note(r))
        .optional()
        .map_err(|e| format!("Failed to query existing source note: {e}"))?;

      match existing {
        Some(n) => n,
        None => {
          let doc_row: Option<(String, Option<String>)> = tx
            .query_row(
              "SELECT title, author FROM documents WHERE id = ?1",
              params![block.document_id],
              |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("Failed to query document for source note: {e}"))?;

          let (document_title, author) = match doc_row {
            Some((t, a)) => {
              let auth = a.unwrap_or_default().trim().to_string();
              let final_auth = if auth.is_empty() {
                "Unknown".to_string()
              } else {
                auth
              };
              (t, final_auth)
            }
            None => ("Document".to_string(), "Unknown".to_string()),
          };

          let note_id = Uuid::new_v4().to_string();
          let title = format!("{document_title} — Reading Notes");
          let body = format!("# {document_title}\n\n*By {author}*\n\n## Excerpts & Notes\n");
          let provenance = "user_authored".to_string();

          tx.execute(
            &format!("INSERT INTO notes ({NOTE_COLS}) VALUES (?1, 'source', ?2, ?3, ?4, NULL, ?5, ?5, ?6, NULL)"),
            params![note_id, title, body, block.document_id, now, provenance],
          )
          .map_err(|e| format!("Failed to insert source note: {e}"))?;

          let revision_id = Uuid::new_v4().to_string();
          tx.execute(
            "INSERT INTO note_revisions (id, note_id, revision_number, title, body_markdown, created_at, provenance, original_provenance)
             VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, NULL)",
            params![revision_id, note_id, title, body, now, provenance],
          )
          .map_err(|e| format!("Failed to insert initial note revision: {e}"))?;

          Note {
            id: note_id,
            note_type: "source".to_string(),
            title,
            body_markdown: body,
            document_id: Some(block.document_id.clone()),
            deleted_at: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            provenance,
            original_provenance: None,
          }
        }
      }
    };

    let block_id = if block.id.is_empty() {
      Uuid::new_v4().to_string()
    } else {
      block.id.clone()
    };

    // Capturing the same annotation (or retrying the same request ID) is idempotent.
    // Never overwrite the user's existing evidence comment on a retry.
    let existing_block = tx.query_row(
      &format!("SELECT {EVIDENCE_COLS} FROM evidence_blocks WHERE note_id = ?1 AND (id = ?2 OR (annotation_id = ?3 AND source_kind = ?4)) ORDER BY sort_order LIMIT 1"),
      params![note.id, block.id, block.annotation_id, block.source_kind],
      map_row_to_evidence,
    ).optional().map_err(|e| e.to_string())?;
    if let Some(evidence_block) = existing_block {
      tx.commit().map_err(|e| e.to_string())?;
      return Ok(CaptureToSourceNoteResult { note, evidence_block });
    }

    let max_order: i64 = tx
      .query_row(
        "SELECT COALESCE(MAX(sort_order), 0) FROM evidence_blocks WHERE note_id = ?1",
        params![note.id],
        |r| r.get(0),
      )
      .unwrap_or(0);
    let sort_order = max_order + 1;

    let tags_json = serde_json::to_string(&block.tags).unwrap_or_else(|_| "[]".to_string());
    let created_at = if block.created_at.is_empty() {
      now
    } else {
      block.created_at.clone()
    };

    tx.execute(
      &format!("INSERT INTO evidence_blocks ({EVIDENCE_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)"),
      params![
        block_id,
        note.id,
        block.source_kind,
        block.annotation_id,
        block.image_asset_id,
        block.document_id,
        block.page_index,
        block.page_label,
        block.quote,
        block.color,
        tags_json,
        block.user_comment,
        sort_order,
        created_at,
        block.provenance,
        block.original_provenance,
      ],
    )
    .map_err(|e| format!("Failed to insert evidence block: {e}"))?;

    tx.commit().map_err(|e| e.to_string())?;

    let note_id = note.id.clone();
    Ok(CaptureToSourceNoteResult {
      note,
      evidence_block: EvidenceBlock {
        id: block_id,
        note_id,
        source_kind: block.source_kind.clone(),
        annotation_id: block.annotation_id.clone(),
        image_asset_id: block.image_asset_id.clone(),
        document_id: block.document_id.clone(),
        page_index: block.page_index,
        page_label: block.page_label.clone(),
        quote: block.quote.clone(),
        color: block.color.clone(),
        tags: block.tags.clone(),
        user_comment: block.user_comment.clone(),
        sort_order,
        created_at,
        provenance: block.provenance.clone(),
        original_provenance: block.original_provenance.clone(),
      },
    })
  }

  /// Lists all evidence blocks for a note in display order (sort_order ASC, created_at ASC).
  pub fn get_note_evidence_blocks(&self, note_id: &str) -> Result<Vec<EvidenceBlock>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
      .prepare(&format!(
        "SELECT {EVIDENCE_COLS} FROM evidence_blocks WHERE note_id = ?1 ORDER BY sort_order ASC, created_at ASC"
      ))
      .map_err(|e| e.to_string())?;

    let rows = stmt
      .query_map(params![note_id], |r| map_row_to_evidence(r))
      .map_err(|e| e.to_string())?;

    let mut blocks = Vec::new();
    for row in rows {
      blocks.push(row.map_err(|e| e.to_string())?);
    }
    Ok(blocks)
  }

  /// Updates the sort order of evidence blocks in a note.
  pub fn update_evidence_block_order(
    &self,
    note_id: &str,
    block_ids: &[String],
  ) -> Result<(), String> {
    let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (index, id) in block_ids.iter().enumerate() {
      tx.execute(
        "UPDATE evidence_blocks SET sort_order = ?1 WHERE id = ?2 AND note_id = ?3",
        params![index as i64 + 1, id, note_id],
      )
      .map_err(|e| format!("Failed to update evidence block order: {e}"))?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
  }

  /// Updates user comment on an evidence block without modifying the quote.
  pub fn update_evidence_block_comment(&self, id: &str, user_comment: &str) -> Result<(), String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let rows_affected = conn
      .execute(
        "UPDATE evidence_blocks SET user_comment = ?1 WHERE id = ?2",
        params![user_comment, id],
      )
      .map_err(|e| e.to_string())?;

    if rows_affected == 0 {
      Err(format!("Evidence block '{id}' not found"))
    } else {
      Ok(())
    }
  }

  /// Deletes an evidence block by ID.
  pub fn delete_evidence_block(&self, id: &str) -> Result<(), String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let rows_affected = conn
      .execute("DELETE FROM evidence_blocks WHERE id = ?1", params![id])
      .map_err(|e| e.to_string())?;

    if rows_affected == 0 {
      Err(format!("Evidence block '{id}' not found"))
    } else {
      Ok(())
    }
  }

  /// Lists attached evidence blocks for a note including the source document title.
  pub fn list_evidence_blocks(&self, note_id: &str) -> Result<Vec<AttachedEvidenceBlock>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
      .prepare(
        "SELECT e.quote, e.page_label, COALESCE(d.title, 'Unknown Document') AS document_title, e.user_comment
         FROM evidence_blocks e
         LEFT JOIN documents d ON e.document_id = d.id
         WHERE e.note_id = ?1
         ORDER BY e.sort_order ASC, e.created_at ASC",
      )
      .map_err(|e| e.to_string())?;

    let rows = stmt
      .query_map(params![note_id], |r| {
        Ok(AttachedEvidenceBlock {
          quote: r.get(0)?,
          page_label: r.get(1)?,
          document_title: r.get(2)?,
          user_comment: r.get(3)?,
        })
      })
      .map_err(|e| e.to_string())?;

    let mut blocks = Vec::new();
    for row in rows {
      blocks.push(row.map_err(|e| e.to_string())?);
    }
    Ok(blocks)
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

  fn setup_test_doc_and_note(db: &Database) -> (String, String) {
    let doc_id = "doc-ev-1".to_string();
    let doc = crate::db::Document {
      id: doc_id.clone(),
      title: "Memory Research Paper".to_string(),
      filepath: "/path/to/paper.pdf".to_string(),
      sha256_hash: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234".to_string(),
      page_count: 10,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "source_extracted".to_string(),
      author: Some("Roediger & Karpicke".to_string()),
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
      ownership_mode: "open_in_place".into(), original_filepath: None, removed_at: None,
    };
    db.add_document(doc).unwrap();

    let note_id = "note-ev-1".to_string();
    let note = Note {
      id: note_id.clone(),
      note_type: "concept".to_string(),
      title: "Testing Effect Concept".to_string(),
      body_markdown: "## Core Claim\nTesting works.".to_string(),
      document_id: Some(doc_id.clone()),
      deleted_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
      original_provenance: None,
    };
    db.add_note(&note).unwrap();

    (doc_id, note_id)
  }

  #[test]
  fn test_evidence_block_add_and_list() {
    let (db, _tmp) = test_db();
    let (doc_id, note_id) = setup_test_doc_and_note(&db);

    let block = EvidenceBlock {
      id: "eb-1".to_string(),
      note_id: note_id.clone(),
      source_kind: "quote".to_string(),
      annotation_id: None,
      image_asset_id: None,
      document_id: doc_id.clone(),
      page_index: 2,
      page_label: "249".to_string(),
      quote: "Testing produces superior retention.".to_string(),
      color: "yellow".to_string(),
      tags: vec!["retrieval".to_string()],
      user_comment: "Essential quote".to_string(),
      sort_order: 1,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "source_extracted".to_string(),
      original_provenance: None,
    };

    let created = db.add_evidence_block(&block).unwrap();
    assert_eq!(created.id, "eb-1");

    let blocks = db.get_note_evidence_blocks(&note_id).unwrap();
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].quote, "Testing produces superior retention.");
    assert_eq!(blocks[0].page_label, "249");
  }

  #[test]
  fn test_evidence_block_comment_update_and_reordering() {
    let (db, _tmp) = test_db();
    let (doc_id, note_id) = setup_test_doc_and_note(&db);

    let block1 = EvidenceBlock {
      id: "eb-10".to_string(),
      note_id: note_id.clone(),
      source_kind: "quote".to_string(),
      annotation_id: None,
      image_asset_id: None,
      document_id: doc_id.clone(),
      page_index: 1,
      page_label: "10".to_string(),
      quote: "Quote 1".to_string(),
      color: "".to_string(),
      tags: vec![],
      user_comment: "Comment 1".to_string(),
      sort_order: 1,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
      original_provenance: None,
    };
    let block2 = EvidenceBlock {
      id: "eb-20".to_string(),
      note_id: note_id.clone(),
      source_kind: "quote".to_string(),
      annotation_id: None,
      image_asset_id: None,
      document_id: doc_id.clone(),
      page_index: 2,
      page_label: "20".to_string(),
      quote: "Quote 2".to_string(),
      color: "".to_string(),
      tags: vec![],
      user_comment: "Comment 2".to_string(),
      sort_order: 2,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
      original_provenance: None,
    };

    db.add_evidence_block(&block1).unwrap();
    db.add_evidence_block(&block2).unwrap();

    // Update comment
    db.update_evidence_block_comment("eb-10", "Updated comment text").unwrap();
    let list = db.get_note_evidence_blocks(&note_id).unwrap();
    assert_eq!(list[0].user_comment, "Updated comment text");

    // Reorder: swap order
    db.update_evidence_block_order(&note_id, &["eb-20".to_string(), "eb-10".to_string()]).unwrap();
    let reordered = db.get_note_evidence_blocks(&note_id).unwrap();
    assert_eq!(reordered[0].id, "eb-20");
    assert_eq!(reordered[1].id, "eb-10");
  }

  #[test]
  fn test_evidence_block_preserves_quote_when_annotation_purged() {
    let (db, tmp) = test_db();
    let (doc_id, note_id) = setup_test_doc_and_note(&db);

    // Insert a document version row directly for FK constraint
    {
      let conn = db.conn.lock().unwrap();
      conn.execute(
        "INSERT INTO document_versions (id, document_id, version_number, sha256_hash, page_count, created_at, provenance) VALUES (?1, ?2, 1, 'fake_hash', 10, '2026-08-21T00:00:00Z', 'source_extracted')",
        params!["ver-ev-1", doc_id],
      ).unwrap();
    }

    // Create an annotation in document
    let annotation = crate::db::annotations::Annotation {
      id: "ann-for-eb".to_string(),
      document_id: doc_id.clone(),
      document_version_id: "ver-ev-1".to_string(),
      checksum: "chk-123".to_string(),
      annotation_type: "highlight".to_string(),
      page_index: 1,
      page_label: "1".to_string(),
      rects: vec![],
      quote: "Direct text quote from PDF".to_string(),
      prefix_text: "".to_string(),
      suffix_text: "".to_string(),
      text_layer_checksum: Some("".to_string()),
      comment: "User comment on highlight".to_string(),
      color: "yellow".to_string(),
      tags: vec![],
      deleted_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "source_extracted".to_string(),
    };
    db.add_annotation(&annotation).unwrap();

    // Add evidence block referencing the annotation
    let block = EvidenceBlock {
      id: "eb-ann-ref".to_string(),
      note_id: note_id.clone(),
      source_kind: "quote".to_string(),
      annotation_id: Some("ann-for-eb".to_string()),
      image_asset_id: None,
      document_id: doc_id.clone(),
      page_index: 1,
      page_label: "1".to_string(),
      quote: "Direct text quote from PDF".to_string(),
      color: "yellow".to_string(),
      tags: vec![],
      user_comment: "Note comment".to_string(),
      sort_order: 1,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "source_extracted".to_string(),
      original_provenance: None,
    };
    db.add_evidence_block(&block).unwrap();

    // Purge annotation
    db.purge_annotation(tmp.path(), "ann-for-eb").unwrap();

    // Evidence block still exists with annotation_id = None and quote intact!
    let blocks = db.get_note_evidence_blocks(&note_id).unwrap();
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].annotation_id, None);
    assert_eq!(blocks[0].quote, "Direct text quote from PDF");
  }

  #[test]
  fn test_capture_annotation_to_source_note_creates_source_note_and_evidence_atomically() {
    let (db, _tmp) = test_db();
    let doc_id = "doc-capture-test".to_string();
    let doc = crate::db::Document {
      id: doc_id.clone(),
      title: "Active Recall Study".to_string(),
      filepath: "/path/to/recall.pdf".to_string(),
      sha256_hash: "1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd".to_string(),
      page_count: 5,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "source_extracted".to_string(),
      author: Some("Dr. Smith".to_string()),
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
      ownership_mode: "open_in_place".to_string(),
      original_filepath: None,
      removed_at: None,
    };
    db.add_document(doc).unwrap();

    let block1 = EvidenceBlock {
      id: "eb-cap-1".to_string(),
      note_id: "".to_string(),
      source_kind: "quote".to_string(),
      annotation_id: None,
      image_asset_id: None,
      document_id: doc_id.clone(),
      page_index: 0,
      page_label: "1".to_string(),
      quote: "First extracted quote.".to_string(),
      color: "yellow".to_string(),
      tags: vec!["tag1".to_string()],
      user_comment: "First comment".to_string(),
      sort_order: 0,
      created_at: "".to_string(),
      provenance: "user_authored".to_string(),
      original_provenance: None,
    };

    // First capture creates a new source note and inserts evidence block
    let res1 = db.capture_annotation_to_source_note(&block1).unwrap();
    assert_eq!(res1.note.note_type, "source");
    assert_eq!(res1.note.title, "Active Recall Study — Reading Notes");
    assert!(res1.note.body_markdown.contains("*By Dr. Smith*"));
    assert_eq!(res1.evidence_block.note_id, res1.note.id);
    assert_eq!(res1.evidence_block.sort_order, 1);
    assert_eq!(res1.evidence_block.quote, "First extracted quote.");
    let retried = db.capture_annotation_to_source_note(&block1).unwrap();
    assert_eq!(retried, res1);
    assert_eq!(db.get_note_evidence_blocks(&res1.note.id).unwrap().len(), 1);

    // Second capture reuses the existing source note and increments sort_order
    let block2 = EvidenceBlock {
      id: "eb-cap-2".to_string(),
      note_id: "".to_string(),
      source_kind: "quote".to_string(),
      annotation_id: None,
      image_asset_id: None,
      document_id: doc_id.clone(),
      page_index: 2,
      page_label: "3".to_string(),
      quote: "Second extracted quote.".to_string(),
      color: "blue".to_string(),
      tags: vec![],
      user_comment: "Second comment".to_string(),
      sort_order: 0,
      created_at: "".to_string(),
      provenance: "user_authored".to_string(),
      original_provenance: None,
    };

    let res2 = db.capture_annotation_to_source_note(&block2).unwrap();
    assert_eq!(res2.note.id, res1.note.id);
    assert_eq!(res2.evidence_block.note_id, res1.note.id);
    assert_eq!(res2.evidence_block.sort_order, 2);

    let blocks = db.get_note_evidence_blocks(&res1.note.id).unwrap();
    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[0].id, "eb-cap-1");
    assert_eq!(blocks[1].id, "eb-cap-2");

    // Retry with a newly generated evidence ID still resolves the same annotation.
    {
      let conn = db.conn.lock().unwrap();
      conn.execute("INSERT INTO document_versions (id, document_id, version_number, sha256_hash, page_count, created_at, provenance) VALUES ('capture-version', ?1, 1, 'hash', 5, '2026-01-01T00:00:00Z', 'source_extracted')", params![doc_id]).unwrap();
      conn.execute("INSERT INTO annotations (id, document_id, document_version_id, annotation_type, page_index, quote, created_at, updated_at, provenance) VALUES ('capture-annotation', ?1, 'capture-version', 'highlight', 0, 'quote', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'user_authored')", params![doc_id]).unwrap();
    }
    let mut annotation_block = block1.clone();
    annotation_block.id = "annotation-capture-1".into();
    annotation_block.annotation_id = Some("capture-annotation".into());
    let captured = db.capture_annotation_to_source_note(&annotation_block).unwrap();
    annotation_block.id = "annotation-capture-retry".into();
    assert_eq!(db.capture_annotation_to_source_note(&annotation_block).unwrap(), captured);
    assert_eq!(db.get_note_evidence_blocks(&res1.note.id).unwrap().len(), 3);
  }
}
