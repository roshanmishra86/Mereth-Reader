use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
  pub filepath: String,
  pub filename: String,
  pub sha256_hash: String,
  pub file_size_bytes: u64,
  pub page_count: u32,
  pub exists: bool,
}

/// Returns true if `b` is a PDF name-character (letter / digit / `_` / `.`),
/// used to reject `/PageLabels`, `/PageMode`, `/Pages` etc. when counting
/// `/Type /Page` declarations.
fn is_pdf_name_char(b: u8) -> bool {
  matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.')
}

/// Counts PDF page objects by scanning for `/Type /Page` declarations.
///
/// Each page object in a born-digital PDF carries `/Type /Page`; the trailing
/// boundary check excludes `/Type /Pages` (the page-tree root) and other
/// `/Page*` names. This is a heuristic — page objects live in the uncompressed
/// body for the v1 corpus, so it is reliable there; compressed object streams
/// could in principle hide them. Returns 1 when no page objects are detected so
/// callers always get a usable (non-zero) page count.
fn count_pdf_pages(bytes: &[u8]) -> u32 {
  const NEEDLE: &[u8] = b"/Type";
  let mut count = 0u32;
  let mut i = 0;
  while i + NEEDLE.len() <= bytes.len() {
    if &bytes[i..i + NEEDLE.len()] == NEEDLE {
      let mut j = i + NEEDLE.len();
      while j < bytes.len()
        && matches!(bytes[j], b' ' | b'\t' | b'\r' | b'\n')
      {
        j += 1;
      }
      if j + 5 <= bytes.len() && &bytes[j..j + 5] == b"/Page" {
        let next = bytes.get(j + 5).copied().unwrap_or(b' ');
        if !is_pdf_name_char(next) {
          count += 1;
        }
      }
      i = j + 5;
      continue;
    }
    i += 1;
  }
  if count == 0 { 1 } else { count }
}

/// Computes SHA-256 hash and metadata (including page count) for a file at `filepath`.
pub fn compute_file_metadata(filepath: &str) -> Result<FileMetadata, String> {
  let path = Path::new(filepath);
  if !path.exists() {
    return Ok(FileMetadata {
      filepath: filepath.to_string(),
      filename: path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
      sha256_hash: "".to_string(),
      file_size_bytes: 0,
      page_count: 1,
      exists: false,
    });
  }

  // Read the file once and reuse the bytes for both hashing and page counting.
  // Import is a user-initiated, one-time action on born-digital PDFs (the v1
  // reference corpus tops out at a 400-page book), so holding the bytes in
  // memory for the duration of the call is acceptable.
  let bytes = fs::read(path).map_err(|e| format!("Failed to read file: {e}"))?;

  let mut hasher = Sha256::new();
  hasher.update(&bytes);
  let sha256_hash = hex::encode(hasher.finalize());

  let page_count = count_pdf_pages(&bytes);

  Ok(FileMetadata {
    filepath: filepath.to_string(),
    filename: path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
    sha256_hash,
    file_size_bytes: bytes.len() as u64,
    page_count,
    exists: true,
  })
}

/// True for POSIX-absolute (`/...`) and Windows-drive-absolute (`C:\...` /
/// `C:/...`) paths. Used instead of `Path::is_absolute()` so the validation
/// logic is consistent on the Windows runtime and the Linux CI/test host.
fn path_looks_absolute(p: &Path) -> bool {
  let s = p.to_string_lossy();
  if s.starts_with('/') {
    return true;
  }
  let bytes = s.as_bytes();
  bytes.len() >= 3
    && bytes[0].is_ascii_alphabetic()
    && bytes[1] == b':'
    && (bytes[2] == b'\\' || bytes[2] == b'/')
}

/// Validates that a webview-supplied path is an absolute `.pdf` path. This is
/// the minimum confinement for any command that stores a filepath in the
/// document table (PRD §15.3: Rust commands never accept a caller-supplied path
/// without validation).
pub fn validate_pdf_filepath_basic(filepath: &str) -> Result<(), String> {
  let p = Path::new(filepath);
  if !path_looks_absolute(p) {
    return Err("File path must be absolute".to_string());
  }
  let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
  if !ext.eq_ignore_ascii_case("pdf") {
    return Err(format!(
      "Invalid file extension '.{}'. Only PDF files are supported.",
      ext
    ));
  }
  Ok(())
}

/// Validates an import source path and returns the canonical path to use.
///
/// Requires an absolute `.pdf` path. If the file exists, its canonical path
/// must NOT lie inside the application data directory (managed files are
/// Rust-owned and must not be re-imported through the webview). A non-existent
/// path is returned as-is so the caller can surface `exists: false` via the
/// metadata result rather than erroring here.
pub fn ensure_external_pdf_source(app_dir: &Path, filepath: &str) -> Result<String, String> {
  validate_pdf_filepath_basic(filepath)?;
  let p = Path::new(filepath);
  if !p.exists() {
    return Ok(filepath.to_string());
  }
  let canonical = fs::canonicalize(p).map_err(|e| format!("Path canonicalization failed: {}", e))?;
  let canonical_app = fs::canonicalize(app_dir).unwrap_or_else(|_| app_dir.to_path_buf());
  if canonical.starts_with(&canonical_app) {
    return Err("Source path must not point inside the application data directory".to_string());
  }
  Ok(canonical.to_string_lossy().to_string())
}

/// Validates and canonicalizes a filepath that will be stored on a document
/// record (relocate flow). Requires an absolute, existing `.pdf` path. Unlike
/// `ensure_external_pdf_source`, this permits paths inside the application data
/// directory (managed-library files are valid relocate targets).
pub fn validate_pdf_path_for_record(filepath: &str) -> Result<PathBuf, String> {
  validate_pdf_filepath_basic(filepath)?;
  let p = Path::new(filepath);
  if !p.exists() {
    return Err("File does not exist".to_string());
  }
  fs::canonicalize(p).map_err(|e| format!("Path canonicalization failed: {}", e))
}

/// Copies a source PDF file into the managed application documents directory (`app_data_dir/documents/`).
/// Preserves original filename. The original file is never moved or modified.
pub fn copy_to_managed_documents(app_dir: &Path, source_path: &str) -> Result<String, String> {
  let source = Path::new(source_path);
  if !source.exists() {
    return Err(format!("Source file does not exist: {source_path}"));
  }

  let docs_dir = app_dir.join("documents");
  fs::create_dir_all(&docs_dir).map_err(|e| format!("Failed to create documents dir: {e}"))?;

  let file_stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("document");
  let extension = source.extension().and_then(|e| e.to_str()).unwrap_or("pdf");

  let mut target_filename = format!("{file_stem}.{extension}");
  let mut target_path = docs_dir.join(&target_filename);

  // If a file with the same filename already exists in managed documents, append a counter
  let mut counter = 1;
  while target_path.exists() {
    target_filename = format!("{file_stem}_{counter}.{extension}");
    target_path = docs_dir.join(&target_filename);
    counter += 1;
  }

  fs::copy(source, &target_path).map_err(|e| format!("Failed to copy file to managed library: {e}"))?;

  let canonical = target_path
    .to_str()
    .ok_or_else(|| "Invalid target path encoding".to_string())?
    .to_string();

  Ok(canonical)
}

#[cfg(test)]
mod tests {
  use super::*;
  use tempfile::tempdir;
  use std::io::Write;

  #[test]
  fn test_compute_file_metadata_and_copy() {
    let dir = tempdir().unwrap();
    let src_file = dir.path().join("sample.pdf");
    {
      let mut f = fs::File::create(&src_file).unwrap();
      f.write_all(b"%PDF-1.4 sample content for test").unwrap();
    }

    let meta = compute_file_metadata(src_file.to_str().unwrap()).unwrap();
    assert!(meta.exists);
    assert_eq!(meta.filename, "sample.pdf");
    assert!(!meta.sha256_hash.is_empty());
    assert_eq!(meta.file_size_bytes, 32);

    let app_dir = dir.path().join("app_data");
    let managed_path = copy_to_managed_documents(&app_dir, src_file.to_str().unwrap()).unwrap();
    assert!(Path::new(&managed_path).exists());
    assert!(managed_path.contains("documents"));

    // Verify original was NOT modified or deleted
    assert!(src_file.exists());
  }

  #[test]
  fn test_missing_file_metadata() {
    let meta = compute_file_metadata("/nonexistent/file.pdf").unwrap();
    assert!(!meta.exists);
    assert_eq!(meta.sha256_hash, "");
    assert_eq!(meta.page_count, 1);
  }

  #[test]
  fn test_count_pdf_pages_detects_page_objects() {
    let pdf = b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n\
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj\n\
3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n\
4 0 obj << /Type /Page /Parent 2 0 R >> endobj\n\
5 0 obj << /Type /Page /Parent 2 0 R >> endobj\n";
    assert_eq!(count_pdf_pages(pdf), 3);
    // /PageLabels and /PageMode must not be counted as pages.
    let tricky = b"<< /Type /Catalog /PageLabels 5 0 R /PageMode /UseOutlines >>";
    assert_eq!(count_pdf_pages(tricky), 1);
  }

  #[test]
  fn test_validate_pdf_filepath_basic_rejects_relative_and_non_pdf() {
    assert!(validate_pdf_filepath_basic("relative/doc.pdf").is_err());
    assert!(validate_pdf_filepath_basic("/abs/doc.txt").is_err());
    assert!(validate_pdf_filepath_basic("/abs/doc.pdf").is_ok());
    assert!(validate_pdf_filepath_basic("C:\\abs\\doc.PDF").is_ok());
  }

  #[test]
  fn test_ensure_external_pdf_source_rejects_app_dir() {
    let dir = tempdir().unwrap();
    let app_dir = dir.path().join("app_data");
    fs::create_dir_all(app_dir.join("documents")).unwrap();
    let inside = app_dir.join("documents").join("managed.pdf");
    {
      fs::File::create(&inside).unwrap();
    }
    // A file inside the app data dir must be rejected.
    let inside_str = inside.to_string_lossy().to_string();
    assert!(ensure_external_pdf_source(&app_dir, &inside_str).is_err());

    // A file outside the app data dir is accepted.
    let outside = dir.path().join("external.pdf");
    {
      fs::File::create(&outside).unwrap();
    }
    let outside_str = outside.to_string_lossy().to_string();
    assert!(ensure_external_pdf_source(&app_dir, &outside_str).is_ok());
  }
}
