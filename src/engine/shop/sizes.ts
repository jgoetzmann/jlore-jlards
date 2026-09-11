/**
 * Pile sizing and rarity pull weights. B46, B47, SB-4.
 */

import type { CardDefId, Rarity } from '@engine/types';
import { roundInt } from './util';

/** Draft pile height by rarity, before scale. SB-4. */
export const RARITY_PILE_SIZE: Record<Rarity, number> = {
  basic: 0,
  token: 0,
  common: 10,
  rare: 8,
  epic: 6,
  legendary: 4,
  mythic: 1,
};

/** In-match random pull weights, §7.1. Basic and Token are never pulled. */
export const RARITY_PULL_WEIGHT: Record<Rarity, number> = {
  basic: 0,
  token: 0,
  common: 71.5,
  rare: 22.9,
  epic: 4.4,
  legendary: 1.1,
  mythic: 0.1,
};

export const BASIC_POINTS_IDS: CardDefId[] = ['tix', 'robux', 'jlore'];
export const JLORE_ID: CardDefId = 'jlore';

/**
 * B46. Common 10 / Rare 8 / Epic 6 / Legendary 4 / Mythic 1, times `scale`,
 * rounded. Basic and Token rarities have no draft pile height of their own —
 * basics are sized by `basicPileSize` instead.
 */
export function pileSizeFor(rarity: Rarity, playerCount: number, scale: number): number {
  const base = RARITY_PILE_SIZE[rarity] ?? 0;
  if (base <= 0) return 0;
  const scaled = roundInt(base * scale);
  return Math.max(1, scaled);
}

/** B47. Ratio 71.5 : 22.9 : 4.4 : 1.1 : 0.1; basic and token weigh 0. */
export function rarityPullWeight(rarity: Rarity): number {
  return RARITY_PULL_WEIGHT[rarity] ?? 0;
}

/**
 * SB-4. Basic Resource piles hold 12 x playerCount. Basic Points piles hold
 * 8 x playerCount, except Jlore at 4 + 4 x playerCount — emptying Jlore ends the
 * game, so it must be a decision rather than an accident.
 */
export function basicPileSize(defId: CardDefId, playerCount: number, scale: number): number {
  const players = Math.max(1, playerCount);
  let base: number;
  if (defId === JLORE_ID) {
    base = 4 + 4 * players;
  } else if (BASIC_POINTS_IDS.includes(defId)) {
    base = 8 * players;
  } else {
    base = 12 * players;
  }
  return Math.max(1, roundInt(base * scale));
}

/**
 * SB-14. The Prophet Shop is threshold-gated, not supply-gated, so its piles are
 * deliberately deep — and since SB-14 was re-decided there are only four of
 * them, which makes running one dry a real possibility rather than a curiosity.
 * Prophesized Jlore is the one exception: Mythic, terminal, one copy.
 */
export function prophetPileSize(rarity: Rarity, playerCount: number, scale: number): number {
  const players = Math.max(1, playerCount);
  if (rarity === 'mythic') return Math.max(1, roundInt(1 * scale));
  return Math.max(1, roundInt(2 * players * scale));
}
