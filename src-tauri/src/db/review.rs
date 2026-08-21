use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::prompts::ReviewPrompt;
use super::provenance::validate_provenance;
use super::Database;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewEvent {
  pub id: String,
  pub prompt_id: String,
  pub reviewed_at: String,
  pub outcome: String,
  pub duration_ms: i64,
  pub user_response: String,
  pub provenance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewSchedule {
  pub prompt_id: String,
  pub desired_retention: f64,
  pub state: String,
  pub stability: f64,
  pub difficulty: f64,
  pub due_at: String,
  pub last_reviewed_at: Option<String>,
  pub last_outcome: Option<String>,
  pub fsrs_version: String,
  pub updated_at: String,
  pub provenance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DueReviewPrompt {
  pub prompt: ReviewPrompt,
  pub schedule: Option<ReviewSchedule>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewQueueStats {
  pub due_count: i64,
  pub adopted_count: i64,
  pub paused_count: i64,
}

fn validate_outcome(outcome: &str) -> Result<(), String> {
  match outcome {
    "again" | "hard" | "good" | "easy" => Ok(()),
    _ => Err(format!("Invalid review outcome '{outcome}'")),
  }
}

fn validate_schedule_state(state: &str) -> Result<(), String> {
  match state {
    "new" | "learning" | "review" | "relearning" => Ok(()),
    _ => Err(format!("Invalid review schedule state '{state}'")),
  }
}

fn map_prompt(row: &rusqlite::Row<'_>, offset: usize) -> rusqlite::Result<ReviewPrompt> {
  Ok(ReviewPrompt {
    id: row.get(offset)?,
    annotation_id: row.get(offset + 1)?,
    note_id: row.get(offset + 2)?,
    prompt_type: row.get(offset + 3)?,
    question: row.get(offset + 4)?,
    answer: row.get(offset + 5)?,
    status: row.get(offset + 6)?,
    adopted_at: row.get(offset + 7)?,
    cue: row.get(offset + 8)?,
    priority: row.get(offset + 9)?,
    paused_at: row.get(offset + 10)?,
    created_at: row.get(offset + 11)?,
    updated_at: row.get(offset + 12)?,
    provenance: row.get(offset + 13)?,
  })
}

fn map_schedule(row: &rusqlite::Row<'_>, offset: usize) -> rusqlite::Result<Option<ReviewSchedule>> {
  let prompt_id: Option<String> = row.get(offset)?;
  Ok(prompt_id.map(|prompt_id| ReviewSchedule {
    prompt_id,
    desired_retention: row.get(offset + 1).unwrap_or(0.9),
    state: row.get(offset + 2).unwrap_or_else(|_| "new".to_string()),
    stability: row.get(offset + 3).unwrap_or(0.0),
    difficulty: row.get(offset + 4).unwrap_or(0.0),
    due_at: row.get(offset + 5).unwrap_or_else(|_| "".to_string()),
    last_reviewed_at: row.get(offset + 6).ok().flatten(),
    last_outcome: row.get(offset + 7).ok().flatten(),
    fsrs_version: row.get(offset + 8).unwrap_or_else(|_| "".to_string()),
    updated_at: row.get(offset + 9).unwrap_or_else(|_| "".to_string()),
    provenance: row.get(offset + 10).unwrap_or_else(|_| "deterministic_transform".to_string()),
  }))
}

impl Database {
  pub fn get_due_review_prompts(&self, limit: i64) -> Result<Vec<DueReviewPrompt>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let limit = limit.clamp(1, 100);
    let mut stmt = conn
      .prepare(
        "SELECT
          p.id, p.annotation_id, p.note_id, p.prompt_type, p.question, p.answer,
          p.status, p.adopted_at, p.cue, p.priority, p.paused_at, p.created_at, p.updated_at, p.provenance,
          s.prompt_id, s.desired_retention, s.state, s.stability, s.difficulty, s.due_at,
          s.last_reviewed_at, s.last_outcome, s.fsrs_version, s.updated_at, s.provenance
        FROM review_prompts p
        LEFT JOIN review_schedule s ON s.prompt_id = p.id
        WHERE p.status = 'adopted'
          AND p.paused_at IS NULL
          AND (s.prompt_id IS NULL OR s.due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        ORDER BY COALESCE(s.due_at, p.adopted_at, p.created_at) ASC, p.priority DESC
        LIMIT ?1",
      )
      .map_err(|e| e.to_string())?;

    let rows = stmt
      .query_map(params![limit], |row| {
        Ok(DueReviewPrompt {
          prompt: map_prompt(row, 0)?,
          schedule: map_schedule(row, 14)?,
        })
      })
      .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
      out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
  }

  pub fn record_review_event(&self, event: &ReviewEvent, schedule: &ReviewSchedule) -> Result<ReviewSchedule, String> {
    if event.prompt_id != schedule.prompt_id {
      return Err("Review event and schedule must reference the same prompt".to_string());
    }
    validate_outcome(&event.outcome)?;
    if let Some(outcome) = &schedule.last_outcome {
      validate_outcome(outcome)?;
    }
    validate_schedule_state(&schedule.state)?;
    validate_provenance(&event.provenance)?;
    validate_provenance(&schedule.provenance)?;

    let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
      "INSERT INTO review_events (id, prompt_id, reviewed_at, outcome, duration_ms, user_response, provenance)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      params![
        event.id,
        event.prompt_id,
        event.reviewed_at,
        event.outcome,
        event.duration_ms,
        event.user_response,
        event.provenance,
      ],
    )
    .map_err(|e| format!("Failed to insert review event: {e}"))?;

    tx.execute(
      "INSERT INTO review_schedule (
        prompt_id, desired_retention, state, stability, difficulty, due_at,
        last_reviewed_at, last_outcome, fsrs_version, updated_at, provenance
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      ON CONFLICT(prompt_id) DO UPDATE SET
        desired_retention = excluded.desired_retention,
        state = excluded.state,
        stability = excluded.stability,
        difficulty = excluded.difficulty,
        due_at = excluded.due_at,
        last_reviewed_at = excluded.last_reviewed_at,
        last_outcome = excluded.last_outcome,
        fsrs_version = excluded.fsrs_version,
        updated_at = excluded.updated_at,
        provenance = excluded.provenance",
      params![
        schedule.prompt_id,
        schedule.desired_retention,
        schedule.state,
        schedule.stability,
        schedule.difficulty,
        schedule.due_at,
        schedule.last_reviewed_at,
        schedule.last_outcome,
        schedule.fsrs_version,
        schedule.updated_at,
        schedule.provenance,
      ],
    )
    .map_err(|e| format!("Failed to upsert review schedule: {e}"))?;

    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    self
      .get_review_schedule(&schedule.prompt_id)?
      .ok_or_else(|| "Saved review schedule not found".to_string())
  }

  pub fn get_review_schedule(&self, prompt_id: &str) -> Result<Option<ReviewSchedule>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    conn
      .query_row(
        "SELECT prompt_id, desired_retention, state, stability, difficulty, due_at,
                last_reviewed_at, last_outcome, fsrs_version, updated_at, provenance
         FROM review_schedule WHERE prompt_id = ?1",
        params![prompt_id],
        |row| {
          Ok(ReviewSchedule {
            prompt_id: row.get(0)?,
            desired_retention: row.get(1)?,
            state: row.get(2)?,
            stability: row.get(3)?,
            difficulty: row.get(4)?,
            due_at: row.get(5)?,
            last_reviewed_at: row.get(6)?,
            last_outcome: row.get(7)?,
            fsrs_version: row.get(8)?,
            updated_at: row.get(9)?,
            provenance: row.get(10)?,
          })
        },
      )
      .optional()
      .map_err(|e| e.to_string())
  }

  pub fn get_review_history(&self, prompt_id: &str) -> Result<Vec<ReviewEvent>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
      .prepare(
        "SELECT id, prompt_id, reviewed_at, outcome, duration_ms, user_response, provenance
         FROM review_events WHERE prompt_id = ?1 ORDER BY reviewed_at DESC",
      )
      .map_err(|e| e.to_string())?;
    let rows = stmt
      .query_map(params![prompt_id], |row| {
        Ok(ReviewEvent {
          id: row.get(0)?,
          prompt_id: row.get(1)?,
          reviewed_at: row.get(2)?,
          outcome: row.get(3)?,
          duration_ms: row.get(4)?,
          user_response: row.get(5)?,
          provenance: row.get(6)?,
        })
      })
      .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
  }

  pub fn get_review_queue_stats(&self) -> Result<ReviewQueueStats, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let adopted_count: i64 = conn
      .query_row("SELECT COUNT(*) FROM review_prompts WHERE status = 'adopted'", [], |row| row.get(0))
      .map_err(|e| e.to_string())?;
    let paused_count: i64 = conn
      .query_row("SELECT COUNT(*) FROM review_prompts WHERE status = 'adopted' AND paused_at IS NOT NULL", [], |row| row.get(0))
      .map_err(|e| e.to_string())?;
    let due_count: i64 = conn
      .query_row(
        "SELECT COUNT(*)
         FROM review_prompts p
         LEFT JOIN review_schedule s ON s.prompt_id = p.id
         WHERE p.status = 'adopted'
           AND p.paused_at IS NULL
           AND (s.prompt_id IS NULL OR s.due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
        [],
        |row| row.get(0),
      )
      .map_err(|e| e.to_string())?;
    Ok(ReviewQueueStats { due_count, adopted_count, paused_count })
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db::notes::Note;
  use crate::db::prompts::ReviewPrompt;
  use crate::db::Database;
  use tempfile::TempDir;

  fn test_db() -> (Database, TempDir) {
    let tmp = TempDir::new().unwrap();
    let db = Database::new(tmp.path()).unwrap();
    (db, tmp)
  }

  fn seed_prompt(db: &Database, id: &str, status: &str) {
    let note = Note {
      id: format!("note-{id}"),
      note_type: "concept".to_string(),
      title: "Concept".to_string(),
      body_markdown: "Body".to_string(),
      document_id: None,
      deleted_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
      original_provenance: None,
    };
    db.add_note(&note).unwrap();
    db.create_review_prompt(&ReviewPrompt {
      id: id.to_string(),
      annotation_id: None,
      note_id: Some(note.id),
      prompt_type: "focused_qa".to_string(),
      question: "What should be remembered?".to_string(),
      answer: "The concept.".to_string(),
      status: status.to_string(),
      adopted_at: Some("2026-08-21T00:00:00Z".to_string()),
      cue: "".to_string(),
      priority: 0,
      paused_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
    }).unwrap();
  }

  #[test]
  fn due_queue_includes_adopted_prompts_without_schedule() {
    let (db, _tmp) = test_db();
    seed_prompt(&db, "p1", "adopted");
    seed_prompt(&db, "p2", "draft");

    let due = db.get_due_review_prompts(20).unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].prompt.id, "p1");
    assert_eq!(due[0].schedule, None);
  }

  #[test]
  fn review_event_upserts_schedule_and_preserves_user_response() {
    let (db, _tmp) = test_db();
    seed_prompt(&db, "p1", "adopted");
    let event = ReviewEvent {
      id: "event-1".to_string(),
      prompt_id: "p1".to_string(),
      reviewed_at: "2026-08-21T12:00:00Z".to_string(),
      outcome: "good".to_string(),
      duration_ms: 5000,
      user_response: "Typed answer".to_string(),
      provenance: "user_authored".to_string(),
    };
    let schedule = ReviewSchedule {
      prompt_id: "p1".to_string(),
      desired_retention: 0.9,
      state: "review".to_string(),
      stability: 3.0,
      difficulty: 5.0,
      due_at: "2026-08-24T12:00:00Z".to_string(),
      last_reviewed_at: Some("2026-08-21T12:00:00Z".to_string()),
      last_outcome: Some("good".to_string()),
      fsrs_version: "FSRS-4.5-mereth-1".to_string(),
      updated_at: "2026-08-21T12:00:00Z".to_string(),
      provenance: "deterministic_transform".to_string(),
    };

    let saved = db.record_review_event(&event, &schedule).unwrap();
    assert_eq!(saved, schedule);
    let history = db.get_review_history("p1").unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].user_response, "Typed answer");
    assert_eq!(db.get_due_review_prompts(20).unwrap().len(), 0);
  }

  #[test]
  fn queue_stats_count_due_adopted_and_paused() {
    let (db, _tmp) = test_db();
    seed_prompt(&db, "p1", "adopted");

    let stats = db.get_review_queue_stats().unwrap();
    assert_eq!(stats.adopted_count, 1);
    assert_eq!(stats.due_count, 1);
    assert_eq!(stats.paused_count, 0);
  }
}
