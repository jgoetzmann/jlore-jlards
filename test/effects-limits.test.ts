/**
 * T2 - Effect DSL: budgets, recursion depth, unknown ops.
 * Behaviors B37, B38, B43.
 *
 * Fixtures are written inline on purpose (spec-tester rule 8).
 */
import { describe, test, expect } from 'vitest';

import { resolveEffects } from '@engine/effects';
import type { EffectContext } from '@engine/effects';
import { createMatch } from '@engine/index';
import type {
  EffectNode,
  GameState,
  LogEntry,
  MatchConfig,
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

function freshMatch(seed = 8080, over: Partial<MatchConfig> = {}): GameState {
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

function newEntries(before: GameState, after: GameState): LogEntry[] {
  return after.log.slice(before.log.length);
}

function anyEntryMatches(entries: LogEntry[], needle: RegExp): boolean {
  return entries.some(
    (e) => needle.test(e.kind) || needle.test(JSON.stringify(e.detail)),
  );
}

/** A sequence node nested `depth` levels deep around `inner`. */
function nest(depth: number, inner: EffectNode[]): EffectNode {
  let node: EffectNode = { op: 'sequence', effects: inner };
  for (let i = 0; i < depth; i++) {
    node = { op: 'sequence', effects: [node] };
  }
  return node;
}

// --- B37 -------------------------------------------------------------------

describe('B37 - effectNodeBudget stops resolution and logs a fizzle', () => {
  test('B37: a run well inside the budget resolves every node', () => {
    const s = freshMatch(1, { effectNodeBudget: 5000 });
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [{ op: 'repeat', times: 1000, effects: [{ op: 'gain', stat: 'money', amount: 1 }] }],
      ctxFor(s),
    );

    expect(next.players[p].money - s.players[p].money).toBe(1000);
  });

  test('B37: a run past the budget stops early instead of resolving everything', () => {
    const s = freshMatch(2, { effectNodeBudget: 10 });
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [{ op: 'repeat', times: 1000, effects: [{ op: 'gain', stat: 'money', amount: 1 }] }],
      ctxFor(s),
    );

    const gained = next.players[p].money - s.players[p].money;
    expect(gained).toBeLessThan(1000);
    expect(gained).toBeLessThanOrEqual(10);
  });

  test('B37: nodesResolvedThisTurn reaches the configured budget', () => {
    const s = freshMatch(3, { effectNodeBudget: 10 });
    expect(s.nodesResolvedThisTurn).toBe(0);

    const next = resolveEffects(
      s,
      [{ op: 'repeat', times: 1000, effects: [{ op: 'gain', stat: 'money', amount: 1 }] }],
      ctxFor(s),
    );

    expect(next.nodesResolvedThisTurn).toBeGreaterThanOrEqual(10);
  });

  test('B37: exhausting the budget logs a fizzle', () => {
    const s = freshMatch(4, { effectNodeBudget: 10 });

    const next = resolveEffects(
      s,
      [{ op: 'repeat', times: 1000, effects: [{ op: 'gain', stat: 'money', amount: 1 }] }],
      ctxFor(s),
    );

    const added = newEntries(s, next);
    expect(added.length).toBeGreaterThan(0);
    expect(anyEntryMatches(added, /fizzle/i)).toBe(true);
  });

  test('B37: a run inside the budget logs no fizzle', () => {
    const s = freshMatch(5, { effectNodeBudget: 5000 });

    const next = resolveEffects(
      s,
      [{ op: 'repeat', times: 5, effects: [{ op: 'gain', stat: 'money', amount: 1 }] }],
      ctxFor(s),
    );

    expect(anyEntryMatches(newEntries(s, next), /fizzle/i)).toBe(false);
  });

  test('B37: the budget is spent for the turn, so a second resolve on the same turn does nothing', () => {
    const s = freshMatch(6, { effectNodeBudget: 10 });
    const p = s.activePlayer;

    const spent = resolveEffects(
      s,
      [{ op: 'repeat', times: 1000, effects: [{ op: 'gain', stat: 'money', amount: 1 }] }],
      ctxFor(s),
    );
    expect(spent.nodesResolvedThisTurn).toBeGreaterThanOrEqual(10);

    const again = resolveEffects(
      spent,
      [{ op: 'gain', stat: 'money', amount: 50 }],
      ctxFor(spent),
    );

    expect(again.players[p].money).toBe(spent.players[p].money);
  });

  test('B37: a budget of 0 resolves nothing at all', () => {
    const s = freshMatch(7, { effectNodeBudget: 0 });
    const p = s.activePlayer;

    const next = resolveEffects(s, [{ op: 'gain', stat: 'money', amount: 9 }], ctxFor(s));

    expect(next.players[p].money).toBe(s.players[p].money);
  });

  test('B37: an over-budget run terminates rather than hanging', () => {
    const s = freshMatch(8, { effectNodeBudget: 50 });

    let next: GameState | undefined;
    expect(() => {
      next = resolveEffects(
        s,
        [
          {
            op: 'repeat',
            times: 1000000,
            effects: [{ op: 'gain', stat: 'money', amount: 1 }],
          },
        ],
        ctxFor(s),
      );
    }).not.toThrow();

    expect(next).toBeDefined();
    expect((next as GameState).players[s.activePlayer].money).toBeLessThanOrEqual(50);
  }, 10000);
});

// --- B38 -------------------------------------------------------------------

describe('B38 - recursionDepth fizzles instead of overflowing the stack', () => {
  test('B38: a context at exactly recursionDepth still resolves its effects', () => {
    const s = freshMatch(20, { recursionDepth: 4 });
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [{ op: 'sequence', effects: [{ op: 'gain', stat: 'money', amount: 7 }] }],
      ctxFor(s, { depth: 4 }),
    );

    expect(next.players[p].money - s.players[p].money).toBe(7);
  });

  test('B38: a context deeper than recursionDepth resolves nothing', () => {
    const s = freshMatch(21, { recursionDepth: 4 });
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [{ op: 'sequence', effects: [{ op: 'gain', stat: 'money', amount: 7 }] }],
      ctxFor(s, { depth: 5 }),
    );

    expect(next.players[p].money).toBe(s.players[p].money);
  });

  test('B38: a context deeper than recursionDepth logs a fizzle instead of throwing', () => {
    const s = freshMatch(22, { recursionDepth: 4 });

    let next: GameState | undefined;
    expect(() => {
      next = resolveEffects(
        s,
        [{ op: 'gain', stat: 'money', amount: 7 }],
        ctxFor(s, { depth: 9 }),
      );
    }).not.toThrow();

    const added = newEntries(s, next as GameState);
    expect(anyEntryMatches(added, /fizzle/i)).toBe(true);
  });

  test('B38: a deeply over-depth context still leaves every player stat untouched', () => {
    const s = freshMatch(23, { recursionDepth: 2 });
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [
        { op: 'gain', stat: 'money', amount: 5 },
        { op: 'draw', amount: 3 },
      ],
      ctxFor(s, { depth: 50 }),
    );

    expect(next.players[p].money).toBe(s.players[p].money);
    expect(next.players[p].hand).toHaveLength(5);
  });

  test('B38: a 5000-deep self-referential nest terminates without a stack overflow', () => {
    const s = freshMatch(24, { recursionDepth: 8, effectNodeBudget: 100000 });

    let next: GameState | undefined;
    expect(() => {
      next = resolveEffects(
        s,
        [nest(5000, [{ op: 'gain', stat: 'money', amount: 1 }])],
        ctxFor(s),
      );
    }).not.toThrow();

    expect(next).toBeDefined();
    expect(typeof (next as GameState).turn).toBe('number');
  }, 20000);

  test('B38: a 20000-deep nest still terminates without a stack overflow', () => {
    const s = freshMatch(25, { recursionDepth: 4, effectNodeBudget: 100000 });

    let next: GameState | undefined;
    expect(() => {
      next = resolveEffects(
        s,
        [nest(20000, [{ op: 'gain', stat: 'money', amount: 1 }])],
        ctxFor(s),
      );
    }).not.toThrow();

    expect(next).toBeDefined();
  }, 30000);

  test('B38: a nest far deeper than recursionDepth never reaches its innermost effect', () => {
    const s = freshMatch(26, { recursionDepth: 3, effectNodeBudget: 100000 });
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [nest(500, [{ op: 'gain', stat: 'money', amount: 1000 }])],
      ctxFor(s),
    );

    expect(next.players[p].money).toBe(s.players[p].money);
  }, 20000);
});

// --- B43 -------------------------------------------------------------------

const BOGUS_NODE = { op: 'thisOpDoesNotExist' } as unknown as EffectNode;
const BOGUS_WITH_PAYLOAD = {
  op: 'anotherUnknownOp',
  stat: 'money',
  amount: 5,
} as unknown as EffectNode;

describe('B43 - unknown ops are logged and skipped', () => {
  test('B43: an unknown op does not throw', () => {
    const s = freshMatch(40);

    expect(() => resolveEffects(s, [BOGUS_NODE], ctxFor(s))).not.toThrow();
  });

  test('B43: an unknown op changes no player state', () => {
    const s = freshMatch(41);
    const p = s.activePlayer;

    const next = resolveEffects(s, [BOGUS_NODE], ctxFor(s));

    expect(next.players[p].money).toBe(s.players[p].money);
    expect(next.players[p].hand).toHaveLength(5);
    expect(next.players[p].library).toHaveLength(5);
  });

  test('B43: an unknown op appends a log entry', () => {
    const s = freshMatch(42);

    const next = resolveEffects(s, [BOGUS_NODE], ctxFor(s));

    expect(next.log.length).toBeGreaterThan(s.log.length);
    expect(next.logSeq).toBeGreaterThan(s.logSeq);
  });

  test('B43: the log entry names the unknown op', () => {
    const s = freshMatch(43);

    const next = resolveEffects(s, [BOGUS_NODE], ctxFor(s));

    expect(anyEntryMatches(newEntries(s, next), /thisOpDoesNotExist/)).toBe(true);
  });

  test('B43: an unknown op is skipped, so later nodes in the list still resolve', () => {
    const s = freshMatch(44);
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [BOGUS_NODE, { op: 'gain', stat: 'money', amount: 4 }],
      ctxFor(s),
    );

    expect(next.players[p].money - s.players[p].money).toBe(4);
  });

  test('B43: an unknown op between two known nodes skips only itself', () => {
    const s = freshMatch(45);
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [
        { op: 'gain', stat: 'money', amount: 1 },
        BOGUS_WITH_PAYLOAD,
        { op: 'gain', stat: 'money', amount: 2 },
      ],
      ctxFor(s),
    );

    expect(next.players[p].money - s.players[p].money).toBe(3);
  });

  test('B43: an unknown op nested inside a repeat does not abort the repeat body', () => {
    const s = freshMatch(46);
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [
        {
          op: 'repeat',
          times: 3,
          effects: [BOGUS_NODE, { op: 'gain', stat: 'money', amount: 2 }],
        },
      ],
      ctxFor(s),
    );

    expect(next.players[p].money - s.players[p].money).toBe(6);
  });

  test('B43: an unknown op nested inside a conditional then-branch is skipped, not fatal', () => {
    const s = freshMatch(47);
    const p = s.activePlayer;

    let next: GameState | undefined;
    expect(() => {
      next = resolveEffects(
        s,
        [
          {
            op: 'conditional',
            if: { not: { combo: 3 } },
            then: [BOGUS_NODE, { op: 'gain', stat: 'money', amount: 3 }],
          },
        ],
        ctxFor(s),
      );
    }).not.toThrow();

    expect((next as GameState).players[p].money - s.players[p].money).toBe(3);
  });

  test('B43: an unknown op inside a forEach body does not abort the iteration', () => {
    const s = freshMatch(49);
    const p = s.activePlayer;
    expect(s.players[p].hand).toHaveLength(5);

    let next: GameState | undefined;
    expect(() => {
      next = resolveEffects(
        s,
        [
          {
            op: 'forEach',
            over: { who: 'self', zone: 'hand' },
            effects: [BOGUS_NODE, { op: 'gain', stat: 'money', amount: 1 }],
          },
        ],
        ctxFor(s),
      );
    }).not.toThrow();

    expect((next as GameState).players[p].money - s.players[p].money).toBe(5);
  });

  test('B43: several unknown ops in a row are all skipped and all logged', () => {
    const s = freshMatch(48);
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [BOGUS_NODE, BOGUS_WITH_PAYLOAD, BOGUS_NODE, { op: 'gain', stat: 'money', amount: 1 }],
      ctxFor(s),
    );

    expect(next.players[p].money - s.players[p].money).toBe(1);
    expect(newEntries(s, next).length).toBeGreaterThanOrEqual(3);
  });
});
