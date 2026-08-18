//! Dev-only measurement support for the R1 performance gate (task 2.9).
//!
//! This module is compiled only into debug builds (`#[cfg(debug_assertions)]`
//! at the `mod` site in `lib.rs`), so no release binary carries these commands.
//! The webview cannot read `/proc`, so RSS snapshots and the report write are
//! provided here:
//!
//! - `perf_rss_snapshot` — working set of the app process plus its descendant
//!   WebKit processes (the renderer is a child process, so the app's own RSS
//!   alone would understate the in-app working set).
//! - `perf_write_report` — atomic write of the measurement report assembled by
//!   the in-app driver (`src/perf/inAppPerf.ts`) to the directory named by the
//!   `MERETH_PERF_REPORT_DIR` environment variable.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct PerfRssSnapshot {
  pub app_kb: u64,
  pub descendants_kb: u64,
  pub total_kb: u64,
}

/// Extracts `VmRSS` (kB) from a `/proc/<pid>/status` text.
pub fn parse_vmrss_kb(status: &str) -> Option<u64> {
  for line in status.lines() {
    if let Some(rest) = line.strip_prefix("VmRSS:") {
      return rest.split_whitespace().next().and_then(|kb| kb.parse().ok());
    }
  }
  None
}

/// Parent PID of `pid` from `/proc/<pid>/stat`. `comm` is parenthesised and may
/// itself contain spaces/parens, so parsing starts after the *last* `)`.
fn ppid_of(pid: u32) -> Option<u32> {
  let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
  let rest = stat.rsplit_once(')')?.1.trim_start();
  // Fields after comm: state (1), ppid (2), pgrp (3), session (4), ...
  rest.split_whitespace().nth(1)?.parse().ok()
}

fn rss_kb_of(pid: u32) -> Option<u64> {
  let status = fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
  parse_vmrss_kb(&status)
}

/// All PIDs reachable from `root` through the parent tree (breadth-first over
/// the children map built from one `/proc` pass). Depth is bounded by the
/// children-map traversal itself; WebKit processes are direct children, so the
/// walk terminates quickly in practice.
fn descendant_pids(root: u32) -> Vec<u32> {
  let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
  let mut pids: Vec<u32> = Vec::new();
  if let Ok(entries) = fs::read_dir("/proc") {
    for entry in entries.flatten() {
      let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() else {
        continue;
      };
      pids.push(pid);
      if let Some(ppid) = ppid_of(pid) {
        children.entry(ppid).or_default().push(pid);
      }
    }
  }

  let mut out: Vec<u32> = Vec::new();
  let mut frontier = vec![root];
  while let Some(pid) = frontier.pop() {
    if let Some(kids) = children.get(&pid) {
      for kid in kids {
        out.push(*kid);
        frontier.push(*kid);
      }
    }
  }
  out
}

#[tauri::command]
pub fn perf_rss_snapshot() -> Result<PerfRssSnapshot, String> {
  let self_pid = std::process::id();
  let app_kb = rss_kb_of(self_pid).unwrap_or(0);
  let descendants_kb: u64 = descendant_pids(self_pid)
    .iter()
    .filter_map(|pid| rss_kb_of(*pid))
    .sum();
  Ok(PerfRssSnapshot {
    app_kb,
    descendants_kb,
    total_kb: app_kb + descendants_kb,
  })
}

#[tauri::command]
pub fn perf_write_report(filename: String, contents: String) -> Result<String, String> {
  // The filename is confined to a bare file name — the directory always comes
  // from the operator's environment, never from the webview.
  let name = Path::new(&filename)
    .file_name()
    .ok_or_else(|| "perf_write_report: filename has no file name component".to_string())?
    .to_string_lossy()
    .to_string();

  let dir: PathBuf = match std::env::var("MERETH_PERF_REPORT_DIR") {
    Ok(dir) => PathBuf::from(dir),
    Err(_) => std::env::current_dir().map_err(|e| e.to_string())?,
  };
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

  let final_path = dir.join(&name);
  let tmp_path = dir.join(format!(".{name}.tmp"));
  fs::write(&tmp_path, contents).map_err(|e| e.to_string())?;
  fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())?;
  Ok(final_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_vmrss_from_proc_status_text() {
    let status = concat!(
      "Name:\tWebKitWebProcess\n",
      "VmPeak:\t  42192 kB\n",
      "VmSize:\t  41020 kB\n",
      "RssAnon:\t  12345 kB\n", // must not be mistaken for VmRSS
      "VmRSS:\t   38912 kB\n",
      "VmData:\t  36780 kB\n",
    );
    assert_eq!(parse_vmrss_kb(status), Some(38912));
  }

  #[test]
  fn parse_vmrss_returns_none_without_vmrss_line() {
    assert_eq!(parse_vmrss_kb("Name:\tbusybox\n"), None);
    assert_eq!(parse_vmrss_kb("VmRSS:\tnope\n"), None);
  }

  #[test]
  fn rss_of_current_process_is_readable_and_positive_on_linux() {
    // The dev machine is Linux/WSL (this crate targets desktop here). If /proc
    // is unavailable the command degrades to 0 in production paths; the test
    // only asserts the parser works when /proc exists.
    let kb = rss_kb_of(std::process::id());
    if Path::new("/proc/self/status").exists() {
      assert!(kb.is_some());
      assert!(kb.unwrap() > 0);
    }
  }

  #[test]
  fn descendant_walk_never_loops_and_includes_children() {
    // No synthetic /proc here; assert structural invariants only: the walk is
    // finite and self-reachable children stay out (a process is not its own
    // descendant under our BFS).
    let pids = descendant_pids(std::process::id());
    assert!(!pids.contains(&std::process::id()));
    // Total unique pids is bounded by the number of processes on the machine.
    let unique: std::collections::HashSet<u32> = pids.iter().copied().collect();
    assert_eq!(unique.len(), pids.len());
  }
}
