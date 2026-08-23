import { describe, it, expect } from 'vitest';
import { findFocusableElements, getNextFocusableElement } from './focusTrap';

function createMockElement(id: string): HTMLElement {
  return { id } as unknown as HTMLElement;
}

function createMockContainer(elements: HTMLElement[]): HTMLElement {
  return {
    querySelectorAll: () => elements,
    contains: (other: Node | null) => elements.includes(other as unknown as HTMLElement),
  } as unknown as HTMLElement;
}

describe('Task 5.2 Modal Focus Trapping and Cycling Utilities', () => {
  it('finds all interactive and non-disabled focusable elements in document order', () => {
    const el1 = createMockElement('btn-close');
    const el2 = createMockElement('input-search');
    const el3 = createMockElement('btn-cancel');
    const el4 = createMockElement('btn-submit');
    const el5 = createMockElement('link-docs');
    const container = createMockContainer([el1, el2, el3, el4, el5]);

    const focusable = findFocusableElements(container);
    const ids = focusable.map((el) => el.id);
    expect(ids).toEqual([
      'btn-close',
      'input-search',
      'btn-cancel',
      'btn-submit',
      'link-docs',
    ]);
  });

  it('cycles forward on Tab from last element to first element', () => {
    const el1 = createMockElement('btn-close');
    const el2 = createMockElement('btn-submit');
    const el3 = createMockElement('link-docs');
    const container = createMockContainer([el1, el2, el3]);

    const next = getNextFocusableElement(container, el3, false);
    expect(next?.id).toBe('btn-close');
  });

  it('cycles backward on Shift+Tab from first element to last element', () => {
    const el1 = createMockElement('btn-close');
    const el2 = createMockElement('btn-submit');
    const el3 = createMockElement('link-docs');
    const container = createMockContainer([el1, el2, el3]);

    const prev = getNextFocusableElement(container, el1, true);
    expect(prev?.id).toBe('link-docs');
  });

  it('navigates sequentially between adjacent elements', () => {
    const el1 = createMockElement('input-search');
    const el2 = createMockElement('btn-cancel');
    const el3 = createMockElement('btn-submit');
    const container = createMockContainer([el1, el2, el3]);

    const next = getNextFocusableElement(container, el2, false);
    expect(next?.id).toBe('btn-submit');

    const prev = getNextFocusableElement(container, el2, true);
    expect(prev?.id).toBe('input-search');
  });

  it('handles null or out-of-container current element gracefully', () => {
    const el1 = createMockElement('btn-close');
    const el2 = createMockElement('btn-submit');
    const container = createMockContainer([el1, el2]);
    const externalEl = createMockElement('outside-btn');

    expect(getNextFocusableElement(container, null, false)?.id).toBe('btn-close');
    expect(getNextFocusableElement(container, null, true)?.id).toBe('btn-submit');
    expect(getNextFocusableElement(container, externalEl, false)?.id).toBe('btn-close');
    expect(getNextFocusableElement(container, externalEl, true)?.id).toBe('btn-submit');
  });
});

