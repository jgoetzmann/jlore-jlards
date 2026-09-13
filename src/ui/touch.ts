/**
 * Touch paths for things a mouse reaches by hovering.
 *
 * A card face has two touch gestures on top of whatever its click does:
 *
 *   - **Long-press** (LONG_PRESS_MS) on any card opens the full card preview as
 *     a dismissable sheet, and swallows the click that follows, so reading a
 *     card in your hand never plays it.
 *   - **Tap** (a press that lifts inside PRESS_SLOP_PX) on a card that has no
 *     click action of its own — a pile top you can't buy, an in-play chip, a
 *     graveyard chip, an opponent's card — lights the cards it references
 *     (links.ts) on the table, with nothing covering them. A second tap on the
 *     same card, or a tap on empty table, puts them out. A card that
 *     references nothing opens the preview sheet on a tap instead, so its text
 *     is still one tap away. A card with an action (a hand card, a buyable
 *     pile, a prompt option's button) keeps that action on a tap.
 *
 * The highlight is set when the tap completes, never on pointerdown, and a
 * press that travels past the slop or is cancelled by the browser (a scroll)
 * clears the highlight that card set: scrolling never leaves cards lit (MOB-2).
 *
 * The sheet's "Mentions" chips close the sheet, light the sheet card's links
 * and scroll the first referenced face into view (`followMention`), so every
 * card, including ones with an action, has a touch path to a visible highlight.
 * Closing the sheet leaves a highlight alone (MOB-1).
 *
 * A mouse is untouched: it keeps the hover preview, and nothing here runs for
 * `pointerType === 'mouse'`.
 */

import React from 'react';
import type { CardDefId, CardView } from '@engine/types';
import { closePreviewSheet, openPreviewSheet } from './preview';
import { clearLinkSource, getLinkSource, linkedDefIds, setLinkSource } from './links';

/** How long a press has to be held to read as "show me this card". */
export const LONG_PRESS_MS = 450;

/** A press that travels further than this is a scroll, not a press. */
export const PRESS_SLOP_PX = 10;

const TAP_ACTION_SELECTOR = 'button, a[href], input, select, textarea, label, [role="button"]';

/** Where a tap never counts as "empty table": a card face, or inside the preview sheet. */
const NOT_TAP_AWAY_SELECTOR = '[data-card-id], .card-preview-sheet';

/** True when an ancestor of `el` (not `el` itself) already answers a tap. */
export function insideTapAction(el: Element | null): boolean {
  const parent = el?.parentElement ?? null;
  return parent !== null && parent.closest(TAP_ACTION_SELECTOR) !== null;
}

/** True when the pointer has travelled from `start` past PRESS_SLOP_PX. */
export function pastSlop(start: { x: number; y: number }, point: { x: number; y: number }): boolean {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  return dx * dx + dy * dy > PRESS_SLOP_PX * PRESS_SLOP_PX;
}

/**
 * What the click that ends a gesture on a card face does.
 *
 *   - `pass`     not ours: the face's (or its ancestor's) own click runs.
 *   - `swallow`  ours, and nothing else happens (a long press already opened
 *                the sheet, or the finger slid past the slop).
 *   - `light`    light this card's references.
 *   - `unlight`  this card's references are lit: put them out.
 *   - `sheet`    this card references nothing: open its preview sheet.
 */
export type TapOutcome = 'pass' | 'swallow' | 'light' | 'unlight' | 'sheet';

export interface TapFacts {
  /** The gesture came from a finger. */
  touch: boolean;
  /** The long press fired during this gesture. */
  longPressFired: boolean;
  /** The finger travelled past the slop during this gesture. */
  moved: boolean;
  /** The face has a click action of its own. */
  hasOwnAction: boolean;
  /** An ancestor of the face answers taps (a prompt option's button). */
  insideTapAction: boolean;
  /** The card references at least one other card. */
  hasLinks: boolean;
  /** The current highlight was set by this very face. */
  ownsHighlight: boolean;
}

export function decideTap(f: TapFacts): TapOutcome {
  if (f.longPressFired) return 'swallow';
  if (!f.touch) return 'pass';
  if (f.hasOwnAction || f.insideTapAction) return 'pass';
  if (f.moved) return 'swallow';
  if (!f.hasLinks) return 'sheet';
  return f.ownsHighlight ? 'unlight' : 'light';
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
   * press, or a tap on a card with no action of its own (which lights its
   * links or opens the sheet) — and the caller must do nothing else with it.
   */
  takeClick: (e: React.MouseEvent<HTMLElement>, hasOwnAction: boolean) => boolean;
  /** The gesture in progress (or the last one) came from a finger. */
  isTouch: () => boolean;
  /** Stop a pending long press (unmount). */
  dispose: () => void;
}

type PointerLike = Pick<PointerEvent, 'pointerType' | 'clientX' | 'clientY'>;
type ClickLike = { currentTarget: Element | null; preventDefault(): void; stopPropagation(): void };

/**
 * The gesture tracker behind `useCardPress`, outside React so the unit suite
 * can drive it with plain event objects and fake timers.
 */
export function createCardPress(getCard: () => CardView, enabled: boolean): CardPress {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let fired = false;
  let moved = false;
  let touch = false;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    onPointerDown(e) {
      const p = e as unknown as PointerLike;
      touch = p.pointerType === 'touch';
      fired = false;
      moved = false;
      start = null;
      cancel();
      if (!enabled || !touch) return;
      start = { x: p.clientX, y: p.clientY };
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        openPreviewSheet(getCard());
      }, LONG_PRESS_MS);
    },
    onPointerMove(e) {
      if (start === null || moved || fired) return;
      const p = e as unknown as PointerLike;
      if (!pastSlop(start, { x: p.clientX, y: p.clientY })) return;
      moved = true;
      cancel();
      clearLinkSource(getCard().iid);
    },
    onPointerUp: cancel,
    onPointerCancel() {
      cancel();
      if (!enabled || !touch || fired) return;
      // The browser took the pointer over for a scroll.
      moved = true;
      clearLinkSource(getCard().iid);
    },
    onContextMenu(e) {
      // The long press is ours; the OS menu would sit on top of the sheet.
      if (touch && (timer !== null || fired)) e.preventDefault();
    },
    takeClick(e, hasOwnAction) {
      if (!enabled) return false;
      const c = e as unknown as ClickLike;
      const card = getCard();
      const src = getLinkSource();
      const outcome = decideTap({
        touch,
        longPressFired: fired,
        moved,
        hasOwnAction,
        insideTapAction: insideTapAction(c.currentTarget),
        hasLinks: linkedDefIds(card.defId).size > 0,
        ownsHighlight: src !== null && src.owner === card.iid && src.defId === card.defId,
      });
      fired = false;
      switch (outcome) {
        case 'pass':
          return false;
        case 'swallow':
          c.preventDefault();
          c.stopPropagation();
          return true;
        case 'light':
          lightLinksByTouch(card.defId, card.iid);
          return true;
        case 'unlight':
          clearLinkSource(card.iid);
          return true;
        case 'sheet':
          openPreviewSheet(card);
          return true;
      }
    },
    isTouch: () => touch,
    dispose: cancel,
  };
}

export function useCardPress(card: CardView, enabled: boolean): CardPress {
  const cardRef = React.useRef(card);
  cardRef.current = card;
  const press = React.useMemo(() => createCardPress(() => cardRef.current, enabled), [enabled]);
  React.useEffect(() => press.dispose, [press]);
  return press;
}

// ---------------------------------------------------------------------------
// The touch highlight: lit by a tap, out on a tap on empty table
// ---------------------------------------------------------------------------

/** Light `defId`'s references on behalf of a touch, and arm the tap-away. */
export function lightLinksByTouch(defId: CardDefId, owner: string): void {
  setLinkSource(defId, owner);
  installTapAway();
}

/**
 * Whether a finger that went down on `down` and lifted at `up` puts a touch
 * highlight out: it must be a tap (inside the slop) that started on neither a
 * card face nor the preview sheet. `down === null` means the press started
 * somewhere that never counts, or the browser cancelled it.
 */
export function tapAwayClears(
  down: { x: number; y: number; away: boolean } | null,
  up: { x: number; y: number },
): boolean {
  return down !== null && down.away && !pastSlop(down, up);
}

/** Whether a press starting on `el` could be a tap on empty table. */
export function isTapAwayTarget(el: Element | null): boolean {
  return el !== null && el.closest(NOT_TAP_AWAY_SELECTOR) === null;
}

/**
 * Touch has no pointer-leave worth trusting (it fires on every lift), so a
 * tapped card's highlight holds until a *tap* lands somewhere that is not a
 * card face — a scroll that starts on the table leaves it lit, so you can go
 * and look at what lit up. Taps inside the preview sheet (its backdrop, Close)
 * never count: closing the sheet keeps the highlight. A mouse clears on leave
 * instead and is ignored here.
 */
let tapAwayInstalled = false;

function installTapAway(): void {
  if (tapAwayInstalled || typeof document === 'undefined') return;
  tapAwayInstalled = true;
  let down: { x: number; y: number; away: boolean; id: number } | null = null;
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse') {
        down = null;
        return;
      }
      const t = e.target instanceof Element ? e.target : null;
      down = { x: e.clientX, y: e.clientY, away: isTapAwayTarget(t), id: e.pointerId };
    },
    true,
  );
  document.addEventListener(
    'pointerup',
    (e) => {
      if (e.pointerType === 'mouse' || down === null || down.id !== e.pointerId) return;
      const clears = tapAwayClears(down, { x: e.clientX, y: e.clientY });
      down = null;
      if (clears) clearLinkSource();
    },
    true,
  );
  document.addEventListener(
    'pointercancel',
    () => {
      down = null;
    },
    true,
  );
}

// ---------------------------------------------------------------------------
// The sheet's "Mentions" chips
// ---------------------------------------------------------------------------

/**
 * A tap on a Mentions chip in `sheetCard`'s preview sheet: close the sheet,
 * light `sheetCard`'s references, and bring the first face of `targetDefId`
 * on the table into view. Safe without a DOM (the unit suite).
 */
export function followMention(sheetCard: CardView, targetDefId: CardDefId): void {
  closePreviewSheet();
  lightLinksByTouch(sheetCard.defId, sheetCard.iid);
  if (typeof document === 'undefined') return;
  const faces = Array.from(document.querySelectorAll(`[data-card-id="${cssEscape(targetDefId)}"]`));
  const face = faces.find(
    (el) => el.closest('.card-preview-sheet, .card-preview-layer') === null && el.getClientRects().length > 0,
  );
  face?.scrollIntoView({ block: 'center', inline: 'nearest' });
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}
