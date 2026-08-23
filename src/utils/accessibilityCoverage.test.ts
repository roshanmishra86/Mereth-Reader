import { describe, it, expect } from 'vitest';
import { SHORTCUT_LIST, checkShortcutCollision } from './shortcutUtils';
import { calculateContrastRatio, meetsWcagAA } from './contrastChecker';
import { findFocusableElements, getNextFocusableElement } from './focusTrap';
import { paletteLabelFor, DEFAULT_ANNOTATION_PALETTE } from './annotationTypes';

function createMockElement(id: string): HTMLElement {
  return { id } as unknown as HTMLElement;
}

function createMockContainer(elements: HTMLElement[]): HTMLElement {
  return {
    querySelectorAll: () => elements,
    contains: (other: Node | null) => elements.includes(other as unknown as HTMLElement),
  } as unknown as HTMLElement;
}

describe('Task 5.2 Accessibility and Keyboard Coverage (PRD §8.3, §17.4)', () => {
  describe('1. Keyboard Navigation and Shortcut Coverage', () => {
    it('provides exhaustive default shortcuts for core reader workflows without mouse', () => {
      const requiredCategories = [
        'View',
        'Navigation',
        'Search',
        'Panes & Mode',
        'Annotations & Notes',
      ];

      for (const category of requiredCategories) {
        const matching = SHORTCUT_LIST.filter((s) => s.category === category);
        expect(matching.length).toBeGreaterThan(0);
      }

      const requiredIds = [
        'view.single',
        'view.continuous',
        'view.facing',
        'nav.page.next',
        'nav.page.prev',
        'search.focus',
        'pane.left.toggle',
        'pane.right.toggle',
        'annot.highlight.yellow',
        'annot.undo',
      ];

      for (const id of requiredIds) {
        const found = SHORTCUT_LIST.find((s) => s.id === id);
        expect(found).toBeDefined();
        expect(found?.keys.length).toBeGreaterThan(0);
      }
    });

    it('detects and prevents shortcut collisions for accessibility reliability', () => {
      const first = SHORTCUT_LIST[0];
      const collision = checkShortcutCollision('random.other.id', first.keys, SHORTCUT_LIST);
      expect(collision.hasCollision).toBe(true);
      expect(collision.conflictingShortcut?.id).toBe(first.id);

      const nonCollision = checkShortcutCollision('test.id', 'Ctrl + Alt + Shift + Z', SHORTCUT_LIST);
      expect(nonCollision.hasCollision).toBe(false);
    });
  });

  describe('2. Modal Focus Trap and Focus Restoration Contract', () => {
    it('restricts Tab navigation within modal containers to prevent keyboard trapping outside', () => {
      const el1 = createMockElement('close-btn');
      const el2 = createMockElement('text-input');
      const el3 = createMockElement('cancel-btn');
      const el4 = createMockElement('confirm-btn');
      const modal = createMockContainer([el1, el2, el3, el4]);

      const focusable = findFocusableElements(modal);
      expect(focusable.length).toBe(4);

      // Verify cycling backwards from first element wraps to last
      const prevFromFirst = getNextFocusableElement(modal, focusable[0], true);
      expect(prevFromFirst?.id).toBe('confirm-btn');

      // Verify cycling forwards from last element wraps to first
      const nextFromLast = getNextFocusableElement(modal, focusable[focusable.length - 1], false);
      expect(nextFromLast?.id).toBe('close-btn');
    });
  });

  describe('3. Non-Color Semantic Annotation Indicators', () => {
    it('ensures color is never the only signal by mapping every palette entry to a semantic label', () => {
      for (const entry of DEFAULT_ANNOTATION_PALETTE) {
        const label = paletteLabelFor(entry.key, DEFAULT_ANNOTATION_PALETTE);
        expect(label).toBeTruthy();
        expect(label).not.toBe('Annotation');
        expect(typeof entry.label).toBe('string');
        expect(entry.label.length).toBeGreaterThan(0);
      }
    });
  });

  describe('4. WCAG 2.1 AA Contrast Ratio Verification', () => {
    it('verifies light theme core elements achieve WCAG AA contrast (>= 4.5:1)', () => {
      // Body text #201e1d on #f3f2f2 background
      const body = meetsWcagAA('#201e1d', '#f3f2f2');
      expect(body.meetsAA).toBe(true);
      expect(body.ratio).toBeGreaterThanOrEqual(10.0);

      // Secondary text #444141 on #f3f2f2
      const secondary = meetsWcagAA('#444141', '#f3f2f2');
      expect(secondary.meetsAA).toBe(true);
      expect(secondary.ratio).toBeGreaterThanOrEqual(7.0);

      // Accent eyebrow text #ae1800 on #eae9e9
      const eyebrow = meetsWcagAA('#ae1800', '#eae9e9');
      expect(eyebrow.meetsAA).toBe(true);
      expect(eyebrow.ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('verifies dark theme core elements achieve WCAG AA contrast (>= 4.5:1)', () => {
      // Body text #f3f2f2 on #201e1d background
      const darkBody = meetsWcagAA('#f3f2f2', '#201e1d');
      expect(darkBody.meetsAA).toBe(true);
      expect(darkBody.ratio).toBeGreaterThanOrEqual(10.0);

      // Muted text #d7d3d3 on #201e1d
      const darkMuted = meetsWcagAA('#d7d3d3', '#201e1d');
      expect(darkMuted.meetsAA).toBe(true);
      expect(darkMuted.ratio).toBeGreaterThanOrEqual(7.0);
    });
  });
});
