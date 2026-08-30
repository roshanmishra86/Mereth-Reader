use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::fs::OpenOptions;
use std::io;
use std::path::{Path, PathBuf};

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

fn extract_pages_count_from_count_keyword(bytes: &[u8]) -> u32 {
    const NEEDLE: &[u8] = b"/Count";
    let mut max_count = 0u32;
    let mut i = 0;
    while i + NEEDLE.len() <= bytes.len() {
        if &bytes[i..i + NEEDLE.len()] == NEEDLE {
            let mut j = i + NEEDLE.len();
            while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\r' | b'\n' | b'/') {
                j += 1;
            }
            let start_num = j;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            if j > start_num {
                if let Ok(val) = std::str::from_utf8(&bytes[start_num..j])
                    .unwrap_or("0")
                    .parse::<u32>()
                {
                    if val > max_count {
                        max_count = val;
                    }
                }
            }
            i = j;
            continue;
        }
        i += 1;
    }
    max_count
}

/// Counts PDF page objects by scanning for `/Type /Page` declarations and `/Count` attributes.
///
/// Handles both born-digital PDFs with uncompressed page objects and compressed
/// object stream PDFs where page objects live in `/ObjStm` streams but the root
/// `/Pages` dictionary exposes `/Count N`. Returns 1 when no page objects are
/// detected so callers always get a usable (non-zero) page count.
fn count_pdf_pages(bytes: &[u8]) -> u32 {
    const NEEDLE: &[u8] = b"/Type";
    let mut count = 0u32;
    let mut i = 0;
    while i + NEEDLE.len() <= bytes.len() {
        if &bytes[i..i + NEEDLE.len()] == NEEDLE {
            let mut j = i + NEEDLE.len();
            while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\r' | b'\n') {
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
    let count_attr = extract_pages_count_from_count_keyword(bytes);
    let final_count = count.max(count_attr);
    if final_count == 0 {
        1
    } else {
        final_count
    }
}

/// Computes SHA-256 hash and metadata (including page count) for a file at `filepath`.
pub fn compute_file_metadata(filepath: &str) -> Result<FileMetadata, String> {
    let path = Path::new(filepath);
    if !path.exists() {
        return Ok(FileMetadata {
            filepath: filepath.to_string(),
            filename: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string(),
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
        filename: path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string(),
        sha256_hash,
        file_size_bytes: bytes.len() as u64,
        page_count,
        exists: true,
    })
}

/// True for POSIX-absolute paths and supported Windows absolute path forms.
///
/// Windows `fs::canonicalize` returns an extended-length path (`\\?\C:\...`)
/// on many systems. It is still absolute and is the value returned by the
/// metadata command, so it must remain valid when that value is later stored.
/// This helper is deliberately platform-independent because Linux CI also
/// exercises Windows-originating values.
fn path_looks_absolute(p: &Path) -> bool {
    let s = p.to_string_lossy();
    if s.starts_with('/') {
        return true;
    }

    let is_windows_drive_absolute = |value: &str| {
        let bytes = value.as_bytes();
        bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/')
    };

    // Extended-length drive path, e.g. `\\?\C:\Users\reader\paper.pdf`.
    if let Some(extended) = s.strip_prefix(r"\\?\") {
        if is_windows_drive_absolute(extended) {
            return true;
        }

        // Extended-length UNC path, e.g.
        // `\\?\UNC\server\share\paper.pdf`.
        if let Some(unc) = extended.strip_prefix("UNC\\") {
            let mut parts = unc.split('\\').filter(|part| !part.is_empty());
            return parts.next().is_some() && parts.next().is_some();
        }
        return false;
    }

    // Standard UNC path, e.g. `\\server\share\paper.pdf`.
    if let Some(unc) = s.strip_prefix(r"\\") {
        let mut parts = unc.split('\\').filter(|part| !part.is_empty());
        return parts.next().is_some() && parts.next().is_some();
    }

    is_windows_drive_absolute(&s)
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
    let canonical =
        fs::canonicalize(p).map_err(|e| format!("Path canonicalization failed: {}", e))?;
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
    validate_pdf_filepath_basic(source_path)?;
    let source = fs::canonicalize(source_path)
        .map_err(|error| format!("Source file does not exist or cannot be resolved: {error}"))?;
    if !source.is_file() {
        return Err("Source path must be a regular PDF file".into());
    }

    let docs_dir = app_dir.join("documents");
    fs::create_dir_all(&docs_dir).map_err(|e| format!("Failed to create documents dir: {e}"))?;
    let canonical_docs_dir = fs::canonicalize(&docs_dir)
        .map_err(|error| format!("Failed to resolve documents dir: {error}"))?;
    if source.starts_with(&canonical_docs_dir) {
        return Err("Source path is already inside the managed documents directory".into());
    }

    let file_stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("document");
    let extension = source.extension().and_then(|e| e.to_str()).unwrap_or("pdf");

    // `create_new` guarantees a pre-existing file or symlink is never followed
    // or overwritten, including if another import races this one.
    let mut counter = 1;
    let target_path = loop {
        let filename = if counter == 1 {
            format!("{file_stem}.{extension}")
        } else {
            format!("{file_stem}_{}.{extension}", counter - 1)
        };
        let candidate = canonical_docs_dir.join(filename);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut target) => {
                let mut source_file = fs::File::open(&source)
                    .map_err(|error| format!("Failed to open source PDF: {error}"))?;
                if let Err(error) = io::copy(&mut source_file, &mut target) {
                    let _ = fs::remove_file(&candidate);
                    return Err(format!("Failed to copy file to managed library: {error}"));
                }
                break candidate;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => counter += 1,
            Err(error) => return Err(format!("Failed to create managed PDF copy: {error}")),
        }
    };

    let canonical = fs::canonicalize(&target_path)
        .map_err(|error| format!("Failed to resolve managed PDF copy: {error}"))?;
    if !canonical.starts_with(&canonical_docs_dir)
        || canonical.parent() != Some(canonical_docs_dir.as_path())
    {
        let _ = fs::remove_file(&target_path);
        return Err("Managed PDF copy escaped the documents directory".into());
    }

    let canonical_str = canonical
        .to_str()
        .ok_or_else(|| "Invalid target path encoding".to_string())?
        .to_string();

    Ok(canonical_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

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
        let canonical_managed_dir = fs::canonicalize(app_dir.join("documents")).unwrap();
        assert_eq!(
            Path::new(&managed_path).parent(),
            Some(canonical_managed_dir.as_path())
        );

        // Verify original was NOT modified or deleted
        assert!(src_file.exists());
    }

    #[test]
    fn test_managed_copy_rejects_non_pdf_and_managed_source() {
        let dir = tempdir().unwrap();
        let app_dir = dir.path().join("app_data");
        let plain_text = dir.path().join("not-a-pdf.txt");
        fs::write(&plain_text, b"not a PDF").unwrap();
        assert!(copy_to_managed_documents(&app_dir, plain_text.to_str().unwrap()).is_err());

        let managed_dir = app_dir.join("documents");
        fs::create_dir_all(&managed_dir).unwrap();
        let managed_source = managed_dir.join("already-managed.pdf");
        fs::write(&managed_source, b"%PDF-1.4").unwrap();
        assert!(copy_to_managed_documents(&app_dir, managed_source.to_str().unwrap()).is_err());
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
    fn test_count_pdf_pages_detects_count_attribute_for_compressed_streams() {
        // Simulated PDF 1.5+ compressed stream PDF where page objects are inside
        // object streams (/ObjStm), but the page tree root contains /Count 42.
        let compressed_pdf = b"%PDF-1.5\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n\
2 0 obj << /Type /Pages /Count 42 >> endobj\n";
        assert_eq!(count_pdf_pages(compressed_pdf), 42);
    }

    #[test]
    fn test_validate_pdf_filepath_basic_rejects_relative_and_non_pdf() {
        assert!(validate_pdf_filepath_basic("relative/doc.pdf").is_err());
        assert!(validate_pdf_filepath_basic("/abs/doc.txt").is_err());
        assert!(validate_pdf_filepath_basic("/abs/doc.pdf").is_ok());
        assert!(validate_pdf_filepath_basic("C:\\abs\\doc.PDF").is_ok());
        assert!(validate_pdf_filepath_basic(r"\\?\C:\abs\doc.pdf").is_ok());
        assert!(validate_pdf_filepath_basic(r"\\server\share\doc.pdf").is_ok());
        assert!(validate_pdf_filepath_basic(r"\\?\UNC\server\share\doc.pdf").is_ok());
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
