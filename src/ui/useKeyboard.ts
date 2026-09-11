/**
 * Binds the keymap in `keys.ts` to the window.
 *
 * The listener is attached once and reads the latest context and handler
 * through refs, so a table that re-renders every second (it does — the turn
 * clock ticks at 4Hz) is not adding and removing a window listener every time.
 *
 * Deliberately on `window` rather than a focused container: a player who just
 * clicked a shop pile should still be able to press E, and requiring them to
 * click "the board" first to restore keyboard focus is exactly the kind of
 * invisible modality this pass exists to remove.
 */

import React from 'react';
import { keyIntent, type KeyContext, type KeyIntent } from './keys';

function editableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return el.isContentEditable === true;
}

function focusedTagName(): string | null {
  if (typeof document === 'undefined') return null;
  const el = document.activeElement as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return null;
  return el.tagName.toLowerCase();
}

export function useKeyboard(
  context: Omit<KeyContext, 'editing' | 'focusedTag'>,
  onIntent: (intent: KeyIntent) => void,
  enabled = true,
): void {
  const contextRef = React.useRef(context);
  contextRef.current = context;
  const handlerRef = React.useRef(onIntent);
  handlerRef.current = onIntent;

  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const intent = keyIntent(e, {
        ...contextRef.current,
        editing: editableTarget(e.target),
        focusedTag: focusedTagName(),
      });
      if (!intent) return;
      // Space scrolls and "/" opens quick-find in some browsers; a keystroke we
      // claimed must not also do its default thing.
      e.preventDefault();
      handlerRef.current(intent);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

export default useKeyboard;
