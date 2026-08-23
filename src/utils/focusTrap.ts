export const FOCUSABLE_ELEMENTS_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Returns all focusable elements inside a DOM container in logical document order.
 */
export function findFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS_SELECTOR));
}

/**
 * Computes the next element in a focus trap cycle given current active element and direction.
 */
export function getNextFocusableElement(
  container: HTMLElement,
  current: HTMLElement | null,
  backwards: boolean
): HTMLElement | null {
  const elements = findFocusableElements(container);
  if (elements.length === 0) return null;

  if (!current || !container.contains(current)) {
    return backwards ? elements[elements.length - 1] : elements[0];
  }

  const currentIndex = elements.indexOf(current);
  if (currentIndex === -1) {
    return backwards ? elements[elements.length - 1] : elements[0];
  }

  if (backwards) {
    const prevIndex = (currentIndex - 1 + elements.length) % elements.length;
    return elements[prevIndex];
  } else {
    const nextIndex = (currentIndex + 1) % elements.length;
    return elements[nextIndex];
  }
}
