/**
 * Touch on card faces and the linked highlight, the pure parts (review round 3).
 *
 *   TC1  decideTap: a long press swallows; a mouse, an own action or a tapping
 *        ancestor pass; a slide swallows; no links opens the sheet; links toggle
 *   TC2  pastSlop and tapAwayClears: only a tap inside the slop that started off
 *        the cards and outside the sheet puts a highlight out
 *   TC3  MOB-1/MOB-2: pointerdown lights nothing; the tap that completes lights
 *        the links with no sheet; a second tap on the same card puts them out
 *   TC4  MOB-2: a press that slides past the slop, or that the browser cancels,
 *        clears the highlight that card set and never lights one
 *   TC5  a tap on a card with no links opens the sheet; a long press opens the
 *        sheet, lights nothing, and swallows the click even on a hand card
 *   TC6  MOB-1: closing the sheet keeps a tap's highlight; a Mentions chip closes
 *        the sheet and lights the sheet card's links
 *   TC7  MOB-1: the sheet's Mentions are buttons; the hover layer's are not
 *   TC8  MOB-6: the dock's discard top wears card-linked when its card is lit
 *   TC9  MOB-4: every seat tile carries the Prophet label, shown on phones only
 *   TC10 a tap on a card none of whose references has a face on the table opens
 *        the sheet (lighting would show nothing)
 *
 * The real fingers on a real screen are e2e/mobile.spec.ts.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ensureRegistry } from '@net/bootstrap';
import { viewFor } from '@engine/view';
import type { CardView, GameState } from '@engine/types';
import { clearLinkSource, getLinkSource, isLinked, linkedDefIds } from '@ui/links';
import { closePreviewSheet, getPreview, openPreviewSheet } from '@ui/preview';
import {
  LONG_PRESS_MS,
  PRESS_SLOP_PX,
  createCardPress,
  decideTap,
  followMention,
  lightLinksByTouch,
  pastSlop,
  tapAwayClears,
  type TapFacts,
} from '@ui/touch';
import { printedCardView } from '@ui/cardview';
import { PreviewSheet } from '@ui/CardPreview';
import { Card } from '@ui/Card';
import { TableLayout } from '@ui/App';
import { seedMatch } from '@ui/useGame';

ensureRegistry();

const noop = (): void => undefined;

function face(defId: string, key: string): CardView {
  const c = printedCardView(defId, key);
  if (!c) throw new Error(`no face for ${defId}`);
  return c;
}

function down(pointerType: string, x = 20, y = 20): React.PointerEvent<HTMLElement> {
  return { pointerType, clientX: x, clientY: y } as unknown as React.PointerEvent<HTMLElement>;
}

function move(x: number, y: number): React.PointerEvent<HTMLElement> {
  return { pointerType: 'touch', clientX: x, clientY: y } as unknown as React.PointerEvent<HTMLElement>;
}

interface FakeClick {
  prevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

/** A click with no element behind it (so no tapping ancestor), recording what the hook did to it. */
function click(): FakeClick & React.MouseEvent<HTMLElement> {
  const e: FakeClick & { currentTarget: null } = {
    currentTarget: null,
    prevented: false,
    stopped: false,
    preventDefault() {
      e.prevented = true;
    },
    stopPropagation() {
      e.stopped = true;
    },
  };
  return e as unknown as FakeClick & React.MouseEvent<HTMLElement>;
}

/** One finger tap: down, up, click. Returns what takeClick said. */
function tap(press: ReturnType<typeof createCardPress>, hasOwnAction = false): boolean {
  press.onPointerDown(down('touch'));
  press.onPointerUp();
  return press.takeClick(click(), hasOwnAction);
}

afterEach(() => {
  vi.useRealTimers();
  closePreviewSheet();
  clearLinkSource();
});

describe('touch gestures on a card face (touch.ts)', () => {
  const base: TapFacts = {
    touch: true,
    longPressFired: false,
    moved: false,
    hasOwnAction: false,
    insideTapAction: false,
    hasLinks: true,
    ownsHighlight: false,
  };

  test('TC1: decideTap', () => {
    expect(decideTap(base)).toBe('light');
    expect(decideTap({ ...base, ownsHighlight: true })).toBe('unlight');
    expect(decideTap({ ...base, hasLinks: false })).toBe('sheet');
    expect(decideTap({ ...base, hasLinks: false, ownsHighlight: true })).toBe('sheet');
    expect(decideTap({ ...base, moved: true })).toBe('swallow');
    expect(decideTap({ ...base, touch: false })).toBe('pass');
    expect(decideTap({ ...base, hasOwnAction: true })).toBe('pass');
    expect(decideTap({ ...base, insideTapAction: true })).toBe('pass');
    // A long press already opened the sheet: its click is ours, action or not.
    expect(decideTap({ ...base, longPressFired: true, hasOwnAction: true })).toBe('swallow');
    expect(decideTap({ ...base, longPressFired: true, insideTapAction: true })).toBe('swallow');
  });

  test('TC2: pastSlop and tapAwayClears', () => {
    const at = { x: 100, y: 100 };
    expect(pastSlop(at, { x: 100 + PRESS_SLOP_PX, y: 100 })).toBe(false);
    expect(pastSlop(at, { x: 100 + PRESS_SLOP_PX, y: 101 })).toBe(true);
    expect(pastSlop(at, { x: 100, y: 100 - PRESS_SLOP_PX - 1 })).toBe(true);

    expect(tapAwayClears({ ...at, away: true }, { x: 104, y: 97 })).toBe(true);
    // A scroll that started on the table leaves the highlight for you to find.
    expect(tapAwayClears({ ...at, away: true }, { x: 100, y: 180 })).toBe(false);
    // Started on a card face or inside the sheet, or cancelled.
    expect(tapAwayClears({ ...at, away: false }, at)).toBe(false);
    expect(tapAwayClears(null, at)).toBe(false);
  });

  test('TC3: a tap lights the links when it completes, with no sheet; the same card again puts them out', () => {
    const stash = face('silver_stash', 'k-stash');
    expect(linkedDefIds('silver_stash').has('silver')).toBe(true);
    const press = createCardPress(() => stash, true);

    press.onPointerDown(down('touch'));
    // Not on pointerdown: this might be the start of a scroll.
    expect(getLinkSource()).toBeNull();
    press.onPointerUp();
    expect(press.takeClick(click(), false)).toBe(true);
    expect(isLinked('silver')).toBe(true);
    expect(getLinkSource()).toEqual({ defId: 'silver_stash', owner: stash.iid });
    expect(getPreview()).toBeNull();

    expect(tap(press)).toBe(true);
    expect(isLinked('silver')).toBe(false);
    expect(getPreview()).toBeNull();

    // A mouse is not ours at all: hover owns it.
    press.onPointerDown(down('mouse'));
    expect(press.takeClick(click(), false)).toBe(false);
    expect(getLinkSource()).toBeNull();
  });

  test('TC4: a slide past the slop or a browser cancel clears that card’s highlight and lights nothing', () => {
    const stash = face('silver_stash', 'k-stash');
    const astro = face('astrologist', 'k-astro');
    const press = createCardPress(() => stash, true);
    const other = createCardPress(() => astro, true);

    // A scroll that starts on a card lights nothing, even if a click follows.
    other.onPointerDown(down('touch', 50, 50));
    other.onPointerMove(move(50, 50 + PRESS_SLOP_PX + 5));
    other.onPointerUp();
    const c = click();
    expect(other.takeClick(c, false)).toBe(true);
    expect(getLinkSource()).toBeNull();
    expect(getPreview()).toBeNull();

    // A small wobble inside the slop is still a tap.
    press.onPointerDown(down('touch', 50, 50));
    press.onPointerMove(move(53, 54));
    press.onPointerUp();
    press.takeClick(click(), false);
    expect(isLinked('silver')).toBe(true);

    // Scrolling from a different card leaves this card's highlight alone...
    other.onPointerDown(down('touch', 50, 50));
    other.onPointerMove(move(50, 120));
    expect(isLinked('silver')).toBe(true);
    other.onPointerCancel();
    expect(isLinked('silver')).toBe(true);

    // ...and scrolling from the lit card clears it.
    press.onPointerDown(down('touch', 50, 50));
    press.onPointerMove(move(50, 120));
    expect(getLinkSource()).toBeNull();

    // The browser cancelling the pointer (it took over for a scroll) does too.
    tap(press);
    expect(isLinked('silver')).toBe(true);
    press.onPointerDown(down('touch', 50, 50));
    press.onPointerCancel();
    expect(getLinkSource()).toBeNull();
  });

  test('TC5: no links opens the sheet on a tap; a long press opens it, lights nothing, and eats the click', () => {
    vi.useFakeTimers();
    const copper = face('copper', 'k-copper');
    expect(linkedDefIds('copper').size).toBe(0);
    const plain = createCardPress(() => copper, true);
    expect(tap(plain)).toBe(true);
    expect(getPreview()).toMatchObject({ mode: 'sheet', card: { defId: 'copper' } });
    closePreviewSheet();

    // A card with an action keeps it on a tap.
    expect(tap(plain, true)).toBe(false);
    expect(getPreview()).toBeNull();

    const stash = face('silver_stash', 'k-stash');
    const press = createCardPress(() => stash, true);
    press.onPointerDown(down('touch'));
    vi.advanceTimersByTime(LONG_PRESS_MS + 1);
    expect(getPreview()).toMatchObject({ mode: 'sheet', card: { defId: 'silver_stash' } });
    expect(getLinkSource()).toBeNull();
    press.onPointerUp();
    const c = click();
    // Even a hand card (own action): reading it never plays it.
    expect(press.takeClick(c, true)).toBe(true);
    expect(c.prevented && c.stopped).toBe(true);
    expect(getLinkSource()).toBeNull();
  });

  test('TC6: closing the sheet keeps a tap’s highlight; a Mentions chip closes it and lights the links', () => {
    const stash = face('silver_stash', 'k-stash');
    const copper = face('copper', 'k-copper');
    tap(createCardPress(() => stash, true));
    expect(isLinked('silver')).toBe(true);
    openPreviewSheet(copper);
    closePreviewSheet();
    expect(getPreview()).toBeNull();
    expect(isLinked('silver')).toBe(true);

    clearLinkSource();
    openPreviewSheet(stash);
    followMention(stash, 'silver');
    expect(getPreview()).toBeNull();
    expect(isLinked('silver')).toBe(true);
    expect(getLinkSource()).toEqual({ defId: 'silver_stash', owner: stash.iid });
  });

  test('TC7: the sheet’s Mentions are buttons; the hover layer’s are plain text', () => {
    const stash = face('silver_stash', 'k-stash');
    const sheet = renderToStaticMarkup(React.createElement(PreviewSheet, { card: stash, onClose: noop }));
    expect(sheet).toMatch(/<button[^>]*data-testid="card-link"[^>]*data-link-def="silver"[^>]*>Silver<\/button>/);
    const hover = renderToStaticMarkup(React.createElement(Card, { card: stash, variant: 'preview', testId: 'card-preview' }));
    expect(hover).toContain('data-testid="card-links"');
    expect(hover).not.toContain('data-testid="card-link"');
  });
});

function tableHtml(s: GameState): string {
  const view = viewFor(s, s.activePlayer);
  return renderToStaticMarkup(
    React.createElement(TableLayout, {
      view,
      mode: 'hotseat',
      code: null,
      seats: ['s1'],
      views: { s1: view },
      activeSeat: 's1',
      setActiveSeat: noop,
      send: noop,
      turnSeconds: 90,
    }),
  );
}

describe('a tap has to show something (review round 4)', () => {
  test('TC10: a tap on a card whose references have no face on the table opens the sheet', () => {
    const trilogy = face('the_trilogy', 'k-trilogy');
    const named = [...linkedDefIds('the_trilogy')];
    expect(named.length).toBeGreaterThan(0);

    // Nothing it names is on the table: lighting would light nothing, so the tap reads the card.
    const offTable = createCardPress(() => trilogy, true, () => false);
    expect(tap(offTable)).toBe(true);
    expect(getPreview()).toMatchObject({ mode: 'sheet', card: { defId: 'the_trilogy' } });
    expect(getLinkSource()).toBeNull();
    // Every tap, not just the first.
    closePreviewSheet();
    expect(tap(offTable)).toBe(true);
    expect(getPreview()).toMatchObject({ mode: 'sheet', card: { defId: 'the_trilogy' } });
    closePreviewSheet();

    // One named face on the table is enough to light them, with no sheet.
    const onTable = createCardPress(() => trilogy, true, (defId) => defId === named[named.length - 1]);
    expect(tap(onTable)).toBe(true);
    expect(getPreview()).toBeNull();
    expect(getLinkSource()).toEqual({ defId: 'the_trilogy', owner: trilogy.iid });
  });
});

describe('linked outline and labels on the table', () => {
  test('TC8: the dock’s discard top wears card-linked while its card is lit (MOB-6)', () => {
    const s = seedMatch(2, 4242, { anomalyChance: 0 });
    const p = s.players[s.activePlayer]!;
    const iid = p.hand.shift()!;
    p.gy.push(iid);
    s.instances[iid]!.zone = 'gy';
    s.instances[iid]!.defId = 'silver';

    expect(tableHtml(s)).toMatch(/class="dock-discard-top"/);
    lightLinksByTouch('silver_stash', 'someone');
    expect(tableHtml(s)).toMatch(/class="dock-discard-top card-linked"/);
    clearLinkSource();
    expect(tableHtml(s)).not.toMatch(/dock-discard-top card-linked/);
  });

  test('TC9: every seat tile spells out ◈ for phones; the word is hidden above 700px (MOB-4)', () => {
    for (const players of [2, 4]) {
      const html = tableHtml(seedMatch(players, 500 + players, { anomalyChance: 0 }));
      const labels = html.match(/<span class="seat-score-label"> Prophet<\/span>/g) ?? [];
      expect(labels).toHaveLength(players);
    }
    const css = readFileSync(resolve(__dirname, '../src/ui/mobile.css'), 'utf8');
    const phone = css.indexOf('@media (max-width: 700px)');
    expect(phone).toBeGreaterThan(0);
    const hidden = css.search(/\n\.seat-score-label \{\s*display: none;/);
    const shown = css.search(/\n {2}\.seat-score-label \{\s*display: inline;/);
    expect(hidden).toBeGreaterThan(-1);
    expect(hidden).toBeLessThan(phone);
    expect(shown).toBeGreaterThan(phone);
  });
});
