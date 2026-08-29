# Mereth Reader — Pending Implementation and Release Plan

**Audit date:** 2026-08-29  
**Branch inspected:** `feature/phase-6-extra` at `d07c2d9`, plus the current uncommitted working tree  
**Primary sources:** `reader-prd.md`, `PRODUCT.md`, `DESIGN.md`, `planned-task-list.md`, decision reports, current source, tests, workflow configuration, and recent Git history

## Verdict

**Better approach available.** Mereth is no longer an early scaffold, but it is also not ready for release validation. Most of the R0–R4 product loop exists in code, while the remaining work is concentrated in four areas:

1. restore a compilable and testable working tree;
2. close incomplete v1 workflows and prove them end to end;
3. validate the installed Windows application on reference hardware;
4. reconcile stale or over-optimistic documentation with demonstrated evidence.

The next step should not be R5 AI, OCR, or more surface expansion. The product thesis is the offline loop from source evidence to user-authored notes and deliberate review. That loop must pass the PRD Appendix A journey in an installed Windows build before later phases begin.

## 1. Product direction recovered from the documentation

Mereth Reader is a Windows-first, local-first research workspace for long and technical PDFs. Its defining loop is:

> Open a source → read and annotate → think in notes → deliberately remember → retrieve → review → return to the source.

The differentiation is not generic PDF chat, citation-management breadth, or a general-purpose notes graph. The distinctive mechanism is traceability: an exact source passage or figure becomes an annotation, then a user-authored thought, then—only by explicit user choice—a review prompt whose answer remains hidden until an attempt or skip.

The v1 release cut is R0–R4:

- PDF import, library, rendering, navigation, and honest progressive search;
- durable text and area annotations with version-aware anchors;
- source, concept, and scratch notes with evidence blocks and backlinks;
- explicit Remember-to-prompt flow, FSRS scheduling, source-hidden review, and repair;
- Markdown, clipboard, JSON backup, review CSV/TSV, and annotated-PDF-copy export;
- offline operation, recovery, accessibility, Windows integration, and clean-profile restore.

R5 local AI, R6 OCR, macOS/Linux packaging, and additional formats are deferred. They must not appear as incomplete v1 destinations or distract from release proof.

The intended visual world is the Modernist “Quiet Research Desk”: a flat three-zone reader, visible structural rules, square geometry, warm neutral surfaces, one red interface accent, Archivo typography, independently scrolling panes, and restrained motion. Reading and provenance outrank decoration.

## 2. Current implementation assessment

### What appears substantially implemented

Code and prior verification records show broad coverage of:

- Tauri 2, React, strict TypeScript, Rust, SQLite/FTS, migrations, and a fixed PDF corpus;
- PDF.js rendering, text layers, progressive indexing, search, outline/thumbnails, zoom, rotation, and reading-position persistence;
- annotation storage, selection snapshots, semantic categories, area capture, edit/trash/restore, embedded annotation import, and version anchoring;
- notes, revisions, templates, evidence blocks, links/backlinks, split-note workflows, and Quick Copy;
- review prompts, scheduling, queue controls, review sessions, repair, history work in progress, and synthesis;
- security controls, hostile-PDF checks, focus trapping, contrast utilities, resilient-state modeling, export helpers, and backup/restore utilities;
- the Modernist token layer, self-hosted Archivo, SVG icons, and many formerly missing UI surfaces.

This is meaningful progress. The repository is much further along than `README.md` claims.

### Blocking evidence found in this audit

1. **The Rust application does not compile.** `cargo test --manifest-path src-tauri/Cargo.toml --lib` fails in `src-tauri/src/lib.rs` around lines 536–583. The current uncommitted file contains truncated expressions such as `db.restore_annotation(&i`, malformed `purge_annotation` arguments, and a broken `db_get_annotation_assets` call.
2. **Frontend verification is unavailable in the present checkout.** There is no usable `node_modules`; direct TypeScript/Vitest execution therefore cannot start. `pnpm build` and `pnpm test` both fail before running with `unable to open database file`, which is an environment/tooling failure rather than proof of frontend correctness or failure.
3. **The working tree is large and uncommitted.** Twenty-eight tracked files are modified and new font/icon files are untracked. `src/main.tsx`, `src/styles.css`, and Rust database/command files have high-risk edits. The changes need to be divided into reviewable, verified units.
4. **Some checked tasks are not complete by their own notes.** U21 is checked while review-CSV and annotated-PDF exports are absent from the UI and atomic writes are unverified. U23 is checked while required display-scaling validation remains undone. U11, U19, and U20 cite TypeScript-only verification while their new Rust commands were not checked; the current Rust failure invalidates that confidence.
5. **The documentation conflicts with reality.** `README.md` still describes a static prototype that cannot open or persist PDFs. Conversely, `planned-task-list.md` sometimes presents code inspection or partial checks as completion.
6. **The implementation has design-system drift.** The detector found repeated undocumented font sizes and colors, non-zero radii despite the square-geometry rule, thick side accents, and a width transition. Some side-rule reports are false positives because visible structural rules are part of the Mereth brief, but the radius, type-ramp, color-token, and layout-animation findings require review.
7. **The design sidecar is stale.** `.impeccable/design.json` predates edits to `DESIGN.md`; generated ramps/snippets may contradict the current design authority.

### Architecture risks to reduce before release

- `src/main.tsx` is approximately 3,969 lines and mixes application orchestration with major destination views.
- `src/styles.css` is approximately 1,759 lines; U5 correctly identifies maintainability risk.
- `src-tauri/src/lib.rs` is approximately 1,307 lines and is vulnerable to merge/edit corruption at the command boundary.
- `src-tauri/src/db/mod.rs` is approximately 2,238 lines and should not continue accumulating unrelated domain behavior.
- The current change set mixes formatting, UI features, database APIs, recovery behavior, and design cleanup, making regressions hard to isolate.

These are not reasons for a broad rewrite. The correct response is incremental extraction after the green baseline is restored.

## 3. Corrected definition of pending work

### v1 release blockers

- Repair the current Rust syntax/call corruption and prove all local quality gates.
- Complete export UI coverage for review CSV/TSV and annotated-PDF copy.
- Implement and prove atomic export behavior, conflict handling, cancellation where operations can be long-running, and recovery after failure.
- Finish native File menu/open-controller verification in an installed build.
- Prove cold and warm Windows Explorer “Open with” behavior across spaces, Unicode, long paths, UNC paths, missing files, and duplicate activations.
- Add migration and purge regression coverage for recoverable Library removal and ownership rules.
- Finish first-paint gating and installed-corpus stress verification for renderer stability.
- Run the complete Appendix A journey offline in an installed Windows build.
- Run Windows reference-hardware performance benchmarks and record reproducible results.
- Prove the `release`-branch push trigger creates the downloadable NSIS artifact.
- Install and launch the artifact on a clean Windows 11 x64 machine.
- Replace the placeholder application/installer icon.
- Establish metric ownership without telemetry.
- Decide and execute release signing, or explicitly document unsigned pre-release distribution. Public production release remains blocked without the organization-owned certificate decision.

### Documentation and design blockers

- Reconcile every checked task with executable or manual evidence; reopen partial tasks.
- Rewrite `README.md` to reflect the actual product, current limitations, verified commands, and release status.
- Split `styles.css` by concern without changing visual behavior.
- Review detector findings against `DESIGN.md`; fix real token/type/radius/motion drift and document intentional exceptions.
- Remove R5-only AI controls from the v1 implementation, if any remain, and correct the local mock-up’s AI default when maintaining that reference.
- Refresh `.impeccable/design.json` with `$impeccable document` only as an explicit maintenance task.

### Deferred and explicitly not pending for v1

- Optional local AI and its runtime/model decisions.
- OCR-dependent text features.
- macOS and Linux packaging.
- EPUB, DjVu, mobile, sync, collaboration, citation plugins, or bibliography management.

## 4. Execution plan

### Phase 0 — Preserve and recover the working tree

**Goal:** create a trustworthy baseline without losing current work.

1. Save the current diff as a patch or work-in-progress commit on a dedicated recovery branch.
2. Compare each corrupted Rust region with `HEAD` and reapply only the intended changes: destination checks, recent review events, page-cache clearing, managed-document path reporting, annotation restore/purge/assets, and command registration.
3. Run `cargo fmt --check` early; syntax damage should fail before a full compile.
4. Restore pnpm operation. Inspect the pnpm store/config path and permissions, then run `pnpm install --frozen-lockfile` without changing the lockfile.
5. Run the baseline gate:

   ```text
   pnpm build
   pnpm test
   cargo fmt --manifest-path src-tauri/Cargo.toml --check
   cargo check --manifest-path src-tauri/Cargo.toml
   cargo test --manifest-path src-tauri/Cargo.toml --lib
   ```

6. Do not mark any feature task complete until the relevant frontend and Rust paths both pass.

**Exit criteria:** clean compilation, all automated tests green, no accidental generated files, and the working changes divided into understandable commits.

### Phase 1 — Re-audit task truth and test the new backend commands

**Goal:** make the plan trustworthy again.

1. Build a traceability table mapping every v1 acceptance criterion to code, automated test, manual test, and evidence document.
2. Reopen U11, U19, U20, U21, and U23 until their remaining clauses are demonstrated.
3. Add Rust tests for:

   - recent review history ordering, limits, missing prompts, and empty state;
   - page-cache deletion scoped to the requested document version;
   - managed-document destination resolution and confinement;
   - soft remove, restore, and permanent purge for open-in-place versus managed copies;
   - destination inspection for absent files, directories, binary data, large files, and permission failures;
   - annotation restore/purge/assets after the corrupted command path is repaired.

4. Add frontend integration tests for the UI-to-command contracts rather than relying only on utility tests or code inspection.
5. Update `planned-task-list.md` only after the commands and results exist.

**Exit criteria:** checked boxes mean demonstrated completion; partial work is labeled partial and remains unchecked.

### Phase 2 — Close the export and recovery loop

**Goal:** make PRD Appendix A steps 11–13 fully usable.

1. Offer all required export types in the UI: Markdown package, full JSON backup, review CSV/TSV, and annotated PDF copy.
2. Use the native destination picker; remove copy that says it is “optional until native picker is wired.”
3. Define one export job contract with typed progress, cancellation, destination conflict, atomic temporary-file/folder write, commit/rename, and cleanup.
4. Never overwrite the original PDF. Annotated PDF always creates a new copy.
5. Verify cancellation and disk-full/permission failures preserve the prior destination and database state.
6. Repeat the clean-profile restore drill using data produced through the actual UI.
7. Verify restored evidence links, review due state, source routes, revisions, assets, and provenance.

**Exit criteria:** steps 11–13 pass using the packaged application, including a deliberately interrupted export and a clean-profile restore.

### Phase 3 — Complete Windows integration and renderer proof

**Goal:** prove real installed behavior rather than source-level plausibility.

1. Unify File menu, Ctrl+O/Ctrl+W, empty-state buttons, Library actions, drag/drop, cold launch, and warm single-instance launch behind one typed controller.
2. Test installed Windows paths:

   - ordinary local path;
   - spaces and non-ASCII characters;
   - long-path prefix;
   - UNC path;
   - missing/moved file;
   - duplicate cold/warm route;
   - open-in-place and managed-copy ownership.

3. Add regression tests for activation ordering and document-scoped state clearing.
4. Implement the remaining first-paint gate: render the visible page before background indexing/hydration work can compete with it.
5. Stress the installed reader with the versioned corpus: 400-page book, large-vector file, malformed/encrypted/scanned PDFs, CJK, RTL, embedded annotations, forms/links, hostile JavaScript, and version changes.
6. Confirm bitmap success remains visible when text-layer extraction fails and that retry is page-local.

**Exit criteria:** tasks 6.9–6.12 have installed-build evidence and repeatable test notes.

### Phase 4 — Accessibility, responsive, and visual conformance gate

**Goal:** verify the Quiet Research Desk at the actual operating limits.

1. Test 1024×640 at Windows display scaling 100%, 150%, and 200%, and app text scaling 80%, 100%, and 150%.
2. Verify deterministic pane collapse, focus order, pane resizing/restoration, no unreachable reader controls, and no clipped modal actions.
3. Keyboard-walk the full Appendix A journey, including annotation creation, menus, dialogs, review, export, and restore.
4. Run screen-reader smoke tests for pages, annotation overlays, semantic labels, progress, errors, dialogs, and review reveal state.
5. Split CSS into tokens, base, shell, reader, panes, components/modals, destinations, responsive, and accessibility/motion modules. Preserve cascade order explicitly.
6. Resolve verified design drift:

   - zero radius except native radio indicators;
   - documented type sizes or an intentionally expanded type ramp;
   - documented semantic status colors/tokens;
   - no width/layout-property animation during pane resizing;
   - one-red-voice rule and flat persistent surfaces.

7. Re-run the design detector after the CSS/component pass and manually classify false positives.

**Exit criteria:** U5 and U23 are genuinely complete, WCAG-oriented workflows pass, and the implementation coherently expresses `DESIGN.md`.

### Phase 5 — Performance, packaging, and release candidate

**Goal:** produce an installable, evidence-backed Windows candidate.

1. On recorded reference hardware, measure cold/warm first readable page, selectable text readiness, annotation readiness, cached navigation, annotation visibility/durability, progressive search, zoom/rotation stability, background responsiveness, and memory.
2. Record corpus version, commit, hardware, Windows/WebView2 versions, cold/warm method, repetitions, median, worst result, and regressions.
3. Push the candidate to the `release` branch and verify the automatic workflow—not `workflow_dispatch`—builds and uploads the NSIS artifact.
4. Download that artifact into a clean Windows 11 x64 environment; install, launch, test file association, uninstall, reinstall, and restore backup.
5. Replace all placeholder icons and verify Windows shell/installer rendering at each size.
6. Map every PRD §19 metric to automated corpus evidence, local benchmark output, or a consented usability study. Do not add silent telemetry.
7. Resolve signing:

   - production: obtain an organization-owned code-signing certificate, keep secrets in GitHub, sign in CI, and verify the signature;
   - pre-release only: document the expected SmartScreen warning and do not claim production readiness.

8. Run the complete offline/no-model Appendix A journey and archive the result with the release commit.

**Exit criteria:** tasks 6.1 and 6.3–6.8 pass, every v1 checkbox has current evidence, and the artifact passes the complete journey.

### Phase 6 — Documentation reconciliation and release handoff

**Goal:** make the repository tell the truth.

1. Rewrite `README.md`; remove the obsolete “cannot open a PDF or persist anything” status.
2. Keep `PRODUCT.md` as durable product context and `reader-prd.md` as detailed requirements. Avoid duplicating volatile implementation status into either.
3. Keep `DESIGN.md` normative and update it only for intentional design decisions, not accidental implementation drift.
4. Convert `planned-task-list.md` from an archaeological narrative into:

   - current release gate;
   - evidence links;
   - concise completed history;
   - deferred roadmap.

5. Refresh the stale design sidecar through `$impeccable document` after `DESIGN.md` and the implementation agree.
6. Record known limitations and deferred work without exposing nonfunctional features in v1 navigation.

**Exit criteria:** a new contributor can determine what the product is, what is shipped, what is verified, and what remains without reconciling contradictory documents.

## 5. Recommended commit sequence

Keep each unit independently buildable and reviewable:

1. `fix(rust): restore annotation and asset command integrity`
2. `test(db): cover new review cache ownership and purge commands`
3. `feat(export): expose review and annotated-pdf exports`
4. `fix(export): make destination writes atomic and cancellable`
5. `test(launch): cover unified Windows activation routes`
6. `fix(reader): gate background work behind first paint`
7. `refactor(ui): split application orchestration and stylesheet concerns`
8. `fix(ui): reconcile implementation with Modernist design contract`
9. `test(release): add installed Windows acceptance evidence`
10. `docs: reconcile product status and release gates`

Do not combine global formatting with functional changes. The current Rust diff demonstrates why that makes corruption and review failures harder to detect.

## 6. Release evidence checklist

For every completed item, record:

- commit SHA and build identifier;
- exact command or manual procedure;
- operating system, hardware, scaling, and WebView2 version where relevant;
- corpus file or fixture version;
- expected and observed result;
- median/worst measurement for performance gates;
- artifact/log/report path;
- remaining limitations.

Minimum release artifacts:

- local build/test log;
- CI run URL and NSIS artifact identity;
- installed Windows path matrix;
- offline Appendix A journey report;
- performance report;
- accessibility/scaling matrix;
- security corpus report;
- backup/restore drill result;
- signing verification or explicit pre-release exception;
- final known-limitations document.

## 7. Decisions that still require the owner

These should not block repair and verification, but they need explicit product ownership:

1. **Release channel:** signed public production build or clearly labeled unsigned pre-release.
2. **Certificate procurement:** organization and budget for Windows code signing.
3. **Reference hardware:** exact Windows 11 x64 machine(s) for performance and scaling gates.
4. **Usability validation:** participants and protocol for the provisional open-in-place onboarding default.
5. **Brand asset:** final application icon artwork and installer imagery.
6. **Trademark/domain check:** still outstanding for “Mereth Reader.”

The old PRD question about the FSRS implementation should also be reconciled: the repository contains an FSRS scheduler decision report and implementation, so OQ-13 should either be marked resolved with that evidence or reopened with a specific remaining licensing/determinism issue.

## 8. Immediate next actions

1. Preserve the current work before editing.
2. Repair `src-tauri/src/lib.rs` and run Rust formatting/check/tests.
3. Restore pnpm dependency/tool operation and run frontend build/tests.
4. Reopen every checked task whose note contains “still open,” “remaining,” “pending,” or source-only verification.
5. Add backend and integration tests for the newly added commands.
6. Finish export/recovery before visual polish or packaging.
7. Execute installed Windows integration, performance, accessibility, and Appendix A gates.
8. Reconcile README, task status, PRD open questions, design sidecar, and release evidence.

