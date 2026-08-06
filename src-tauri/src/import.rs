use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
  pub filepath: String,
  pub filename: String,
  pub sha256_hash: String,
  pub file_size_bytes: u64,
  pub exists: bool,
}

/// Computes SHA-256 hash and metadata for a file at `filepath`.
pub fn compute_file_metadata(filepath: &str) -> Result<FileMetadata, String> {
  let path = Path::new(filepath);
  if !path.exists() {
    return Ok(FileMetadata {
      filepath: filepath.to_string(),
      filename: path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
      sha256_hash: "".to_string(),
      file_size_bytes: 0,
      exists: false,
    });
  }

  let mut file = fs::File::open(path).map_err(|e| format!("Failed to open file: {e}"))?;
  let metadata = file.metadata().map_err(|e| format!("Failed to read metadata: {e}"))?;

  let mut hasher = Sha256::new();
  let mut buffer = [0u8; 65536];
  loop {
    let bytes_read = file.read(&mut buffer).map_err(|e| format!("Failed to read file: {e}"))?;
    if bytes_read == 0 {
      break;
    }
    hasher.update(&buffer[..bytes_read]);
  }
  let hash_result = hasher.finalize();
  let sha256_hash = hex::encode(hash_result);

  Ok(FileMetadata {
    filepath: filepath.to_string(),
    filename: path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
    sha256_hash,
    file_size_bytes: metadata.len(),
    exists: true,
  })
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
  }
}
