---
name: Mereth Reader
description: A quiet Modernist research desk for source-grounded reading and deliberate memory.
colors:
  ground: "#f3f2f2"
  surface: "#eae9e9"
  ink: "#201e1d"
  ink-muted: "#605d5d"
  divider: "rgba(32, 30, 29, 0.40)"
  accent: "#ec3013"
  accent-deep: "#ae1800"
  annotation-claim: "#d9bd3a"
  annotation-evidence: "#8fb583"
  annotation-question: "#7ea3c6"
  annotation-disagree: "#ec3013"
  annotation-support: "#9b9797"
typography:
  display:
    fontFamily: "Archivo, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: "-0.015em"
  heading:
    fontFamily: "Archivo, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Archivo, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Archivo, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  none: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ground}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
    height: "36px"
  rail-item:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    width: "66px"
  annotation-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "12px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "16px"
    width: "440px"
---

# Design System: Mereth Reader

## Overview

**Creative North Star: “Quiet Research Desk”**

Mereth is a focused work surface, not a decorative productivity dashboard. The document, its provenance, and the reader’s current thought command the hierarchy. Navigation and tools remain precise and discoverable, then visually recede.

The ignored Modernist mock-up is the normative visual target. Its architectural grid, flush-left alignment, strong rules, near-monochrome palette, square geometry, and sparse red accent take precedence over incidental hard-coded values in the current implementation. Zotero informs interaction quality only; Mereth must not imitate Zotero’s visual language.

**Key characteristics:**

- Flat, architectural surfaces divided by visible structure.
- Dense enough for research work, never crowded around the page.
- One red interface accent, used selectively.
- Explicit provenance and state, with text or icons supporting color.
- Keyboard-complete, scaling-resilient, and calm in motion.

## Colors

The palette is warm-neutral paper and ink with one urgent red voice. Semantic annotation colors classify evidence; they are not additional brand accents.

### Primary

- **Signal Red** (`#ec3013`): primary actions, active rails or tabs, focus outlines, selection emphasis, and the Disagree annotation role.
- **Deep Signal** (`#ae1800`): accessible small red text, pressed states, and strong active labels on light surfaces.

### Neutral

- **Desk Ground** (`#f3f2f2`): application ground and active inset surfaces.
- **Work Surface** (`#eae9e9`): rails, panes, fields, toolbars, and dialogs.
- **Desk Ink** (`#201e1d`): primary text and major structural rules.
- **Muted Ink** (`#605d5d`): secondary metadata and inactive labels.
- **Structural Divider** (`rgba(32, 30, 29, 0.40)`): pane boundaries and control borders; major boundaries are 2px.

### Semantic annotations

- **Claim** (`#d9bd3a`), **Evidence** (`#8fb583`), **Question** (`#7ea3c6`), **Disagree** (`#ec3013`), and **Support** (`#9b9797`) are the shipped defaults.
- Always render the semantic label in lists, menus, tooltips, and accessible names. Color alone never carries meaning.
- User-configured palettes may replace these values while preserving the same contrast, labeling, and non-color requirements.

**The One Red Voice Rule.** Signal Red is the only interface accent. Annotation colors may mark evidence, but must not leak into general navigation or decoration.

## Typography

**Display Font:** Archivo with Arial and `sans-serif` fallbacks

**Body Font:** Archivo with Arial and `sans-serif` fallbacks
**Label Font:** Archivo with Arial and `sans-serif` fallbacks

Archivo must be self-hosted in the packaged application. Do not load fonts from Google Fonts or any other network origin. Headings use weight 800; reading and interface copy use weight 400. Weight 600 is reserved for compact emphasis when 800 would make dense UI noisy.

### Hierarchy

- **Display** (800, 32px, 1.12): major empty states and section introductions; rare inside the reader.
- **Heading** (800, 20px, 1.12): pane and dialog titles.
- **Body** (400, 14px, 1.55): interface prose and note content; long reading lines should remain near 65–75 characters.
- **Label** (800, 11px, 1.2, 0.08em): compact navigation, metadata headings, and controls; uppercase only for short structural labels.
- **Numerals:** use tabular numerals for page counters, dates, durations, queue counts, and aligned statistics.

**The Reading Voice Rule.** Large, heavy type establishes structure; regular-weight type carries thought. Do not make the whole application shout in bold uppercase.

## Layout

The desktop shell uses a 66px navigation rail and independent panes around the reading canvas. The reader has three zones: a collapsible outline or thumbnail pane, a flexible page canvas, and a collapsible annotation or note pane. Panes scroll independently so navigation and notes never move the source page unexpectedly.

Use the 4/8/12/16/24/32 spacing scale. Align edges to a visible modular grid and keep labels, buttons, form copy, and pane content flush left. Major pane and section divisions use 2px structural rules; internal rows may use 1px rules. Whitespace supports the grid but never replaces its essential boundaries.

The minimum supported window is 1024 × 640 CSS pixels. At constrained widths, collapse the right pane first, then the left pane; keep the page canvas and primary reader controls reachable. Below 1180px, avoid opening both side panes automatically. Below 1024px, treat the window as constrained rather than shrinking controls below their usable size. Windows scaling from 100–200% and app text from 80–150% must preserve access through overflow, wrapping, or deterministic collapse. Document zoom remains independent.

## Elevation & Depth

Surfaces are flat by default. Tonal changes and rules establish hierarchy. Shadows are reserved for the PDF sheet, transient selection UI or context menus, and modal dialogs—elements whose layer relationship would otherwise be ambiguous.

### Shadow vocabulary

- **PDF Sheet:** `0 3px 10px rgba(45, 43, 43, 0.16)` separates white paper from the desk ground.
- **Transient UI:** `0 6px 18px rgba(45, 43, 43, 0.20)` supports selection controls and context menus without making them ornamental.
- **Dialog:** `0 12px 32px rgba(45, 43, 43, 0.22)` is the maximum elevation.

**The Flat-by-Default Rule.** A persistent pane, row, card, or toolbar does not receive a shadow. If a rule or tonal layer can explain the boundary, use it.

## Shapes

All application geometry has zero radius. Buttons, fields, tabs, menus, dialogs, badges, annotation rows, and review controls are square. Use borders, blocks, underlines, and left-edge markers to express selection and hierarchy. Do not introduce rounded cards, capsules, or pill filters. Circular radio indicators are the sole native semantic exception.

## Components

### Buttons

- Use square, flush-left labels with a minimum 36px height. Primary buttons use Signal Red on Desk Ground; secondary buttons use Work Surface with a structural border; ghost buttons use transparent ground.
- Hover changes fill or border tone. Pressed primary actions move to Deep Signal. Disabled controls remain legible and include a programmatic disabled state.
- Every button has a 2px Signal Red `:focus-visible` outline with 2px offset. Use Lucide icons where an established icon exists; icon-only controls require accessible labels and tooltips.

### Inputs and search

- Fields use Work Surface, a 1px structural border, zero radius, and at least 36px height.
- Focus changes the border to Signal Red and adds the standard focus outline. Search exposes clear, pending-index, partial-coverage, no-result, and error states without changing field width.
- Placeholder text never substitutes for a persistent label where the expected input is not obvious.

### Rail items

- Each item occupies the full 66px rail width and pairs a Lucide icon with a short label.
- Active state uses a 3px red left rule, Desk Ground, `aria-current="page"`, and ink text. Hover uses a neutral tint; badges are square red counters.

### Pane tabs

- Tabs form a single ruled strip. Active state uses Deep Signal text and a 2px red bottom rule; inactive tabs remain muted.
- Support arrow-key navigation, visible focus, and correct tab semantics. At narrow widths, preserve labels or provide an accessible overflow menu rather than clipping actions.

### Annotation swatches and filters

- Swatches show both color and semantic label. Selected filters gain a strong rule or check icon, not color alone.
- The popup, custom context menu, and keyboard shortcuts operate on the same immutable selection snapshot. They remain available after the browser selection collapses and dismiss only after an explicit action, Escape, or outside interaction.

### Annotation rows

- Rows are flat, separated by rules, and show source excerpt, semantic label, page, comment state, and tags in that order.
- Hover and keyboard focus expose row actions without moving content. Painted highlight geometry must have an explicit hit target and accessible name.

### Selection popup and context menu

- Use Transient UI elevation, zero radius, a structural border, and compact 36px actions. Place without obscuring the selected evidence where possible.
- Preserve captured quote, page, geometry, prefix/suffix context, and document-version identity until the action completes or is cancelled.

### Dialogs

- Dialogs are square Work Surface panels with a 2px top or side rule, Dialog elevation, descriptive title, focus trap, Escape behavior, and focus restoration.
- Primary action comes last in keyboard and visual order. Destructive actions state the consequence and offer recovery where possible.

### Review-rating controls

- Again, Hard, Good, and Easy form one ruled control group with tabular next-interval previews. Do not map quality to celebratory colors or gamified feedback.
- Source content remains concealed until attempt or skip. Focus, selected state, and keyboard shortcuts are visible and announced.

## Do's and Don'ts

### Do:

- **Do** let the modular grid and strong 2px rules organize the workspace.
- **Do** reserve red for primary actions, active structure, focus, and precise emphasis.
- **Do** keep source, user, and future model provenance visually and semantically distinct.
- **Do** use Lucide icons with labels or accessible names instead of Unicode lookalikes.
- **Do** keep reading controls reachable at 1024 × 640 and through supported scaling.
- **Do** respect `prefers-reduced-motion` and the in-app reduced-motion preference.

### Don't:

- **Don't** add gradients, ornamental texture, glass effects, or decorative color washes.
- **Don't** introduce rounded cards, pill-shaped filters, or nested cards inside cards.
- **Don't** use shadows on persistent panes and rows or stack multiple elevation effects.
- **Don't** center wide button labels or replace structural borders with whitespace alone.
- **Don't** imitate Zotero’s branding, pane styling, citation model, or information architecture.
- **Don't** expose future AI, sync, citation, collaboration, EPUB, or mobile work as incomplete v1 UI.
