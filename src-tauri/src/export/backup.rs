//! Mereth Reader — Full Versioned JSON Backup (Task 4.8, FR-14.4)
//!
//! Exports all SQLite tables, annotations, assets, notes, links, prompts, review events,
//! and settings into a single versioned JSON archive (schema: `mereth.json-backup`).

use crate::db::annotations::{validate_asset_relative_path, Annotation, AnnotationAsset};
use crate::db::evidence::EvidenceBlock;
use crate::db::note_links::NoteLink;
use crate::db::notes::{Note, NoteRevision};
use crate::db::prompts::ReviewPrompt;
use crate::db::review::{ReviewEvent, ReviewSchedule};
use crate::db::versions::DocumentVersion;
use crate::db::{Database, Document};
use crate::export::markdown::record_export;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

pub const JSON_BACKUP_SCHEMA: &str = "mereth.json-backup";
pub const BACKUP_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JsonBackupArchive {
  pub schema: String,
  pub schema_version: i64,
  pub exported_at: String,
  pub documents: Vec<Document>,
  #[serde(default)]
  pub document_versions: Vec<DocumentVersion>,
  pub annotations: Vec<Annotation>,
  pub assets: Vec<AnnotationAsset>,
  #[serde(default)]
  pub asset_files: HashMap<String, String>,
  #[serde(default)]
  pub evidence_blocks: Vec<EvidenceBlock>,
  pub notes: Vec<Note>,
  pub note_revisions: Vec<NoteRevision>,
  pub links: Vec<NoteLink>,
  pub prompts: Vec<ReviewPrompt>,
  pub review_events: Vec<ReviewEvent>,
  pub review_schedules: Vec<ReviewSchedule>,
  pub settings: HashMap<String, String>,
  pub provenance: HashMap<String, Option<String>>,
}

/// Creates a complete JSON backup archive from the database.
pub fn create_json_backup(
  db: &Database,
  app_dir: &Path,
  destination_file: Option<&str>,
) -> Result<JsonBackupArchive, String> {
  let (documents, document_versions, annotations, assets, evidence_blocks, notes, note_revisions, links, prompts, review_events, review_schedules, settings) = {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // 1. Fetch documents
    let mut doc_stmt = conn
      .prepare("SELECT id, title, filepath, sha256_hash, page_count, created_at, updated_at, provenance, is_favourite, is_archived, last_opened_at, tags, collections, author, subject, keywords, creation_date, doi, isbn, ownership_mode, original_filepath, removed_at FROM documents")
      .map_err(|e| e.to_string())?;

    let docs: Vec<Document> = doc_stmt
      .query_map([], |row| {
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
          ownership_mode: row.get(19).unwrap_or_else(|_| "open_in_place".into()),
          original_filepath: row.get(20).unwrap_or(None),
          removed_at: row.get(21).unwrap_or(None),
        })
      })
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;

    // 1.5. Fetch document versions
    let mut ver_stmt = conn
      .prepare("SELECT id, document_id, version_number, sha256_hash, page_count, page_geometry_json, created_at, provenance FROM document_versions")
      .map_err(|e| e.to_string())?;

    let vers: Vec<DocumentVersion> = ver_stmt
      .query_map([], |row| {
        let geom_str: String = row.get(5).unwrap_or_else(|_| "[]".into());
        Ok(DocumentVersion {
          id: row.get(0)?,
          document_id: row.get(1)?,
          version_number: row.get(2)?,
          sha256_hash: row.get(3)?,
          page_count: row.get(4)?,
          page_geometry: serde_json::from_str(&geom_str).unwrap_or_default(),
          created_at: row.get(6)?,
          provenance: row.get(7)?,
        })
      })
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;

    // 2. Fetch annotations
    let mut ann_stmt = conn
      .prepare("SELECT id, document_id, document_version_id, checksum, annotation_type, page_index, page_label, rects_json, quote, prefix_text, suffix_text, text_layer_checksum, comment, color, tags, deleted_at, created_at, updated_at, provenance FROM annotations")
      .map_err(|e| e.to_string())?;

    let anns: Vec<Annotation> = ann_stmt
      .query_map([], |row| {
        let rects_str: String = row.get(7)?;
        let tags_str: String = row.get(14)?;
        Ok(Annotation {
          id: row.get(0)?,
          document_id: row.get(1)?,
          document_version_id: row.get(2)?,
          checksum: row.get(3)?,
          annotation_type: row.get(4)?,
          page_index: row.get(5)?,
          page_label: row.get(6)?,
          rects: serde_json::from_str(&rects_str).unwrap_or_default(),
          quote: row.get(8)?,
          prefix_text: row.get(9)?,
          suffix_text: row.get(10)?,
          text_layer_checksum: row.get(11)?,
          comment: row.get(12)?,
          color: row.get(13)?,
          tags: serde_json::from_str(&tags_str).unwrap_or_default(),
          deleted_at: row.get(15)?,
          created_at: row.get(16)?,
          updated_at: row.get(17)?,
          provenance: row.get(18)?,
        })
      })
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;

    // 3. Fetch annotation assets
    let mut asset_stmt = conn
      .prepare("SELECT id, annotation_id, document_id, asset_kind, relative_path, content_type, width_px, height_px, caption, created_at, provenance FROM annotation_assets")
      .map_err(|e| e.to_string())?;

    let asts: Vec<AnnotationAsset> = asset_stmt
      .query_map([], |row| {
        Ok(AnnotationAsset {
          id: row.get(0)?,
          annotation_id: row.get(1)?,
          document_id: row.get(2)?,
          asset_kind: row.get(3)?,
          relative_path: row.get(4)?,
          content_type: row.get(5)?,
          width_px: row.get(6)?,
          height_px: row.get(7)?,
          caption: row.get(8)?,
          created_at: row.get(9)?,
          provenance: row.get(10)?,
        })
      })
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;

    let mut evidence_stmt = conn
      .prepare("SELECT id, note_id, source_kind, annotation_id, image_asset_id, document_id, page_index, page_label, quote, color, tags, user_comment, sort_order, created_at, provenance, original_provenance FROM evidence_blocks")
      .map_err(|e| e.to_string())?;
    let evidence: Vec<EvidenceBlock> = evidence_stmt.query_map([], |row| {
      let tags_json: String = row.get(10)?;
      let tags = serde_json::from_str(&tags_json).map_err(|e| rusqlite::Error::FromSqlConversionFailure(10, rusqlite::types::Type::Text, Box::new(e)))?;
      Ok(EvidenceBlock { id: row.get(0)?, note_id: row.get(1)?, source_kind: row.get(2)?, annotation_id: row.get(3)?, image_asset_id: row.get(4)?, document_id: row.get(5)?, page_index: row.get(6)?, page_label: row.get(7)?, quote: row.get(8)?, color: row.get(9)?, tags, user_comment: row.get(11)?, sort_order: row.get(12)?, created_at: row.get(13)?, provenance: row.get(14)?, original_provenance: row.get(15)? })
    }).map_err(|e| e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;

    // 4. Fetch notes
    let mut notes_stmt = conn
      .prepare("SELECT id, note_type, title, body_markdown, document_id, deleted_at, created_at, updated_at, provenance, original_provenance FROM notes")
      .map_err(|e| e.to_string())?;

    let nts: Vec<Note> = notes_stmt
      .query_map([], |row| {
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
      })
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;

    // 5. Fetch note revisions
    let mut rev_stmt = conn
      .prepare("SELECT id, note_id, revision_number, title, body_markdown, created_at, provenance, original_provenance FROM note_revisions")
      .map_err(|e| e.to_string())?;

    let revs: Vec<NoteRevision> = rev_stmt
      .query_map([], |row| {
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
      })
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;

    // 6. Fetch note links
    let mut link_stmt = conn
      .prepare("SELECT id, note_id, target_note_id, target_document_id, target_annotation_id, created_at, provenance, original_provenance FROM note_links")
      .map_err(|e| e.to_string())?;

    let lnks: Vec<NoteLink> = link_stmt
      .query_map([], |row| {
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
      })
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;

    // 7. Fetch review prompts
    let mut prompt_stmt = conn
      .prepare("SELECT id, annotation_id, note_id, prompt_type, question, answer, status, adopted_at, cue, priority, paused_at, created_at, updated_at, provenance FROM review_prompts")
      .map_err(|e| e.to_string())?;

    let pmpts: Vec<ReviewPrompt> = prompt_stmt
      .query_map([], |row| {
        Ok(ReviewPrompt {
          id: row.get(0)?,
          annotation_id: row.get(1)?,
          note_id: row.get(2)?,
          prompt_type: row.get(3)?,
          question: row.get(4)?,
          answer: row.get(5)?,
          status: row.get(6)?,
          adopted_at: row.get(7)?,
          cue: row.get(8)?,
          priority: row.get(9)?,
          paused_at: row.get(10)?,
          created_at: row.get(11)?,
          updated_at: row.get(12)?,
          provenance: row.get(13)?,
        })
      })
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;

    // 8. Fetch review events
    let mut event_stmt = conn
      .prepare("SELECT id, prompt_id, reviewed_at, outcome, duration_ms, user_response, provenance FROM review_events")
      .map_err(|e| e.to_string())?;

    let evts: Vec<ReviewEvent> = event_stmt
      .query_map([], |row| {
        Ok(ReviewEvent {
          id: row.get(0)?,
          prompt_id: row.get(1)?,
          reviewed_at: row.get(2)?,
          outcome: row.get(3)?,
          duration_ms: row.get(4)?,
          user_response: row.get(5)?,
          provenance: row.get(6)?,
        })
      })
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;

    // 9. Fetch review schedules
    let mut sched_stmt = conn
      .prepare("SELECT prompt_id, desired_retention, state, stability, difficulty, due_at, last_reviewed_at, last_outcome, fsrs_version, updated_at, provenance FROM review_schedule")
      .map_err(|e| e.to_string())?;

    let scheds: Vec<ReviewSchedule> = sched_stmt
      .query_map([], |row| {
        Ok(ReviewSchedule {
          prompt_id: row.get(0)?,
          desired_retention: row.get(1)?,
          state: row.get(2)?,
          stability: row.get(3)?,
          difficulty: row.get(4)?,
          due_at: row.get(5)?,
          last_reviewed_at: row.get(6)?,
          last_outcome: row.get(7)?,
          fsrs_version: row.get(8)?,
          updated_at: row.get(9)?,
          provenance: row.get(10)?,
        })
      })
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;

    // 10. Fetch settings
    let mut settings_stmt = conn
      .prepare("SELECT key, value FROM settings")
      .map_err(|e| e.to_string())?;

    let mut stgs = HashMap::new();
    let setting_rows = settings_stmt
      .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
      .map_err(|e| e.to_string())?;

    for r in setting_rows {
      let (k, v) = r.map_err(|e| e.to_string())?;
      stgs.insert(k, v);
    }

    (docs, vers, anns, asts, evidence, nts, revs, lnks, pmpts, evts, scheds, stgs)
  };

  let mut asset_files = HashMap::new();
  for asset in &assets {
    validate_asset_relative_path(&asset.relative_path)?;
    let bytes = fs::read(app_dir.join(&asset.relative_path))
      .map_err(|e| format!("Failed to read backup asset {}: {e}", asset.id))?;
    asset_files.insert(asset.relative_path.clone(), hex::encode(bytes));
  }

  let now_ts = {
    let now = std::time::SystemTime::now();
    let secs = now.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    format!("{secs}")
  };

  let backup = JsonBackupArchive {
    schema: JSON_BACKUP_SCHEMA.to_string(),
    schema_version: BACKUP_SCHEMA_VERSION,
    exported_at: now_ts,
    documents,
    document_versions,
    annotations,
    assets,
    asset_files,
    evidence_blocks,
    notes,
    note_revisions,
    links,
    prompts,
    review_events,
    review_schedules,
    settings,
    provenance: HashMap::new(),
  };

  // If destination file is given, write JSON archive
  if let Some(dest_file) = destination_file {
    if !dest_file.trim().is_empty() {
      let dest_p = Path::new(dest_file);
      if let Some(parent) = dest_p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
      }

      let backup_json = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
      fs::write(dest_p, format!("{backup_json}\n")).map_err(|e| format!("Failed to write JSON backup: {e}"))?;

      let total_items = (backup.documents.len()
        + backup.annotations.len()
        + backup.notes.len()
        + backup.prompts.len()) as i64;

      record_export(
        db,
        "json_backup",
        dest_file,
        None,
        "completed",
        None,
        total_items,
      )?;
    }
  }

  Ok(backup)
}
