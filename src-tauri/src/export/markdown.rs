//! Mereth Reader — Standalone Markdown Package Exporter (Task 4.8, FR-14.1, FR-14.2)
//!
//! Generates a self-contained, human-readable directory package:
//! - `notes/`: Markdown note files with YAML frontmatter.
//! - `sources/`: Source documents summary with excerpted highlights.
//! - `assets/`: Area capture image files with relative paths.
//! - `reviews/`: Markdown review cards.
//! - `manifest.json`: Structured package manifest (schema: `mereth.markdown-package`).

use crate::db::Database;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use uuid::Uuid;

pub const MARKDOWN_PACKAGE_SCHEMA: &str = "mereth.markdown-package";
pub const EXPORT_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifestEntry {
  pub id: String,
  pub path: String,
  pub kind: String,
  #[serde(default)]
  pub provenance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MarkdownPackageManifest {
  pub schema: String,
  pub schema_version: i64,
  pub exported_at: String,
  pub directories: Vec<String>,
  pub notes: Vec<ManifestEntry>,
  pub sources: Vec<ManifestEntry>,
  pub assets: Vec<ManifestEntry>,
  pub reviews: Vec<ManifestEntry>,
}

/// Exports a complete standalone Markdown package to the specified destination directory.
pub fn export_markdown_package(
  db: &Database,
  app_dir: &Path,
  destination_dir: &str,
) -> Result<MarkdownPackageManifest, String> {
  let dest_path = Path::new(destination_dir);
  if !dest_path.exists() {
    fs::create_dir_all(dest_path).map_err(|e| format!("Failed to create export directory: {e}"))?;
  }

  let notes_dir = dest_path.join("notes");
  let sources_dir = dest_path.join("sources");
  let assets_dir = dest_path.join("assets");
  let reviews_dir = dest_path.join("reviews");

  fs::create_dir_all(&notes_dir).map_err(|e| e.to_string())?;
  fs::create_dir_all(&sources_dir).map_err(|e| e.to_string())?;
  fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
  fs::create_dir_all(&reviews_dir).map_err(|e| e.to_string())?;

  let mut note_entries: Vec<ManifestEntry> = Vec::new();
  let mut source_entries: Vec<ManifestEntry> = Vec::new();
  let mut asset_entries: Vec<ManifestEntry> = Vec::new();
  let mut review_entries: Vec<ManifestEntry> = Vec::new();

  let notes = db.list_notes(false, None, None)?;

  // 1. Export Notes
  for note in &notes {
    let filename = format!("{}.md", note.id);
    let note_file_path = notes_dir.join(&filename);
    let rel_path = format!("notes/{filename}");

    let frontmatter = format!(
      "---\ntitle: {:?}\nid: {:?}\ntype: {:?}\ncreated_at: {:?}\nupdated_at: {:?}\nprovenance: {:?}\n---\n\n",
      note.title, note.id, note.note_type, note.created_at, note.updated_at, note.provenance
    );

    let content = format!("{frontmatter}# {}\n\n{}\n", note.title, note.body_markdown);
    fs::write(&note_file_path, content).map_err(|e| format!("Failed to write note file: {e}"))?;

    note_entries.push(ManifestEntry {
      id: note.id.clone(),
      path: rel_path,
      kind: "markdown".to_string(),
      provenance: Some(note.provenance.clone()),
    });
  }

  // 2. Export Sources & Document Annotations
  let documents = db.get_documents()?;
  for doc in &documents {
    let filename = format!("source_{}.md", doc.id);
    let source_file_path = sources_dir.join(&filename);
    let rel_path = format!("sources/{filename}");

    let annotations = db.get_annotations_for_document(&doc.id, false)?;

    let mut doc_content = format!(
      "---\nid: {:?}\ntitle: {:?}\nauthor: {:?}\nsha256_hash: {:?}\ndoi: {:?}\ncreated_at: {:?}\nprovenance: {:?}\n---\n\n# {}\n\n",
      doc.id, doc.title, doc.author, doc.sha256_hash, doc.doi, doc.created_at, doc.provenance, doc.title
    );

    if let Some(author) = &doc.author {
      doc_content.push_str(&format!("**Author:** {author}\n\n"));
    }
    doc_content.push_str(&format!("**SHA-256:** `{}`\n\n", doc.sha256_hash));
    doc_content.push_str("## Annotations\n\n");

    if annotations.is_empty() {
      doc_content.push_str("_No annotations recorded for this source._\n");
    } else {
      for ann in annotations {
        if !ann.quote.is_empty() {
          doc_content.push_str(&format!("> {}\n\n— Page {}\n\n", ann.quote, ann.page_index + 1));
        }
        if !ann.comment.is_empty() {
          doc_content.push_str(&format!("**Comment:** {}\n\n", ann.comment));
        }
      }
    }

    fs::write(&source_file_path, doc_content).map_err(|e| format!("Failed to write source file: {e}"))?;

    source_entries.push(ManifestEntry {
      id: doc.id.clone(),
      path: rel_path,
      kind: "markdown".to_string(),
      provenance: Some(doc.provenance.clone()),
    });
  }

  // 3. Export Assets (Area Captures)
  // Fetch assets across annotations
  for doc in &documents {
    let annotations = db.get_annotations_for_document(&doc.id, false)?;
    for ann in annotations {
      let assets = db.get_annotation_assets(&ann.id)?;
      for asset in assets {
        let src_file = app_dir.join(&asset.relative_path);
        if src_file.exists() {
          let asset_filename = format!("{}.png", asset.id);
          let target_path = assets_dir.join(&asset_filename);
          let rel_path = format!("assets/{asset_filename}");

          let _ = fs::copy(&src_file, &target_path);

          asset_entries.push(ManifestEntry {
            id: asset.id.clone(),
            path: rel_path,
            kind: "asset".to_string(),
            provenance: Some(asset.provenance.clone()),
          });
        }
      }
    }
  }

  // 4. Export Reviews
  let prompts = db.list_review_prompts(Some("adopted"))?;
  if !prompts.is_empty() {
    let reviews_file_path = reviews_dir.join("review_prompts.md");
    let rel_path = "reviews/review_prompts.md".to_string();

    let mut review_content = "# Review Prompts\n\n".to_string();
    for p in &prompts {
      review_content.push_str(&format!("### {}\n\n**Type:** {}\n\n**Answer:**\n{}\n\n---\n\n", p.question, p.prompt_type, p.answer));
    }
    fs::write(&reviews_file_path, review_content).map_err(|e| format!("Failed to write reviews file: {e}"))?;

    review_entries.push(ManifestEntry {
      id: "adopted_prompts".to_string(),
      path: rel_path,
      kind: "review".to_string(),
      provenance: Some("user_authored".to_string()),
    });
  }

  // 5. Build and serialize manifest.json
  let manifest = MarkdownPackageManifest {
    schema: MARKDOWN_PACKAGE_SCHEMA.to_string(),
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: current_utc_timestamp(),
    directories: vec![
      "notes".to_string(),
      "sources".to_string(),
      "assets".to_string(),
      "reviews".to_string(),
    ],
    notes: note_entries,
    sources: source_entries,
    assets: asset_entries,
    reviews: review_entries,
  };

  let manifest_path = dest_path.join("manifest.json");
  let manifest_json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
  fs::write(&manifest_path, format!("{manifest_json}\n"))
    .map_err(|e| format!("Failed to write package manifest: {e}"))?;

  // 6. Record export in database
  let total_items = (manifest.notes.len() + manifest.sources.len() + manifest.assets.len() + manifest.reviews.len()) as i64;
  record_export(
    db,
    "markdown",
    destination_dir,
    Some(&manifest_path.to_string_lossy()),
    "completed",
    None,
    total_items,
  )?;

  Ok(manifest)
}

fn current_utc_timestamp() -> String {
  let now = std::time::SystemTime::now();
  let datetime: ChronoFreeTs = now.into();
  datetime.to_rfc3339()
}

// Minimal RFC 3339 formatting without external chrono dependency
struct ChronoFreeTs {
  secs: u64,
}

impl From<std::time::SystemTime> for ChronoFreeTs {
  fn from(time: std::time::SystemTime) -> Self {
    let secs = time.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    Self { secs }
  }
}

impl ChronoFreeTs {
  fn to_rfc3339(&self) -> String {
    // Days since Jan 1 1970
    let mut days = self.secs / 86400;
    let rem_secs = self.secs % 86400;
    let hour = rem_secs / 3600;
    let min = (rem_secs % 3600) / 60;
    let sec = rem_secs % 60;

    let mut year = 1970;
    loop {
      let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
      let ydays = if is_leap { 366 } else { 365 };
      if days < ydays {
        break;
      }
      days -= ydays;
      year += 1;
    }

    let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let mdays = [
      31,
      if is_leap { 29 } else { 28 },
      31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];

    let mut month = 1;
    for &d in &mdays {
      if days < d {
        break;
      }
      days -= d;
      month += 1;
    }
    let day = days + 1;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}Z")
  }
}

pub fn record_export(
  db: &Database,
  export_kind: &str,
  destination_path: &str,
  manifest_path: Option<&str>,
  status: &str,
  error: Option<&str>,
  items_count: i64,
) -> Result<(), String> {
  let export_id = Uuid::new_v4().to_string();
  let now = current_utc_timestamp();

  let conn = db.conn.lock().map_err(|e| e.to_string())?;
  conn
    .execute(
      "INSERT INTO exports (id, export_kind, destination_path, manifest_path, status, error, items_count, created_at, updated_at, provenance)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'deterministic_transform')",
      params![
        export_id,
        export_kind,
        destination_path,
        manifest_path,
        status,
        error,
        items_count,
        now,
        now,
      ],
    )
    .map_err(|e| format!("Failed to record export in database: {e}"))?;

  Ok(())
}
