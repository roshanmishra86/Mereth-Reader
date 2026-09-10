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
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

const RESTORE_JOURNAL_PREFIX: &str = ".restore_journal_";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RestoreJournal {
  staging_dir: PathBuf,
  backup_dir: PathBuf,
  replaced_assets: Vec<PathBuf>,
  created_assets: Vec<PathBuf>,
  #[serde(default)]
  committed: bool,
  #[serde(default)]
  phase: String,
}

fn write_journal(path: &Path, journal: &RestoreJournal) -> Result<(), String> {
  let bytes = serde_json::to_vec_pretty(journal).map_err(|e| format!("Failed to encode restore journal: {e}"))?;
  let temp = path.with_extension("tmp");
  let mut file = fs::File::create(&temp).map_err(|e| format!("Failed to create restore journal: {e}"))?;
  use std::io::Write;
  file.write_all(&bytes).map_err(|e| format!("Failed to write restore journal: {e}"))?;
  file.sync_all().map_err(|e| format!("Failed to flush restore journal: {e}"))?;
  fs::rename(&temp, path).map_err(|e| format!("Failed to publish restore journal: {e}"))?;
  if let Some(parent) = path.parent() { if let Ok(dir) = fs::File::open(parent) { let _ = dir.sync_all(); } }
  Ok(())
}

fn sync_file(path: &Path) -> Result<(), String> {
  fs::OpenOptions::new().read(true).write(true).open(path).and_then(|file| file.sync_all())
    .map_err(|e| format!("Failed to flush file {}: {e}", path.display()))
}

fn reject_symlink_components(root: &Path, path: &Path) -> Result<(), String> {
  let relative = path.strip_prefix(root).map_err(|_| "Restore path escapes application data".to_string())?;
  let mut current = root.to_path_buf();
  for part in relative.components() {
    current.push(part);
    match fs::symlink_metadata(&current) {
      Ok(metadata) if metadata.file_type().is_symlink() => return Err(format!("Restore refuses symlink {}", current.display())),
      Ok(_) => (),
      Err(error) if error.kind() == std::io::ErrorKind::NotFound || error.kind() == std::io::ErrorKind::NotADirectory => break,
      Err(error) => return Err(format!("Failed to inspect restore path {}: {error}", current.display())),
    }
  }
  Ok(())
}

/// Completes rollback for restore operations left behind by an interrupted process.
/// A journal is removed only after every recovery operation succeeds, so a later
/// startup can retry a rollback when the filesystem was temporarily unavailable.
pub fn recover_interrupted_restores(app_dir: &Path, db: &Database) -> Result<(), String> {
  {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
      "CREATE TABLE IF NOT EXISTS restore_commits (journal_path TEXT PRIMARY KEY, committed_at TEXT NOT NULL)",
      [],
    ).map_err(|e| format!("Failed to prepare restore commit markers: {e}"))?;
  }
  let entries = fs::read_dir(app_dir).map_err(|e| format!("Failed to inspect restore journals: {e}"))?;
  for entry in entries {
    let path = entry.map_err(|e| format!("Failed to inspect restore journal: {e}"))?.path();
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
    if !name.starts_with(RESTORE_JOURNAL_PREFIX) || name.ends_with(".tmp") { continue; }
    reject_symlink_components(app_dir, &path)?;
    let journal: RestoreJournal = serde_json::from_slice(&fs::read(&path).map_err(|e| format!("Failed to read restore journal: {e}"))?)
      .map_err(|e| format!("Invalid restore journal {}: {e}", path.display()))?;
    let rolled_back = journal.phase == "rolled_back";
    let mut guard = RestoreRollbackGuard::from_journal(app_dir, path.clone(), journal)?;
    guard.active = false; // marker inspection must never trigger an implicit rollback
    let committed: bool = db.conn.lock().map_err(|e| e.to_string())?
      .query_row("SELECT EXISTS(SELECT 1 FROM restore_commits WHERE journal_path = ?1)", [&path.to_string_lossy()], |row| row.get(0))
      .map_err(|e| format!("Failed to inspect restore commit marker: {e}"))?;
    guard.active = true;
    let errors = if committed || rolled_back { guard.cleanup_committed() } else { guard.rollback_inner() };
    if !errors.is_empty() {
      return Err(format!("Interrupted restore recovery failed: {}", errors.join("; ")));
    }
  }
  Ok(())
}

struct RestoreRollbackGuard<'a> {
  app_dir: &'a Path,
  staging_dir: PathBuf,
  backup_dir: PathBuf,
  journal_path: PathBuf,
  replaced_assets: Vec<PathBuf>,
  created_assets: Vec<PathBuf>,
  active: bool,
}

impl<'a> RestoreRollbackGuard<'a> {
  fn new(app_dir: &'a Path) -> Self {
    Self {
      app_dir,
      staging_dir: app_dir.join(format!(".restore_staging_{}", Uuid::new_v4())),
      backup_dir: app_dir.join(format!(".restore_backup_{}", Uuid::new_v4())),
      journal_path: app_dir.join(format!("{RESTORE_JOURNAL_PREFIX}{}", Uuid::new_v4())),
      replaced_assets: Vec::new(),
      created_assets: Vec::new(),
      active: true,
    }
  }

  fn from_journal(app_dir: &'a Path, journal_path: PathBuf, journal: RestoreJournal) -> Result<Self, String> {
    let valid_dir = |path: &Path, prefix: &str| {
      path.starts_with(app_dir) && path.parent() == Some(app_dir)
        && path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(prefix))
    };
    if !valid_dir(&journal.staging_dir, ".restore_staging_") || !valid_dir(&journal.backup_dir, ".restore_backup_") {
      return Err(format!("Restore journal {} contains unsafe directories", journal_path.display()));
    }
    reject_symlink_components(app_dir, &journal.staging_dir)?;
    reject_symlink_components(app_dir, &journal.backup_dir)?;
    for rel_path in journal.replaced_assets.iter().chain(journal.created_assets.iter()) {
      validate_asset_relative_path(&rel_path.to_string_lossy())?;
      if rel_path.as_os_str().is_empty() || rel_path.is_absolute() || rel_path.components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err(format!("Restore journal {} contains unsafe asset path", journal_path.display()));
      }
      reject_symlink_components(app_dir, &app_dir.join(rel_path))?;
      reject_symlink_components(app_dir, &journal.backup_dir.join(rel_path))?;
    }
    Ok(Self { app_dir, staging_dir: journal.staging_dir, backup_dir: journal.backup_dir,
      journal_path, replaced_assets: journal.replaced_assets, created_assets: journal.created_assets,
      active: false }
    )
  }

  fn journal(&self) -> RestoreJournal {
    RestoreJournal { staging_dir: self.staging_dir.clone(), backup_dir: self.backup_dir.clone(),
      replaced_assets: self.replaced_assets.clone(), created_assets: self.created_assets.clone(), committed: false, phase: "pending".into() }
  }

  fn persist(&self) -> Result<(), String> { write_journal(&self.journal_path, &self.journal()) }

  fn persist_phase(&self, phase: &str) -> Result<(), String> {
    let mut journal = self.journal();
    journal.phase = phase.to_string();
    write_journal(&self.journal_path, &journal)
  }

  fn rollback(&mut self) {
    if !self.active {
      return;
    }

    let _ = self.rollback_inner();
  }

  fn rollback_inner(&mut self) -> Vec<String> {
    let mut errors = Vec::new();
    // 1. Restore any replaced live assets from the backup directory
    for rel_path in &self.replaced_assets {
      let backup_file = self.backup_dir.join(rel_path);
      let dest = self.app_dir.join(rel_path);
      if backup_file.exists() {
        if let Some(parent) = dest.parent() {
          let _ = fs::create_dir_all(parent);
        }
        match fs::copy(&backup_file, &dest) {
          Ok(_) => { if let Err(e) = sync_file(&dest) { errors.push(e); } }
          Err(e) => errors.push(format!("restore {}: {e}", dest.display())),
        }
      } else {
        errors.push(format!("missing rollback backup {}", backup_file.display()));
      }
    }

    // 2. Remove any newly created live assets and empty parent directories
    for rel_path in &self.created_assets {
      let dest = self.app_dir.join(rel_path);
      if dest.exists() {
        if let Err(e) = fs::remove_file(&dest) { errors.push(format!("remove {}: {e}", dest.display())); }
      }
      let mut parent = dest.parent();
      while let Some(p) = parent {
        if !p.starts_with(self.app_dir) || p == self.app_dir {
          break;
        }
        if fs::remove_dir(p).is_err() {
          break;
        }
        parent = p.parent();
      }
    }

    // Publish successful rollback BEFORE deleting any recovery material. A
    // crash during cleanup must not require backups we have already removed.
    if errors.is_empty() {
      if let Err(e) = self.persist_phase("rolled_back") { errors.push(e); }
    }
    // 3. Clean up the staging and backup directories
    if errors.is_empty() && self.backup_dir.exists() {
      if let Err(e) = fs::remove_dir_all(&self.backup_dir) { errors.push(format!("remove backup directory: {e}")); }
    }
    if errors.is_empty() && self.staging_dir.exists() {
      if let Err(e) = fs::remove_dir_all(&self.staging_dir) { errors.push(format!("remove staging directory: {e}")); }
    }
    if errors.is_empty() {
      if let Err(e) = fs::remove_file(&self.journal_path) { errors.push(format!("remove restore journal: {e}")); }
    }
    self.active = false;
    errors
  }

  fn cleanup_committed(&mut self) -> Vec<String> {
    let mut errors = Vec::new();
    for (path, label) in [(&self.backup_dir, "backup"), (&self.staging_dir, "staging")] {
      if path.exists() {
        if let Err(e) = fs::remove_dir_all(path) { errors.push(format!("remove {label} directory: {e}")); }
      }
    }
    if errors.is_empty() {
      if let Err(e) = fs::remove_file(&self.journal_path) { errors.push(format!("remove restore journal: {e}")); }
    }
    self.active = false;
    errors
  }

  fn finish(mut self) {
    self.active = false;
    // SQLite's marker is authoritative; no post-commit journal rewrite is needed.
    let _ = self.cleanup_committed();
  }
}

impl<'a> Drop for RestoreRollbackGuard<'a> {
  fn drop(&mut self) {
    self.rollback();
  }
}

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
  recover_interrupted_restores(app_dir, db)?;
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

  let mut decoded_assets = archive
    .asset_files
    .iter()
    .map(|(relative_path, encoded)| {
      validate_asset_relative_path(relative_path)?;
      let path = Path::new(relative_path);
      reject_symlink_components(app_dir, &app_dir.join(path))?;
      if path.is_absolute()
        || path
          .components()
          .any(|part| !matches!(part, Component::Normal(_)))
      {
        return Err(format!("Unsafe asset path in backup: {relative_path}"));
      }
      let bytes = hex::decode(encoded)
        .map_err(|e| format!("Invalid asset data for {relative_path}: {e}"))?;
      Ok((path.to_path_buf(), bytes))
    })
    .collect::<Result<Vec<_>, String>>()?;
  // Deterministic promotion order also makes failure-path regression tests meaningful.
  decoded_assets.sort_by(|a, b| a.0.cmp(&b.0));
  for asset in &archive.assets {
    if !archive.asset_files.contains_key(&asset.relative_path) {
      return Err(format!("Backup is missing file data for asset {}", asset.id));
    }
  }

  let mut rollback_guard = RestoreRollbackGuard::new(app_dir);
  rollback_guard.persist()?;

  if !decoded_assets.is_empty() {
    fs::create_dir_all(&rollback_guard.staging_dir)
      .map_err(|e| format!("Failed to create staging directory: {e}"))?;

    for (rel_path, bytes) in &decoded_assets {
      let staged_file_path = rollback_guard.staging_dir.join(rel_path);
      if let Some(parent) = staged_file_path.parent() {
        fs::create_dir_all(parent)
          .map_err(|e| format!("Failed to create staged asset directory: {e}"))?;
      }
      let mut staged = fs::File::create(&staged_file_path)
        .map_err(|e| format!("Failed to extract asset to staging: {e}"))?;
      use std::io::Write;
      staged.write_all(bytes).map_err(|e| format!("Failed to extract asset to staging: {e}"))?;
      staged.sync_all().map_err(|e| format!("Failed to flush staged asset: {e}"))?;
    }
  }

  let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
  let tx = conn.transaction().map_err(|e| e.to_string())?;

  // This marker is committed atomically with all restored rows. Startup uses
  // it to distinguish a journal left after commit from one needing rollback.
  tx.execute(
    "CREATE TABLE IF NOT EXISTS restore_commits (journal_path TEXT PRIMARY KEY, committed_at TEXT NOT NULL)",
    [],
  ).map_err(|e| format!("Failed to prepare restore commit marker: {e}"))?;
  tx.execute(
    "INSERT INTO restore_commits (journal_path, committed_at) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
    [&rollback_guard.journal_path.to_string_lossy()],
  ).map_err(|e| format!("Failed to record restore commit marker: {e}"))?;

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

  for anchor in &archive.note_source_anchors {
    // note_id is unique. A pre-existing anchor for this note may have a
    // different ID than the backup's anchor, so remove it before the ID upsert.
    tx.execute(
      "DELETE FROM note_source_anchors WHERE note_id = ?1 AND id <> ?2",
      params![anchor.note_id, anchor.id],
    ).map_err(|e| format!("Failed to replace note source anchor for note {}: {e}", anchor.note_id))?;
    tx.execute("INSERT INTO note_source_anchors (id,note_id,document_id,document_version_id,page_index,page_label,selected_quote,rects_json,created_at,provenance) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) DO UPDATE SET note_id=excluded.note_id,document_id=excluded.document_id,document_version_id=excluded.document_version_id,page_index=excluded.page_index,page_label=excluded.page_label,selected_quote=excluded.selected_quote,rects_json=excluded.rects_json,provenance=excluded.provenance", params![anchor.id,anchor.note_id,anchor.document_id,anchor.document_version_id,anchor.page_index,anchor.page_label,anchor.selected_quote,anchor.rects_json,anchor.created_at,anchor.provenance]).map_err(|e| format!("Failed to restore note source anchor {}: {e}", anchor.id))?;
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
        id, prompt_id, reviewed_at, outcome, duration_ms, user_response, provenance, cloze_index
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT(id) DO UPDATE SET
        prompt_id=excluded.prompt_id, reviewed_at=excluded.reviewed_at, outcome=excluded.outcome,
        duration_ms=excluded.duration_ms, user_response=excluded.user_response, provenance=excluded.provenance,
        cloze_index=excluded.cloze_index",
      params![
        event.id,
        event.prompt_id,
        event.reviewed_at,
        event.outcome,
        event.duration_ms,
        event.user_response,
        event.provenance,
        event.cloze_index,
      ],
    )
    .map_err(|e| format!("Failed to restore review event {}: {e}", event.id))?;
  }

  // 9. Restore Review Schedules
  for sched in &archive.review_schedules {
    tx.execute(
      "INSERT INTO review_schedule (
        prompt_id, cloze_index, desired_retention, state, stability, difficulty, due_at, last_reviewed_at, last_outcome, fsrs_version, updated_at, provenance
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
      ON CONFLICT(prompt_id, cloze_index) DO UPDATE SET
        desired_retention=excluded.desired_retention, state=excluded.state, stability=excluded.stability,
        difficulty=excluded.difficulty, due_at=excluded.due_at, last_reviewed_at=excluded.last_reviewed_at,
        last_outcome=excluded.last_outcome, fsrs_version=excluded.fsrs_version, updated_at=excluded.updated_at,
        provenance=excluded.provenance",
      params![
        sched.prompt_id,
        sched.cloze_index,
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

  // 11. Promote staged asset files to live destinations BEFORE committing the database transaction
  if !decoded_assets.is_empty() {
    // 11a. Before touching live asset files, back up any files that will be overwritten to .restore_backup_<uuid>
    for (rel_path, _) in &decoded_assets {
      let live_dest_path = app_dir.join(rel_path);
      if live_dest_path.is_file() {
        let backup_file_path = rollback_guard.backup_dir.join(rel_path);
        if let Some(parent) = backup_file_path.parent() {
          if let Err(e) = fs::create_dir_all(parent) {
            let _ = tx.rollback();
            return Err(format!(
              "Failed to create rollback backup directory {}: {e}",
              parent.display()
            ));
          }
        }
        if let Err(e) = fs::copy(&live_dest_path, &backup_file_path) {
          let _ = tx.rollback();
          return Err(format!(
            "Failed to backup existing live asset {}: {e}",
            live_dest_path.display()
          ));
        }
        sync_file(&backup_file_path)?;
        rollback_guard.replaced_assets.push(rel_path.clone());
        rollback_guard.persist()?;
      } else if live_dest_path.exists() || fs::symlink_metadata(&live_dest_path).is_ok() {
        let _ = tx.rollback();
        return Err(format!(
          "Live destination {} already exists and is not a regular file",
          live_dest_path.display()
        ));
      } else {
        rollback_guard.created_assets.push(rel_path.clone());
        rollback_guard.persist()?;
      }
    }

    // 11b. Extract / promote staged assets into live destinations
    for (rel_path, _) in &decoded_assets {
      let staged_file_path = rollback_guard.staging_dir.join(rel_path);
      let live_dest_path = app_dir.join(rel_path);
      if let Some(parent) = live_dest_path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
          let _ = tx.rollback();
          return Err(format!(
            "Failed to create live asset directory {}: {e}",
            parent.display()
          ));
        }
      }
      if let Err(_) = fs::rename(&staged_file_path, &live_dest_path) {
        if let Err(e) = fs::copy(&staged_file_path, &live_dest_path) {
          let _ = tx.rollback();
          return Err(format!(
            "Failed to promote staged asset to live destination {}: {e}",
            live_dest_path.display()
          ));
        }
      }
      sync_file(&live_dest_path)?;
    }
  }

  // 12. Commit database transaction
  if let Err(e) = tx.commit() {
    return Err(format!("Failed to commit database transaction: {e}"));
  }

  // 13. If tx.commit() succeeds: remove the backup and staging directories
  rollback_guard.finish();

  Ok(RestoreResult {
    success: true,
    documents_count: archive.documents.len(),
    annotations_count: archive.annotations.len(),
    notes_count: archive.notes.len(),
    prompts_count: archive.prompts.len(),
  })
}
