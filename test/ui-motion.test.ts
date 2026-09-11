/**
 * The motion layer's diff.
 *
 * Animation in this build is *derived* — a non-host browser only ever receives
 * views, so every cue comes from comparing the last view to the next one. That
 * makes the diff the load-bearing part, and the only part that can be tested
 * without a DOM. These are the behaviours the table depends on:
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
 *   M10 the settle time is longest for the events that change the most
 */

import { describe, expect, it } from 'vitest';
import type { CardView, GameView, OpponentView, Prompt, SelfView } from '@engine/types';
import {
  ANIM_PRESETS,
  animPresetOf,
  cardCues,
  diffViews,
  drainedPiles,
  emptiedPiles,
  settleMs,
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

function pile(id: string, count: number) {
  return {
    id,
    shop: 'draft' as const,
    top: count > 0 ? card(`${id}_top`, 'Silver') : null,
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
    const events = diffViews(before, after);
    expect(events).toEqual([{ kind: 'seatChange', from: 'p1', to: 'p2' }]);
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
    const before = view({ you: self({ hand: [moved], play: [] }) });
    const after = view({ you: self({ hand: [], play: [moved] }) });
    const events = diffViews(before, after);
    expect(events.filter((e) => e.kind === 'cardExit')).toMatchObject([
      { iid: 'i1', zone: 'hand' },
    ]);
    expect(events.filter((e) => e.kind === 'cardEnter')).toMatchObject([
      { iid: 'i1', zone: 'play' },
    ]);
  });

  it('M5: stat changes are signed and only reported when they move', () => {
    const before = view({ you: self({ money: 2, actions: 1 }) });
    const after = view({ you: self({ money: 5, actions: 0 }) });
    const pulses = statPulses(diffViews(before, after));
    expect(pulses).toEqual({ money: 3, actions: -1 });
  });

  it('M5: an unchanged stat produces no event at all', () => {
    const events = diffViews(view(), view());
    expect(events.filter((e) => e.kind === 'statChange')).toEqual([]);
  });

  it('M6: a drained pile and an emptied pile are told apart', () => {
    const before = view({
      shop: { resource: [], points: [], prophet: [], draft: [pile('a', 5), pile('b', 1)] },
    });
    const after = view({
      shop: { resource: [], points: [], prophet: [], draft: [pile('a', 4), pile('b', 0)] },
    });
    const events = diffViews(before, after);
    expect(drainedPiles(events)).toEqual(new Set(['a', 'b']));
    expect(emptiedPiles(events)).toEqual(new Set(['b']));
  });

  it('M6: a pile that grew is not a drain', () => {
    const before = view({
      shop: { resource: [], points: [], prophet: [], draft: [pile('a', 2)] },
    });
    const after = view({
      shop: { resource: [], points: [], prophet: [], draft: [pile('a', 6)] },
    });
    expect(drainedPiles(diffViews(before, after)).size).toBe(0);
  });

  it('M7: a turn change is reported once and says whose turn it is', () => {
    const before = view({ turn: 1, activePlayer: 'p1' });
    const after = view({ turn: 2, activePlayer: 'p2' });
    const turns = diffViews(before, after).filter((e) => e.kind === 'turnChange');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ from: 'p1', to: 'p2', turn: 2, yours: false });
  });

  it('M7: your own turn is flagged as yours', () => {
    const before = view({ turn: 1, activePlayer: 'p2' });
    const after = view({ turn: 2, activePlayer: 'p1' });
    const turns = diffViews(before, after).filter((e) => e.kind === 'turnChange');
    expect(turns[0]).toMatchObject({ yours: true });
  });

  it('M8: a new prompt fires once and does not repeat while it stays open', () => {
    const closed = view({ pending: null });
    const open = view({ pending: prompt('q1') });
    expect(diffViews(closed, open).filter((e) => e.kind === 'promptOpen')).toHaveLength(1);
    expect(diffViews(open, open).filter((e) => e.kind === 'promptOpen')).toHaveLength(0);
  });

  it('M8: a different prompt id fires again', () => {
    const first = view({ pending: prompt('q1') });
    const second = view({ pending: prompt('q2') });
    expect(diffViews(first, second).filter((e) => e.kind === 'promptOpen')).toHaveLength(1);
  });

  it('reports the end of the game exactly once', () => {
    const before = view({ ended: false });
    const after = view({ ended: true, winners: ['p1'] });
    expect(diffViews(before, after).filter((e) => e.kind === 'gameEnd')).toHaveLength(1);
    expect(diffViews(after, after).filter((e) => e.kind === 'gameEnd')).toHaveLength(0);
  });

  it('reports a newly manifested aura', () => {
    const before = view();
    const after = view({
      you: self({
        field: [{ auraId: 'rugpull', name: 'Rugpull', tier: 'heroic', text: '+4 Money', usedThisTurn: false }],
      }),
    });
    const auras = diffViews(before, after).filter((e) => e.kind === 'auraGained');
    expect(auras).toMatchObject([{ auraId: 'rugpull', tier: 'heroic' }]);
  });
});

describe('motion / presets', () => {
  it('M9: an authored preset is honoured', () => {
    expect(animPresetOf(card('i1', 'Gold', 'coin'))).toBe('coin');
    for (const preset of ANIM_PRESETS) {
      expect(animPresetOf(card('i1', 'X', preset))).toBe(preset);
    }
  });

  it('M9: an unknown preset name falls back to null, never to a broken class', () => {
    expect(animPresetOf(card('i1', 'Gold', 'kaboom'))).toBeNull();
    expect(animPresetOf(card('i1', 'Gold'))).toBeNull();
  });

  it('M9: a card with no preset still gets the generic entrance cue', () => {
    const before = view({ you: self({ hand: [] }) });
    const after = view({ you: self({ hand: [card('i1', 'Copper')] }) });
    expect(cardCues(diffViews(before, after))).toMatchObject([{ iid: 'i1', anim: 'enter' }]);
  });

  it('M9: a card with a preset gets that preset as its cue', () => {
    const before = view({ you: self({ gy: [] }) });
    const after = view({ you: self({ gy: [card('i1', 'Gold', 'coin')] }) });
    expect(cardCues(diffViews(before, after))).toMatchObject([{ iid: 'i1', anim: 'coin' }]);
  });

  it('cues one card once even when it lands in two zones in one diff', () => {
    const c = card('i1');
    const before = view();
    const after = view({ you: self({ play: [c], gy: [c] }) });
    expect(cardCues(diffViews(before, after))).toHaveLength(1);
  });
});

describe('motion / settle', () => {
  it('M10: a turn change holds the table longer than a card landing', () => {
    const cardLanding = settleMs([
      { kind: 'cardEnter', zone: 'hand', iid: 'i', defId: 'd', name: 'n', anim: null, owner: 'p1' },
    ]);
    const turn = settleMs([{ kind: 'turnChange', from: 'p1', to: 'p2', turn: 2, yours: false }]);
    const over = settleMs([{ kind: 'gameEnd', winners: [] }]);
    expect(cardLanding).toBeGreaterThan(0);
    expect(turn).toBeGreaterThan(cardLanding);
    expect(over).toBeGreaterThan(turn);
  });

  it('M10: nothing worth waiting for settles instantly', () => {
    expect(settleMs([])).toBe(0);
    expect(settleMs([{ kind: 'matchStart' }])).toBe(0);
  });
});
