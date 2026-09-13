/**
 * Linked-card highlighting and the phone-width helpers.
 *
 *   LK1  the index finds a real reference in a card's effect tree
 *   LK2  triggers and nested nodes count; a card never links to itself
 *   LK3  the index is memoised: the same set object every time
 *   LK4  references are outgoing only
 *   LK5  every link anywhere in the catalog is a real, different card
 *   LK6  the store notifies subscribers when the lit set changes, and only then
 *   LK7  only the face that set a highlight clears it on pointer leave
 *   H1   the wrapped (phone) hand picks a drop gap by line, then by midpoint
 *   T1   a tap bubble stays inside the viewport
 */

import { describe, expect, test } from 'vitest';
import { ensureRegistry } from '@net/bootstrap';
import { allCards, hasCard } from '@engine/registry';
import {
  clearLinkSource,
  getLinkSource,
  getLinkedSet,
  isLinked,
  linkedDefIds,
  linkedNames,
  setLinkSource,
  subscribeLinks,
} from '@ui/links';
import { insertionIndexFromPoint, insertionIndexFromX } from '@ui/Hand';
import { placeTip } from '@ui/TapTip';

ensureRegistry();

describe('linked cards (links.ts)', () => {
  test('LK1: Silver Stash references Silver through its createCard node', () => {
    expect([...linkedDefIds('silver_stash')]).toEqual(['silver']);
    expect(linkedNames('silver_stash')).toEqual(['Silver']);
  });

  test('LK2: Astrologist links Lunar Fragment from its effects and trigger, never itself', () => {
    const links = linkedDefIds('astrologist');
    expect(links.has('lunar_fragment')).toBe(true);
    // Its own effects filter on `defId: 'astrologist'`, which is not a link.
    expect(links.has('astrologist')).toBe(false);
  });

  test('LK3: memoised and stable; an unknown id is an empty set', () => {
    expect(linkedDefIds('astrologist')).toBe(linkedDefIds('astrologist'));
    expect(linkedDefIds('silver_stash')).toBe(linkedDefIds('silver_stash'));
    expect(linkedDefIds('no_such_card').size).toBe(0);
    expect(linkedDefIds('').size).toBe(0);
  });

  test('LK4: outgoing only — Silver does not light Silver Stash', () => {
    expect(linkedDefIds('silver').has('silver_stash')).toBe(false);
  });

  test('LK5: every link in the catalog names a real card other than the source', () => {
    let withLinks = 0;
    for (const def of allCards()) {
      const links = linkedDefIds(def.id);
      if (links.size > 0) withLinks += 1;
      for (const id of links) {
        expect(id, `${def.id} links itself`).not.toBe(def.id);
        expect(hasCard(id), `${def.id} links unknown ${id}`).toBe(true);
      }
    }
    // A catalog where nothing links would mean the walk silently broke.
    expect(withLinks).toBeGreaterThan(20);
  });

  test('LK6: the store notifies subscribers when the lit set changes, and only then', () => {
    clearLinkSource();
    let calls = 0;
    const off = subscribeLinks(() => {
      calls += 1;
    });

    setLinkSource('silver_stash', 'i1');
    expect(calls).toBe(1);
    expect(isLinked('silver')).toBe(true);
    expect(isLinked('gold')).toBe(false);
    expect(getLinkSource()).toEqual({ defId: 'silver_stash', owner: 'i1' });
    expect(getLinkedSet()).toBe(linkedDefIds('silver_stash'));

    // The same source again is not a change.
    setLinkSource('silver_stash', 'i1');
    expect(calls).toBe(1);

    setLinkSource('astrologist', 'i2');
    expect(calls).toBe(2);
    expect(isLinked('silver')).toBe(false);
    expect(isLinked('lunar_fragment')).toBe(true);

    clearLinkSource();
    expect(calls).toBe(3);
    expect(isLinked('lunar_fragment')).toBe(false);
    clearLinkSource();
    expect(calls).toBe(3);

    off();
    setLinkSource('silver_stash', 'i1');
    expect(calls).toBe(3);
    clearLinkSource();
  });

  test('LK7: a pointer leave clears only the highlight its own face set', () => {
    setLinkSource('silver_stash', 'i1');
    clearLinkSource('someone-else');
    expect(isLinked('silver')).toBe(true);
    clearLinkSource('i1');
    expect(isLinked('silver')).toBe(false);
  });
});

describe('phone-width helpers', () => {
  const box = (left: number, top: number) => ({ left, top, width: 100, height: 150 });

  test('H1: one line behaves exactly like insertionIndexFromX', () => {
    const slots = [box(0, 0), box(110, 0), box(220, 0), box(330, 0)];
    const mids = slots.map((s) => s.left + s.width / 2);
    for (const x of [-10, 10, 49, 51, 170, 280, 379, 381, 500]) {
      for (const y of [-40, 0, 75, 400]) {
        expect(insertionIndexFromPoint(x, y, slots)).toBe(insertionIndexFromX(x, mids));
      }
    }
  });

  test('H1: a wrapped hand picks the line under the pointer, then the gap in it', () => {
    // 3 columns: slots 0-2 on the first line, 3-4 on the second.
    const slots = [box(0, 0), box(110, 0), box(220, 0), box(0, 160), box(110, 160)];
    expect(insertionIndexFromPoint(10, 60, slots)).toBe(0);
    expect(insertionIndexFromPoint(300, 60, slots)).toBe(3);
    expect(insertionIndexFromPoint(10, 220, slots)).toBe(3);
    expect(insertionIndexFromPoint(120, 220, slots)).toBe(4);
    expect(insertionIndexFromPoint(300, 220, slots)).toBe(5);
    // Below everything: the last line.
    expect(insertionIndexFromPoint(10, 900, slots)).toBe(3);
    expect(insertionIndexFromPoint(0, 0, [])).toBe(0);
  });

  test('T1: a tap bubble never runs off either edge', () => {
    for (const x of [0, 30, 195, 360, 390]) {
      const p = placeTip(x, 400, 390);
      expect(p.left - 120).toBeGreaterThanOrEqual(0);
      expect(p.left + 120).toBeLessThanOrEqual(390);
      expect(p.above).toBe(true);
    }
    expect(placeTip(100, 40, 390).above).toBe(false);
  });
});
