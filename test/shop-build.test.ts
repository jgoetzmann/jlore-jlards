import { describe, expect, test } from 'vitest';
import { createMatch } from '@engine/index';
import { buildShop, costOf, pileSizeFor, rarityPullWeight } from '@engine/shop';
import { makeRng } from '@engine/rng';
import { allCards, getCard } from '@engine/registry';
import type { CardDefId, GameState, MatchConfig, PileId, Rarity } from '@engine/types';

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
  const pile = s.shop.piles[pileId]!;
  const iid = pile.cards[0]!;
  return s.instances[iid]!.defId;
}

function shopDefIds(s: GameState, shop: 'resource' | 'points' | 'prophet' | 'draft'): CardDefId[] {
  return s.shop.order[shop].map((id) => topDefId(s, id));
}

function shopNames(s: GameState, shop: 'resource' | 'points' | 'prophet' | 'draft'): string[] {
  return shopDefIds(s, shop).map((d) => getCard(d).name);
}

function pileByName(s: GameState, shop: 'resource' | 'points', name: string): PileId {
  const found = s.shop.order[shop].find((id) => getCard(topDefId(s, id)).name === name);
  if (!found) throw new Error('no ' + shop + ' pile printing ' + name);
  return found;
}

const SEEDS = [1, 2, 3, 17, 99];

// --- B44 -------------------------------------------------------------------

describe('B44 - the fixed shops', () => {
  test('B44: the Resource Shop always contains Copper 0, Silver 3, Gold 6, Diamond 10', () => {
    for (const seed of SEEDS) {
      const s = mkMatch(seed);
      const buyer = s.activePlayer;
      const expected: [string, number][] = [
        ['Copper', 0],
        ['Silver', 3],
        ['Gold', 6],
        ['Diamond', 10],
      ];
      for (const [name, cost] of expected) {
        const pileId = pileByName(s, 'resource', name);
        expect(costOf(s, pileId, buyer)).toBe(cost);
        expect(s.shop.piles[pileId]!.shop).toBe('resource');
      }
    }
  });

  test('B44: the Points Shop always contains Tix 2, Robux 5, Jlore 8', () => {
    for (const seed of SEEDS) {
      const s = mkMatch(seed);
      const buyer = s.activePlayer;
      const expected: [string, number][] = [
        ['Tix', 2],
        ['Robux', 5],
        ['Jlore', 8],
      ];
      for (const [name, cost] of expected) {
        const pileId = pileByName(s, 'points', name);
        expect(costOf(s, pileId, buyer)).toBe(cost);
        expect(s.shop.piles[pileId]!.shop).toBe('points');
      }
    }
  });

  test('B44: the Resource Shop holds those four piles and nothing else', () => {
    for (const seed of SEEDS) {
      const s = mkMatch(seed);
      expect(shopNames(s, 'resource').sort()).toEqual(['Copper', 'Diamond', 'Gold', 'Silver']);
      expect(s.shop.order.resource).toHaveLength(4);
    }
  });

  test('B44: the Points Shop holds those three piles and nothing else', () => {
    for (const seed of SEEDS) {
      const s = mkMatch(seed);
      expect(shopNames(s, 'points').sort()).toEqual(['Jlore', 'Robux', 'Tix']);
      expect(s.shop.order.points).toHaveLength(3);
    }
  });

  test('B44: no Resource or Points shop pile is ever empty at match start', () => {
    for (const seed of SEEDS) {
      const s = mkMatch(seed);
      for (const shop of ['resource', 'points'] as const) {
        for (const id of s.shop.order[shop]) {
          expect(s.shop.piles[id]!.cards.length).toBeGreaterThan(0);
          expect(s.shop.piles[id]!.startingSize).toBe(s.shop.piles[id]!.cards.length);
        }
      }
    }
  });
});

// --- B45 -------------------------------------------------------------------

describe('B45 - the Draft Shop is draftPileCount distinct piles', () => {
  test('B45: the Draft Shop has exactly config.draftPileCount piles', () => {
    for (const seed of SEEDS) {
      const s = mkMatch(seed);
      expect(s.shop.order.draft).toHaveLength(s.config.draftPileCount);
    }
  });

  test('B45: a non-default draftPileCount is honoured', () => {
    const s = mkMatch(23, { draftPileCount: 6 });
    expect(s.shop.order.draft).toHaveLength(6);
    expect(new Set(shopDefIds(s, 'draft')).size).toBe(6);
  });

  test('B45: no two Draft Shop piles ever share a card definition', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = mkMatch(seed);
      const defIds = shopDefIds(s, 'draft');
      expect(new Set(defIds).size).toBe(defIds.length);
    }
  });

  test('B45: no Draft Shop pile ever duplicates a Resource or Points Shop card', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = mkMatch(seed);
      const basics = new Set([...shopDefIds(s, 'resource'), ...shopDefIds(s, 'points')]);
      for (const defId of shopDefIds(s, 'draft')) {
        expect(basics.has(defId)).toBe(false);
      }
    }
  });

  test('B45: buildShop on a state with no shop produces draftPileCount distinct draft piles', () => {
    const base = mkMatch(11);
    const empty = clone(base);
    empty.shop = {
      piles: {},
      order: { resource: [], points: [], prophet: [], draft: [] },
      globalCostMods: [],
    };
    const built = buildShop(empty, makeRng(11, 0));
    expect(built.shop.order.draft).toHaveLength(built.config.draftPileCount);
    const defIds = shopDefIds(built, 'draft');
    expect(new Set(defIds).size).toBe(defIds.length);
    expect(built.shop.order.resource).toHaveLength(4);
    expect(built.shop.order.points).toHaveLength(3);
  });
});

// --- B46 -------------------------------------------------------------------

describe('B46 - pileSizeFor', () => {
  test('B46: pileSizeFor returns 10 / 8 / 6 / 4 / 1 at scale 1', () => {
    expect(pileSizeFor('common', 2, 1)).toBe(10);
    expect(pileSizeFor('rare', 2, 1)).toBe(8);
    expect(pileSizeFor('epic', 2, 1)).toBe(6);
    expect(pileSizeFor('legendary', 2, 1)).toBe(4);
    expect(pileSizeFor('mythic', 2, 1)).toBe(1);
  });

  test('B46: pileSizeFor multiplies by a 0.6 scale and rounds', () => {
    expect(pileSizeFor('common', 2, 0.6)).toBe(6);
    expect(pileSizeFor('rare', 2, 0.6)).toBe(5);
    expect(pileSizeFor('epic', 2, 0.6)).toBe(4);
    expect(pileSizeFor('legendary', 2, 0.6)).toBe(2);
    expect(pileSizeFor('mythic', 2, 0.6)).toBe(1);
  });

  test('B46: pileSizeFor multiplies by a 1.4 scale and rounds', () => {
    expect(pileSizeFor('common', 2, 1.4)).toBe(14);
    expect(pileSizeFor('rare', 2, 1.4)).toBe(11);
    expect(pileSizeFor('epic', 2, 1.4)).toBe(8);
    expect(pileSizeFor('legendary', 2, 1.4)).toBe(6);
    expect(pileSizeFor('mythic', 2, 1.4)).toBe(1);
  });

  test('B46: playerCount never changes the size of the five draft rarities', () => {
    const rarities: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];
    for (const rarity of rarities) {
      const two = pileSizeFor(rarity, 2, 1);
      for (const players of [3, 4, 5, 6]) {
        expect(pileSizeFor(rarity, players, 1)).toBe(two);
      }
    }
  });

  test('B46: pileSizeFor never returns a fractional or non-positive size', () => {
    const rarities: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];
    for (const rarity of rarities) {
      for (const scale of [0.6, 1, 1.4]) {
        const n = pileSizeFor(rarity, 4, scale);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThan(0);
      }
    }
  });
});

// --- B47 -------------------------------------------------------------------

describe('B47 - rarityPullWeight', () => {
  test('B47: rarityPullWeight holds the 71.5 : 22.9 : 4.4 : 1.1 : 0.1 ratio', () => {
    const common = rarityPullWeight('common');
    expect(common).toBeGreaterThan(0);
    expect(rarityPullWeight('rare') / common).toBeCloseTo(22.9 / 71.5, 6);
    expect(rarityPullWeight('epic') / common).toBeCloseTo(4.4 / 71.5, 6);
    expect(rarityPullWeight('legendary') / common).toBeCloseTo(1.1 / 71.5, 6);
    expect(rarityPullWeight('mythic') / common).toBeCloseTo(0.1 / 71.5, 6);
  });

  test('B47: rarityPullWeight is 0 for basic and 0 for token', () => {
    expect(rarityPullWeight('basic')).toBe(0);
    expect(rarityPullWeight('token')).toBe(0);
  });

  test('B47: the zero weights keep basic and token rarities out of the Draft Shop', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = mkMatch(seed);
      for (const defId of shopDefIds(s, 'draft')) {
        const rarity = getCard(defId).rarity;
        expect(rarity).not.toBe('basic');
        expect(rarity).not.toBe('token');
      }
    }
  });
});

// --- B48 -------------------------------------------------------------------

describe('B48 - token cards never form a Draft Shop pile', () => {
  test('B48: the registry has notPurchasable cards and none of them is ever a Draft Shop pile', () => {
    const tokens = allCards().filter((c) => c.notPurchasable === true);
    expect(tokens.length).toBeGreaterThan(0);
    const tokenIds = new Set(tokens.map((c) => c.id));
    for (let seed = 1; seed <= 40; seed++) {
      const s = mkMatch(seed);
      for (const defId of shopDefIds(s, 'draft')) {
        expect(tokenIds.has(defId)).toBe(false);
        expect(getCard(defId).notPurchasable ?? false).toBe(false);
      }
    }
  });

  test('B48: no instance sitting in a Draft Shop pile carries a notPurchasable definition', () => {
    for (const seed of SEEDS) {
      const s = mkMatch(seed);
      for (const pileId of s.shop.order.draft) {
        for (const iid of s.shop.piles[pileId]!.cards) {
          expect(getCard(s.instances[iid]!.defId).notPurchasable ?? false).toBe(false);
        }
      }
    }
  });
});
