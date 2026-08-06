/**
 * Centralized Keyboard Shortcuts Registry & Resolution for Mereth Reader (PRD FR-8.7).
 * Maps shortcuts to reader actions, formats platform-specific key names,
 * and builds contextual tooltips with unavailable explanations.
 * Strict TypeScript without `any`.
 */

export interface KeyboardShortcut {
  id: string;
  name: string;
  category: 'View' | 'Navigation' | 'Search' | 'Panes & Mode' | 'Annotations & Notes';
  keys: string; // Display key combo, e.g. "Ctrl + Shift + F"
  description: string;
  match: (e: KeyboardEvent) => boolean;
}

export const SHORTCUT_LIST: KeyboardShortcut[] = [
  // View Modes & Zoom
  {
    id: 'view.single',
    name: 'Single Page View',
    category: 'View',
    keys: 'Ctrl + 1',
    description: 'Switch layout to single page view',
    match: (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '1',
  },
  {
    id: 'view.continuous',
    name: 'Continuous View',
    category: 'View',
    keys: 'Ctrl + 2',
    description: 'Switch layout to continuous vertical scroll',
    match: (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '2',
  },
  {
    id: 'view.facing',
    name: 'Facing Pages View',
    category: 'View',
    keys: 'Ctrl + 3',
    description: 'Switch layout to facing pages (two-up)',
    match: (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '3',
  },
  {
    id: 'view.rotate.cw',
    name: 'Rotate View Clockwise',
    category: 'View',
    keys: 'Ctrl + Shift + R',
    description: 'Rotate the document view 90° clockwise',
    match: (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'r',
  },
  {
    id: 'view.zoom.in',
    name: 'Zoom In',
    category: 'View',
    keys: 'Ctrl + +',
    description: 'Increase zoom level up to 500%',
    match: (e) => (e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '='),
  },
  {
    id: 'view.zoom.out',
    name: 'Zoom Out',
    category: 'View',
    keys: 'Ctrl + -',
    description: 'Decrease zoom level down to 25%',
    match: (e) => (e.ctrlKey || e.metaKey) && e.key === '-',
  },
  {
    id: 'view.zoom.reset',
    name: 'Reset Zoom',
    category: 'View',
    keys: 'Ctrl + 0',
    description: 'Reset zoom level to 100%',
    match: (e) => (e.ctrlKey || e.metaKey) && e.key === '0',
  },
  {
    id: 'view.zoom.fitWidth',
    name: 'Fit Width',
    category: 'View',
    keys: 'Alt + W',
    description: 'Fit page width to workspace window',
    match: (e) => e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'w',
  },
  {
    id: 'view.zoom.fitPage',
    name: 'Fit Page',
    category: 'View',
    keys: 'Alt + P',
    description: 'Fit full page to workspace window',
    match: (e) => e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'p',
  },

  // Navigation
  {
    id: 'nav.history.back',
    name: 'History Back',
    category: 'Navigation',
    keys: 'Alt + Left',
    description: 'Jump back to previously visited page position',
    match: (e) => e.altKey && e.key === 'ArrowLeft',
  },
  {
    id: 'nav.history.forward',
    name: 'History Forward',
    category: 'Navigation',
    keys: 'Alt + Right',
    description: 'Jump forward to next page in history stack',
    match: (e) => e.altKey && e.key === 'ArrowRight',
  },
  {
    id: 'nav.page.prev',
    name: 'Previous Page',
    category: 'Navigation',
    keys: 'PageUp',
    description: 'Navigate to previous page',
    match: (e) => e.key === 'PageUp',
  },
  {
    id: 'nav.page.next',
    name: 'Next Page',
    category: 'Navigation',
    keys: 'PageDown',
    description: 'Navigate to next page',
    match: (e) => e.key === 'PageDown',
  },
  {
    id: 'nav.page.first',
    name: 'First Page',
    category: 'Navigation',
    keys: 'Home',
    description: 'Jump directly to first page',
    match: (e) => e.key === 'Home',
  },
  {
    id: 'nav.page.last',
    name: 'Last Page',
    category: 'Navigation',
    keys: 'End',
    description: 'Jump directly to last page',
    match: (e) => e.key === 'End',
  },

  // Search
  {
    id: 'search.focus',
    name: 'Search Document',
    category: 'Search',
    keys: 'Ctrl + F',
    description: 'Open and focus full-text reader search bar',
    match: (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'f',
  },
  {
    id: 'search.next',
    name: 'Next Match',
    category: 'Search',
    keys: 'F3 / Enter',
    description: 'Jump to next matching text result',
    match: (e) => e.key === 'F3' && !e.shiftKey,
  },
  {
    id: 'search.prev',
    name: 'Previous Match',
    category: 'Search',
    keys: 'Shift + F3 / Shift + Enter',
    description: 'Jump to previous matching text result',
    match: (e) => e.key === 'F3' && e.shiftKey,
  },

  // Panes & Modes
  {
    id: 'mode.readingOnly',
    name: 'Reading-Only Mode / Fullscreen',
    category: 'Panes & Mode',
    keys: 'F11 / Ctrl + Shift + F',
    description: 'Toggle reading-only mode / presentation canvas',
    match: (e) => e.key === 'F11' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f'),
  },
  {
    id: 'pane.left.toggle',
    name: 'Toggle Outline & Thumbnails Pane',
    category: 'Panes & Mode',
    keys: 'Ctrl + Shift + L',
    description: 'Show or hide left navigation sidebar',
    match: (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l',
  },
  {
    id: 'pane.right.toggle',
    name: 'Toggle Annotations & Notes Side Pane',
    category: 'Panes & Mode',
    keys: 'Ctrl + Alt + S',
    description: 'Show or hide right annotations/note sidebar',
    match: (e) => (e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 's',
  },

  // Annotations & Notes
  {
    id: 'annot.highlight.yellow',
    name: 'Yellow Highlight (Evidence)',
    category: 'Annotations & Notes',
    keys: 'Alt + 1',
    description: 'Highlight selected text with Yellow (Evidence label)',
    match: (e) => e.altKey && !e.ctrlKey && e.key === '1',
  },
  {
    id: 'annot.highlight.green',
    name: 'Green Highlight (Claim)',
    category: 'Annotations & Notes',
    keys: 'Alt + 2',
    description: 'Highlight selected text with Green (Claim label)',
    match: (e) => e.altKey && !e.ctrlKey && e.key === '2',
  },
  {
    id: 'annot.remember',
    name: 'Remember Selected Evidence',
    category: 'Annotations & Notes',
    keys: 'Ctrl + Shift + M',
    description: 'Draft a retrieval review prompt from selected text',
    match: (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm',
  },
];

/**
 * Resolves a keyboard event to a matching shortcut ID if applicable.
 */
export function resolveShortcutAction(event: KeyboardEvent): string | null {
  for (const sc of SHORTCUT_LIST) {
    if (sc.match(event)) {
      return sc.id;
    }
  }
  return null;
}

/**
 * Formats a control tooltip string with optional shortcut key and contextual unavailable state (FR-8.7).
 */
export function formatControlTooltip(
  label: string,
  shortcutId?: string,
  unavailableReason?: string
): string {
  const shortcutObj = SHORTCUT_LIST.find((s) => s.id === shortcutId);
  const keyPart = shortcutObj ? ` (${shortcutObj.keys})` : '';

  if (unavailableReason) {
    return `${label}${keyPart} — ${unavailableReason}`;
  }
  return `${label}${keyPart}`;
}
