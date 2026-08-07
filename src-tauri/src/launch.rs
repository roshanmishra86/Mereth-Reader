use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct LaunchValidationResult {
  pub valid: bool,
  pub path: Option<String>,
  pub canonical_path: Option<String>,
  pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SingleInstanceRoute {
  pub is_single_instance: bool,
  pub target_document_path: Option<String>,
  pub focus_existing_window: bool,
}

pub fn normalize_and_validate_launch_path(input_path: &str) -> LaunchValidationResult {
  let trimmed = input_path.trim();
  if trimmed.is_empty() {
    return LaunchValidationResult {
      valid: false,
      path: None,
      canonical_path: None,
      error: Some("Input path is empty".into()),
    };
  }

  let path = Path::new(trimmed);

  // 1. Validate file extension (.pdf)
  let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
  if !extension.eq_ignore_ascii_case("pdf") {
    return LaunchValidationResult {
      valid: false,
      path: Some(trimmed.to_string()),
      canonical_path: None,
      error: Some(format!("Invalid file extension '.{}'. Only PDF files are supported.", extension)),
    };
  }

  // 2. Check file existence
  if !path.exists() {
    return LaunchValidationResult {
      valid: false,
      path: Some(trimmed.to_string()),
      canonical_path: None,
      error: Some("File does not exist on disk".into()),
    };
  }

  // 3. Canonicalize path
  let canonical = match fs::canonicalize(path) {
    Ok(c) => c.to_string_lossy().to_string(),
    Err(e) => {
      return LaunchValidationResult {
        valid: false,
        path: Some(trimmed.to_string()),
        canonical_path: None,
        error: Some(format!("Path canonicalization failed: {}", e)),
      }
    }
  };

  LaunchValidationResult {
    valid: true,
    path: Some(trimmed.to_string()),
    canonical_path: Some(canonical),
    error: None,
  }
}

pub fn route_launch_args(args: &[String]) -> SingleInstanceRoute {
  // OQ-18 single window rule: routing launch arguments to single instance window
  let pdf_arg = args
    .iter()
    .skip(1) // Skip executable name
    .find(|arg| arg.to_lowercase().ends_with(".pdf"));

  if let Some(path_str) = pdf_arg {
    let validation = normalize_and_validate_launch_path(path_str);
    if validation.valid {
      return SingleInstanceRoute {
        is_single_instance: true,
        target_document_path: validation.canonical_path,
        focus_existing_window: true,
      };
    }
  }

  SingleInstanceRoute {
    is_single_instance: true,
    target_document_path: None,
    focus_existing_window: false,
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use tempfile::NamedTempFile;

  #[test]
  fn test_empty_and_invalid_extension() {
    let empty_res = normalize_and_validate_launch_path("");
    assert!(!empty_res.valid);
    assert_eq!(empty_res.error.unwrap(), "Input path is empty");

    let txt_res = normalize_and_validate_launch_path("document.txt");
    assert!(!txt_res.valid);
    assert!(txt_res.error.unwrap().contains("Only PDF files are supported"));
  }

  #[test]
  fn test_non_existent_file() {
    let res = normalize_and_validate_launch_path("non_existent_file_12345.pdf");
    assert!(!res.valid);
    assert_eq!(res.error.unwrap(), "File does not exist on disk");
  }

  #[test]
  fn test_valid_pdf_canonicalization() {
    let temp_file = NamedTempFile::with_suffix(".pdf").unwrap();
    let file_path = temp_file.path().to_str().unwrap();

    let res = normalize_and_validate_launch_path(file_path);
    assert!(res.valid);
    assert!(res.canonical_path.is_some());
    assert!(res.error.is_none());
  }

  #[test]
  fn test_route_launch_args_single_instance() {
    let temp_file = NamedTempFile::with_suffix(".pdf").unwrap();
    let file_path = temp_file.path().to_str().unwrap().to_string();

    let args = vec!["mereth-reader".to_string(), file_path];
    let route = route_launch_args(&args);

    assert!(route.is_single_instance);
    assert!(route.target_document_path.is_some());
    assert!(route.focus_existing_window);
  }
}
