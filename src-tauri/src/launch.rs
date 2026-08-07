use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct DeepLinkRoute {
  pub url: String,
  pub kind: String, // "document" | "note" | "review"
  pub id: String,
  pub page: Option<u32>,
  pub annotation_id: Option<String>,
}

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
  pub deep_link: Option<DeepLinkRoute>,
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

/// Parses and validates deep links of the scheme `mereth://` (PRD §14.2 & OQ-1).
///
/// Supported formats:
/// - `mereth://document/{id}?page={page}&annotation={annotationId}`
/// - `mereth://note/{id}`
/// - `mereth://review/{id}`
pub fn parse_deep_link(url_str: &str) -> Result<DeepLinkRoute, String> {
  let trimmed = url_str.trim();
  if !trimmed.to_lowercase().starts_with("mereth://") {
    return Err("Invalid scheme: must start with mereth://".into());
  }

  let rest = &trimmed[9..];
  if rest.is_empty() {
    return Err("Empty deep link target".into());
  }

  let mut parts = rest.splitn(2, '?');
  let path_part = parts.next().unwrap_or("").trim_matches('/');
  let query_part = parts.next();

  let path_segments: Vec<&str> = path_part.split('/').filter(|s| !s.is_empty()).collect();
  if path_segments.is_empty() {
    return Err("Missing target resource in deep link".into());
  }

  let kind = path_segments[0].to_lowercase();
  if kind != "document" && kind != "note" && kind != "review" {
    return Err(format!("Unsupported deep link target kind: '{}'", kind));
  }

  if path_segments.len() < 2 {
    return Err(format!("Missing ID for deep link target '{}'", kind));
  }

  let id = path_segments[1].to_string();
  let mut page: Option<u32> = None;
  let mut annotation_id: Option<String> = None;

  if let Some(query) = query_part {
    for param in query.split('&') {
      let mut kv = param.splitn(2, '=');
      if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
        match k.to_lowercase().as_str() {
          "page" => {
            if let Ok(p) = v.parse::<u32>() {
              if p > 0 {
                page = Some(p);
              }
            }
          }
          "annotation" | "annotation_id" | "annotationid" => {
            if !v.is_empty() {
              annotation_id = Some(v.to_string());
            }
          }
          _ => {}
        }
      }
    }
  }

  Ok(DeepLinkRoute {
    url: trimmed.to_string(),
    kind,
    id,
    page,
    annotation_id,
  })
}

pub fn route_launch_args(args: &[String]) -> SingleInstanceRoute {
  // OQ-18 single window rule: routing launch arguments (file path or mereth:// deep link)
  // to single instance window.
  let relevant_args = args.iter().skip(1);

  for arg in relevant_args {
    let trimmed = arg.trim();
    if trimmed.to_lowercase().starts_with("mereth://") {
      if let Ok(deep_link) = parse_deep_link(trimmed) {
        return SingleInstanceRoute {
          is_single_instance: true,
          target_document_path: None,
          deep_link: Some(deep_link),
          focus_existing_window: true,
        };
      }
    } else if trimmed.to_lowercase().ends_with(".pdf") {
      let validation = normalize_and_validate_launch_path(trimmed);
      if validation.valid {
        return SingleInstanceRoute {
          is_single_instance: true,
          target_document_path: validation.canonical_path,
          deep_link: None,
          focus_existing_window: true,
        };
      }
    }
  }

  SingleInstanceRoute {
    is_single_instance: true,
    target_document_path: None,
    deep_link: None,
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
  fn test_route_launch_args_single_instance_pdf() {
    let temp_file = NamedTempFile::with_suffix(".pdf").unwrap();
    let file_path = temp_file.path().to_str().unwrap().to_string();

    let args = vec!["mereth-reader".to_string(), file_path];
    let route = route_launch_args(&args);

    assert!(route.is_single_instance);
    assert!(route.target_document_path.is_some());
    assert!(route.deep_link.is_none());
    assert!(route.focus_existing_window);
  }

  #[test]
  fn test_parse_deep_link_document() {
    let url = "mereth://document/doc-sample-1?page=5&annotation=recall";
    let res = parse_deep_link(url).unwrap();

    assert_eq!(res.url, url);
    assert_eq!(res.kind, "document");
    assert_eq!(res.id, "doc-sample-1");
    assert_eq!(res.page, Some(5));
    assert_eq!(res.annotation_id, Some("recall".to_string()));
  }

  #[test]
  fn test_parse_deep_link_note_and_review() {
    let note_res = parse_deep_link("mereth://note/note-101").unwrap();
    assert_eq!(note_res.kind, "note");
    assert_eq!(note_res.id, "note-101");
    assert!(note_res.page.is_none());

    let review_res = parse_deep_link("mereth://review/review-202").unwrap();
    assert_eq!(review_res.kind, "review");
    assert_eq!(review_res.id, "review-202");
    assert!(review_res.page.is_none());
  }

  #[test]
  fn test_parse_deep_link_errors() {
    assert!(parse_deep_link("https://example.com").is_err());
    assert!(parse_deep_link("mereth://").is_err());
    assert!(parse_deep_link("mereth://unknown/123").is_err());
    assert!(parse_deep_link("mereth://document").is_err());
  }

  #[test]
  fn test_route_launch_args_deep_link() {
    let args = vec![
      "mereth-reader".to_string(),
      "mereth://document/doc-sample-1?page=12".to_string(),
    ];
    let route = route_launch_args(&args);

    assert!(route.is_single_instance);
    assert!(route.target_document_path.is_none());
    assert!(route.focus_existing_window);

    let dl = route.deep_link.unwrap();
    assert_eq!(dl.kind, "document");
    assert_eq!(dl.id, "doc-sample-1");
    assert_eq!(dl.page, Some(12));
  }
}
