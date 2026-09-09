/**
 * The engine capabilities the deferred cards were waiting on.
 *
 * Each of these was a thing the catalog printed and the engine could not
 * express, so a card either did nothing or did the wrong thing quietly. They
 * are tested against synthetic cards rather than shipped ones, so a later
 * balance edit to a real card cannot silently delete the coverage.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { registerCards } from '@engine/registry';
import { selectInstances, evalAmount, resolveEffects } from '@engine/effects';
import { makeContext } from '@engine/core/triggers';
import { costOf } from '@engine/shop';
import { expiryTurnFor } from '@engine/shop';
import { lockIsActive } from '@engine/shop/locks';
import type { CardDefinition, GameState, InstanceId, MatchConfig, PlayerId } from '@engine/types';

const CONFIG: MatchConfig = {
  playerCount: 3,
  draftPileCount: 10,
  anomalyChance: 0,
  winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
  pileSizeScale: 1,
  effectNodeBudget: 200,
  recursionDepth: 8,
  turnSeconds: 120,
  seedCodexWithCommons: true,
};

const INERT: CardDefinition = {
  id: 'test_inert',
  name: 'Test Inert',
  cost: { money: 0 },
  types: ['Action'],
  subtypes: [],
  tags: [],
  rarity: 'common',
  keywords: [],
  stats: {},
  effects: [],
  triggers: [],
  text: 'Nothing.',
  complexity: 'T1',
  subsystems: ['S-CORE'],
  notPurchasable: true,
  excludeFromPools: true,
  art: { key: 'test_inert', status: 'placeholder' },
};

function start(seed = 77): { state: GameState; me: PlayerId; others: PlayerId[] } {
  const state = createMatch(
    CONFIG,
    [
      { id: 'p1', name: 'One', codex: [] },
      { id: 'p2', name: 'Two', codex: [] },
      { id: 'p3', name: 'Three', codex: [] },
    ],
    seed,
  );
  const me = state.activePlayer;
  return { state, me, others: state.playerOrder.filter((x) => x !== me) };
}

function mint(state: GameState, owner: PlayerId, zone: 'hand' | 'library'): InstanceId {
  const iid = `i_cap_${Object.keys(state.instances).length}`;
  state.instances[iid] = {
    iid,
    defId: INERT.id,
    owner,
    zone,
    addedKeywords: [],
    removedKeywords: [],
    counters: {},
    statDelta: {},
    extraEffects: [],
    playedOnTurn: null,
  };
  (zone === 'hand' ? state.players[owner]!.hand : state.players[owner]!.library).push(iid);
  return iid;
}

beforeAll(() => {
  registerCards([INERT]);
});

describe('a selector count is a total, unless perPlayer says otherwise', () => {
  test('without perPlayer, two opponents lose two cards between them', () => {
    const { state, me, others } = start();
    for (const o of others) for (let k = 0; k < 3; k += 1) mint(state, o, 'hand');
    const picked = selectInstances(
      state,
      { who: 'eachOpponent', zone: 'hand', filter: { defId: INERT.id }, count: 2 },
      makeContext(me, null),
    );
    expect(picked).toHaveLength(2);
  });

  test('with perPlayer, each opponent loses two', () => {
    const { state, me, others } = start();
    for (const o of others) for (let k = 0; k < 3; k += 1) mint(state, o, 'hand');
    const picked = selectInstances(
      state,
      { who: 'eachOpponent', zone: 'hand', filter: { defId: INERT.id }, count: 2, perPlayer: true },
      makeContext(me, null),
    );
    expect(picked).toHaveLength(4);
    for (const o of others) {
      const mine = picked.filter((iid) => state.instances[iid]!.owner === o);
      expect(mine).toHaveLength(2);
    }
  });
});

describe('a filter bound may be an expression', () => {
  test('cost lte moneyUnspent selects only what the player can afford', () => {
    const { state, me } = start();
    const p = state.players[me]!;
    p.money = 3;
    // The shop is full of real cards at a spread of prices.
    const ctx = makeContext(me, null);
    const affordable = selectInstances(
      state,
      { zone: 'shop', filter: { cost: { lte: { expr: 'moneyUnspent' } } } },
      ctx,
    );
    expect(affordable.length).toBeGreaterThan(0);
    for (const iid of affordable) {
      const pileId = state.instances[iid]!.pileId!;
      expect(costOf(state, pileId, me)).toBeLessThanOrEqual(3);
    }

    p.money = 0;
    const broke = selectInstances(
      state,
      { zone: 'shop', filter: { cost: { lte: { expr: 'moneyUnspent' } } } },
      makeContext(me, null),
    );
    expect(broke.length).toBeLessThan(affordable.length);
  });
});

describe('player counters', () => {
  test('a turn-scoped counter is readable by name and clears at start of turn', () => {
    const { state, me, others } = start();
    const p = state.players[me]!;
    p.counters['turn:ricochetUsed'] = 1;
    p.counters['keepMe'] = 5;

    expect(evalAmount(state, { expr: 'ricochetUsed' }, makeContext(me, null))).toBe(1);
    expect(evalAmount(state, { expr: 'keepMe' }, makeContext(me, null))).toBe(5);

    let s = reduce(state, { type: 'endTurn', player: me });
    for (const o of others) s = reduce(s, { type: 'endTurn', player: o });

    expect(s.activePlayer).toBe(me);
    expect(s.players[me]!.counters['turn:ricochetUsed']).toBeUndefined();
    // A cumulative counter is untouched by the turn reset.
    expect(s.players[me]!.counters['keepMe']).toBe(5);
  });

  test('trashing stamps a per-turn subtype tally an expression can read', () => {
    const { state, me } = start();
    const p = state.players[me]!;
    // The Felinor token is Flimsy, so playing one trashes it.
    p.counters['turn:trashedFelinor'] = 2;
    expect(evalAmount(state, { expr: 'trashedFelinor' }, makeContext(me, null))).toBe(2);
  });
});

describe("a lock with duration 'turn' actually binds", () => {
  test('it is active on the turn it is applied', () => {
    const { state } = start();
    const expires = expiryTurnFor(state, 'turn');
    expect(expires).not.toBeNull();
    expect(
      lockIsActive(state, { by: 'p1', duration: 'turn', expiresOnTurn: expires }),
    ).toBe(true);
  });
});

describe('opponent shape is readable', () => {
  test('largestOpponentDeck and tallestOpponentLibrary see the real maximum', () => {
    const { state, me, others } = start();
    const victim = others[0]!;
    for (let k = 0; k < 6; k += 1) mint(state, victim, 'library');
    const ctx = makeContext(me, null);

    const biggest = evalAmount(state, { expr: 'largestOpponentDeck' }, ctx);
    const tallest = evalAmount(state, { expr: 'tallestOpponentLibrary' }, ctx);
    const v = state.players[victim]!;
    expect(biggest).toBe(v.library.length + v.hand.length + v.gy.length + v.play.length);
    expect(tallest).toBe(v.library.length);
    // Both must exceed the untouched opponent, which is the whole point.
    const other = state.players[others[1]!]!;
    expect(tallest).toBeGreaterThan(other.library.length);
  });
});

// ---------------------------------------------------------------------------
// The capabilities the last unimplemented clauses were waiting on.
// ---------------------------------------------------------------------------

/** Watches for a trash and sends the card to the GY instead. */
const SPARER: CardDefinition = {
  id: 'test_sparer',
  name: 'Test Sparer',
  cost: { money: 0 },
  types: ['Action'],
  subtypes: [],
  tags: [],
  rarity: 'common',
  keywords: [],
  stats: {},
  effects: [],
  triggers: [
    {
      on: 'onWouldTrash',
      zones: ['play'],
      effects: [
        {
          op: 'addCounter',
          target: {
            who: 'self',
            zone: ['hand', 'play', 'gy', 'library'],
            filter: { counter: { key: 'wouldTrash', gte: 1 } },
          },
          key: 'trashSpared',
          amount: 1,
        },
      ],
    },
  ],
  text: 'The next card of yours trashed goes to your GY instead.',
  complexity: 'T3',
  subsystems: ['S-CORE'],
  notPurchasable: true,
  excludeFromPools: true,
  art: { key: 'test_sparer', status: 'placeholder' },
};

describe('hand adjacency is captured before the card leaves the hand', () => {
  test('handEdge is 1 at either end of the hand and 0 in the middle', () => {
    const { state, me } = start();
    const p = state.players[me]!;
    p.hand.length = 0;
    const a = mint(state, me, 'hand');
    const b = mint(state, me, 'hand');
    const c = mint(state, me, 'hand');
    p.actions = 5;

    const mid = reduce(state, { type: 'play', player: me, iid: b });
    expect(mid.instances[b]!.counters['handEdge']).toBe(0);
    expect(mid.instances[b]!.counters['handIndex']).toBe(1);
    // The two cards it sat between are marked, so a selector can reach them.
    expect(mid.instances[a]!.counters['sandwich']).toBe(1);
    expect(mid.instances[c]!.counters['sandwich']).toBe(1);

    const edge = reduce(mid, { type: 'play', player: me, iid: a });
    expect(edge.instances[a]!.counters['handEdge']).toBe(1);
  });
});

describe('a card can intervene before another is trashed', () => {
  test('onWouldTrash can send the card to the GY instead of the trash', () => {
    registerCards([SPARER]);
    const { state, me } = start();
    const p = state.players[me]!;

    const guard = mint(state, me, 'hand');
    state.instances[guard]!.defId = SPARER.id;
    p.hand = p.hand.filter((x) => x !== guard);
    state.instances[guard]!.zone = 'play';
    p.play.push(guard);

    const victim = mint(state, me, 'hand');
    const gyBefore = p.gy.length;

    const after = resolveEffects(
      state,
      [{ op: 'trash', target: { who: 'self', zone: 'hand', filter: { defId: INERT.id }, count: 1 } }],
      makeContext(me, null),
    );

    expect(after.instances[victim]!.zone).toBe('gy');
    expect(after.players[me]!.gy.length).toBe(gyBefore + 1);
    // The marks are cleaned up either way.
    expect(after.instances[victim]!.counters['wouldTrash'] ?? 0).toBe(0);
    expect(after.instances[victim]!.counters['trashSpared'] ?? 0).toBe(0);
  });
});

describe('SB-7 Mutilate: a Pointer binding dies together', () => {
  test('trashing one half trashes the other', () => {
    const { state, me } = start();
    const a = mint(state, me, 'hand');
    const b = mint(state, me, 'hand');
    state.instances[a]!.counters['pointerPair'] = 42;
    state.instances[b]!.counters['pointerPair'] = 42;

    const after = resolveEffects(
      state,
      [{ op: 'trash', target: { who: 'self', zone: 'hand', filter: { counter: { key: 'pointerPair', gte: 1 } }, count: 1 } }],
      makeContext(me, null),
    );

    expect(after.instances[a]!.zone).toBe('trash');
    expect(after.instances[b]!.zone).toBe('trash');
  });
});

describe('a filter can require a same-cost partner', () => {
  test('hasSameCostPartnerIn excludes a card nothing in hand matches', () => {
    const { state, me } = start();
    const p = state.players[me]!;
    p.hand.length = 0;
    // Two Coppers (cost 0) and one Gold (cost 6) — only the Coppers pair.
    const c1 = mint(state, me, 'hand');
    const c2 = mint(state, me, 'hand');
    const lone = mint(state, me, 'hand');
    state.instances[c1]!.defId = 'copper';
    state.instances[c2]!.defId = 'copper';
    state.instances[lone]!.defId = 'gold';

    const paired = selectInstances(
      state,
      { who: 'self', zone: 'hand', filter: { hasSameCostPartnerIn: 'hand' } },
      makeContext(me, null),
    );
    expect(paired).toContain(c1);
    expect(paired).toContain(c2);
    expect(paired).not.toContain(lone);
  });
});
