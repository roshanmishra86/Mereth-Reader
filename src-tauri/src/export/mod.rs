//! Mereth Reader — Export Subsystem (PRD R4, Tasks 4.8, 4.10, 4.12)
//!
//! Provides portable, non-destructive exports and backups:
//! - Standalone Markdown package export with manifest (FR-14.1, FR-14.2)
//! - Full versioned JSON backup and atomic restore (FR-14.4, Task 4.12)
//! - RFC 4180 CSV and TSV review prompt export (FR-14.5, Task 4.10)

pub mod backup;
pub mod markdown;
pub mod restore;
pub mod review_csv;

pub use backup::create_json_backup;
pub use markdown::export_markdown_package;
pub use restore::restore_from_backup;
pub use review_csv::export_review_csv;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExportRecord {
    pub id: String,
    pub export_kind: String,
    pub destination_path: String,
    #[serde(default)]
    pub manifest_path: Option<String>,
    pub status: String,
    #[serde(default)]
    pub error: Option<String>,
    pub items_count: i64,
    pub created_at: String,
    pub updated_at: String,
    pub provenance: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::annotations::Annotation;
    use crate::db::evidence::EvidenceBlock;
    use crate::db::notes::Note;
    use crate::db::prompts::ReviewPrompt;
    use crate::db::{Database, Document};
    use rusqlite::params;
    use tempfile::TempDir;

    fn test_db_with_data() -> (Database, TempDir, Document, Note, ReviewPrompt) {
        let tmp = TempDir::new().unwrap();
        let db = Database::new(tmp.path()).unwrap();

        let doc = Document {
            id: "doc-1".to_string(),
            title: "Test Document".to_string(),
            filepath: "/path/to/test.pdf".to_string(),
            sha256_hash: "a".repeat(64),
            page_count: 10,
            created_at: "2026-08-21T00:00:00Z".to_string(),
            updated_at: "2026-08-21T00:00:00Z".to_string(),
            provenance: "source_extracted".to_string(),
            author: Some("Author Name".to_string()),
            subject: None,
            keywords: None,
            creation_date: None,
            doi: Some("10.1234/test".to_string()),
            isbn: None,
            is_favourite: false,
            is_archived: false,
            last_opened_at: None,
            tags: vec!["research".to_string()],
            collections: vec![],
            ownership_mode: "open_in_place".into(),
            original_filepath: None,
            removed_at: None,
        };
        db.add_document(doc.clone()).unwrap();

        let version_id = "ver-1".to_string();
        {
            let conn = db.conn.lock().unwrap();
            conn
        .execute(
          "INSERT INTO document_versions (id, document_id, version_number, sha256_hash, page_count, created_at, provenance)
           VALUES (?1, ?2, 1, ?3, 10, '2026-08-21T00:00:00Z', 'source_extracted')",
          params![version_id, "doc-1", "a".repeat(64)],
        )
        .unwrap();
        }

        let ann = Annotation {
            id: "ann-1".to_string(),
            document_id: "doc-1".to_string(),
            document_version_id: version_id,
            checksum: "chk123".to_string(),
            annotation_type: "highlight".to_string(),
            page_index: 0,
            page_label: "1".to_string(),
            rects: vec![],
            quote: "Key discovery passage".to_string(),
            prefix_text: "".to_string(),
            suffix_text: "".to_string(),
            text_layer_checksum: None,
            comment: "Important point".to_string(),
            color: "yellow".to_string(),
            tags: vec!["finding".to_string()],
            deleted_at: None,
            created_at: "2026-08-21T00:00:00Z".to_string(),
            updated_at: "2026-08-21T00:00:00Z".to_string(),
            provenance: "user_authored".to_string(),
        };
        db.add_annotation(&ann).unwrap();

        let note = Note {
            id: "note-1".to_string(),
            note_type: "concept".to_string(),
            title: "Testing enhances memory".to_string(),
            body_markdown: "Retrieval practice produces durable memory.".to_string(),
            document_id: None,
            deleted_at: None,
            created_at: "2026-08-21T00:00:00Z".to_string(),
            updated_at: "2026-08-21T00:00:00Z".to_string(),
            provenance: "user_authored".to_string(),
            original_provenance: None,
        };
        db.add_note(&note).unwrap();

        let prompt = ReviewPrompt {
            id: "prompt-1".to_string(),
            annotation_id: Some("ann-1".to_string()),
            note_id: None,
            prompt_type: "focused_qa".to_string(),
            question: "Why is retrieval practice effective?".to_string(),
            answer: "It strengthens neural retrieval pathways.".to_string(),
            status: "adopted".to_string(),
            adopted_at: Some("2026-08-21T00:00:00Z".to_string()),
            cue: "Memory mechanism".to_string(),
            priority: 1,
            paused_at: None,
            created_at: "2026-08-21T00:00:00Z".to_string(),
            updated_at: "2026-08-21T00:00:00Z".to_string(),
            provenance: "user_authored".to_string(),
        };
        db.create_review_prompt(&prompt).unwrap();

        (db, tmp, doc, note, prompt)
    }

    #[test]
    fn test_export_markdown_package() {
        let (db, tmp, doc, note, _prompt) = test_db_with_data();
        db.add_evidence_block(&EvidenceBlock {
            id: "evidence-md-1".to_string(),
            note_id: note.id.clone(),
            source_kind: "quote".to_string(),
            annotation_id: None,
            image_asset_id: None,
            document_id: doc.id.clone(),
            page_index: 0,
            page_label: "1".to_string(),
            quote: "Evidence quote for export".to_string(),
            color: "yellow".to_string(),
            tags: vec![],
            user_comment: "Export test comment".to_string(),
            sort_order: 1,
            created_at: "2026-08-21T00:00:00Z".to_string(),
            provenance: "source_extracted".to_string(),
            original_provenance: None,
        })
        .unwrap();
        let export_dir = tmp.path().join("exported_markdown");

        let manifest =
            export_markdown_package(&db, tmp.path(), &export_dir.to_string_lossy()).unwrap();

        assert_eq!(manifest.schema, "mereth.markdown-package");
        assert_eq!(manifest.schema_version, 1);
        assert_eq!(manifest.notes.len(), 1);
        assert_eq!(manifest.sources.len(), 1);
        assert_eq!(manifest.reviews.len(), 1);

        assert!(export_dir.join("notes/note-1.md").exists());
        assert!(export_dir.join("sources/source_doc-1.md").exists());
        assert!(export_dir.join("reviews/review_prompts.md").exists());
        assert!(export_dir.join("manifest.json").exists());

        let note_content = std::fs::read_to_string(export_dir.join("notes/note-1.md")).unwrap();
        assert!(note_content.contains("title: \"Testing enhances memory\""));
        assert!(note_content.contains("Retrieval practice produces durable memory."));
        assert!(note_content.contains("## Attached Evidence"));
        assert!(note_content.contains("> Evidence quote for export"));
        assert!(note_content.contains("— Page 1 (Test Document)"));
        assert!(note_content.contains("**Comment:** Export test comment"));
    }

    #[test]
    fn test_create_json_backup_and_restore_roundtrip() {
        let (db, tmp, doc, note, prompt) = test_db_with_data();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
        "INSERT INTO note_source_anchors (id,note_id,document_id,document_version_id,page_index,page_label,selected_quote,rects_json,created_at,provenance)
         VALUES ('anchor-from-backup', ?1, ?2, 'ver-1', 2, '3', 'Quoted text', NULL, '2026-08-21T00:00:00Z', 'user_authored')",
        params![note.id, doc.id],
      ).unwrap();
        }
        db.add_evidence_block(&EvidenceBlock {
            id: "evidence-1".to_string(),
            note_id: note.id.clone(),
            source_kind: "quote".to_string(),
            annotation_id: Some("ann-1".to_string()),
            image_asset_id: None,
            document_id: doc.id.clone(),
            page_index: 0,
            page_label: "1".to_string(),
            quote: "Key discovery passage".to_string(),
            color: "yellow".to_string(),
            tags: vec!["finding".to_string()],
            user_comment: "My comment".to_string(),
            sort_order: 1,
            created_at: "2026-08-21T00:00:00Z".to_string(),
            provenance: "source_extracted".to_string(),
            original_provenance: None,
        })
        .unwrap();
        let backup_file = tmp.path().join("backup.json");

        let backup_archive =
            create_json_backup(&db, tmp.path(), Some(&backup_file.to_string_lossy())).unwrap();

        assert_eq!(backup_archive.schema, "mereth.json-backup");
        assert_eq!(backup_archive.schema_version, 1);
        assert_eq!(backup_archive.documents.len(), 1);
        assert_eq!(backup_archive.notes.len(), 1);
        assert_eq!(backup_archive.prompts.len(), 1);
        assert_eq!(backup_archive.evidence_blocks.len(), 1);
        assert!(backup_file.exists());

        let backup_json = std::fs::read_to_string(&backup_file).unwrap();

        // Now restore into a fresh clean database
        let clean_tmp = TempDir::new().unwrap();
        let clean_db = Database::new(clean_tmp.path()).unwrap();

        let restore_result =
            restore_from_backup(&clean_db, clean_tmp.path(), &backup_json).unwrap();
        assert!(restore_result.success);
        assert_eq!(restore_result.documents_count, 1);
        assert_eq!(restore_result.notes_count, 1);
        assert_eq!(restore_result.prompts_count, 1);

        let restored_doc = clean_db.get_document_by_id(&doc.id).unwrap().unwrap();
        assert_eq!(restored_doc.title, doc.title);

        let restored_note = clean_db.get_note(&note.id).unwrap().unwrap();
        assert_eq!(restored_note.title, note.title);

        let restored_prompt = clean_db.get_review_prompt(&prompt.id).unwrap().unwrap();
        assert_eq!(restored_prompt.question, prompt.question);
        let restored_evidence = clean_db.get_note_evidence_blocks(&note.id).unwrap();
        assert_eq!(restored_evidence.len(), 1);
        assert_eq!(restored_evidence[0].quote, "Key discovery passage");

        // A second restore must replace an anchor for the same note even when its
        // local ID differs from the ID stored in the backup.
        {
            let conn = clean_db.conn.lock().unwrap();
            conn.execute(
                "UPDATE note_source_anchors SET id = 'stale-local-anchor' WHERE note_id = ?1",
                params![note.id],
            )
            .unwrap();
        }
        restore_from_backup(&clean_db, clean_tmp.path(), &backup_json).unwrap();
        let restored_anchors = clean_db.list_note_source_anchors(&doc.id).unwrap();
        assert_eq!(restored_anchors.len(), 1);
        assert_eq!(restored_anchors[0].id, "anchor-from-backup");
    }

    #[test]
    fn test_export_review_csv_and_tsv() {
        let (db, tmp, _doc, _note, _prompt) = test_db_with_data();

        let csv_file = tmp.path().join("reviews.csv");
        let count_csv = export_review_csv(&db, &csv_file.to_string_lossy(), Some(",")).unwrap();
        assert_eq!(count_csv, 1);
        assert!(csv_file.exists());

        let csv_content = std::fs::read_to_string(&csv_file).unwrap();
        assert!(csv_content.starts_with("id,prompt_type,question,answer,cue,priority,status"));
        assert!(csv_content.contains("Why is retrieval practice effective?"));

        let tsv_file = tmp.path().join("reviews.tsv");
        let count_tsv = export_review_csv(&db, &tsv_file.to_string_lossy(), Some("\t")).unwrap();
        assert_eq!(count_tsv, 1);
        assert!(tsv_file.exists());

        let tsv_content = std::fs::read_to_string(&tsv_file).unwrap();
        assert!(tsv_content.starts_with("id\tprompt_type\tquestion\tanswer"));
    }

    #[test]
    fn test_restore_rolls_back_if_asset_write_fails() {
        let (db, tmp, doc, _note, _prompt) = test_db_with_data();
        let mut backup = create_json_backup(&db, tmp.path(), None).unwrap();

        // 1. Existing asset in destination that should be restored on rollback
        backup.assets.push(crate::db::annotations::AnnotationAsset {
            id: "asset-existing".to_string(),
            annotation_id: "ann-1".to_string(),
            document_id: doc.id.clone(),
            asset_kind: "area_capture".to_string(),
            relative_path: "annotations/existing.png".to_string(),
            content_type: "image/png".to_string(),
            width_px: 100,
            height_px: 100,
            caption: String::new(),
            created_at: "2026-08-21T00:00:00Z".to_string(),
            provenance: "user_authored".to_string(),
        });
        backup.asset_files.insert(
            "annotations/existing.png".to_string(),
            hex::encode(b"backup modified data"),
        );

        // 2. Newly created asset that should be deleted on rollback
        backup.assets.push(crate::db::annotations::AnnotationAsset {
            id: "asset-new".to_string(),
            annotation_id: "ann-1".to_string(),
            document_id: doc.id.clone(),
            asset_kind: "area_capture".to_string(),
            relative_path: "annotations/new_asset.png".to_string(),
            content_type: "image/png".to_string(),
            width_px: 100,
            height_px: 100,
            caption: String::new(),
            created_at: "2026-08-21T00:00:00Z".to_string(),
            provenance: "user_authored".to_string(),
        });
        backup.asset_files.insert(
            "annotations/new_asset.png".to_string(),
            hex::encode(b"new asset data"),
        );

        // 3. Asset that causes promotion to fail because assets/sub is a blocking file
        backup.assets.push(crate::db::annotations::AnnotationAsset {
            id: "asset-fail-test".to_string(),
            annotation_id: "ann-1".to_string(),
            document_id: doc.id.clone(),
            asset_kind: "area_capture".to_string(),
            relative_path: "annotations/sub/asset-fail.png".to_string(),
            content_type: "image/png".to_string(),
            width_px: 100,
            height_px: 100,
            caption: String::new(),
            created_at: "2026-08-21T00:00:00Z".to_string(),
            provenance: "user_authored".to_string(),
        });
        backup.asset_files.insert(
            "annotations/sub/asset-fail.png".to_string(),
            hex::encode(b"fake png"),
        );

        let backup_json = serde_json::to_string(&backup).unwrap();

        let clean_tmp = TempDir::new().unwrap();
        let clean_db = Database::new(clean_tmp.path()).unwrap();

        // Prepare destination files:
        std::fs::create_dir_all(clean_tmp.path().join("annotations")).unwrap();
        // Pre-existing live asset
        std::fs::write(
            clean_tmp.path().join("annotations/existing.png"),
            b"original live data",
        )
        .unwrap();
        // Create a regular file blocking the directory "annotations/sub"
        std::fs::write(clean_tmp.path().join("annotations/sub"), b"blocking file").unwrap();

        // Restore should fail when writing the asset file
        let res = restore_from_backup(&clean_db, clean_tmp.path(), &backup_json);
        assert!(
            res.is_err(),
            "Restore should fail when asset file writing fails"
        );
        assert!(res
            .unwrap_err()
            .contains("Failed to create live asset directory"));

        // The document should NOT exist because the transaction rolled back
        let restored_doc = clean_db.get_document_by_id(&doc.id).unwrap();
        assert!(
            restored_doc.is_none(),
            "Database should have rolled back on asset failure"
        );

        // The replaced live asset must be restored to its original contents from backup
        let existing_content =
            std::fs::read(clean_tmp.path().join("annotations/existing.png")).unwrap();
        assert_eq!(
            existing_content, b"original live data",
            "Existing live asset should be safely restored on rollback"
        );

        // The newly created asset must be removed on rollback
        assert!(
            !clean_tmp.path().join("annotations/new_asset.png").exists(),
            "Newly created live asset should be cleaned up on rollback"
        );

        // Neither staging nor backup directories should remain
        for entry in std::fs::read_dir(clean_tmp.path()).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().to_string();
            assert!(
                !name.starts_with(".restore_staging_"),
                "Staging directory left behind: {name}"
            );
            assert!(
                !name.starts_with(".restore_backup_"),
                "Backup directory left behind: {name}"
            );
        }
    }

    #[test]
    fn test_interrupted_restore_is_recovered_from_journal_before_commit() {
        let tmp = TempDir::new().unwrap();
        let db = Database::new(tmp.path()).unwrap();
        let backup_dir = tmp.path().join(".restore_backup_crash");
        let staging_dir = tmp.path().join(".restore_staging_crash");
        std::fs::create_dir_all(backup_dir.join("annotations")).unwrap();
        std::fs::create_dir_all(&staging_dir).unwrap();
        std::fs::create_dir_all(tmp.path().join("annotations")).unwrap();
        std::fs::write(backup_dir.join("annotations/existing.png"), b"before").unwrap();
        std::fs::write(
            tmp.path().join("annotations/existing.png"),
            b"partially promoted",
        )
        .unwrap();
        std::fs::write(tmp.path().join("annotations/new.png"), b"new").unwrap();
        let journal_path = tmp.path().join(".restore_journal_crash");
        std::fs::write(&journal_path, serde_json::json!({
      "staging_dir": staging_dir, "backup_dir": backup_dir,
      "replaced_assets": ["annotations/existing.png"], "created_assets": ["annotations/new.png"]
    }).to_string()).unwrap();

        crate::export::restore::recover_interrupted_restores(tmp.path(), &db).unwrap();
        assert_eq!(
            std::fs::read(tmp.path().join("annotations/existing.png")).unwrap(),
            b"before"
        );
        assert!(!tmp.path().join("annotations/new.png").exists());
        assert!(!journal_path.exists());
    }

    #[test]
    fn test_committed_restore_journal_only_cleans_up_after_crash() {
        let tmp = TempDir::new().unwrap();
        let db = Database::new(tmp.path()).unwrap();
        let backup_dir = tmp.path().join(".restore_backup_committed");
        let staging_dir = tmp.path().join(".restore_staging_committed");
        std::fs::create_dir_all(backup_dir.join("annotations")).unwrap();
        std::fs::create_dir_all(&staging_dir).unwrap();
        std::fs::create_dir_all(tmp.path().join("annotations")).unwrap();
        std::fs::write(backup_dir.join("annotations/existing.png"), b"old version").unwrap();
        std::fs::write(
            tmp.path().join("annotations/existing.png"),
            b"committed version",
        )
        .unwrap();
        let journal_path = tmp.path().join(".restore_journal_committed");
        std::fs::write(
            &journal_path,
            serde_json::json!({
              "staging_dir": staging_dir, "backup_dir": backup_dir,
              "replaced_assets": ["annotations/existing.png"], "created_assets": []
            })
            .to_string(),
        )
        .unwrap();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute("CREATE TABLE restore_commits (journal_path TEXT PRIMARY KEY, committed_at TEXT NOT NULL)", []).unwrap();
            conn.execute(
                "INSERT INTO restore_commits VALUES (?1, 'now')",
                [&journal_path.to_string_lossy()],
            )
            .unwrap();
        }

        crate::export::restore::recover_interrupted_restores(tmp.path(), &db).unwrap();
        assert!(!journal_path.exists());
        assert!(!tmp.path().join(".restore_backup_committed").exists());
        assert!(!tmp.path().join(".restore_staging_committed").exists());
        assert_eq!(
            std::fs::read(tmp.path().join("annotations/existing.png")).unwrap(),
            b"committed version"
        );
    }

    #[test]
    fn test_failed_interrupted_rollback_retains_recovery_artifacts() {
        let tmp = TempDir::new().unwrap();
        let db = Database::new(tmp.path()).unwrap();
        let backup_dir = tmp.path().join(".restore_backup_failed");
        let staging_dir = tmp.path().join(".restore_staging_failed");
        std::fs::create_dir_all(backup_dir.join("annotations")).unwrap();
        std::fs::create_dir_all(&staging_dir).unwrap();
        std::fs::write(
            backup_dir.join("annotations/missing.png"),
            b"only good copy",
        )
        .unwrap();
        std::fs::create_dir_all(tmp.path().join("annotations/missing.png")).unwrap();
        let journal_path = tmp.path().join(".restore_journal_failed");
        std::fs::write(
            &journal_path,
            serde_json::json!({
              "staging_dir": staging_dir, "backup_dir": backup_dir,
              "replaced_assets": ["annotations/missing.png"], "created_assets": []
            })
            .to_string(),
        )
        .unwrap();

        assert!(crate::export::restore::recover_interrupted_restores(tmp.path(), &db).is_err());
        assert!(journal_path.exists());
        assert!(tmp.path().join(".restore_backup_failed").exists());
        assert_eq!(
            std::fs::read(backup_dir.join("annotations/missing.png")).unwrap(),
            b"only good copy"
        );
    }

    #[test]
    fn test_interrupted_rollback_cleanup_does_not_require_deleted_backups() {
        let tmp = TempDir::new().unwrap();
        let db = Database::new(tmp.path()).unwrap();
        let journal = tmp.path().join(".restore_journal_rolled_back");
        std::fs::create_dir_all(tmp.path().join("annotations")).unwrap();
        std::fs::write(
            tmp.path().join("annotations/existing.png"),
            b"restored original",
        )
        .unwrap();
        std::fs::write(&journal, serde_json::json!({
      "staging_dir": tmp.path().join(".restore_staging_rolled_back"),
      "backup_dir": tmp.path().join(".restore_backup_rolled_back"),
      "replaced_assets": ["annotations/existing.png"], "created_assets": [], "phase": "rolled_back"
    }).to_string()).unwrap();
        crate::export::restore::recover_interrupted_restores(tmp.path(), &db).unwrap();
        assert!(!journal.exists());
        assert_eq!(
            std::fs::read(tmp.path().join("annotations/existing.png")).unwrap(),
            b"restored original"
        );
    }
}
