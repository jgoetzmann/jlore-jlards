/**
 * T2 - Effect DSL: control flow.
 * Behaviors B34, B35, B36.
 *
 * Fixtures are written inline on purpose (spec-tester rule 8).
 */
import { describe, test, expect } from 'vitest';

import { resolveEffects, evalCondition, selectInstances } from '@engine/effects';
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

function freshMatch(seed = 5150, over: Partial<MatchConfig> = {}): GameState {
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

/**
 * Put the state into "n cards already played this turn" shape: n cards moved
 * from hand to play, recorded in playedThisTurn, with combo set to match.
 */
function withCardsPlayed(base: GameState, n: number): GameState {
  const s = structuredClone(base);
  const p = s.players[s.activePlayer];
  for (let i = 0; i < n; i++) {
    const iid = p.hand.shift();
    if (iid === undefined) break;
    p.play.push(iid);
    p.playedThisTurn.push(iid);
    s.instances[iid].zone = 'play';
    s.instances[iid].playedOnTurn = s.turn;
  }
  p.combo = p.playedThisTurn.length;
  return s;
}

function withCursor(s: GameState, cursor: number): GameState {
  const c = structuredClone(s);
  c.rngCursor = cursor;
  return c;
}

function moneyDelta(before: GameState, after: GameState, p: PlayerId): number {
  return after.players[p].money - before.players[p].money;
}

// --- B34 -------------------------------------------------------------------

describe('B34 - conditional with a combo requirement', () => {
  test('B34: evalCondition({combo:3}) is false when no cards have been played this turn', () => {
    const s = freshMatch();
    expect(s.players[s.activePlayer].combo).toBe(0);

    expect(evalCondition(s, { combo: 3 }, ctxFor(s))).toBe(false);
  });

  test('B34: evalCondition({combo:3}) is false on the 2nd card played this turn', () => {
    const s = withCardsPlayed(freshMatch(), 2);

    expect(evalCondition(s, { combo: 3 }, ctxFor(s))).toBe(false);
  });

  test('B34: evalCondition({combo:3}) is true on the 3rd card played this turn', () => {
    const s = withCardsPlayed(freshMatch(), 3);

    expect(evalCondition(s, { combo: 3 }, ctxFor(s))).toBe(true);
  });

  test('B34: evalCondition({combo:3}) stays true past the 3rd card', () => {
    const s = withCardsPlayed(freshMatch(), 4);

    expect(evalCondition(s, { combo: 3 }, ctxFor(s))).toBe(true);
  });

  test('B34: conditional runs "then" once the combo requirement is met', () => {
    const s = withCardsPlayed(freshMatch(), 3);
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [
        {
          op: 'conditional',
          if: { combo: 3 },
          then: [{ op: 'gain', stat: 'money', amount: 5 }],
          else: [{ op: 'gain', stat: 'money', amount: 1 }],
        },
      ],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(5);
  });

  test('B34: conditional runs "else" instead of "then" below the combo requirement', () => {
    const s = withCardsPlayed(freshMatch(), 2);
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [
        {
          op: 'conditional',
          if: { combo: 3 },
          then: [{ op: 'gain', stat: 'money', amount: 5 }],
          else: [{ op: 'gain', stat: 'money', amount: 1 }],
        },
      ],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(1);
  });

  test('B34: a conditional with no "else" does nothing at all below the combo requirement', () => {
    const s = withCardsPlayed(freshMatch(), 1);
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [
        {
          op: 'conditional',
          if: { combo: 3 },
          then: [{ op: 'gain', stat: 'money', amount: 5 }],
        },
      ],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(0);
  });

  test('B34: a failed conditional does not stop later effects in the list', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [
        {
          op: 'conditional',
          if: { combo: 3 },
          then: [{ op: 'gain', stat: 'money', amount: 5 }],
        },
        { op: 'gain', stat: 'money', amount: 2 },
      ],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(2);
  });
});

// --- B35 -------------------------------------------------------------------

const TWO_BRANCHES: EffectNode = {
  op: 'random',
  branches: [
    { weight: 1, effects: [{ op: 'gain', stat: 'money', amount: 1 }] },
    { weight: 1, effects: [{ op: 'gain', stat: 'money', amount: 100 }] },
  ],
};

describe('B35 - random branches are weighted and reproducible', () => {
  test('B35: a random node picks exactly one branch', () => {
    const s = freshMatch(600);
    const p = s.activePlayer;

    const next = resolveEffects(s, [TWO_BRANCHES], ctxFor(s));

    expect([1, 100]).toContain(moneyDelta(s, next, p));
  });

  test('B35: the same seed and cursor pick the same branch across two independent runs', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const a = freshMatch(seed);
      const b = freshMatch(seed);
      const p = a.activePlayer;

      const outA = resolveEffects(a, [TWO_BRANCHES], ctxFor(a));
      const outB = resolveEffects(b, [TWO_BRANCHES], ctxFor(b));

      expect(moneyDelta(a, outA, p)).toBe(moneyDelta(b, outB, p));
      expect(outA.rngCursor).toBe(outB.rngCursor);
    }
  });

  test('B35: the branch sequence across cursors reproduces exactly on a second pass', () => {
    const base = freshMatch(4711);
    const p = base.activePlayer;

    const run = (): number[] => {
      const out: number[] = [];
      for (let cursor = 0; cursor < 50; cursor++) {
        const s = withCursor(base, cursor);
        const next = resolveEffects(s, [TWO_BRANCHES], ctxFor(s));
        out.push(moneyDelta(s, next, p));
      }
      return out;
    };

    const first = run();
    const second = run();

    expect(second).toEqual(first);
    expect(first).toHaveLength(50);
  });

  test('B35: a rebuilt match at the same seed reproduces the whole branch sequence', () => {
    const collect = (seed: number): number[] => {
      const base = freshMatch(seed);
      const p = base.activePlayer;
      const out: number[] = [];
      for (let cursor = 0; cursor < 40; cursor++) {
        const s = withCursor(base, cursor);
        const next = resolveEffects(s, [TWO_BRANCHES], ctxFor(s));
        out.push(moneyDelta(s, next, p));
      }
      return out;
    };

    expect(collect(90210)).toEqual(collect(90210));
  });

  test('B35: equal weights actually reach both branches across 50 cursors', () => {
    const base = freshMatch(31);
    const p = base.activePlayer;
    const seen = new Set<number>();

    for (let cursor = 0; cursor < 50; cursor++) {
      const s = withCursor(base, cursor);
      const next = resolveEffects(s, [TWO_BRANCHES], ctxFor(s));
      seen.add(moneyDelta(s, next, p));
    }

    expect(seen).toEqual(new Set([1, 100]));
  });

  test('B35: a branch with weight 0 is never picked, across 60 cursors', () => {
    const node: EffectNode = {
      op: 'random',
      branches: [
        { weight: 0, effects: [{ op: 'gain', stat: 'money', amount: 100 }] },
        { weight: 1, effects: [{ op: 'gain', stat: 'money', amount: 1 }] },
      ],
    };
    const base = freshMatch(32);
    const p = base.activePlayer;

    for (let cursor = 0; cursor < 60; cursor++) {
      const s = withCursor(base, cursor);
      const next = resolveEffects(s, [node], ctxFor(s));
      expect(moneyDelta(s, next, p)).toBe(1);
    }
  });

  test('B35: a single-branch random always resolves that branch', () => {
    const node: EffectNode = {
      op: 'random',
      branches: [{ weight: 1, effects: [{ op: 'gain', stat: 'money', amount: 7 }] }],
    };
    const base = freshMatch(33);
    const p = base.activePlayer;

    for (let cursor = 0; cursor < 20; cursor++) {
      const s = withCursor(base, cursor);
      const next = resolveEffects(s, [node], ctxFor(s));
      expect(moneyDelta(s, next, p)).toBe(7);
    }
  });

  test('B35: a heavily weighted branch is picked far more often than a light one', () => {
    const node: EffectNode = {
      op: 'random',
      branches: [
        { weight: 99, effects: [{ op: 'gain', stat: 'money', amount: 1 }] },
        { weight: 1, effects: [{ op: 'gain', stat: 'money', amount: 100 }] },
      ],
    };
    const base = freshMatch(34);
    const p = base.activePlayer;
    let heavy = 0;

    for (let cursor = 0; cursor < 100; cursor++) {
      const s = withCursor(base, cursor);
      const next = resolveEffects(s, [node], ctxFor(s));
      if (moneyDelta(s, next, p) === 1) heavy++;
    }

    expect(heavy).toBeGreaterThan(80);
  });
});

// --- B36 -------------------------------------------------------------------

describe('B36 - repeat and forEach', () => {
  test('B36: {op:"repeat", times:3} runs its body 3 times', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [{ op: 'repeat', times: 3, effects: [{ op: 'gain', stat: 'money', amount: 2 }] }],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(6);
  });

  test('B36: {op:"repeat", times:1} runs its body once', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [{ op: 'repeat', times: 1, effects: [{ op: 'gain', stat: 'money', amount: 2 }] }],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(2);
  });

  test('B36: {op:"repeat", times:0} runs its body zero times', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [{ op: 'repeat', times: 0, effects: [{ op: 'gain', stat: 'money', amount: 2 }] }],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(0);
  });

  test('B36: repeat with an empty body changes nothing', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const next = resolveEffects(s, [{ op: 'repeat', times: 5, effects: [] }], ctxFor(s));

    expect(moneyDelta(s, next, p)).toBe(0);
  });

  test('B36: repeat accepts an expression for times', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    expect(s.players[p].hand).toHaveLength(5);

    const next = resolveEffects(
      s,
      [
        {
          op: 'repeat',
          times: { expr: 'handSize' },
          effects: [{ op: 'gain', stat: 'money', amount: 2 }],
        },
      ],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(10);
  });

  test('B36: repeat with an expression that evaluates to 0 runs its body zero times', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    expect(s.players[p].gy).toHaveLength(0);

    const next = resolveEffects(
      s,
      [
        {
          op: 'repeat',
          times: { expr: 'gyHeight' },
          effects: [{ op: 'gain', stat: 'money', amount: 4 }],
        },
      ],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(0);
  });

  test('B36: nested repeats multiply their counts', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [
        {
          op: 'repeat',
          times: 2,
          effects: [
            { op: 'repeat', times: 3, effects: [{ op: 'gain', stat: 'money', amount: 1 }] },
          ],
        },
      ],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(6);
  });

  test('B36: {op:"forEach"} runs once per selected instance', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    expect(s.players[p].hand).toHaveLength(5);

    const next = resolveEffects(
      s,
      [
        {
          op: 'forEach',
          over: { who: 'self', zone: 'hand' },
          effects: [{ op: 'gain', stat: 'money', amount: 1 }],
        },
      ],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(5);
  });

  test('B36: forEach over an empty zone runs its body zero times', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    expect(s.players[p].gy).toHaveLength(0);

    const next = resolveEffects(
      s,
      [
        {
          op: 'forEach',
          over: { who: 'self', zone: 'gy' },
          effects: [{ op: 'gain', stat: 'money', amount: 1 }],
        },
      ],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(0);
  });

  test('B36: forEach over a selector that matches nothing runs its body zero times', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [
        {
          op: 'forEach',
          over: { who: 'self', zone: 'hand', filter: { name: '__no_such_card_name__' } },
          effects: [{ op: 'gain', stat: 'money', amount: 1 }],
        },
      ],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(0);
  });

  test('B36: forEach over the library runs once per library card', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    const libSize = s.players[p].library.length;
    expect(libSize).toBe(5);

    const next = resolveEffects(
      s,
      [
        {
          op: 'forEach',
          over: { who: 'self', zone: 'library' },
          effects: [{ op: 'gain', stat: 'money', amount: 1 }],
        },
      ],
      ctxFor(s),
    );

    expect(moneyDelta(s, next, p)).toBe(libSize);
  });

  test('B36: selectInstances returns exactly the selected zone contents', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const picked = selectInstances(s, { who: 'self', zone: 'hand' }, ctxFor(s));

    expect(new Set(picked)).toEqual(new Set(s.players[p].hand));
    expect(picked).toHaveLength(5);
  });

  test('B36: selectInstances honours count and returns no more than that', () => {
    const s = freshMatch();

    const picked = selectInstances(s, { who: 'self', zone: 'hand', count: 2, pick: 'top' }, ctxFor(s));

    expect(picked).toHaveLength(2);
    expect(new Set(picked).size).toBe(2);
  });

  test('B36: selectInstances returns an empty array when nothing matches', () => {
    const s = freshMatch();

    const picked = selectInstances(
      s,
      { who: 'self', zone: 'hand', filter: { name: '__no_such_card_name__' } },
      ctxFor(s),
    );

    expect(picked).toEqual([]);
  });

  test('B36: selectInstances over an empty zone returns an empty array', () => {
    const s = freshMatch();

    const picked = selectInstances(s, { who: 'self', zone: 'trash' }, ctxFor(s));

    expect(picked).toEqual([]);
  });
});
