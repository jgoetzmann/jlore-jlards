/**
 * Touch paths for things a mouse reaches by hovering.
 *
 * A card face has two touch gestures on top of whatever its click does:
 *
 *   - **Long-press** (LONG_PRESS_MS) on any card opens the full card preview as
 *     a dismissable sheet, and swallows the click that follows, so reading a
 *     card in your hand never plays it.
 *   - **Tap** on a card that has no click action of its own — a pile top you
 *     can't buy, an in-play chip, a graveyard chip, an opponent's card — opens
 *     the same sheet. A card inside something that answers taps (a prompt
 *     option's button) leaves the tap to that.
 *
 * Both also light the card's references (links.ts). A mouse is untouched: it
 * keeps the hover preview, and nothing here runs for `pointerType === 'mouse'`.
 */

import React from 'react';
import type { CardView } from '@engine/types';
import { openPreviewSheet } from './preview';
import { setLinkSource } from './links';

/** How long a press has to be held to read as "show me this card". */
export const LONG_PRESS_MS = 450;

/** A press that travels further than this is a scroll, not a press. */
export const PRESS_SLOP_PX = 10;

const TAP_ACTION_SELECTOR = 'button, a[href], input, select, textarea, label, [role="button"]';

/** True when an ancestor of `el` (not `el` itself) already answers a tap. */
export function insideTapAction(el: Element | null): boolean {
  const parent = el?.parentElement ?? null;
  return parent !== null && parent.closest(TAP_ACTION_SELECTOR) !== null;
}

export interface CardPress {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  /**
   * Call first in the face's click handler. Returns true when the click
   * belongs to a touch gesture this hook already answered — the end of a long
   * press, or a tap on a card with no action of its own (which opens the
   * sheet) — and the caller must do nothing else with it.
   */
  takeClick: (e: React.MouseEvent<HTMLElement>, hasOwnAction: boolean) => boolean;
  /** The gesture in progress (or the last one) came from a finger. */
  isTouch: () => boolean;
}

export function useCardPress(card: CardView, enabled: boolean): CardPress {
  const cardRef = React.useRef(card);
  cardRef.current = card;
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const fired = React.useRef(false);
  const touch = React.useRef(false);

  const cancel = React.useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  React.useEffect(() => cancel, [cancel]);

  return React.useMemo<CardPress>(
    () => ({
      onPointerDown(e) {
        touch.current = e.pointerType === 'touch';
        fired.current = false;
        cancel();
        if (!enabled || !touch.current) return;
        start.current = { x: e.clientX, y: e.clientY };
        setLinkSource(cardRef.current.defId, cardRef.current.iid);
        timer.current = setTimeout(() => {
          timer.current = null;
          fired.current = true;
          openPreviewSheet(cardRef.current);
        }, LONG_PRESS_MS);
      },
      onPointerMove(e) {
        if (timer.current === null || start.current === null) return;
        const dx = e.clientX - start.current.x;
        const dy = e.clientY - start.current.y;
        if (dx * dx + dy * dy > PRESS_SLOP_PX * PRESS_SLOP_PX) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onContextMenu(e) {
        // The long press is ours; the OS menu would sit on top of the sheet.
        if (touch.current && (timer.current !== null || fired.current)) e.preventDefault();
      },
      takeClick(e, hasOwnAction) {
        if (!enabled) return false;
        if (fired.current) {
          fired.current = false;
          e.preventDefault();
          e.stopPropagation();
          return true;
        }
        if (touch.current && !hasOwnAction && !insideTapAction(e.currentTarget)) {
          openPreviewSheet(cardRef.current);
          return true;
        }
        return false;
      },
      isTouch: () => touch.current,
    }),
    [enabled, cancel],
  );
}
