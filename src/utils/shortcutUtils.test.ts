import { describe, it, expect } from 'vitest';
import {
  resolveShortcutAction,
  formatControlTooltip,
  SHORTCUT_LIST,
} from './shortcutUtils';

describe('shortcutUtils', () => {
  it('resolves Ctrl+Shift+F to reading mode shortcut', () => {
    const event = {
      key: 'f',
      ctrlKey: true,
      shiftKey: true,
    } as unknown as KeyboardEvent;
    expect(resolveShortcutAction(event)).toBe('mode.readingOnly');
  });

  it('resolves Alt+Left to history back shortcut', () => {
    const event = {
      key: 'ArrowLeft',
      altKey: true,
    } as unknown as KeyboardEvent;
    expect(resolveShortcutAction(event)).toBe('nav.history.back');
  });

  it('resolves Ctrl+Shift+R to rotate view clockwise', () => {
    const event = {
      key: 'r',
      ctrlKey: true,
      shiftKey: true,
    } as unknown as KeyboardEvent;
    expect(resolveShortcutAction(event)).toBe('view.rotate.cw');
  });

  it('formats tooltips with shortcuts and unavailable reasons', () => {
    expect(formatControlTooltip('History Back', 'nav.history.back')).toBe(
      'History Back (Alt + Left)'
    );

    expect(
      formatControlTooltip(
        'History Back',
        'nav.history.back',
        'No previous page in history stack'
      )
    ).toBe('History Back (Alt + Left) — No previous page in history stack');

    expect(formatControlTooltip('Fit Page', 'view.zoom.fitPage')).toBe(
      'Fit Page (Alt + P)'
    );
  });

  it('contains complete registry of categories', () => {
    const categories = new Set(SHORTCUT_LIST.map((s) => s.category));
    expect(categories.has('View')).toBe(true);
    expect(categories.has('Navigation')).toBe(true);
    expect(categories.has('Search')).toBe(true);
    expect(categories.has('Panes & Mode')).toBe(true);
    expect(categories.has('Annotations & Notes')).toBe(true);
  });
});
