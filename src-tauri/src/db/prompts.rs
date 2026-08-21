use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::provenance::validate_provenance;
use super::Database;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewPrompt {
  pub id: String,
  pub annotation_id: Option<String>,
  pub note_id: Option<String>,
  pub prompt_type: String, // 'focused_qa' | 'explanation' | 'application' | 'contrast' | 'cloze'
  pub question: String,
  pub answer: String,
  pub status: String, // 'draft' | 'adopted' | 'retired'
  pub adopted_at: Option<String>,
  pub cue: String,
  pub priority: i64,
  pub paused_at: Option<String>,
  pub created_at: String,
  pub updated_at: String,
  pub provenance: String,
}

pub fn validate_prompt_type(prompt_type: &str) -> Result<(), String> {
  match prompt_type {
    "focused_qa" | "explanation" | "application" | "contrast" | "cloze" => Ok(()),
    _ => Err(format!(
      "Invalid prompt_type '{}'. Must be one of: focused_qa, explanation, application, contrast, cloze",
      prompt_type
    )),
  }
}

pub fn validate_prompt_status(status: &str) -> Result<(), String> {
  match status {
    "draft" | "adopted" | "retired" => Ok(()),
    _ => Err(format!(
      "Invalid status '{}'. Must be one of: draft, adopted, retired",
      status
    )),
  }
}

fn current_timestamp(conn: &rusqlite::Connection) -> rusqlite::Result<String> {
  conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |r| r.get(0))
}

impl Database {
  pub fn create_review_prompt(&self, prompt: &ReviewPrompt) -> Result<ReviewPrompt, String> {
    if prompt.id.trim().is_empty() {
      return Err("Prompt ID cannot be empty".to_string());
    }
    if prompt.question.trim().is_empty() {
      return Err("Prompt question cannot be empty".to_string());
    }
    if prompt.annotation_id.is_none() && prompt.note_id.is_none() {
      return Err("Prompt must link to at least one source annotation or note (FR-11.3)".to_string());
    }
    validate_prompt_type(&prompt.prompt_type)?;
    validate_prompt_status(&prompt.status)?;
    validate_provenance(&prompt.provenance)?;

    let conn = self.conn.lock().map_err(|e| e.to_string())?;

    conn
      .execute(
        "INSERT INTO review_prompts (
          id, annotation_id, note_id, prompt_type, question, answer,
          status, adopted_at, cue, priority, paused_at, created_at, updated_at, provenance
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
          prompt.id,
          prompt.annotation_id,
          prompt.note_id,
          prompt.prompt_type,
          prompt.question,
          prompt.answer,
          prompt.status,
          prompt.adopted_at,
          prompt.cue,
          prompt.priority,
          prompt.paused_at,
          prompt.created_at,
          prompt.updated_at,
          prompt.provenance
        ],
      )
      .map_err(|e| format!("Failed to insert review prompt: {}", e))?;

    Ok(prompt.clone())
  }

  pub fn get_review_prompt(&self, id: &str) -> Result<Option<ReviewPrompt>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
      .prepare(
        "SELECT id, annotation_id, note_id, prompt_type, question, answer,
                status, adopted_at, cue, priority, paused_at, created_at, updated_at, provenance
         FROM review_prompts WHERE id = ?1",
      )
      .map_err(|e| e.to_string())?;

    let res = stmt
      .query_row(params![id], |row| {
        Ok(ReviewPrompt {
          id: row.get(0)?,
          annotation_id: row.get(1)?,
          note_id: row.get(2)?,
          prompt_type: row.get(3)?,
          question: row.get(4)?,
          answer: row.get(5)?,
          status: row.get(6)?,
          adopted_at: row.get(7)?,
          cue: row.get(8)?,
          priority: row.get(9)?,
          paused_at: row.get(10)?,
          created_at: row.get(11)?,
          updated_at: row.get(12)?,
          provenance: row.get(13)?,
        })
      })
      .optional()
      .map_err(|e| e.to_string())?;

    Ok(res)
  }

  pub fn list_review_prompts(&self, status_filter: Option<&str>) -> Result<Vec<ReviewPrompt>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;

    let mapper = |row: &rusqlite::Row| {
      Ok(ReviewPrompt {
        id: row.get(0)?,
        annotation_id: row.get(1)?,
        note_id: row.get(2)?,
        prompt_type: row.get(3)?,
        question: row.get(4)?,
        answer: row.get(5)?,
        status: row.get(6)?,
        adopted_at: row.get(7)?,
        cue: row.get(8)?,
        priority: row.get(9)?,
        paused_at: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        provenance: row.get(13)?,
      })
    };

    let mut results = Vec::new();
    if let Some(sf) = status_filter {
      let mut stmt = conn
        .prepare(
          "SELECT id, annotation_id, note_id, prompt_type, question, answer,
                  status, adopted_at, cue, priority, paused_at, created_at, updated_at, provenance
           FROM review_prompts WHERE status = ?1 ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
      let rows = stmt.query_map(params![sf], mapper).map_err(|e| e.to_string())?;
      for r in rows {
        results.push(r.map_err(|e| e.to_string())?);
      }
    } else {
      let mut stmt = conn
        .prepare(
          "SELECT id, annotation_id, note_id, prompt_type, question, answer,
                  status, adopted_at, cue, priority, paused_at, created_at, updated_at, provenance
           FROM review_prompts ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
      let rows = stmt.query_map([], mapper).map_err(|e| e.to_string())?;
      for r in rows {
        results.push(r.map_err(|e| e.to_string())?);
      }
    }

    Ok(results)
  }

  pub fn list_prompts_for_source(
    &self,
    annotation_id: Option<&str>,
    note_id: Option<&str>,
  ) -> Result<Vec<ReviewPrompt>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
      .prepare(
        "SELECT id, annotation_id, note_id, prompt_type, question, answer,
                status, adopted_at, cue, priority, paused_at, created_at, updated_at, provenance
         FROM review_prompts
         WHERE (?1 IS NOT NULL AND annotation_id = ?1) OR (?2 IS NOT NULL AND note_id = ?2)
         ORDER BY created_at DESC",
      )
      .map_err(|e| e.to_string())?;

    let rows = stmt
      .query_map(params![annotation_id, note_id], |row| {
        Ok(ReviewPrompt {
          id: row.get(0)?,
          annotation_id: row.get(1)?,
          note_id: row.get(2)?,
          prompt_type: row.get(3)?,
          question: row.get(4)?,
          answer: row.get(5)?,
          status: row.get(6)?,
          adopted_at: row.get(7)?,
          cue: row.get(8)?,
          priority: row.get(9)?,
          paused_at: row.get(10)?,
          created_at: row.get(11)?,
          updated_at: row.get(12)?,
          provenance: row.get(13)?,
        })
      })
      .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for r in rows {
      results.push(r.map_err(|e| e.to_string())?);
    }
    Ok(results)
  }

  pub fn update_review_prompt(&self, prompt: &ReviewPrompt) -> Result<ReviewPrompt, String> {
    validate_prompt_type(&prompt.prompt_type)?;
    validate_prompt_status(&prompt.status)?;
    validate_provenance(&prompt.provenance)?;

    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp(&conn).map_err(|e| e.to_string())?;

    let rows_affected = conn
      .execute(
        "UPDATE review_prompts SET
          prompt_type = ?1,
          question = ?2,
          answer = ?3,
          status = ?4,
          adopted_at = ?5,
          cue = ?6,
          priority = ?7,
          paused_at = ?8,
          updated_at = ?9,
          provenance = ?10
         WHERE id = ?11",
        params![
          prompt.prompt_type,
          prompt.question,
          prompt.answer,
          prompt.status,
          prompt.adopted_at,
          prompt.cue,
          prompt.priority,
          prompt.paused_at,
          now,
          prompt.provenance,
          prompt.id
        ],
      )
      .map_err(|e| format!("Failed to update review prompt: {}", e))?;

    if rows_affected == 0 {
      return Err(format!("Review prompt '{}' not found", prompt.id));
    }

    drop(conn);
    self
      .get_review_prompt(&prompt.id)?
      .ok_or_else(|| "Updated prompt not found".to_string())
  }

  pub fn adopt_review_prompt(&self, id: &str) -> Result<ReviewPrompt, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp(&conn).map_err(|e| e.to_string())?;

    let rows_affected = conn
      .execute(
        "UPDATE review_prompts SET status = 'adopted', adopted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
      )
      .map_err(|e| format!("Failed to adopt review prompt: {}", e))?;

    if rows_affected == 0 {
      return Err(format!("Review prompt '{}' not found", id));
    }

    drop(conn);
    self
      .get_review_prompt(id)?
      .ok_or_else(|| "Adopted prompt not found".to_string())
  }

  pub fn retire_review_prompt(&self, id: &str) -> Result<ReviewPrompt, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp(&conn).map_err(|e| e.to_string())?;

    let rows_affected = conn
      .execute(
        "UPDATE review_prompts SET status = 'retired', updated_at = ?1 WHERE id = ?2",
        params![now, id],
      )
      .map_err(|e| format!("Failed to retire review prompt: {}", e))?;

    if rows_affected == 0 {
      return Err(format!("Review prompt '{}' not found", id));
    }

    drop(conn);
    self
      .get_review_prompt(id)?
      .ok_or_else(|| "Retired prompt not found".to_string())
  }

  pub fn delete_review_prompt(&self, id: &str) -> Result<(), String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    conn
      .execute("DELETE FROM review_prompts WHERE id = ?1", params![id])
      .map_err(|e| format!("Failed to delete review prompt: {}", e))?;
    Ok(())
  }
}

#[cfg(test)]
pub mod tests {
  use super::*;
  use crate::db::notes::Note;
  use crate::db::Database;
  use tempfile::TempDir;

  fn test_db() -> (Database, TempDir) {
    let tmp = TempDir::new().unwrap();
    let db = Database::new(tmp.path()).unwrap();
    (db, tmp)
  }

  #[test]
  fn test_review_prompt_lifecycle_and_adoption() {
    let (db, _tmp) = test_db();

    // 1. Create a dummy note to link against (FR-11.3)
    let note = Note {
      id: "note-p1".to_string(),
      note_type: "concept".to_string(),
      title: "Testing Effect Concept".to_string(),
      body_markdown: "Testing produces retrieval practice.".to_string(),
      document_id: None,
      deleted_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
      original_provenance: None,
    };
    db.add_note(&note).unwrap();

    // 2. Create a prompt in draft status (FR-11.5)
    let prompt = ReviewPrompt {
      id: "p-1".to_string(),
      annotation_id: None,
      note_id: Some("note-p1".to_string()),
      prompt_type: "focused_qa".to_string(),
      question: "What effect does testing have on delayed retention?".to_string(),
      answer: "It produces retrieval practice that strengthens retrieval paths.".to_string(),
      status: "draft".to_string(),
      adopted_at: None,
      cue: "Memory retrieval".to_string(),
      priority: 1,
      paused_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
    };

    let created = db.create_review_prompt(&prompt).unwrap();
    assert_eq!(created.status, "draft");
    assert_eq!(created.adopted_at, None);

    // 3. List prompts
    let all = db.list_review_prompts(None).unwrap();
    assert_eq!(all.len(), 1);

    let drafts = db.list_review_prompts(Some("draft")).unwrap();
    assert_eq!(drafts.len(), 1);

    let adopted = db.list_review_prompts(Some("adopted")).unwrap();
    assert_eq!(adopted.len(), 0);

    // 4. Adopt prompt explicitly (FR-11.5)
    let adopted_p = db.adopt_review_prompt("p-1").unwrap();
    assert_eq!(adopted_p.status, "adopted");
    assert!(adopted_p.adopted_at.is_some());

    // 5. Query for source
    let linked = db.list_prompts_for_source(None, Some("note-p1")).unwrap();
    assert_eq!(linked.len(), 1);
    assert_eq!(linked[0].id, "p-1");

    // 6. Delete
    db.delete_review_prompt("p-1").unwrap();
    assert_eq!(db.get_review_prompt("p-1").unwrap(), None);
  }

  #[test]
  fn test_review_prompt_validation_rejects_empty_source() {
    let (db, _tmp) = test_db();

    // Rejects prompt with neither annotation nor note ID (FR-11.3)
    let prompt = ReviewPrompt {
      id: "p-bad".to_string(),
      annotation_id: None,
      note_id: None,
      prompt_type: "focused_qa".to_string(),
      question: "Orphaned question?".to_string(),
      answer: "No source".to_string(),
      status: "draft".to_string(),
      adopted_at: None,
      cue: "".to_string(),
      priority: 0,
      paused_at: None,
      created_at: "2026-08-21T00:00:00Z".to_string(),
      updated_at: "2026-08-21T00:00:00Z".to_string(),
      provenance: "user_authored".to_string(),
    };

    let res = db.create_review_prompt(&prompt);
    assert!(res.is_err());
    assert!(res.unwrap_err().contains("Prompt must link to at least one source"));
  }
}
