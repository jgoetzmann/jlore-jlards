import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { canBuy, costOf } from '@engine/shop';
import { allCards, getCard } from '@engine/registry';
import type { CardDefId, CostMod, GameState, MatchConfig, PileId } from '@engine/types';

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

function mod(over: {
  id: string;
  floor: number;
  delta?: number;
  setTo?: number;
  expiresOnTurn?: number | null;
  onlyFor?: string;
}): CostMod {
  const m: CostMod = {
    id: over.id,
    floor: over.floor,
    expiresOnTurn: over.expiresOnTurn ?? null,
    source: 'test',
  };
  if (over.delta !== undefined) m.delta = over.delta;
  if (over.setTo !== undefined) m.setTo = over.setTo;
  if (over.onlyFor !== undefined) m.onlyFor = over.onlyFor;
  return m;
}

/** Pin a pile at a known cost with costOverride so the mod arithmetic is exact. */
function pinned(seed: number, override: number): { s: GameState; gold: PileId; me: string; other: string } {
  const s0 = mkMatch(seed);
  const me = s0.activePlayer;
  const other = s0.playerOrder.find((p) => p !== me)!;
  const gold = pileByName(s0, 'resource', 'Gold');
  const s = clone(s0);
  s.shop.piles[gold]!.costOverride = override;
  return { s, gold, me, other };
}

// --- B53 -------------------------------------------------------------------

describe('B53 - cost mods stack in order and each clamps to its own floor', () => {
  test('B53: two cost mods apply in order and each clamps to its own floor', () => {
    const { s, gold, me } = pinned(31, 10);
    s.shop.piles[gold]!.costMods.push(
      mod({ id: 'a', delta: -8, floor: 5 }),
      mod({ id: 'b', delta: -8, floor: 0 }),
    );
    // 10 -> max(2, 5) = 5 -> max(-3, 0) = 0
    expect(costOf(s, gold, me)).toBe(0);
  });

  test('B53: a cost mod cannot push the cost below its own floor', () => {
    const { s, gold, me } = pinned(32, 10);
    s.shop.piles[gold]!.costMods.push(mod({ id: 'a', delta: -9, floor: 4 }));
    expect(costOf(s, gold, me)).toBe(4);
  });

  test('B53: a setTo mod overrides every delta applied before it', () => {
    const { s, gold, me } = pinned(33, 10);
    s.shop.piles[gold]!.costMods.push(
      mod({ id: 'a', delta: -6, floor: 0 }),
      mod({ id: 'b', setTo: 7, floor: 0 }),
    );
    expect(costOf(s, gold, me)).toBe(7);
  });

  test('B53: a delta applied after a setTo still moves the cost', () => {
    const { s, gold, me } = pinned(34, 10);
    s.shop.piles[gold]!.costMods.push(
      mod({ id: 'a', setTo: 7, floor: 0 }),
      mod({ id: 'b', delta: -2, floor: 0 }),
    );
    expect(costOf(s, gold, me)).toBe(5);
  });

  test('B53: a setTo below its own floor clamps up to that floor', () => {
    const { s, gold, me } = pinned(35, 10);
    s.shop.piles[gold]!.costMods.push(mod({ id: 'a', setTo: 1, floor: 3 }));
    expect(costOf(s, gold, me)).toBe(3);
  });

  test('B53: three stacked mods resolve left to right, not by picking the largest', () => {
    const { s, gold, me } = pinned(36, 10);
    s.shop.piles[gold]!.costMods.push(
      mod({ id: 'a', delta: -2, floor: 0 }),
      mod({ id: 'b', delta: -3, floor: 0 }),
      mod({ id: 'c', delta: 1, floor: 0 }),
    );
    expect(costOf(s, gold, me)).toBe(6);
  });
});

// --- B54 -------------------------------------------------------------------

describe('B54 - costOf applies its layers in order', () => {
  test('B54: costOf returns the printed cost when nothing modifies it', () => {
    const s = mkMatch(41);
    const gold = pileByName(s, 'resource', 'Gold');
    expect(costOf(s, gold, s.activePlayer)).toBe(getCard(topDefId(s, gold)).cost.money);
  });

  test('B54: a variant costDelta moves the base cost', () => {
    const s0 = mkMatch(42);
    const me = s0.activePlayer;
    const gold = pileByName(s0, 'resource', 'Gold');
    const defId = topDefId(s0, gold);
    const base = costOf(s0, gold, me);

    const s = clone(s0);
    s.variants[defId] = { defId, statDelta: {}, costDelta: 2 };
    expect(costOf(s, gold, me)).toBe(base + 2);
  });

  test('B54: the pile costOverride is applied after the variant delta, so the override wins', () => {
    const s0 = mkMatch(43);
    const me = s0.activePlayer;
    const gold = pileByName(s0, 'resource', 'Gold');
    const defId = topDefId(s0, gold);

    const s = clone(s0);
    s.variants[defId] = { defId, statDelta: {}, costDelta: 100 };
    s.shop.piles[gold]!.costOverride = 10;
    expect(costOf(s, gold, me)).toBe(10);
  });

  test('B54: pile mods, then global mods, then buyer-specific mods, in that order', () => {
    const s0 = mkMatch(44);
    const me = s0.activePlayer;
    const other = s0.playerOrder.find((p) => p !== me)!;
    const gold = pileByName(s0, 'resource', 'Gold');
    const defId = topDefId(s0, gold);

    const s = clone(s0);
    s.variants[defId] = { defId, statDelta: {}, costDelta: 2 };
    s.shop.piles[gold]!.costOverride = 10;
    s.shop.piles[gold]!.costMods.push(mod({ id: 'pile', delta: -3, floor: 0 }));
    // Deliberately listed buyer-specific first: B54 says it still applies last.
    s.shop.globalCostMods.push(
      mod({ id: 'mine', setTo: 9, floor: 0, onlyFor: me }),
      mod({ id: 'everyone', delta: -4, floor: 0 }),
    );

    // 10 (override) -> 7 (pile) -> 3 (global) -> 9 (buyer-specific setTo)
    expect(costOf(s, gold, me)).toBe(9);
    // The other buyer never sees the buyer-specific mod.
    expect(costOf(s, gold, other)).toBe(3);
  });

  test('B54: a buyer-specific mod changes nothing for any other buyer', () => {
    const s0 = mkMatch(45);
    const me = s0.activePlayer;
    const other = s0.playerOrder.find((p) => p !== me)!;
    const gold = pileByName(s0, 'resource', 'Gold');
    const base = costOf(s0, gold, me);

    const s = clone(s0);
    s.shop.globalCostMods.push(mod({ id: 'mine', delta: -4, floor: 0, onlyFor: me }));
    expect(costOf(s, gold, me)).toBe(base - 4);
    expect(costOf(s, gold, other)).toBe(base);
  });

  test('B54: a cost mod attached to one pile does not change another pile', () => {
    const s0 = mkMatch(46);
    const me = s0.activePlayer;
    const gold = pileByName(s0, 'resource', 'Gold');
    const silver = pileByName(s0, 'resource', 'Silver');
    const silverBase = costOf(s0, silver, me);

    const s = clone(s0);
    s.shop.piles[gold]!.costMods.push(mod({ id: 'gold_only', delta: -5, floor: 0 }));
    expect(costOf(s, silver, me)).toBe(silverBase);
  });

  test('B54: a variant costDelta on one definition does not move a different pile', () => {
    const s0 = mkMatch(47);
    const me = s0.activePlayer;
    const gold = pileByName(s0, 'resource', 'Gold');
    const silver = pileByName(s0, 'resource', 'Silver');
    const silverBase = costOf(s0, silver, me);

    const s = clone(s0);
    const goldDef = topDefId(s0, gold);
    s.variants[goldDef] = { defId: goldDef, statDelta: {}, costDelta: 5 };
    expect(costOf(s, silver, me)).toBe(silverBase);
  });
});

// --- B55 -------------------------------------------------------------------

describe('B55 - a negative cost credits the buyer', () => {
  test('B55: a pile whose cost resolves to -3 pays the buyer 3 Money', () => {
    const s0 = mkMatch(51);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');

    const s = clone(s0);
    s.players[me]!.money = 5;
    s.players[me]!.buys = 1;
    s.shop.piles[copper]!.costMods.push(mod({ id: 'neg', delta: -3, floor: -3 }));
    expect(costOf(s, copper, me)).toBe(-3);

    const after = reduce(s, { type: 'buy', player: me, pileId: copper });
    expect(after.players[me]!.money).toBe(8);
    expect(after.players[me]!.gy.length).toBe(s.players[me]!.gy.length + 1);
  });

  test('B55: a buyer with 0 Money can afford a -3 pile and ends the buy holding 3', () => {
    const s0 = mkMatch(52);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');

    const s = clone(s0);
    s.players[me]!.money = 0;
    s.players[me]!.buys = 1;
    s.shop.piles[copper]!.costMods.push(mod({ id: 'neg', delta: -3, floor: -3 }));

    expect(costOf(s, copper, me)).toBe(-3);
    expect(canBuy(s, copper, me)).toBe(true);

    const after = reduce(s, { type: 'buy', player: me, pileId: copper });
    expect(after.players[me]!.money).toBe(3);
  });

  test('B55: buying at a negative cost still spends one Buy', () => {
    const s0 = mkMatch(53);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');

    const s = clone(s0);
    s.players[me]!.money = 0;
    s.players[me]!.buys = 1;
    s.shop.piles[copper]!.costMods.push(mod({ id: 'neg', delta: -3, floor: -3 }));

    const after = reduce(s, { type: 'buy', player: me, pileId: copper });
    expect(after.players[me]!.buys).toBe(0);
  });

  test('B55: Series C Funding is printed at cost -3', () => {
    const card = allCards().find((c) => c.name === 'Series C Funding');
    expect(card).toBeDefined();
    expect(card!.cost.money).toBe(-3);
  });

  test('B55: a floor stops a negative cost from running away below it', () => {
    const s0 = mkMatch(54);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');

    const s = clone(s0);
    s.shop.piles[copper]!.costMods.push(mod({ id: 'neg', delta: -10, floor: -2 }));
    expect(costOf(s, copper, me)).toBe(-2);
  });
});
