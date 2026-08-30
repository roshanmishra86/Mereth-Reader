# Mereth Reader

Mereth Reader is a local-first desktop workspace for reading technical PDFs.
It connects PDF passages and figure captures to source-linked notes, then lets
you explicitly turn selected ideas into review prompts. Core data is intended
to remain on the device; Mereth has no account or cloud-service dependency.

## Current status

**Pre-release software. Do not rely on it as the sole copy of important
research.** The repository contains an implemented reader, SQLite persistence,
annotations, notes, review, import/recovery flows, and Markdown/JSON export
paths. Those source-level capabilities are not a release validation result.

The current release gate has not been satisfied. In particular, this project
does not yet have recorded evidence for the complete installed Windows journey,
clean-profile restore, Windows path/activation matrix, accessibility and display
scaling checks, performance measurements, or a signed installer. The precise
evidence boundary and known limitations are in [RELEASE_STATUS.md](RELEASE_STATUS.md).

## Scope

The v1 target is the offline path from PDF evidence to user-authored notes and
deliberate review. Optional local AI, OCR, macOS/Linux packaging, EPUB/DjVu,
sync, collaboration, and citation-management breadth are deferred.

Scanned PDFs can be viewed and area-annotated, but OCR-dependent text search
and text annotations are outside v1.

## Prerequisites

- Node.js 24 (the CI configuration uses Node 24)
- pnpm 11.18.0 (the version pinned in `package.json`)
- Rust stable
- Tauri platform prerequisites, including WebView2 on Windows; see the
  [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

`pnpm` is the supported package manager. Use the committed lockfile; do not
substitute npm, Yarn, or Bun.

## Development

```bash
pnpm install --frozen-lockfile
pnpm tauri:dev
```

## Verification

Run the local gates before treating a change as demonstrated:

```bash
pnpm build
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

The repository defines a Linux quality workflow for the build, frontend tests,
Rust check, and Rust unit tests. A separate workflow is configured to build an
NSIS installer when the `release` branch is pushed. Configuration is not proof
of a current successful run or installer behavior; verify the relevant workflow
run and the downloaded artifact for a release candidate.

## Packaging

```bash
pnpm tauri:build
```

Tauri is configured to target an NSIS installer on Windows with per-user
installation and a PDF file association. The installer is unsigned unless and
until a signing process is added and verified; expect Windows trust warnings for
an unsigned pre-release build.

## Project references

- [reader-prd.md](reader-prd.md) — product requirements
- [PRODUCT.md](PRODUCT.md) — durable product context
- [DESIGN.md](DESIGN.md) — visual design authority
- [planned-task-list.md](planned-task-list.md) — implementation tasks and their evidence
- [PENDING_IMPLEMENTATION_PLAN.md](PENDING_IMPLEMENTATION_PLAN.md) — current recovery and release plan
- [RELEASE_STATUS.md](RELEASE_STATUS.md) — release evidence and known limitations
