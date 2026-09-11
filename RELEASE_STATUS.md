# Release status and evidence

**Status: v0.1.4 published for personal use; production readiness not established.** This file records what is supported by repository
evidence, not what an unrun build, workflow, or installed application might do.

## v0.1.4 review on 2026-09-11

The maintainer confirmed Windows testing of the changes since v0.1.3, including
saving/reopening notes, review scheduling, and backup restore, and authorized
the next personal-use release after automated checks. This is reported manual
evidence; a clean-machine test of the final installer has not been independently
observed here. Windows code signing remains unconfigured; updater signatures
are a separate mechanism.

Review found and reproduced an unhandled rejection from the internal completion
promise when a queued note save failed. The fix preserves the caller's error
while handling the internal promise; its regression test failed before the fix
and passed afterward. Rust formatting has been normalized, and CI now checks it.

Release notes: [v0.1.4](docs/releases/v0.1.4.md).

Automated verification on Linux/WSL with Node 24.18.1 and pnpm 12.3.4:

- Frozen-lockfile dependency installation passed.
- TypeScript checking and the Vite production build passed.
- All 651 frontend tests across 86 files passed, including the new regression.
- Rust formatting and the locked Rust compilation check passed.
- All 102 Rust library tests passed on v0.1.4.
- The two-process note recovery probe passed with a 262.53 ms median autosave
  latency for its atomic-file/fsync adapter. It does not measure Tauri/SQLite.

Release commit: `085cf589d1d23d38fc14ef5af1073ad97848b5e9` (tag `v0.1.4`).

- [Quality workflow](https://github.com/roshanmishra86/Mereth-Reader/actions/runs/34584190948) passed.
- [Windows installer workflow](https://github.com/roshanmishra86/Mereth-Reader/actions/runs/34584208115) passed, including draft updater-asset validation.
- Downloaded installer: `Mereth-Reader_0.1.4_x64-setup.exe`, 6,510,647 bytes.
- Installer SHA-256: `45d02c5f161405b3af1bc24fc3a2d7badc666c5ee80b68e221b34137139e8bb1`, matching GitHub's asset digest.
- The downloaded installer signature was cryptographically verified using
  `minisign-verify` 0.2.5 against the public key in `tauri.conf.json`. The manifest
  version and signature matched the installer assets.
- [v0.1.4 was published](https://github.com/roshanmishra86/Mereth-Reader/releases/tag/v0.1.4)
  on 2026-09-11 at 09:36:14 UTC as the latest personal-use release.

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
