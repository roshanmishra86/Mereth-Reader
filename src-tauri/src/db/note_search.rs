//! Task 4.3 — Full-text search across notes with text role identification (PRD R3, FR-10.9).
//!
//! Searches across titles, prose, evidence excerpts, user comments, and tags,
//! returning structured results tagged with the matched text role.

use super::Database;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NoteSearchResult {
  pub note_id: String,
  pub note_title: String,
  pub note_type: String,
  pub text_role: String, // 'title' | 'prose' | 'evidence_quote' | 'evidence_comment' | 'tag'
  pub matched_text: String,
  pub snippet: String,
}

fn extract_snippet(text: &str, query: &str, max_len: usize) -> String {
  let lower_text = text.to_lowercase();
  let lower_query = query.to_lowercase();

  if let Some(pos) = lower_text.find(&lower_query) {
    let mut start = pos.saturating_sub(30).min(text.len());
    while start > 0 && !text.is_char_boundary(start) { start -= 1; }
    let mut end = (pos + query.len() + 50).min(text.len());
    while end < text.len() && !text.is_char_boundary(end) { end += 1; }
    let mut snippet = text[start..end].to_string();
    if start > 0 {
      snippet = format!("…{snippet}");
    }
    if end < text.len() {
      snippet = format!("{snippet}…");
    }
    snippet
  } else if text.len() > max_len {
    let mut end = max_len.min(text.len());
    while end > 0 && !text.is_char_boundary(end) { end -= 1; }
    format!("{}…", &text[..end])
  } else {
    text.to_string()
  }
}

#[cfg(test)]
mod snippet_tests {
  use super::extract_snippet;

  #[test]
  fn unicode_snippets_never_slice_between_code_points() {
    let text = format!("{}needle{}", "é".repeat(40), "界".repeat(40));
    assert!(extract_snippet(&text, "needle", 80).contains("needle"));
    assert!(extract_snippet(&"界".repeat(100), "missing", 80).ends_with('…'));
  }
}

impl Database {
  /// Searches across all note content and attached evidence, tagging results with their text role.
  pub fn search_notes(
    &self,
    query: &str,
    note_type_filter: Option<&str>,
  ) -> Result<Vec<NoteSearchResult>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
      return Ok(Vec::new());
    }

    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let like_pattern = format!("%{trimmed}%");

    let mut results = Vec::new();

    // 1. Search note titles
    {
      let mut stmt = conn
        .prepare(
          "SELECT id, title, note_type, title
           FROM notes
           WHERE deleted_at IS NULL AND title LIKE ?1
           AND (?2 IS NULL OR note_type = ?2)
           ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

      let rows = stmt
        .query_map(params![like_pattern, note_type_filter], |r| {
          let title: String = r.get(1)?;
          let snippet = extract_snippet(&title, trimmed, 80);
          Ok(NoteSearchResult {
            note_id: r.get(0)?,
            note_title: title.clone(),
            note_type: r.get(2)?,
            text_role: "title".to_string(),
            matched_text: title,
            snippet,
          })
        })
        .map_err(|e| e.to_string())?;

      for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
      }
    }

    // 2. Search note body prose
    {
      let mut stmt = conn
        .prepare(
          "SELECT id, title, note_type, body_markdown
           FROM notes
           WHERE deleted_at IS NULL AND body_markdown LIKE ?1
           AND (?2 IS NULL OR note_type = ?2)
           ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

      let rows = stmt
        .query_map(params![like_pattern, note_type_filter], |r| {
          let body: String = r.get(3)?;
          let snippet = extract_snippet(&body, trimmed, 100);
          Ok(NoteSearchResult {
            note_id: r.get(0)?,
            note_title: r.get(1)?,
            note_type: r.get(2)?,
            text_role: "prose".to_string(),
            matched_text: body,
            snippet,
          })
        })
        .map_err(|e| e.to_string())?;

      for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
      }
    }

    // 3. Search evidence quotes
    {
      let mut stmt = conn
        .prepare(
          "SELECT n.id, n.title, n.note_type, e.quote
           FROM evidence_blocks e
           JOIN notes n ON e.note_id = n.id
           WHERE n.deleted_at IS NULL AND e.quote LIKE ?1
           AND (?2 IS NULL OR n.note_type = ?2)
           ORDER BY e.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

      let rows = stmt
        .query_map(params![like_pattern, note_type_filter], |r| {
          let quote: String = r.get(3)?;
          let snippet = extract_snippet(&quote, trimmed, 100);
          Ok(NoteSearchResult {
            note_id: r.get(0)?,
            note_title: r.get(1)?,
            note_type: r.get(2)?,
            text_role: "evidence_quote".to_string(),
            matched_text: quote,
            snippet,
          })
        })
        .map_err(|e| e.to_string())?;

      for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
      }
    }

    // 4. Search evidence comments
    {
      let mut stmt = conn
        .prepare(
          "SELECT n.id, n.title, n.note_type, e.user_comment
           FROM evidence_blocks e
           JOIN notes n ON e.note_id = n.id
           WHERE n.deleted_at IS NULL AND e.user_comment LIKE ?1 AND e.user_comment != ''
           AND (?2 IS NULL OR n.note_type = ?2)
           ORDER BY e.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

      let rows = stmt
        .query_map(params![like_pattern, note_type_filter], |r| {
          let comment: String = r.get(3)?;
          let snippet = extract_snippet(&comment, trimmed, 100);
          Ok(NoteSearchResult {
            note_id: r.get(0)?,
            note_title: r.get(1)?,
            note_type: r.get(2)?,
            text_role: "evidence_comment".to_string(),
            matched_text: comment,
            snippet,
          })
        })
        .map_err(|e| e.to_string())?;

      for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
      }
    }

    // 5. Search tags
    {
      let mut stmt = conn
        .prepare(
          "SELECT n.id, n.title, n.note_type, e.tags
           FROM evidence_blocks e
           JOIN notes n ON e.note_id = n.id
           WHERE n.deleted_at IS NULL AND e.tags LIKE ?1 AND e.tags != '[]'
           AND (?2 IS NULL OR n.note_type = ?2)
           ORDER BY e.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

      let rows = stmt
        .query_map(params![like_pattern, note_type_filter], |r| {
          let tags_raw: String = r.get(3)?;
          Ok(NoteSearchResult {
            note_id: r.get(0)?,
            note_title: r.get(1)?,
            note_type: r.get(2)?,
            text_role: "tag".to_string(),
            matched_text: tags_raw.clone(),
            snippet: format!("Tag: {tags_raw}"),
          })
        })
        .map_err(|e| e.to_string())?;

      for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
      }
    }

    Ok(results)
  }
}

#[cfg(test)]
pub mod tests {
  use crate::db::evidence::EvidenceBlock;
  use crate::db::notes::Note;
  use crate::db::Database;
  use tempfile::TempDir;

  fn test_db() -> (Database, TempDir) {
    let tmp = TempDir::new().unwrap();
    let db = Database::new(tmp.path()).unwrap();
    (db, tmp)
  }

  #[test]
  fn test_search_notes_by_different_roles() {
    let (db, _tmp) = test_db();

    // 1. Create document
    let doc = crate::db::Document {
      id: "doc-s-1".to_string(),
      title: "Memory Foundations".to_string(),
      filepath: "/path/to/doc.pdf".to_string(),
      sha256_hash: "hash1234hash1234hash1234hash1234hash1234hash1234hash1234hash1234".to_string(),
      page_count: 10,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "source_extracted".to_string(),
      author: Some("Ebbinghaus".to_string()),
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

    // 2. Create note
    let note = Note {
      id: "note-search-1".to_string(),
      note_type: "concept".to_string(),
      title: "Forgetting Curve Dynamics".to_string(),
      body_markdown: "Decay slows dramatically after each spaced retrieval attempt.".to_string(),
      document_id: Some("doc-s-1".to_string()),
      deleted_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
      original_provenance: None,
    };
    db.add_note(&note).unwrap();

    // 3. Create evidence block
    let evidence = EvidenceBlock {
      id: "eb-search-1".to_string(),
      note_id: "note-search-1".to_string(),
      source_kind: "quote".to_string(),
      annotation_id: None,
      image_asset_id: None,
      document_id: "doc-s-1".to_string(),
      page_index: 0,
      page_label: "1".to_string(),
      quote: "Initial memory loss is steepest within first hour.".to_string(),
      color: "yellow".to_string(),
      tags: vec!["decay".to_string(), "retention".to_string()],
      user_comment: "Supports hyperbolic decay curve model".to_string(),
      sort_order: 1,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "source_extracted".to_string(),
      original_provenance: None,
    };
    db.add_evidence_block(&evidence).unwrap();

    // Search by title match
    let title_res = db.search_notes("Forgetting", None).unwrap();
    assert_eq!(title_res.len(), 1);
    assert_eq!(title_res[0].text_role, "title");

    // Search by prose match
    let prose_res = db.search_notes("retrieval attempt", None).unwrap();
    assert_eq!(prose_res.len(), 1);
    assert_eq!(prose_res[0].text_role, "prose");

    // Search by quote match
    let quote_res = db.search_notes("steepest", None).unwrap();
    assert_eq!(quote_res.len(), 1);
    assert_eq!(quote_res[0].text_role, "evidence_quote");

    // Search by comment match
    let comment_res = db.search_notes("hyperbolic decay", None).unwrap();
    assert_eq!(comment_res.len(), 1);
    assert_eq!(comment_res[0].text_role, "evidence_comment");

    // Search by tag match
    let tag_res = db.search_notes("retention", None).unwrap();
    assert_eq!(tag_res.len(), 1);
    assert_eq!(tag_res[0].text_role, "tag");
  }
}
