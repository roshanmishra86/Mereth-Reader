# Evaluation Note: pdf-inspector (R0 corpus work)

## Status
**EVALUATED — adoption deferred to R6 (OCR routing).** Recorded so the decision is made before later tasks rely on it, per the implementation plan's Decisions section ("evaluate [pdf-inspector] during the R0 corpus work before relying on it in later tasks").

## What it is
`pdf-inspector` ([firecrawl/pdf-inspector](https://github.com/firecrawl/pdf-inspector), MIT) is a Rust library with Python, Node.js (napi), and WebAssembly bindings for local PDF classification and text extraction without OCR. It classifies a PDF as `TextBased` / `Scanned` / `ImageBased` / `Mixed` in ~10–50 ms by sampling content streams, returns per-page `pages_needing_ocr` for routing, and extracts position-aware text to Markdown. It is local-first, MIT-licensed, and makes no network call — compatible with PRD §15.3 and §15.5.

## Evaluation against Mereth Reader's needs
- **v1 (R0–R4) has no feature that uses it.** Rendering, text extraction for search, and selection are handled by PDF.js (R0.2). OCR is explicitly R6 (PRD §18, §4.1). Adding an unused dependency now would violate the §15.3 posture ("no permission/dependency that no feature uses").
- **R6 fit:** the import pipeline needs to detect scanned/image-only PDFs to (a) show the v1 "no text search/highlights for scanned PDFs" limitation (task 7.2) and (b) route pages to the OCR runtime when it exists. `pdf-inspector`'s `TextBased`/`Scanned`/`Mixed` classification plus `pages_needing_ocr` matches that need, and its Node binding is usable from the Tauri Rust side or a sidecar.
- **Overlap risk:** it is a second PDF parser alongside PDF.js. At R6, re-evaluate whether its classification adds enough over PDF.js's own text-layer-presence detection to justify a second parser, and compare its classification against the corpus's `scanned_page` (empty text layer), `large_book_400p` (text-based), and `malformed_object` (recoverable) fixtures.
- **Security/supply chain:** MIT, local, no network. A `lopdf` nesting-depth DoS (RUSTSEC-2026-0187) was fixed in the 0.2.x line; pin a fixed version if adopted.

## Decision
Defer adoption to R6. At R6, run `pdf-inspector` against the §17.5 corpus, record classification accuracy vs. PDF.js text-layer detection, and decide then. It is **not** added to `package.json` in v1 because no v1 feature consumes it.
