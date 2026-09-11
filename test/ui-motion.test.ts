/**
 * The motion layer's pure half: the view diff, the flight plan, and the
 * geometry the FLIP runtime uses. Ported from the parked pass (c67cf3f) and
 * extended for UI-2.
 *
 *   M1  the first view of a match animates nothing card-by-card
 *   M2  a hotseat seat swap animates nothing (every card looks new)
 *   M3  a card arriving in a visible zone produces exactly one entrance
 *   M4  a card leaving produces an exit
 *   M5  stat changes come out signed
 *   M6  a pile that lost a card is distinguishable from one that hit zero
 *   M7  a turn change is reported once, with whose turn it now is
 *   M8  a new prompt is reported once, and not again while it stays open
 *   M9  authored `ArtSlot.anim` presets are honoured; unknown ones are not
 *   M10 the settle time is longest for the events that change the most,
 *       and every duration is snappy (MOT-9)
 *   F1  planFlip plans nothing for the first view or a seat swap
 *   F2  a play flies hand → play; the rest of the hand slides (MOT-15)
 *   F3  a buy flies from the pile top to the discard, and the new top fades in
 *   F4  a draw deals from the library, staggered and capped
 *   F5  cleanup sends every discarded card to the discard pile
 *   F6  only cards in the diff are touched (MOT-5)
 *   F7  a local reorder slides only the cards that were already there
 *   F8  an interrupted flight continues from where it was drawn (MOT-15 fix)
 */

import { describe, expect, it } from 'vitest';
import type { CardView, GameView, OpponentView, PileView, Prompt, SelfView } from '@engine/types';
import {
  ANCHOR_DISCARD,
  ANCHOR_LIBRARY,
  ANIM_PRESETS,
  MOTION_MS,
  animPresetOf,
  cardCues,
  diffViews,
  drainedPiles,
  emptiedPiles,
  fitTransform,
  planFlip,
  planReorder,
  settleMs,
  slideOffset,
  statPulses,
} from '@ui/motion';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function card(iid: string, name = 'Copper', anim?: string): CardView {
  const c: CardView = {
    iid,
    defId: name.toLowerCase().replace(/\s+/g, '_'),
    name,
    cost: 0,
    prophetCost: null,
    types: ['Resource'],
    subtypes: [],
    rarity: 'basic',
    keywords: [],
    stats: { money: 1 },
    text: '+1 Money',
    counters: {},
  };
  if (anim) c.art = { key: c.defId, status: 'placeholder', anim };
  return c;
}

function self(patch: Partial<SelfView> = {}): SelfView {
  return {
    id: 'p1',
    name: 'A',
    hand: [],
    play: [],
    gy: [],
    field: [],
    libraryCount: 10,
    money: 0,
    buys: 1,
    actions: 1,
    prophet: 0,
    vp: 0,
    combo: 0,
    delayedCount: 0,
    quest: null,
    ...patch,
  };
}

function opponent(patch: Partial<OpponentView> = {}): OpponentView {
  return {
    id: 'p2',
    name: 'B',
    handCount: 5,
    libraryCount: 10,
    gy: [],
    play: [],
    field: [],
    vp: 0,
    prophet: 0,
    eliminated: false,
    ...patch,
  };
}

function view(patch: Partial<GameView> = {}): GameView {
  return {
    you: self(),
    others: [opponent()],
    shop: { resource: [], points: [], prophet: [], draft: [] },
    turn: 1,
    round: 1,
    activePlayer: 'p1',
    anomaly: null,
    pending: null,
    ended: false,
    winners: null,
    endReason: null,
    log: [],
    doomsdayCounter: 0,
    hardEndTurn: null,
    ...patch,
  };
}

function pile(id: string, count: number, topIid = `${id}_top`): PileView {
  return {
    id,
    shop: 'draft' as const,
    top: count > 0 ? card(topIid, 'Silver') : null,
    count,
    cost: 3,
    prophetCost: null,
    locked: false,
    lockedUntil: null,
  };
}

function prompt(id: string, type: Prompt['type'] = 'discover'): Prompt {
  return {
    id,
    type,
    player: 'p1',
    prompt: 'Discover',
    options: [{ key: 'a', label: 'A' }],
    min: 1,
    max: 1,
    then: [],
    ctx: {},
    defaultKeys: ['a'],
  };
}

// ---------------------------------------------------------------------------

describe('motion / diffViews', () => {
  it('M1: the first view of a match reports only matchStart', () => {
    const events = diffViews(null, view({ you: self({ hand: [card('i1'), card('i2')] }) }));
    expect(events).toEqual([{ kind: 'matchStart' }]);
  });

  it('M2: a seat swap reports only seatChange, never a card blizzard', () => {
    const before = view({ you: self({ id: 'p1', hand: [card('i1')] }) });
    const after = view({ you: self({ id: 'p2', hand: [card('i9'), card('i8')] }) });
    expect(diffViews(before, after)).toEqual([{ kind: 'seatChange', from: 'p1', to: 'p2' }]);
  });

  it('M3: a card arriving in hand produces exactly one entrance', () => {
    const before = view({ you: self({ hand: [card('i1')] }) });
    const after = view({ you: self({ hand: [card('i1'), card('i2')] }) });
    const enters = diffViews(before, after).filter((e) => e.kind === 'cardEnter');
    expect(enters).toHaveLength(1);
    expect(enters[0]).toMatchObject({ iid: 'i2', zone: 'hand' });
  });

  it('M3: an opponent playing a card animates in their play zone', () => {
    const before = view({ others: [opponent({ play: [] })] });
    const after = view({ others: [opponent({ play: [card('x1', 'Gold')] })] });
    const enters = diffViews(before, after).filter((e) => e.kind === 'cardEnter');
    expect(enters).toHaveLength(1);
    expect(enters[0]).toMatchObject({ iid: 'x1', zone: 'opponentPlay', owner: 'p2' });
  });

  it('M4: a card leaving hand for play is one exit and one entrance', () => {
    const moved = card('i1');
    const events = diffViews(view({ you: self({ hand: [moved] }) }), view({ you: self({ play: [moved] }) }));
    expect(events.filter((e) => e.kind === 'cardExit')).toMatchObject([{ iid: 'i1', zone: 'hand' }]);
    expect(events.filter((e) => e.kind === 'cardEnter')).toMatchObject([{ iid: 'i1', zone: 'play' }]);
  });

  it('M5: stat changes are signed and only reported when they move', () => {
    const pulses = statPulses(diffViews(view({ you: self({ money: 2, actions: 1 }) }), view({ you: self({ money: 5, actions: 0 }) })));
    expect(pulses).toEqual({ money: 3, actions: -1 });
    expect(diffViews(view(), view()).filter((e) => e.kind === 'statChange')).toEqual([]);
  });

  it('M6: a drained pile and an emptied pile are told apart', () => {
    const before = view({ shop: { resource: [], points: [], prophet: [], draft: [pile('a', 5), pile('b', 1)] } });
    const after = view({ shop: { resource: [], points: [], prophet: [], draft: [pile('a', 4), pile('b', 0)] } });
    const events = diffViews(before, after);
    expect(drainedPiles(events)).toEqual(new Set(['a', 'b']));
    expect(emptiedPiles(events)).toEqual(new Set(['b']));
  });

  it('M6: a pile that grew is not a drain', () => {
    const before = view({ shop: { resource: [], points: [], prophet: [], draft: [pile('a', 2)] } });
    const after = view({ shop: { resource: [], points: [], prophet: [], draft: [pile('a', 6)] } });
    expect(drainedPiles(diffViews(before, after)).size).toBe(0);
  });

  it('M7: a turn change is reported once and says whose turn it is', () => {
    const turns = diffViews(view({ turn: 1, activePlayer: 'p1' }), view({ turn: 2, activePlayer: 'p2' })).filter(
      (e) => e.kind === 'turnChange',
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ from: 'p1', to: 'p2', turn: 2, yours: false });
  });

  it('M8: a new prompt fires once and does not repeat while it stays open', () => {
    const open = view({ pending: prompt('q1') });
    expect(diffViews(view(), open).filter((e) => e.kind === 'promptOpen')).toHaveLength(1);
    expect(diffViews(open, open).filter((e) => e.kind === 'promptOpen')).toHaveLength(0);
    expect(diffViews(open, view({ pending: prompt('q2') })).filter((e) => e.kind === 'promptOpen')).toHaveLength(1);
  });

  it('reports the end of the game exactly once', () => {
    const after = view({ ended: true, winners: ['p1'] });
    expect(diffViews(view(), after).filter((e) => e.kind === 'gameEnd')).toHaveLength(1);
    expect(diffViews(after, after).filter((e) => e.kind === 'gameEnd')).toHaveLength(0);
  });
});

describe('motion / presets', () => {
  it('M9: an authored preset is honoured; an unknown one is null', () => {
    for (const preset of ANIM_PRESETS) expect(animPresetOf(card('i1', 'X', preset))).toBe(preset);
    expect(animPresetOf(card('i1', 'Gold', 'kaboom'))).toBeNull();
    expect(animPresetOf(card('i1', 'Gold'))).toBeNull();
  });

  it('M9: cues one card once even when it lands in two zones in one diff', () => {
    const c = card('i1');
    expect(cardCues(diffViews(view(), view({ you: self({ play: [c], gy: [c] }) })))).toHaveLength(1);
  });
});

describe('motion / timing', () => {
  it('M10: a turn change holds longer than a card landing, and game end longer still', () => {
    const landing = settleMs([{ kind: 'cardEnter', zone: 'hand', iid: 'i', defId: 'd', name: 'n', anim: null, owner: 'p1' }]);
    const turn = settleMs([{ kind: 'turnChange', from: 'p1', to: 'p2', turn: 2, yours: false }]);
    const over = settleMs([{ kind: 'gameEnd', winners: [] }]);
    expect(landing).toBeGreaterThan(0);
    expect(turn).toBeGreaterThan(landing);
    expect(over).toBeGreaterThan(turn);
    expect(settleMs([])).toBe(0);
    expect(settleMs([{ kind: 'matchStart' }])).toBe(0);
  });

  it('M10: every card motion is snappy — 200ms or less — and the banner is 600ms (MOT-9)', () => {
    for (const k of ['quick', 'move', 'beat', 'play', 'buy', 'draw', 'discard', 'reorder'] as const) {
      expect(MOTION_MS[k]).toBeLessThanOrEqual(200);
    }
    expect(MOTION_MS.turn).toBe(600);
    expect(MOTION_MS.staggerCap).toBeLessThanOrEqual(125);
  });
});

// ---------------------------------------------------------------------------
// Flight plans
// ---------------------------------------------------------------------------

describe('motion / planFlip', () => {
  it('F1: nothing for the first view, the same view, or a hotseat seat swap', () => {
    const v = view({ you: self({ hand: [card('i1')] }) });
    expect(planFlip(null, v)).toBeNull();
    expect(planFlip(v, v)).toBeNull();
    expect(planFlip(v, view({ you: self({ id: 'p2', hand: [card('i2')] }) }))).toBeNull();
  });

  it('F2: a play flies the card from the hand to its chip; its neighbours slide', () => {
    const a = card('a');
    const b = card('b');
    const c = card('c');
    const plan = planFlip(view({ you: self({ hand: [a, b, c] }) }), view({ you: self({ hand: [a, c], play: [b] }) }));
    expect(plan?.steps).toEqual(
      expect.arrayContaining([
        { key: 'b', kind: 'fly', ms: MOTION_MS.play, delay: 0, target: 'self' },
        { key: 'a', kind: 'slide', ms: MOTION_MS.reorder, delay: 0 },
        { key: 'c', kind: 'slide', ms: MOTION_MS.reorder, delay: 0 },
      ]),
    );
  });

  it('F3: a buy flies from the pile top to the discard, and the new top fades in', () => {
    const before = view({ shop: { resource: [], points: [], prophet: [], draft: [pile('d:silver', 5, 's1')] } });
    const bought = card('s1', 'Silver');
    const after = view({
      you: self({ gy: [bought] }),
      shop: { resource: [], points: [], prophet: [], draft: [pile('d:silver', 4, 's2')] },
    });
    const steps = planFlip(before, after)?.steps ?? [];
    expect(steps).toContainEqual({ key: 's1', kind: 'fly', ms: MOTION_MS.buy, delay: 0, target: 'self' });
    expect(steps).toContainEqual({ key: 's2', kind: 'fade', ms: MOTION_MS.tick, delay: 0 });
  });

  it('F4: drawn cards deal from the library, 25ms apart, capped at 125ms', () => {
    const hand = Array.from({ length: 8 }, (_, i) => card(`n${i}`));
    const steps = (planFlip(view(), view({ you: self({ hand }) }))?.steps ?? []).filter((s) => s.kind === 'deal');
    expect(steps).toHaveLength(8);
    expect(steps.every((s) => s.source === ANCHOR_LIBRARY && s.ms === MOTION_MS.draw)).toBe(true);
    expect(steps.map((s) => s.delay)).toEqual([0, 25, 50, 75, 100, 125, 125, 125]);
  });

  it('F4: after a cleanup the new hand starts arriving 60ms later', () => {
    const steps = planFlip(
      view({ turn: 3 }),
      view({ turn: 5, you: self({ hand: [card('n0'), card('n1')] }) }),
    )?.steps.filter((s) => s.kind === 'deal');
    expect(steps?.map((s) => s.delay)).toEqual([60, 85]);
  });

  it('F5: cleanup sends every discarded card to the discard pile', () => {
    const h = [card('h1'), card('h2')];
    const p = [card('p1')];
    const steps =
      planFlip(
        view({ you: self({ hand: h, play: p }) }),
        view({ turn: 2, you: self({ gy: [...h, ...p] }) }),
      )?.steps ?? [];
    // The new top of the graveyard lands on its own element; the rest on the pile.
    expect(steps).toContainEqual({ key: 'p1', kind: 'fly', ms: MOTION_MS.discard, delay: 0, target: 'self' });
    expect(steps).toContainEqual({ key: 'h1', kind: 'fly', ms: MOTION_MS.discard, delay: 0, target: ANCHOR_DISCARD });
    expect(steps).toContainEqual({ key: 'h2', kind: 'fly', ms: MOTION_MS.discard, delay: 0, target: ANCHOR_DISCARD });
  });

  it('F5: a card that left for a zone the table never draws (trash, library) just leaves', () => {
    const plan = planFlip(view({ you: self({ hand: [card('t1')] }) }), view({ you: self({ hand: [] }) }));
    expect(plan).toBeNull();
  });

  it('F6: a view that moved no card plans nothing (a stat tick, a log line)', () => {
    const hand = [card('a'), card('b')];
    const shop = { resource: [], points: [], prophet: [], draft: [pile('x', 3)] };
    expect(planFlip(view({ you: self({ hand }), shop }), view({ you: self({ hand, money: 3 }), shop }))).toBeNull();
  });

  it('F7: a local reorder slides the cards that were already there', () => {
    expect(planReorder(['a', 'b', 'c'], ['a', 'b', 'c'])).toBeNull();
    expect(planReorder(['a', 'b', 'c'], ['b', 'a', 'c'])?.steps.map((s) => s.key)).toEqual(['b', 'a', 'c']);
    expect(planReorder(['a', 'b'], ['b', 'a'])?.steps.every((s) => s.kind === 'slide' && s.ms === MOTION_MS.reorder)).toBe(true);
  });
});

describe('motion / geometry', () => {
  it('F8: a slide starts from where the card was drawn, so an interrupted flight continues', () => {
    // A card flying left from x=200 to its slot at x=100 is interrupted with a
    // transform of +40px still applied: it is drawn at 140. The next layout puts
    // its slot at 60. The new flight must start at 140 — continuing — not at
    // 60 - 40 = 20 (the mirrored start the old hook produced).
    const drawn = { x: 140, y: 0, w: 100, h: 140 };
    const layout = { x: 60, y: 0, w: 100, h: 140 };
    const off = slideOffset(drawn, layout);
    expect(off).toEqual({ dx: 80, dy: 0 });
    expect(layout.x + (off?.dx ?? 0)).toBe(drawn.x);
  });

  it('F8: layout jitter under 2px is not a move', () => {
    expect(slideOffset({ x: 10, y: 10, w: 1, h: 1 }, { x: 11, y: 10, w: 1, h: 1 })).toBeNull();
  });

  it('fitTransform scales uniformly and centres the box on its target', () => {
    const from = { x: 0, y: 0, w: 120, h: 140 };
    const to = { x: 300, y: 400, w: 60, h: 40 };
    const t = fitTransform(from, to);
    expect(t.s).toBeCloseTo(40 / 140);
    // The scaled box is centred in the target.
    const w = from.w * t.s;
    const h = from.h * t.s;
    expect(from.x + t.dx + w / 2).toBeCloseTo(to.x + to.w / 2);
    expect(from.y + t.dy + h / 2).toBeCloseTo(to.y + to.h / 2);
  });
});
