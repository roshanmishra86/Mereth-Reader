use std::process::Command;

/// Validates an external URL to ensure it uses strictly http or https schemes.
/// Rejects all other protocols (e.g. file://, javascript:, data:, cmd:, shell:),
/// local file references, and control/newline characters to prevent injection.
pub fn validate_external_url(raw_url: &str) -> Result<String, String> {
  let trimmed = raw_url.trim();
  if trimmed.is_empty() {
    return Err("External URL cannot be empty".into());
  }

  // Guard against newline or control character injection
  if trimmed.chars().any(|c| c.is_control() || c == '\n' || c == '\r') {
    return Err("External URL contains forbidden control characters".into());
  }

  let lower = trimmed.to_ascii_lowercase();
  if !lower.starts_with("http://") && !lower.starts_with("https://") {
    return Err("Blocked unsafe scheme: only http:// and https:// external URLs are permitted".into());
  }

  // Basic structure check: must have a host after scheme
  let prefix_len = if lower.starts_with("https://") { 8 } else { 7 };
  let rest = &trimmed[prefix_len..];
  if rest.is_empty() || rest.starts_with('/') || rest.starts_with(':') {
    return Err("External URL lacks a valid host component".into());
  }

  Ok(trimmed.to_string())
}

/// Spawns the OS default browser to open a validated external URL.
/// Never invokes arbitrary commands or shell scripts.
pub fn open_external_url(raw_url: &str) -> Result<(), String> {
  let safe_url = validate_external_url(raw_url)?;

  #[cfg(target_os = "windows")]
  {
    Command::new("rundll32")
      .args(["url.dll,FileProtocolHandler", &safe_url])
      .spawn()
      .map_err(|e| format!("Failed to open external browser: {e}"))?;
  }

  #[cfg(target_os = "linux")]
  {
    Command::new("xdg-open")
      .arg(&safe_url)
      .spawn()
      .map_err(|e| format!("Failed to open external browser: {e}"))?;
  }

  #[cfg(target_os = "macos")]
  {
    Command::new("open")
      .arg(&safe_url)
      .spawn()
      .map_err(|e| format!("Failed to open external browser: {e}"))?;
  }

  Ok(())
}

#[cfg(test)]
pub mod tests {
  use super::*;

  #[test]
  fn test_validate_external_url_accepts_valid_http_and_https() {
    assert_eq!(
      validate_external_url("https://mereth.org/docs").unwrap(),
      "https://mereth.org/docs"
    );
    assert_eq!(
      validate_external_url("http://example.com/path?query=1#hash").unwrap(),
      "http://example.com/path?query=1#hash"
    );
    assert_eq!(
      validate_external_url("   https://en.wikipedia.org/wiki/PDF   ").unwrap(),
      "https://en.wikipedia.org/wiki/PDF"
    );
  }

  #[test]
  fn test_validate_external_url_rejects_unsafe_schemes() {
    assert!(validate_external_url("file:///C:/Windows/System32/cmd.exe").is_err());
    assert!(validate_external_url("file:///etc/passwd").is_err());
    assert!(validate_external_url("javascript:alert(1)").is_err());
    assert!(validate_external_url("data:text/html,<script>alert(1)</script>").is_err());
    assert!(validate_external_url("blob:http://localhost/123").is_err());
    assert!(validate_external_url("about:blank").is_err());
    assert!(validate_external_url("cmd.exe /c calc").is_err());
    assert!(validate_external_url("powershell -c ls").is_err());
  }

  #[test]
  fn test_validate_external_url_rejects_empty_and_control_chars() {
    assert!(validate_external_url("").is_err());
    assert!(validate_external_url("   ").is_err());
    assert!(validate_external_url("https://example.com\nmalicious").is_err());
    assert!(validate_external_url("https://example.com\r\nmalicious").is_err());
    assert!(validate_external_url("https://example.com\0payload").is_err());
    assert!(validate_external_url("https://").is_err());
    assert!(validate_external_url("http:///").is_err());
  }
}
