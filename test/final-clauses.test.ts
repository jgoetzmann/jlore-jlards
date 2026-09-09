/**
 * The last two card clauses the catalog audit left open, and the two engine
 * defects closing them exposed.
 *
 * - Homebrew's row adds a discovered card's effect to itself with no play in
 *   between, which nothing in the effect DSL could express: `extraEffects` was
 *   reachable only by arming a NextCardMod and waiting for a play.
 * - Pointer's row lists Played / Mutilated / Trashed together. The last two
 *   were symmetric properties of the pairing; the first was only the formation
 *   moment, so the sentence read two ways at once.
 * - Plays routed through the effects layer ignored an armed absorb entirely.
 * - The pair id was read off the instance sequence without consuming it, so
 *   two bindings formed back to back collided on one id.
 *
 * Tested against synthetic cards, so a later balance edit to a shipped card
 * cannot quietly delete the coverage.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { registerCards } from '@engine/registry';
import { evalAmount, resolveEffects } from '@engine/effects';
import { makeContext } from '@engine/core/triggers';
import type { CardDefinition, GameState, InstanceId, MatchConfig, PlayerId, Zone } from '@engine/types';

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
  id: 'test_clause_inert',
  name: 'Test Clause Inert',
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
  art: { key: 'test_clause_inert', status: 'placeholder' },
};

/** A card whose whole output is one printed clause, so an absorb is visible. */
const BREW: CardDefinition = {
  ...INERT,
  id: 'test_brew_source',
  name: 'Test Brew Source',
  effects: [{ op: 'gain', stat: 'money', amount: 2 }],
  text: '+2 Money.',
  art: { key: 'test_brew_source', status: 'placeholder' },
};

function start(seed = 77): { state: GameState; me: PlayerId } {
  const state = createMatch(
    CONFIG,
    [
      { id: 'p1', name: 'One', codex: [] },
      { id: 'p2', name: 'Two', codex: [] },
      { id: 'p3', name: 'Three', codex: [] },
    ],
    seed,
  );
  return { state, me: state.activePlayer };
}

function mint(state: GameState, owner: PlayerId, zone: Zone): InstanceId {
  const iid = `i_clause_${Object.keys(state.instances).length}`;
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
  const p = state.players[owner]!;
  if (zone === 'hand') p.hand.push(iid);
  else if (zone === 'library') p.library.push(iid);
  else if (zone === 'play') p.play.push(iid);
  else if (zone === 'gy') p.gy.push(iid);
  return iid;
}

beforeAll(() => {
  registerCards([INERT, BREW]);
});

describe("Homebrew's absorb lands without a play in the middle", () => {
  test('{op:absorb} grafts a definition onto an instance', () => {
    const { state, me } = start();
    const host = mint(state, me, 'hand');
    expect(state.instances[host]!.extraEffects).toHaveLength(0);

    const after = resolveEffects(
      state,
      [
        {
          op: 'absorb',
          defId: BREW.id,
          target: { who: 'self', zone: 'hand', filter: { defId: INERT.id }, count: 1 },
        },
      ],
      makeContext(me, null),
    );

    expect(after.instances[host]!.extraEffects).toEqual(BREW.effects);
  });

  test('the graft survives an upgrade — "permanently, then upgrade it" in one row', () => {
    const { state, me } = start();
    const host = mint(state, me, 'hand');
    state.instances[host]!.defId = 'copper';

    const after = resolveEffects(
      state,
      [
        { op: 'absorb', defId: BREW.id, target: { who: 'self', zone: 'hand', filter: { defId: 'copper' } } },
        {
          op: 'transform',
          target: { who: 'self', zone: 'hand', filter: { defId: 'copper' } },
          into: 'upgrade',
        },
      ],
      makeContext(me, null),
    );

    const live = after.instances[host]!;
    expect(live.defId).not.toBe('copper');
    expect(live.extraEffects).toEqual(BREW.effects);
  });

  test('an absorbed clause is paid out the next time the host is played', () => {
    const { state, me } = start();
    const p = state.players[me]!;
    p.hand.length = 0;
    p.actions = 5;
    p.money = 0;
    const host = mint(state, me, 'hand');
    state.instances[host]!.extraEffects = [...BREW.effects];

    const after = reduce(state, { type: 'play', player: me, iid: host });
    expect(after.players[me]!.money).toBe(2);
  });
});

describe('a play routed through the effects layer honours an armed absorb', () => {
  test('resolveCardPlay consumes absorbInto the way a hand play does', () => {
    const { state, me } = start();
    const p = state.players[me]!;
    p.hand.length = 0;

    const hive = mint(state, me, 'play');
    const victim = mint(state, me, 'hand');
    state.instances[victim]!.defId = BREW.id;
    p.nextCardMods.push({ absorbInto: hive, uses: 1, appliesTo: 'play' });

    const after = resolveEffects(
      state,
      [{ op: 'playCard', target: { who: 'self', zone: 'hand', filter: { defId: BREW.id }, count: 1 } }],
      makeContext(me, null),
    );

    expect(after.instances[hive]!.extraEffects).toEqual(BREW.effects);
    // Spent, not left dangling for whatever is played next.
    expect(after.players[me]!.nextCardMods).toHaveLength(0);
  });
});

describe('SB-7 Played together', () => {
  test('playing one half from hand plays the other, and does not charge for it', () => {
    const { state, me } = start();
    const p = state.players[me]!;
    p.hand.length = 0;
    const a = mint(state, me, 'hand');
    const b = mint(state, me, 'hand');
    state.instances[a]!.counters['pointerPair'] = 7;
    state.instances[b]!.counters['pointerPair'] = 7;
    p.actions = 5;

    const after = reduce(state, { type: 'play', player: me, iid: a });

    expect(after.instances[a]!.zone).toBe('play');
    expect(after.instances[b]!.zone).toBe('play');
    // One Action for the play the player asked for; the partner rides free.
    expect(after.players[me]!.actions).toBe(4);
    // The cycle guard is cleaned up either way.
    expect(after.instances[a]!.counters['pointerPlaying'] ?? 0).toBe(0);
    expect(after.instances[b]!.counters['pointerPlaying'] ?? 0).toBe(0);
  });

  test('an unpaired card pulls nothing out of hand', () => {
    const { state, me } = start();
    const p = state.players[me]!;
    p.hand.length = 0;
    const a = mint(state, me, 'hand');
    const b = mint(state, me, 'hand');
    p.actions = 5;

    const after = reduce(state, { type: 'play', player: me, iid: a });
    expect(after.instances[b]!.zone).toBe('hand');
  });

  test('two bindings formed back to back do not share one pair id', () => {
    const { state, me } = start();
    const p = state.players[me]!;
    p.hand.length = 0;
    const ptr1 = mint(state, me, 'hand');
    const ptr2 = mint(state, me, 'hand');
    const a = mint(state, me, 'hand');
    const b = mint(state, me, 'hand');
    state.instances[ptr1]!.defId = 'pointer';
    state.instances[ptr2]!.defId = 'pointer';
    p.actions = 20;

    let s = reduce(state, { type: 'play', player: me, iid: ptr1 });
    s = reduce(s, { type: 'play', player: me, iid: a });
    s = reduce(s, { type: 'play', player: me, iid: ptr2 });
    s = reduce(s, { type: 'play', player: me, iid: b });

    const first = s.instances[ptr1]!.counters['pointerPair'] ?? 0;
    const second = s.instances[ptr2]!.counters['pointerPair'] ?? 0;
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(0);
    // Reading the sequence without consuming it gave both bindings one id, so
    // trashing any of the four took the other three with it.
    expect(first).not.toBe(second);
    expect(s.instances[a]!.counters['pointerPair']).toBe(first);
    expect(s.instances[b]!.counters['pointerPair']).toBe(second);
  });
});

describe('engine bookkeeping stays out of selfCounter', () => {
  test('a Pointed card does not read its pair id as a counter total', () => {
    const { state, me } = start();
    const iid = mint(state, me, 'play');
    const inst = state.instances[iid]!;
    inst.counters['pointerPair'] = 341;
    inst.counters['handSizeAtPlay'] = 5;
    inst.counters['charges'] = 2;

    expect(evalAmount(state, { expr: 'selfCounter' }, makeContext(me, iid))).toBe(2);
  });
});
