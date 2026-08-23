//! Task 3.1 — typed persistence for the annotations feature (PRD R2).
//!
//! This module is the typed boundary between SQLite and the rest of the app
//! for `annotations` and `annotation_assets` (the tables whose owning features
//! begin in R2; the notes/review/export tables land with their feature tasks
//! in R3/R4). Every write path validates input in Rust before touching SQL:
//! annotation type and provenance against the schema's CHECK sets, normalized
//! rectangles against the R0.4 geometry model, and asset paths against the
//! §15.4 layout confinement. SQL never leaves this crate — the webview only
//! ever sees the typed structs through the IPC commands in `lib.rs`.

use super::Database;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// FR-9.1 + OQ-10: the exact v1 annotation type set. Freehand ink is deferred
/// and will be added by the migration of the feature that owns it.
pub const ANNOTATION_TYPES: &[&str] = &[
  "highlight",
  "underline",
  "area",
  "comment",
  "bookmark",
];

/// FR-9.7: area captures are the only annotation asset kind in v1.
pub const ASSET_KINDS: &[&str] = &["area_capture"];

/// PRD §15.4: annotation asset files live under `app-data/annotations/`.
/// `relative_path` values stored on asset rows must start with this component
/// and must never leave it (checked again at file-access time).
pub const ASSET_ROOT_COMPONENT: &str = "annotations";

/// A normalized 0..1 rectangle in the geometry model proven by R0.4
/// (`src/utils/annotationOverlay.ts`). Multiple rects cover multi-line
/// highlight/underline selections (FR-9.4 "normalized rectangles").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NormalizedRect {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

/// A Reader-native annotation record (PRD §9). The schema stores the same
/// fields; this struct is what IPC serializes to the webview.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Annotation {
  pub id: String,
  pub document_id: String,
  pub document_version_id: String,
  /// Version-bound integrity checksum (R0.4): binds document version id,
  /// page, type, geometry, and exact quote. Re-anchoring to a new version
  /// recomputes it (task 3.3); creation fills it (task 3.4).
  #[serde(default)]
  pub checksum: String,
  pub annotation_type: String,
  /// Zero-based physical page (FR-9.4).
  pub page_index: i64,
  /// Visible page label (FR-9.4).
  pub page_label: String,
  #[serde(default)]
  pub rects: Vec<NormalizedRect>,
  /// Read-only after creation (FR-9.5): no update path touches it.
  pub quote: String,
  pub prefix_text: String,
  pub suffix_text: String,
  pub text_layer_checksum: Option<String>,
  /// The separate user comment (FR-9.5).
  pub comment: String,
  /// Semantic palette key (palette configuration ships with task 3.5).
  pub color: String,
  #[serde(default)]
  pub tags: Vec<String>,
  /// Recoverable-trash marker (FR-9.8); NULL = active.
  pub deleted_at: Option<String>,
  pub created_at: String,
  pub updated_at: String,
  pub provenance: String,
}

/// An area-capture asset (FR-9.7): the crop image is a file under
/// `app-data/annotations/`; the row carries its provenance. Never an orphaned
/// bitmap: the row requires `document_id` + parent annotation, and the file
/// must exist at insert time.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnnotationAsset {
  pub id: String,
  pub annotation_id: String,
  pub document_id: String,
  pub asset_kind: String,
  /// Relative to the app data root, e.g. `annotations/<asset_id>.png`.
  pub relative_path: String,
  pub content_type: String,
  pub width_px: i64,
  pub height_px: i64,
  pub caption: String,
  pub created_at: String,
  pub provenance: String,
}

const ANNOTATION_COLS: &str = "id, document_id, document_version_id, checksum, annotation_type, \
  page_index, page_label, rects_json, quote, prefix_text, suffix_text, \
  text_layer_checksum, comment, color, tags, deleted_at, created_at, updated_at, provenance";

fn map_row_to_annotation(row: &rusqlite::Row<'_>) -> rusqlite::Result<Annotation> {
  let rects_json: String = row.get(7)?;
  let tags_json: String = row.get(14)?;
  Ok(Annotation {
    id: row.get(0)?,
    document_id: row.get(1)?,
    document_version_id: row.get(2)?,
    checksum: row.get(3)?,
    annotation_type: row.get(4)?,
    page_index: row.get(5)?,
    page_label: row.get(6)?,
    // Tolerant decode: rows written through this module are always valid JSON;
    // a corrupt value decodes to an empty shape rather than breaking the
    // whole row (the text-layer recovery path is a 2.8 concern).
    rects: serde_json::from_str(&rects_json).unwrap_or_default(),
    quote: row.get(8)?,
    prefix_text: row.get(9)?,
    suffix_text: row.get(10)?,
    text_layer_checksum: row.get(11)?,
    comment: row.get(12)?,
    color: row.get(13)?,
    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
    deleted_at: row.get(15)?,
    created_at: row.get(16)?,
    updated_at: row.get(17)?,
    provenance: row.get(18)?,
  })
}

fn map_row_to_asset(row: &rusqlite::Row<'_>) -> rusqlite::Result<AnnotationAsset> {
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
}

// ---------------------------------------------------------------------------
// Validators — the Rust side of the schema's CHECK constraints, run before
// every write so a call error is surfaced as a typed message, not a SQLite
// constraint failure.
// ---------------------------------------------------------------------------

pub fn validate_annotation_type(annotation_type: &str) -> Result<(), String> {
  if ANNOTATION_TYPES.contains(&annotation_type) {
    Ok(())
  } else {
    Err(format!(
      "Invalid annotation type '{annotation_type}'; expected one of {ANNOTATION_TYPES:?}"
    ))
  }
}

// `validate_provenance` is re-exported from `provenance` (task 3.2): the
// six-value §16.1 vocabulary now lives in one module — provenance.rs — shared
// by the Rust validators, migration 9's SQL, and the schema tests.
pub use super::provenance::validate_provenance;

pub fn validate_asset_kind(kind: &str) -> Result<(), String> {
  if ASSET_KINDS.contains(&kind) {
    Ok(())
  } else {
    Err(format!("Invalid asset kind '{kind}'; expected one of {ASSET_KINDS:?}"))
  }
}

pub fn validate_normalized_rects(rects: &[NormalizedRect]) -> Result<(), String> {
  let eps = 1e-9;
  for (i, r) in rects.iter().enumerate() {
    for (name, v) in [("x", r.x), ("y", r.y), ("width", r.width), ("height", r.height)] {
      if !v.is_finite() || !(-eps..=1.0 + eps).contains(&v) {
        return Err(format!(
          "rect[{i}].{name} must be a finite value in the 0..1 normalized range, got {v}"
        ));
      }
    }
    if r.x + r.width > 1.0 + eps {
      return Err(format!(
        "rect[{i}] exceeds the page horizontally (x + width = {} > 1)",
        r.x + r.width
      ));
    }
    if r.y + r.height > 1.0 + eps {
      return Err(format!(
        "rect[{i}] exceeds the page vertically (y + height = {} > 1)",
        r.y + r.height
      ));
    }
  }
  Ok(())
}

/// Validates an asset's stored path against the §15.4 confinement: relative,
/// forward-slash only, first component exactly `annotations/`, no `..`,
/// `.`, or empty components, and a file name present.
pub fn validate_asset_relative_path(relative_path: &str) -> Result<(), String> {
  if relative_path.is_empty() {
    return Err("Asset path must not be empty".to_string());
  }
  if relative_path.starts_with('/') || relative_path.starts_with('\\') {
    return Err("Asset path must be relative to the app data directory".to_string());
  }
  if relative_path.contains('\\') {
    return Err("Asset path must use forward slashes".to_string());
  }
  let mut components = relative_path.split('/');
  let first = components.next().unwrap_or("");
  if first != ASSET_ROOT_COMPONENT {
    return Err(format!(
      "Asset paths must live under '{ASSET_ROOT_COMPONENT}/' in the app data directory (got '{relative_path}')"
    ));
  }
  let mut seen_file = false;
  for comp in components {
    if comp.is_empty() || comp == "." || comp == ".." {
      return Err(format!(
        "Asset path must not contain empty, '.', or '..' components (got '{relative_path}')"
      ));
    }
    seen_file = true;
  }
  if !seen_file {
    return Err("Asset path must include a file name".to_string());
  }
  Ok(())
}

/// Validates the full business rules of an annotation before insert.
pub fn validate_annotation(annotation: &Annotation) -> Result<(), String> {
  validate_annotation_type(&annotation.annotation_type)?;
  validate_provenance(&annotation.provenance)?;
  validate_normalized_rects(&annotation.rects)?;
  if annotation.page_index < 0 {
    return Err(format!(
      "page_index must be >= 0 (zero-based physical page), got {}",
      annotation.page_index
    ));
  }
  let has_quote = !annotation.quote.trim().is_empty();
  match annotation.annotation_type.as_str() {
    // FR-9.4: user-authored text markup requires an exact quote. Imported
    // (deterministic_transform) markup carries geometry from the PDF but no
    // guaranteed text, so an empty quote is allowed for that provenance
    // (FR-9.9); the geometry is the anchor instead.
    "highlight" | "underline" if !has_quote && annotation.provenance != "deterministic_transform" => {
      return Err("Text highlight/underline annotations require an exact quote (FR-9.4)".to_string());
    }
    t if t != "highlight" && t != "underline" && has_quote => {
      return Err(format!(
        "'{t}' annotations must not carry a quote — the quote field is reserved for text annotations (FR-9.5)"
      ));
    }
    _ => {}
  }
  if annotation.annotation_type == "area" && annotation.rects.is_empty() {
    return Err("Area annotations require at least one normalized rectangle".to_string());
  }
  Ok(())
}

/// Resolves a stored asset path to an absolute filesystem path, re-validating
/// the confinement at file-access time (defense in depth, PRD §15.3: a
/// compaction or hand-edit of the database must not turn a stored path into a
/// filesystem escape). The parent directory must exist so symlinks in the
/// app-data chain resolve; the file itself may not (delete path).
pub fn asset_full_path(app_dir: &Path, relative_path: &str) -> Result<PathBuf, String> {
  validate_asset_relative_path(relative_path)?;
  let annotations_dir = app_dir.join(ASSET_ROOT_COMPONENT);
  if !annotations_dir.exists() {
    return Err(format!(
      "app data '{ASSET_ROOT_COMPONENT}/' directory is not accessible"
    ));
  }
  let canonical_root =
    fs::canonicalize(&annotations_dir).map_err(|e| e.to_string())?;

  let candidate = app_dir.join(relative_path);
  let parent = candidate
    .parent()
    .ok_or_else(|| "Asset path has no parent directory".to_string())?;
  let file_name = candidate
    .file_name()
    .ok_or_else(|| "Asset path has no file name".to_string())?;
  let canonical_parent =
    fs::canonicalize(parent).map_err(|e| format!("Asset parent directory is not accessible: {e}"))?;
  let resolved = canonical_parent.join(file_name);

  if !resolved.starts_with(&canonical_root) {
    return Err(format!(
      "Asset path '{relative_path}' escapes the app data '{ASSET_ROOT_COMPONENT}/' directory"
    ));
  }
  Ok(resolved)
}

impl Database {
  // ------------------------- annotations -------------------------

  pub fn add_annotation(&self, annotation: &Annotation) -> Result<(), String> {
    validate_annotation(annotation)?;
    let conn = self.conn.lock().unwrap();
    conn
      .execute(
        "INSERT INTO annotations (
          id, document_id, document_version_id, annotation_type, page_index,
          page_label, rects_json, quote, prefix_text, suffix_text,
          text_layer_checksum, comment, color, tags, deleted_at,
          created_at, updated_at, provenance, checksum
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        params![
          annotation.id,
          annotation.document_id,
          annotation.document_version_id,
          annotation.annotation_type,
          annotation.page_index,
          annotation.page_label,
          serde_json::to_string(&annotation.rects).map_err(|e| e.to_string())?,
          annotation.quote,
          annotation.prefix_text,
          annotation.suffix_text,
          annotation.text_layer_checksum,
          annotation.comment,
          annotation.color,
          serde_json::to_string(&annotation.tags).map_err(|e| e.to_string())?,
          annotation.deleted_at,
          annotation.created_at,
          annotation.updated_at,
          annotation.provenance,
          annotation.checksum,
        ],
      )
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn get_annotation_by_id(&self, id: &str) -> Result<Option<Annotation>, String> {
    let conn = self.conn.lock().unwrap();
    let query = format!("SELECT {ANNOTATION_COLS} FROM annotations WHERE id = ?1 LIMIT 1");
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let mut rows = stmt
      .query_map(params![id], map_row_to_annotation)
      .map_err(|e| e.to_string())?;
    if let Some(row_res) = rows.next() {
      Ok(Some(row_res.map_err(|e| e.to_string())?))
    } else {
      Ok(None)
    }
  }

  /// Lists a document's annotations in reading order. Trashed annotations are
  /// hidden unless explicitly requested (FR-9.8 recoverable trash).
  pub fn get_annotations_for_document(
    &self,
    document_id: &str,
    include_trashed: bool,
  ) -> Result<Vec<Annotation>, String> {
    let conn = self.conn.lock().unwrap();
    let query = format!(
      "SELECT {ANNOTATION_COLS} FROM annotations \
       WHERE document_id = ?1 {extra} ORDER BY page_index ASC, created_at ASC",
      extra = if include_trashed { "" } else { "AND deleted_at IS NULL" }
    );
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let annotations = stmt
      .query_map(params![document_id], map_row_to_annotation)
      .map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();
    Ok(annotations)
  }

  /// Updates only the user-editable fields. The quote, anchors, and geometry
  /// are immutable by design (FR-9.5): no update path touches them, so a
  /// comment edit can never alter the stored source excerpt.
  pub fn update_annotation_fields(
    &self,
    id: &str,
    color: &str,
    comment: &str,
    tags: &[String],
  ) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    let tags_json = serde_json::to_string(tags).map_err(|e| e.to_string())?;
    let changed = conn
      .execute(
        "UPDATE annotations SET
           color = ?1, comment = ?2, tags = ?3,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?4 AND deleted_at IS NULL",
        params![color, comment, tags_json, id],
      )
      .map_err(|e| e.to_string())?;
    if changed == 0 {
      return Err(format!("Annotation not found or in trash: {id}"));
    }
    Ok(())
  }

  /// Moves an annotation into the recoverable trash (FR-9.8).
  pub fn trash_annotation(&self, id: &str) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    let changed = conn
      .execute(
        "UPDATE annotations SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), \
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') \
         WHERE id = ?1 AND deleted_at IS NULL",
        params![id],
      )
      .map_err(|e| e.to_string())?;
    if changed == 0 {
      return Err(format!("Annotation not found or already trashed: {id}"));
    }
    Ok(())
  }

  /// Restores an annotation from the trash (FR-9.8).
  pub fn restore_annotation(&self, id: &str) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    let changed = conn
      .execute(
        "UPDATE annotations SET deleted_at = NULL, \
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') \
         WHERE id = ?1 AND deleted_at IS NOT NULL",
        params![id],
      )
      .map_err(|e| e.to_string())?;
    if changed == 0 {
      return Err(format!("Annotation not found or not trashed: {id}"));
    }
    Ok(())
  }

  /// Permanently removes an annotation. Asset rows cascade; asset files are
  /// deleted first so a purge never leaves an orphaned bitmap on disk
  /// (FR-9.7). The annotation purge is deliberately out of the trash flow:
  /// trash keeps rows, purge is the explicit final step (FR-9.8).
  pub fn purge_annotation(&self, app_dir: &Path, id: &str) -> Result<(), String> {
    let assets = self.get_annotation_assets(id)?;
    for asset in &assets {
      let full = asset_full_path(app_dir, &asset.relative_path)?;
      if full.exists() {
        fs::remove_file(&full).map_err(|e| format!("Failed to remove asset file: {e}"))?;
      }
    }
    let conn = self.conn.lock().unwrap();
    let changed = conn
      .execute("DELETE FROM annotations WHERE id = ?1", params![id])
      .map_err(|e| e.to_string())?;
    if changed == 0 {
      return Err(format!("Annotation not found: {id}"));
    }
    Ok(())
  }

  // ------------------------- annotation assets -------------------------

  /// FR-9.7 atomic area-capture creation: writes the crop file AND inserts the
  /// annotation + asset rows in a single call so the webview never makes
  /// separate IPC round-trips that a process termination could leave half-
  /// finished. The file is written first (atomic temp+rename); the DB inserts
  /// run in a SINGLE SQLite transaction so a crash between them rolls both
  /// back automatically — an area annotation can never exist without its
  /// asset row. If the transaction fails or is killed before commit, SQLite
  /// discards the uncommitted rows; the orphaned bitmap is cleaned up at the
  /// next startup by `reconcile_orphaned_asset_files`. This is the only path
  /// by which area-capture files and rows are created together.
  pub fn create_area_capture(
    &self,
    app_dir: &Path,
    annotation: &Annotation,
    asset: &AnnotationAsset,
    bytes: &[u8],
  ) -> Result<(), String> {
    const MAX_ASSET_BYTES: usize = 24 * 1024 * 1024;
    if bytes.len() > MAX_ASSET_BYTES {
      return Err(format!(
        "Asset file exceeds the {} MB payload limit",
        MAX_ASSET_BYTES / (1024 * 1024)
      ));
    }
    // Validate both records up front so a typed error surfaces before any
    // file or row is touched.
    validate_annotation(annotation)?;
    validate_asset_kind(&asset.asset_kind)?;
    validate_provenance(&asset.provenance)?;
    validate_asset_relative_path(&asset.relative_path)?;
    if asset.width_px <= 0 || asset.height_px <= 0 {
      return Err(format!(
        "Asset dimensions must be positive, got {}x{}",
        asset.width_px, asset.height_px
      ));
    }
    // The asset's annotation_id and document_id must match the annotation.
    if asset.annotation_id != annotation.id {
      return Err(format!(
        "Asset annotation_id '{}' does not match annotation id '{}'",
        asset.annotation_id, annotation.id
      ));
    }
    if asset.document_id != annotation.document_id {
      return Err(format!(
        "Asset document_id '{}' does not match annotation document_id '{}'",
        asset.document_id, annotation.document_id
      ));
    }

    // 1. Write the file (atomic temp + rename). If the DB transaction below
    //    fails, this file is removed. If the process is killed before the
    //    transaction commits, the file is orphaned but the DB has no rows —
    //    `reconcile_orphaned_asset_files` removes it at the next startup.
    self.write_asset_file(app_dir, &asset.relative_path, bytes)?;

    // 2. Insert the annotation + asset rows in a SINGLE transaction. A crash
    //    before commit rolls both inserts back automatically (SQLite discards
    //    uncommitted pages on WAL replay); an error after the annotation insert
    //    but before the asset insert drops the transaction, so no area
    //    annotation can ever exist without its asset row (FR-9.7).
    let mut conn = self.conn.lock().unwrap();
    let rects_json = serde_json::to_string(&annotation.rects).map_err(|e| e.to_string())?;
    let tags_json = serde_json::to_string(&annotation.tags).map_err(|e| e.to_string())?;
    let tx_result: Result<(), String> = {
      let tx = conn.transaction().map_err(|e| e.to_string())?;
      tx.execute(
        "INSERT INTO annotations (
          id, document_id, document_version_id, annotation_type, page_index,
          page_label, rects_json, quote, prefix_text, suffix_text,
          text_layer_checksum, comment, color, tags, deleted_at,
          created_at, updated_at, provenance, checksum
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        params![
          annotation.id,
          annotation.document_id,
          annotation.document_version_id,
          annotation.annotation_type,
          annotation.page_index,
          annotation.page_label,
          rects_json,
          annotation.quote,
          annotation.prefix_text,
          annotation.suffix_text,
          annotation.text_layer_checksum,
          annotation.comment,
          annotation.color,
          tags_json,
          annotation.deleted_at,
          annotation.created_at,
          annotation.updated_at,
          annotation.provenance,
          annotation.checksum,
        ],
      ).map_err(|e| e.to_string())?;
      tx.execute(
        "INSERT INTO annotation_assets (
          id, annotation_id, document_id, asset_kind, relative_path,
          content_type, width_px, height_px, caption, created_at, provenance
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
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
      ).map_err(|e| e.to_string())?;
      tx.commit().map_err(|e| e.to_string())?;
      Ok(())
    };
    drop(conn);

    if let Err(e) = tx_result {
      // The transaction was rolled back — no rows exist. Remove the orphaned
      // file so no bitmap lingers without its rows.
      let _ = self.remove_asset_file(app_dir, &asset.relative_path);
      return Err(e);
    }
    Ok(())
  }

  /// FR-9.7 crash recovery: removes asset files in `app-data/annotations/`
  /// that have no matching `relative_path` in the `annotation_assets` table.
  /// Called at startup so a process kill between the file write and the DB
  /// transaction commit (in `create_area_capture`) never leaves a permanent
  /// orphaned bitmap. A file that IS referenced by a row is never touched.
  pub fn reconcile_orphaned_asset_files(&self, app_dir: &Path) -> Result<usize, String> {
    let annotations_dir = app_dir.join(ASSET_ROOT_COMPONENT);
    if !annotations_dir.exists() {
      return Ok(0);
    }

    // Collect every relative_path stored in the database.
    let known_paths: std::collections::HashSet<String> = {
      let conn = self.conn.lock().unwrap();
      let mut stmt = conn
        .prepare("SELECT relative_path FROM annotation_assets")
        .map_err(|e| e.to_string())?;
      let paths = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
      paths
    };

    let mut removed = 0;
    let entries = fs::read_dir(&annotations_dir).map_err(|e| e.to_string())?;
    for entry in entries.filter_map(|e| e.ok()) {
      let path = entry.path();
      // Only scan files (skip subdirectories and temp files from in-progress writes).
      if !path.is_file() {
        continue;
      }
      let file_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => continue,
      };
      // Skip temp files from atomic writes (`.name.tmp-uuid`).
      if file_name.starts_with('.') && file_name.contains(".tmp-") {
        continue;
      }
      let relative_path = format!("{ASSET_ROOT_COMPONENT}/{file_name}");
      if !known_paths.contains(&relative_path) {
        if let Err(e) = fs::remove_file(&path) {
          // Best-effort: log the error but continue cleaning other orphans.
          eprintln!("reconcile_orphaned_asset_files: failed to remove orphaned asset '{}': {e}", path.display());
        } else {
          removed += 1;
        }
      }
    }
    Ok(removed)
  }

  /// Inserts an asset row for an existing file. The file must already exist
  /// under `app-data/annotations/` — a row is never created for a dangling
  /// path (FR-9.7).
  pub fn add_annotation_asset(&self, app_dir: &Path, asset: &AnnotationAsset) -> Result<(), String> {
    validate_asset_kind(&asset.asset_kind)?;
    validate_provenance(&asset.provenance)?;
    validate_asset_relative_path(&asset.relative_path)?;
    if asset.width_px <= 0 || asset.height_px <= 0 {
      return Err(format!(
        "Asset dimensions must be positive, got {}x{}",
        asset.width_px, asset.height_px
      ));
    }

    // The stored path must resolve inside app-data/annotations/ and the file
    // must exist before the row is written.
    let full = asset_full_path(app_dir, &asset.relative_path)?;
    if !full.exists() {
      return Err(format!(
        "Asset file does not exist at '{}'",
        full.display()
      ));
    }

    let conn = self.conn.lock().unwrap();
    conn
      .execute(
        "INSERT INTO annotation_assets (
          id, annotation_id, document_id, asset_kind, relative_path,
          content_type, width_px, height_px, caption, created_at, provenance
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
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
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn get_annotation_assets(&self, annotation_id: &str) -> Result<Vec<AnnotationAsset>, String> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn
      .prepare(
        "SELECT id, annotation_id, document_id, asset_kind, relative_path,
                content_type, width_px, height_px, caption, created_at, provenance
         FROM annotation_assets WHERE annotation_id = ?1 ORDER BY created_at ASC",
      )
      .map_err(|e| e.to_string())?;
    let assets = stmt
      .query_map(params![annotation_id], map_row_to_asset)
      .map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();
    Ok(assets)
  }

  pub fn get_annotation_asset_by_id(&self, id: &str) -> Result<Option<AnnotationAsset>, String> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn
      .prepare(
        "SELECT id, annotation_id, document_id, asset_kind, relative_path,
                content_type, width_px, height_px, caption, created_at, provenance
         FROM annotation_assets WHERE id = ?1 LIMIT 1",
      )
      .map_err(|e| e.to_string())?;
    let mut rows = stmt
      .query_map(params![id], map_row_to_asset)
      .map_err(|e| e.to_string())?;
    if let Some(row_res) = rows.next() {
      Ok(Some(row_res.map_err(|e| e.to_string())?))
    } else {
      Ok(None)
    }
  }

  /// Writes an asset file's bytes under `app-data/annotations/` (task 3.4).
  ///
  /// The relative path is validated against the §15.4 confinement, the
  /// `annotations/` directory is created when missing, and the bytes land via
  /// an atomic temp-file + rename so a crash mid-write can never leave a
  /// truncated file that a later row-insert would point at (FR-9.7). Temp
  /// names are random UUIDs, so concurrent writers cannot collide; rename is
  /// atomic on the same filesystem (which the app-data layout guarantees).
  pub fn write_asset_file(
    &self,
    app_dir: &Path,
    relative_path: &str,
    bytes: &[u8],
  ) -> Result<(), String> {
    validate_asset_relative_path(relative_path)?;

    let annotations_dir = app_dir.join(ASSET_ROOT_COMPONENT);
    fs::create_dir_all(&annotations_dir).map_err(|e| e.to_string())?;

    let full = asset_full_path(app_dir, relative_path)?;
    let parent = full
      .parent()
      .ok_or_else(|| "Asset path has no parent directory".to_string())?;
    let file_name = full
      .file_name()
      .and_then(|n| n.to_str())
      .ok_or_else(|| "Asset path has no file name".to_string())?;

    let tmp_path = parent.join(format!(".{file_name}.tmp-{}", Uuid::new_v4()));
    // Best-effort cleanup of the temp file if the rename fails after the write.
    let write_res = fs::write(&tmp_path, bytes);
    if let Err(e) = write_res {
      let _ = fs::remove_file(&tmp_path);
      return Err(format!("Failed to write asset file: {e}"));
    }
    if let Err(e) = fs::rename(&tmp_path, &full) {
      let _ = fs::remove_file(&tmp_path);
      return Err(format!("Failed to finalize asset file: {e}"));
    }
    Ok(())
  }

  /// Reads an asset file's bytes back by row id (task 3.4).
  ///
  /// The stored path is resolved server-side from the asset row, then
  /// re-validated against the app data confinement at file-access time —
  /// there is no caller-supplied path, so this cannot be used as an
  /// arbitrary-file read oracle (PRD §15.3 / RK-11).
  pub fn read_asset_file(&self, app_dir: &Path, asset_id: &str) -> Result<Vec<u8>, String> {
    let relative_path: String = {
      let conn = self.conn.lock().unwrap();
      conn
        .query_row(
          "SELECT relative_path FROM annotation_assets WHERE id = ?1",
          params![asset_id],
          |row| row.get(0),
        )
        .map_err(|_| format!("Annotation asset not found: {asset_id}"))?
    };
    let full = asset_full_path(app_dir, &relative_path)?;
    if !full.exists() {
      return Err(format!("Asset file is missing at '{}'", full.display()));
    }
    fs::read(&full).map_err(|e| e.to_string())
  }

  /// Removes an asset FILE without a row (task 3.4 cleanup path).
  ///
  /// Used when a capture's row inserts fail after the file write, so a
  /// half-created area capture never leaves an orphaned bitmap on disk
  /// (FR-9.7). The path is validated against the §15.4 confinement again; a
  /// missing file is a no-op (idempotent cleanup).
  pub fn remove_asset_file(&self, app_dir: &Path, relative_path: &str) -> Result<(), String> {
    validate_asset_relative_path(relative_path)?;
    let full = asset_full_path(app_dir, relative_path)?;
    if full.exists() {
      fs::remove_file(&full).map_err(|e| format!("Failed to remove asset file: {e}"))?;
    }
    Ok(())
  }

  /// Removes an asset row and its file. The file path is re-validated against
  /// the app data confinement before deletion.
  pub fn delete_annotation_asset(&self, app_dir: &Path, id: &str) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    let relative_path: String = conn
      .query_row(
        "SELECT relative_path FROM annotation_assets WHERE id = ?1",
        params![id],
        |row| row.get(0),
      )
      .map_err(|_| format!("Annotation asset not found: {id}"))?;

    let full = asset_full_path(app_dir, &relative_path)?;
    if full.exists() {
      fs::remove_file(&full).map_err(|e| format!("Failed to remove asset file: {e}"))?;
    }
    let changed = conn
      .execute("DELETE FROM annotation_assets WHERE id = ?1", params![id])
      .map_err(|e| e.to_string())?;
    if changed == 0 {
      return Err(format!("Annotation asset not found: {id}"));
    }
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::{Database, Document};
  use tempfile::tempdir;
  use uuid::Uuid;

  /// Seeds a document plus its first version row and returns
  /// `(document_id, version_id)`. Document rows go through the typed layer;
  /// version rows are inserted directly because version *management* is task
  /// 3.3 — the table already exists so annotations can reference it.
  fn seed_document_and_version(db: &Database) -> (String, String) {
    let doc_id = Uuid::new_v4().to_string();
    let version_id = Uuid::new_v4().to_string();
    let doc = Document {
      id: doc_id.clone(),
      title: "Annotation Test Document".into(),
      filepath: "/docs/annotation_test.pdf".into(),
      sha256_hash: "c0".repeat(32),
      page_count: 10,
      created_at: "2026-08-04T13:52:57Z".into(),
      updated_at: "2026-08-04T13:52:57Z".into(),
      provenance: "source_extracted".into(),
      author: None,
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
    let conn = db.conn.lock().unwrap();
    conn
      .execute(
        "INSERT INTO document_versions (id, document_id, version_number, sha256_hash, page_count, created_at, provenance)
         VALUES (?1, ?2, 1, ?3, 10, '2026-08-04T13:52:57Z', 'source_extracted')",
        params![version_id, doc_id, "c0".repeat(32)],
      )
      .unwrap();
    drop(conn);
    (doc_id, version_id)
  }

  fn sample_annotation(doc_id: &str, version_id: &str) -> Annotation {
    Annotation {
      id: Uuid::new_v4().to_string(),
      document_id: doc_id.to_string(),
      document_version_id: version_id.to_string(),
      checksum: "checksum-v1".into(),
      annotation_type: "highlight".into(),
      page_index: 2,
      page_label: "iii".into(),
      rects: vec![NormalizedRect { x: 0.1, y: 0.2, width: 0.6, height: 0.04 }],
      quote: "The plaintiff moves for summary judgment".into(),
      prefix_text: "Here, ".into(),
      suffix_text: " on the merits.".into(),
      text_layer_checksum: Some("abc123".into()),
      comment: "Central claim".into(),
      color: "red".into(),
      tags: vec!["claim".into(), "important".into()],
      deleted_at: None,
      created_at: "2026-08-04T13:52:57Z".into(),
      updated_at: "2026-08-04T13:52:57Z".into(),
      provenance: "user_authored".into(),
    }
  }

  #[test]
  fn test_annotation_roundtrip_and_listing() {
    let db = Database::in_memory().unwrap();
    let (doc_id, version_id) = seed_document_and_version(&db);

    let annotation = sample_annotation(&doc_id, &version_id);
    db.add_annotation(&annotation).unwrap();

    let by_id = db.get_annotation_by_id(&annotation.id).unwrap().expect("exists");
    assert_eq!(by_id, annotation);

    let listed = db.get_annotations_for_document(&doc_id, false).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].quote, annotation.quote);

    // Other documents see nothing.
    let other = db.get_annotations_for_document("nope", false).unwrap();
    assert!(other.is_empty());
  }

  #[test]
  fn test_annotation_validation_rejects_bad_input() {
    let db = Database::in_memory().unwrap();
    let (doc_id, version_id) = seed_document_and_version(&db);
    let base = sample_annotation(&doc_id, &version_id);

    let mut bad_type = base.clone();
    bad_type.annotation_type = "ink".into();
    assert!(db.add_annotation(&bad_type).is_err());

    let mut bad_provenance = base.clone();
    bad_provenance.provenance = "fabricated".into();
    assert!(db.add_annotation(&bad_provenance).is_err());

    let mut bad_rect = base.clone();
    bad_rect.rects = vec![NormalizedRect { x: -0.1, y: 0.5, width: 0.3, height: 0.3 }];
    assert!(db.add_annotation(&bad_rect).is_err());

    let mut overflow_rect = base.clone();
    overflow_rect.rects = vec![NormalizedRect { x: 0.9, y: 0.5, width: 0.3, height: 0.3 }];
    assert!(db.add_annotation(&overflow_rect).is_err());

    let mut nan_rect = base.clone();
    nan_rect.rects = vec![NormalizedRect { x: f64::NAN, y: 0.5, width: 0.3, height: 0.3 }];
    assert!(db.add_annotation(&nan_rect).is_err());

    let mut no_quote = base.clone();
    no_quote.quote = "   ".into();
    assert!(db.add_annotation(&no_quote).is_err());

    // FR-9.9: imported (deterministic_transform) highlight with empty quote
    // is allowed — the PDF carries geometry, not guaranteed text.
    let mut imported_no_quote = base.clone();
    imported_no_quote.provenance = "deterministic_transform".into();
    imported_no_quote.quote = "".into();
    assert!(db.add_annotation(&imported_no_quote).is_ok());

    // user_authored underline with empty quote is still rejected.
    let mut user_underline_no_quote = base.clone();
    user_underline_no_quote.annotation_type = "underline".into();
    user_underline_no_quote.quote = "".into();
    assert!(db.add_annotation(&user_underline_no_quote).is_err());

    let mut quote_on_bookmark = base.clone();
    quote_on_bookmark.annotation_type = "bookmark".into();
    quote_on_bookmark.quote = "must not be here".into();
    quote_on_bookmark.rects = vec![];
    assert!(db.add_annotation(&quote_on_bookmark).is_err());

    let mut area_without_rect = base.clone();
    area_without_rect.annotation_type = "area".into();
    area_without_rect.quote = "".into();
    area_without_rect.rects = vec![];
    assert!(db.add_annotation(&area_without_rect).is_err());

    let mut negative_page = base.clone();
    negative_page.page_index = -1;
    assert!(db.add_annotation(&negative_page).is_err());

    // The schema-level CHECKs fire even if a caller bypasses the validator.
    let conn = db.conn.lock().unwrap();
    let res = conn.execute(
      "INSERT INTO annotations (id, document_id, document_version_id, annotation_type, page_index, quote, created_at, updated_at, provenance)
       VALUES ('x1', ?1, ?2, 'ink', 0, 'q', 'now', 'now', 'user_authored')",
      params![doc_id, version_id],
    );
    assert!(res.is_err(), "annotation_type CHECK must reject 'ink' at the schema level");
  }

  #[test]
  fn test_annotation_fields_update_never_touches_quote() {
    let db = Database::in_memory().unwrap();
    let (doc_id, version_id) = seed_document_and_version(&db);
    let annotation = sample_annotation(&doc_id, &version_id);
    db.add_annotation(&annotation).unwrap();

    db.update_annotation_fields(
      &annotation.id,
      "blue",
      "Amended comment",
      &["evidence".to_string()],
    )
    .unwrap();

    let updated = db.get_annotation_by_id(&annotation.id).unwrap().unwrap();
    assert_eq!(updated.color, "blue");
    assert_eq!(updated.comment, "Amended comment");
    assert_eq!(updated.tags, vec!["evidence"]);
    // FR-9.5: the source excerpt and anchors are untouched by a comment edit.
    assert_eq!(updated.quote, annotation.quote);
    assert_eq!(updated.prefix_text, annotation.prefix_text);
    assert_eq!(updated.suffix_text, annotation.suffix_text);
    assert_eq!(updated.rects, annotation.rects);
    assert_eq!(updated.document_version_id, annotation.document_version_id);

    // Updating a missing annotation errors.
    assert!(db.update_annotation_fields("missing", "", "", &[]).is_err());
  }

  #[test]
  fn test_trash_restore_purge_lifecycle() {
    let db = Database::in_memory().unwrap();
    let app_dir = tempdir().unwrap();
    let (doc_id, version_id) = seed_document_and_version(&db);

    let annotation = sample_annotation(&doc_id, &version_id);
    db.add_annotation(&annotation).unwrap();

    // Active: visible, updatable.
    assert_eq!(db.get_annotations_for_document(&doc_id, false).unwrap().len(), 1);

    // Create an asset file so purge-on-disk behavior is exercised.
    fs::create_dir_all(app_dir.path().join(ASSET_ROOT_COMPONENT)).unwrap();
    let asset_path = app_dir.path().join(ASSET_ROOT_COMPONENT).join("asset-1.png");
    fs::write(&asset_path, b"fake png bytes").unwrap();
    let asset = AnnotationAsset {
      id: "asset-1".into(),
      annotation_id: annotation.id.clone(),
      document_id: doc_id.clone(),
      asset_kind: "area_capture".into(),
      relative_path: "annotations/asset-1.png".into(),
      content_type: "image/png".into(),
      width_px: 320,
      height_px: 240,
      caption: "Figure 1".into(),
      created_at: "2026-08-04T13:52:57Z".into(),
      provenance: "user_authored".into(),
    };
    db.add_annotation_asset(app_dir.path(), &asset).unwrap();

    // Trash: hidden by default, still listed with include_trashed.
    db.trash_annotation(&annotation.id).unwrap();
    assert_eq!(db.get_annotations_for_document(&doc_id, false).unwrap().len(), 0);
    let trashed = db.get_annotations_for_document(&doc_id, true).unwrap();
    assert_eq!(trashed.len(), 1);
    assert!(trashed[0].deleted_at.is_some());

    // Trashed annotations cannot be edited (they are not active).
    assert!(db.update_annotation_fields(&annotation.id, "red", "nope", &[]).is_err());

    // Restore brings it back exactly.
    db.restore_annotation(&annotation.id).unwrap();
    assert_eq!(db.get_annotations_for_document(&doc_id, false).unwrap().len(), 1);

    // Trash again, then purge: rows and the asset file both disappear.
    db.trash_annotation(&annotation.id).unwrap();
    db.purge_annotation(app_dir.path(), &annotation.id).unwrap();
    assert!(db.get_annotation_by_id(&annotation.id).unwrap().is_none());
    assert!(db.get_annotation_assets(&annotation.id).unwrap().is_empty());
    assert!(!asset_path.exists(), "purge must remove the asset file");

    // Double-purge errors.
    assert!(db.purge_annotation(app_dir.path(), &annotation.id).is_err());
    // Trash/restore on missing ids error.
    assert!(db.trash_annotation(&annotation.id).is_err());
    assert!(db.restore_annotation(&annotation.id).is_err());
  }

  #[test]
  fn test_asset_path_validation_and_lifecycle() {
    let db = Database::in_memory().unwrap();
    let app_dir = tempdir().unwrap();
    let (doc_id, version_id) = seed_document_and_version(&db);

    // Invalid relative paths are rejected before the schema is touched.
    for bad in [
      "mereth_reader.db",                       // not under annotations/
      "annotations",                            // no file name
      "annotations/",                           // empty file name
      "/annotations/x.png",                     // absolute
      r"annotations\x.png",                     // backslashes
      "annotations/../documents/x.png",         // traversal
      "annotations/a/../../b.png",              // traversal
      "annotations/./x.png",                    // dot component
      "",
    ] {
      assert!(validate_asset_relative_path(bad).is_err(), "must reject: {bad}");
    }
    assert!(validate_asset_relative_path("annotations/x.png").is_ok());

    // The file must exist at insert time — no dangling rows (FR-9.7).
    let asset = AnnotationAsset {
      id: "asset-missing".into(),
      annotation_id: "ann-missing".into(),
      document_id: doc_id.clone(),
      asset_kind: "area_capture".into(),
      relative_path: "annotations/nope.png".into(),
      content_type: "image/png".into(),
      width_px: 10,
      height_px: 10,
      caption: String::new(),
      created_at: "2026-08-04T13:52:57Z".into(),
      provenance: "user_authored".into(),
    };
    assert!(db.add_annotation_asset(app_dir.path(), &asset).is_err());

    // Full lifecycle: file exists -> row insert -> read -> delete (file + row).
    let annotation = sample_annotation(&doc_id, &version_id);
    db.add_annotation(&annotation).unwrap();
    fs::create_dir_all(app_dir.path().join(ASSET_ROOT_COMPONENT)).unwrap();
    let file = app_dir.path().join("annotations").join("real.png");
    fs::write(&file, b"png").unwrap();

    let asset = AnnotationAsset {
      id: "asset-real".into(),
      annotation_id: annotation.id.clone(),
      document_id: doc_id.clone(),
      asset_kind: "area_capture".into(),
      relative_path: "annotations/real.png".into(),
      content_type: "image/png".into(),
      width_px: 640,
      height_px: 480,
      caption: "Figure 2".into(),
      created_at: "2026-08-04T13:52:57Z".into(),
      provenance: "user_authored".into(),
    };
    db.add_annotation_asset(app_dir.path(), &asset).unwrap();
    let fetched = db.get_annotation_asset_by_id("asset-real").unwrap().unwrap();
    assert_eq!(fetched.relative_path, "annotations/real.png");
    assert_eq!(db.get_annotation_assets(&annotation.id).unwrap().len(), 1);

    // Bad kinds and dimensions are rejected.
    let mut bad_kind = asset.clone();
    bad_kind.id = "asset-bad-kind".into();
    bad_kind.asset_kind = "ink".into();
    assert!(db.add_annotation_asset(app_dir.path(), &bad_kind).is_err());

    let mut bad_dims = asset.clone();
    bad_dims.id = "asset-bad-dims".into();
    bad_dims.width_px = 0;
    assert!(db.add_annotation_asset(app_dir.path(), &bad_dims).is_err());

    // A relative_path that points outside annotations/ is rejected even if
    // the file exists.
    fs::write(app_dir.path().join("outside.png"), b"png").unwrap();
    let mut escape = asset.clone();
    escape.id = "asset-escape".into();
    escape.relative_path = "outside.png".into();
    assert!(db.add_annotation_asset(app_dir.path(), &escape).is_err());

    db.delete_annotation_asset(app_dir.path(), "asset-real").unwrap();
    assert!(db.get_annotation_asset_by_id("asset-real").unwrap().is_none());
    assert!(!file.exists(), "delete must remove the asset file");
    assert!(db.delete_annotation_asset(app_dir.path(), "asset-real").is_err());
  }

  #[test]
  fn test_asset_file_write_read_and_confinement() {
    let db = Database::in_memory().unwrap();
    let app_dir = tempdir().unwrap();

    // A missing annotations/ directory is created on first write.
    let good_path = "annotations/crop-1.png";
    let bytes: Vec<u8> = (0..256u32).map(|i| (i % 251) as u8).collect();
    db.write_asset_file(app_dir.path(), good_path, &bytes).unwrap();
    let written = app_dir.path().join("annotations").join("crop-1.png");
    assert!(written.exists());
    assert_eq!(fs::read(&written).unwrap(), bytes);

    // Read-back by row id round-trips the exact bytes. The row must exist
    // (FR-9.7: no dangling rows), so seed a minimal annotation + its asset.
    let (doc_id, version_id) = seed_document_and_version(&db);
    let annotation = sample_annotation(&doc_id, &version_id);
    db.add_annotation(&annotation).unwrap();
    let asset = AnnotationAsset {
      id: "asset-read".into(),
      annotation_id: annotation.id.clone(),
      document_id: doc_id.clone(),
      asset_kind: "area_capture".into(),
      relative_path: good_path.into(),
      content_type: "image/png".into(),
      width_px: 320,
      height_px: 240,
      caption: String::new(),
      created_at: "2026-08-04T13:52:57Z".into(),
      provenance: "user_authored".into(),
    };
    db.add_annotation_asset(app_dir.path(), &asset).unwrap();
    let read_back = db.read_asset_file(app_dir.path(), "asset-read").unwrap();
    assert_eq!(read_back, bytes);

    // Unknown asset id errors cleanly (no path is ever caller-supplied).
    assert!(db.read_asset_file(app_dir.path(), "missing").is_err());

    // A row whose stored path escaped the annotations/ root is rejected on
    // read even if the file exists.
    let conn = db.conn.lock().unwrap();
    conn
      .execute(
        "INSERT INTO annotation_assets (id, annotation_id, document_id, asset_kind, relative_path, content_type, width_px, height_px, created_at, provenance)
         VALUES ('asset-escape', ?2, ?1, 'area_capture', 'outside.png', 'image/png', 10, 10, 'now', 'user_authored')",
        params![doc_id, annotation.id],
      )
      .unwrap();
    drop(conn);
    fs::write(app_dir.path().join("outside.png"), b"x").unwrap();
    assert!(db.read_asset_file(app_dir.path(), "asset-escape").is_err());
  }

  #[test]
  fn test_remove_asset_file_cleanup_path() {
    let db = Database::in_memory().unwrap();
    let app_dir = tempdir().unwrap();

    db.write_asset_file(app_dir.path(), "annotations/cleanup.png", b"bytes").unwrap();
    let target = app_dir.path().join("annotations").join("cleanup.png");
    assert!(target.exists());

    // Removal deletes the file; a second removal is a no-op.
    db.remove_asset_file(app_dir.path(), "annotations/cleanup.png").unwrap();
    assert!(!target.exists());
    db.remove_asset_file(app_dir.path(), "annotations/cleanup.png").unwrap();

    // Confinement is re-checked on the cleanup path too.
    for bad in ["../escape.png", "/abs.png", "mereth_reader.db"] {
      assert!(db.remove_asset_file(app_dir.path(), bad).is_err(), "must reject: {bad}");
    }
    // Files elsewhere in the app data root are untouched (a cleanup cannot
    // escape the annotations/ directory).
    fs::write(app_dir.path().join("other.png"), b"keep").unwrap();
    db.remove_asset_file(app_dir.path(), "annotations/none.png").unwrap();
    assert!(app_dir.path().join("other.png").exists());
  }

  #[test]
  fn test_asset_file_write_atomicity_and_bad_paths() {
    let db = Database::in_memory().unwrap();
    let app_dir = tempdir().unwrap();

    // Invalid relative paths never touch the filesystem.
    fs::create_dir_all(app_dir.path().join(ASSET_ROOT_COMPONENT)).unwrap();
    for bad in ["../escape.png", "/abs.png", "annotations", "mereth_reader.db", r"annotations\x.png"] {
      assert!(db.write_asset_file(app_dir.path(), bad, b"x").is_err(), "must reject: {bad}");
    }

    // A successful write leaves no .tmp leftovers behind.
    db.write_asset_file(app_dir.path(), "annotations/clean.png", b"abc").unwrap();
    let leftovers: Vec<_> = fs::read_dir(app_dir.path().join(ASSET_ROOT_COMPONENT))
      .unwrap()
      .filter_map(|e| e.ok())
      .map(|e| e.file_name().to_string_lossy().to_string())
      .filter(|n| n.contains(".tmp-"))
      .collect();
    assert!(leftovers.is_empty(), "atomic write must not leak temp files: {leftovers:?}");

    // Overwriting an existing asset is allowed (idempotent re-capture) and
    // stays atomic.
    db.write_asset_file(app_dir.path(), "annotations/clean.png", b"xyz").unwrap();
    assert_eq!(
      fs::read(app_dir.path().join("annotations").join("clean.png")).unwrap(),
      b"xyz"
    );

    // Zero-byte assets are legal (a valid crop can be blank); they must still
    // produce a file so the row-insert existence check passes.
    db.write_asset_file(app_dir.path(), "annotations/empty.png", b"").unwrap();
    assert!(app_dir.path().join("annotations").join("empty.png").exists());
  }

  /// FR-9.7: the atomic `create_area_capture` writes the file and inserts both
  /// rows in one call — no orphaned bitmap, no row-without-bitmap, and a failed
  /// asset insert rolls back the annotation row and the file.
  #[test]
  fn test_create_area_capture_atomic() {
    let db = Database::in_memory().unwrap();
    let (doc_id, version_id) = seed_document_and_version(&db);
    let app_dir = tempdir().unwrap();

    let annotation = Annotation {
      id: "ann-cap".into(),
      document_id: doc_id.clone(),
      document_version_id: version_id.clone(),
      checksum: "ck".into(),
      annotation_type: "area".into(),
      page_index: 0,
      page_label: "1".into(),
      rects: vec![NormalizedRect { x: 0.1, y: 0.1, width: 0.4, height: 0.3 }],
      quote: "".into(),
      prefix_text: "".into(),
      suffix_text: "".into(),
      text_layer_checksum: None,
      comment: "".into(),
      color: "claim".into(),
      tags: vec![],
      deleted_at: None,
      created_at: "2026-08-18T00:00:00Z".into(),
      updated_at: "2026-08-18T00:00:00Z".into(),
      provenance: "user_authored".into(),
    };
    let asset = AnnotationAsset {
      id: "asset-cap".into(),
      annotation_id: "ann-cap".into(),
      document_id: doc_id.clone(),
      asset_kind: "area_capture".into(),
      relative_path: "annotations/asset-cap.png".into(),
      content_type: "image/png".into(),
      width_px: 640,
      height_px: 480,
      caption: "Fig".into(),
      created_at: "2026-08-18T00:00:00Z".into(),
      provenance: "user_authored".into(),
    };

    db.create_area_capture(app_dir.path(), &annotation, &asset, b"crop-bytes")
      .unwrap();

    // Both rows exist and the file is on disk.
    assert!(db.get_annotation_by_id("ann-cap").unwrap().is_some());
    assert_eq!(db.get_annotation_assets("ann-cap").unwrap().len(), 1);
    assert_eq!(
      fs::read(app_dir.path().join("annotations").join("asset-cap.png")).unwrap(),
      b"crop-bytes"
    );

    // A mismatched annotation_id on the asset is rejected before any write.
    let mut bad_asset = asset.clone();
    bad_asset.id = "asset-bad".into();
    bad_asset.annotation_id = "wrong".into();
    bad_asset.relative_path = "annotations/asset-bad.png".into();
    assert!(db
      .create_area_capture(app_dir.path(), &annotation, &bad_asset, b"x")
      .is_err());
    assert!(!app_dir.path().join("annotations").join("asset-bad.png").exists());

    // Oversized payload is rejected.
    let huge = vec![0u8; 25 * 1024 * 1024];
    let mut big_asset = asset.clone();
    big_asset.id = "asset-big".into();
    big_asset.relative_path = "annotations/asset-big.png".into();
    assert!(db
      .create_area_capture(app_dir.path(), &annotation, &big_asset, &huge)
      .is_err());
    assert!(!app_dir.path().join("annotations").join("asset-big.png").exists());
  }

  /// FR-9.7: a failed asset insert must roll back the annotation insert too
  /// (the two inserts run in a single transaction, not autocommit). This test
  /// forces a duplicate asset PK so the annotation insert succeeds but the
  /// asset insert fails — the transaction must discard both.
  #[test]
  fn test_create_area_capture_transaction_rolls_back_on_duplicate_asset() {
    let db = Database::in_memory().unwrap();
    let (doc_id, version_id) = seed_document_and_version(&db);
    let app_dir = tempdir().unwrap();

    let annotation = Annotation {
      id: "ann-tx".into(),
      document_id: doc_id.clone(),
      document_version_id: version_id.clone(),
      checksum: "ck".into(),
      annotation_type: "area".into(),
      page_index: 0,
      page_label: "1".into(),
      rects: vec![NormalizedRect { x: 0.1, y: 0.1, width: 0.4, height: 0.3 }],
      quote: "".into(),
      prefix_text: "".into(),
      suffix_text: "".into(),
      text_layer_checksum: None,
      comment: "".into(),
      color: "claim".into(),
      tags: vec![],
      deleted_at: None,
      created_at: "2026-08-18T00:00:00Z".into(),
      updated_at: "2026-08-18T00:00:00Z".into(),
      provenance: "user_authored".into(),
    };
    let asset = AnnotationAsset {
      id: "asset-tx".into(),
      annotation_id: "ann-tx".into(),
      document_id: doc_id.clone(),
      asset_kind: "area_capture".into(),
      relative_path: "annotations/asset-tx.png".into(),
      content_type: "image/png".into(),
      width_px: 640,
      height_px: 480,
      caption: "".into(),
      created_at: "2026-08-18T00:00:00Z".into(),
      provenance: "user_authored".into(),
    };

    // First call succeeds — both rows + file are created.
    db.create_area_capture(app_dir.path(), &annotation, &asset, b"first")
      .unwrap();

    // Second call with a DIFFERENT annotation id but the SAME asset id.
    // The annotation insert succeeds (new PK) but the asset insert fails
    // (duplicate PK) — the transaction must roll back the annotation too.
    let mut ann2 = annotation.clone();
    ann2.id = "ann-tx-2".into();
    ann2.rects = vec![NormalizedRect { x: 0.2, y: 0.2, width: 0.3, height: 0.2 }];
    let result = db.create_area_capture(app_dir.path(), &ann2, &asset, b"second");
    assert!(result.is_err(), "duplicate asset PK must error");

    // The second annotation was rolled back — it must not exist.
    assert!(
      db.get_annotation_by_id("ann-tx-2").unwrap().is_none(),
      "transaction must roll back the annotation insert when the asset insert fails"
    );
    // The first annotation is untouched.
    assert!(db.get_annotation_by_id("ann-tx").unwrap().is_some());
    // The first call's asset row still references the file.
    let assets = db.get_annotation_assets("ann-tx").unwrap();
    assert_eq!(assets.len(), 1);
    assert_eq!(assets[0].id, "asset-tx");
  }

  /// FR-9.7 crash recovery: `reconcile_orphaned_asset_files` removes files in
  /// `annotations/` that have no matching `annotation_assets` row, while
  /// leaving referenced files untouched.
  #[test]
  fn test_reconcile_orphaned_asset_files() {
    let db = Database::in_memory().unwrap();
    let (doc_id, version_id) = seed_document_and_version(&db);
    let app_dir = tempdir().unwrap();
    fs::create_dir_all(app_dir.path().join(ASSET_ROOT_COMPONENT)).unwrap();

    // A referenced file: write it + create the rows via create_area_capture.
    let annotation = Annotation {
      id: "ann-recon".into(),
      document_id: doc_id.clone(),
      document_version_id: version_id.clone(),
      checksum: "ck".into(),
      annotation_type: "area".into(),
      page_index: 0,
      page_label: "1".into(),
      rects: vec![NormalizedRect { x: 0.1, y: 0.1, width: 0.4, height: 0.3 }],
      quote: "".into(),
      prefix_text: "".into(),
      suffix_text: "".into(),
      text_layer_checksum: None,
      comment: "".into(),
      color: "claim".into(),
      tags: vec![],
      deleted_at: None,
      created_at: "2026-08-18T00:00:00Z".into(),
      updated_at: "2026-08-18T00:00:00Z".into(),
      provenance: "user_authored".into(),
    };
    let asset = AnnotationAsset {
      id: "asset-recon".into(),
      annotation_id: "ann-recon".into(),
      document_id: doc_id.clone(),
      asset_kind: "area_capture".into(),
      relative_path: "annotations/asset-recon.png".into(),
      content_type: "image/png".into(),
      width_px: 100,
      height_px: 100,
      caption: "".into(),
      created_at: "2026-08-18T00:00:00Z".into(),
      provenance: "user_authored".into(),
    };
    db.create_area_capture(app_dir.path(), &annotation, &asset, b"keep")
      .unwrap();

    // An orphaned file: write it directly (simulates a crash after file write
    // but before DB transaction commit).
    fs::write(
      app_dir.path().join("annotations").join("orphan.png"),
      b"orphan",
    )
    .unwrap();

    // A temp file from an in-progress atomic write — must be skipped.
    fs::write(
      app_dir.path().join("annotations").join(".crop.png.tmp-abc"),
      b"tmp",
    )
    .unwrap();

    let removed = db.reconcile_orphaned_asset_files(app_dir.path()).unwrap();
    assert_eq!(removed, 1, "exactly the orphaned file must be removed");

    // The referenced file is untouched.
    assert!(app_dir.path().join("annotations").join("asset-recon.png").exists());
    // The orphan is gone.
    assert!(!app_dir.path().join("annotations").join("orphan.png").exists());
    // The temp file was skipped (still there — a concurrent write may finalise it).
    assert!(app_dir.path().join("annotations").join(".crop.png.tmp-abc").exists());

    // Running again is a no-op (idempotent).
    let removed2 = db.reconcile_orphaned_asset_files(app_dir.path()).unwrap();
    assert_eq!(removed2, 0);

    // Missing annotations/ directory is a clean no-op.
    let empty_dir = tempdir().unwrap();
    let removed3 = db.reconcile_orphaned_asset_files(empty_dir.path()).unwrap();
    assert_eq!(removed3, 0);
  }

  #[test]
  fn test_fk_cascades_and_checks_fire_at_schema_level() {
    let db = Database::in_memory().unwrap();
    let (doc_id, version_id) = seed_document_and_version(&db);

    // highlight with empty quote fails at the schema level for user_authored.
    let conn = db.conn.lock().unwrap();
    let res = conn.execute(
      "INSERT INTO annotations (id, document_id, document_version_id, annotation_type, page_index, quote, created_at, updated_at, provenance)
       VALUES ('h-noquote', ?1, ?2, 'highlight', 0, '', 'now', 'now', 'user_authored')",
      params![doc_id, version_id],
    );
    assert!(res.is_err(), "highlight without quote must fail the CHECK");

    // FR-9.9: imported (deterministic_transform) highlight with empty quote
    // is allowed — the PDF carries geometry, not guaranteed text.
    let ok_imported = conn.execute(
      "INSERT INTO annotations (id, document_id, document_version_id, annotation_type, page_index, rects_json, quote, created_at, updated_at, provenance)
       VALUES ('h-imported', ?1, ?2, 'highlight', 0, '[{\"x\":0.1,\"y\":0.1,\"width\":0.4,\"height\":0.03}]', '', 'now', 'now', 'deterministic_transform')",
      params![doc_id, version_id],
    );
    assert!(ok_imported.is_ok(), "imported highlight without quote must pass the CHECK");

    // area with empty rects fails at the schema level.
    let res = conn.execute(
      "INSERT INTO annotations (id, document_id, document_version_id, annotation_type, page_index, quote, created_at, updated_at, provenance)
       VALUES ('a-norect', ?1, ?2, 'area', 0, '', 'now', 'now', 'user_authored')",
      params![doc_id, version_id],
    );
    assert!(res.is_err(), "area without rects must fail the CHECK");

    // The annotation Schema-valid values pass.
    let ok_comment = conn.execute(
      "INSERT INTO annotations (id, document_id, document_version_id, annotation_type, page_index, rects_json, quote, created_at, updated_at, provenance)
       VALUES ('c1', ?1, ?2, 'comment', 3, '[]', '', 'now', 'now', 'user_authored')",
      params![doc_id, version_id],
    );
    assert!(ok_comment.is_ok());

    // Deleting the document cascades to its annotations (h-imported + c1 = 2).
    drop(conn);
    let listed = db.get_annotations_for_document(&doc_id, true).unwrap();
    assert_eq!(listed.len(), 2);
    db.delete_document(&doc_id).unwrap();
    assert!(db.get_annotation_by_id("c1").unwrap().is_none());
  }

  /// R2 gate (task 3.8, PRD §9.3): annotation creation must be durable
  /// within 500 ms. This measures the REAL typed persistence path
  /// (`db_add_annotation`) against a FILE-BACKED database that already holds
  /// 10,000 annotation rows — the same shape a long-reading user would have —
  /// and enforces the budget here (Rust side), while printing the exact sample
  /// list for the webview gate suite (`r2RecoveryGate.test.ts`) to parse
  /// from cargo output and fold into the combined R2 report. A file-backed
  /// (disk) database is used instead of in-memory so the measurement includes
  /// real WAL + fsync I/O — the shipped creation path, not an idealised
  /// memory-only one that can pass while the disk path exceeds the budget.
  #[test]
  fn test_db_add_annotation_durability_budget_at_10k_rows() {
    let app_dir = tempdir().unwrap();
    let db = Database::new(app_dir.path()).unwrap();
    let (doc_id, version_id) = seed_document_and_version(&db);

    // Bulk-seed 10,000 rows through one prepared statement using the exact
    // 19-column shape the typed layer writes.
    {
      let conn = db.conn.lock().unwrap();
      let mut stmt = conn
        .prepare(
          "INSERT INTO annotations (
             id, document_id, document_version_id, annotation_type, page_index,
             page_label, rects_json, quote, prefix_text, suffix_text,
             text_layer_checksum, comment, color, tags, deleted_at,
             created_at, updated_at, provenance, checksum
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        )
        .unwrap();
      for i in 0..10_000 {
        stmt
          .execute(params![
            format!("seed-{i}"),
            doc_id,
            version_id,
            "highlight",
            0,
            "1",
            "[{\"x\":0.1,\"y\":0.2,\"width\":0.6,\"height\":0.04}]",
            format!("Quoted passage {i} about the fox"),
            "",
            "",
            Option::<String>::None,
            "",
            "claim",
            "[]",
            Option::<String>::None,
            "2026-08-18T00:00:00Z",
            "2026-08-18T00:00:00Z",
            "user_authored",
            format!("checksum-{i}"),
          ])
          .unwrap();
      }
      let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM annotations", [], |r| r.get(0))
        .unwrap();
      assert_eq!(count, 10_000);
    }

    const SAMPLES: usize = 50;
    let mut samples: Vec<f64> = Vec::with_capacity(SAMPLES);
    for _ in 0..SAMPLES {
      let annotation = sample_annotation(&doc_id, &version_id);
      let start = std::time::Instant::now();
      db.add_annotation(&annotation).unwrap();
      samples.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = samples[SAMPLES / 2];
    let worst = samples[SAMPLES - 1];
    // The webview gate suite parses this exact line from cargo output
    // (stdout — stderr is discarded by execFileSync on success).
    println!("R2 DURABILITY median_ms={median:.3} worst_ms={worst:.3} samples={samples:?}");
    assert!(
      median < 500.0,
      "R2 gate: typed annotation insert median {median:.3} ms exceeds the durable budget of 500 ms"
    );
  }
}
