/**
 * T2 - Effect DSL: Discover.
 * Behaviors B30, B31, B32, B33.
 *
 * Fixtures are written inline on purpose (spec-tester rule 8).
 */
import { describe, test, expect } from 'vitest';

import { resolveEffects } from '@engine/effects';
import type { EffectContext } from '@engine/effects';
import { createMatch, reduce } from '@engine/index';
import { allCards } from '@engine/registry';
import type {
  CardDefId,
  EffectNode,
  GameState,
  MatchConfig,
  PlayerId,
  PromptOption,
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

function matchWith(
  seed: number,
  codex: CardDefId[],
  over: Partial<MatchConfig> = {},
): GameState {
  return createMatch(
    makeConfig(over),
    [
      { id: 'p1', name: 'Alice', codex: [...codex] },
      { id: 'p2', name: 'Bob', codex: [...codex] },
    ],
    seed,
    null,
  );
}

function freshMatch(seed = 4242): GameState {
  return matchWith(seed, []);
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

function withCursor(s: GameState, cursor: number): GameState {
  const c = structuredClone(s);
  c.rngCursor = cursor;
  return c;
}

/** Run one discover node and return the options it offered (empty when it offered none). */
function offerFrom(s: GameState, node: EffectNode): PromptOption[] {
  const next = resolveEffects(s, [node], ctxFor(s));
  return next.pending === null ? [] : next.pending.options;
}

function commonIds(n: number): CardDefId[] {
  return allCards()
    .filter((c) => c.rarity === 'common' && c.excludeFromPools !== true && c.notPurchasable !== true)
    .slice(0, n)
    .map((c) => c.id);
}

// --- B30 -------------------------------------------------------------------

describe('B30 - discover suspends and resumes', () => {
  test('B30: {op:"discover"} sets state.pending as a discover prompt for the resolving player', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const next = resolveEffects(
      s,
      [{ op: 'discover', pool: { scope: 'entireUniverse' }, then: [] }],
      ctxFor(s),
    );

    expect(next.pending).not.toBeNull();
    const prompt = next.pending as NonNullable<GameState['pending']>;
    expect(prompt.type).toBe('discover');
    expect(prompt.player).toBe(p);
    expect(prompt.options.length).toBeGreaterThan(0);
    expect(typeof prompt.id).toBe('string');
    expect(prompt.id.length).toBeGreaterThan(0);
  });

  test('B30: effects after the discover do not run while it is suspended', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    const before = s.players[p].money;

    const next = resolveEffects(
      s,
      [
        { op: 'discover', pool: { scope: 'entireUniverse' }, then: [] },
        { op: 'gain', stat: 'money', amount: 5 },
      ],
      ctxFor(s),
    );

    expect(next.pending).not.toBeNull();
    expect(next.players[p].money).toBe(before);
  });

  test('B30: a matching resolve action resumes the suspended effects', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    const before = s.players[p].money;

    const suspended = resolveEffects(
      s,
      [
        { op: 'discover', pool: { scope: 'entireUniverse' }, then: [] },
        { op: 'gain', stat: 'money', amount: 5 },
      ],
      ctxFor(s),
    );
    const prompt = suspended.pending as NonNullable<GameState['pending']>;

    const resumed = reduce(suspended, {
      type: 'resolve',
      player: p,
      promptId: prompt.id,
      keys: [prompt.options[0].key],
    });

    expect(resumed.pending).toBeNull();
    expect(resumed.players[p].money).toBe(before + 5);
  });

  test('B30: a matching resolve action runs the discover node own "then" effects', () => {
    const s = freshMatch(31337);
    const p = s.activePlayer;
    const before = s.players[p].money;

    const suspended = resolveEffects(
      s,
      [
        {
          op: 'discover',
          pool: { scope: 'entireUniverse' },
          then: [{ op: 'gain', stat: 'money', amount: 2 }],
        },
      ],
      ctxFor(s),
    );
    const prompt = suspended.pending as NonNullable<GameState['pending']>;

    const resumed = reduce(suspended, {
      type: 'resolve',
      player: p,
      promptId: prompt.id,
      keys: [prompt.options[0].key],
    });

    expect(resumed.pending).toBeNull();
    expect(resumed.players[p].money).toBe(before + 2);
  });

  test('B30: a resolve with a promptId that does not match leaves the prompt in place', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const suspended = resolveEffects(
      s,
      [
        { op: 'discover', pool: { scope: 'entireUniverse' }, then: [] },
        { op: 'gain', stat: 'money', amount: 5 },
      ],
      ctxFor(s),
    );
    const prompt = suspended.pending as NonNullable<GameState['pending']>;

    const out = reduce(suspended, {
      type: 'resolve',
      player: p,
      promptId: 'not-the-real-prompt-id',
      keys: [prompt.options[0].key],
    });

    expect(out.pending).not.toBeNull();
    expect(out.players[p].money).toBe(suspended.players[p].money);
  });

  test('B30: a resolve from a player who does not own the prompt leaves the prompt in place', () => {
    const s = freshMatch();
    const p = s.activePlayer;
    const other = s.playerOrder.find((id) => id !== p) as PlayerId;

    const suspended = resolveEffects(
      s,
      [
        { op: 'discover', pool: { scope: 'entireUniverse' }, then: [] },
        { op: 'gain', stat: 'money', amount: 5 },
      ],
      ctxFor(s),
    );
    const prompt = suspended.pending as NonNullable<GameState['pending']>;

    const out = reduce(suspended, {
      type: 'resolve',
      player: other,
      promptId: prompt.id,
      keys: [prompt.options[0].key],
    });

    expect(out.pending).not.toBeNull();
    expect(out.players[p].money).toBe(suspended.players[p].money);
    expect(out.players[other].money).toBe(suspended.players[other].money);
  });

  test('B30: a resolve carrying a key that was never offered leaves the prompt in place', () => {
    const s = freshMatch();
    const p = s.activePlayer;

    const suspended = resolveEffects(
      s,
      [
        { op: 'discover', pool: { scope: 'entireUniverse' }, then: [] },
        { op: 'gain', stat: 'money', amount: 5 },
      ],
      ctxFor(s),
    );
    const prompt = suspended.pending as NonNullable<GameState['pending']>;
    expect(prompt.options.map((o) => o.key)).not.toContain('__never_offered__');

    const out = reduce(suspended, {
      type: 'resolve',
      player: p,
      promptId: prompt.id,
      keys: ['__never_offered__'],
    });

    expect(out.pending).not.toBeNull();
    expect(out.players[p].money).toBe(suspended.players[p].money);
  });
});

// --- B31 -------------------------------------------------------------------

describe('B31 - offer size, pick size, no duplicates', () => {
  test('B31: a discover with no count offers exactly 3 options', () => {
    const s = freshMatch(11);
    const opts = offerFrom(s, { op: 'discover', pool: { scope: 'entireUniverse' }, then: [] });

    expect(opts).toHaveLength(3);
  });

  test('B31: a discover with no pick asks for exactly 1 selection', () => {
    const s = freshMatch(12);
    const next = resolveEffects(
      s,
      [{ op: 'discover', pool: { scope: 'entireUniverse' }, then: [] }],
      ctxFor(s),
    );
    const prompt = next.pending as NonNullable<GameState['pending']>;

    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
  });

  test('B31: count:5 offers exactly 5 options', () => {
    const s = freshMatch(13);
    const opts = offerFrom(s, {
      op: 'discover',
      pool: { scope: 'entireUniverse' },
      count: 5,
      then: [],
    });

    expect(opts).toHaveLength(5);
  });

  test('B31: pick:2 asks for exactly 2 selections out of count:4 options', () => {
    const s = freshMatch(14);
    const next = resolveEffects(
      s,
      [{ op: 'discover', pool: { scope: 'entireUniverse' }, count: 4, pick: 2, then: [] }],
      ctxFor(s),
    );
    const prompt = next.pending as NonNullable<GameState['pending']>;

    expect(prompt.options).toHaveLength(4);
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
  });

  test('B31: a discover never offers the same card twice, across 40 rng cursors', () => {
    const base = freshMatch(15);
    for (let cursor = 0; cursor < 40; cursor++) {
      const opts = offerFrom(withCursor(base, cursor), {
        op: 'discover',
        pool: { scope: 'entireUniverse' },
        count: 5,
        then: [],
      });
      expect(opts).toHaveLength(5);
      const defIds = opts.map((o) => o.defId);
      expect(defIds.every((d) => typeof d === 'string' && d.length > 0)).toBe(true);
      expect(new Set(defIds).size).toBe(defIds.length);
      expect(new Set(opts.map((o) => o.key)).size).toBe(opts.length);
    }
  });

  test('B31: a pool holding fewer cards than count offers only what the pool holds', () => {
    const pair = commonIds(2);
    expect(pair).toHaveLength(2);

    const s = freshMatch(16);
    const opts = offerFrom(s, {
      op: 'discover',
      pool: { scope: 'entireUniverse', filter: { defId: pair } },
      count: 5,
      then: [],
    });

    expect(opts).toHaveLength(2);
    expect(new Set(opts.map((o) => o.defId))).toEqual(new Set(pair));
  });

  test('B31: a pool holding one card offers exactly that one card, not three copies', () => {
    const [only] = commonIds(1);
    expect(typeof only).toBe('string');

    const s = freshMatch(17);
    const opts = offerFrom(s, {
      op: 'discover',
      pool: { scope: 'entireUniverse', filter: { defId: [only] } },
      then: [],
    });

    expect(opts).toHaveLength(1);
    expect(opts[0].defId).toBe(only);
  });

  test('B31: a pool that matches nothing offers no options and does not throw', () => {
    const s = freshMatch(18);
    let opts: PromptOption[] | undefined;

    expect(() => {
      opts = offerFrom(s, {
        op: 'discover',
        pool: { scope: 'entireUniverse', filter: { name: '__no_such_card_name__' } },
        then: [],
      });
    }).not.toThrow();

    expect(opts).toHaveLength(0);
  });
});

// --- B32 -------------------------------------------------------------------

describe('B32 - knownUniverse versus entireUniverse', () => {
  test('B32: a knownUniverse discover offers only ids in that player codex', () => {
    const seedIds = commonIds(6);
    expect(seedIds.length).toBe(6);

    const base = matchWith(2001, seedIds, { seedCodexWithCommons: false });
    const p = base.activePlayer;
    const codex = new Set(base.players[p].codex);
    expect(codex.size).toBeLessThan(allCards().length);

    for (let cursor = 0; cursor < 25; cursor++) {
      const opts = offerFrom(withCursor(base, cursor), {
        op: 'discover',
        pool: { scope: 'knownUniverse' },
        count: 3,
        then: [],
      });
      for (const o of opts) {
        expect(codex.has(o.defId as CardDefId)).toBe(true);
      }
    }
  });

  test('B32: a card absent from the codex is never offered by a knownUniverse discover', () => {
    const seedIds = commonIds(6);
    const base = matchWith(2002, seedIds, { seedCodexWithCommons: false });
    const p = base.activePlayer;
    const codex = new Set(base.players[p].codex);

    const outsider = allCards().find((c) => !codex.has(c.id));
    expect(outsider).toBeDefined();

    for (let cursor = 0; cursor < 40; cursor++) {
      const opts = offerFrom(withCursor(base, cursor), {
        op: 'discover',
        pool: { scope: 'knownUniverse' },
        count: 3,
        then: [],
      });
      expect(opts.map((o) => o.defId)).not.toContain(outsider!.id);
    }
  });

  test('B32: an entireUniverse discover offers only registered card ids', () => {
    const registered = new Set(allCards().map((c) => c.id));
    const base = freshMatch(2003);

    for (let cursor = 0; cursor < 25; cursor++) {
      const opts = offerFrom(withCursor(base, cursor), {
        op: 'discover',
        pool: { scope: 'entireUniverse' },
        count: 3,
        then: [],
      });
      expect(opts).toHaveLength(3);
      for (const o of opts) {
        expect(registered.has(o.defId as CardDefId)).toBe(true);
      }
    }
  });

  test('B32: an entireUniverse discover reaches beyond the resolving player codex', () => {
    const seedIds = commonIds(6);
    const base = matchWith(2004, seedIds, { seedCodexWithCommons: false });
    const p = base.activePlayer;
    const codex = new Set(base.players[p].codex);

    const seen = new Set<CardDefId>();
    for (let cursor = 0; cursor < 40; cursor++) {
      const opts = offerFrom(withCursor(base, cursor), {
        op: 'discover',
        pool: { scope: 'entireUniverse' },
        count: 3,
        then: [],
      });
      for (const o of opts) seen.add(o.defId as CardDefId);
    }

    const outsideCodex = [...seen].filter((id) => !codex.has(id));
    expect(outsideCodex.length).toBeGreaterThan(0);
  });

  test('B32: two players with different codexes get different knownUniverse pools', () => {
    const ids = commonIds(12);
    expect(ids.length).toBe(12);
    const aOnly = ids.slice(0, 6);
    const bOnly = ids.slice(6, 12);

    const s = createMatch(
      makeConfig({ seedCodexWithCommons: false }),
      [
        { id: 'p1', name: 'Alice', codex: [...aOnly] },
        { id: 'p2', name: 'Bob', codex: [...bOnly] },
      ],
      2005,
      null,
    );

    const codexA = new Set(s.players.p1.codex);
    const codexB = new Set(s.players.p2.codex);

    for (let cursor = 0; cursor < 20; cursor++) {
      const cur = withCursor(s, cursor);
      const forA = resolveEffects(
        cur,
        [{ op: 'discover', pool: { scope: 'knownUniverse' }, count: 3, then: [] }],
        ctxFor(cur, { player: 'p1' }),
      );
      const forB = resolveEffects(
        cur,
        [{ op: 'discover', pool: { scope: 'knownUniverse' }, count: 3, then: [] }],
        ctxFor(cur, { player: 'p2' }),
      );

      for (const o of forA.pending === null ? [] : forA.pending.options) {
        expect(codexA.has(o.defId as CardDefId)).toBe(true);
      }
      for (const o of forB.pending === null ? [] : forB.pending.options) {
        expect(codexB.has(o.defId as CardDefId)).toBe(true);
      }
    }
  });
});

// --- B33 -------------------------------------------------------------------

describe('B33 - excludeFromPools cards never appear in any pool', () => {
  test('B33: the catalog actually contains at least one excludeFromPools card', () => {
    const excluded = allCards().filter((c) => c.excludeFromPools === true);
    expect(excluded.length).toBeGreaterThan(0);
  });

  test('B33: no excludeFromPools card is ever offered by an entireUniverse discover, over 60 seeds', () => {
    const excluded = new Set(
      allCards().filter((c) => c.excludeFromPools === true).map((c) => c.id),
    );
    expect(excluded.size).toBeGreaterThan(0);

    for (let seed = 1; seed <= 60; seed++) {
      const opts = offerFrom(freshMatch(seed), {
        op: 'discover',
        pool: { scope: 'entireUniverse' },
        count: 5,
        then: [],
      });
      expect(opts).toHaveLength(5);
      for (const o of opts) {
        expect(excluded.has(o.defId as CardDefId)).toBe(false);
      }
    }
  });

  test('B33: no excludeFromPools card is ever offered across 100 rng cursors', () => {
    const excluded = new Set(
      allCards().filter((c) => c.excludeFromPools === true).map((c) => c.id),
    );
    const base = freshMatch(777);

    for (let cursor = 0; cursor < 100; cursor++) {
      const opts = offerFrom(withCursor(base, cursor), {
        op: 'discover',
        pool: { scope: 'entireUniverse' },
        count: 5,
        then: [],
      });
      for (const o of opts) {
        expect(excluded.has(o.defId as CardDefId)).toBe(false);
      }
    }
  });

  test('B33: an excludeFromPools card seeded into a codex is still never offered from knownUniverse', () => {
    const excludedCards = allCards().filter((c) => c.excludeFromPools === true);
    expect(excludedCards.length).toBeGreaterThan(0);
    const excludedId = excludedCards[0].id;

    const codexSeed = [excludedId, ...commonIds(5)];
    const base = matchWith(888, codexSeed, { seedCodexWithCommons: false });
    expect(base.players[base.activePlayer].codex).toContain(excludedId);

    for (let cursor = 0; cursor < 60; cursor++) {
      const opts = offerFrom(withCursor(base, cursor), {
        op: 'discover',
        pool: { scope: 'knownUniverse' },
        count: 3,
        then: [],
      });
      expect(opts.map((o) => o.defId)).not.toContain(excludedId);
    }
  });

  test('B33: an explicit filter naming only excludeFromPools cards offers nothing', () => {
    const excludedIds = allCards()
      .filter((c) => c.excludeFromPools === true)
      .map((c) => c.id);
    expect(excludedIds.length).toBeGreaterThan(0);

    const s = freshMatch(999);
    const opts = offerFrom(s, {
      op: 'discover',
      pool: { scope: 'entireUniverse', filter: { defId: excludedIds } },
      count: 3,
      then: [],
    });

    expect(opts).toHaveLength(0);
  });

  test('B33: a random createCard pool never produces an excludeFromPools card, over 60 seeds', () => {
    const excluded = new Set(
      allCards().filter((c) => c.excludeFromPools === true).map((c) => c.id),
    );

    for (let seed = 1; seed <= 60; seed++) {
      const s = freshMatch(seed);
      const p = s.activePlayer;
      const next = resolveEffects(
        s,
        [
          {
            op: 'createCard',
            defId: { pool: { scope: 'entireUniverse' } },
            to: 'hand',
          },
        ],
        ctxFor(s),
      );

      const before = new Set(s.players[p].hand);
      const created = next.players[p].hand.filter((iid) => !before.has(iid));
      for (const iid of created) {
        expect(excluded.has(next.instances[iid].defId)).toBe(false);
      }
    }
  });
});
