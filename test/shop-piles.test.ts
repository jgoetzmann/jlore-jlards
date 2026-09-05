import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { costOf, isLocked } from '@engine/shop';
import { resolveEffects } from '@engine/effects';
import type { EffectContext } from '@engine/effects';
import { getCard } from '@engine/registry';
import type {
  CardDefId,
  CardInstance,
  EffectNode,
  GameState,
  InstanceId,
  MatchConfig,
  PileId,
  PlayerId,
} from '@engine/types';

// --- inline fixtures -------------------------------------------------------

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function mkConfig(over: Partial<MatchConfig> = {}): MatchConfig {
  return {
    playerCount: 2,
    draftPileCount: 10,
    anomalyChance: 0,
    winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
    pileSizeScale: 1,
    effectNodeBudget: 500,
    recursionDepth: 8,
    turnSeconds: 90,
    seedCodexWithCommons: true,
    ...over,
  };
}

function mkMatch(seed: number, over: Partial<MatchConfig> = {}): GameState {
  return createMatch(
    mkConfig(over),
    [
      { id: 'p1', name: 'One', codex: [] },
      { id: 'p2', name: 'Two', codex: [] },
    ],
    seed,
    null,
  );
}

function topDefId(s: GameState, pileId: PileId): CardDefId {
  return s.instances[s.shop.piles[pileId]!.cards[0]!]!.defId;
}

function pileByName(s: GameState, shop: 'resource' | 'points', name: string): PileId {
  const found = s.shop.order[shop].find((id) => getCard(topDefId(s, id)).name === name);
  if (!found) throw new Error('no ' + shop + ' pile printing ' + name);
  return found;
}

function mkInstance(iid: InstanceId, defId: CardDefId, owner: PlayerId | null): CardInstance {
  return {
    iid,
    defId,
    owner,
    zone: 'shop',
    addedKeywords: [],
    removedKeywords: [],
    counters: {},
    statDelta: {},
    extraEffects: [],
    playedOnTurn: null,
  };
}

function ctxFor(player: PlayerId): EffectContext {
  return { player, sourceIid: null, depth: 0, multiplier: 1, vars: {} };
}

// --- B49 -------------------------------------------------------------------

describe('B49 - a pile is an ordered stack', () => {
  test('B49: buy takes the top card of the pile and leaves the rest in order', () => {
    const s0 = mkMatch(5);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');
    const s = clone(s0);
    s.players[me]!.money = 10;
    s.players[me]!.buys = 3;

    const before = [...s.shop.piles[copper]!.cards];
    const gyBefore = s.players[me]!.gy.length;
    const after = reduce(s, { type: 'buy', player: me, pileId: copper });

    expect(after.shop.piles[copper]!.cards).toEqual(before.slice(1));
    expect(after.players[me]!.gy).toHaveLength(gyBefore + 1);
    expect(after.players[me]!.gy).toContain(before[0]!);
    expect(after.instances[before[0]!]!.zone).toBe('gy');
    expect(after.instances[before[0]!]!.owner).toBe(me);
  });

  test('B49: buying twice takes the first two cards in stack order', () => {
    const s0 = mkMatch(6);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');
    const s = clone(s0);
    s.players[me]!.money = 10;
    s.players[me]!.buys = 3;

    const before = [...s.shop.piles[copper]!.cards];
    const one = reduce(s, { type: 'buy', player: me, pileId: copper });
    const two = reduce(one, { type: 'buy', player: me, pileId: copper });

    expect(two.players[me]!.gy.slice(-2)).toEqual([before[0]!, before[1]!]);
    expect(two.shop.piles[copper]!.cards).toEqual(before.slice(2));
  });

  test('B49: a card added to the pile top is what the next buyer gets', () => {
    const s0 = mkMatch(7);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');
    const silverDefId = topDefId(s0, pileByName(s0, 'resource', 'Silver'));

    const s = clone(s0);
    s.players[me]!.money = 20;
    s.players[me]!.buys = 3;
    const planted: InstanceId = 'test_planted_top';
    const inst = mkInstance(planted, silverDefId, null);
    inst.pileId = copper;
    s.instances[planted] = inst;
    const oldTop = s.shop.piles[copper]!.cards[0]!;
    s.shop.piles[copper]!.cards.unshift(planted);

    const after = reduce(s, { type: 'buy', player: me, pileId: copper });

    expect(after.players[me]!.gy).toContain(planted);
    expect(after.players[me]!.gy).not.toContain(oldTop);
    expect(after.instances[planted]!.defId).toBe(silverDefId);
    expect(after.shop.piles[copper]!.cards[0]).toBe(oldTop);
  });
});

// --- B52 -------------------------------------------------------------------

describe('B52 - re-locking a locked pile is a no-op', () => {
  test('B52: locking an already-locked pile leaves the existing owner and expiry untouched', () => {
    const s0 = mkMatch(8);
    const owner = s0.activePlayer;
    const other = s0.playerOrder.find((p) => p !== owner)!;

    const nodes: EffectNode[] = [
      { op: 'lockPile', target: { shop: 'resource' }, duration: { turns: 3 } },
    ];
    const once = resolveEffects(s0, nodes, ctxFor(owner));
    const lockedIds = s0.shop.order.resource.filter(
      (id) => once.shop.piles[id]!.locks.length > 0,
    );
    expect(lockedIds.length).toBeGreaterThan(0);

    const snapshot = lockedIds.map((id) => clone(once.shop.piles[id]!.locks));

    const again: EffectNode[] = [
      { op: 'lockPile', target: { shop: 'resource' }, duration: { turns: 99 } },
    ];
    const twice = resolveEffects(once, again, ctxFor(other));

    lockedIds.forEach((id, i) => {
      expect(twice.shop.piles[id]!.locks).toEqual(snapshot[i]!);
      expect(twice.shop.piles[id]!.locks[0]!.by).toBe(owner);
      expect(isLocked(twice, id)).toBe(true);
    });
  });

  test('B52: locking an already-locked pile does not add a second lock', () => {
    const s0 = mkMatch(9);
    const owner = s0.activePlayer;

    const nodes: EffectNode[] = [
      { op: 'lockPile', target: { shop: 'resource' }, duration: { turns: 3 } },
    ];
    const once = resolveEffects(s0, nodes, ctxFor(owner));
    const lockedIds = s0.shop.order.resource.filter(
      (id) => once.shop.piles[id]!.locks.length > 0,
    );
    expect(lockedIds.length).toBeGreaterThan(0);
    for (const id of lockedIds) expect(once.shop.piles[id]!.locks).toHaveLength(1);

    const twice = resolveEffects(once, nodes, ctxFor(owner));
    for (const id of lockedIds) {
      expect(twice.shop.piles[id]!.locks).toHaveLength(1);
    }
  });

  test('B52: a re-lock with a longer duration does not push the expiry out', () => {
    const s0 = mkMatch(10);
    const owner = s0.activePlayer;

    const short: EffectNode[] = [
      { op: 'lockPile', target: { shop: 'resource' }, duration: { turns: 1 } },
    ];
    const once = resolveEffects(s0, short, ctxFor(owner));
    const lockedIds = s0.shop.order.resource.filter(
      (id) => once.shop.piles[id]!.locks.length > 0,
    );
    expect(lockedIds.length).toBeGreaterThan(0);
    const expiries = lockedIds.map((id) => once.shop.piles[id]!.locks[0]!.expiresOnTurn);

    const long: EffectNode[] = [
      { op: 'lockPile', target: { shop: 'resource' }, duration: { turns: 50 } },
    ];
    const twice = resolveEffects(once, long, ctxFor(owner));

    lockedIds.forEach((id, i) => {
      expect(twice.shop.piles[id]!.locks[0]!.expiresOnTurn).toBe(expiries[i]!);
    });
  });
});

// --- B56 -------------------------------------------------------------------

describe('B56 - cost modifiers expire and are removed', () => {
  test('B56: a global cost mod that expires this turn is gone from state after the turn ends', () => {
    const s0 = mkMatch(12);
    const me = s0.activePlayer;
    const gold = pileByName(s0, 'resource', 'Gold');

    const s = clone(s0);
    s.shop.globalCostMods.push({
      id: 'expiring',
      delta: -2,
      floor: 0,
      expiresOnTurn: s.turn,
      source: 'test',
    });
    const base = costOf(s0, gold, me);
    expect(costOf(s, gold, me)).toBe(base - 2);

    const after = reduce(s, { type: 'endTurn', player: me });
    expect(after.shop.globalCostMods.find((m) => m.id === 'expiring')).toBeUndefined();
    expect(costOf(after, gold, me)).toBe(base);
  });

  test('B56: a pile cost mod that expires this turn is removed from that pile costMods', () => {
    const s0 = mkMatch(13);
    const me = s0.activePlayer;
    const gold = pileByName(s0, 'resource', 'Gold');

    const s = clone(s0);
    s.shop.piles[gold]!.costMods.push({
      id: 'pile_expiring',
      delta: -3,
      floor: 0,
      expiresOnTurn: s.turn,
      source: 'test',
    });
    const base = costOf(s0, gold, me);
    expect(costOf(s, gold, me)).toBe(base - 3);

    const after = reduce(s, { type: 'endTurn', player: me });
    expect(after.shop.piles[gold]!.costMods.find((m) => m.id === 'pile_expiring')).toBeUndefined();
    expect(after.shop.piles[gold]!.costMods).toHaveLength(0);
    expect(costOf(after, gold, me)).toBe(base);
  });

  test('B56: a cost mod with no expiry survives the end of the turn', () => {
    const s0 = mkMatch(14);
    const me = s0.activePlayer;
    const gold = pileByName(s0, 'resource', 'Gold');

    const s = clone(s0);
    s.shop.globalCostMods.push({
      id: 'permanent',
      delta: -2,
      floor: 0,
      expiresOnTurn: null,
      source: 'test',
    });
    const base = costOf(s0, gold, me);

    const after = reduce(s, { type: 'endTurn', player: me });
    expect(after.shop.globalCostMods.find((m) => m.id === 'permanent')).toBeDefined();
    expect(costOf(after, gold, me)).toBe(base - 2);
  });

  test('B56: a cost mod that expires two turns out still applies after one turn ends', () => {
    const s0 = mkMatch(15);
    const me = s0.activePlayer;
    const gold = pileByName(s0, 'resource', 'Gold');

    const s = clone(s0);
    s.shop.globalCostMods.push({
      id: 'later',
      delta: -2,
      floor: 0,
      expiresOnTurn: s.turn + 2,
      source: 'test',
    });
    const base = costOf(s0, gold, me);

    const after = reduce(s, { type: 'endTurn', player: me });
    expect(after.shop.globalCostMods.find((m) => m.id === 'later')).toBeDefined();
    expect(costOf(after, gold, after.activePlayer)).toBe(base - 2);
  });
});
