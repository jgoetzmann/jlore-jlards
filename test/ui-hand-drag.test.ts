/**
 * The hand's drag-to-reorder arithmetic, and the two rules that keep a click
 * from being mistaken for a drag.
 *
 * Hand order is a real mechanic — Loaf of Bread plays the cards sandwiching it,
 * Brownie reads the edge of the hand, Feel so Clean discards its neighbours —
 * so "the card landed one slot off" is a wrong-card bug, not a cosmetic one.
 * There is no DOM in this suite, so the geometry is done by pure functions that
 * take numbers (slot midpoints) and the component only feeds them rectangles.
 */

import { describe, it, expect } from 'vitest';
import type { CardView } from '@engine/types';
import {
  moveInOrder,
  insertionIndexFromX,
  targetIndexFor,
  isNoopDrop,
  reconcileOrder,
  orderSignature,
  contentSignature,
} from '@ui/Hand';
import { travelledTooFar, DRAG_SLOP_PX } from '@ui/Card';

function card(iid: string): CardView {
  return {
    iid,
    defId: 'copper',
    name: iid.toUpperCase(),
    cost: 0,
    prophetCost: null,
    types: ['Resource'],
    subtypes: [],
    rarity: 'basic',
    keywords: [],
    stats: {},
    text: '',
    counters: {},
  } as CardView;
}

const hand = (...iids: string[]): CardView[] => iids.map(card);
const names = (cards: readonly CardView[]): string => cards.map((c) => c.iid).join('');

/** What a drag from `from` into gap `pos` actually produces. */
function drop(row: CardView[], from: number, pos: number): string {
  if (isNoopDrop(from, pos)) return names(row);
  return names(moveInOrder(row, from, targetIndexFor(from, pos)));
}

describe('moveInOrder', () => {
  it('keeps every other card in order', () => {
    expect(names(moveInOrder(hand('a', 'b', 'c', 'd'), 0, 2))).toBe('bcad');
    expect(names(moveInOrder(hand('a', 'b', 'c', 'd'), 3, 0))).toBe('dabc');
  });

  it('clamps a destination past either end instead of dropping the card', () => {
    expect(names(moveInOrder(hand('a', 'b', 'c'), 1, 99))).toBe('acb');
    expect(names(moveInOrder(hand('a', 'b', 'c'), 1, -4))).toBe('bac');
  });

  it('ignores an out-of-range source rather than corrupting the hand', () => {
    expect(names(moveInOrder(hand('a', 'b'), 5, 0))).toBe('ab');
    expect(names(moveInOrder(hand('a', 'b'), -1, 0))).toBe('ab');
  });

  it('never loses or duplicates a card, from any index to any index', () => {
    const row = hand('a', 'b', 'c', 'd', 'e');
    for (let from = 0; from < row.length; from += 1) {
      for (let to = 0; to < row.length; to += 1) {
        const out = moveInOrder(row, from, to);
        expect(out).toHaveLength(row.length);
        expect(contentSignature(out)).toBe(contentSignature(row));
      }
    }
  });
});

describe('insertionIndexFromX', () => {
  // Five 100px slots starting at x=0, so midpoints land on 50, 150, 250...
  const mids = [50, 150, 250, 350, 450];

  it('reads gaps, not cards — both ends of the row are reachable', () => {
    expect(insertionIndexFromX(0, mids)).toBe(0);
    expect(insertionIndexFromX(1000, mids)).toBe(5);
  });

  it('switches at each card midpoint, so the caret is never a slot behind', () => {
    expect(insertionIndexFromX(49, mids)).toBe(0);
    expect(insertionIndexFromX(51, mids)).toBe(1);
    expect(insertionIndexFromX(149, mids)).toBe(1);
    expect(insertionIndexFromX(151, mids)).toBe(2);
  });

  it('puts a drop on an empty row at the only position there is', () => {
    expect(insertionIndexFromX(123, [])).toBe(0);
  });
});

describe('a drop lands where the caret was drawn', () => {
  const row = hand('a', 'b', 'c', 'd');

  it('moves a card rightwards into the gap the pointer was in', () => {
    // Gap 3 is between c and d.
    expect(drop(row, 0, 3)).toBe('bcad');
    // Gap 4 is past the end.
    expect(drop(row, 0, 4)).toBe('bcda');
  });

  it('moves a card leftwards into the gap the pointer was in', () => {
    expect(drop(row, 3, 1)).toBe('adbc');
    expect(drop(row, 3, 0)).toBe('dabc');
  });

  it('treats both gaps beside a card as leaving it alone', () => {
    expect(isNoopDrop(2, 2)).toBe(true);
    expect(isNoopDrop(2, 3)).toBe(true);
    expect(drop(row, 2, 2)).toBe('abcd');
    expect(drop(row, 2, 3)).toBe('abcd');
  });

  it('always leaves the dragged card in the gap it was dropped in', () => {
    // The property that matters: whatever was left of the gap is still left of
    // the card afterwards, and whatever was right of it is still right.
    for (let from = 0; from < row.length; from += 1) {
      for (let pos = 0; pos <= row.length; pos += 1) {
        if (isNoopDrop(from, pos)) continue;
        const moved = row[from].iid;
        const before = row.slice(0, pos).filter((c) => c.iid !== moved).map((c) => c.iid);
        const after = row.slice(pos).filter((c) => c.iid !== moved).map((c) => c.iid);
        expect(drop(row, from, pos)).toBe(before.join('') + moved + after.join(''));
      }
    }
  });
});

describe('reconcileOrder — the optimistic hand order', () => {
  const local = hand('b', 'a', 'c');
  const asked = orderSignature(local);

  it('holds the local order while the host has not answered yet', () => {
    // This is the regression. The reorder action is a relay round-trip away —
    // up to two poll intervals for a guest — so the view that arrives next
    // still carries the old order. Snapping to it makes the card jump home and
    // then jump back, which reads as a failed drag.
    const r = reconcileOrder(hand('a', 'b', 'c'), local, asked);
    expect(names(r.order ?? [])).toBe('bac');
    expect(r.pending).toBe(asked);
  });

  it('lets go the moment the host echoes the order it was asked for', () => {
    const r = reconcileOrder(hand('b', 'a', 'c'), local, asked);
    expect(r.order).toBeNull();
    expect(r.pending).toBeNull();
  });

  it('lets go when the hand contents change, however the order looks', () => {
    // A draw, a play, a discard, a new turn: the local arrangement describes a
    // hand that no longer exists, and holding it would render the wrong row.
    const r = reconcileOrder(hand('a', 'b', 'c', 'd'), local, asked);
    expect(r.order).toBeNull();
  });

  it('follows the host whenever there is nothing local to hold', () => {
    const r = reconcileOrder(hand('a', 'b', 'c'), null, null);
    expect(r.order).toBeNull();
    expect(r.pending).toBeNull();
  });

  it('holds a *different* local order across an unrelated view', () => {
    // Two nudges in quick succession: the first ack arrives while the second is
    // still outstanding. The newest local order is the one to keep.
    const second = hand('c', 'b', 'a');
    const r = reconcileOrder(hand('b', 'a', 'c'), second, orderSignature(second));
    expect(names(r.order ?? [])).toBe('cba');
  });
});

describe('signatures', () => {
  it('order signature distinguishes arrangements; content signature does not', () => {
    expect(orderSignature(hand('a', 'b'))).not.toBe(orderSignature(hand('b', 'a')));
    expect(contentSignature(hand('a', 'b'))).toBe(contentSignature(hand('b', 'a')));
    expect(contentSignature(hand('a', 'b'))).not.toBe(contentSignature(hand('a', 'c')));
  });
});

describe('travelledTooFar — a tug is not a click', () => {
  it('lets a still press through', () => {
    expect(travelledTooFar({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false);
    expect(travelledTooFar({ x: 100, y: 100 }, { x: 103, y: 101 })).toBe(false);
  });

  it('swallows a press that slid far enough to have meant a drag', () => {
    expect(travelledTooFar({ x: 100, y: 100 }, { x: 120, y: 100 })).toBe(true);
    expect(travelledTooFar({ x: 100, y: 100 }, { x: 100, y: 130 })).toBe(true);
  });

  it('measures diagonally, not per axis', () => {
    // 5px each way is 7.07px of travel — past a 6px slop, though neither axis is.
    expect(travelledTooFar({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(true);
    expect(DRAG_SLOP_PX).toBe(6);
  });

  it('honours a click with no press behind it', () => {
    // Scripted clicks, assistive tech, and Playwright's own dispatch carry no
    // pointerdown. Those must always play the card.
    expect(travelledTooFar(null, { x: 999, y: 999 })).toBe(false);
  });
});
