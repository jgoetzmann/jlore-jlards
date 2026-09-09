/**
 * Regressions from the catalog audit (SB-44, SB-47 through SB-52).
 *
 * Every test here fails without its fix and passed the whole build without it,
 * which is the point: none of these defects crashed. They quietly did half the
 * work while the suite stayed green — a Discover whose pick was thrown away, an
 * aura tier that never fired, a steal that handed the card back.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { registerAuras, registerCards } from '@engine/registry';
import { allAuraDefinitions, allCardDefinitions } from '@cards/index';
import { NAMED_FILTERS } from '@engine/effects';
import type {
  AuraDefinition,
  CardDefinition,
  GameState,
  InstanceId,
  MatchConfig,
  PlayerId,
} from '@engine/types';

const CONFIG: MatchConfig = {
  playerCount: 2,
  draftPileCount: 10,
  anomalyChance: 0,
  winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
  pileSizeScale: 1,
  effectNodeBudget: 200,
  recursionDepth: 8,
  turnSeconds: 120,
  seedCodexWithCommons: true,
};

/** A Discover whose continuation names the chosen card through the sentinel. */
const SENTINEL_DISCOVER: CardDefinition = {
  id: 'test_sentinel_discover',
  name: 'Test Sentinel Discover',
  cost: { money: 0 },
  types: ['Action'],
  subtypes: [],
  tags: [],
  rarity: 'common',
  keywords: [],
  stats: {},
  effects: [
    {
      op: 'discover',
      pool: { scope: 'entireUniverse', filter: { type: 'Resource' } },
      count: 3,
      pick: 1,
      then: [{ op: 'createCard', defId: '$discovered', to: 'gy' }],
    },
  ],
  triggers: [],
  text: 'Discover a Resource and put it in your GY.',
  complexity: 'T3',
  subsystems: ['S-DISCOVER'],
  notPurchasable: true,
  excludeFromPools: true,
  art: { key: 'test_sentinel_discover', status: 'placeholder' },
};

/** A `pick:'choose'` target selector — the shape that suspended and vanished. */
const CHOOSE_TARGET: CardDefinition = {
  id: 'test_choose_target',
  name: 'Test Choose Target',
  cost: { money: 0 },
  types: ['Action'],
  subtypes: [],
  tags: [],
  rarity: 'common',
  keywords: [],
  stats: {},
  effects: [{ op: 'trash', target: { who: 'self', zone: 'hand', count: 1, pick: 'choose' } }],
  triggers: [],
  text: 'Trash a card from your hand.',
  complexity: 'T2',
  subsystems: ['S-CORE'],
  notPurchasable: true,
  excludeFromPools: true,
  art: { key: 'test_choose_target', status: 'placeholder' },
};

/** An aura that answers a non-startOfTurn window. */
const BUY_AURA: AuraDefinition = {
  id: 'test_buy_aura',
  name: 'Test Buy Aura',
  tier: 'celestial',
  text: 'Whenever you buy a card, +3 Money.',
  effects: [],
  triggers: [{ on: 'onBuy', effects: [{ op: 'gain', stat: 'money', amount: 3 }] }],
  art: { key: 'test_buy_aura', status: 'placeholder' },
};

function mint(state: GameState, defId: string, owner: PlayerId, zone: 'hand'): InstanceId {
  const iid = `i_test_${defId}_${Object.keys(state.instances).length}`;
  state.instances[iid] = {
    iid,
    defId,
    owner,
    zone,
    addedKeywords: [],
    removedKeywords: [],
    counters: {},
    statDelta: {},
    extraEffects: [],
    playedOnTurn: null,
  };
  state.players[owner]!.hand.push(iid);
  return iid;
}

function start(seed = 909): { state: GameState; me: PlayerId } {
  let state = createMatch(
    CONFIG,
    [
      { id: 'p1', name: 'One', codex: [] },
      { id: 'p2', name: 'Two', codex: [] },
    ],
    seed,
  );
  return { state, me: state.activePlayer };
}

beforeAll(() => {
  registerCards([SENTINEL_DISCOVER, CHOOSE_TARGET]);
  registerAuras([BUY_AURA]);
});

describe('SB-44: uniqueness is judged on the authored catalog', () => {
  test('no two authored definitions share an id', () => {
    const seen = new Map<string, number>();
    for (const c of allCardDefinitions()) seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  test('no two authored definitions share a name', () => {
    const seen = new Map<string, string[]>();
    for (const c of allCardDefinitions()) seen.set(c.name, [...(seen.get(c.name) ?? []), c.id]);
    expect([...seen.entries()].filter(([, ids]) => ids.length > 1)).toEqual([]);
  });

  test('the registry deduplicates, which is why the check must not ask it', () => {
    // Guards the shape of the original bug: asking allCards() cannot fail.
    const authored = allCardDefinitions().length;
    const auras = allAuraDefinitions().length;
    expect(authored).toBeGreaterThan(0);
    expect(auras).toBeGreaterThan(0);
  });
});

describe('SB-48: a prompt continuation sees the card the player picked', () => {
  test('$discovered resolves to the chosen definition, not a fresh roll', () => {
    const { state, me } = start();
    const iid = mint(state, SENTINEL_DISCOVER.id, me, 'hand');
    const played = reduce(state, { type: 'play', player: me, iid });

    expect(played.pending).not.toBeNull();
    const option = played.pending!.options[1] ?? played.pending!.options[0]!;
    const chosenDefId = option.defId!;
    const gyBefore = played.players[me]!.gy.length;

    const done = reduce(played, {
      type: 'resolve',
      player: me,
      promptId: played.pending!.id,
      keys: [option.key],
    });

    expect(done.pending).toBeNull();
    expect(done.players[me]!.gy.length).toBe(gyBefore + 1);
    const landed = done.players[me]!.gy.map((i) => done.instances[i]!.defId);
    expect(landed).toContain(chosenDefId);
  });

  test('no card ships a choice sentinel outside a prompt continuation', () => {
    const stray: string[] = [];
    const scan = (value: unknown, inThen: boolean, id: string): void => {
      if (Array.isArray(value)) {
        for (const v of value) scan(v, inThen, id);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        const child = obj[key];
        const nested = key === 'then' ? true : inThen;
        if (typeof child === 'string' && child.startsWith('$') && !nested) stray.push(`${id}.${key}`);
        scan(child, nested, id);
      }
    };
    for (const c of allCardDefinitions()) {
      scan(c.effects, false, c.id);
      scan(c.triggers, false, c.id);
    }
    expect([...new Set(stray)]).toEqual([]);
  });
});

describe('SB-49: a suspended node is re-run with the answer', () => {
  test("a pick:'choose' trash actually trashes the chosen card", () => {
    const { state, me } = start();
    const iid = mint(state, CHOOSE_TARGET.id, me, 'hand');
    const played = reduce(state, { type: 'play', player: me, iid });

    // The hand holds the opening 5 plus this card, so the selector prompts.
    expect(played.pending).not.toBeNull();
    const option = played.pending!.options[0]!;
    const victim = option.iid!;
    expect(played.instances[victim]!.zone).not.toBe('trash');

    const done = reduce(played, {
      type: 'resolve',
      player: me,
      promptId: played.pending!.id,
      keys: [option.key],
    });

    expect(done.pending).toBeNull();
    expect(done.instances[victim]!.zone).toBe('trash');
    expect(done.players[me]!.hand).not.toContain(victim);
  });
});

describe('SB-47: aura triggers fire outside the start-of-turn window', () => {
  test('an onBuy aura pays out when its holder buys', () => {
    const { state, me } = start();
    state.players[me]!.field.push({
      auraId: BUY_AURA.id,
      owner: me,
      usedThisTurn: false,
      counters: {},
    });
    state.players[me]!.money = 20;
    state.players[me]!.buys = 2;

    const copperPile = state.shop.order.resource.find((id) => {
      const top = state.shop.piles[id]!.cards[0];
      return top ? state.instances[top]!.defId === 'copper' : false;
    })!;
    const before = state.players[me]!.money;

    const after = reduce(state, { type: 'buy', player: me, pileId: copperPile });

    // Copper costs 0, so the only movement is the aura's +3.
    expect(after.players[me]!.money).toBe(before + 3);
  });

  test('a start-of-turn aura is not paid twice (B80 owns that window)', () => {
    // Regression guard for the fix to the fix: sweeping the Field inside
    // fireOwnedTriggers on startOfTurn double-resolved every Celestial.
    const { state, me } = start();
    const p2 = state.playerOrder.find((x) => x !== me)!;
    state.players[me]!.field.push({
      auraId: 'kwzkis_stimulants',
      owner: me,
      usedThisTurn: false,
      counters: {},
    });
    let after = reduce(state, { type: 'endTurn', player: me });
    after = reduce(after, { type: 'endTurn', player: p2 });
    expect(after.activePlayer).toBe(me);
    // Base 1 Action + exactly one application of the aura's +1.
    expect(after.players[me]!.actions).toBe(2);
  });
});

describe('SB-52: every filter name a card expression uses is registered', () => {
  test('count(x) and countIn(zone, x) name a real filter', () => {
    const names = new Set<string>();
    const scan = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const v of value) scan(v);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const obj = value as Record<string, unknown>;
      if (typeof obj.expr === 'string') {
        const re = /\bcount(?:In)?\s*\(\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\s*,\s*)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/g;
        let m = re.exec(obj.expr);
        while (m !== null) {
          names.add(m[1]!);
          m = re.exec(obj.expr);
        }
      }
      for (const key of Object.keys(obj)) scan(obj[key]);
    };
    for (const c of allCardDefinitions()) {
      scan(c.effects);
      scan(c.triggers);
    }
    for (const a of allAuraDefinitions()) {
      scan(a.effects);
      scan(a.triggers);
    }
    const unregistered = [...names].filter((n) => !NAMED_FILTERS[n]);
    expect(unregistered).toEqual([]);
  });
});
