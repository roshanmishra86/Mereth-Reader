# Release status and evidence

**Status: not release-ready.** This file records what is supported by repository
evidence, not what an unrun build, workflow, or installed application might do.

## Evidence available in the repository

- The application is configured as a Tauri 2 + React + Rust desktop app with
  SQLite-backed data, a local PDF reader, annotations, notes, review, and
  export/restore command paths.
- `package.json` defines frontend build/test and Tauri development/build scripts.
- `.github/workflows/quality.yml` defines build, frontend test, Rust check, and
  Rust unit-test jobs.
- `.github/workflows/windows-build.yml` is configured to build an NSIS installer
  and attach it to a GitHub Release when a matching `vMAJOR.MINOR.PATCH` tag is
  pushed.
- `src-tauri/tauri.conf.json` configures a per-user NSIS bundle and a PDF file
  association.

These are source and configuration facts. They do **not** establish that the
installed product behaves correctly on Windows.

## Local verification on 2026-08-29

- TypeScript typechecking and the Vite production build passed.
- The frontend suite passed 436/436 tests. Three corpus suites require Node
  subprocess execution and were rerun outside the restricted sandbox.
- `cargo check` and all 85 Rust library tests passed.
- The crate-wide `cargo fmt --check` gate remains red because older Rust files
  outside this change set do not match the current formatter. This is still a
  repository quality-gate blocker; it was not hidden behind a global formatting
  rewrite mixed into the functional changes.

## Release evidence still required

- All local quality gates pass on the release commit.
- The tag-driven release workflow produces a GitHub Release with a downloadable
  NSIS installer.
- That artifact installs, launches, opens PDFs through Windows Explorer in cold
  and warm activation paths, and survives uninstall/reinstall testing on clean
  Windows 11 x64.
- The PRD Appendix A offline journey passes end to end, including export and a
  clean-profile restore.
- Windows display scaling, accessibility, corpus stress, and performance checks
  are recorded with their environment and results.
- A signing decision is made. A public production release requires an
  organization-controlled certificate and successful CI signing verification.

## Known product limitations

- This is pre-release software; maintain independent backups of source PDFs and
  research data.
- Review CSV/TSV are exposed through the native destination picker.
  Annotated-PDF copy is listed but unavailable because no native writer command
  exists yet.
- Export cancellation/progress and atomic-write behavior have not been proven.
- OCR-dependent text search and text annotations are unavailable for scanned
  PDFs; viewing and area capture are the intended fallback.
- Optional local AI, macOS/Linux packaging, other document formats, sync, and
  collaboration are deferred and must not be represented as shipped v1 features.
- No validated production signing path exists. Unsigned Windows pre-release
  installers may trigger trust warnings.

## Updating this record

Change a claim from pending to verified only with a reproducible command result,
workflow URL/run identifier, or dated manual-test record tied to a commit and
environment. Do not infer Windows, signing, CI, or release success from source
configuration alone.
