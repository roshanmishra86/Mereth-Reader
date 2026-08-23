//! Task 3.3 — document fingerprinting and version handling (PRD FR-7.3, RK-2).
//!
//! Each import registers a `document_versions` row holding the version's
//! cryptographic fingerprint (SHA-256, recomputed server-side from the file —
//! never accepted from the webview), its page count, and its page geometry
//! (measured by the renderer after load and validated here). When the bytes at
//! a known path change, the next open detects the mismatch against the row the
//! annotations reference and the app **offers re-anchoring** instead of
//! silently reusing old coordinates:
//!
//! - `check_document_version_state` recomputes the file hash and reports
//!   missing / unregistered / unchanged / changed;
//! - `register_document_version` creates version N+1 (or v1 for a new
//!   document) with the server-recomputed fingerprint and page count, and
//!   converges `documents.sha256_hash` to the current bytes;
//! - `update_version_geometry` stores the measured geometry, restricted to the
//!   latest version so history cannot be rewritten;
//! - `reanchor_annotation_to_version` points a quote-matched annotation at the
//!   new version with a recomputed checksum — its quote, coordinates, and
//!   comment are untouched (FR-9.5). Annotations that do not move keep their
//!   old `document_version_id` and are therefore "detached" by construction:
//!   old coordinates are never attached to new bytes blindly.

use super::Database;
use crate::import::compute_file_metadata;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PageGeometry {
  /// 1-based physical page number as used by the renderer.
  pub page: i64,
  /// Width in PDF points at scale 1 (pdf.js base viewport).
  pub width: f64,
  pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentVersion {
  pub id: String,
  pub document_id: String,
  pub version_number: i64,
  pub sha256_hash: String,
  pub page_count: i64,
  #[serde(default)]
  pub page_geometry: Vec<PageGeometry>,
  pub created_at: String,
  pub provenance: String,
}

/// Result of the open-time fingerprint check (FR-7.3).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VersionCheckResult {
  /// One of `missing` | `unregistered` | `unchanged` | `changed`.
  pub status: String,
  /// Fingerprint currently recorded on `documents` (the file fingerprint).
  pub document_sha256_hash: String,
  /// Recomputed fingerprint of the file on disk; None when the file is gone.
  pub file_sha256_hash: Option<String>,
  /// Id of the version row annotations currently reference (None until the
  /// first version is registered).
  pub current_version_id: Option<String>,
  pub current_version_number: i64,
  /// Recomputed page count of the file on disk (0 when the file is gone).
  pub file_page_count: i64,
}

const VERSION_COLS: &str = "id, document_id, version_number, sha256_hash, page_count, page_geometry_json, created_at, provenance";

const MAX_GEOMETRY_ENTRIES: i64 = 100_000;
const MAX_DIMENSION_PX: f64 = 100_000.0;

fn map_row_to_version(row: &rusqlite::Row<'_>) -> rusqlite::Result<DocumentVersion> {
  let geometry_json: String = row.get(5)?;
  Ok(DocumentVersion {
    id: row.get(0)?,
    document_id: row.get(1)?,
    version_number: row.get(2)?,
    sha256_hash: row.get(3)?,
    page_count: row.get(4)?,
    // Tolerant decode: rows are always written as valid JSON by this module.
    page_geometry: serde_json::from_str(&geometry_json).unwrap_or_default(),
    created_at: row.get(6)?,
    provenance: row.get(7)?,
  })
}

/// Validates measured page geometry against a version's page count: 1-based
/// pages within range, finite positive dimensions that look like PDF points,
/// and no duplicate pages.
pub fn validate_page_geometry(geometry: &[PageGeometry], page_count: i64) -> Result<(), String> {
  if page_count <= 0 {
    return Err("Version page count must be positive".to_string());
  }
  if geometry.len() as i64 > MAX_GEOMETRY_ENTRIES {
    return Err(format!(
      "Geometry has too many entries ({}); max is {MAX_GEOMETRY_ENTRIES}",
      geometry.len()
    ));
  }
  let mut seen = std::collections::HashSet::new();
  for (i, g) in geometry.iter().enumerate() {
    if g.page < 1 || g.page > page_count {
      return Err(format!(
        "geometry[{i}].page must be in 1..={page_count}, got {}",
        g.page
      ));
    }
    if !seen.insert(g.page) {
      return Err(format!("Duplicate geometry entry for page {}", g.page));
    }
    for (name, value) in [("width", g.width), ("height", g.height)] {
      if !value.is_finite() || value <= 0.0 || value > MAX_DIMENSION_PX {
        return Err(format!(
          "geometry[{i}].{name} must be a finite positive value <= {MAX_DIMENSION_PX}, got {value}"
        ));
      }
    }
  }
  Ok(())
}

impl Database {
  /// Returns the version row annotations currently reference — the highest
  /// `version_number` for the document.
  pub fn get_current_version(&self, document_id: &str) -> Result<Option<DocumentVersion>, String> {
    let conn = self.conn.lock().unwrap();
    let query = format!(
      "SELECT {VERSION_COLS} FROM document_versions
       WHERE document_id = ?1 ORDER BY version_number DESC LIMIT 1"
    );
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let mut rows = stmt
      .query_map(params![document_id], map_row_to_version)
      .map_err(|e| e.to_string())?;
    if let Some(row_res) = rows.next() {
      Ok(Some(row_res.map_err(|e| e.to_string())?))
    } else {
      Ok(None)
    }
  }

  /// All versions of a document, oldest first.
  pub fn get_document_versions(&self, document_id: &str) -> Result<Vec<DocumentVersion>, String> {
    let conn = self.conn.lock().unwrap();
    let query = format!(
      "SELECT {VERSION_COLS} FROM document_versions
       WHERE document_id = ?1 ORDER BY version_number ASC"
    );
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let versions = stmt
      .query_map(params![document_id], map_row_to_version)
      .map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();
    Ok(versions)
  }

  /// Open-time fingerprint check (FR-7.3). The file hash is recomputed
  /// server-side from the document record's path; the comparison baseline is
  /// the version row annotations reference (not `documents.sha256_hash`,
  /// which tracks the current file fingerprint and is updated by
  /// relocation/registration — comparing against the version row is what
  /// makes "different bytes at a known path" detectable even after a
  /// relocate-with-different-file).
  pub fn check_document_version_state(&self, document_id: &str) -> Result<VersionCheckResult, String> {
    let doc = self
      .get_document_by_id(document_id)?
      .ok_or_else(|| format!("Document not found: {document_id}"))?;

    let current = self.get_current_version(document_id)?;

    let metadata = compute_file_metadata(&doc.filepath).map_err(|e| e.to_string())?;
    if !metadata.exists || metadata.sha256_hash.is_empty() {
      return Ok(VersionCheckResult {
        status: "missing".into(),
        document_sha256_hash: doc.sha256_hash,
        file_sha256_hash: None,
        current_version_id: current.as_ref().map(|v| v.id.clone()),
        current_version_number: current.as_ref().map(|v| v.version_number).unwrap_or(0),
        file_page_count: 0,
      });
    }

    let Some(current) = current else {
      return Ok(VersionCheckResult {
        status: "unregistered".into(),
        document_sha256_hash: doc.sha256_hash,
        file_sha256_hash: Some(metadata.sha256_hash.clone()),
        current_version_id: None,
        current_version_number: 0,
        file_page_count: metadata.page_count as i64,
      });
    };

    let status = if current.sha256_hash == metadata.sha256_hash {
      "unchanged".to_string()
    } else {
      "changed".to_string()
    };

    Ok(VersionCheckResult {
      status,
      document_sha256_hash: doc.sha256_hash,
      file_sha256_hash: Some(metadata.sha256_hash.clone()),
      current_version_id: Some(current.id.clone()),
      current_version_number: current.version_number,
      file_page_count: metadata.page_count as i64,
    })
  }

  /// Registers the next version of a document from the file's CURRENT bytes:
  /// the fingerprint and page count are recomputed server-side and are never
  /// accepted from the webview (PRD §15.3). Idempotent when the file's hash
  /// already matches the current version (returns it unchanged). Also
  /// converges `documents.sha256_hash` to the current bytes so dedup stays
  /// truthful (FR-7.7).
  pub fn register_document_version(&self, document_id: &str) -> Result<DocumentVersion, String> {
    let doc = self
      .get_document_by_id(document_id)?
      .ok_or_else(|| format!("Document not found: {document_id}"))?;

    let metadata = compute_file_metadata(&doc.filepath).map_err(|e| e.to_string())?;
    if !metadata.exists || metadata.sha256_hash.is_empty() {
      return Err(format!(
        "Cannot register a version for a missing file: {}",
        doc.filepath
      ));
    }

    let current = self.get_current_version(document_id)?;
    if let Some(current) = &current {
      if current.sha256_hash == metadata.sha256_hash {
        // The bytes on disk already match the referenced version — nothing to
        // add. (documents.sha256_hash is still converged below in case a
        // relocate stored a differing hash.)
        let conn = self.conn.lock().unwrap();
        let changed = conn
          .execute(
            "UPDATE documents SET sha256_hash = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?2",
            params![metadata.sha256_hash, document_id],
          )
          .map_err(|e| e.to_string())?;
        debug_assert_eq!(changed, 1);
        return Ok(current.clone());
      }
    }

    let next_number = current.as_ref().map(|v| v.version_number + 1).unwrap_or(1);
    let version = DocumentVersion {
      id: uuid::Uuid::new_v4().to_string(),
      document_id: document_id.to_string(),
      version_number: next_number,
      sha256_hash: metadata.sha256_hash.clone(),
      page_count: metadata.page_count as i64,
      page_geometry: Vec::new(),
      created_at: "".to_string(),
      provenance: "source_extracted".to_string(),
    };

    let mut conn = self.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
      "INSERT INTO document_versions (
        id, document_id, version_number, sha256_hash, page_count,
        page_geometry_json, created_at, provenance
      ) VALUES (?1, ?2, ?3, ?4, ?5, '[]', strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?6)",
      params![
        version.id,
        version.document_id,
        version.version_number,
        version.sha256_hash,
        version.page_count,
        version.provenance,
      ],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
      "UPDATE documents SET sha256_hash = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?2",
      params![metadata.sha256_hash, document_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    // Release the connection before re-reading: std::sync::Mutex is not
    // reentrant, and get_current_version acquires the same lock.
    drop(conn);

    // Re-read the row we just wrote so created_at reflects the DB timestamp.
    let persisted = self
      .get_current_version(document_id)?
      .unwrap_or(version);
    Ok(persisted)
  }

  /// Stores measured page geometry for a version. Restricted to the LATEST
  /// version of a document so earlier rows (the history annotations may still
  /// reference) cannot be rewritten after the fact.
  pub fn update_version_geometry(
    &self,
    version_id: &str,
    geometry: &[PageGeometry],
  ) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();

    let (document_id, page_count): (String, i64) = conn
      .query_row(
        "SELECT document_id, page_count FROM document_versions WHERE id = ?1",
        params![version_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
      )
      .map_err(|_| format!("Version not found: {version_id}"))?;

    // Only the latest version of the document may receive geometry.
    let latest_id: String = conn
      .query_row(
        "SELECT id FROM document_versions WHERE document_id = ?1 ORDER BY version_number DESC LIMIT 1",
        params![document_id],
        |row| row.get(0),
      )
      .map_err(|e| e.to_string())?;
    if latest_id != version_id {
      return Err(format!(
        "Geometry may only be stored on the latest version (v{p}; this is v{c})",
        p = page_count,
        c = latest_id
      ));
    }

    validate_page_geometry(geometry, page_count)?;

    conn
      .execute(
        "UPDATE document_versions SET page_geometry_json = ?1 WHERE id = ?2",
        params![serde_json::to_string(geometry).map_err(|e| e.to_string())?, version_id],
      )
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  /// Moves a quote-matched annotation to a new version with a recomputed
  /// checksum. The quote, coordinates, and comment are untouched (FR-9.5);
  /// non-matching annotations keep their old version id and are "detached" by
  /// construction — old coordinates are never attached to new bytes blindly
  /// (FR-7.3, RK-2).
  pub fn reanchor_annotation_to_version(
    &self,
    annotation_id: &str,
    new_version_id: &str,
    new_checksum: &str,
  ) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();

    // Both rows must belong to the same document.
    let (annotation_doc, annotation_version): (String, String) = conn
      .query_row(
        "SELECT document_id, document_version_id FROM annotations WHERE id = ?1",
        params![annotation_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
      )
      .map_err(|_| format!("Annotation not found: {annotation_id}"))?;
    let version_doc: String = conn
      .query_row(
        "SELECT document_id FROM document_versions WHERE id = ?1",
        params![new_version_id],
        |row| row.get(0),
      )
      .map_err(|_| format!("Version not found: {new_version_id}"))?;
    if annotation_doc != version_doc {
      return Err("Cannot re-anchor an annotation to a version of another document".to_string());
    }
    if annotation_version == new_version_id {
      return Err("Annotation already references this version".to_string());
    }

    if new_checksum.is_empty() {
      return Err("Re-anchored annotations require a recomputed checksum".to_string());
    }

    conn
      .execute(
        "UPDATE annotations SET
           document_version_id = ?1,
           checksum = ?2,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?3",
        params![new_version_id, new_checksum, annotation_id],
      )
      .map_err(|e| e.to_string())?;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::{annotations::{Annotation, NormalizedRect}, Database, Document};
  use std::io::Write;
  use tempfile::tempdir;
  use uuid::Uuid;

  fn seed_document(db: &Database, path: &std::path::Path) -> String {
    let doc_id = Uuid::new_v4().to_string();
    let doc = Document {
      id: doc_id.clone(),
      title: "Version Test Document".into(),
      filepath: path.to_string_lossy().to_string(),
      sha256_hash: "f0".repeat(32),
      page_count: 3,
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
    doc_id
  }

  fn write_pdf(path: &std::path::Path, marker: &str) {
    let mut f = std::fs::File::create(path).unwrap();
    f.write_all(format!("%PDF-1.4 {marker} content here").as_bytes()).unwrap();
    f.flush().unwrap();
  }

  #[test]
  fn test_version_lifecycle_registers_v1_then_v2_on_byte_change() {
    let db = Database::in_memory().unwrap();
    let dir = tempdir().unwrap();
    let pdf_path = dir.path().join("doc.pdf");
    write_pdf(&pdf_path, "v1");

    let doc_id = seed_document(&db, &pdf_path);

    // Fresh document: nothing registered yet.
    let check = db.check_document_version_state(&doc_id).unwrap();
    assert_eq!(check.status, "unregistered");
    assert!(check.current_version_id.is_none());

    // First registration creates version 1 with the server-recomputed hash.
    let v1 = db.register_document_version(&doc_id).unwrap();
    assert_eq!(v1.version_number, 1);
    assert_eq!(v1.page_count, 1);
    assert_eq!(v1.sha256_hash.len(), 64);
    assert!(v1.page_geometry.is_empty());
    assert_eq!(v1.provenance, "source_extracted");

    // The document fingerprint converges to the registered bytes.
    let doc_after = db.get_document_by_id(&doc_id).unwrap().unwrap();
    assert_eq!(doc_after.sha256_hash, v1.sha256_hash);

    // Unchanged file → unchanged state; re-register is idempotent.
    let check = db.check_document_version_state(&doc_id).unwrap();
    assert_eq!(check.status, "unchanged");
    assert_eq!(check.current_version_id.as_deref(), Some(v1.id.as_str()));
    let again = db.register_document_version(&doc_id).unwrap();
    assert_eq!(again.id, v1.id, "same bytes must not create a duplicate version");
    assert_eq!(db.get_document_versions(&doc_id).unwrap().len(), 1);

    // Different bytes at the same path → changed, then registered as v2.
    write_pdf(&pdf_path, "v2-replaced");
    let check = db.check_document_version_state(&doc_id).unwrap();
    assert_eq!(check.status, "changed");
    assert_eq!(check.current_version_number, 1);
    assert_ne!(check.file_sha256_hash.as_deref(), Some(v1.sha256_hash.as_str()));

    let v2 = db.register_document_version(&doc_id).unwrap();
    assert_eq!(v2.version_number, 2);
    assert_ne!(v2.sha256_hash, v1.sha256_hash);

    let versions = db.get_document_versions(&doc_id).unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0].version_number, 1);
    assert_eq!(versions[1].version_number, 2);

    // documents.sha256_hash follows the bytes.
    let doc_after = db.get_document_by_id(&doc_id).unwrap().unwrap();
    assert_eq!(doc_after.sha256_hash, v2.sha256_hash);

    // Now unchanged again.
    let check = db.check_document_version_state(&doc_id).unwrap();
    assert_eq!(check.status, "unchanged");
  }

  #[test]
  fn test_missing_file_is_reported_without_panicking() {
    let db = Database::in_memory().unwrap();
    let dir = tempdir().unwrap();
    let pdf_path = dir.path().join("gone.pdf");
    write_pdf(&pdf_path, "temp");
    let doc_id = seed_document(&db, &pdf_path);
    db.register_document_version(&doc_id).unwrap();

    std::fs::remove_file(&pdf_path).unwrap();
    let check = db.check_document_version_state(&doc_id).unwrap();
    assert_eq!(check.status, "missing");
    assert!(check.file_sha256_hash.is_none());

    // Registering while missing is an error, not a silent row.
    assert!(db.register_document_version(&doc_id).is_err());
  }

  #[test]
  fn test_geometry_validation_and_latest_only_rule() {
    let db = Database::in_memory().unwrap();
    let dir = tempdir().unwrap();
    let pdf_path = dir.path().join("doc.pdf");
    write_pdf(&pdf_path, "geometry");
    let doc_id = seed_document(&db, &pdf_path);
    let v1 = db.register_document_version(&doc_id).unwrap();

    // Valid geometry for a 1-page file.
    db.update_version_geometry(
      &v1.id,
      &[PageGeometry { page: 1, width: 612.0, height: 792.0 }],
    )
    .unwrap();
    let versions = db.get_document_versions(&doc_id).unwrap();
    assert_eq!(versions[0].page_geometry.len(), 1);
    assert_eq!(versions[0].page_geometry[0].width, 612.0);

    // Invalid entries are rejected before touching the schema.
    let bad_cases: Vec<Vec<PageGeometry>> = vec![
      vec![PageGeometry { page: 0, width: 612.0, height: 792.0 }],          // page 0
      vec![PageGeometry { page: 2, width: 612.0, height: 792.0 }],          // page > page_count
      vec![PageGeometry { page: 1, width: -5.0, height: 792.0 }],           // negative width
      vec![PageGeometry { page: 1, width: f64::NAN, height: 792.0 }],       // NaN
      vec![PageGeometry { page: 1, width: 1e9, height: 792.0 }],            // absurd dimension
      vec![
        PageGeometry { page: 1, width: 612.0, height: 792.0 },
        PageGeometry { page: 1, width: 500.0, height: 700.0 },
      ], // duplicate page
    ];
    for bad in bad_cases {
      assert!(db.update_version_geometry(&v1.id, &bad).is_err());
    }

    // Geometry on a non-latest version is rejected.
    write_pdf(&pdf_path, "changed again");
    let v2 = db.register_document_version(&doc_id).unwrap();
    assert!(db.update_version_geometry(&v1.id, &[PageGeometry { page: 1, width: 100.0, height: 100.0 }]).is_err());
    // ...but allowed on the latest.
    db.update_version_geometry(&v2.id, &[PageGeometry { page: 1, width: 400.0, height: 600.0 }]).unwrap();

    // An empty geometry array is valid (deferred measurement).
    db.update_version_geometry(&v2.id, &[]).unwrap();
  }

  #[test]
  fn test_reanchor_moves_annotation_between_versions_without_touching_content() {
    let db = Database::in_memory().unwrap();
    let dir = tempdir().unwrap();
    let pdf_path = dir.path().join("doc.pdf");
    write_pdf(&pdf_path, "one two three");
    let doc_id = seed_document(&db, &pdf_path);
    let v1 = db.register_document_version(&doc_id).unwrap();

    let annotation = Annotation {
      id: Uuid::new_v4().to_string(),
      document_id: doc_id.clone(),
      document_version_id: v1.id.clone(),
      checksum: "checksum-v1".into(),
      annotation_type: "highlight".into(),
      page_index: 0,
      page_label: "1".into(),
      rects: vec![NormalizedRect { x: 0.1, y: 0.2, width: 0.5, height: 0.03 }],
      quote: "one two three".into(),
      prefix_text: "".into(),
      suffix_text: "".into(),
      text_layer_checksum: Some("abc".into()),
      comment: "keep me".into(),
      color: "red".into(),
      tags: vec![],
      deleted_at: None,
      created_at: "2026-08-04T13:52:57Z".into(),
      updated_at: "2026-08-04T13:52:57Z".into(),
      provenance: "user_authored".into(),
    };
    db.add_annotation(&annotation).unwrap();

    write_pdf(&pdf_path, "one two three v2");
    let v2 = db.register_document_version(&doc_id).unwrap();

    // Empty checksum rejected (a re-anchored annotation must carry a
    // recomputed version-bound checksum).
    assert!(db.reanchor_annotation_to_version(&annotation.id, &v2.id, "").is_err());

    db.reanchor_annotation_to_version(&annotation.id, &v2.id, "checksum-v2").unwrap();

    let moved = db.get_annotation_by_id(&annotation.id).unwrap().unwrap();
    assert_eq!(moved.document_version_id, v2.id);
    assert_ne!(moved.checksum, annotation.checksum);
    assert_eq!(moved.checksum, "checksum-v2");
    // FR-9.5: quote, coordinates, comment all untouched.
    assert_eq!(moved.quote, annotation.quote);
    assert_eq!(moved.rects, annotation.rects);
    assert_eq!(moved.comment, annotation.comment);
    assert_eq!(moved.page_index, annotation.page_index);

    // Re-anchoring again to the same version is a no-op error.
    assert!(db.reanchor_annotation_to_version(&annotation.id, &v2.id, "again").is_err());

    // Cross-document rejection: an annotation of another document cannot move
    // into this document's version.
    let dir2 = tempdir().unwrap();
    let pdf2 = dir2.path().join("other.pdf");
    write_pdf(&pdf2, "other doc");
    let other_doc_id = seed_document(&db, &pdf2);
    let other_ann = Annotation {
      id: Uuid::new_v4().to_string(),
      document_id: other_doc_id.clone(),
      document_version_id: v1.id.clone(), // will be fixed below
      checksum: String::new(),
      annotation_type: "bookmark".into(),
      page_index: 0,
      page_label: "1".into(),
      rects: vec![],
      quote: "".into(),
      prefix_text: "".into(),
      suffix_text: "".into(),
      text_layer_checksum: None,
      comment: "".into(),
      color: "".into(),
      tags: vec![],
      deleted_at: None,
      created_at: "2026-08-04T13:52:57Z".into(),
      updated_at: "2026-08-04T13:52:57Z".into(),
      provenance: "user_authored".into(),
    };
    // The bookmark must reference a version OF its own document; register one.
    let other_v1 = db.register_document_version(&other_doc_id).unwrap();
    let mut other_ann = other_ann;
    other_ann.document_version_id = other_v1.id.clone();
    db.add_annotation(&other_ann).unwrap();
    assert!(db.reanchor_annotation_to_version(&other_ann.id, &v2.id, "zzz").is_err());
  }
}
