/**
 * The hover preview's state (LAY-6).
 *
 * Small cards on the table (pile tiles, the dock hand, the in-play strip,
 * opponents' tableaux) can't show their full rules text. One fixed layer at the
 * table root shows the whole card for whatever is hovered. It is
 * `pointer-events: none` and sits on the side of the screen away from the
 * hovered element, so it never takes a click and never hides the card you are
 * pointing at. That rule is what keeps it clear of SB-63's failure modes.
 *
 * A tiny external store rather than React state on the table: hovering must not
 * re-render the whole table, only the preview layer.
 */

import type { CardView } from '@engine/types';

export interface PreviewState {
  card: CardView;
  /** Which side of the screen the preview sits on. */
  side: 'left' | 'right';
  /** Viewport y of the preview's top edge. */
  top: number;
}

/** A short delay so sweeping the pointer across a row doesn't strobe the layer. */
export const PREVIEW_DELAY_MS = 90;

let current: PreviewState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function subscribePreview(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getPreview(): PreviewState | null {
  return current;
}

export function getServerPreview(): PreviewState | null {
  return null;
}

/** Where the layer goes for a hovered element: the opposite half, at the top of the board. */
export function placePreview(
  rect: { left: number; width: number } | null,
  viewportWidth: number,
  boardTop: number | null,
): { side: 'left' | 'right'; top: number } {
  const centre = rect ? rect.left + rect.width / 2 : 0;
  const side = centre > viewportWidth / 2 ? 'left' : 'right';
  return { side, top: Math.max(8, (boardTop ?? 56) + 8) };
}

export function showPreview(card: CardView, el: Element | null): void {
  if (typeof window === 'undefined') return;
  if (timer !== null) clearTimeout(timer);
  const rect = el ? el.getBoundingClientRect() : null;
  const board = document.querySelector('.board-region');
  const boardTop = board ? board.getBoundingClientRect().top : null;
  const place = placePreview(rect, window.innerWidth, boardTop);
  timer = setTimeout(() => {
    timer = null;
    current = { card, ...place };
    emit();
  }, PREVIEW_DELAY_MS);
}

/** Hide the preview. With an iid, only if that card is the one showing. */
export function hidePreview(iid?: string): void {
  if (iid !== undefined && current !== null && current.card.iid !== iid) return;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (current === null) return;
  current = null;
  emit();
}
