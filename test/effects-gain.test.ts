/**
 * T2 - Effect DSL: stat gain, expression amounts, draw.
 * Behaviors B26, B27, B29.
 *
 * Fixtures are written inline on purpose (spec-tester rule 8).
 */
import { describe, test, expect } from 'vitest';

import { resolveEffects, evalAmount } from '@engine/effects';
import type { EffectContext } from '@engine/effects';
import { createMatch } from '@engine/index';
import type {
  EffectNode,
  GameState,
  MatchConfig,
  PlayerId,
} from '@engine/types';

// --- inline fixtures -------------------------------------------------------

function makeConfig(over: Partial<MatchConfig> = {}): MatchConfig {
  return {
    playerCount: 2,
    draftPileCount: 10,
    anomalyChance: 0,
    winCondition: {
      kind: 'standard',
      emptyPileFraction: 0.4,
      emptyPileAbsolute: 4,
      x: null,
    },
    pileSizeScale: 1,
    effectNodeBudget: 5000,
    recursionDepth: 8,
    turnSeconds: 90,
    seedCodexWithCommons: true,
    ...over,
  };
}

function freshMatch(seed = 12345, over: Partial<MatchConfig> = {}): GameState {
  return createMatch(
    makeConfig(over),
    [
      { id: 'p1', name: 'Alice', codex: [] },
      { id: 'p2', name: 'Bob', codex: [] },
    ],
    seed,
    null,
  );
}

function ctxFor(state: GameState, over: Partial<EffectContext> = {}): EffectContext {
  return {
    player: state.activePlayer,
    sourceIid: null,
    depth: 0,
    multiplier: 1,
    vars: {},
    ...over,
  };
}

type DeckZone = 'library' | 'hand' | 'gy' | 'play';

/** Move n instances between two of a player's ordered zones, keeping instance.zone coherent. */
function moveCards(
  s: GameState,
  player: PlayerId,
  from: DeckZone,
  to: DeckZone,
  n: number,
): void {
  const p = s.players[player];
  for (let i = 0; i < n; i++) {
    const iid = p[from].shift();
    if (iid === undefined) return;
    p[to].push(iid);
    s.instances[iid].zone = to;
  }
}

function deckCount(s: GameState, player: PlayerId): number {
  const p = s.players[player];
  return p.library.length + p.hand.length + p.gy.length + p.play.length;
}

// --- B26 -------------------------------------------------------------------

describe('B26 - gain adds a stat to the active player', () => {
  test('B26: {op:"gain", stat:"money", amount:3} adds 3 Money to the active player', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    const before = s.players[p].money;

    const next = resolveEffects(s, [{ op: 'gain', stat: 'money', amount: 3 }], ctxFor(s));

    expect(next.players[p].money).toBe(before + 3);
  });

  test('B26: gaining Money for the active player leaves every other player untouched', () => {
    const s = freshMatch();
    const active = s.activePlayer;
    const other = s.playerOrder.find((id) => id !== active) as PlayerId;
    const beforeOther = s.players[other].money;

    const next = resolveEffects(s, [{ op: 'gain', stat: 'money', amount: 3 }], ctxFor(s));

    expect(next.players[other].money).toBe(beforeOther);
  });

  test('B26: gain of a non-money stat adds to that stat and not to Money', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    const beforeBuys = s.players[p].buys;
    const beforeMoney = s.players[p].money;

    const next = resolveEffects(s, [{ op: 'gain', stat: 'buys', amount: 2 }], ctxFor(s));

    expect(next.players[p].buys).toBe(beforeBuys + 2);
    expect(next.players[p].money).toBe(beforeMoney);
  });

  test('B26: {op:"gain", stat:"money", amount:0} changes nothing', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    const before = s.players[p].money;

    const next = resolveEffects(s, [{ op: 'gain', stat: 'money', amount: 0 }], ctxFor(s));

    expect(next.players[p].money).toBe(before);
  });

  test('B26: two gain nodes in one list accumulate', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    const before = s.players[p].money;

    const next = resolveEffects(
      s,
      [
        { op: 'gain', stat: 'money', amount: 3 },
        { op: 'gain', stat: 'money', amount: 4 },
      ],
      ctxFor(s),
    );

    expect(next.players[p].money).toBe(before + 7);
  });
});

// --- B27 -------------------------------------------------------------------

describe('B27 - expression amounts evaluate against live state', () => {
  test('B27: uniqueCardsInDeck is 2 for the 7 Copper + 3 Tix starting deck', () => {
    const s = freshMatch();
    const unique = evalAmount(s, { expr: 'uniqueCardsInDeck' }, ctxFor(s));

    expect(unique).toBe(2);
  });

  test('B27: gain with {expr:"floor(uniqueCardsInDeck / 3)"} adds floor(2/3) = 0 Money', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    const before = s.players[p].money;

    const next = resolveEffects(
      s,
      [{ op: 'gain', stat: 'money', amount: { expr: 'floor(uniqueCardsInDeck / 3)' } }],
      ctxFor(s),
    );

    expect(next.players[p].money).toBe(before);
  });

  test('B27: gain with {expr:"handSize"} adds the 5-card opening hand size', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    const before = s.players[p].money;

    expect(s.players[p].hand).toHaveLength(5);

    const next = resolveEffects(
      s,
      [{ op: 'gain', stat: 'money', amount: { expr: 'handSize' } }],
      ctxFor(s),
    );

    expect(next.players[p].money).toBe(before + 5);
  });

  test('B27: the same expression yields a different amount when live state differs', () => {
    const s5 = freshMatch();
    const p = s5.activePlayer;

    const s3 = structuredClone(s5);
    moveCards(s3, p, 'hand', 'gy', 2);
    expect(s3.players[p].hand).toHaveLength(3);

    const node: EffectNode = { op: 'gain', stat: 'money', amount: { expr: 'handSize' } };
    const from5 = resolveEffects(s5, [node], ctxFor(s5));
    const from3 = resolveEffects(s3, [node], ctxFor(s3));

    expect(from5.players[p].money - s5.players[p].money).toBe(5);
    expect(from3.players[p].money - s3.players[p].money).toBe(3);
  });

  test('B27: an expression amount and evalAmount agree on the same state', () => {
    const s = freshMatch(99);
    const p = s.activePlayer;
    const expected = evalAmount(s, { expr: 'floor(handSize / 2)' }, ctxFor(s));

    const next = resolveEffects(
      s,
      [{ op: 'gain', stat: 'money', amount: { expr: 'floor(handSize / 2)' } }],
      ctxFor(s),
    );

    expect(next.players[p].money - s.players[p].money).toBe(expected);
    expect(expected).toBe(2);
  });
});

// --- B29 -------------------------------------------------------------------

describe('B29 - draw, reshuffle, and running dry', () => {
  test('B29: {op:"draw", amount:3} moves 3 cards from Library to hand', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const next = resolveEffects(s, [{ op: 'draw', amount: 3 }], ctxFor(s));

    expect(next.players[p].hand).toHaveLength(8);
    expect(next.players[p].library).toHaveLength(2);
    expect(deckCount(next, p)).toBe(10);
  });

  test('B29: {op:"draw", amount:0} draws nothing', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const next = resolveEffects(s, [{ op: 'draw', amount: 0 }], ctxFor(s));

    expect(next.players[p].hand).toHaveLength(5);
    expect(next.players[p].library).toHaveLength(5);
  });

  test('B29: drawing the whole Library empties it exactly', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const next = resolveEffects(s, [{ op: 'draw', amount: 5 }], ctxFor(s));

    expect(next.players[p].hand).toHaveLength(10);
    expect(next.players[p].library).toHaveLength(0);
  });

  test('B29: drawing more than the deck holds draws what it can and stops, without throwing', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    expect(s.players[p].gy).toHaveLength(0);

    let next: GameState | undefined;
    expect(() => {
      next = resolveEffects(s, [{ op: 'draw', amount: 6 }], ctxFor(s));
    }).not.toThrow();

    const out = next as GameState;
    expect(out.players[p].hand).toHaveLength(10);
    expect(out.players[p].library).toHaveLength(0);
    expect(out.players[p].gy).toHaveLength(0);
  });

  test('B29: a wildly oversized draw terminates and creates no cards', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const next = resolveEffects(s, [{ op: 'draw', amount: 100 }], ctxFor(s));

    expect(next.players[p].hand).toHaveLength(10);
    expect(deckCount(next, p)).toBe(10);
  });

  test('B29: drawing from an empty Library shuffles the GY in first', () => {
    const s0 = freshMatch();
    const p = s0.activePlayer;
    const s = structuredClone(s0);
    moveCards(s, p, 'library', 'gy', 5);
    expect(s.players[p].library).toHaveLength(0);
    expect(s.players[p].gy).toHaveLength(5);

    const next = resolveEffects(s, [{ op: 'draw', amount: 3 }], ctxFor(s));

    expect(next.players[p].hand).toHaveLength(8);
    expect(next.players[p].gy).toHaveLength(0);
    expect(next.players[p].library).toHaveLength(2);
    expect(next.rngCursor).toBeGreaterThan(s.rngCursor);
  });

  test('B29: draw with both Library and GY empty is a no-op and does not throw', () => {
    const s0 = freshMatch();
    const p = s0.activePlayer;
    const s = structuredClone(s0);
    moveCards(s, p, 'library', 'play', 5);
    expect(s.players[p].library).toHaveLength(0);
    expect(s.players[p].gy).toHaveLength(0);

    let next: GameState | undefined;
    expect(() => {
      next = resolveEffects(s, [{ op: 'draw', amount: 4 }], ctxFor(s));
    }).not.toThrow();

    const out = next as GameState;
    expect(out.players[p].hand).toHaveLength(5);
    expect(out.players[p].library).toHaveLength(0);
    expect(out.players[p].gy).toHaveLength(0);
  });

  test('B29: running dry does not fizzle the rest of the effect list', () => {
    const s0 = freshMatch();
    const p = s0.activePlayer;
    const s = structuredClone(s0);
    moveCards(s, p, 'library', 'play', 5);
    const beforeMoney = s.players[p].money;

    const next = resolveEffects(
      s,
      [
        { op: 'draw', amount: 4 },
        { op: 'gain', stat: 'money', amount: 2 },
      ],
      ctxFor(s),
    );

    expect(next.players[p].hand).toHaveLength(5);
    expect(next.players[p].money).toBe(beforeMoney + 2);
  });
});
