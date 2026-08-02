# Mereth Reader

> **Work in progress — not ready for day-to-day use.** This is an early scaffold, not a usable reader. It cannot open a PDF, store an annotation, or persist anything yet. Do not adopt it for real reading or note-taking. See [Status](#status) for what actually works.

A calm, local-first desktop PDF reader where annotations become source-linked notes, selected ideas become user-approved retrieval prompts, and nothing leaves your machine.

The product loop is: open a source → read and annotate → write notes in your own words → choose what is worth remembering → attempt recall before revealing the source → review at a useful interval → export in open formats.

- `reader-prd.md` — product requirements (Draft v0.2)
- `planned-task-list.md` — audited status and the implementation sequence
- `mock-up/` — Modernist design system and UI mockups (local only, not in version control)

## Status

**Early scaffolding.** The desktop shell builds and runs. Almost nothing behind it is real yet.

| Area | State |
| --- | --- |
| Toolchain, build, tests, Tauri shell | Working |
| PDF rendering | Not started — `pdfjs-dist` is installed but unused |
| Persistence (SQLite) | Not started — no schema, no migrations, no Rust commands |
| Annotations, notes, review, export | Not started |
| UI | Static prototype — hard-coded sample content, no real state |

The UI currently displays placeholder counts ("41 annotations", "12 due") that are not backed by anything. Treat every number on screen as fictional until the corresponding task is checked off in `planned-task-list.md`.

## Scope decisions

- **pnpm is the only supported package manager.** Do not use npm, yarn, or bun.
- **Tauri 2 + React + Vite + Rust**, superseding the Electron proposal in the original PRD. Security follows Tauri's capability model (PRD §15.3), not Electron's.
- **AI is out of v1.** The PRD's own recommended release cut (§18.1) is through R4 — reader, notes, and review — without AI. AI surfaces visible in the UI are placeholders representing the off state, not a feature commitment. Work on them starts only after the completion gate in `planned-task-list.md` is met.
- **Windows first**, Linux validated locally. macOS and mobile are not on the roadmap; mobile is an explicit PRD non-goal.
- **Local-first, always.** No cloud service, account, telemetry, or network dependency for any core feature.

## Prerequisites

- Node.js 22+ and pnpm 11+
- Rust stable, plus the platform prerequisites in the [Tauri guide](https://v2.tauri.app/start/prerequisites/) — WebView2 on Windows, WebKitGTK on Linux

## Commands

```bash
pnpm install       # install dependencies (uses the committed lockfile)
pnpm tauri:dev     # run the desktop app
pnpm tauri:build   # produce a native installer
pnpm build         # typecheck + build the frontend only
pnpm test          # unit tests (vitest)
```

`pnpm tauri:build` produces an NSIS setup `.exe` on Windows, installed per-user. Linux builds use the same configuration; install the Linux system dependencies from the Tauri prerequisites first.

## CI

Every push runs `.github/workflows/windows-build.yml` on `windows-latest`, building the NSIS installer and uploading it as the `MerethReader-Windows-NSIS` artifact.

This workflow has **never successfully run** — the repository has no commits yet. A faster typecheck/test/`cargo check` job is planned so type errors fail in minutes rather than after a full installer build.

Code signing is deliberately absent. Unsigned installers show Windows trust warnings until a certificate and signing policy are supplied.

## Working notes

- The application icon in `src-tauri/icons/` is a placeholder generated to unblock compilation. It is not branding.
- The bundle identifier is `dev.mereth.reader`. It fixes the application data directory, so treat it as frozen from the first release — changing it later strands user data.
- `mock-up/` is intentionally excluded from version control. It is the design source of truth and exists only locally, so it is not backed up by the remote. Keep a separate copy.
- Before marking any task complete in `planned-task-list.md`, demonstrate its acceptance criteria. Code existing is not the same as a task being done.
