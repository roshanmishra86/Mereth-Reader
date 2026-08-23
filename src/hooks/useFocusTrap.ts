import { useEffect, useRef } from 'react';

export interface UseFocusTrapOptions {
  isOpen: boolean;
  onClose?: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  autoFocus?: boolean;
}

export const FOCUSABLE_ELEMENTS_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal focus trap hook.
 * 1. Traps Tab and Shift+Tab navigation within the container.
 * 2. Focuses initial interactive element on open.
 * 3. Handles Escape key to close.
 * 4. Restores focus to the opener element when the dialog closes.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>({
  isOpen,
  onClose,
  initialFocusRef,
  autoFocus = true,
}: UseFocusTrapOptions) {
  const containerRef = useRef<T | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  // Keep the latest callback available to the key handler without making the
  // trap effect tear down (and restore focus) whenever a caller passes an
  // inline callback.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current = (document.activeElement as HTMLElement) || null;
    const container = containerRef.current;
    if (!container) return;

    const timer = autoFocus
      ? setTimeout(() => {
          if (initialFocusRef?.current) {
            initialFocusRef.current.focus();
          } else {
            const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS_SELECTOR);
            if (focusable.length > 0) {
              focusable[0].focus();
            } else {
              container.setAttribute('tabindex', '-1');
              container.focus();
            }
          }
        }, 20)
      : null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onCloseRef.current) {
        e.stopPropagation();
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS_SELECTOR)
        );

        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !container.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !container.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === 'function') {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen, autoFocus, initialFocusRef]);

  return containerRef;
}
