use rusqlite::{Connection, Result};
use std::fs;
use std::path::Path;
use thiserror::Error;

use super::provenance::{
  ADOPTION_CONSISTENCY_CHECK, ORIGINAL_PROVENANCE_SET_CHECK, TEXT_BEARING_FEATURE_TABLES,
};

#[derive(Error, Debug)]
pub enum MigrationError {
  #[error("Database error: {0}")]
  Sqlite(#[from] rusqlite::Error),
  #[error("IO error during database backup: {0}")]
  Io(#[from] std::io::Error),
  #[error("Migration failed: {0}")]
  Custom(String),
}

/// The highest migration version this engine knows how to apply.
const LATEST_MIGRATION_VERSION: i32 = 12;

/// Runs forward-only migrations.
///
/// `db_dir` is the directory that contains (or will contain) `mereth_reader.db`.
/// Per the PRD §15.4 data layout this is `app-data/db/`; the caller is
/// responsible for creating it and for relocating a legacy database from
/// `app-data/mereth_reader.db` before opening (task 3.1).
///
/// `db_existed` must be true only when the database file already existed on
/// disk before the caller opened the connection. A backup of the pre-migration
/// file is taken **only** when a migration is actually about to run against an
/// existing database — never on a plain re-open and never for a brand-new
/// database. This fixes the previous behaviour where `mereth_reader.db.bak`
/// was overwritten on every open.
pub fn run_migrations(conn: &mut Connection, db_dir: &Path, db_existed: bool) -> Result<(), MigrationError> {
  // Step 1: Set WAL mode. `PRAGMA journal_mode = WAL` returns a row (the new
  // mode), so read it via query_row. execute/pragma_update/execute_batch all
  // reject the returned row with "Execute returned results". In-memory
  // databases report "memory" (WAL is unsupported there); file databases report
  // "wal". Either way the pragma is applied without error.
  let _journal_mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;

  // Enable foreign-key enforcement so the schema's ON DELETE CASCADE rules are
  // honored. SQLite leaves this OFF by default; without it the FK + CASCADE
  // declarations are inert. Must be set outside a transaction (done here, before
  // any migration transaction opens). Unlike journal_mode this pragma returns
  // no rows, so `execute` is safe here.
  conn.execute("PRAGMA foreign_keys = ON", [])?;

  // Ensure the database directory exists.
  fs::create_dir_all(db_dir)?;

  // Step 2: Initialize migration metadata table
  conn.execute(
    "CREATE TABLE IF NOT EXISTS migration_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL UNIQUE,
      applied_at TEXT NOT NULL,
      checksum TEXT NOT NULL
    );",
    [],
  )?;

  // Step 3: Determine the current applied version
  let current_version: i32 = conn
    .query_row(
      "SELECT COALESCE(MAX(version), 0) FROM migration_metadata",
      [],
      |row| row.get(0),
    )
    .unwrap_or(0);

  // Step 4: Apply pending migrations, backing up first only if needed
  if current_version < LATEST_MIGRATION_VERSION {
    // Back up the pre-migration file ONLY when migrating an existing database.
    if db_existed {
      let db_path = db_dir.join("mereth_reader.db");
      if db_path.exists() {
        let backup_path = db_dir.join("mereth_reader.db.bak");
        fs::copy(&db_path, &backup_path)?;
      }
    }

    if current_version < 1 {
      let tx = conn.transaction()?;

      tx.execute(
        "CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        filepath TEXT NOT NULL,
        sha256_hash TEXT NOT NULL,
        page_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        provenance TEXT NOT NULL CHECK(provenance IN (
          'source_extracted', 'source_ocr', 'user_authored',
          'ai_draft', 'user_adopted_ai', 'deterministic_transform'
        ))
      );",
        [],
      )?;

      tx.execute(
        "CREATE TABLE document_versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        sha256_hash TEXT NOT NULL,
        page_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        provenance TEXT NOT NULL CHECK(provenance IN (
          'source_extracted', 'source_ocr', 'user_authored',
          'ai_draft', 'user_adopted_ai', 'deterministic_transform'
        ))
      );",
        [],
      )?;

      tx.execute(
        "CREATE TABLE pages (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        text_content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        provenance TEXT NOT NULL CHECK(provenance IN (
          'source_extracted', 'source_ocr', 'user_authored',
          'ai_draft', 'user_adopted_ai', 'deterministic_transform'
        ))
      );",
        [],
      )?;

      tx.execute(
        "CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );",
        [],
      )?;

      tx.execute(
        "CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );",
        [],
      )?;

      // FTS5 index table for full-text search across document pages
      tx.execute(
        "CREATE VIRTUAL TABLE fts_document_text USING fts5(
        document_id UNINDEXED,
        page_number UNINDEXED,
        text_content,
        provenance UNINDEXED
      );",
        [],
      )?;

      // Record migration 1 completion
      tx.execute(
        "INSERT INTO migration_metadata (version, applied_at, checksum)
       VALUES (1, datetime('now'), 'migration_1_init_v1');",
        [],
      )?;

      tx.commit()?;
    }

    if current_version < 2 {
      let tx = conn.transaction()?;

      // Extend documents table with metadata fields, favourites, archive, tags, collections
      tx.execute("ALTER TABLE documents ADD COLUMN author TEXT;", [])?;
      tx.execute("ALTER TABLE documents ADD COLUMN subject TEXT;", [])?;
      tx.execute("ALTER TABLE documents ADD COLUMN keywords TEXT;", [])?;
      tx.execute("ALTER TABLE documents ADD COLUMN creation_date TEXT;", [])?;
      tx.execute("ALTER TABLE documents ADD COLUMN doi TEXT;", [])?;
      tx.execute("ALTER TABLE documents ADD COLUMN isbn TEXT;", [])?;
      tx.execute("ALTER TABLE documents ADD COLUMN is_favourite INTEGER NOT NULL DEFAULT 0;", [])?;
      tx.execute("ALTER TABLE documents ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;", [])?;
      tx.execute("ALTER TABLE documents ADD COLUMN last_opened_at TEXT;", [])?;
      tx.execute("ALTER TABLE documents ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';", [])?;
      tx.execute("ALTER TABLE documents ADD COLUMN collections TEXT NOT NULL DEFAULT '[]';", [])?;

      // Create collections manager table
      tx.execute(
        "CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TEXT NOT NULL
      );",
        [],
      )?;

      // Record migration 2 completion
      tx.execute(
        "INSERT INTO migration_metadata (version, applied_at, checksum)
       VALUES (2, datetime('now'), 'migration_2_metadata_collections');",
        [],
      )?;

      tx.commit()?;
    }

    if current_version < 3 {
      let tx = conn.transaction()?;

      // Create reading_sessions table for Task 2.6 session restore
      tx.execute(
        "CREATE TABLE IF NOT EXISTS reading_sessions (
          document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
          current_page INTEGER NOT NULL DEFAULT 1,
          zoom_mode TEXT NOT NULL DEFAULT 'fit-width',
          zoom_scale REAL NOT NULL DEFAULT 100.0,
          scroll_top_px REAL NOT NULL DEFAULT 0.0,
          left_pane_open INTEGER NOT NULL DEFAULT 1,
          left_pane_width_px REAL NOT NULL DEFAULT 260.0,
          right_pane_open INTEGER NOT NULL DEFAULT 0,
          right_pane_width_px REAL NOT NULL DEFAULT 300.0,
          view_mode TEXT NOT NULL DEFAULT 'single',
          rotation INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );",
        [],
      )?;

      // Record migration 3 completion
      tx.execute(
        "INSERT INTO migration_metadata (version, applied_at, checksum)
       VALUES (3, datetime('now'), 'migration_3_reading_sessions');",
        [],
      )?;

      tx.commit()?;
    }

    if current_version < 4 {
      let tx = conn.transaction()?;

      // Task 3.1 (PRD R2): annotation records and their area-capture assets.
      //
      // Design notes, each traceable to PRD §9:
      // - `annotation_type` maps FR-9.1 to the v1 set exactly:
      //   highlight / underline / area (image capture) / comment (anchored
      //   comment without a highlight) / bookmark. Freehand ink is deferred
      //   (OQ-10) and will be added by the migration of the feature that owns
      //   it, not by a speculative column today.
      // - `page_index` is the zero-based physical page and `page_label` the
      //   visible label (FR-9.4).
      // - `rects_json` holds one or more 0..1 normalized rectangles (FR-9.4,
      //   the geometry model proven in R0.4). Rust validates the JSON before
      //   write; the CHECK below only keeps non-text/area invariants honest.
      // - `quote` / `prefix_text` / `suffix_text` / `text_layer_checksum`
      //   are the FR-9.4 durable-anchor fields. The quote is read-only after
      //   creation: no update path touches it (FR-9.5).
      // - `comment` is the separate user comment field (FR-9.5).
      // - `color` is the semantic palette key; the palette's colour+label
      //   configuration ships with task 3.5 (FR-9.3).
      // - `tags` is a JSON array of tag strings (FR-9.6).
      // - `deleted_at` is the recoverable-trash marker (FR-9.8); rows are
      //   purged only by an explicit purge after trash.
      // - `provenance` carries the R0.3 constraint forward (task 3.2 extends
      //   its enforcement to every text-bearing record; embedded-annotation
      //   imports will use `deterministic_transform`, FR-9.9).
      tx.execute(
        "CREATE TABLE annotations (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
          annotation_type TEXT NOT NULL CHECK (annotation_type IN (
            'highlight', 'underline', 'area', 'comment', 'bookmark'
          )),
          page_index INTEGER NOT NULL CHECK (page_index >= 0),
          page_label TEXT NOT NULL DEFAULT '',
          rects_json TEXT NOT NULL DEFAULT '[]',
          quote TEXT NOT NULL DEFAULT '',
          prefix_text TEXT NOT NULL DEFAULT '',
          suffix_text TEXT NOT NULL DEFAULT '',
          text_layer_checksum TEXT,
          comment TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          provenance TEXT NOT NULL CHECK(provenance IN (
            'source_extracted', 'source_ocr', 'user_authored',
            'ai_draft', 'user_adopted_ai', 'deterministic_transform'
          )),
          CHECK (
            (annotation_type IN ('highlight','underline') AND (length(quote) > 0 OR provenance = 'deterministic_transform'))
            OR (annotation_type NOT IN ('highlight','underline') AND length(quote) = 0)
          ),
          CHECK (annotation_type <> 'area' OR length(rects_json) > 2)
        );",
        [],
      )?;

      // Lookups that task 3.7's filter/search paths and the reader sidebar use.
      tx.execute("CREATE INDEX idx_annotations_document ON annotations(document_id);", [])?;
      tx.execute("CREATE INDEX idx_annotations_version ON annotations(document_version_id);", [])?;
      tx.execute("CREATE INDEX idx_annotations_type ON annotations(annotation_type);", [])?;
      tx.execute("CREATE INDEX idx_annotations_trash ON annotations(deleted_at);", [])?;

      // FR-9.7: area captures are assets plus provenance — document, page, and
      // normalized rectangle live on the parent annotation, never an orphaned
      // bitmap. Files live under app-data/annotations/ (§15.4); `relative_path`
      // is relative to the app data root, validated by Rust on every insert
      // (`validator::validate_asset_relative_path`).
      tx.execute(
        "CREATE TABLE annotation_assets (
          id TEXT PRIMARY KEY,
          annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
          document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          asset_kind TEXT NOT NULL CHECK (asset_kind IN ('area_capture')),
          relative_path TEXT NOT NULL,
          content_type TEXT NOT NULL DEFAULT 'image/png',
          width_px INTEGER NOT NULL CHECK (width_px > 0),
          height_px INTEGER NOT NULL CHECK (height_px > 0),
          caption TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          provenance TEXT NOT NULL CHECK(provenance IN (
            'source_extracted', 'source_ocr', 'user_authored',
            'ai_draft', 'user_adopted_ai', 'deterministic_transform'
          ))
        );",
        [],
      )?;

      tx.execute(
        "CREATE INDEX idx_annotation_assets_annotation ON annotation_assets(annotation_id);",
        [],
      )?;

      // Record migration 4 completion
      tx.execute(
        "INSERT INTO migration_metadata (version, applied_at, checksum)
       VALUES (4, datetime('now'), 'migration_4_annotations_assets');",
        [],
      )?;

      tx.commit()?;
    }

    if current_version < 5 {
      let tx = conn.transaction()?;

      // Task 3.1 (PRD R3): notes, bounded revision history, and stable links.
      // - `note_type` is the FR-10.1 trio: source / concept / scratch. A
      //   scratch note's promotion lifecycle lands with task 4.1.
      // - `document_id` is set for source notes (one document) and null for
      //   concept/scratch notes (FR-10.1). Deleting a document from the
      //   library removes its source notes with it.
      // - `body_markdown` stores FR-10.10 Markdown semantics; titles stay
      //   non-blocking guidance per FR-10.4 (no uniqueness/length hard rule).
      // - `deleted_at` mirrors the annotation trash pattern; task 4.1
      //   supplies the promotion/archive/discard UI.
      // - `note_revisions` is the bounded autosave history (FR-10.8); the
      //   bound itself is enforced at write time by task 4.1.
      // - `note_links` models FR-10.5 with FK-typed targets: a link points at
      //   exactly one note, document, or annotation. Stable UUID ids make
      //   renames safe; backlinks are derived by query, not stored.
      tx.execute(
        "CREATE TABLE notes (
          id TEXT PRIMARY KEY,
          note_type TEXT NOT NULL CHECK (note_type IN ('source','concept','scratch')),
          title TEXT NOT NULL DEFAULT '',
          body_markdown TEXT NOT NULL DEFAULT '',
          document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          provenance TEXT NOT NULL CHECK(provenance IN (
            'source_extracted', 'source_ocr', 'user_authored',
            'ai_draft', 'user_adopted_ai', 'deterministic_transform'
          ))
        );",
        [],
      )?;

      tx.execute("CREATE INDEX idx_notes_document ON notes(document_id);", [])?;
      tx.execute("CREATE INDEX idx_notes_type ON notes(note_type);", [])?;

      tx.execute(
        "CREATE TABLE note_revisions (
          id TEXT PRIMARY KEY,
          note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          revision_number INTEGER NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          body_markdown TEXT NOT NULL,
          created_at TEXT NOT NULL,
          provenance TEXT NOT NULL CHECK(provenance IN (
            'source_extracted', 'source_ocr', 'user_authored',
            'ai_draft', 'user_adopted_ai', 'deterministic_transform'
          )),
          UNIQUE (note_id, revision_number)
        );",
        [],
      )?;

      tx.execute(
        "CREATE INDEX idx_note_revisions_note ON note_revisions(note_id);",
        [],
      )?;

      tx.execute(
        "CREATE TABLE note_links (
          id TEXT PRIMARY KEY,
          note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          target_note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
          target_document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
          target_annotation_id TEXT REFERENCES annotations(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          provenance TEXT NOT NULL CHECK(provenance IN (
            'source_extracted', 'source_ocr', 'user_authored',
            'ai_draft', 'user_adopted_ai', 'deterministic_transform'
          )),
          CHECK (
            (target_note_id IS NOT NULL)
            + (target_document_id IS NOT NULL)
            + (target_annotation_id IS NOT NULL) = 1
          )
        );",
        [],
      )?;

      tx.execute(
        "CREATE INDEX idx_note_links_note ON note_links(note_id);",
        [],
      )?;
      tx.execute(
        "CREATE INDEX idx_note_links_target_note ON note_links(target_note_id);",
        [],
      )?;

      // Record migration 5 completion
      tx.execute(
        "INSERT INTO migration_metadata (version, applied_at, checksum)
       VALUES (5, datetime('now'), 'migration_5_notes_revisions_links');",
        [],
      )?;

      tx.commit()?;
    }

    if current_version < 6 {
      let tx = conn.transaction()?;

      // Task 3.1 (PRD R3): evidence blocks — the structured "Add to note"
      // insertion of FR-10.1. The source excerpt or area image is immutable
      // once written: quote/asset values are insert-only, and the editor's
      // user prose lives on the owning `notes` row. On annotation purge the
      // reference becomes NULL while the excerpt text itself survives, so a
      // note never silently loses material it already quoted.
      tx.execute(
        "CREATE TABLE evidence_blocks (
          id TEXT PRIMARY KEY,
          note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          source_kind TEXT NOT NULL CHECK (source_kind IN ('quote','area_image')),
          annotation_id TEXT REFERENCES annotations(id) ON DELETE SET NULL,
          image_asset_id TEXT REFERENCES annotation_assets(id) ON DELETE SET NULL,
          document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          page_index INTEGER NOT NULL CHECK (page_index >= 0),
          page_label TEXT NOT NULL DEFAULT '',
          quote TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          user_comment TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          provenance TEXT NOT NULL CHECK(provenance IN (
            'source_extracted', 'source_ocr', 'user_authored',
            'ai_draft', 'user_adopted_ai', 'deterministic_transform'
          ))
        );",
        [],
      )?;

      tx.execute("CREATE INDEX idx_evidence_blocks_note ON evidence_blocks(note_id);", [])?;
      tx.execute("CREATE INDEX idx_evidence_blocks_annotation ON evidence_blocks(annotation_id);", [])?;

      // Record migration 6 completion
      tx.execute(
        "INSERT INTO migration_metadata (version, applied_at, checksum)
       VALUES (6, datetime('now'), 'migration_6_evidence_blocks');",
        [],
      )?;

      tx.commit()?;
    }

    if current_version < 7 {
      let tx = conn.transaction()?;

      // Task 3.1 (PRD R4): Remember actions, review history, and FSRS state.
      // - `review_prompts`: FR-11.1 (Remember opens the prompt editor, never a
      //   silent card), FR-11.2 (the five prompt types, cloze not default —
      //   the default lives in the UI, not the schema), FR-11.3 (every prompt
      //   links to at least one source annotation or user-authored note; the
      //   CHECK enforces that), FR-11.5 (the answer stays Draft until
      //   explicitly adopted — `status` + `adopted_at`), FR-11.11 (pause and
      //   priority), FR-11.12 (cue; repeated-failure repair state is derived
      //   from review_events, not stored).
      // - `review_events`: FR-11.7 (optional typed response preserved),
      //   FR-11.8 (Again/Hard/Good/Easy outcomes + duration). Every event is
      //   append-only so FSRS history stays reproducible and exportable
      //   (OQ-13 decision comes in 4.5; the reviewer columns are the standard
      //   FSRS state the implementation records in its chosen version).
      // - `review_schedule`: FSRS state and next due time (FR-11.10);
      //   `fsrs_version` records which scheduler produced the state so event
      //   playback remains deterministic across upgrades.
      tx.execute(
        "CREATE TABLE review_prompts (
          id TEXT PRIMARY KEY,
          annotation_id TEXT REFERENCES annotations(id) ON DELETE SET NULL,
          note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
          prompt_type TEXT NOT NULL CHECK (prompt_type IN (
            'focused_qa','explanation','application','contrast','cloze'
          )),
          question TEXT NOT NULL,
          answer TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','adopted','retired')),
          adopted_at TEXT,
          cue TEXT NOT NULL DEFAULT '',
          priority INTEGER NOT NULL DEFAULT 0,
          paused_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          provenance TEXT NOT NULL CHECK(provenance IN (
            'source_extracted', 'source_ocr', 'user_authored',
            'ai_draft', 'user_adopted_ai', 'deterministic_transform'
          )),
          CHECK (annotation_id IS NOT NULL OR note_id IS NOT NULL)
        );",
        [],
      )?;

      tx.execute("CREATE INDEX idx_review_prompts_annotation ON review_prompts(annotation_id);", [])?;
      tx.execute("CREATE INDEX idx_review_prompts_note ON review_prompts(note_id);", [])?;
      tx.execute("CREATE INDEX idx_review_prompts_status ON review_prompts(status);", [])?;

      tx.execute(
        "CREATE TABLE review_events (
          id TEXT PRIMARY KEY,
          prompt_id TEXT NOT NULL REFERENCES review_prompts(id) ON DELETE CASCADE,
          reviewed_at TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK (outcome IN ('again','hard','good','easy')),
          duration_ms INTEGER NOT NULL DEFAULT 0,
          user_response TEXT NOT NULL DEFAULT '',
          provenance TEXT NOT NULL CHECK(provenance IN (
            'source_extracted', 'source_ocr', 'user_authored',
            'ai_draft', 'user_adopted_ai', 'deterministic_transform'
          ))
        );",
        [],
      )?;

      tx.execute("CREATE INDEX idx_review_events_prompt ON review_events(prompt_id);", [])?;

      tx.execute(
        "CREATE TABLE review_schedule (
          prompt_id TEXT PRIMARY KEY REFERENCES review_prompts(id) ON DELETE CASCADE,
          desired_retention REAL NOT NULL DEFAULT 0.9,
          state TEXT NOT NULL CHECK (state IN ('new','learning','review','relearning')),
          stability REAL NOT NULL DEFAULT 0.0,
          difficulty REAL NOT NULL DEFAULT 0.0,
          due_at TEXT NOT NULL,
          last_reviewed_at TEXT,
          last_outcome TEXT CHECK (last_outcome IN ('again','hard','good','easy')),
          fsrs_version TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          provenance TEXT NOT NULL CHECK(provenance IN (
            'source_extracted', 'source_ocr', 'user_authored',
            'ai_draft', 'user_adopted_ai', 'deterministic_transform'
          ))
        );",
        [],
      )?;

      // Record migration 7 completion
      tx.execute(
        "INSERT INTO migration_metadata (version, applied_at, checksum)
       VALUES (7, datetime('now'), 'migration_7_review_prompts_events_schedule');",
        [],
      )?;

      tx.commit()?;
    }

    if current_version < 8 {
      let tx = conn.transaction()?;

      // Task 3.1 (PRD R4): export records — format, destination, manifest,
      // and completion/error state (§16 `exports`). Every exported package
      // keeps a row so repeated exports can be idempotent and a failed export
      // leaves a recorded, retryable state (FR-14.3/14.6). Destination paths
      // are user-chosen and stored only after the export feature validates
      // them; `manifest_path` carries the sidecar manifest location
      // (FR-14.2/14.3).
      tx.execute(
        "CREATE TABLE exports (
          id TEXT PRIMARY KEY,
          export_kind TEXT NOT NULL CHECK (export_kind IN (
            'markdown','json_backup','review_csv','review_tsv','annotated_pdf'
          )),
          destination_path TEXT NOT NULL,
          manifest_path TEXT,
          status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
          error TEXT,
          items_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          provenance TEXT NOT NULL CHECK(provenance IN (
            'source_extracted', 'source_ocr', 'user_authored',
            'ai_draft', 'user_adopted_ai', 'deterministic_transform'
          ))
        );",
        [],
      )?;

      tx.execute("CREATE INDEX idx_exports_status ON exports(status);", [])?;

      // Record migration 8 completion
      tx.execute(
        "INSERT INTO migration_metadata (version, applied_at, checksum)
       VALUES (8, datetime('now'), 'migration_8_exports');",
        [],
      )?;

      tx.commit()?;
    }

    if current_version < 9 {
      let tx = conn.transaction()?;

      // Task 3.2 (PRD §16.1): adoption never erases the original provenance.
      //
      // Every text-bearing feature table (created in migrations 4–8) already
      // carries the six-value provenance CHECK. This migration adds
      // `original_provenance`, the column that records what a record's
      // provenance WAS before a user explicitly adopted a draft (FR-11.5,
      // FR-12.12). Two column-level CHECKs pin the rule at the schema level:
      // the original must be one of the six values, and a `user_adopted_ai`
      // row must carry a non-NULL, non-adopted original.
      //
      // The check expressions are imported from `provenance` so the Rust
      // validators, the migration SQL, and the tests cannot drift apart.
      // Existing rows are unaffected: no row can be `user_adopted_ai` before
      // this migration exists, so every row satisfies `ADOPTION_CONSISTENCY_CHECK`
      // with the NULL default. The R0.3 era tables (documents, pages,
      // document_versions) are extraction records; adoption does not apply to
      // them and their six-value CHECKs are already in place (migration 1).
      for table in TEXT_BEARING_FEATURE_TABLES {
        tx.execute(
          &format!(
            "ALTER TABLE {table} ADD COLUMN original_provenance TEXT
             CHECK ({ORIGINAL_PROVENANCE_SET_CHECK})
             CHECK ({ADOPTION_CONSISTENCY_CHECK});"
          ),
          [],
        )?;
      }

      // Record migration 9 completion
      tx.execute(
        "INSERT INTO migration_metadata (version, applied_at, checksum)
       VALUES (9, datetime('now'), 'migration_9_provenance_adoption');",
        [],
      )?;

      tx.commit()?;
    }

    if current_version < 10 {
      let tx = conn.transaction()?;

      // Task 3.3 (PRD FR-7.3): per-version page geometry.
      //
      // `document_versions` stores each version's fingerprint, page count, and
      // — from this migration on — the page geometry the coordinates of that
      // version's annotations were created against. Geometry is measured by
      // the renderer (pdf.js viewports at scale 1) and stored as JSON
      // (`[{"page":1,"width":612,"height":792}, …]`); Rust validates the array
      // on every write. Existing version rows (there are none in the wild —
      // no release has ever shipped) keep an empty array; the current version
      // row is the one annotation coordinates refer to, so re-anchoring
      // compares geometry across versions rather than reusing coordinates
      // blindly (FR-7.3, RK-2).
      tx.execute(
        "ALTER TABLE document_versions ADD COLUMN page_geometry_json TEXT NOT NULL DEFAULT '[]';",
        [],
      )?;

      tx.execute(
        "CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions(document_id);",
        [],
      )?;

      // Record migration 10 completion
      tx.execute(
        "INSERT INTO migration_metadata (version, applied_at, checksum)
       VALUES (10, datetime('now'), 'migration_10_version_page_geometry');",
        [],
      )?;

      tx.commit()?;
    }

    if current_version < 11 {
      let tx = conn.transaction()?;

      // Task 3.3: the version-bound integrity checksum on annotations.
      //
      // R0.4's durable-anchor proof regenerates an annotation checksum bound
      // to the document version id (documentVersionId + page + type +
      // geometry + exactQuote) whenever an annotation is re-anchored to a new
      // version; without a stored column the re-anchor flow could not record
      // the new binding and any downstream integrity check would flag
      // re-anchored annotations as tampered. `text_layer_checksum` stays the
      // separate text-layer hash (FR-9.4); `checksum` is the integrity
      // checksum that changes with the version binding. Empty string until
      // annotations exist in the wild (none do — no release has shipped);
      // task 3.4 fills it at creation time.
      tx.execute(
        "ALTER TABLE annotations ADD COLUMN checksum TEXT NOT NULL DEFAULT '';",
        [],
      )?;

      // Record migration 11 completion
      tx.execute(
        "INSERT INTO migration_metadata (version, applied_at, checksum)
       VALUES (11, datetime('now'), 'migration_11_annotation_checksum');",
        [],
      )?;

      tx.commit()?;
    }

    if current_version < 12 {
      // FR-9.9: allow embedded-annotation imports (deterministic_transform
      // provenance) to store highlight/underline markup without a text quote.
      // The PDF carries geometry, not guaranteed extractable text, so the quote
      // — required for user-authored text markup (FR-9.4) — is optional for
      // imported markup. SQLite CHECK constraints cannot be altered in place,
      // so the annotations table is recreated with the relaxed CHECK. No
      // release has shipped, so existing rows (if any in dev databases) are
      // copied verbatim; foreign keys are disabled for the recreation because
      // annotation_assets references this table.
      conn.execute("PRAGMA foreign_keys = OFF", [])?;
      let tx = conn.transaction()?;

      tx.execute(
        &format!(
          "CREATE TABLE annotations_new (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
          annotation_type TEXT NOT NULL CHECK (annotation_type IN (
            'highlight', 'underline', 'area', 'comment', 'bookmark'
          )),
          page_index INTEGER NOT NULL CHECK (page_index >= 0),
          page_label TEXT NOT NULL DEFAULT '',
          rects_json TEXT NOT NULL DEFAULT '[]',
          quote TEXT NOT NULL DEFAULT '',
          prefix_text TEXT NOT NULL DEFAULT '',
          suffix_text TEXT NOT NULL DEFAULT '',
          text_layer_checksum TEXT,
          comment TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          provenance TEXT NOT NULL CHECK(provenance IN (
            'source_extracted', 'source_ocr', 'user_authored',
            'ai_draft', 'user_adopted_ai', 'deterministic_transform'
          )),
          checksum TEXT NOT NULL DEFAULT '',
          original_provenance TEXT
            CHECK ({ORIGINAL_PROVENANCE_SET_CHECK})
            CHECK ({ADOPTION_CONSISTENCY_CHECK}),
          CHECK (
            (annotation_type IN ('highlight','underline') AND (length(quote) > 0 OR provenance = 'deterministic_transform'))
            OR (annotation_type NOT IN ('highlight','underline') AND length(quote) = 0)
          ),
          CHECK (annotation_type <> 'area' OR length(rects_json) > 2)
        );"
        ),
        [],
      )?;

      tx.execute(
        "INSERT INTO annotations_new (
          id, document_id, document_version_id, annotation_type, page_index,
          page_label, rects_json, quote, prefix_text, suffix_text,
          text_layer_checksum, comment, color, tags, deleted_at,
          created_at, updated_at, provenance, checksum, original_provenance
        )
        SELECT
          id, document_id, document_version_id, annotation_type, page_index,
          page_label, rects_json, quote, prefix_text, suffix_text,
          text_layer_checksum, comment, color, tags, deleted_at,
          created_at, updated_at, provenance, checksum, original_provenance
        FROM annotations;",
        [],
      )?;

      tx.execute("DROP TABLE annotations;", [])?;
      tx.execute("ALTER TABLE annotations_new RENAME TO annotations;", [])?;
      tx.execute("CREATE INDEX IF NOT EXISTS idx_annotations_document ON annotations(document_id);", [])?;
      tx.execute("CREATE INDEX IF NOT EXISTS idx_annotations_version ON annotations(document_version_id);", [])?;
      tx.execute("CREATE INDEX IF NOT EXISTS idx_annotations_type ON annotations(annotation_type);", [])?;
      tx.execute("CREATE INDEX IF NOT EXISTS idx_annotations_trash ON annotations(deleted_at);", [])?;

      tx.execute(
        "INSERT INTO migration_metadata (version, applied_at, checksum)
       VALUES (12, datetime('now'), 'migration_12_imported_markup_empty_quote');",
        [],
      )?;

      tx.commit()?;
      conn.execute("PRAGMA foreign_keys = ON", [])?;
    }
  }

  Ok(())
}
