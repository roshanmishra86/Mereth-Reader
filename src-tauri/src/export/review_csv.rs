//! Mereth Reader — RFC 4180 CSV / TSV Review Prompt Exporter (Task 4.10, FR-14.5)
//!
//! Generates compliant CSV / TSV files containing review cards, answers, cues, and scheduling parameters.

use crate::db::Database;
use crate::export::markdown::record_export;
use std::fs;
use std::path::Path;

/// Escapes a CSV / TSV field per RFC 4180 rules.
pub fn escape_csv_field(field: &str, delimiter: char) -> String {
  let needs_quoting = field.contains(delimiter)
    || field.contains('"')
    || field.contains('\n')
    || field.contains('\r');

  if needs_quoting {
    let escaped = field.replace('"', "\"\"");
    format!("\"{escaped}\"")
  } else {
    field.to_string()
  }
}

/// Exports review prompts to an RFC 4180 CSV or TSV file.
pub fn export_review_csv(
  db: &Database,
  destination_file: &str,
  delimiter: Option<&str>,
) -> Result<usize, String> {
  let delim_char = match delimiter {
    Some("\t") => '\t',
    Some(s) if s.starts_with('\t') => '\t',
    Some(",") => ',',
    _ => {
      if destination_file.ends_with(".tsv") {
        '\t'
      } else {
        ','
      }
    }
  };

  let rows_data = {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
      .prepare(
        "SELECT
          p.id, p.prompt_type, p.question, p.answer, p.cue, p.priority, p.status,
          COALESCE(s.desired_retention, 0.9),
          COALESCE(s.stability, 0.0),
          COALESCE(s.difficulty, 0.0),
          COALESCE(s.due_at, ''),
          COALESCE(s.last_reviewed_at, ''),
          COALESCE(s.last_outcome, ''),
          p.created_at,
          p.provenance
         FROM review_prompts p
         LEFT JOIN review_schedule s ON p.id = s.prompt_id
         ORDER BY p.created_at ASC",
      )
      .map_err(|e| e.to_string())?;

    let mapped = stmt
      .query_map([], |row| {
        let id: String = row.get(0)?;
        let prompt_type: String = row.get(1)?;
        let question: String = row.get(2)?;
        let answer: String = row.get(3)?;
        let cue: String = row.get(4)?;
        let priority: i64 = row.get(5)?;
        let status: String = row.get(6)?;
        let desired_retention: f64 = row.get(7)?;
        let stability: f64 = row.get(8)?;
        let difficulty: f64 = row.get(9)?;
        let due_at: String = row.get(10)?;
        let last_reviewed_at: String = row.get(11)?;
        let last_outcome: String = row.get(12)?;
        let created_at: String = row.get(13)?;
        let provenance: String = row.get(14)?;

        Ok(vec![
          id,
          prompt_type,
          question,
          answer,
          cue,
          priority.to_string(),
          status,
          desired_retention.to_string(),
          stability.to_string(),
          difficulty.to_string(),
          due_at,
          last_reviewed_at,
          last_outcome,
          created_at,
          provenance,
        ])
      })
      .map_err(|e| e.to_string())?;

    let mut collected = Vec::new();
    for r in mapped {
      collected.push(r.map_err(|e| e.to_string())?);
    }
    collected
  };

  let headers = [
    "id",
    "prompt_type",
    "question",
    "answer",
    "cue",
    "priority",
    "status",
    "desired_retention",
    "stability",
    "difficulty",
    "due_at",
    "last_reviewed_at",
    "last_outcome",
    "created_at",
    "provenance",
  ];

  let mut csv_output = headers
    .iter()
    .map(|h| escape_csv_field(h, delim_char))
    .collect::<Vec<String>>()
    .join(&delim_char.to_string());
  csv_output.push('\n');

  let count = rows_data.len();
  for fields in rows_data {
    let line = fields
      .iter()
      .map(|f| escape_csv_field(f, delim_char))
      .collect::<Vec<String>>()
      .join(&delim_char.to_string());
    csv_output.push_str(&line);
    csv_output.push('\n');
  }

  let dest_p = Path::new(destination_file);
  if let Some(parent) = dest_p.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }

  fs::write(dest_p, csv_output).map_err(|e| format!("Failed to write CSV export: {e}"))?;

  let export_kind = if delim_char == '\t' { "review_tsv" } else { "review_csv" };
  record_export(
    db,
    export_kind,
    destination_file,
    None,
    "completed",
    None,
    count as i64,
  )?;

  Ok(count)
}
