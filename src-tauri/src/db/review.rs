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
    #[serde(default)]
    pub cloze_index: i64,
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
    #[serde(default)]
    pub cloze_index: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DueReviewPrompt {
    pub prompt: ReviewPrompt,
    pub schedule: Option<ReviewSchedule>,
    pub cloze_index: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DailyReviewUsage {
    pub completed_cards: i64,
    pub duration_ms: i64,
}

fn card_indices(prompt: &ReviewPrompt) -> Vec<i64> {
    let mut indices = std::collections::BTreeSet::new();
    if prompt.prompt_type == "cloze" {
        let mut rest = prompt.question.as_str();
        while let Some(start) = rest.find("{{c") {
            rest = &rest[start + 3..];
            let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
            if digits > 0 && rest[digits..].starts_with("::") {
                if let Some(end) = rest[digits + 2..].find("}}") {
                    if let Ok(index) = rest[..digits].parse::<i64>() {
                        indices.insert(index);
                    }
                    rest = &rest[digits + 2 + end + 2..];
                }
            }
        }
    }
    if indices.is_empty() {
        indices.insert(0);
    }
    indices.into_iter().collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewQueueStats {
    pub due_count: i64,
    pub adopted_count: i64,
    pub paused_count: i64,
}

/// U19: a review event joined with its prompt question for history display.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RecentReviewEvent {
    pub id: String,
    pub prompt_id: String,
    pub reviewed_at: String,
    pub outcome: String,
    pub duration_ms: i64,
    pub user_response: String,
    pub provenance: String,
    pub prompt_question: String,
    #[serde(default)]
    pub cloze_index: i64,
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

fn map_schedule(
    row: &rusqlite::Row<'_>,
    offset: usize,
) -> rusqlite::Result<Option<ReviewSchedule>> {
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
        provenance: row
            .get(offset + 10)
            .unwrap_or_else(|_| "deterministic_transform".to_string()),
        cloze_index: row.get(offset + 11).unwrap_or(0),
    }))
}

impl Database {
    pub fn get_due_review_prompts(&self, limit: i64) -> Result<Vec<DueReviewPrompt>, String> {
        self.due_review_cards(Some(limit.clamp(0, 999) as usize))
    }

    fn due_review_cards(&self, limit: Option<usize>) -> Result<Vec<DueReviewPrompt>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        if limit == Some(0) {
            return Ok(Vec::new());
        }
        let now: String = conn
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;
        let mut stmt = conn
      .prepare(
        "SELECT
          p.id, p.annotation_id, p.note_id, p.prompt_type, p.question, p.answer,
          p.status, p.adopted_at, p.cue, p.priority, p.paused_at, p.created_at, p.updated_at, p.provenance,
          s.prompt_id, s.desired_retention, s.state, s.stability, s.difficulty, s.due_at,
          s.last_reviewed_at, s.last_outcome, s.fsrs_version, s.updated_at, s.provenance, s.cloze_index
        FROM review_prompts p
        LEFT JOIN review_schedule s ON s.prompt_id = p.id
        WHERE p.status = 'adopted'
          AND p.paused_at IS NULL
        ORDER BY p.id",
      )
      .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(DueReviewPrompt {
                    prompt: map_prompt(row, 0)?,
                    schedule: map_schedule(row, 14)?,
                    cloze_index: 0,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut grouped: std::collections::BTreeMap<String, (ReviewPrompt, Vec<ReviewSchedule>)> =
            std::collections::BTreeMap::new();
        for row in rows {
            let row = row.map_err(|e| e.to_string())?;
            let entry = grouped
                .entry(row.prompt.id.clone())
                .or_insert((row.prompt, Vec::new()));
            if let Some(schedule) = row.schedule {
                entry.1.push(schedule);
            }
        }
        let mut out = Vec::new();
        for (_, (prompt, schedules)) in grouped {
            for index in card_indices(&prompt) {
                let schedule = schedules
                    .iter()
                    .find(|s| s.cloze_index == index)
                    .or_else(|| {
                        if prompt.prompt_type == "cloze" {
                            schedules.iter().find(|s| s.cloze_index == 0)
                        } else {
                            None
                        }
                    })
                    .cloned();
                if schedule.as_ref().is_some_and(|s| s.due_at > now) {
                    continue;
                }
                out.push(DueReviewPrompt {
                    prompt: prompt.clone(),
                    schedule,
                    cloze_index: index,
                });
            }
        }
        out.sort_by(|a, b| {
            let due = |r: &DueReviewPrompt| {
                r.schedule
                    .as_ref()
                    .map(|s| s.due_at.clone())
                    .unwrap_or_else(|| {
                        r.prompt
                            .adopted_at
                            .clone()
                            .unwrap_or(r.prompt.created_at.clone())
                    })
            };
            due(a)
                .cmp(&due(b))
                .then(b.prompt.priority.cmp(&a.prompt.priority))
                .then(a.prompt.id.cmp(&b.prompt.id))
                .then(a.cloze_index.cmp(&b.cloze_index))
        });
        if let Some(limit) = limit {
            out.truncate(limit);
        }
        Ok(out)
    }

    pub fn get_daily_review_usage(
        &self,
        start: &str,
        end: &str,
    ) -> Result<DailyReviewUsage, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let valid: bool = conn
            .query_row(
                "SELECT julianday(?1) IS NOT NULL AND julianday(?2) > julianday(?1)",
                params![start, end],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !valid {
            return Err("Invalid review usage interval".to_string());
        }
        conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(MAX(duration_ms, 0)), 0) FROM review_events WHERE julianday(reviewed_at) >= julianday(?1) AND julianday(reviewed_at) < julianday(?2)",
            params![start, end], |r| Ok(DailyReviewUsage { completed_cards: r.get(0)?, duration_ms: r.get(1)? }),
        ).map_err(|e| e.to_string())
    }

    pub fn record_review_event(
        &self,
        event: &ReviewEvent,
        schedule: &ReviewSchedule,
    ) -> Result<ReviewSchedule, String> {
        if event.prompt_id != schedule.prompt_id {
            return Err("Review event and schedule must reference the same prompt".to_string());
        }
        if event.cloze_index != schedule.cloze_index {
            return Err(
                "Review event and schedule must reference the same cloze_index".to_string(),
            );
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
      "INSERT INTO review_events (id, prompt_id, reviewed_at, outcome, duration_ms, user_response, provenance, cloze_index)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
      params![
        event.id,
        event.prompt_id,
        event.reviewed_at,
        event.outcome,
        event.duration_ms,
        event.user_response,
        event.provenance,
        event.cloze_index,
      ],
    )
    .map_err(|e| format!("Failed to insert review event: {e}"))?;

        tx.execute(
            "INSERT INTO review_schedule (
        prompt_id, cloze_index, desired_retention, state, stability, difficulty, due_at,
        last_reviewed_at, last_outcome, fsrs_version, updated_at, provenance
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
      ON CONFLICT(prompt_id, cloze_index) DO UPDATE SET
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
                schedule.cloze_index,
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
        self.get_review_schedule(&schedule.prompt_id, schedule.cloze_index)?
            .ok_or_else(|| "Saved review schedule not found".to_string())
    }

    pub fn undo_review_event(
        &self,
        event_id: &str,
        prompt_id: &str,
        cloze_index: i64,
        previous_schedule: Option<&ReviewSchedule>,
    ) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let event_row: Option<(String, i64)> = tx
            .query_row(
                "SELECT prompt_id, cloze_index FROM review_events WHERE id = ?1",
                params![event_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("Failed to find review event: {e}"))?;

        let (ev_prompt_id, ev_cloze_index) =
            event_row.ok_or_else(|| "Review event not found".to_string())?;
        if ev_prompt_id != prompt_id || ev_cloze_index != cloze_index {
            return Err("Review event does not match prompt_id and cloze_index".to_string());
        }

        // Verify it is the most recent event for this card
        let latest_id: Option<String> = tx
            .query_row(
                "SELECT id FROM review_events WHERE prompt_id = ?1 AND cloze_index = ?2 ORDER BY reviewed_at DESC, rowid DESC LIMIT 1",
                params![prompt_id, cloze_index],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to verify latest review event: {e}"))?;

        if latest_id.as_deref() != Some(event_id) {
            return Err(
                "Cannot undo review event: it is not the most recent event for this card"
                    .to_string(),
            );
        }

        tx.execute("DELETE FROM review_events WHERE id = ?1", params![event_id])
            .map_err(|e| format!("Failed to delete review event: {e}"))?;

        if let Some(schedule) = previous_schedule {
            if schedule.prompt_id != prompt_id || schedule.cloze_index != cloze_index {
                return Err(
                    "Previous schedule does not match prompt_id and cloze_index".to_string()
                );
            }
            tx.execute(
                "INSERT INTO review_schedule (
            prompt_id, cloze_index, desired_retention, state, stability, difficulty, due_at,
            last_reviewed_at, last_outcome, fsrs_version, updated_at, provenance
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
          ON CONFLICT(prompt_id, cloze_index) DO UPDATE SET
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
                    schedule.cloze_index,
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
            .map_err(|e| format!("Failed to restore review schedule: {e}"))?;
        } else {
            tx.execute(
                "DELETE FROM review_schedule WHERE prompt_id = ?1 AND cloze_index = ?2",
                params![prompt_id, cloze_index],
            )
            .map_err(|e| format!("Failed to clear review schedule: {e}"))?;
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_review_schedule(
        &self,
        prompt_id: &str,
        cloze_index: i64,
    ) -> Result<Option<ReviewSchedule>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT prompt_id, desired_retention, state, stability, difficulty, due_at,
                last_reviewed_at, last_outcome, fsrs_version, updated_at, provenance, cloze_index
         FROM review_schedule WHERE prompt_id = ?1 AND cloze_index = ?2",
            params![prompt_id, cloze_index],
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
                    cloze_index: row.get(11)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn get_default_review_schedule(
        &self,
        prompt_id: &str,
    ) -> Result<Option<ReviewSchedule>, String> {
        self.get_review_schedule(prompt_id, 0)
    }

    pub fn get_review_history(&self, prompt_id: &str) -> Result<Vec<ReviewEvent>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, prompt_id, reviewed_at, outcome, duration_ms, user_response, provenance, cloze_index
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
                    cloze_index: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// U19: recent review events across all prompts, newest first, with the
    /// prompt question joined in for display. Bounded so the history panel
    /// stays cheap regardless of total history size.
    pub fn get_recent_review_events(&self, limit: i64) -> Result<Vec<RecentReviewEvent>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let limit = limit.clamp(1, 200);
        let mut stmt = conn
        .prepare(
          "SELECT e.id, e.prompt_id, e.reviewed_at, e.outcome, e.duration_ms, e.user_response, e.provenance,
                  p.question, e.cloze_index
           FROM review_events e
           JOIN review_prompts p ON p.id = e.prompt_id
           ORDER BY e.reviewed_at DESC
           LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(RecentReviewEvent {
                    id: row.get(0)?,
                    prompt_id: row.get(1)?,
                    reviewed_at: row.get(2)?,
                    outcome: row.get(3)?,
                    duration_ms: row.get(4)?,
                    user_response: row.get(5)?,
                    provenance: row.get(6)?,
                    prompt_question: row.get(7)?,
                    cloze_index: row.get(8)?,
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
            .query_row(
                "SELECT COUNT(*) FROM review_prompts WHERE status = 'adopted'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let paused_count: i64 = conn
      .query_row("SELECT COUNT(*) FROM review_prompts WHERE status = 'adopted' AND paused_at IS NOT NULL", [], |row| row.get(0))
      .map_err(|e| e.to_string())?;
        drop(conn);
        let due_count = self.due_review_cards(None)?.len() as i64;
        Ok(ReviewQueueStats {
            due_count,
            adopted_count,
            paused_count,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::notes::Note;
    use crate::db::prompts::ReviewPrompt;
    use crate::db::Database;
    use rusqlite::params;
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
        })
        .unwrap();
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
            cloze_index: 0,
        };
        let schedule = ReviewSchedule {
            prompt_id: "p1".to_string(),
            cloze_index: 0,
            desired_retention: 0.9,
            state: "review".to_string(),
            stability: 3.0,
            difficulty: 5.0,
            // Keep this future-dated so the assertion remains deterministic as
            // calendar time advances.
            due_at: "2099-08-24T12:00:00Z".to_string(),
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

    #[test]
    fn cloze_due_rows_include_only_due_or_unscheduled_variants_once() {
        let (db, _tmp) = test_db();
        seed_prompt(&db, "cloze", "adopted");
        {
            let conn = db.conn.lock().unwrap();
            conn.execute("UPDATE review_prompts SET prompt_type = 'cloze', question = '{{c1::one}} {{c2::two}} {{c2::second}} {{c3::three}}' WHERE id = 'cloze'", []).unwrap();
            conn.execute("INSERT INTO review_schedule (prompt_id, cloze_index, desired_retention, state, stability, difficulty, due_at, fsrs_version, updated_at, provenance) VALUES ('cloze', 1, 0.9, 'review', 1, 5, '2099-01-01T00:00:00Z', 'test', '2026-01-01T00:00:00Z', 'deterministic_transform'), ('cloze', 2, 0.9, 'review', 1, 5, '2000-01-01T00:00:00Z', 'test', '2026-01-01T00:00:00Z', 'deterministic_transform')", []).unwrap();
        }
        let rows = db.get_due_review_prompts(999).unwrap();
        assert_eq!(
            rows.iter().map(|r| r.cloze_index).collect::<Vec<_>>(),
            vec![2, 3]
        );
        assert!(rows[0].schedule.is_some());
        assert!(rows[1].schedule.is_none());
        assert_eq!(db.get_due_review_prompts(1).unwrap().len(), 1);
        assert!(db.get_due_review_prompts(0).unwrap().is_empty());
        assert_eq!(db.get_review_queue_stats().unwrap().due_count, 2);
    }

    #[test]
    fn daily_usage_aggregates_more_than_history_cap_and_excludes_end_boundary() {
        let (db, _tmp) = test_db();
        seed_prompt(&db, "daily", "adopted");
        {
            let conn = db.conn.lock().unwrap();
            conn.execute("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x < 250) INSERT INTO review_events (id, prompt_id, reviewed_at, outcome, duration_ms, user_response, provenance, cloze_index) SELECT 'daily-' || x, 'daily', '2026-09-10T12:00:00Z', 'again', 1000, '', 'user_authored', 0 FROM n", []).unwrap();
            conn.execute("INSERT INTO review_events (id, prompt_id, reviewed_at, outcome, duration_ms, user_response, provenance, cloze_index) VALUES ('tomorrow', 'daily', '2026-09-11T00:00:00Z', 'good', 5000, '', 'user_authored', 0)", []).unwrap();
        }
        let usage = db
            .get_daily_review_usage("2026-09-10T00:00:00.000Z", "2026-09-11T00:00:00.000Z")
            .unwrap();
        assert_eq!(usage.completed_cards, 250);
        assert_eq!(usage.duration_ms, 250_000);
        assert!(db.get_daily_review_usage("bad", "bad").is_err());
    }

    #[test]
    fn recent_review_events_are_ordered_bounded_and_ignore_orphans() {
        let (db, _tmp) = test_db();
        seed_prompt(&db, "p1", "adopted");
        seed_prompt(&db, "p2", "adopted");

        {
            let conn = db.conn.lock().unwrap();
            for (id, prompt_id, reviewed_at) in [
                ("event-old", "p1", "2026-08-21T08:00:00Z"),
                ("event-new", "p2", "2026-08-21T10:00:00Z"),
                ("event-mid", "p1", "2026-08-21T09:00:00Z"),
            ] {
                conn.execute(
                    "INSERT INTO review_events (id, prompt_id, reviewed_at, outcome, duration_ms, user_response, provenance, cloze_index)
                     VALUES (?1, ?2, ?3, 'good', 1000, 'answer', 'user_authored', 0)",
                    params![id, prompt_id, reviewed_at],
                )
                .unwrap();
            }

            // Old or manually repaired profiles can contain an orphaned event
            // despite the current FK. The history UI must not surface it as an
            // event without a prompt question.
            conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
            conn.execute(
                "INSERT INTO review_events (id, prompt_id, reviewed_at, outcome, duration_ms, user_response, provenance, cloze_index)
                 VALUES ('event-orphan', 'missing-prompt', '2026-08-21T11:00:00Z', 'good', 1000, 'answer', 'user_authored', 0)",
                [],
            )
            .unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        }

        let newest_only = db.get_recent_review_events(1).unwrap();
        assert_eq!(newest_only.len(), 1);
        assert_eq!(newest_only[0].id, "event-new");
        assert_eq!(newest_only[0].prompt_id, "p2");
        assert_eq!(newest_only[0].prompt_question, "What should be remembered?");

        // Limits are clamped to avoid an empty/negative request or an
        // unbounded history query from IPC.
        assert_eq!(db.get_recent_review_events(0).unwrap().len(), 1);
        let all = db.get_recent_review_events(999).unwrap();
        assert_eq!(
            all.iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            ["event-new", "event-mid", "event-old"]
        );
        assert!(db
            .get_recent_review_events(50)
            .unwrap()
            .iter()
            .all(|event| event.prompt_id != "missing-prompt"));
    }

    #[test]
    fn undo_review_event_deletes_event_and_restores_or_clears_schedule() {
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
            cloze_index: 0,
        };
        let schedule = ReviewSchedule {
            prompt_id: "p1".to_string(),
            cloze_index: 0,
            desired_retention: 0.9,
            state: "review".to_string(),
            stability: 3.0,
            difficulty: 5.0,
            due_at: "2099-08-24T12:00:00Z".to_string(),
            last_reviewed_at: Some("2026-08-21T12:00:00Z".to_string()),
            last_outcome: Some("good".to_string()),
            fsrs_version: "FSRS-4.5-mereth-1".to_string(),
            updated_at: "2026-08-21T12:00:00Z".to_string(),
            provenance: "deterministic_transform".to_string(),
        };

        db.record_review_event(&event, &schedule).unwrap();
        assert_eq!(db.get_review_history("p1").unwrap().len(), 1);
        assert!(db.get_review_schedule("p1", 0).unwrap().is_some());

        // Undo review event restoring schedule to None (first review)
        db.undo_review_event("event-1", "p1", 0, None).unwrap();
        assert_eq!(db.get_review_history("p1").unwrap().len(), 0);
        assert_eq!(db.get_review_schedule("p1", 0).unwrap(), None);

        // Record again and then undo restoring previous schedule
        let previous_schedule = ReviewSchedule {
            prompt_id: "p1".to_string(),
            cloze_index: 0,
            desired_retention: 0.9,
            state: "learning".to_string(),
            stability: 1.0,
            difficulty: 6.0,
            due_at: "2026-08-21T00:00:00Z".to_string(),
            last_reviewed_at: Some("2026-08-20T12:00:00Z".to_string()),
            last_outcome: Some("again".to_string()),
            fsrs_version: "FSRS-4.5-mereth-1".to_string(),
            updated_at: "2026-08-20T12:00:00Z".to_string(),
            provenance: "deterministic_transform".to_string(),
        };

        let second_event = ReviewEvent {
            id: "event-2".to_string(),
            prompt_id: "p1".to_string(),
            reviewed_at: "2026-08-22T12:00:00Z".to_string(),
            outcome: "good".to_string(),
            duration_ms: 3000,
            user_response: "Second answer".to_string(),
            provenance: "user_authored".to_string(),
            cloze_index: 0,
        };

        db.record_review_event(&second_event, &schedule).unwrap();
        assert_eq!(db.get_review_history("p1").unwrap().len(), 1);

        // Undo restoring previous_schedule
        db.undo_review_event("event-2", "p1", 0, Some(&previous_schedule))
            .unwrap();
        assert_eq!(db.get_review_history("p1").unwrap().len(), 0);
        assert_eq!(
            db.get_review_schedule("p1", 0).unwrap(),
            Some(previous_schedule)
        );
    }

    #[test]
    fn cloze_variant_schedules_are_independent() {
        let (db, _tmp) = test_db();
        seed_prompt(&db, "p1", "adopted");

        let event1 = ReviewEvent {
            id: "event-c1".to_string(),
            prompt_id: "p1".to_string(),
            reviewed_at: "2026-08-21T12:00:00Z".to_string(),
            outcome: "good".to_string(),
            duration_ms: 5000,
            user_response: "Cloze 1 answer".to_string(),
            provenance: "user_authored".to_string(),
            cloze_index: 1,
        };
        let schedule1 = ReviewSchedule {
            prompt_id: "p1".to_string(),
            cloze_index: 1,
            desired_retention: 0.9,
            state: "review".to_string(),
            stability: 4.0,
            difficulty: 4.5,
            due_at: "2099-08-25T12:00:00Z".to_string(),
            last_reviewed_at: Some("2026-08-21T12:00:00Z".to_string()),
            last_outcome: Some("good".to_string()),
            fsrs_version: "FSRS-4.5-mereth-1".to_string(),
            updated_at: "2026-08-21T12:00:00Z".to_string(),
            provenance: "deterministic_transform".to_string(),
        };

        let event2 = ReviewEvent {
            id: "event-c2".to_string(),
            prompt_id: "p1".to_string(),
            reviewed_at: "2026-08-21T12:05:00Z".to_string(),
            outcome: "again".to_string(),
            duration_ms: 8000,
            user_response: "Cloze 2 answer".to_string(),
            provenance: "user_authored".to_string(),
            cloze_index: 2,
        };
        let schedule2 = ReviewSchedule {
            prompt_id: "p1".to_string(),
            cloze_index: 2,
            desired_retention: 0.9,
            state: "learning".to_string(),
            stability: 1.0,
            difficulty: 6.0,
            due_at: "2026-08-21T12:15:00Z".to_string(),
            last_reviewed_at: Some("2026-08-21T12:05:00Z".to_string()),
            last_outcome: Some("again".to_string()),
            fsrs_version: "FSRS-4.5-mereth-1".to_string(),
            updated_at: "2026-08-21T12:05:00Z".to_string(),
            provenance: "deterministic_transform".to_string(),
        };

        db.record_review_event(&event1, &schedule1).unwrap();
        db.record_review_event(&event2, &schedule2).unwrap();

        let s1 = db
            .get_review_schedule("p1", 1)
            .unwrap()
            .expect("Cloze 1 schedule missing");
        let s2 = db
            .get_review_schedule("p1", 2)
            .unwrap()
            .expect("Cloze 2 schedule missing");

        assert_eq!(s1.cloze_index, 1);
        assert_eq!(s1.state, "review");
        assert_eq!(s1.stability, 4.0);

        assert_eq!(s2.cloze_index, 2);
        assert_eq!(s2.state, "learning");
        assert_eq!(s2.stability, 1.0);

        // Verify independent undo
        db.undo_review_event("event-c2", "p1", 2, None).unwrap();
        assert_eq!(db.get_review_schedule("p1", 2).unwrap(), None);
        assert_eq!(db.get_review_schedule("p1", 1).unwrap(), Some(schedule1));
    }

    #[test]
    fn undo_review_event_verifies_latest_event() {
        let (db, _tmp) = test_db();
        seed_prompt(&db, "p1", "adopted");

        let event1 = ReviewEvent {
            id: "event-1".to_string(),
            prompt_id: "p1".to_string(),
            reviewed_at: "2026-08-21T10:00:00Z".to_string(),
            outcome: "good".to_string(),
            duration_ms: 5000,
            user_response: "Answer 1".to_string(),
            provenance: "user_authored".to_string(),
            cloze_index: 0,
        };
        let schedule1 = ReviewSchedule {
            prompt_id: "p1".to_string(),
            cloze_index: 0,
            desired_retention: 0.9,
            state: "review".to_string(),
            stability: 2.0,
            difficulty: 5.0,
            due_at: "2026-08-23T10:00:00Z".to_string(),
            last_reviewed_at: Some("2026-08-21T10:00:00Z".to_string()),
            last_outcome: Some("good".to_string()),
            fsrs_version: "FSRS-4.5-mereth-1".to_string(),
            updated_at: "2026-08-21T10:00:00Z".to_string(),
            provenance: "deterministic_transform".to_string(),
        };

        let event2 = ReviewEvent {
            id: "event-2".to_string(),
            prompt_id: "p1".to_string(),
            reviewed_at: "2026-08-22T10:00:00Z".to_string(),
            outcome: "easy".to_string(),
            duration_ms: 3000,
            user_response: "Answer 2".to_string(),
            provenance: "user_authored".to_string(),
            cloze_index: 0,
        };
        let schedule2 = ReviewSchedule {
            prompt_id: "p1".to_string(),
            cloze_index: 0,
            desired_retention: 0.9,
            state: "review".to_string(),
            stability: 5.0,
            difficulty: 4.0,
            due_at: "2099-08-30T10:00:00Z".to_string(),
            last_reviewed_at: Some("2026-08-22T10:00:00Z".to_string()),
            last_outcome: Some("easy".to_string()),
            fsrs_version: "FSRS-4.5-mereth-1".to_string(),
            updated_at: "2026-08-22T10:00:00Z".to_string(),
            provenance: "deterministic_transform".to_string(),
        };

        db.record_review_event(&event1, &schedule1).unwrap();
        db.record_review_event(&event2, &schedule2).unwrap();

        // Attempting to undo event1 when event2 is the latest should fail
        let err = db.undo_review_event("event-1", "p1", 0, None);
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("not the most recent event"));

        // Attempting to undo with wrong prompt_id or cloze_index should fail
        let err_prompt = db.undo_review_event("event-2", "wrong_p", 0, None);
        assert!(err_prompt.is_err());
        let err_cloze = db.undo_review_event("event-2", "p1", 99, None);
        assert!(err_cloze.is_err());

        // Undoing event2 succeeds
        db.undo_review_event("event-2", "p1", 0, Some(&schedule1))
            .unwrap();
        assert_eq!(db.get_review_schedule("p1", 0).unwrap(), Some(schedule1));

        // Now event1 is the latest, undoing it succeeds
        db.undo_review_event("event-1", "p1", 0, None).unwrap();
        assert_eq!(db.get_review_schedule("p1", 0).unwrap(), None);
    }

    #[test]
    fn cloze_due_cards_preserve_legacy_and_variant_schedules() {
        let (db, _dir) = test_db();
        let note = Note {
            id: "note-cloze".to_string(),
            note_type: "concept".to_string(),
            title: "Concept".to_string(),
            body_markdown: "Body".to_string(),
            document_id: None,
            deleted_at: None,
            created_at: "2026-08-01T00:00:00Z".to_string(),
            updated_at: "2026-08-01T00:00:00Z".to_string(),
            provenance: "user_authored".to_string(),
            original_provenance: None,
        };
        db.add_note(&note).unwrap();
        let prompt = ReviewPrompt {
            id: "cloze-p1".to_string(),
            annotation_id: None,
            note_id: Some(note.id),
            prompt_type: "cloze".to_string(),
            question: "The answer is {{c1::mereth}} and {{c2::reader}}.".to_string(),
            answer: "".to_string(),
            status: "adopted".to_string(),
            adopted_at: Some("2026-08-01T10:00:00Z".to_string()),
            cue: "".to_string(),
            priority: 0,
            paused_at: None,
            created_at: "2026-08-01T10:00:00Z".to_string(),
            updated_at: "2026-08-01T10:00:00Z".to_string(),
            provenance: "user_authored".to_string(),
        };
        db.create_review_prompt(&prompt).unwrap();

        // Legacy schedule with cloze_index = 0
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_schedule (
                prompt_id, cloze_index, desired_retention, state, stability, difficulty,
                due_at, last_reviewed_at, last_outcome, fsrs_version, updated_at, provenance
            ) VALUES ('cloze-p1', 0, 0.9, 'review', 4.2, 3.1, '2026-08-10T10:00:00Z', '2026-08-01T10:00:00Z', 'good', 'v1', '2026-08-01T10:00:00Z', 'user_authored')",
            [],
        ).unwrap();
        drop(conn);

        // due_review_cards should find the legacy schedule for both variants rather than restarting history
        let due = db.due_review_cards(None).unwrap();
        assert_eq!(due.len(), 2);
        for card in &due {
            assert!(
                card.schedule.is_some(),
                "Cloze variant should preserve schedule rather than returning None"
            );
            let sched = card.schedule.as_ref().unwrap();
            assert_eq!(sched.stability, 4.2);
            assert_eq!(sched.difficulty, 3.1);
        }

        // Now save a variant-specific schedule for cloze_index = 1
        let schedule_v1 = ReviewSchedule {
            prompt_id: "cloze-p1".to_string(),
            cloze_index: 1,
            desired_retention: 0.9,
            state: "review".to_string(),
            stability: 10.0,
            difficulty: 2.0,
            due_at: "2026-08-10T10:00:00Z".to_string(),
            last_reviewed_at: Some("2026-08-01T10:00:00Z".to_string()),
            last_outcome: Some("easy".to_string()),
            fsrs_version: "v1".to_string(),
            updated_at: "2026-08-01T10:00:00Z".to_string(),
            provenance: "user_authored".to_string(),
        };
        let event_v1 = ReviewEvent {
            id: "ev-c1".to_string(),
            prompt_id: "cloze-p1".to_string(),
            reviewed_at: "2026-08-01T10:00:00Z".to_string(),
            outcome: "easy".to_string(),
            duration_ms: 2000,
            user_response: "".to_string(),
            provenance: "user_authored".to_string(),
            cloze_index: 1,
        };
        db.record_review_event(&event_v1, &schedule_v1).unwrap();

        let due_after = db.due_review_cards(None).unwrap();
        let c1 = due_after.iter().find(|c| c.cloze_index == 1).unwrap();
        assert_eq!(c1.schedule.as_ref().unwrap().stability, 10.0);
        let c2 = due_after.iter().find(|c| c.cloze_index == 2).unwrap();
        assert_eq!(c2.schedule.as_ref().unwrap().stability, 4.2);
    }
}
