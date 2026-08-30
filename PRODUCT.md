# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Mereth Reader is a Windows-first desktop application built with Tauri 2, React, strict TypeScript, Rust, and SQLite. `web` describes its rendered interface; it is installed and operated as a local desktop application rather than used in a browser tab. macOS and Linux follow in later phases.

## Users

Mereth serves students, researchers, engineers, writers, and independent learners who work through long or technical documents on a desktop. They need to preserve exact evidence, develop ideas in their own words, and deliberately choose what is worth remembering. The first release supports one local user, not a lab, class, or team.

## Product Purpose

Mereth preserves one coherent loop:

> Open a source → read and annotate → think in notes → deliberately remember → retrieve → review → return to the source.

Success means that reading remains calm and primary while every durable annotation, note, and review prompt can lead back to its evidence. The complete core journey works offline and without AI.

## Positioning

Mereth is a private, local-first research workspace: Zotero-quality reading and annotation interactions joined to source-grounded notes and deliberate retrieval practice, without citation-management breadth. Zotero is an interaction benchmark, not a visual template, storage specification, or feature target.

The product does not compete as a generic “chat with PDF” surface. Its distinctive mechanism is the traceable transition from source evidence to a user-authored thought and then, only by explicit choice, to source-revealed review.

## Operating Context

- Offline-capable, keyboard-heavy desktop use with large and technical PDFs.
- A minimum supported window of 1024 × 640 CSS pixels.
- Windows display scaling from 100% through 200%, with app-text scaling independent of document zoom.
- A restrained three-zone reader: collapsible source navigation, page canvas, and annotation or note pane.
- Local files and an application-owned SQLite database; original PDFs are not modified by default.
- Open exits through Markdown, clipboard, JSON backup, and annotated-PDF copies where supported.

## Capabilities and Constraints

### v1 release gate: R0–R4

R0 through R4 remain the complete v1 gate. They cover PDF architecture and corpus proof; import, library, rendering, navigation, and progressive text search; durable annotations; source and concept notes with backlinks; user-approved retrieval prompts and scheduled review; and portable export and recovery. A v1 build is not complete until the non-AI journey passes with the network disabled and no model installed.

Key constraints remain:

- Born-digital PDF is the v1 document format. Scanned PDFs remain viewable and area-annotatable, but OCR-dependent text features are not implied.
- Source text, user-authored text, and future model-generated text have distinct provenance and presentation.
- A highlight never becomes a review prompt automatically, and review conceals the answer until an attempt or deliberate skip.
- Search indexing is progressive; the interface must communicate partial coverage rather than presenting incomplete results as complete.
- An annotation selection action must use a captured, immutable selection snapshot so popup, context-menu, and keyboard paths create the same durable result.
- Reversible actions, stable identifiers, version-aware source anchors, and non-destructive export are required trust boundaries.

### Later phases

Later direction includes optional local AI, Reading Mode, Read Aloud, tabs and split reading, smart reference and figure previews, OCR, additional document formats, macOS, Linux, and cross-device continuity. These are directional commitments, not v1 acceptance criteria or disabled promises in v1 navigation.

Accounts, sync transport, cloud voice, collaboration architecture, and the precise cross-device model are intentionally unspecified until their phases are designed. Citation libraries, bibliography generation, scholarly metadata management, group libraries, and word-processor citation plugins remain out of scope.

## Brand Commitments

- **Quiet Research Desk:** the application should feel like a focused place to read, mark evidence, think, and return—not a dashboard competing for attention.
- **Local-first trust:** useful core behavior requires neither an account, a network connection, nor a model runtime.
- **Source traceability:** evidence remains recoverable from notes, prompts, exports, and review.
- **Deliberate memory:** the user decides what enters review; the product avoids streak pressure and gamified urgency.
- **Restrained hierarchy:** content, provenance, and focused reading outrank decorative interface chrome.
- **Modernist identity:** the supplied Modernist mock-up is the normative visual reference for future interface work.

## Evidence on Hand

- `reader-prd.md`: product scope, decisions, requirements, risks, and phased roadmap.
- `planned-task-list.md`: implementation sequence, acceptance gates, completed verification notes, and remaining work.
- `mock-up/Reader Prototype.dc.html`: ignored interaction and layout reference; some future-facing surfaces are not v1 commitments.
- `mock-up/_ds/modernist-*/readme.md` and `styles.css`: ignored Modernist design-system evidence and visual tokens.
- Existing source, tests, and decision records: implementation evidence, not proof of market demand or user outcomes.

No validated usage metrics, testimonials, customer logos, adoption claims, or learning-outcome guarantees are on hand. Future product work must not fabricate them.

## Product Principles

1. **Reading remains primary.** Secondary tools appear when invoked and recede when not needed.
2. **Selection becomes durable quickly.** Capture once, then route popup, context menu, and keyboard actions through the same immutable evidence.
3. **Evidence is always recoverable.** Notes, prompts, search results, and exports preserve a route to the exact source context.
4. **Index progressively and speak honestly.** Prioritize the active page, expose coverage, persist version-keyed page text, and never imply that partial search is complete.
5. **Make consequential actions deliberate and reversible.** Fast capture must not become silent commitment, destructive mutation, or irreversible scheduling.
6. **Maintain keyboard parity.** Every core pointer workflow has an equivalent visible, focus-safe keyboard route.
7. **Earn value without AI.** AI may assist later, but it never owns reading, notes, review, search, or export.
8. **Avoid citation-manager scope creep.** Adopt proven reader interactions without inheriting bibliography, library-group, or word-processor integration breadth.

## Accessibility & Inclusion

Mereth targets WCAG-oriented contrast and interaction practices: visible focus, complete keyboard access, descriptive screen-reader labels, reduced-motion support, and semantic states that do not rely on color alone. Annotation categories pair color with a user-visible label. Layouts must remain operable at the 1024 × 640 minimum window, at Windows scaling from 100–200%, and with application text scaling from 80–150%. PDF page zoom and interface-text scale remain independent.
