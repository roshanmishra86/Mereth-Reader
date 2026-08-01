# Reader implementation plan

## Purpose and operating rule

This document is the source of truth for the implementation sequence. Before starting a task, read its acceptance criteria and dependencies. Immediately after a task is verified, change its checkbox from `[ ]` to `[x]` and add a short verification note that names the command run and its result.

A task is complete only when its acceptance criteria are demonstrated. Writing code is not completion. Configuring something is not completion. "The file exists" is not completion. If the only evidence is that a file was created, the task stays `[ ]`.

## Decisions and constraints

- Product behaviour comes from `reader-prd.md`. Visual direction comes from `mock-up/` and its Modernist design system (`mock-up/_ds/modernist-*/`).
- The stack is **Tauri 2 + React + Vite + Rust**. The PRD originally proposed Electron; it was amended to Tauri on 2026-08-01 (task 0.1), including a full rewrite of the §15.3 security posture, so plan and PRD no longer contradict each other. Task 5.1 now has verifiable requirements to check against.
- The package manager is **pnpm only**. No npm, no yarn, no bun — no lockfiles, scripts, CI steps, or test imports from any of them.
- The Windows artifact is an **NSIS setup executable (`.exe`)**, per-user install mode. MSI is a later decision.
- Local-first: no cloud service, account, telemetry, or remote dependency for reading, annotation, notes, review, or export.
- **AI is out of v1 scope.** PRD §18.1 recommends releasing through R4, not R5. This plan adopts that: the release candidate is the complete non-AI product. AI work does not begin until the completion gate below is met, and it then starts with its own evaluation-corpus gate. The existing AI *surfaces* in the UI are placeholders that must correctly represent the off state; they are not a feature commitment.
- Windows is the primary target; Linux is validated locally. macOS is out of scope (PRD R7).

## Research log

- [x] Read the product PRD.
  - Evidence: `reader-prd.md` §§0–21 and Appendices A–B.
  - Finding: the core loop is document → annotation → user-authored note → explicitly approved retrieval prompt → source-revealed review.

- [x] Read the supplied UI mockup and design-system instructions.
  - Evidence: `mock-up/Reader Prototype.dc.html` (5 destinations, ~153 distinct labelled controls) and `mock-up/_ds/modernist-*/readme.md` + `styles.css`.
  - Finding: restrained three-zone reader; app rail; strong 2px dividers; zero corner radius; paper canvas; single near-mono red accent `#ec3013`; Archivo for both heading and body; Lucide icons; distinct source/user/AI presentation; all tokens read from CSS variables.

- [x] Verify the appropriate Tauri integration shape.
  - Evidence: Tauri 2 Vite integration and Windows installer configuration.
  - Finding: Vite + static `dist/` + NSIS bundling on `windows-latest` is the supported route; cross-compiling Windows from Linux is not.

- [x] Inspect the repository and tooling.
  - Evidence: audit of 2026-08-01 (below). Node 24.18.1, pnpm 11.18.0, cargo 1.97.1 present.
  - Finding: greenfield. **The repository has no commits yet** (`git log` reports no commits on `master`), so no CI workflow has ever run.

---

## Verified implementation status — audit of 2026-08-01

Every claim below was checked against the working tree on the audit date.

### What genuinely exists

| Area | State | Evidence |
| --- | --- | --- |
| Toolchain config | Real | `package.json` (pnpm 11.18.0 pinned), `vite.config.ts`, `tsconfig*.json`, `index.html` |
| Dependency install | Real | `pnpm install --frozen-lockfile` succeeded from a clean `node_modules` |
| Frontend build | Real | `pnpm build` exits 0 and emits `dist/` |
| Unit tests | Minimal | `pnpm test` runs 11 vitest cases, all in `src/utils/pdfUtils.test.ts` |
| Tauri capabilities | Real | `src-tauri/capabilities/default.json` = `core:default` + `dialog:allow-open` only |
| CSP | Declared, unverified | `src-tauri/tauri.conf.json` sets a restrictive CSP; never exercised against a real PDF |
| NSIS bundle config | Present, was invalid | see correction C3 |
| CI workflow | File only | `.github/workflows/windows-build.yml` exists; never executed — no commits |
| UI shell | Static prototype | one 249-line `src/main.tsx` + one 18-line `src/styles.css` |

### What does not exist

- **No PDF rendering of any kind.** `pdfjs-dist` is installed but imported nowhere. The "document" is hard-coded HTML paragraphs in `DocumentPage()`.
- **No persistence.** No SQLite, no schema, no migrations, no Rust commands. `src-tauri/src/lib.rs` is 7 lines and registers only the dialog plugin.
- **No real annotations.** Three literal objects in a module-level `annotations` array; the highlights are `<mark onClick>` elements in prose.
- **No notes, review scheduling, export, search, or import beyond a file-name string.** `choosePdf()` opens the native dialog and then sets a display string; the file is never read.
- **`src/utils/pdfUtils.ts` is orphaned.** `calculateZoomScale`, `searchPdfText`, and `formatPageLabel` are imported by nothing except their own test. They are unused scaffolding, not shipped behaviour.
- **No routing, no state persistence, no error boundaries, no accessibility pass.**

### Corrections to previously claimed completions

- **C1 — "Build the mockup-aligned application shell and reader workspace" was marked `[x]`. Reverted to `[ ]`.** The five destinations exist as conditional renders and the panes collapse, but the shell does not conform to the design system (see §6) and covers roughly a third of the mockup's controls. It is a visual sketch.
- **C2 — "Implement prototype interactions …" was marked `[x]`. Reverted to `[ ]`.** The flows are static: selecting an annotation swaps hard-coded text, "Approve prompt" closes a dialog and discards the input, and review ratings reset a boolean. Nothing round-trips.
- **C3 — "Configure NSIS as the Windows bundle target" was marked `[x]`. It was wrong.** `bundle.windows.nsis` used the key `installerMode`, which is not in the Tauri 2 schema (the key is `installMode`). This made `cargo check` — and therefore any `pnpm tauri build` and the entire GitHub Actions workflow — fail at the build script with `unknown field 'installerMode'`. Fixed during this audit; see task 1.3.
- **C4 — "`pnpm build` succeeds" was stated as current status. It was false at audit time.** `src/utils/pdfUtils.test.ts` imported from `bun:test`, so `tsc --noEmit` failed with `TS2307: Cannot find module 'bun:test'`. Fixed during this audit by moving the suite to vitest and deleting `bun.lock`.
- **C6 — The Rust crate has never compiled, and there are two reasons, not one.** After the `installMode` fix, `cargo check` still failed: `tauri::generate_context!()` panics with `failed to open icon src-tauri/icons/icon.png: No such file or directory`. There is no `src-tauri/icons/` directory and no `bundle.icon` key in `tauri.conf.json`, so Tauri falls back to the default icon path and finds nothing. Every prior claim that the Tauri side was configured rested on a crate that could not build. A placeholder icon set was generated during this audit via `pnpm tauri icon`, after which `cargo check` exits 0 — the crate compiles for the first time in the project's history. See task 1.5.
  - Side effect, resolved: `pnpm tauri icon` also emitted `src-tauri/icons/android/` and `src-tauri/icons/ios/`. Neither platform is on the roadmap — the PRD stops at Linux (R8) and §4.2 lists mobile clients as an explicit non-goal — so both directories were deleted. 17 desktop icon files remain. If `pnpm tauri icon` is ever re-run, it will regenerate them; delete them again.
- **C5 — "GitHub Actions Windows build automation" was marked `[x]`.** The workflow file is written but has never run, because the repository has no commits. It also would have failed on C3. The file is a draft until a run produces an artifact.

### Package-manager cleanup (done 2026-08-01)

- [x] Remove all bun artefacts and make pnpm the only path.
  - Acceptance: no bun lockfile, no `bun:` imports, no bun in scripts or CI; `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm test` all exit 0.
  - Verification note: `bun.lock` deleted; `src/utils/pdfUtils.test.ts` now imports from `vitest`; `vitest` added to `devDependencies` with a `test` script; `pnpm-lock.yaml` regenerated. `pnpm build` exits 0, `pnpm test` passes 11/11. A repo-wide grep for `bun` returns no matches outside the word "bundle".
  - Open item: `pnpm-workspace.yaml` contains only `allowBuilds: { esbuild: false }`. Confirm this key is honoured by pnpm 11 rather than silently ignored, and that suppressing the esbuild postinstall is intended.

---

## Work plan

Phases map to the PRD roadmap (§18). Each phase must be fully usable with no AI assets present.

### 0. Corrections that block other work

- [x] **0.1 — Amend the PRD's stack and security sections to Tauri.**
  - Verification note (2026-08-01): PRD is now Draft v0.2 with an amendment note at the head. §1.6 specifies Tauri 2 + Rust and records the OS-webview consequence (smaller footprint; **rendering is not identical across platforms**, so the §8.1 corpus gate is per-platform). §2.3 replaces the working-name policy with the resolved name. §14.2 uses `mereth://`. §15.2 lists Tauri 2, a Rust privileged layer, and Rust-side SQLite. §15.3 is fully rewritten as a Tauri posture — itemised capability allowlist, no broad `fs` scope, verified CSP with `dangerousDisableAssetCspModification` barred, scoped asset protocol over `file://`, narrow typed IPC with no caller-supplied paths or SQL, external navigation denied, PDF JS disabled, sidecar payload limits, document-text-as-data. §18 R0, RK-11, RK-12, OQ-1, and OQ-4 restated; Appendix B swaps the Electron checklist for Tauri security, capabilities, and CSP references. A grep confirms no Electron-only control survives as a requirement.
  - New risk added during the amendment: **RK-18 — OS webview differences cause per-platform rendering, selection, or CSP divergence.** This did not exist under Electron's bundled Chromium and directly affects the R7/R8 port estimates.

- [ ] **0.2 — Make the first commit and push.**
  - Acceptance: the tree is committed on a branch and a push triggers CI.
  - Note: `.gitignore` excluding `mock-up/`, `.codex/`, and `.agents/` is **intentional** — the mockups are deliberately kept out of the pushed repository. Consequence to accept knowingly: the design source of truth lives only on this machine, so it is not backed up by the remote and is invisible to CI. Keep a local copy safe.

- [x] **0.3 — Resolve the product name (PRD OQ-1).**
  - Decision: the product is **Mereth Reader**; the repository is `mereth-reader`. PRD OQ-1 moves from Open to Resolved.
  - Follow-through required in task 0.4 — the name is currently inconsistent across four places.

- [x] **0.4 — Propagate the name.**
  - Verification note (2026-08-01): `productName` = "Mereth Reader"; window `title` = "Mereth Reader"; `identifier` = `dev.mereth.reader`; `package.json` `name` = `mereth-reader`; Cargo package `mereth-reader` / lib `mereth_reader_lib` with `main.rs` calling `mereth_reader_lib::run()`; `index.html` `<title>` and the UI titlebar mark updated; CI artifact renamed to `MerethReader-Windows-NSIS`; `README.md` retitled. A grep for `reader_lib`, `io.reader.local`, and `Reader-Windows-NSIS` across `.rs/.json/.toml/.yml/.tsx/.ts/.html/.md` returns no stale hits. `pnpm build`, `pnpm test` (11/11), and `cargo check` all exit 0 after the rename.
  - PRD §14.2 now uses `mereth://`; the placeholder is gone.
  - Identifier decision: **`dev.mereth.reader`**, replacing `io.reader.local`. Chosen while no installs exist, since it fixes the application data directory (`%APPDATA%\dev.mereth.reader\` on Windows) and changing it post-release would strand user data.
  - Deep-link scheme decision: **`mereth://`**, replacing the PRD §14.2 `reader://` placeholder — `mereth://document/{id}?page=&annotation=`, `mereth://note/{id}`, `mereth://review/{id}`.

### 1. Project foundation

- [x] **1.1 — Tauri 2 + React + Vite + TypeScript + pnpm configuration.**
  - Verification note: `pnpm install --frozen-lockfile` and `pnpm build` both exit 0 on a clean `node_modules` (2026-08-01).

- [x] **1.2 — Minimal native capability surface.**
  - Verification note: `capabilities/default.json` grants `core:default` and `dialog:allow-open` only. This will need deliberate, itemised extension for tasks 2.2 and 3.1 — each added permission is a reviewable change.

- [ ] **1.3 — NSIS Windows bundle target.**
  - Acceptance: `bundle.targets` contains `nsis` with a per-user `installMode`, **and** `cargo check --manifest-path src-tauri/Cargo.toml` exits 0, **and** a Windows build produces a setup `.exe`.
  - Status: the invalid `installerMode` key was corrected to `installMode`, and the missing icon set was generated (C6). `cargo check --manifest-path src-tauri/Cargo.toml` now exits 0 — the crate compiles for the first time. Stays `[ ]` until a real Windows build emits an installer (task 6.4).

- [ ] **1.5 — Replace the placeholder application icon.**
  - Status: `src-tauri/icons/` was generated during this audit from a placeholder mark (a ground-colour square on the accent field, following the Modernist system) purely so the crate could compile. It is not branding and must not ship.
  - Acceptance: a real Mereth Reader icon set at every size Tauri bundles, plus the Windows `.ico` and NSIS installer imagery. No longer blocked — the name is decided; this now needs artwork, not a decision.

- [ ] **1.4 — Add a fast CI quality job.**
  - Acceptance: a job on `ubuntu-latest` runs `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm test`, and `cargo check` on every push. The Windows NSIS build is separated so a type error fails in ~2 minutes instead of ~20.

### 2. Reader experience (PRD R1)

- [ ] **2.1 — PDF rendering with PDF.js.**
  - Research before coding: run the R0 spike against the PRD §17.5 corpus — text-heavy, multi-column, equations/ligatures, CJK and RTL, graphics-heavy, malformed, encrypted/password, and a 400+ page book. Assess selection fidelity, memory during long scroll, links, outline extraction, and text-layer accessibility. Compare PDFium if the corpus gate fails (PRD RK-1).
  - Acceptance: first page of a 400-page born-digital PDF visible within 2 s from local SSD (PRD §17.2); zoom, navigation, search, outline, and text selection all work with no AI; the PDF.js version and worker/CSP strategy are recorded in this file.
  - Note: `src/utils/pdfUtils.ts` is speculative scaffolding written before any renderer exists. Treat it as disposable; do not let it dictate the viewer's design.

- [ ] **2.2 — Real PDF import and document ownership modes.**
  - Research before coding: identify the least-privileged Tauri dialog/fs/asset-protocol permissions needed on Windows and Linux, and add them individually.
  - Acceptance: native picker and drag-drop both work; the user explicitly chooses open-in-place or managed-library copy; the original is never moved or modified; a moved in-place file produces a recoverable locate-file flow (PRD §7.2).

- [ ] **2.3 — Windows OS integration.**
  - Acceptance: file association, "Open with", and command-line open all launch the app on the given PDF (PRD FR-7.1). Appendix A step 2 requires this, and it is absent from the current build.

- [ ] **2.4 — View modes, navigation, and search depth.**
  - Acceptance: single page, continuous vertical, facing pages, fit width, fit page, custom zoom, rotate, and presentation/fullscreen (FR-8.2); outline, thumbnails, page labels, history back/forward, named destinations, internal links (FR-8.1); search with case-sensitive and whole-word options, diacritic-tolerant default, result count, snippets, keyboard traversal (FR-8.3), running on deterministic extracted text.

- [ ] **2.5 — Library, metadata, and background jobs.**
  - Acceptance: recents, favourites, collections, tags, archive (FR-7.5); embedded metadata extracted and editable with no network call (FR-7.4); fingerprint-duplicate handling with confirmation (FR-7.7); extraction/thumbnail/index jobs are visible, cancellable, and restartable, and reading stays available while they run (FR-7.6); cancelling indexing never corrupts a document record.

- [ ] **2.6 — Session restore.**
  - Acceptance: reopening a document restores exact page, zoom mode, and scroll position (PRD §7.2, Appendix A step 7).

- [ ] **2.7 — Appearance and reading comfort.**
  - Acceptance: light and dark application chrome plus page-dimming, with **no** default colour inversion of page content (FR-8.6); application text size adjustable independently of PDF zoom; reduced-motion support (§17.4); calm chrome that appears on intent rather than on pointer movement (FR-8.5).

### 3. Local data and annotations (PRD R2)

- [ ] **3.1 — Local SQLite data layer.**
  - Research before coding: choose the Tauri-compatible SQLite strategy (Rust-side `rusqlite`/`sqlx` behind narrow commands is preferred over exposing SQL to the webview).
  - Acceptance: **WAL enabled and FTS5 available** (PRD §15.2); tables for the PRD §16 entity list including `document_versions`, `pages`, `annotation_assets`, `note_revisions`, `evidence_blocks`, `review_events`, `review_schedule`, `jobs`, and `exports`; forward-only versioned migrations that back up before running; atomic write boundaries; everything under the app data directory laid out per §15.4.

- [ ] **3.2 — Provenance on every text-bearing record.**
  - Acceptance: each stores exactly one of `source_extracted`, `source_ocr`, `user_authored`, `ai_draft`, `user_adopted_ai`, `deterministic_transform` (§16.1). Adoption never erases the original provenance. This is schema-level, not presentation-level.

- [ ] **3.3 — Document fingerprinting and version handling.**
  - Acceptance: each import stores a cryptographic fingerprint, page count, and page geometry; different bytes at a known path are treated as a new version and **offer re-anchoring** rather than reusing old coordinates (FR-7.3, RK-2).

- [ ] **3.4 — Annotation types and durable anchors.**
  - Acceptance: text highlight, underline, **area/image capture**, anchored comment without a highlight, and bookmark (FR-9.1). Each text annotation stores document version, zero-based page and visible label, normalized rectangles, exact quote, prefix/suffix context, text-layer checksum, and timestamps (FR-9.4). Area captures store the crop as an asset plus fingerprint, page, rectangle, and optional caption — never an orphaned bitmap (FR-9.7). Annotations survive zoom, resize, rotation, and restart.

- [ ] **3.5 — Quote/comment separation, palette, undo, and trash.**
  - Acceptance: the extracted passage is read-only inside the annotation and the user comment is a separate field, with no copy/export style able to present a comment as a quotation (FR-9.5); a configurable semantic colour palette carries both colour and user label (FR-9.3); create/edit/delete are undoable in-session and deletion goes to a recoverable trash before purge (FR-9.8).

- [ ] **3.6 — Embedded annotation handling.**
  - Acceptance: standards-compliant embedded annotations render; importing them into editable Reader records is an explicit action that previews duplicates and provenance (FR-9.9).

- [ ] **3.7 — Annotation search and filters.**
  - Acceptance: filter by type, semantic colour label, tag, page range, note status, and Remember status; search quote and comment text; **filtering 10,000 annotations stays interactive on reference hardware** (§9.3) — this needs a measured benchmark, not an assertion.

### 4. Notes, review, and export (PRD R3–R4)

- [ ] **4.1 — Source, concept, and scratch notes.**
  - Acceptance: the three roles are distinct; scratch notes must be promoted, archived, or discarded and are not exported as polished knowledge by default; autosave with bounded local revisions loses no more than the current small edit buffer on crash (FR-10.8); revision restore never duplicates annotation blocks or assets.

- [ ] **4.2 — Evidence blocks and in-context return.**
  - Acceptance: "Add to note" inserts an immutable source excerpt or area image with document title/author, page label, annotation deep link, colour label/tags, and the separate user comment (FR-10.1); activating a source link opens the document, centres the annotation, briefly emphasizes it, and navigation history returns to the note (FR-10.2).

- [ ] **4.3 — Links, backlinks, templates, and note search.**
  - Acceptance: note-to-note, document, and annotation links plus backlinks, all keyed on stable IDs so renaming preserves every link (FR-10.5); user-editable, previewable, versioned templates (FR-10.7); split-with-link-preservation and non-blocking atomicity warnings (FR-10.6); full-text search across titles, prose, comments, tags, and excerpts that identifies each result's text role (FR-10.9); Markdown semantics per FR-10.10.

- [ ] **4.4 — Remember action and prompt editor.**
  - Acceptance: marking a highlight, evidence block, or note "Remember" opens the prompt editor and **never silently creates a card** (FR-11.1); prompt types cover focused Q&A, explanation, application, contrast, and cloze — cloze not the default (FR-11.2); every prompt links to at least one source annotation or user-authored note (FR-11.3); advisory, always-overridable quality lint per FR-11.4; the answer stays Draft until the user explicitly adopts it (FR-11.5).

- [ ] **4.5 — FSRS scheduling and review sessions.**
  - Research before coding: select an FSRS implementation with deterministic, exportable scheduling events; record its version and licence (PRD OQ-13).
  - Acceptance: default desired retention 90%, transparent next-review dates, configurable daily time/card budget (FR-11.10); source excerpt, answer, thumbnail, and nearby context stay hidden until reveal or explicit skip (FR-11.6); reveal shows adopted answer and exact source evidence side by side (FR-11.7); outcomes are Again/Hard/Good/Easy with the UI stating that Hard is still a successful recall (FR-11.8); **no AI grades the user** (FR-11.9); FSRS event history is exportable and reproducible.

- [ ] **4.6 — Queue controls and prompt repair.**
  - Acceptance: daily budget, pause, priority, reschedule, and stop-reviewing all present; over-budget reviews stay due without punishment or streak pressure (FR-11.11, Principle 10); repeated failure offers add-a-cue, split, narrow, or retire rather than shrinking the interval forever (FR-11.12); a backlog never blocks reading or note-taking.

- [ ] **4.7 — Reading-session synthesis.**
  - Acceptance: at session end, offer — never force — the four source-hidden recall questions of PRD §11.4, revealing that session's annotations only after the attempt.

- [ ] **4.8 — Export: Quick Copy, Markdown, JSON backup.**
  - Acceptance: Quick Copy emits a selected annotation, evidence block, note, or prompt as Markdown or plain text with its page/source reference, visibly distinguishing quotation from user comment (FR-14.1); the Markdown package uses the `export/{notes,sources,assets,reviews}/manifest.json` layout with stable IDs, front matter, and relative asset paths, readable in a plain text editor without Reader (FR-14.2); a versioned JSON/asset archive covers documents, annotations, notes, links, prompts, review history, settings, and provenance (FR-14.4).

- [ ] **4.9 — Annotated PDF copy export.**
  - Acceptance: exports a **new** PDF with supported annotations embedded; the managed or in-place original is never modified (FR-14.3, RK-3); Reader-only metadata goes to a sidecar manifest rather than being dropped silently. Feasibility is a PDF.js/pdf-lib spike, gated with task 2.1.

- [ ] **4.10 — Review export and destination safety.**
  - Acceptance: prompts and source references export as CSV/TSV (FR-14.5); the user chooses the destination, existing files are never overwritten without a diff or confirmation, and repeat exports are idempotent where the format allows (FR-14.6).

- [ ] **4.11 — Deep links.**
  - Acceptance: `mereth://document/{id}?page=&annotation=`, `mereth://note/{id}`, and `mereth://review/{id}` resolve; exports also carry human-readable page/source text so they never depend on the scheme alone (§14.2).

- [ ] **4.12 — Backup restore drill.**
  - Acceptance: restoring a backup into a clean profile reproduces note links and review due state (Appendix A step 13, RK-17). An untested backup is not a backup.

### 5. Security and accessibility

- [ ] **5.1 — Lock down PDF and webview security.**
  - Depends on task 0.1.
  - Acceptance: PDF JavaScript, automatic launches, embedded executables, and network fetches from document content do not execute (FR-8.8); external links disclose the destination and require an explicit OS-browser handoff; the CSP is verified against a hostile sample, not just declared in config; the capability allowlist contains no permission that no feature uses; document text is never treated as instructions (FR-12.14 — applies now, since it constrains the architecture even with AI absent).
  - Verification: run the malformed/hostile subset of the §17.5 corpus and record results.

- [ ] **5.2 — Accessibility and keyboard coverage.**
  - Acceptance: every core workflow is completable without a mouse (§8.3); focus order is logical with visible `:focus-visible` state and no keyboard traps; screen-reader names and roles on annotation tools, panes, pages, and review controls; WCAG AA contrast in application chrome; colour is never the only annotation-category signal; the app stays readable at the 1024×640 minimum window.
  - Known defects in the current prototype: the Settings section list uses `<b>` elements instead of buttons; highlights are click-only `<mark>` elements with no keyboard path; modals have no focus trap or focus restoration; rail buttons carry no `aria-current`.

### 6. Packaging and release

- [ ] **6.1 — GitHub Actions Windows build automation using pnpm.**
  - Acceptance: a push runs on `windows-latest`, installs with the frozen lockfile, runs `pnpm tauri build --bundles nsis`, and uploads the setup `.exe`.
  - Status: the workflow file exists but has never run — the repository has no commits, and it would have failed on the NSIS config error (C3). Blocked on task 0.2.

- [x] **6.2 — Generate and commit `pnpm-lock.yaml`.**
  - Verification note: regenerated after the bun removal and vitest addition. `pnpm install --frozen-lockfile` succeeded from an empty `node_modules` on Linux with pnpm 11.18.0 (2026-08-01). Windows verification comes with the first CI run.

- [ ] **6.3 — Local and CI verification green.**
  - Acceptance: `pnpm build`, `pnpm test`, `cargo check --manifest-path src-tauri/Cargo.toml`, and `pnpm tauri:build` all exit 0.
  - Status (2026-08-01): `pnpm build` exits 0, `pnpm test` passes 11/11, and `cargo check --manifest-path src-tauri/Cargo.toml` exits 0. `pnpm tauri:build` remains unverified on every platform — it needs the full system toolchain (WebView2 on Windows, WebKitGTK on Linux) and has never been run here.

- [ ] **6.4 — Validate the Windows workflow end to end.**
  - Acceptance: a push produces a downloadable `MerethReader-Windows-NSIS` artifact containing a setup `.exe` that installs and launches on a clean Windows 11 x64 machine.

- [ ] **6.5 — Performance benchmark against reference hardware.**
  - Acceptance: measured numbers recorded for PRD §17.2 — first page under 2 s, cached page navigation under 100 ms, annotation visible under 100 ms and durable under 500 ms, search first results under 300 ms, and a measured AI-off working-set cap. Targets that are never measured are decoration.

- [ ] **6.6 — Release signing.**
  - Acceptance: certificate secrets are held in GitHub secrets, the installer is signed in CI, and verification steps are documented.
  - Blocked: requires an organization-owned signing certificate and explicit authorization. Do not attempt without both.

### 7. Deferred — not v1

- [ ] **7.1 — Optional local AI (PRD R5).**
  - Gate: do not begin until the completion gate below is fully met. Then evaluate binary size, model licence, hardware requirements, sandboxing, and local-only runtime before any code.
  - Acceptance if later included: global off unloads every app-managed process and index and cancels queued work (FR-12.1); per-document exclusion is enforced across every action (FR-12.2); each action declares its scope with no implicit library-wide scope (FR-12.3); every document-grounded answer exposes its retrieved evidence (FR-12.11); generated text is visibly and structurally distinct until adopted (FR-12.12); the model never assigns mastery or correctness (FR-12.10); prompt-injection and citation-accuracy evaluation gates pass before shipping.
- [ ] **7.2 — OCR (PRD R6).** v1 boundary stands: scanned PDFs can be viewed and area-annotated, but text search and text highlights are unavailable, and that limitation is stated in the UI rather than silently degraded.
- [ ] **7.3 — macOS (R7), Linux packaging (R8), EPUB/DjVu (R9).**

---

## UI/UX conformance backlog

The current `src/main.tsx` is a static sketch. These are conformance gaps against `mock-up/`, tracked separately because they are presentation defects rather than missing features.

### Design-system violations (fix before further UI work)

- [ ] **U1 — Archivo is never loaded.** `styles.css` declares `font-family: Archivo, Arial, sans-serif` with no `@font-face` or self-hosted file, so the app silently renders in Arial. The design system specifies Archivo for both heading and body. Self-host the font — a webfont CDN would break the offline-by-default trust boundary and the CSP.
- [ ] **U2 — Design tokens are hard-coded.** Every colour, space, and size in `styles.css` is a literal (`#ec3013`, `#f3f2f2`, `rgba(32,30,29,.4)`, px values). The system requires consuming `var(--color-*)`, `--font-*`, `--space-*`, `--radius-*`, `--shadow-*` from the token sheet so the theme can change in one place. Port the token layer from `mock-up/_ds/modernist-*/styles.css`.
- [ ] **U3 — Icons are Unicode glyphs, not Lucide.** `▤ ▯ ✎ ↻ ☷ ⌕ ✦ •••` render inconsistently across platforms and carry no consistent optical weight. The system specifies Lucide. Use inline SVG so nothing is fetched at runtime.
- [ ] **U4 — Accent contrast.** The accent-to-ground pair is tuned to ~3:1 — adequate for icons, large text, and chrome, not for body copy. Paragraph-size accent text must use `--color-accent-700`. Audit `.eyebrow` and `.paper-kicker`, which currently use `#ae1800` ad hoc.
- [ ] **U5 — `styles.css` is unmaintainable.** 18 lines holding the entire application stylesheet, with dozens of rules per line. Split by concern before it grows.

### Missing mockup surfaces

- [ ] **U6 — Annotation filter chips with live counts** (`All 41 / Claim 14 / Evidence 11 / Question 9 / Disagree 7`) and per-annotation `Add to note` / `Remember` actions.
- [ ] **U7 — Library as a real collection view**: Recents / Favourites / collections / Archive, and a sortable table with Title, Author, Ownership, Due, Last read. Currently a two-row hard-coded list.
- [ ] **U8 — Notes destination**: concept / source / scratch grouping, the scratch prompt-to-promote state, backlinks panel, "Prompts from this note", and Quick Copy.
- [ ] **U9 — Review session chrome**: `Card N of M · budget 20/day · elapsed`, Pause this prompt, Edit prompt, End session, "Your adopted answer" alongside the source, and the repeated-failure notice.
- [ ] **U10 — Settings**: only the AI & privacy page exists. Appearance, Reading, Annotations, Review, Storage, Export, and Shortcuts are inert labels. The Models table and Boundaries/Excluded-documents surfaces belong with task 7.1, not v1.
- [ ] **U11 — Import dialog**: show the computed fingerprint, the source path for open-in-place, and the destination path for managed copy.
- [ ] **U12 — Prompt editor**: add the prompt-type selector (Explanation / Application / Contrast / Cloze) and the "Add a cue" / "Keep anyway" affordances on lint warnings.
- [ ] **U13 — In-margin source note and AI margin note** with Adopt / Discard and the "Autosaved · N revisions kept" state.
- [ ] **U14 — Reader toolbar**: fit-width and view-mode controls, and the continuous-scroll/spread indicator.

### Prototype honesty

- [ ] **U15 — The prototype currently asserts things that are not true.** The footer reads "41 annotations · 6 notes · Autosaved just now", the search box shows "7 / 41", and the review header claims "12 due · FSRS · desired retention 90%" — with no annotations, no notes, no autosave, no search index, and no scheduler behind any of it. Either wire these to real state or mark the build unmistakably as a mockup. Shipping invented counts makes it impossible to tell working features from placeholders during testing.

---

## Completion gate

The product is not complete until every task in phases 0–6 is checked and verified, and the PRD Appendix A journey passes end to end **with the network disabled and no AI models installed**:

install on a clean Windows machine → open a 400-page PDF via "Open with" → navigate by outline, search, and page number → highlight, label, and comment → capture a figure and add both to a source note → write a linked concept note → restart and restore the exact reading position → return from the note to each page annotation → mark one idea Remember and approve a prompt → complete a source-hidden review and self-rate → Quick Copy evidence with its page reference → export Markdown, review CSV/TSV, full backup, and an annotated PDF copy → restore that backup into a clean profile and repeat the note and review steps.

Only after that journey passes does task 7.1 (AI) become eligible to start.
