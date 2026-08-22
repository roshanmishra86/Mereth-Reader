//! Mereth Reader — Export Subsystem (PRD R4, Tasks 4.8, 4.10, 4.12)
//!
//! Provides portable, non-destructive exports and backups:
//! - Standalone Markdown package export with manifest (FR-14.1, FR-14.2)
//! - Full versioned JSON backup and atomic restore (FR-14.4, Task 4.12)
//! - RFC 4180 CSV and TSV review prompt export (FR-14.5, Task 4.10)

pub mod backup;
pub mod markdown;
pub mod restore;
pub mod review_csv;

pub use backup::create_json_backup;
pub use markdown::export_markdown_package;
pub use restore::restore_from_backup;
pub use review_csv::export_review_csv;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExportRecord {
  pub id: String,
  pub export_kind: String,
  pub destination_path: String,
  #[serde(default)]
  pub manifest_path: Option<String>,
  pub status: String,
  #[serde(default)]
  pub error: Option<String>,
  pub items_count: i64,
  pub created_at: String,
  pub updated_at: String,
  pub provenance: String,
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::annotations::Annotation;
  use crate::db::evidence::EvidenceBlock;
  use crate::db::notes::Note;
  use crate::db::prompts::ReviewPrompt;
  use crate::db::{Database, Document};
  use rusqlite::params;
  use tempfile::TempDir;

  fn test_db_with_data() -> (Database, TempDir, Document, Note, ReviewPrompt) {
    let tmp = TempDir::new().unwrap();
    let db = Database::new(tmp.path()).unwrap();

    let doc = Document {
      id: "doc-1".to_string(),
      title: "Test Document".to_string(),
      filepath: "/path/to/test.pdf".to_string(),
      sha256_hash: "a".repeat(64),
      page_count: 10,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "source_extracted".to_string(),
      author: Some("Author Name".to_string()),
      subject: None,
      keywords: None,
      creation_date: None,
      doi: Some("10.1234/test".to_string()),
      isbn: None,
      is_favourite: false,
      is_archived: false,
      last_opened_at: None,
      tags: vec!["research".to_string()],
      collections: vec![],
    };
    db.add_document(doc.clone()).unwrap();

    let version_id = "ver-1".to_string();
    {
      let conn = db.conn.lock().unwrap();
      conn
        .execute(
          "INSERT INTO document_versions (id, document_id, version_number, sha256_hash, page_count, created_at, provenance)
           VALUES (?1, ?2, 1, ?3, 10, '2026-08-21T00:00:00Z', 'source_extracted')",
          params![version_id, "doc-1", "a".repeat(64)],
        )
        .unwrap();
    }

    let ann = Annotation {
      id: "ann-1".to_string(),
      document_id: "doc-1".to_string(),
      document_version_id: version_id,
      checksum: "chk123".to_string(),
      annotation_type: "highlight".to_string(),
      page_index: 0,
      page_label: "1".to_string(),
      rects: vec![],
      quote: "Key discovery passage".to_string(),
      prefix_text: "".to_string(),
      suffix_text: "".to_string(),
      text_layer_checksum: None,
      comment: "Important point".to_string(),
      color: "yellow".to_string(),
      tags: vec!["finding".to_string()],
      deleted_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
    };
    db.add_annotation(&ann).unwrap();

    let note = Note {
      id: "note-1".to_string(),
      note_type: "concept".to_string(),
      title: "Testing enhances memory".to_string(),
      body_markdown: "Retrieval practice produces durable memory.".to_string(),
      document_id: None,
      deleted_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
      original_provenance: None,
    };
    db.add_note(&note).unwrap();

    let prompt = ReviewPrompt {
      id: "prompt-1".to_string(),
      annotation_id: Some("ann-1".to_string()),
      note_id: None,
      prompt_type: "focused_qa".to_string(),
      question: "Why is retrieval practice effective?".to_string(),
      answer: "It strengthens neural retrieval pathways.".to_string(),
      status: "adopted".to_string(),
      adopted_at: Some("2026-08-21T00:00:00Z".to_string()),
      cue: "Memory mechanism".to_string(),
      priority: 1,
      paused_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
    };
    db.create_review_prompt(&prompt).unwrap();

    (db, tmp, doc, note, prompt)
  }

  #[test]
  fn test_export_markdown_package() {
    let (db, tmp, _doc, _note, _prompt) = test_db_with_data();
    let export_dir = tmp.path().join("exported_markdown");

    let manifest = export_markdown_package(&db, tmp.path(), &export_dir.to_string_lossy()).unwrap();

    assert_eq!(manifest.schema, "mereth.markdown-package");
    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.notes.len(), 1);
    assert_eq!(manifest.sources.len(), 1);
    assert_eq!(manifest.reviews.len(), 1);

    assert!(export_dir.join("notes/note-1.md").exists());
    assert!(export_dir.join("sources/source_doc-1.md").exists());
    assert!(export_dir.join("reviews/review_prompts.md").exists());
    assert!(export_dir.join("manifest.json").exists());

    let note_content = std::fs::read_to_string(export_dir.join("notes/note-1.md")).unwrap();
    assert!(note_content.contains("title: \"Testing enhances memory\""));
    assert!(note_content.contains("Retrieval practice produces durable memory."));
  }

  #[test]
  fn test_create_json_backup_and_restore_roundtrip() {
    let (db, tmp, doc, note, prompt) = test_db_with_data();
    db.add_evidence_block(&EvidenceBlock {
      id: "evidence-1".to_string(), note_id: note.id.clone(), source_kind: "quote".to_string(),
      annotation_id: Some("ann-1".to_string()), image_asset_id: None, document_id: doc.id.clone(),
      page_index: 0, page_label: "1".to_string(), quote: "Key discovery passage".to_string(),
      color: "yellow".to_string(), tags: vec!["finding".to_string()], user_comment: "My comment".to_string(),
      sort_order: 1, created_at: "2026-08-21T00:00:00Z".to_string(), provenance: "source_extracted".to_string(), original_provenance: None,
    }).unwrap();
    let backup_file = tmp.path().join("backup.json");

    let backup_archive = create_json_backup(&db, tmp.path(), Some(&backup_file.to_string_lossy())).unwrap();

    assert_eq!(backup_archive.schema, "mereth.json-backup");
    assert_eq!(backup_archive.schema_version, 1);
    assert_eq!(backup_archive.documents.len(), 1);
    assert_eq!(backup_archive.notes.len(), 1);
    assert_eq!(backup_archive.prompts.len(), 1);
    assert_eq!(backup_archive.evidence_blocks.len(), 1);
    assert!(backup_file.exists());

    let backup_json = std::fs::read_to_string(&backup_file).unwrap();

    // Now restore into a fresh clean database
    let clean_tmp = TempDir::new().unwrap();
    let clean_db = Database::new(clean_tmp.path()).unwrap();

    let restore_result = restore_from_backup(&clean_db, clean_tmp.path(), &backup_json).unwrap();
    assert!(restore_result.success);
    assert_eq!(restore_result.documents_count, 1);
    assert_eq!(restore_result.notes_count, 1);
    assert_eq!(restore_result.prompts_count, 1);

    let restored_doc = clean_db.get_document_by_id(&doc.id).unwrap().unwrap();
    assert_eq!(restored_doc.title, doc.title);

    let restored_note = clean_db.get_note(&note.id).unwrap().unwrap();
    assert_eq!(restored_note.title, note.title);

    let restored_prompt = clean_db.get_review_prompt(&prompt.id).unwrap().unwrap();
    assert_eq!(restored_prompt.question, prompt.question);
    let restored_evidence = clean_db.get_note_evidence_blocks(&note.id).unwrap();
    assert_eq!(restored_evidence.len(), 1);
    assert_eq!(restored_evidence[0].quote, "Key discovery passage");
  }

  #[test]
  fn test_export_review_csv_and_tsv() {
    let (db, tmp, _doc, _note, _prompt) = test_db_with_data();

    let csv_file = tmp.path().join("reviews.csv");
    let count_csv = export_review_csv(&db, &csv_file.to_string_lossy(), Some(",")).unwrap();
    assert_eq!(count_csv, 1);
    assert!(csv_file.exists());

    let csv_content = std::fs::read_to_string(&csv_file).unwrap();
    assert!(csv_content.starts_with("id,prompt_type,question,answer,cue,priority,status"));
    assert!(csv_content.contains("Why is retrieval practice effective?"));

    let tsv_file = tmp.path().join("reviews.tsv");
    let count_tsv = export_review_csv(&db, &tsv_file.to_string_lossy(), Some("\t")).unwrap();
    assert_eq!(count_tsv, 1);
    assert!(tsv_file.exists());

    let tsv_content = std::fs::read_to_string(&tsv_file).unwrap();
    assert!(tsv_content.starts_with("id\tprompt_type\tquestion\tanswer"));
  }
}
