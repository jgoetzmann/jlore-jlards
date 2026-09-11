/**
 * SB-14 (revised). The Prophet Shop offers a sample of the Prophet catalog, not
 * all of it. These pin the sample: its size, its determinism, and the threshold
 * spread that makes the sampled board worth reading.
 *
 * The catalog itself is still 23 purchasable cards — `catalog-integrity` (B98)
 * owns that number. This file owns how many of them reach a table.
 */

import { describe, expect, test } from 'vitest';
import { createMatch } from '@engine/index';
import { makeRng } from '@engine/rng';
import { getCard } from '@engine/registry';
import {
  DEFAULT_PROPHET_PILE_COUNT,
  buildShop,
  prophetCandidates,
  sampleProphetDefs,
} from '@engine/shop/build';
import { PROPHET_SHOP_CARD_IDS, VP_THRESHOLD_EXCLUDED_IDS } from '@engine/shop/prophet';
import type {
  CardDefId,
  CardDefinition,
  GameState,
  MatchConfig,
  PileId,
  WinConditionKind,
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

/**
 * Several of these sweep a couple of hundred seeds, and `createMatch` is the
 * expensive part. The sample is a pure function of the seed and nothing here
 * mutates a match in place, so one build per seed is enough.
 */
const MATCH_CACHE = new Map<number, GameState>();
function matchAt(seed: number): GameState {
  const hit = MATCH_CACHE.get(seed);
  if (hit) return hit;
  const made = mkMatch(seed);
  MATCH_CACHE.set(seed, made);
  return made;
}

function topDefId(s: GameState, pileId: PileId): CardDefId {
  return s.instances[s.shop.piles[pileId]!.cards[0]!]!.defId;
}

/** The definitions actually sitting in the Prophet Shop, in shop order. */
function prophetDefs(s: GameState): CardDefinition[] {
  return s.shop.order.prophet.map((pileId) => getCard(topDefId(s, pileId)));
}

function prophetIds(s: GameState): CardDefId[] {
  return prophetDefs(s).map((d) => d.id);
}

function thresholdOf(def: CardDefinition): number {
  return def.cost.prophet ? def.cost.prophet.threshold : 0;
}

/**
 * Rebuild only the shop on an already-dealt match. `createMatch` now carries
 * `prophetPileCount` through `normalizeConfig` (see the end-to-end test below),
 * so this is no longer a workaround — it is just the cheap way to sweep a dozen
 * counts without dealing a dozen matches.
 */
function rebuildWith(seed: number, over: Partial<MatchConfig> = {}): GameState {
  const base = clone(mkMatch(seed));
  base.config = { ...base.config, ...over };
  base.shop = {
    piles: {},
    order: { resource: [], points: [], prophet: [], draft: [] },
    globalCostMods: [],
  };
  return buildShop(base, makeRng(seed, 0));
}

const SEEDS = [1, 2, 3, 17, 99];

/** Every purchasable card the Prophet catalog can offer. */
const PURCHASABLE_PROPHET_IDS = PROPHET_SHOP_CARD_IDS.filter(
  (id) => getCard(id).notPurchasable !== true,
);

// --- SB-14: how many piles -------------------------------------------------

describe('SB-14 - the Prophet Shop offers a sample, not the whole catalog', () => {
  test('SB-14: the default is four Prophet piles, not all 23', () => {
    expect(DEFAULT_PROPHET_PILE_COUNT).toBe(4);
    expect(PURCHASABLE_PROPHET_IDS.length).toBe(23);
    for (let seed = 1; seed <= 60; seed += 1) {
      expect(matchAt(seed).shop.order.prophet).toHaveLength(4);
    }
  });

  test('SB-14: no two Prophet piles ever share a card definition', () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const ids = prophetIds(matchAt(seed));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('SB-14: every pile in the sample is a Prophet Shop card with a Prophet price', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const s = matchAt(seed);
      for (const def of prophetDefs(s)) {
        expect(PROPHET_SHOP_CARD_IDS).toContain(def.id);
        expect(def.shop).toBe('prophet');
        expect(def.cost.prophet).toBeDefined();
      }
      for (const pileId of s.shop.order.prophet) {
        expect(s.shop.piles[pileId]!.shop).toBe('prophet');
        expect(s.shop.piles[pileId]!.cards.length).toBeGreaterThan(0);
      }
    }
  });

  test('SB-14: a non-default prophetPileCount is honoured', () => {
    for (const count of [1, 2, 6, 9]) {
      const s = rebuildWith(404, { prophetPileCount: count });
      expect(s.shop.order.prophet).toHaveLength(count);
      expect(new Set(prophetIds(s)).size).toBe(count);
    }
  });

  test('SB-14: prophetPileCount survives createMatch, not just buildShop', () => {
    // normalizeConfig rebuilds the config field by field. A field it forgets is
    // silently dropped, and the only symptom is a shop that ignores its config.
    for (const count of [1, 7]) {
      const s = mkMatch(407, { prophetPileCount: count });
      expect(s.config.prophetPileCount).toBe(count);
      expect(s.shop.order.prophet).toHaveLength(count);
    }
  });

  test('SB-14: a match given no prophetPileCount reports the default it used', () => {
    expect(mkMatch(408).config.prophetPileCount).toBe(DEFAULT_PROPHET_PILE_COUNT);
  });

  test('SB-14: asking for more piles than exist offers what exists rather than throwing', () => {
    const s = rebuildWith(405, { prophetPileCount: 999 });
    expect(s.shop.order.prophet).toHaveLength(PURCHASABLE_PROPHET_IDS.length);
    expect(prophetIds(s).sort()).toEqual([...PURCHASABLE_PROPHET_IDS].sort());
  });

  test('SB-14: sampleProphetDefs short-pools return the whole pool, not an error', () => {
    const pool = [getCard('mulligan'), getCard('giants_horn')];
    const picked = sampleProphetDefs(pool, 4, makeRng(7, 0));
    expect(picked).toHaveLength(2);
    expect(new Set(picked.map((d) => d.id)).size).toBe(2);
    expect(sampleProphetDefs([], 4, makeRng(7, 0))).toEqual([]);
    expect(sampleProphetDefs(pool, 0, makeRng(7, 0))).toEqual([]);
  });
});

// --- SB-14: determinism ----------------------------------------------------

describe('SB-14 - the sample is a pure function of the seed', () => {
  test('SB-14: the same seed produces the same four Prophet piles', () => {
    for (const seed of SEEDS) {
      expect(prophetIds(mkMatch(seed))).toEqual(prophetIds(mkMatch(seed)));
    }
  });

  test('SB-14: buildShop twice off the same rng seed picks the same piles', () => {
    for (const seed of SEEDS) {
      expect(prophetIds(rebuildWith(seed))).toEqual(prophetIds(rebuildWith(seed)));
    }
  });

  test('SB-14: sampleProphetDefs is a pure function of its rng', () => {
    const pool = prophetCandidates(mkMatch(1));
    const a = sampleProphetDefs(pool, 4, makeRng(31, 0)).map((d) => d.id);
    const b = sampleProphetDefs(pool, 4, makeRng(31, 0)).map((d) => d.id);
    const c = sampleProphetDefs(pool, 4, makeRng(32, 0)).map((d) => d.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  test('SB-14: different seeds do not all produce the same board', () => {
    const boards = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) boards.add(prophetIds(matchAt(seed)).join(','));
    expect(boards.size).toBeGreaterThan(10);
  });
});

// --- SB-14: what a sampled board is guaranteed to contain ------------------

describe('SB-14 - the sample is stratified across the threshold range', () => {
  test('SB-14: every board offers a cheap Prophet buy and something to save for', () => {
    for (let seed = 1; seed <= 150; seed += 1) {
      const thresholds = prophetDefs(matchAt(seed)).map(thresholdOf);
      // Band 0 of the sorted catalog tops out at 2; band 3 bottoms out at 8.
      expect(Math.min(...thresholds)).toBeLessThanOrEqual(2);
      expect(Math.max(...thresholds)).toBeGreaterThanOrEqual(8);
    }
  });

  test('SB-14: the four thresholds are spread, not four of the same price', () => {
    for (let seed = 1; seed <= 150; seed += 1) {
      const thresholds = prophetDefs(matchAt(seed)).map(thresholdOf);
      expect(Math.max(...thresholds) - Math.min(...thresholds)).toBeGreaterThanOrEqual(6);
    }
  });

  test('SB-14: the shop column reads cheap to expensive', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const thresholds = prophetDefs(matchAt(seed)).map(thresholdOf);
      const sorted = [...thresholds].sort((a, b) => a - b);
      expect(thresholds).toEqual(sorted);
    }
  });

  test('SB-14: no single card owns the board across seeds', () => {
    const seen = new Map<CardDefId, number>();
    const runs = 200;
    for (let seed = 1; seed <= runs; seed += 1) {
      for (const id of prophetIds(matchAt(seed))) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    // Bands hold five or six cards each, so nothing should approach every match.
    for (const [, count] of seen) expect(count).toBeLessThan(runs * 0.5);
    // and the sampler should reach most of the catalog over 200 matches.
    expect(seen.size).toBeGreaterThanOrEqual(20);
  });
});

// --- B48 / B62 -------------------------------------------------------------

describe('B48 - a generated-only Prophet card never forms a pile', () => {
  test('B48: Doomsday Button is catalogued but never sampled', () => {
    expect(PROPHET_SHOP_CARD_IDS).toContain('doomsday_button');
    expect(getCard('doomsday_button').notPurchasable).toBe(true);
    for (let seed = 1; seed <= 120; seed += 1) {
      expect(prophetIds(matchAt(seed))).not.toContain('doomsday_button');
    }
    const all = rebuildWith(406, { prophetPileCount: 999 });
    expect(prophetIds(all)).not.toContain('doomsday_button');
  });

  test('B48: no notPurchasable definition is ever a Prophet candidate', () => {
    for (const def of prophetCandidates(mkMatch(1))) {
      expect(def.notPurchasable ?? false).toBe(false);
    }
  });
});

// --- SB-28 -----------------------------------------------------------------

describe('SB-28 - the VP-threshold exclusion survives sampling', () => {
  test('SB-28: Prophesized Jlore is never sampled into a Crown or Duel match', () => {
    const kinds: WinConditionKind[] = ['crown', 'duel'];
    for (const kind of kinds) {
      for (let seed = 1; seed <= 80; seed += 1) {
        const s = mkMatch(seed, {
          winCondition: { kind, emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: 30 },
        });
        for (const id of VP_THRESHOLD_EXCLUDED_IDS) {
          expect(prophetIds(s)).not.toContain(id);
        }
      }
    }
  });

  test('SB-28: a VP-threshold anomaly also drops it', () => {
    for (const anomaly of ['aim_for_the_moon', 'heavy_is_the_crown'] as const) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const base = clone(matchAt(seed));
        base.anomaly = anomaly;
        base.shop = {
          piles: {},
          order: { resource: [], points: [], prophet: [], draft: [] },
          globalCostMods: [],
        };
        const s = buildShop(base, makeRng(seed, 0));
        expect(prophetIds(s)).not.toContain('prophesized_jlore');
        expect(s.shop.order.prophet).toHaveLength(4);
      }
    }
  });

  test('SB-28: the excluded card is out of the candidate pool, and still in a standard match', () => {
    const crown = mkMatch(5, {
      winCondition: { kind: 'crown', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: 30 },
    });
    const candidateIds = prophetCandidates(crown).map((d) => d.id);
    expect(candidateIds).not.toContain('prophesized_jlore');
    expect(candidateIds).toHaveLength(22);

    const standard = prophetCandidates(mkMatch(5)).map((d) => d.id);
    expect(standard).toContain('prophesized_jlore');
    expect(standard).toHaveLength(23);
  });
});
