/**
 * Shop construction. B44, B45, B48, SB-4, SB-10, SB-14, SB-28.
 *
 * Every pile is populated with real CardInstances at build time — nothing is
 * lazily minted on purchase — because plague tokens, buffs and Chron Cache all
 * read a specific instance that is sitting in a shop pile.
 */

import type {
  CardDefId,
  CardDefinition,
  GameState,
  Pile,
  PileId,
  Rarity,
} from '@engine/types';
import type { Rng } from '@engine/rng';
import { allCards, cardsMatching } from '@engine/registry';
import { appendLog, cloneState, makePileId, playerCountOf, safeGetCard } from './util';
import { basicPileSize, pileSizeFor, prophetPileSize, rarityPullWeight } from './sizes';
import { createShopInstance } from './piles';
import {
  PROPHET_SHOP_CARD_IDS,
  VP_THRESHOLD_EXCLUDED_IDS,
  isVpThresholdMatch,
} from './prophet';

/** B44. The Resource Shop is these four cards at these four prices, always. */
export const RESOURCE_SHOP: { defId: CardDefId; cost: number }[] = [
  { defId: 'copper', cost: 0 },
  { defId: 'silver', cost: 3 },
  { defId: 'gold', cost: 6 },
  { defId: 'diamond', cost: 10 },
];

/** B44. The Points Shop is these three cards at these three prices, always. */
export const POINTS_SHOP: { defId: CardDefId; cost: number }[] = [
  { defId: 'tix', cost: 2 },
  { defId: 'robux', cost: 5 },
  { defId: 'jlore', cost: 8 },
];

function emptyPile(id: PileId, shop: Pile['shop'], startingSize: number, costOverride?: number): Pile {
  const pile: Pile = {
    id,
    shop,
    cards: [],
    locks: [],
    costMods: [],
    startingSize,
  };
  if (costOverride !== undefined) pile.costOverride = costOverride;
  return pile;
}

/**
 * Create a pile and fill it with `size` fresh instances of `defId`. Returns the
 * state with the pile registered, ordered and populated.
 */
function addPile(
  state: GameState,
  shop: Pile['shop'],
  defId: CardDefId,
  size: number,
  costOverride?: number,
): GameState {
  const pileId = makePileId(shop, defId);
  let next = cloneState(state);
  next.shop.piles[pileId] = emptyPile(pileId, shop, size, costOverride);
  next.shop.order[shop] = [...next.shop.order[shop], pileId];

  const cards: string[] = [];
  for (let i = 0; i < size; i += 1) {
    const made = createShopInstance(next, defId, pileId);
    next = made.state;
    cards.push(made.iid);
  }
  const pile = next.shop.piles[pileId];
  next.shop.piles[pileId] = { ...pile, cards };

  if (!next.defsInMatch.includes(defId)) {
    next = { ...next, defsInMatch: [...next.defsInMatch, defId] };
  }
  return next;
}

/**
 * B45, B48, SB-10. Candidates for a Draft Shop pile: purchasable, non-Basic,
 * non-Token, not a shop staple, not excluded from pools, and carrying a real
 * Money price. Prophet-priced cards live in their own shop and are skipped.
 */
export function draftCandidates(state: GameState): CardDefinition[] {
  const vpMatch = isVpThresholdMatch(state);
  const excluded = new Set(PROPHET_SHOP_CARD_IDS);
  for (const id of RESOURCE_SHOP) excluded.add(id.defId);
  for (const id of POINTS_SHOP) excluded.add(id.defId);

  return allCards().filter((def) => {
    if (excluded.has(def.id)) return false;
    // B48: a Token never forms a pile.
    if (def.notPurchasable) return false;
    if (def.rarity === 'token' || def.rarity === 'basic') return false;
    if (def.types.includes('Token')) return false;
    // SB-8: Unfathomable and friends are out of every random pool.
    if (def.excludeFromPools) return false;
    // Prophet-gated and shop-staple cards belong to their own shops.
    if (def.shop === 'prophet' || def.shop === 'resource' || def.shop === 'points') return false;
    if (def.cost.prophet && def.cost.money === undefined) return false;
    if (def.cost.money === undefined) return false;
    if (rarityPullWeight(def.rarity) <= 0) return false;
    // SB-28 / SB-29: no instant-win VP bombs in a VP-threshold match.
    if (vpMatch && VP_THRESHOLD_EXCLUDED_IDS.includes(def.id)) return false;
    return true;
  });
}

/**
 * B45, SB-10. Draw `count` distinct definitions with rarity pull weighting.
 * A chosen card is removed from the pool before the next draw, so no pile is
 * ever duplicated.
 */
export function sampleDraftDefs(
  candidates: CardDefinition[],
  count: number,
  rng: Rng,
): CardDefinition[] {
  const pool = [...candidates];
  const chosen: CardDefinition[] = [];
  const wanted = Math.min(count, pool.length);
  for (let i = 0; i < wanted; i += 1) {
    const entries = pool.map((def) => ({ item: def, weight: rarityPullWeight(def.rarity) }));
    const total = entries.reduce((sum, e) => sum + e.weight, 0);
    if (total <= 0) break;
    const picked = rng.weighted(entries);
    chosen.push(picked);
    const at = pool.indexOf(picked);
    if (at >= 0) pool.splice(at, 1);
  }
  return chosen;
}

/**
 * Build all four shops onto a fresh state. Called once from `createMatch`, after
 * players exist and after any anomaly has set `config.pileSizeScale`.
 */
export function buildShop(state: GameState, rng: Rng): GameState {
  const players = playerCountOf(state);
  const scale = state.config.pileSizeScale > 0 ? state.config.pileSizeScale : 1;

  let next = cloneState(state);
  next.shop.piles = {};
  next.shop.order = { resource: [], points: [], prophet: [], draft: [] };
  next.shop.globalCostMods = [];

  // --- B44: Resource Shop, fixed contents and fixed prices ---
  for (const entry of RESOURCE_SHOP) {
    if (!safeGetCard(entry.defId)) continue;
    const size = basicPileSize(entry.defId, players, scale);
    next = addPile(next, 'resource', entry.defId, size, entry.cost);
  }

  // --- B44: Points Shop, fixed contents and fixed prices ---
  for (const entry of POINTS_SHOP) {
    if (!safeGetCard(entry.defId)) continue;
    const size = basicPileSize(entry.defId, players, scale);
    next = addPile(next, 'points', entry.defId, size, entry.cost);
  }

  // --- SB-14: the whole Prophet Shop, every match ---
  const vpMatch = isVpThresholdMatch(next);
  const prophetDefs = cardsMatching({ defId: PROPHET_SHOP_CARD_IDS });
  const prophetById = new Map<CardDefId, CardDefinition>();
  for (const def of prophetDefs) prophetById.set(def.id, def);
  for (const defId of PROPHET_SHOP_CARD_IDS) {
    const def = prophetById.get(defId) ?? safeGetCard(defId);
    if (!def) continue;
    // Doomsday Button is catalogued here but is generated only.
    if (def.notPurchasable) continue;
    // SB-28: Prophesized Jlore is removed from VP-threshold matches.
    if (vpMatch && VP_THRESHOLD_EXCLUDED_IDS.includes(def.id)) continue;
    const size = prophetPileSize(def.rarity, players, scale);
    next = addPile(next, 'prophet', def.id, size);
  }

  // --- B45 / B48 / SB-10: the Draft Shop ---
  const wanted = state.config.draftPileCount > 0 ? state.config.draftPileCount : 10;
  const picked = sampleDraftDefs(draftCandidates(next), wanted, rng);
  for (const def of picked) {
    const size = draftPileSize(def.rarity, players, scale);
    next = addPile(next, 'draft', def.id, size);
  }

  next = { ...next, rngCursor: rng.cursor() };

  return appendLog(next, 'shopBuilt', {
    resource: next.shop.order.resource.length,
    points: next.shop.order.points.length,
    prophet: next.shop.order.prophet.length,
    draft: next.shop.order.draft.length,
    draftDefs: picked.map((d) => d.id),
    scale,
  });
}

/** B46 with a floor of 1 so a Mythic pile still exists at Accelerated scale. */
export function draftPileSize(rarity: Rarity, playerCount: number, scale: number): number {
  const size = pileSizeFor(rarity, playerCount, scale);
  return size > 0 ? size : 1;
}
