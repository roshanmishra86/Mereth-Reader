# Mereth Reader PRD

**Document status:** Draft v0.3
**Date:** 28 July 2026; amended 1 and 4 August 2026
**Product name:** Mereth Reader (resolved — see §21 OQ-1)  
**Initial platform:** Windows desktop  
**Later platforms:** macOS, then Linux  
**Scope:** Clean PDF reading, source-grounded notes, and internal review in v1; optional local AI in R5


> **Amendment note (1 and 4 August 2026).** The desktop shell is **Tauri 2 + Rust**, not Electron (§1.6, §15.2, §15.3, §18, RK-11, RK-12, OQ-4), and the product name is **Mereth Reader** with the `mereth://` deep-link scheme (§2.3, §14.2, OQ-1). The release scope is also explicit throughout this document: **v1 ends at R4 and contains no AI runtime or AI-dependent feature**. Optional local AI is R5 work and begins only after the non-AI completion journey passes. The 4 August amendment also adds staged performance validation, versioned corpus expectations, resilient-state requirements, and explicit product decisions that must be resolved before their dependent work begins.

---

## 0. Decision summary

Build a separate, local-first reader rather than embedding PDF features in Cabin.

The first complete product is:

> A calm Windows PDF reader where annotations become high-quality notes, selected ideas become user-approved retrieval prompts, and every AI feature can be turned off without weakening reading, notes, review, search, or export.

The application has its own executable, repository, database, data directory, installer, and roadmap.

### 0.1 Core product loop

```text
Open a source
      ↓
Read and annotate
      ↓
Turn selected evidence into notes in the user’s own words
      ↓
Choose what is worth remembering
      ↓
Attempt retrieval before revealing the source
      ↓
Review again at a useful interval
      ↓
Export notes, prompts, and annotated documents in open formats
```

AI can assist at several arrows. It never owns the loop.

### 0.2 Corrected name

The note and memory ideas in the request refer to **Andy Matuschak**. His work is a useful design reference for retrieval prompts, mnemonic media, and evergreen notes. It is not a product specification and should not be treated as settled cognitive science.

---

## 1. Research findings

### 1.1 Zotero is the interaction benchmark, not the full product template

Zotero’s current reader provides several proven interaction patterns:

- select text, then choose a colour to highlight or underline;
- keep annotations in a sidebar;
- add all or selected annotations to a note;
- drag annotations into notes;
- retain links from a note back to the source page;
- include citations with inserted annotations;
- store annotations separately from the original PDF;
- export a copy of the PDF with annotations embedded.

These behaviors are documented in the [Zotero PDF Reader and Note Editor guide](https://www.zotero.org/support/pdf_reader) and its explanation of [database-backed annotations and portable export](https://www.zotero.org/support/kb/annotations_in_database).

**Product consequence:** adopt the tight annotation → note → source-page loop. Do not copy Zotero’s citation-library breadth, sync model, panes, or research-group features into v1.

### 1.2 Retrieval practice and spacing are the evidence-backed core

The strongest basis for an internal review system is not “AI tutoring.” It is:

- attempting to retrieve before seeing the answer;
- spacing retrieval attempts over time;
- revealing accurate source feedback after an attempt.

Roediger and Karpicke found better delayed retention after retrieval practice than repeated restudy, even when restudy produced more confidence: [Test-Enhanced Learning](https://pubmed.ncbi.nlm.nih.gov/16507066/). A quantitative review found a broad spacing effect across verbal recall research: [Cepeda et al. 2006](https://doi.org/10.1037/0033-2909.132.3.354). Retrieval practice has also outperformed elaborative concept mapping in a well-known study of science text learning: [Karpicke & Blunt 2011](https://pubmed.ncbi.nlm.nih.gov/21252317/).

**Product consequence:** the source is concealed during an attempt and revealed afterward. Highlighting and rereading remain useful reading actions but are not counted as review.

### 1.3 Matuschak contributes interaction and prompt-design heuristics

Matuschak’s prompt guide frames prompt writing as task design and recommends prompts that are focused, precise, consistent, tractable, and effortful: [How to write good prompts](https://andymatuschak.org/prompts/). His evergreen-note practice emphasizes notes that are concept-oriented, linked, and useful across projects: [Evergreen notes](https://notes.andymatuschak.org/Evergreen_notes).

These are thoughtful heuristics, partly connected to research and partly based on practice. Matuschak explicitly notes where exact prompt-writing guidance extends beyond the evidence.

**Product consequence:** provide coaching and linting for prompt quality, but do not force one note method or claim that “atomic notes” are scientifically optimal.

### 1.4 “Deep memorisation” is an aspiration, not a guarantee

No application can guarantee deep understanding or durable memory. It can create good conditions:

- deliberate selection of what is worth remembering;
- active recall rather than recognition;
- accurate feedback from the source;
- spaced scheduling;
- prompt revision when a card repeatedly fails;
- application and explanation prompts, not only fact cards.

The success claim must remain “supports durable learning,” not “makes you remember everything.”

### 1.5 A local LLM must not grade understanding

A small local model can draft questions, extract structure, reformat notes, retrieve passages, and explain a selected excerpt. It cannot reliably determine that a user’s explanation is conceptually correct across arbitrary technical material. Fluent grading is especially dangerous because it can validate misconceptions.

**Product consequence:** the user compares their answer with the source. AI may ask a follow-up question, but it does not award correctness, mastery, or a knowledge score.

### 1.6 “Native Windows” and later cross-platform support need a precise meaning

A literal WinUI/Windows App SDK implementation would maximize Windows-native widgets but create a second implementation for macOS and Linux. That conflicts with the stated cross-platform future and the project’s desktop-shell constraint.

**Decision:** “native Windows application” means a locally installed Windows desktop application with:

- a signed installer;
- file associations and “Open with” support;
- native file dialogs, menus, shortcuts, and notifications;
- offline filesystem access through a secure desktop process;
- no browser tab and no required web service.

Use Tauri 2, React, strict TypeScript, Rust, and SQLite. The UI is web-rendered inside a desktop shell; it is not WinUI. If literal native controls are non-negotiable, the cross-platform roadmap and project rules must be revisited before implementation.

Tauri renders through the operating system's own webview — WebView2 on Windows, WebKitGTK on Linux, WKWebView on macOS. Two consequences follow and are accepted deliberately:

- Installer size and memory footprint are materially smaller than a bundled-Chromium shell, which suits the 8 GB AI-off reference profile in §17.1.
- Rendering is **not** identical across platforms, because each OS ships a different webview engine. The PDF.js corpus gate in §8.1 must therefore be re-run per platform rather than once, and the R7/R8 ports in §18 must budget for renderer differences rather than assuming parity.

---

## 2. Product vision

Create the quietest useful bridge between reading and durable knowledge.

The Reader should make three transitions unusually good:

1. **Source → annotation:** fast, precise capture without losing reading flow.
2. **Annotation → thought:** clear separation between what the source said and what the user thinks.
3. **Thought → memory:** deliberate, source-linked retrieval practice with manageable scheduling.

### 2.1 Product promise

> Read without clutter. Think in your own words. Return to the exact evidence. Remember only what you deliberately choose.

### 2.2 Differentiation

The product does not win by having a generic “chat with PDF” panel. It wins through:

- a reader that remains excellent with AI off;
- Zotero-quality annotation-to-note flow without becoming a citation manager;
- explicit source/user/AI provenance;
- a review system embedded in the reading workflow;
- local-only models with visible controls;
- open, high-fidelity export.

### 2.3 Name

**Resolved (1 August 2026): the product is Mereth Reader.**

The name is carried consistently by `productName`, the bundle identifier `dev.mereth.reader`, the `mereth-reader` repository and package, the Cargo crate, the window title, and the CI artifact. The bundle identifier fixes the application data directory, so it is treated as frozen from the first release onward — changing it later would strand user data.

The deep-link scheme is `mereth://` (§14.2).

Residual work this decision does not settle: trademark and domain checks, and whether "Reader" in the name reads awkwardly if EPUB and DjVu arrive under §18 R9. Neither blocks implementation. The name does not use "Cabin."

---

## 3. Users and jobs

### 3.1 Primary user

A student, researcher, engineer, writer, or independent learner who reads long or technical PDFs on a desktop, wants better notes than a highlight dump, and values privacy and offline access.

The first release is for one local user. It is not designed for a lab, class, or team.

### 3.2 Jobs to be done

| # | Job | Common failure | Product answer |
| --- | --- | --- | --- |
| J1 | Open a PDF and reach the useful page quickly | Heavy library UI delays reading | Fast open, recents, outline, thumbnails, full-text search |
| J2 | Mark a passage without losing context | Annotation controls interrupt reading | Selection popover, keyboard shortcuts, locked highlight mode |
| J3 | Know what the source said versus what I thought | Quotes and comments blend together | Immutable source excerpt plus separate user comment |
| J4 | Build a useful note from scattered annotations | Export becomes a chronological dump | Drag annotations into a structured source or concept note |
| J5 | Return from a note to the evidence | Page references are dead text | Stable page/annotation deep link and visible source context |
| J6 | Remember a selected concept | Highlighting feels productive but is passive | User-approved retrieval prompt with source reveal and spacing |
| J7 | Ask for help without uploading private material | Cloud PDF chat leaks content or requires an account | Optional local, scoped, source-cited assistance |
| J8 | Leave with portable work | Notes and highlights are locked in a database | Markdown, clipboard, JSON backup, and annotated-PDF copy |

---

## 4. Scope

### 4.1 Windows v1 scope

- Born-digital PDF import, library, rendering, navigation, and search.
- Highlights, underlines, area captures, comments, tags, and annotation sidebar.
- Document source notes and standalone concept notes.
- Source backlinks and note backlinks.
- Internal retrieval prompts and scheduled reviews.
- Markdown/clipboard/JSON export.
- Exported PDF copy with embedded annotations, subject to the rendering spike.
- Secure, local, single-user storage.

Optional local AI for bounded, source-grounded actions is **R5, after v1**. Its absence must not leave disabled primary actions, empty navigation destinations, or a degraded core workflow.

### 4.2 Explicit non-goals for v1

- Cabin tasks, calendar, time blocks, Pomodoro, focus audio, or shutdown.
- Cloud accounts, sync, collaboration, or shared libraries.
- Full Zotero-compatible citation management.
- Word/LibreOffice/Google Docs citation plugins.
- Direct writes into an Obsidian vault; Quick Copy and user-chosen Markdown export are the v1 handoff.
- Web capture or browser extension.
- Automatic scholarly metadata lookup requiring a network.
- Automatic AI grading of explanations.
- AI-written notes silently presented as the user’s thought.
- EPUB, DjVu, or web articles.
- Mobile or tablet clients.
- Handwriting recognition.
- Editing PDF page content, rearranging pages, or filling complex forms.
- Any AI runtime, model download, semantic index, or AI-authored feature surface. These begin in R5 after the v1 completion gate.

### 4.3 Later candidates

- OCR for scanned PDFs.
- Ink/freehand annotation and image occlusion.
- EPUB, then DjVu.
- macOS, then Linux.
- Optional Anki package export.
- Citation-style rendering from user-supplied metadata.
- Cross-document comparison and local semantic search.

Later candidates do not shape the v1 navigation unless a cheap architectural decision is required now.

---

## 5. Product principles

These principles are ordered.

1. **Reading remains primary.** Notes, review, and AI appear when invoked and disappear completely.
2. **Source fidelity is inviolable.** Quotes remain byte-for-byte traceable to extracted or OCR text and always retain a page anchor.
3. **Three voices never blur.** Source text, user-authored text, and model-generated text have distinct storage and presentation.
4. **AI off is a complete product.** Reading, annotations, notes, text search, review, and export work with no model files installed.
5. **The user chooses what enters memory.** No highlight automatically becomes a review prompt.
6. **Retrieval comes before reveal.** Review does not show the answer or source context until the user attempts recall or deliberately skips.
7. **Friction is proportional.** Capturing a highlight is fast; committing something to long-term review is deliberate.
8. **Open formats are exits, not afterthoughts.** The user can leave with readable notes and annotations.
9. **Offline is the default trust boundary.** No document text, note, prompt, or embedding leaves the machine.
10. **No gamified pressure.** No streak loss, confetti, shame, or infinite backlog alarm.
11. **Corruption is worse than inconvenience.** Never modify the original PDF by default; export a new annotated copy.

---

## 6. Information architecture

The application has five top-level destinations:

| Destination | Purpose |
| --- | --- |
| **Library** | Recent and saved documents, collections, import, search |
| **Reader** | Document canvas with optional outline, annotation, and note panes |
| **Notes** | Source notes and concept notes across documents |
| **Review** | Due retrieval prompts, prompt editing, review history |
| **Settings** | Appearance, reading, annotations, review, storage, export, privacy, shortcuts; R5 adds AI and models |

There is no Tasks, Calendar, Focus, Music, or Chat destination.

### 6.1 Reader layout

The reading surface uses a restrained three-zone layout:

```text
┌──────────────────────────────────────────────────────────────────┐
│ document title     page / search      view controls        status │
├──────────────┬───────────────────────────────────┬───────────────┤
│ outline or   │                                   │ annotations   │
│ thumbnails   │          page canvas              │ or note       │
│ collapsible  │                                   │ collapsible   │
└──────────────┴───────────────────────────────────┴───────────────┘
```

Both side panes collapse independently. A reading-only command hides all chrome except a transient page indicator. In R5, opening AI must never shrink the page into a narrow strip; it temporarily reuses the right pane rather than adding a sixth top-level destination.

### 6.2 Review is not mixed into Library

Library may show a small “reviews due” count. The full review queue is a separate destination so opening a document does not become a forced study session.

---

## 7. Document library and import

### 7.1 Requirements

**FR-7.1 — Open quickly.** Support file picker, drag-and-drop, Windows file association, and command-line open. The first page becomes visible before full text indexing completes.

**FR-7.2 — Two ownership modes.**

- **Open in place:** retain the original path and fingerprint. Best for ad hoc reading; the UI warns that moving or replacing the file can break access.
- **Add to managed library:** copy the original into the Reader’s data directory and preserve its original filename and source path as metadata.

The user chooses; import never silently moves the source file.

**FR-7.3 — Fingerprint and version.** Record a cryptographic file fingerprint, page count, and page geometry. If the path later contains different bytes, treat it as a new version and offer re-anchoring rather than attaching old annotations blindly.

**FR-7.4 — Metadata.** Extract embedded title, author, subject, keywords, creation date, DOI, and ISBN when present. Every field is editable. Do not query an online metadata service in v1.

**FR-7.5 — Minimal organization.** Support favourites, collections, tags, recents, and archive. Do not reproduce a full bibliographic item tree.

**FR-7.6 — Background work.** Text extraction, thumbnail generation, and indexing are visible, cancellable jobs. Reading remains available while they run.

**FR-7.7 — Duplicate handling.** Fingerprint duplicates are not copied again without confirmation. The user may create another library reference to the same managed file.

### 7.2 Acceptance criteria

- A PDF can be read without adding it to the managed library.
- Reopening restores page, zoom mode, and scroll position.
- Moving an in-place file produces a recoverable locate-file flow.
- Replacing a file never silently reuses incompatible coordinates.
- Cancelling indexing does not corrupt the document record.

---

## 8. Reader canvas

### 8.1 Rendering strategy

Use PDF.js in a sandboxed renderer. PDF.js is a Mozilla-supported, web-standards PDF parsing and rendering platform with a reusable display layer and viewer foundation: [official PDF.js project](https://github.com/mozilla/pdf.js) and [getting-started architecture](https://mozilla.github.io/pdf.js/getting_started/).

PDF.js is the initial decision because it matches the web-rendered shell and cross-platform goals. It is not accepted blindly. R0 must test:

- graphics-heavy and malformed documents;
- large technical books;
- text selection in multi-column layouts;
- annotation overlays and saved copies;
- memory behavior during long continuous scroll;
- accessibility of the text layer.

If it fails the agreed corpus, compare PDFium before implementation proceeds. MuPDF is not the default because its AGPL/commercial licensing requires a separate product decision.

### 8.2 Requirements

**FR-8.1 — Navigation.** Outline, thumbnails, page number, page labels, history back/forward, named destinations, and links.

**FR-8.2 — View modes.** Single page, continuous vertical, facing pages, fit width, fit page, custom zoom, rotate view, and presentation/fullscreen.

**FR-8.3 — Search.** Case-sensitive option, whole word, diacritic-tolerant default, result count, snippets, and keyboard traversal. Search uses deterministic extracted text, not AI.

**FR-8.4 — Selection fidelity.** Copy preserves reading order as far as the source text layer permits. Multi-column or broken extraction is visibly marked when confidence is low.

**FR-8.5 — Calm chrome.** Controls appear on keyboard intent, explicit pointer movement to the toolbar, or pane invocation—not whenever the pointer crosses the page.

**FR-8.6 — Appearance.** Light, dark application chrome, and page-dimming controls. Do not invert page colours by default because inversion damages figures and colour-coded material.

**FR-8.7 — Keyboard first.** Navigation, search, pane toggle, zoom, highlight colours, note, Remember action, and reading-only mode have documented shortcuts.

The complete shortcut map is discoverable from Settings and from relevant control tooltips. A shortcut that is unavailable because of the current document or view explains why rather than failing silently.

**FR-8.8 — Link safety.** External links show the target and require an explicit OS-browser handoff. PDF JavaScript, automatic launches, network fetches, and embedded executables are disabled.

### 8.3 Acceptance criteria

- Every core reading action is available without a mouse.
- A document containing PDF JavaScript renders without executing it.
- Search remains usable before optional AI is installed.
- Rotating or zooming the view does not displace annotations.
- The page stays comfortably readable at the minimum supported window size.
- Copying from representative single- and multi-column corpus documents preserves reading order where the source permits it; low-confidence extraction is visibly disclosed before copy.
- Core reader actions remain reachable at 100%, 125%, 150%, and 200% Windows display scaling without clipped controls or inaccessible panes.

---

## 9. Annotations

### 9.1 Storage decision

Store Reader-created annotations in SQLite rather than mutating the original PDF. This follows the useful part of Zotero’s model: annotation records can be tagged, searched, linked to notes, and exported later while the original stays intact.

An exported annotated PDF is a new file. The database remains the editable source of truth for Reader-native annotations.

### 9.2 Requirements

**FR-9.1 — Annotation types.**

- text highlight;
- underline;
- area/image capture;
- anchored comment without a text highlight;
- bookmark.

Freehand ink is later unless R0 proves it cheap and reliable.

**FR-9.2 — Fast creation.** Selecting text opens a compact colour/comment popover. A locked tool mode supports repeated highlights or underlines. Area capture has a single drag action.

**FR-9.3 — Configurable semantic palette.** Ship a small default colour set. The user may give colours labels such as “claim,” “evidence,” “question,” or “disagree.” Do not force universal meanings; downstream export includes both colour and user label.

**FR-9.4 — Durable anchor.** A text annotation stores:

- document version;
- zero-based physical page and visible page label;
- normalized rectangles;
- exact extracted quote;
- nearby prefix and suffix text;
- text-layer checksum;
- creation and update time.

Coordinates render the annotation; quote context supports re-anchoring after a compatible file or renderer change.

**FR-9.5 — Separate quote and comment.** The extracted source passage is read-only within the annotation. The user’s comment is a separate field. Copy/export styles cannot accidentally present the comment as a quotation.

**FR-9.6 — Tags and filters.** Filter the sidebar by type, colour label, tag, page range, note status, and Remember status. Search quote and comment text.

**FR-9.7 — Area capture provenance.** Store the crop image as an asset plus document fingerprint, page, normalized rectangle, and optional user caption. Never store only an orphaned bitmap.

**FR-9.8 — Undo and deletion.** Annotation creation, edit, and deletion are undoable within the current session. Deletion uses a recoverable trash state before permanent purge.

**FR-9.9 — Existing embedded annotations.** Render standards-compliant embedded annotations. Import into editable Reader records is an explicit action that previews duplicates and provenance.

### 9.3 Acceptance criteria

- Highlights survive zoom, resize, restart, and view rotation.
- A copied quote always includes a resolvable page reference.
- Editing a comment cannot alter the stored source excerpt.
- Filtering 10,000 annotations remains interactive on reference hardware.
- Export never overwrites the original PDF.
- The compact creation popover appears without perceptible delay after selection; annotation creation is visible within 100 ms and durable within 500 ms on reference hardware.
- Locked highlight/underline mode supports repeated creation until explicitly exited, and area capture completes with one drag plus an optional caption.
- Create, edit, and delete can be undone from both pointer and keyboard workflows during the current session.

---

## 10. Notes

### 10.1 Note types

**Source note:** belongs to one document and is optimized for assembling annotations, quotations, bibliographic metadata, and a reading summary.

**Concept note:** stands independently, states one useful idea in the user’s words, and can link to evidence from several documents or other notes.

**Scratch note:** temporary capture that must be promoted, archived, or discarded. It is not exported as polished knowledge by default.

These types guide the interface; they do not force a single knowledge-management method.

### 10.2 Requirements

**FR-10.1 — Annotation-to-note insertion.** Dragging or invoking “Add to note” inserts a structured evidence block containing:

- immutable source excerpt or area image;
- document title and author when known;
- page label;
- link back to the exact annotation;
- annotation colour label/tags;
- separate user comment.

This adapts the strongest part of Zotero’s workflow.

**FR-10.2 — In-context return.** Activating a source link opens the document, centres the annotation, and briefly emphasizes it. Navigation history returns to the note.

**FR-10.3 — Source/user/AI presentation.** Evidence blocks, user prose, and unadopted AI drafts have visually and semantically distinct roles. Export preserves those roles.

**FR-10.4 — Concept-oriented titles.** Concept-note onboarding encourages a complete claim or question as the title rather than a broad topic noun. It is guidance, not a hard validator.

**FR-10.5 — Links and backlinks.** Support note-to-note links, document links, annotation links, and backlinks. Links use stable IDs internally so renaming a note does not break them.

**FR-10.6 — Atomicity guidance.** A note may be split into two with link preservation. The editor can warn when a note has several unrelated headings, but it never blocks saving.

**FR-10.7 — Templates.** User-editable templates for source notes, concept notes, and annotation insertion. Templates must be previewable and versioned.

**FR-10.8 — Autosave and history.** Save as the user types and retain bounded local revisions. A crash must not lose more than the current small edit buffer.

**FR-10.9 — Full-text search.** Search titles, user prose, annotation comments, tags, and source excerpts. Results identify the text role.

**FR-10.10 — Markdown semantics.** Notes support headings, lists, task-list syntax as text, blockquotes, code, equations, tables, links, and images. This does not turn the Reader into a task manager.

### 10.3 Acceptance criteria

- An inserted annotation returns to the correct page and region.
- Renaming a note preserves all links.
- Export never labels AI text as user-authored text.
- A source note can be built completely without AI.
- Revision restore does not duplicate annotation blocks or assets.
- Evidence blocks and user prose remain distinct visually, semantically, in clipboard output, and in export even when no AI feature exists.
- Creating a concept note offers non-blocking guidance toward a complete claim or question as its title; dismissing the guidance never blocks saving.

---

## 11. Internal review and durable learning

### 11.1 Product stance

Review is deliberate memory practice, not a quiz score. The user decides what deserves future attention. The source remains the feedback authority.

### 11.2 From reading to review

**FR-11.1 — Remember action.** A highlight, evidence block, or user-authored note can be marked “Remember.” This opens a prompt editor; it does not silently create a card.

**FR-11.2 — Prompt types.**

- focused question and answer;
- explanation prompt with source criteria;
- application/example prompt;
- contrast prompt between two user-selected ideas;
- cloze prompt, available but not the default.

Image occlusion is later.

**FR-11.3 — Required provenance.** Every prompt links to at least one source annotation or user-authored note. A prompt cannot rely only on an unadopted AI draft.

**FR-11.4 — Prompt-quality guidance.** The editor checks for Matuschak-inspired heuristics:

- focused on one retrieval task;
- precise about what is requested;
- answer is reasonably consistent;
- tractable without being trivial;
- requires recall rather than recognition;
- includes a cue when necessary without giving the answer away.

Warnings explain the tradeoff and are always overridable.

**FR-11.5 — User-authored answer.** AI may draft a candidate answer only on request. The prompt remains in Draft until the user reviews or rewrites it and explicitly adopts it.

### 11.3 Review session

**FR-11.6 — Retrieval before reveal.** Show the prompt with the answer, source excerpt, page thumbnail, and nearby context hidden. The user thinks, speaks, or types an answer, then reveals.

**FR-11.7 — Source feedback.** Reveal the adopted answer and exact source evidence side by side with the user’s optional response. A link opens the full page context.

**FR-11.8 — Self-rating.** Use four unambiguous outcomes:

- Again — not recalled;
- Hard — recalled correctly with substantial difficulty;
- Good — recalled correctly;
- Easy — immediate, confident recall.

The UI must state that Hard is still a successful recall. This matches the distinction required by modern FSRS scheduling guidance.

**FR-11.9 — No model grade.** AI does not choose the outcome. It may generate a follow-up question after reveal, clearly labelled as optional.

**FR-11.10 — Scheduling.** Use FSRS with a default desired retention of 90%, transparent next-review dates, and a configurable daily time/card budget. The Anki manual describes FSRS as adapting intervals to estimated memory and warns that workload rises rapidly at very high desired retention: [Anki FSRS documentation](https://docs.ankiweb.net/deck-options.html#fsrs).

**FR-11.11 — Manageable queue.** Reviews beyond the daily budget remain due without punishment. The user can pause a prompt, change priority, reschedule, or stop reviewing it.

**FR-11.12 — Prompt repair.** Repeated failure marks a prompt for revision. Offer to add a cue, split it, narrow it, or retire it. Do not simply shorten the interval forever.

### 11.4 Reading-session synthesis

At the end of a reading session, offer—but do not force—a short source-hidden recall:

1. What were the most important claims?
2. What changed your mind or remains unresolved?
3. How would you apply or test one idea?
4. Which one or two ideas are worth remembering?

After the attempt, reveal that session’s annotations. This is a lightweight retrieval checkpoint, not an AI exam.

### 11.5 Acceptance criteria

- No annotation becomes due for review without explicit user confirmation.
- Review works with AI off and no microphone.
- Source content stays hidden until reveal or explicit skip.
- Every due prompt can return to its evidence.
- FSRS event history is exportable and reproducible.
- A backlog never blocks reading or note-taking.
- If the user types an optional response before reveal, it remains visible during source comparison and is preserved with that review event and its export.

---

## 12. Optional local AI

### 12.1 Control model

**FR-12.1 — Global switch.** `Local AI: Off / On` is visible in Settings and in the Reader’s AI state indicator.

With AI off:

- no Reader-managed language or embedding process exists;
- the Reader sends no request to a user-managed local provider;
- no Reader-managed model is loaded into RAM or GPU memory;
- no semantic/vector index is built or queried;
- no AI request is queued;
- deterministic text extraction and FTS search continue normally;
- all reading, annotation, notes, review, and export features remain available.

**FR-12.2 — Per-document exclusion.** Even with AI globally on, a document can be marked “Never use with AI.” Its pages, annotations, and notes are excluded from inference and embedding.

**FR-12.3 — Per-action scope.** Before generation, show whether the action will receive:

- selected text only;
- selected pages;
- current document metadata and retrieved passages;
- a chosen note;
- chosen annotations from more than one source.

There is no implicit “entire library” scope.

### 12.2 Allowed actions

**FR-12.4 — Explain selection.** Explain only the selected passage, using nearby text when the user permits it. Link each substantive claim back to page evidence or label it as general model knowledge.

**FR-12.5 — Ask this document.** Retrieve relevant passages locally and answer with page-linked citations. If evidence is insufficient, say so. The answer is a generated view, not a note until adopted.

**FR-12.6 — Summarize selected scope.** Summarize selected pages, a section, or selected annotations. Never imply that an entire document was read when only chunks were provided.

**FR-12.7 — Draft note transformation.** Propose a claim title, outline, or split for user-selected notes and annotations. Preserve the originals and show a diff.

**FR-12.8 — Draft retrieval prompts.** Propose focused questions from user-selected evidence. Each draft includes the evidence link and remains unapproved.

**FR-12.9 — Suggest links and tags.** Suggest existing note links or tags using titles and selected note content. Never invent a note target.

**FR-12.10 — Generate questions, not verdicts.** Ask the user to explain, compare, apply, or find a counterexample. Do not judge conceptual correctness or assign mastery.

### 12.3 Source and authorship safety

**FR-12.11 — Citation requirement.** Document answers display page citations adjacent to the claims they support. Clicking a citation reveals the exact retrieved passage.

**FR-12.12 — Generated-text state.** AI output has three states:

1. transient response;
2. saved AI draft;
3. adopted user text.

Only the user can move text to the adopted state. Provenance remains available after adoption.

**FR-12.13 — No silent source repair.** The model cannot overwrite extracted text, OCR text, quotes, or annotation anchors. Proposed reconstruction is side-by-side, reversible, and barred from verbatim-quote export unless the user returns to the page image and verifies it.

**FR-12.14 — Prompt-injection resistance.** Treat document text as data, never as instructions. Tool access is not exposed to the model. A PDF cannot instruct the runtime to read files, change settings, or send network requests.

**FR-12.15 — Operational logs.** Log latency, model/runtime version, action type, and error code. Do not retain prompt or response bodies in operational logs by default.

### 12.4 Runtime strategy

Preferred default:

- optional app-managed `llama.cpp` sidecar;
- quantized GGUF models downloaded after explicit size/licence consent;
- loopback or OS-local transport;
- lazy load and idle unload;
- one active generation at a time in v1;
- cancellation that terminates work promptly without corrupting state.

`llama.cpp` explicitly targets local inference across CPUs and GPUs and supports quantization and local server APIs: [official project](https://github.com/ggml-org/llama.cpp).

Advanced optional providers:

- [Ollama’s localhost API](https://docs.ollama.com/api/introduction);
- [LM Studio’s local server](https://lmstudio.ai/docs/developer/core/server);
- user-managed `llama.cpp` server.

Remote and LAN endpoints are out of scope. A loopback address alone does not prove that inference is local: a user-managed provider may itself offer cloud-backed models. Strict Local mode therefore uses only the app-managed runtime. External-provider mode is explicitly labelled as unverified, and the Reader cannot guarantee the independent provider’s network behavior.

### 12.5 Model policy

Do not specify a permanent “best model” in the PRD. Release selection uses a fixed Reader evaluation corpus and capability labels:

| Profile | Target | Intended actions |
| --- | --- | --- |
| AI Off | 8 GB RAM core hardware | Full non-AI product |
| Compact | 8 GB RAM | Selection explanation, formatting, prompt drafts with short context |
| Standard | 16 GB+ RAM | Document retrieval answers and longer note transformations |

Candidate models must be tested for:

- citation coverage and citation correctness;
- unsupported-claim rate;
- schema validity;
- preservation of source quotes;
- prompt-injection resistance;
- latency and peak memory on reference Windows hardware;
- licence and redistribution constraints.

No model is allowed to make AI a dependency of the core.

### 12.6 Acceptance criteria

- Turning AI off stops and unloads every app-managed model process.
- A per-document exclusion is enforced across every AI action.
- Every document-grounded answer exposes its retrieved evidence.
- Rejecting a draft changes no note or review prompt.
- A model crash leaves the document, annotations, and notes intact.
- No AI feature requires an internet connection after the user has installed a model.

---

## 13. OCR and text fidelity

### 13.1 v1 boundary

Born-digital PDFs are the v1 quality target. A scanned document can still be viewed and annotated by area, but full text search, text highlights, and AI are unavailable until OCR support is installed.

This is a better v1 boundary than shipping unreliable transcription across arbitrary scans.

### 13.2 Later OCR requirements

**FR-13.1 — Classical OCR first.** Use a deterministic OCR pipeline as the default. A generative vision-language model is not the source-text path because plausible invented text is unacceptable.

**FR-13.2 — Page-image provenance.** Every OCR span links to the page image region and stores engine/version, language, and confidence where available.

**FR-13.3 — Visible uncertainty.** Low-confidence text is visibly marked in search, copy, and annotation. A user can correct it without deleting the original OCR output.

**FR-13.4 — No quote laundering.** OCR-derived text is labelled in exported quotations unless the user verifies it against the image.

**FR-13.5 — Deterministic cleanup.** Line reflow, ligature normalization, and de-hyphenation may run through reversible rules. Generative reconstruction is a separate explicit action under FR-12.13.

---

## 14. Export and portability

### 14.1 Export modes

**FR-14.1 — Quick Copy.** Copy a selected annotation, evidence block, note, or review prompt as Markdown or plain text with page/source reference. The interaction is inspired by Zotero’s quick annotation-to-note and clipboard workflows.

**FR-14.2 — Markdown package.** Export selected documents/notes to:

```text
export/
  notes/
  sources/
  assets/
  reviews/
  manifest.json
```

Markdown contains stable IDs, readable links, front matter, and relative asset paths. It must remain useful without the Reader installed.

**FR-14.3 — Annotated PDF copy.** Export a new PDF with supported annotations embedded. The original is never overwritten. Unsupported Reader-only metadata is included in a sidecar manifest rather than silently dropped.

**FR-14.4 — Full local backup.** Export a versioned JSON/asset archive containing documents or document references, annotations, notes, links, review prompts, review history, settings, and provenance.

**FR-14.5 — Review export.** Export prompts and source references as CSV/TSV in v1. Native Anki package export is later and must preserve scheduling semantics or omit them explicitly.

**FR-14.6 — Destination safety.** The user chooses the destination. Existing files are never overwritten without a diff/confirmation. Repeating the same export is idempotent where the format permits it.

### 14.2 Deep links

Use a versioned local URI such as:

```text
mereth://document/{id}?page={physicalPage}&annotation={annotationId}
mereth://note/{id}
mereth://review/{id}
```

The scheme is resolved (§2.3). Exports also include human-readable page/source text so they do not depend only on deep links.

### 14.3 Acceptance criteria

- A Markdown export can be browsed with an ordinary text editor.
- Quick Copy clearly distinguishes quotation and user comment.
- Exported assets use portable relative paths.
- An annotated-PDF export never changes the managed or in-place original.
- A backup restore reproduces note links and review due state.

---

## 15. Platform and system architecture

### 15.1 Product boundary

Implementation starts in a new repository, not under Cabin’s application source. This PRD may remain in the current root temporarily as the planning handoff.

The Reader uses a distinct application-data directory. It must never read Cabin’s database directly.

### 15.2 Proposed stack

| Layer | Decision | Reason |
| --- | --- | --- |
| Desktop shell | Tauri 2 (Rust core + OS webview) | Windows-first with later macOS/Linux; small installer and footprint for the 8 GB profile |
| Native/privileged layer | Rust, exposed only through explicit Tauri commands | Filesystem, database, and sidecar access stay outside the webview |
| UI | React functional components + Hooks, strict TypeScript | Existing engineering constraint and reusable cross-platform UI |
| Package manager | `pnpm` | Project rule — the only supported package manager |
| PDF rendering | PDF.js, subject to a per-platform R0 corpus gate | Mature and cross-platform; the webview engine differs per OS (§1.6) |
| Database | SQLite with WAL and FTS5, accessed from Rust | Durable local records and deterministic full-text search |
| Annotation assets | Filesystem with database references | Avoid large blobs and make backup/export explicit |
| Local LLM | Optional `llama.cpp` sidecar | Crash isolation and broad local hardware support |
| Speech-to-text | Not v1; optional `whisper.cpp` later | Review does not depend on voice |
| OCR | Separate optional sidecar later | Keep Python/model risk out of reader core |

### 15.3 Security boundary

PDFs are untrusted input. The threat model is unchanged by the shell decision, but the controls are Tauri's, not Electron's. Tauri has no `nodeIntegration`, no preload bridge, and no `contextIsolation` flag: the webview has no ambient access to the filesystem or process APIs in the first place, and privilege is granted explicitly rather than removed defensively. See the [Tauri security documentation](https://v2.tauri.app/security/) and the [capability/permission model](https://v2.tauri.app/security/capabilities/).

Required posture:

- **Capability allowlist is minimal and itemised.** `src-tauri/capabilities/` grants only the permissions a shipped feature uses. Every addition is a reviewable change, and no permission remains that no feature needs. Prefer a narrow custom command over a broad plugin permission.
- **No broad filesystem permission.** File access is scoped to user-chosen paths from the dialog and to the application data directory. `fs:default` and directory-wide scopes are not granted.
- **Restrictive CSP, verified rather than declared.** `default-src 'self'`; no remote origins; the PDF.js worker is served locally. The CSP is exercised against a hostile sample, not merely written into config. `dangerousDisableAssetCspModification` is never used.
- **Asset protocol over `file://`.** Document bytes reach the webview through Tauri's scoped asset protocol or an explicit command, never a broad `file://` grant.
- **Narrow, typed IPC.** Rust commands take specific typed arguments and never accept a caller-supplied path, SQL fragment, or shell string. Database access lives entirely in Rust; SQL is not reachable from the webview.
- **External navigation denied by default.** Links do not navigate the app window; the destination is disclosed and handed to the OS browser on explicit user action.
- **PDF JavaScript and automatic actions disabled**, along with embedded launches and network fetches originating from document content.
- **No remote content and no nested webviews** in the document surface.
- **Sidecars receive only explicit request payloads** and no arbitrary filesystem or shell tools. This applies to any future model or OCR runtime.
- **Document text is data, never instructions** (FR-12.14). This constrains the architecture now, while AI is absent, because it determines how retrieved text may ever be passed to a runtime.
- **Updater and remote endpoints stay disabled** unless separately consented under §15.5.

Each control above needs a verification method recorded against it in the implementation plan. A posture that is configured but never exercised against the §17.5 malformed and hostile corpus is not evidence.

### 15.4 Data layout

```text
app-data/
  db/
  documents/
  annotations/
  assets/
  models/
  indexes/
  cache/
  backups/
  logs/
```

- `documents/` contains only managed-library copies.
- `indexes/` is fully rebuildable.
- `cache/` is disposable.
- `models/` is user-visible in storage settings and removable.
- user-authored annotations, notes, and review history are never classified as cache.

### 15.5 Network policy

Core operation performs no network request.

If update checking or model download is later added:

- it is separately consented;
- document/note content is never included;
- update/model endpoints are allowlisted;
- a network activity log identifies the operation and endpoint;
- the installed app remains usable indefinitely without a connection.

---

## 16. Data model direction

Schema syntax belongs in the implementation plan.

| Entity | Purpose |
| --- | --- |
| `documents` | Identity, ownership mode, path, fingerprint, metadata, current version |
| `document_versions` | Fingerprint, page geometry/count, import time, re-anchoring state |
| `pages` | Extracted/OCR text, page label, dimensions, provenance |
| `annotations` | Type, anchors, exact quote, comment, colour label, tags, status |
| `annotation_assets` | Area captures and later ink assets with page provenance |
| `notes` | Source, concept, or scratch note with authorship state |
| `note_revisions` | Bounded autosave/version history |
| `note_links` | Stable note/document/annotation relationships |
| `evidence_blocks` | Structured insertion of source material into a note |
| `review_prompts` | Prompt, adopted answer, type, source relationships, state |
| `review_events` | Timestamp, outcome, duration, due calculation inputs |
| `review_schedule` | FSRS state and next due time |
| `ai_actions` | Scope, provider/model metadata, retrieved evidence, draft, decision |
| `jobs` | Import, extraction, index, export, OCR, and model-download state |
| `exports` | Format, destination, manifest, completion/error state |
| `settings` | Appearance, shortcuts, review, AI, privacy, storage |

### 16.1 Provenance fields

All text-bearing records identify one of:

- `source_extracted`;
- `source_ocr`;
- `user_authored`;
- `ai_draft`;
- `user_adopted_ai`;
- `deterministic_transform`.

Adoption does not erase the original provenance.

---

## 17. Non-functional requirements

### 17.1 Reference hardware

Initial performance testing uses:

- Windows 11 x64;
- 8 GB RAM for AI-off core;
- integrated graphics;
- SSD;
- mainstream four-core-or-better CPU.

AI Standard testing uses a separate 16 GB+ profile. Hardware models are recorded in benchmark reports rather than implied by vague “modern PC” language.

### 17.2 Performance targets

- First visible page within 2 seconds for a 400-page born-digital reference PDF from local SSD.
- Page navigation input response within 100 ms when the target page is cached.
- Annotation creation visible within 100 ms and durable within 500 ms.
- Text search begins returning results within 300 ms after indexing on the reference corpus.
- Reader remains responsive while extraction, export, or model inference runs.
- Core AI-off working set is measured and capped through the R0/R1 benchmark; no target is invented before the corpus test.

Validation is staged rather than postponed until release:

- **R0:** renderer viability, cold first-page time, long-scroll memory behaviour, selection fidelity, and security corpus;
- **R1:** cached navigation, page/thumbnail virtualization, search latency, background-job cancellation, and working-set cap;
- **R2:** annotation creation, persistence, 10,000-annotation filtering, and re-anchoring responsiveness;
- **R3/R4:** note autosave, revision restore, export, backup, and review scheduling while the reader remains responsive;
- **release:** repeat the complete benchmark on recorded Windows reference hardware and compare it with the earlier baselines.

Each stage records hardware, corpus version, cold/warm state, measurement method, median, and worst observed result. A failed gate blocks dependent work until the design changes or the target is explicitly amended in this PRD.

### 17.3 Reliability

- Autosave and WAL-backed recovery.
- Versioned, forward-only database migrations with backup before migration.
- Atomic note and export writes.
- Restartable background jobs.
- Corrupt cache/index can be rebuilt without losing user work.
- Quarterly automated restore drill against a representative backup.

The quarterly restore drill runs from a clean profile, validates note links, annotation assets, provenance, and review due state, and produces a machine-readable result. Release validation does not replace this recurring test.

### 17.4 Accessibility

- Complete keyboard path.
- Visible focus and no keyboard traps.
- Screen-reader names and roles for annotation tools, panes, pages, and review controls.
- Minimum WCAG AA contrast in application chrome.
- Adjustable application text size independent of PDF zoom.
- Reduced-motion support.
- Colour is never the only annotation category signal.

### 17.5 Test corpus

Maintain a legal, redistributable corpus covering:

- simple text PDF;
- multi-column paper;
- equations and ligatures;
- CJK and right-to-left text;
- scanned pages;
- large images and vector diagrams;
- embedded annotations;
- forms and links;
- malformed objects;
- encrypted/password document;
- 400+ page book;
- changed/replaced document versions.

The corpus has a versioned manifest recording licence/source, fingerprint, expected page count, expected capability or failure mode, and any permitted variance. Every renderer upgrade runs visual, selection, text, annotation-anchor, memory, and security regression tests against it. Password-protected, malformed, scanned, and unsupported documents must produce an intentional result or recoverable explanation; a blank canvas, infinite spinner, or silent partial import is a failure.

### 17.6 Resilient states and adaptive operation

- Empty Library, Notes, Review, annotation, search, and job states explain the next useful action without invented counts or sample records.
- Loading and indexing states disclose what remains usable, expose cancellation where safe, and never block reading unnecessarily.
- Permission denial, moved files, version mismatch, duplicate import, malformed/encrypted PDF, disk-full autosave, migration failure, export conflict, and restore failure preserve existing user work and offer a concrete recovery path.
- The 1024×640 minimum layout defines a deterministic pane-collapse order. Pane state and user-adjusted widths restore without allowing the page canvas or primary controls to become unreachable.
- Windows display scaling from 100% through 200%, keyboard-only operation, reduced motion, and application text scaling are part of the release matrix.
- Status text and progress indicators report real application state; mock values are permitted only in a build unmistakably labelled as a prototype.

---

## 18. Phased roadmap

Each phase must remain useful with AI assets absent.

| Phase | Scope | Exit decision |
| --- | --- | --- |
| **R0 — Feasibility and threat spike** | New repo; secure Tauri shell; PDF.js corpus; large-document performance; annotation overlay persistence; exported-PDF proof; SQLite/FTS5; Windows installer/file association | Stop or change renderer before product UI if corpus gates fail |
| **R1 — Clean reader** | Import/open modes, library, recents, outline, thumbnails, navigation, search, reading-only mode, position restore | A strong offline PDF reader without notes |
| **R2 — Annotations** | Highlights, underlines, comments, area captures, tags, filters, re-anchoring, undo/trash | Zotero-like capture and return-to-page loop |
| **R3 — Notes and export** | Source/concept/scratch notes, evidence blocks, links/backlinks, templates, Quick Copy, Markdown/JSON, annotated-PDF copy | Complete source-grounded note workflow |
| **R4 — Internal review** | Remember action, prompt editor/lint, FSRS, review UI, source reveal, prompt repair, review export | Complete non-AI Windows product |
| **R5 — Optional local AI** | Runtime manager, model consent, selection explanation, cited document Q&A, note/prompt drafts, exclusions, AI-off verification | Ship only after citation and injection evaluation gates pass |
| **R6 — OCR** | Optional OCR runtime, page-region provenance, confidence UI, scanned-PDF search/highlights | Defer if integration weakens core stability |
| **R7 — macOS** | Apple Silicon package, native dialogs/menus, renderer/runtime benchmarks, signing/notarization | No feature expansion during port |
| **R8 — Linux** | Packaging and Wayland/X11 validation after macOS stabilizes | Distribution formats decided from demand |
| **R9 — Additional formats** | EPUB first, DjVu second, each with a common evidence-anchor abstraction | Separate PRD amendment |

### 18.1 Recommended release cut

Release the first serious Windows version through **R4**, not R5.

That cut proves the product’s real thesis—reader, notes, and durable review—without hiding weaknesses behind AI. R5 is valuable only if it improves an already-good loop.

---

## 19. Success metrics

These metrics do not authorize telemetry. Before release, they are measured through the versioned corpus, automated tests, and consented usability sessions. Any future local diagnostic or metric export is explicit, inspectable, and user-initiated; document text, notes, annotations, prompts, and review responses are never silently collected.

### 19.1 Reader quality

- Median time from file open to first readable page.
- Crash-free reading hours.
- Percentage of documents that restore the correct reading position.
- Annotation anchor failures after restart or renderer upgrade.

### 19.2 Note quality

- Percentage of annotation insertions that retain a working source link.
- Percentage of completed reading sessions producing at least one user-authored note.
- Ratio of exported user-authored text to raw highlight text, interpreted cautiously.
- Export/restore failures: target zero.

### 19.3 Review usefulness

- Percentage of Remember actions that become approved prompts.
- Review completion within the user’s chosen budget.
- Prompt revision/retirement rate after repeated failures.
- Demonstrated recall by interval and prompt type, shown privately as evidence rather than a grade.

### 19.4 AI quality

- Citation coverage and incorrect-citation rate on the fixed evaluation corpus.
- Draft acceptance, edit, and rejection rates by action.
- Unsupported-claim reports.
- Model crash and cancellation recovery.
- AI-off regression results.

High AI usage is not a success metric. Low usage may mean the manual product is working well.

---

## 20. Risk register

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| RK-1 | PDF.js fails on large, malformed, or graphics-heavy sources | Critical | R0 corpus gate; compare PDFium before committing |
| RK-2 | Annotation anchors drift after document or renderer changes | Critical | Version fingerprints, normalized rectangles, text context, re-anchoring review |
| RK-3 | Original PDFs are corrupted by annotation writes | Critical | Database source of truth; export new copy; never overwrite original |
| RK-4 | Product becomes a weak Zotero clone | High | Limit library/citation scope; differentiate through note/review loop |
| RK-5 | Review queue creates guilt and abandonment | High | Daily budget, pause/retire, no streaks, prompt repair |
| RK-6 | AI answers cite irrelevant passages or fabricate support | Critical | Adjacent evidence, fixed evaluation, explicit insufficiency, AI remains optional |
| RK-7 | AI-generated notes blur user authorship | High | Three-state generated text and permanent provenance |
| RK-8 | Document prompt injection reaches tools or files | Critical | Treat text as data; no model tools; scoped payloads; local-only runtime |
| RK-9 | 8 GB machines thrash when models load | High | AI-off core, Compact profile, lazy loading, hard memory benchmark |
| RK-10 | OCR turns uncertain scans into false quotations | High | Classical OCR, confidence and page-region provenance, verification labels |
| RK-11 | Webview compromise reaches local files through an over-broad capability | Critical | Minimal itemised capability allowlist, no broad `fs` scope, narrow typed IPC, scoped asset protocol, security corpus (§15.3) |
| RK-12 | “Native” expectation differs from web-rendered reality | High | Explicit definition in §1.6 before implementation |
| RK-18 | OS webview differences cause per-platform rendering, selection, or CSP divergence | High | Re-run the §17.5 corpus per platform; budget renderer work into R7/R8 rather than assuming parity (§1.6) |
| RK-13 | Scope expands into tasks, audio, citation management, and sync | High | Non-goals and separate Cabin boundary |
| RK-14 | Note editor becomes a general PKM product | Medium | Source/concept workflow first; no graph theatre or plugin ecosystem in v1 |
| RK-15 | Cross-platform promise delays Windows quality | High | Windows through R5/R6 before macOS; no simultaneous ports |
| RK-16 | Model or OCR licences block distribution | Medium | No bundled weights by default; show licence; legal gate per catalogue entry |
| RK-17 | Backup exists but cannot be restored | Critical | Automated restore tests and versioned manifest |

---

## 21. Open questions and resolved decisions

| # | Status | Decision or question | Needed by |
| --- | --- | --- | --- |
| OQ-1 | **Resolved** | The product is **Mereth Reader**; identifier `dev.mereth.reader`; deep-link scheme `mereth://`. Trademark and domain checks remain outstanding but do not block implementation. | Now |
| OQ-2 | **Resolved** | It is a separate product, executable, repository, and database—not a Cabin feature. | Now |
| OQ-3 | **Resolved** | Windows first; macOS later; Linux after macOS. | R0 |
| OQ-4 | **Resolved** | **Tauri 2** is the cross-platform desktop shell, superseding the original Electron decision; “native” means installed and OS-integrated, not WinUI. Security controls are Tauri's capability model, not Electron's (§15.3). | R0 |
| OQ-5 | **Resolved** | AI is optional and switchable. AI-off is the core acceptance configuration. | Every phase |
| OQ-6 | **Resolved** | PDF is the only v1 document format. EPUB and DjVu are later. | R0 |
| OQ-7 | **Resolved** | Zotero’s annotation-to-note and source-return interactions are the reader benchmark; full citation management is not. | R2/R3 |
| OQ-8 | **Resolved** | Retrieval practice and spaced review are internal; AI does not grade correctness. | R4 |
| OQ-9 | **Open** | Should managed-library copy or open-in-place be the recommended onboarding default? | R1 usability test |
| OQ-10 | **Open** | Are area capture and comment enough for v1 diagrams, or is freehand ink required before release? | R0/R2 |
| OQ-11 | **Open** | Which Markdown front-matter fields and note templates must ship by default? | R3 |
| OQ-12 | **Open** | Does v1 need CSL citation-style formatting, or are editable metadata plus page/source references sufficient? | R3 |
| OQ-13 | **Open** | Which FSRS implementation/library satisfies desktop licensing and deterministic export requirements? | R4 |
| OQ-14 | **Open** | Should app-managed `llama.cpp` ship before support for existing Ollama/LM Studio installations, or together? | R5 |
| OQ-15 | **Open** | What reference PDFs and user-authored tasks make up the local AI citation evaluation corpus? | R5 |
| OQ-16 | **Open** | Is Windows 11 x64 sufficient for the first installer, or is Windows on ARM required at launch? | R0 |
| OQ-17 | **Open** | Does v1 print PDFs through the OS print dialog, or is printing an explicit post-v1 capability? | R0 scope gate |
| OQ-18 | **Open** | Does v1 support one active document window, multiple tabs, or multiple application windows? | R0 architecture gate |
| OQ-19 | **Open** | Does v1 open password-protected PDFs after an in-app password prompt, or reject them with a clear recoverable explanation? Passwords must never be persisted without a separate security decision. | R0 corpus gate |

---

## Appendix A — Core experience acceptance journey

A release candidate must pass this journey with the network disabled and no AI models installed:

1. Install on a clean Windows reference machine.
2. Open a 400-page born-digital PDF through Windows “Open with.”
3. Navigate by outline, search, and page number.
4. Highlight a passage, label its colour, and add a comment.
5. Capture a figure and add both annotations to a source note.
6. Write a concept note in the user’s own words and link the evidence.
7. Close and reopen the application; restore the exact reading position.
8. Open the concept note and return to each page annotation.
9. Mark one idea Remember, write a focused prompt, and approve it.
10. Complete a source-hidden review, reveal evidence, and self-rate it.
11. Quick Copy the evidence with its page reference.
12. Export Markdown, review CSV/TSV, full backup, and an annotated PDF copy.
13. Restore the backup into a clean profile and repeat steps 8–10.

R5 adds a second journey with AI on, then repeats the full core journey after AI is turned off and all model files are removed.

---

## Appendix B — Research and technical sources

Reference reader workflows:

- [Zotero PDF Reader and Note Editor](https://www.zotero.org/support/pdf_reader)
- [Why Zotero stores annotations in its database](https://www.zotero.org/support/kb/annotations_in_database)
- [Zotero note templates](https://www.zotero.org/support/note_templates)
- [Zotero Quick Copy/export preferences](https://www.zotero.org/support/preferences/export)

Learning and memory:

- [Roediger & Karpicke (2006) — Test-Enhanced Learning](https://pubmed.ncbi.nlm.nih.gov/16507066/)
- [Cepeda et al. (2006) — distributed-practice quantitative review](https://doi.org/10.1037/0033-2909.132.3.354)
- [Karpicke & Blunt (2011) — retrieval practice and concept mapping](https://pubmed.ncbi.nlm.nih.gov/21252317/)
- [Dunlosky et al. (2013) — review of learning techniques](https://doi.org/10.1177/1529100612453266)
- [Anki manual — FSRS](https://docs.ankiweb.net/deck-options.html#fsrs)

Matuschak/Nielsen design references:

- [Andy Matuschak — How to write good prompts](https://andymatuschak.org/prompts/)
- [Spaced repetition memory systems make memory a choice](https://notes.andymatuschak.org/Spaced_repetition_memory_systems_make_memory_a_choice)
- [Evergreen notes](https://notes.andymatuschak.org/Evergreen_notes)
- [Evergreen notes should be atomic](https://notes.andymatuschak.org/Evergreen_notes_should_be_atomic)
- [Matuschak & Nielsen — Transformative tools for thought](https://numinous.productions/ttft/)

Architecture:

- [PDF.js](https://github.com/mozilla/pdf.js)
- [PDF.js layers and viewer foundation](https://mozilla.github.io/pdf.js/getting_started/)
- [Tauri security overview](https://v2.tauri.app/security/)
- [Tauri capabilities and permissions](https://v2.tauri.app/security/capabilities/)
- [Tauri Content Security Policy guidance](https://v2.tauri.app/security/csp/)
- [SQLite WAL](https://sqlite.org/wal.html)
- [SQLite FTS5](https://sqlite.org/fts5.html)
- [`llama.cpp`](https://github.com/ggml-org/llama.cpp)
- [Ollama local API](https://docs.ollama.com/api/introduction)
- [LM Studio local server](https://lmstudio.ai/docs/developer/core/server)
- [`whisper.cpp`](https://github.com/ggml-org/whisper.cpp)
