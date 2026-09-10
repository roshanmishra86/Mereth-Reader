# Mereth Reader — User Guide

> **The Core Philosophy: "Quiet Research Desk"**  
> Mereth Reader is built for focused, deep research. It does not bombard you with gamified streaks, social feeds, or AI clutter. Instead, it respects the natural cycle of deep study:  
> **Open Source → Read & Annotate → Think in Notes → Deliberately Remember → Retrieve & Review → Return to the Source.**

---

## 1. Workspace Layout & Navigation

Mereth Reader organizes your research desk into six primary destinations accessible via the left navigation rail:

| Rail Destination | Access | Purpose |
| :--- | :--- | :--- |
| **Library** | Rail button | Import, organize, and open local PDF documents. |
| **Reader** | Rail button | The focused, high-resolution reading surface. |
| **Notes** | Rail button | Searchable document and standalone notes list with type and tag filtering. |
| **Knowledge** | Rail button | Full 3-pane knowledge workspace with bi-directional backlinks, evidence cards, and revisions. |
| **Review** | Rail button | Deliberate active recall review session powered by FSRS-4.5. |
| **Settings** | Rail bottom button | Appearance themes, annotation palettes, shortcuts, privacy, and backup exports. |

Within the **Reader**, you work across three coordinated zones:
1. **Left Navigation Pane (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>):** Interactive **Outline (Table of Contents)** and **Thumbnails**.
2. **Center Canvas:** The high-resolution PDF canvas with three layout modes:
   - **Single Page View:** <kbd>Ctrl</kbd>+<kbd>1</kbd>
   - **Continuous Scroll View:** <kbd>Ctrl</kbd>+<kbd>2</kbd>
   - **Facing Pages (Two-Up) View:** <kbd>Ctrl</kbd>+<kbd>3</kbd>  
   Fit controls: **Fit Width** (<kbd>Alt</kbd>+<kbd>W</kbd>) and **Fit Page** (<kbd>Alt</kbd>+<kbd>P</kbd>).  
   Rotation: **Rotate Clockwise 90°** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>).
3. **Right Annotation & Note Side Pane (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd>):** Filter active highlights and clippings, or switch to the **Note** tab to edit sidecar document notes side-by-side with the text.

---

## 2. Reading & Semantic Annotations

Unlike generic PDF readers where highlights are merely visual color stripes, Mereth treats annotations as **structured semantic evidence**:

1. **Selecting Text:**  
   Highlight any passage. An annotation popover appears immediately above your selection.
2. **Semantic Categorization:**  
   Assign a deliberate epistemic meaning to what you found:
   - 🟡 **Claim (<kbd>Alt</kbd>+<kbd>1</kbd>):** The author's central thesis, assertion, or core argument.
   - 🟢 **Evidence (<kbd>Alt</kbd>+<kbd>2</kbd>):** Empirical data, experimental proof, or statistics.
   - 🔵 **Question:** An unresolved doubt, ambiguity, or query you want to investigate.
   - 🔴 **Disagree:** A point you challenge, counter-argument, or limitation.
   - ⚪ **Support:** Foundational definitions, background context, or apparatus descriptions.
3. **Annotation Styles:**
   - **Highlight:** Clean translucent background bar.
   - **Underline:** Bottom structural rule (ideal for dense equations or line edits).
   - **Comment Pin:** Anchors personal reflection to the exact sentence without obscuring text.
4. **Area Capture (<kbd>Alt</kbd>+<kbd>A</kbd>):**  
   For architectural diagrams, anatomical illustrations, circuits, or mathematical proofs:
   - Press <kbd>Alt</kbd>+<kbd>A</kbd> or click the Area icon.
   - Drag a rectangle around the figure. Mereth extracts an immutable, high-resolution PNG asset anchored directly to that physical page.
5. **Bookmark (<kbd>Alt</kbd>+<kbd>B</kbd>):**  
   Quickly bookmark the current page for instant reference.
6. **Undo (<kbd>Ctrl</kbd>+<kbd>Z</kbd>):**  
   Revert the last annotation creation, edit, or trash action.

---

## 3. Thinking in Notes & Knowledge Linking

Notes in Mereth bridge the gap between reading source literature and synthesizing your own thinking:

1. **Note Categories:**
   - **Source Notes:** Directly linked to a specific book or paper. Holds reading outlines, chapter summaries, and extracted evidence blocks.
   - **Concept Notes:** Autonomous notes representing atomic ideas that synthesize findings across multiple papers.
   - **Scratch Notes:** Rapid capture of ephemeral thoughts. Can be promoted to Concept or Source notes.
2. **Quick Note Capture (<kbd>Alt</kbd>+<kbd>N</kbd>):**  
   While reading anywhere in the PDF, press <kbd>Alt</kbd>+<kbd>N</kbd> to open the quick note composer:
   - Type your thought using Markdown.
   - Press <kbd>Enter</kbd> for a newline.
   - Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to save.
   - If unsaved changes exist, pressing <kbd>Escape</kbd> or clicking outside prompts for discard confirmation so thoughts are never lost accidentally.
3. **Reader Sidecar Note Drawer (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd>):**  
   Open the **Note** tab in the right pane to draft document notes alongside the PDF:
   - Toggle between **Edit** and **Preview** mode.
   - Live debounced autosave protects your work; drafts are automatically flushed when selecting notes or navigating.
   - Click **Open full** to jump directly to the full 3-pane Knowledge view.
4. **Bi-Directional Wiki-Links (`[[ ... ]]`):**  
   In any note, type `[[` to open instant autocomplete:
   - Link to another note: `[[Deep Learning Architectures]]`
   - Link to a document: `[[mereth://doc/attention-is-all-you-need]]`
   - Link to a specific annotation: `[[mereth://ann/theorem-4-proof]]`
5. **Evidence Blocks:**  
   Notes can embed immutable evidence cards. Clicking an evidence block navigates immediately back to the source PDF and pulses the highlighted text.

---

## 4. Deliberate Memory & Spaced Retrieval (Review)

Mereth Reader fights the **"Collector's Fallacy"** through **Deliberate Active Recall**:

> **Highlights are NOT Flashcards!**  
> Mereth never creates flashcards automatically. You explicitly choose what is worth remembering by clicking **Remember** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>).

1. **Authoring a Retrieval Prompt:**  
   Select an annotation or note and press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>.  
   Choose from 5 research-backed prompt types:
   - **Focused Q&A:** A direct atomic question with a definitive answer.
   - **Explanation / Mechanism:** "How does X cause Y?" (deep conceptual understanding).
   - **Application / Scenario:** "If condition Z occurs, how should algorithm A behave?"
   - **Contrast / Distinction:** "What is the key structural difference between X and Y?"
   - **Cloze Deletion:** Fill-in-the-blank passage using `{{c1::key concept}}` or `{{c1::key concept::hint}}` syntax. Inactive clozes remain visible as context while the active cloze is concealed.
2. **Conducting a Review Session:**  
   Navigate to the **Review** view on the navigation rail.
   - **Concealed Retrieval:** The answer and source passage remain strictly concealed. Read the prompt, formulate the answer in memory (or type it into the response box), then press <kbd>Space</kbd> or <kbd>Enter</kbd> to reveal.
   - **FSRS-4.5 Spaced Repetition Ratings:**
     - <kbd>1</kbd> (**Again**): Failed recall; resets stability and schedules relearning with a minimum 1-day interval.
     - <kbd>2</kbd> (**Hard**): Recalled with significant mental effort; conservative interval growth.
     - <kbd>3</kbd> (**Good**): Normal successful recall; optimal interval growth based on target retention.
     - <kbd>4</kbd> (**Easy**): Effortless instantaneous recall; extended interval bonus.
3. **The "Return to Source" Loop (<kbd>J</kbd>):**  
   If you need to refresh your understanding of a card, press <kbd>J</kbd> or click **"Open page in PDF (J)"** / **"Open note (J)"**.  
   *Note: In accordance with concealed retrieval, the <kbd>J</kbd> shortcut is enabled only after reveal or an explicit skip.*  
   Mereth jumps directly to the source page, pulsing the evidence highlight. A persistent review session banner allows you to resume your review session seamlessly from any view.

---

## 5. Essential Keyboard Shortcuts Cheat Sheet

| Category | Action | Shortcut |
| :--- | :--- | :--- |
| **View Modes** | Single Page Layout | <kbd>Ctrl</kbd>+<kbd>1</kbd> |
| | Continuous Scroll Layout | <kbd>Ctrl</kbd>+<kbd>2</kbd> |
| | Facing Pages (Two-Up) Layout | <kbd>Ctrl</kbd>+<kbd>3</kbd> |
| | Rotate View Clockwise (90°) | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> |
| | Zoom In / Zoom Out / Reset | <kbd>Ctrl</kbd>+<kbd>+</kbd> / <kbd>Ctrl</kbd>+<kbd>-</kbd> / <kbd>Ctrl</kbd>+<kbd>0</kbd> |
| | Fit Width / Fit Page | <kbd>Alt</kbd>+<kbd>W</kbd> / <kbd>Alt</kbd>+<kbd>P</kbd> |
| **Panes** | Toggle Left Outline & Thumbnails | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> |
| | Toggle Right Notes & Annotations | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> |
| | Reading-Only / Fullscreen Canvas | <kbd>F11</kbd> or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> |
| **Navigation** | Page Up / Page Down | <kbd>PageUp</kbd> / <kbd>PageDown</kbd> |
| | First Page / Last Page | <kbd>Home</kbd> / <kbd>End</kbd> |
| | History Back / Forward | <kbd>Alt</kbd>+<kbd>Left</kbd> / <kbd>Alt</kbd>+<kbd>Right</kbd> |
| **Search** | Open Document Search | <kbd>Ctrl</kbd>+<kbd>F</kbd> |
| | Next Search Result | <kbd>F3</kbd> or <kbd>Enter</kbd> |
| | Previous Search Result | <kbd>Shift</kbd>+<kbd>F3</kbd> or <kbd>Shift</kbd>+<kbd>Enter</kbd> |
| **Annotations** | Highlight Yellow (Claim) | <kbd>Alt</kbd>+<kbd>1</kbd> |
| | Highlight Green (Evidence) | <kbd>Alt</kbd>+<kbd>2</kbd> |
| | Area Capture Figure / Diagram | <kbd>Alt</kbd>+<kbd>A</kbd> |
| | Bookmark Current Page | <kbd>Alt</kbd>+<kbd>B</kbd> |
| | Undo Last Annotation Action | <kbd>Ctrl</kbd>+<kbd>Z</kbd> |
| **Notes** | Open Quick Note Composer | <kbd>Alt</kbd>+<kbd>N</kbd> |
| | Quick Note Newline | <kbd>Enter</kbd> |
| | Quick Note Save | <kbd>Ctrl</kbd>+<kbd>Enter</kbd> |
| | Quick Note Discard / Close | <kbd>Escape</kbd> |
| **Review** | Remember Selected Evidence | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> |
| | Reveal Concealed Answer | <kbd>Space</kbd> or <kbd>Enter</kbd> |
| | Rate: Again / Hard / Good / Easy | <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> / <kbd>4</kbd> |
| | Jump to Source (post-reveal) | <kbd>J</kbd> |

---

## 6. Data Ownership, Backups & Privacy

- **100% Offline & Zero Telemetry:** Mereth runs locally. It sends zero telemetry, requires no accounts or login, and makes no network requests.
- **Non-Destructive by Default:** Your original PDF files are never modified. All annotations, crops, notes, and schedules are stored in your local SQLite database.
- **Data Portability:**  
  - Export notes as standard **Markdown packages** with local images and YAML frontmatter (compatible with Obsidian, Logseq, and Foam).
  - Export full **JSON backups** to restore on a fresh installation.
  - Export review prompts to **CSV / TSV** for importing into Anki.
