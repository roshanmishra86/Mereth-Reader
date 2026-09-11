use super::notes::{validate_provenance, Note};
use super::Database;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NoteSourceAnchor {
    pub id: String,
    pub note_id: String,
    pub document_id: String,
    pub document_version_id: String,
    pub page_index: i64,
    pub page_label: String,
    #[serde(default)]
    pub selected_quote: Option<String>,
    #[serde(default)]
    pub rects_json: Option<String>,
    pub created_at: String,
    pub provenance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuickNoteTransactionResult {
    pub note: Note,
    pub source_anchor: NoteSourceAnchor,
}

impl Database {
    pub fn create_quick_note(
        &self,
        note: &Note,
        anchor: &NoteSourceAnchor,
    ) -> Result<QuickNoteTransactionResult, String> {
        if note.note_type != "scratch"
            || note.id != anchor.note_id
            || note.document_id.as_deref() != Some(anchor.document_id.as_str())
        {
            return Err("Invalid quick-note transaction payload".into());
        }
        validate_provenance(&note.provenance)?;
        validate_provenance(&anchor.provenance)?;
        if note.body_markdown.trim().is_empty() || anchor.page_index < 0 {
            return Err("Quick notes require content and a valid source page".into());
        }
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let page_count: i64 = tx
            .query_row(
                "SELECT page_count FROM document_versions WHERE id = ?1 AND document_id = ?2",
                params![anchor.document_version_id, anchor.document_id],
                |row| row.get(0),
            )
            .map_err(|_| {
                "Document version not found or does not belong to the document".to_string()
            })?;

        if anchor.page_index >= page_count {
            return Err("Page index exceeds document version page count".into());
        }

        tx.execute("INSERT INTO notes (id,note_type,title,body_markdown,document_id,deleted_at,created_at,updated_at,provenance,original_provenance) VALUES (?1,'scratch',?2,?3,?4,NULL,?5,?5,?6,NULL)", params![note.id,note.title,note.body_markdown,note.document_id,note.created_at,note.provenance]).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO note_revisions (id,note_id,revision_number,title,body_markdown,created_at,provenance,original_provenance) VALUES (?1,?2,1,?3,?4,?5,?6,NULL)", params![uuid::Uuid::new_v4().to_string(),note.id,note.title,note.body_markdown,note.created_at,note.provenance]).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO note_source_anchors (id,note_id,document_id,document_version_id,page_index,page_label,selected_quote,rects_json,created_at,provenance) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)", params![anchor.id,anchor.note_id,anchor.document_id,anchor.document_version_id,anchor.page_index,anchor.page_label,anchor.selected_quote,anchor.rects_json,anchor.created_at,anchor.provenance]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(QuickNoteTransactionResult {
            note: note.clone(),
            source_anchor: anchor.clone(),
        })
    }

    pub fn list_note_source_anchors(
        &self,
        document_id: &str,
    ) -> Result<Vec<NoteSourceAnchor>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT id,note_id,document_id,document_version_id,page_index,page_label,selected_quote,rects_json,created_at,provenance FROM note_source_anchors WHERE document_id=?1 ORDER BY created_at DESC").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![document_id], |r| {
                Ok(NoteSourceAnchor {
                    id: r.get(0)?,
                    note_id: r.get(1)?,
                    document_id: r.get(2)?,
                    document_version_id: r.get(3)?,
                    page_index: r.get(4)?,
                    page_label: r.get(5)?,
                    selected_quote: r.get(6)?,
                    rects_json: r.get(7)?,
                    created_at: r.get(8)?,
                    provenance: r.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
}
