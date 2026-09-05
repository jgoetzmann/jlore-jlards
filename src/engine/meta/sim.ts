/**
 * S-SIM — the cheap substitutes from SB-40.
 *
 * Four cards depend on subsystems that were cut. Rather than delete the cards,
 * each resolves through a deterministic heuristic:
 *
 *   Zephrys                    -> `perfectCardFor`
 *   Second Time Around         -> `scoreCandidate` ranking over Known Universe
 *   Infinite Realities         -> `winningDeckFor`
 *   Glubby Gloob the Auctioneer-> `auctionBid`
 *
 * The scorer weights exactly what SB-40 names: money needed to reach the next
 * affordable pile, Actions remaining, VP gap to the leader, and Library height.
 * No solver, no search, no randomness — same state in, same number out.
 */

import type { CardDefId, CardDefinition, GameState, PlayerId, Rarity } from '@engine/types';
import { getCard } from '@engine/registry';
import { costOf } from '@engine/shop';
import { comboCount } from '@engine/systems';
import { knownUniverse } from './codex.js';
import { liveVp } from './scoring.js';
import { livePlayers } from './util.js';

const RARITY_BONUS: Record<Rarity, number> = {
  basic: 0,
  token: -1,
  common: 0.4,
  rare: 1.1,
  epic: 2.2,
  legendary: 3.4,
  mythic: 4.5,
};

function defOf(defId: CardDefId): CardDefinition | null {
  try {
    return getCard(defId);
  } catch {
    return null;
  }
}

/** Money still needed to afford the cheapest pile the player cannot buy yet. */
export function moneyGapToNextPile(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  if (!p) return 0;
  let best = Number.POSITIVE_INFINITY;
  const pileIds = [
    ...state.shop.order.draft,
    ...state.shop.order.resource,
    ...state.shop.order.points,
  ];
  for (const pileId of pileIds) {
    const pile = state.shop.piles[pileId];
    if (!pile || pile.cards.length === 0) continue;
    let cost: number;
    try {
      cost = costOf(state, pileId, player);
    } catch {
      continue;
    }
    const gap = cost - p.money;
    if (gap > 0 && gap < best) best = gap;
  }
  return Number.isFinite(best) ? best : 0;
}

/** How far behind the front-runner this player is. Zero when leading. */
export function vpGapToLeader(state: GameState, player: PlayerId): number {
  const mine = liveVp(state, player);
  let top = mine;
  for (const id of livePlayers(state)) {
    if (id === player) continue;
    const v = liveVp(state, id);
    if (v > top) top = v;
  }
  return Math.max(0, top - mine);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * SB-40's heuristic scorer. Higher is better. Deterministic and side-effect
 * free, so two clients scoring the same state agree without talking.
 */
export function scoreCandidate(state: GameState, player: PlayerId, defId: CardDefId): number {
  const p = state.players[player];
  if (!p) return 0;
  const def = defOf(defId);
  if (!def) return 0;

  const variant = state.variants[defId];
  const money = (def.stats.money ?? 0) + (variant?.statDelta.money ?? 0);
  const cards = (def.stats.cards ?? 0) + (variant?.statDelta.cards ?? 0);
  const actions = (def.stats.actions ?? 0) + (variant?.statDelta.actions ?? 0);
  const buys = (def.stats.buys ?? 0) + (variant?.statDelta.buys ?? 0);
  const vp = (def.stats.vp ?? 0) + (variant?.statDelta.vp ?? 0);
  const prophet = (def.stats.prophet ?? 0) + (variant?.statDelta.prophet ?? 0);
  const cost = (def.cost.money ?? 0) + (variant?.costDelta ?? 0);

  const gap = moneyGapToNextPile(state, player);
  const actionsLeft = p.actions;
  const vpGap = vpGapToLeader(state, player);
  const libraryHeight = p.library.length;
  const combo = comboCount(state, player);

  let score = 0;

  // 1. Money, weighted by how badly the next pile is out of reach.
  score += money * (gap > 0 ? 3.5 : 2.0);
  if (gap > 0 && money >= gap) score += 4;

  // 2. Cards, weighted by how thin the Library is.
  score += cards * (libraryHeight <= 3 ? 3.4 : 2.4);

  // 3. Actions, weighted by how close to stalling the turn is.
  score += actions * (actionsLeft <= 1 ? 2.6 : 1.4);
  score += buys * 1.6;

  // 4. VP, weighted by the gap to the leader.
  score += vp * (2.0 + Math.min(vpGap, 12) * 0.25);
  score += prophet * 1.8;

  // Text volume is a rough proxy for payload.
  score += def.effects.length * 0.5 + def.triggers.length * 0.35;
  score += RARITY_BONUS[def.rarity] ?? 0;

  // Costs, in Actions and in Money.
  const big = def.bigAction ?? 1;
  if (big > actionsLeft) score -= 2.5 * (big - actionsLeft);
  if (def.types.includes('Action') && actionsLeft <= 0) score -= 3;
  if (def.keywords.includes('Flimsy')) score -= 1.2;
  if (def.keywords.includes('Temporary')) score -= 1.6;
  if (def.notPurchasable) score -= 0.8;
  score -= cost * 0.3;

  // A long combo chain makes combo-conditional payloads live.
  score += combo * 0.1;

  return round6(score);
}

/**
 * Zephrys — "the perfect card for this situation". The best-scoring id in the
 * player's Known Universe, ties broken lexicographically so it never depends on
 * registry order.
 */
export function perfectCardFor(state: GameState, player: PlayerId): CardDefId | null {
  const pool = knownUniverse(state, player);
  if (pool.length === 0) return null;
  let bestId: CardDefId | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const id of pool) {
    const s = scoreCandidate(state, player, id);
    if (s > bestScore || (s === bestScore && bestId !== null && id < bestId)) {
      bestScore = s;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Second Time Around — the same scorer, ranked, so the Discover offers the top
 * `count` rather than a random three.
 */
export function rankedKnownUniverse(
  state: GameState,
  player: PlayerId,
  count: number,
): CardDefId[] {
  const pool = knownUniverse(state, player)
    .map((id) => ({ id, score: scoreCandidate(state, player, id) }))
    .sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : 1));
  return pool.slice(0, Math.max(0, count)).map((e) => e.id);
}

const DECK_SHAPE: { axis: 'money' | 'cards' | 'actions' | 'vp'; want: number }[] = [
  { axis: 'money', want: 6 },
  { axis: 'cards', want: 5 },
  { axis: 'actions', want: 4 },
  { axis: 'vp', want: 3 },
];

function axisValue(state: GameState, defId: CardDefId, axis: 'money' | 'cards' | 'actions' | 'vp'): number {
  const def = defOf(defId);
  if (!def) return 0;
  const variant = state.variants[defId];
  return (def.stats[axis] ?? 0) + (variant?.statDelta[axis] ?? 0);
}

/**
 * Infinite Realities — "a reality where you win". Not a solver: a curated
 * 20-card deck built from the player's own Known Universe against a fixed
 * curve (economy, draw, actions, points, then best-overall filler).
 */
export function winningDeckFor(state: GameState, player: PlayerId): CardDefId[] {
  const pool = knownUniverse(state, player).filter((id) => {
    const def = defOf(id);
    return !!def && !def.notPurchasable;
  });
  if (pool.length === 0) return [];

  const scored = pool
    .map((id) => ({ id, score: scoreCandidate(state, player, id) }))
    .sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : 1));

  const chosen: CardDefId[] = [];
  const taken = new Set<CardDefId>();

  for (const { axis, want } of DECK_SHAPE) {
    const ranked = scored
      .filter((e) => !taken.has(e.id) && axisValue(state, e.id, axis) > 0)
      .sort((a, b) => {
        const av = axisValue(state, a.id, axis);
        const bv = axisValue(state, b.id, axis);
        if (av !== bv) return bv - av;
        if (a.score !== b.score) return b.score - a.score;
        return a.id < b.id ? -1 : 1;
      });
    for (const e of ranked.slice(0, want)) {
      chosen.push(e.id);
      taken.add(e.id);
    }
  }

  for (const e of scored) {
    if (chosen.length >= 20) break;
    if (taken.has(e.id)) continue;
    chosen.push(e.id);
    taken.add(e.id);
  }

  return chosen.slice(0, 20);
}

/**
 * Glubby Gloob the Auctioneer — bots and absent players bid through this fixed
 * heuristic rather than a prompt. Bids are clamped to the chips actually held
 * and never exceed what the card is worth.
 */
export function auctionBid(
  state: GameState,
  player: PlayerId,
  defId: CardDefId,
  chips: number,
): number {
  if (chips <= 0) return 0;
  const value = scoreCandidate(state, player, defId);
  if (value <= 0) return 0;
  // 20 points of heuristic value is "worth every chip you have".
  const fraction = Math.min(1, value / 20);
  // Trailing players bid harder; the leader protects their chips.
  const desperation = 1 + Math.min(vpGapToLeader(state, player), 10) * 0.03;
  const bid = Math.round(fraction * desperation * chips);
  return Math.max(0, Math.min(chips, bid));
}
