//! Mereth Reader — Full Backup Restore Engine (Task 4.12, RK-17, Appendix A step 13)
//!
//! Validates manifest integrity and restores database records and settings
//! inside a single atomic SQLite transaction.

use crate::db::annotations::validate_asset_relative_path;
use crate::db::Database;
use crate::export::backup::{JsonBackupArchive, BACKUP_SCHEMA_VERSION, JSON_BACKUP_SCHEMA};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RestoreResult {
  pub success: bool,
  pub documents_count: usize,
  pub annotations_count: usize,
  pub notes_count: usize,
  pub prompts_count: usize,
}

/// Restores records from a JSON backup archive into the active database.
pub fn restore_from_backup(db: &Database, app_dir: &Path, backup_json: &str) -> Result<RestoreResult, String> {
  let archive: JsonBackupArchive = serde_json::from_str(backup_json)
    .map_err(|e| format!("Invalid JSON backup format: {e}"))?;

  if archive.schema != JSON_BACKUP_SCHEMA {
    return Err(format!(
      "Unsupported backup schema '{}'; expected '{}'",
      archive.schema, JSON_BACKUP_SCHEMA
    ));
  }

  if archive.schema_version != BACKUP_SCHEMA_VERSION {
    return Err(format!(
      "Unsupported backup version {}; expected {}",
      archive.schema_version, BACKUP_SCHEMA_VERSION
    ));
  }

  let asset_files = archive.asset_files.iter().map(|(relative_path, encoded)| {
    validate_asset_relative_path(relative_path)?;
    let path = Path::new(relative_path);
    if path.is_absolute() || path.components().any(|part| !matches!(part, Component::Normal(_))) {
      return Err(format!("Unsafe asset path in backup: {relative_path}"));
    }
    let bytes = hex::decode(encoded).map_err(|e| format!("Invalid asset data for {relative_path}: {e}"))?;
    Ok((app_dir.join(path), bytes))
  }).collect::<Result<Vec<_>, String>>()?;
  for asset in &archive.assets {
    if !archive.asset_files.contains_key(&asset.relative_path) {
      return Err(format!("Backup is missing file data for asset {}", asset.id));
    }
  }

  let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
  let tx = conn.transaction().map_err(|e| e.to_string())?;

  // 1. Restore Documents
  for doc in &archive.documents {
    let tags_json = serde_json::to_string(&doc.tags).unwrap_or_else(|_| "[]".into());
    let collections_json = serde_json::to_string(&doc.collections).unwrap_or_else(|_| "[]".into());
    tx.execute(
      "INSERT INTO documents (
        id, title, filepath, sha256_hash, page_count, created_at, updated_at, provenance,
        is_favourite, is_archived, last_opened_at, tags, collections, author, subject, keywords,
        creation_date, doi, isbn
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, filepath=excluded.filepath, sha256_hash=excluded.sha256_hash,
        page_count=excluded.page_count, updated_at=excluded.updated_at, provenance=excluded.provenance,
        is_favourite=excluded.is_favourite, is_archived=excluded.is_archived, last_opened_at=excluded.last_opened_at,
        tags=excluded.tags, collections=excluded.collections, author=excluded.author, subject=excluded.subject,
        keywords=excluded.keywords, creation_date=excluded.creation_date, doi=excluded.doi, isbn=excluded.isbn",
      params![
        doc.id,
        doc.title,
        doc.filepath,
        doc.sha256_hash,
        doc.page_count,
        doc.created_at,
        doc.updated_at,
        doc.provenance,
        if doc.is_favourite { 1 } else { 0 },
        if doc.is_archived { 1 } else { 0 },
        doc.last_opened_at,
        tags_json,
        collections_json,
        doc.author,
        doc.subject,
        doc.keywords,
        doc.creation_date,
        doc.doi,
        doc.isbn,
      ],
    )
    .map_err(|e| format!("Failed to restore document {}: {e}", doc.id))?;
  }

  // 1.5. Restore Document Versions
  for ver in &archive.document_versions {
    let geom_json = serde_json::to_string(&ver.page_geometry).unwrap_or_else(|_| "[]".into());
    tx.execute(
      "INSERT INTO document_versions (
        id, document_id, version_number, sha256_hash, page_count, page_geometry_json, created_at, provenance
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT(id) DO UPDATE SET
        document_id=excluded.document_id, version_number=excluded.version_number,
        sha256_hash=excluded.sha256_hash, page_count=excluded.page_count,
        page_geometry_json=excluded.page_geometry_json, provenance=excluded.provenance",
      params![
        ver.id,
        ver.document_id,
        ver.version_number,
        ver.sha256_hash,
        ver.page_count,
        geom_json,
        ver.created_at,
        ver.provenance,
      ],
    )
    .map_err(|e| format!("Failed to restore document version {}: {e}", ver.id))?;
  }

  // 2. Restore Annotations
  for ann in &archive.annotations {
    let rects_json = serde_json::to_string(&ann.rects).unwrap_or_else(|_| "[]".into());
    let tags_json = serde_json::to_string(&ann.tags).unwrap_or_else(|_| "[]".into());
    tx.execute(
      "INSERT INTO annotations (
        id, document_id, document_version_id, checksum, annotation_type, page_index, page_label,
        rects_json, quote, prefix_text, suffix_text, text_layer_checksum, comment, color,
        tags, deleted_at, created_at, updated_at, provenance
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
      ON CONFLICT(id) DO UPDATE SET
        document_id=excluded.document_id, document_version_id=excluded.document_version_id,
        checksum=excluded.checksum, annotation_type=excluded.annotation_type, page_index=excluded.page_index,
        page_label=excluded.page_label, rects_json=excluded.rects_json, quote=excluded.quote,
        prefix_text=excluded.prefix_text, suffix_text=excluded.suffix_text, text_layer_checksum=excluded.text_layer_checksum,
        comment=excluded.comment, color=excluded.color, tags=excluded.tags, deleted_at=excluded.deleted_at,
        updated_at=excluded.updated_at, provenance=excluded.provenance",
      params![
        ann.id,
        ann.document_id,
        ann.document_version_id,
        ann.checksum,
        ann.annotation_type,
        ann.page_index,
        ann.page_label,
        rects_json,
        ann.quote,
        ann.prefix_text,
        ann.suffix_text,
        ann.text_layer_checksum,
        ann.comment,
        ann.color,
        tags_json,
        ann.deleted_at,
        ann.created_at,
        ann.updated_at,
        ann.provenance,
      ],
    )
    .map_err(|e| format!("Failed to restore annotation {}: {e}", ann.id))?;
  }

  // 3. Restore Annotation Assets
  for asset in &archive.assets {
    tx.execute(
      "INSERT INTO annotation_assets (
        id, annotation_id, document_id, asset_kind, relative_path, content_type,
        width_px, height_px, caption, created_at, provenance
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      ON CONFLICT(id) DO UPDATE SET
        annotation_id=excluded.annotation_id, document_id=excluded.document_id, asset_kind=excluded.asset_kind,
        relative_path=excluded.relative_path, content_type=excluded.content_type, width_px=excluded.width_px,
        height_px=excluded.height_px, caption=excluded.caption, provenance=excluded.provenance",
      params![
        asset.id,
        asset.annotation_id,
        asset.document_id,
        asset.asset_kind,
        asset.relative_path,
        asset.content_type,
        asset.width_px,
        asset.height_px,
        asset.caption,
        asset.created_at,
        asset.provenance,
      ],
    )
    .map_err(|e| format!("Failed to restore asset {}: {e}", asset.id))?;
  }

  // 4. Restore Notes
  for note in &archive.notes {
    tx.execute(
      "INSERT INTO notes (
        id, note_type, title, body_markdown, document_id, deleted_at, created_at, updated_at, provenance, original_provenance
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
      ON CONFLICT(id) DO UPDATE SET
        note_type=excluded.note_type, title=excluded.title, body_markdown=excluded.body_markdown,
        document_id=excluded.document_id, deleted_at=excluded.deleted_at, updated_at=excluded.updated_at,
        provenance=excluded.provenance, original_provenance=excluded.original_provenance",
      params![
        note.id,
        note.note_type,
        note.title,
        note.body_markdown,
        note.document_id,
        note.deleted_at,
        note.created_at,
        note.updated_at,
        note.provenance,
        note.original_provenance,
      ],
    )
    .map_err(|e| format!("Failed to restore note {}: {e}", note.id))?;
  }

  for block in &archive.evidence_blocks {
    let tags_json = serde_json::to_string(&block.tags).map_err(|e| e.to_string())?;
    tx.execute(
      "INSERT INTO evidence_blocks (id, note_id, source_kind, annotation_id, image_asset_id, document_id, page_index, page_label, quote, color, tags, user_comment, sort_order, created_at, provenance, original_provenance)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
       ON CONFLICT(id) DO UPDATE SET note_id=excluded.note_id, source_kind=excluded.source_kind, annotation_id=excluded.annotation_id, image_asset_id=excluded.image_asset_id, document_id=excluded.document_id, page_index=excluded.page_index, page_label=excluded.page_label, quote=excluded.quote, color=excluded.color, tags=excluded.tags, user_comment=excluded.user_comment, sort_order=excluded.sort_order, provenance=excluded.provenance, original_provenance=excluded.original_provenance",
      params![block.id, block.note_id, block.source_kind, block.annotation_id, block.image_asset_id, block.document_id, block.page_index, block.page_label, block.quote, block.color, tags_json, block.user_comment, block.sort_order, block.created_at, block.provenance, block.original_provenance],
    ).map_err(|e| format!("Failed to restore evidence block {}: {e}", block.id))?;
  }

  // 5. Restore Note Revisions
  for rev in &archive.note_revisions {
    tx.execute(
      "INSERT INTO note_revisions (
        id, note_id, revision_number, title, body_markdown, created_at, provenance, original_provenance
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT(id) DO UPDATE SET
        note_id=excluded.note_id, revision_number=excluded.revision_number, title=excluded.title,
        body_markdown=excluded.body_markdown, created_at=excluded.created_at, provenance=excluded.provenance,
        original_provenance=excluded.original_provenance",
      params![
        rev.id,
        rev.note_id,
        rev.revision_number,
        rev.title,
        rev.body_markdown,
        rev.created_at,
        rev.provenance,
        rev.original_provenance,
      ],
    )
    .map_err(|e| format!("Failed to restore revision {}: {e}", rev.id))?;
  }

  // 6. Restore Note Links
  for link in &archive.links {
    tx.execute(
      "INSERT INTO note_links (
        id, note_id, target_note_id, target_document_id, target_annotation_id, created_at, provenance, original_provenance
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT(id) DO UPDATE SET
        note_id=excluded.note_id, target_note_id=excluded.target_note_id, target_document_id=excluded.target_document_id,
        target_annotation_id=excluded.target_annotation_id, created_at=excluded.created_at, provenance=excluded.provenance,
        original_provenance=excluded.original_provenance",
      params![
        link.id,
        link.note_id,
        link.target_note_id,
        link.target_document_id,
        link.target_annotation_id,
        link.created_at,
        link.provenance,
        link.original_provenance,
      ],
    )
    .map_err(|e| format!("Failed to restore note link {}: {e}", link.id))?;
  }

  // 7. Restore Review Prompts
  for prompt in &archive.prompts {
    tx.execute(
      "INSERT INTO review_prompts (
        id, annotation_id, note_id, prompt_type, question, answer, status, adopted_at, cue, priority, paused_at, created_at, updated_at, provenance
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
      ON CONFLICT(id) DO UPDATE SET
        annotation_id=excluded.annotation_id, note_id=excluded.note_id, prompt_type=excluded.prompt_type,
        question=excluded.question, answer=excluded.answer, status=excluded.status, adopted_at=excluded.adopted_at,
        cue=excluded.cue, priority=excluded.priority, paused_at=excluded.paused_at, updated_at=excluded.updated_at,
        provenance=excluded.provenance",
      params![
        prompt.id,
        prompt.annotation_id,
        prompt.note_id,
        prompt.prompt_type,
        prompt.question,
        prompt.answer,
        prompt.status,
        prompt.adopted_at,
        prompt.cue,
        prompt.priority,
        prompt.paused_at,
        prompt.created_at,
        prompt.updated_at,
        prompt.provenance,
      ],
    )
    .map_err(|e| format!("Failed to restore review prompt {}: {e}", prompt.id))?;
  }

  // 8. Restore Review Events
  for event in &archive.review_events {
    tx.execute(
      "INSERT INTO review_events (
        id, prompt_id, reviewed_at, outcome, duration_ms, user_response, provenance
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT(id) DO UPDATE SET
        prompt_id=excluded.prompt_id, reviewed_at=excluded.reviewed_at, outcome=excluded.outcome,
        duration_ms=excluded.duration_ms, user_response=excluded.user_response, provenance=excluded.provenance",
      params![
        event.id,
        event.prompt_id,
        event.reviewed_at,
        event.outcome,
        event.duration_ms,
        event.user_response,
        event.provenance,
      ],
    )
    .map_err(|e| format!("Failed to restore review event {}: {e}", event.id))?;
  }

  // 9. Restore Review Schedules
  for sched in &archive.review_schedules {
    tx.execute(
      "INSERT INTO review_schedule (
        prompt_id, desired_retention, state, stability, difficulty, due_at, last_reviewed_at, last_outcome, fsrs_version, updated_at, provenance
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      ON CONFLICT(prompt_id) DO UPDATE SET
        desired_retention=excluded.desired_retention, state=excluded.state, stability=excluded.stability,
        difficulty=excluded.difficulty, due_at=excluded.due_at, last_reviewed_at=excluded.last_reviewed_at,
        last_outcome=excluded.last_outcome, fsrs_version=excluded.fsrs_version, updated_at=excluded.updated_at,
        provenance=excluded.provenance",
      params![
        sched.prompt_id,
        sched.desired_retention,
        sched.state,
        sched.stability,
        sched.difficulty,
        sched.due_at,
        sched.last_reviewed_at,
        sched.last_outcome,
        sched.fsrs_version,
        sched.updated_at,
        sched.provenance,
      ],
    )
    .map_err(|e| format!("Failed to restore review schedule for {}: {e}", sched.prompt_id))?;
  }

  // 10. Restore Settings
  for (key, val) in &archive.settings {
    tx.execute(
      "INSERT INTO settings (key, value, updated_at)
       VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
      params![key, val],
    )
    .map_err(|e| format!("Failed to restore setting {key}: {e}"))?;
  }

  tx.commit().map_err(|e| e.to_string())?;

  for (path, bytes) in asset_files {
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent).map_err(|e| format!("Failed to create restored asset directory: {e}"))?;
    }
    fs::write(&path, bytes).map_err(|e| format!("Failed to restore asset file {}: {e}", path.display()))?;
  }

  Ok(RestoreResult {
    success: true,
    documents_count: archive.documents.len(),
    annotations_count: archive.annotations.len(),
    notes_count: archive.notes.len(),
    prompts_count: archive.prompts.len(),
  })
}
