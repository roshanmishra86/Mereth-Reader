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

use super::migrations::ALLOWED_PROVENANCES;
use super::Database;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

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

const ANNOTATION_COLS: &str = "id, document_id, document_version_id, annotation_type, \
  page_index, page_label, rects_json, quote, prefix_text, suffix_text, \
  text_layer_checksum, comment, color, tags, deleted_at, created_at, updated_at, provenance";

fn map_row_to_annotation(row: &rusqlite::Row<'_>) -> rusqlite::Result<Annotation> {
  let rects_json: String = row.get(6)?;
  let tags_json: String = row.get(13)?;
  Ok(Annotation {
    id: row.get(0)?,
    document_id: row.get(1)?,
    document_version_id: row.get(2)?,
    annotation_type: row.get(3)?,
    page_index: row.get(4)?,
    page_label: row.get(5)?,
    // Tolerant decode: rows written through this module are always valid JSON;
    // a corrupt value decodes to an empty shape rather than breaking the
    // whole row (the text-layer recovery path is a 2.8 concern).
    rects: serde_json::from_str(&rects_json).unwrap_or_default(),
    quote: row.get(7)?,
    prefix_text: row.get(8)?,
    suffix_text: row.get(9)?,
    text_layer_checksum: row.get(10)?,
    comment: row.get(11)?,
    color: row.get(12)?,
    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
    deleted_at: row.get(14)?,
    created_at: row.get(15)?,
    updated_at: row.get(16)?,
    provenance: row.get(17)?,
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

pub fn validate_provenance(provenance: &str) -> Result<(), String> {
  if ALLOWED_PROVENANCES.contains(&provenance) {
    Ok(())
  } else {
    Err(format!(
      "Invalid provenance '{provenance}'; expected one of {ALLOWED_PROVENANCES:?}"
    ))
  }
}

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
    "highlight" | "underline" if !has_quote => {
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
          created_at, updated_at, provenance
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
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
  fn test_fk_cascades_and_checks_fire_at_schema_level() {
    let db = Database::in_memory().unwrap();
    let (doc_id, version_id) = seed_document_and_version(&db);

    // highlight with empty quote fails at the schema level.
    let conn = db.conn.lock().unwrap();
    let res = conn.execute(
      "INSERT INTO annotations (id, document_id, document_version_id, annotation_type, page_index, quote, created_at, updated_at, provenance)
       VALUES ('h-noquote', ?1, ?2, 'highlight', 0, '', 'now', 'now', 'user_authored')",
      params![doc_id, version_id],
    );
    assert!(res.is_err(), "highlight without quote must fail the CHECK");

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

    // Deleting the document cascades to its annotations.
    drop(conn);
    let listed = db.get_annotations_for_document(&doc_id, true).unwrap();
    assert_eq!(listed.len(), 1);
    db.delete_document(&doc_id).unwrap();
    assert!(db.get_annotation_by_id("c1").unwrap().is_none());
  }
}
