/**
 * S-CODEX — Known Universe and Entire Universe (B92, B93, B94, SB-18).
 *
 * The codex is per player. A defId joins a player's codex the first time it
 * appears in a match that player is in: seen in a shop, drawn, played by
 * anyone, or revealed. With `config.seedCodexWithCommons` every codex starts
 * holding all Basic, Common and Rare cards so a new player's Discovers are
 * never worse than a coinflip (SB-18).
 */

import type { CardDefId, GameState, PlayerId, Rarity } from '@engine/types';
import { allCards, getCard } from '@engine/registry';
import { cloneState, pushLog } from './util.js';

/** SB-28 / SB-29: these two are pulled under any VP-threshold win condition. */
export const VP_THRESHOLD_EXCLUSIONS: readonly CardDefId[] = ['prophesized_jlore', 'mercenary_280'];

const SEEDED_RARITIES: readonly Rarity[] = ['basic', 'common', 'rare'];

function definitionExists(defId: CardDefId): boolean {
  try {
    getCard(defId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every card in the game, minus anything flagged `excludeFromPools` (SB-8/B33).
 * Stable order so seeded sampling is reproducible.
 */
export function entireUniverse(): CardDefId[] {
  return allCards()
    .filter((c) => !c.excludeFromPools)
    .map((c) => c.id)
    .sort();
}

/**
 * True when this match's win condition is a VP threshold: Aim for the Moon,
 * Heavy is the Crown, or the deliberate Crown / Duel variants (SB-28, SB-29).
 */
export function isVpThresholdMatch(state: GameState): boolean {
  const kind = state.config.winCondition.kind;
  if (kind === 'crown' || kind === 'duel') return true;
  return state.anomaly === 'aim_for_the_moon' || state.anomaly === 'heavy_is_the_crown';
}

/** Card ids that no pool in this match may offer. */
export function poolExclusions(state: GameState): Set<CardDefId> {
  const out = new Set<CardDefId>();
  if (isVpThresholdMatch(state)) for (const id of VP_THRESHOLD_EXCLUSIONS) out.add(id);
  return out;
}

/** Entire Universe narrowed by this match's exclusions. */
export function entireUniverseIn(state: GameState): CardDefId[] {
  const banned = poolExclusions(state);
  return entireUniverse().filter((id) => !banned.has(id));
}

/** The Basic + Common + Rare seed set (SB-18, B93). */
export function codexSeedIds(): CardDefId[] {
  return allCards()
    .filter((c) => !c.excludeFromPools && SEEDED_RARITIES.includes(c.rarity))
    .map((c) => c.id)
    .sort();
}

/**
 * B94 — per player. Two players at the same table get different options from
 * the same Discover.
 */
export function knownUniverse(state: GameState, player: PlayerId): CardDefId[] {
  const p = state.players[player];
  if (!p) return [];
  const banned = poolExclusions(state);
  const set = new Set<CardDefId>();
  if (state.config.seedCodexWithCommons) {
    for (const id of codexSeedIds()) set.add(id);
  }
  for (const id of p.codex) {
    if (definitionExists(id)) set.add(id);
  }
  const out: CardDefId[] = [];
  for (const id of set) {
    if (banned.has(id)) continue;
    let def;
    try {
      def = getCard(id);
    } catch {
      continue;
    }
    if (def.excludeFromPools) continue;
    out.push(id);
  }
  return out.sort();
}

/** B92 — one player saw one card. Idempotent. */
export function noteSeen(state: GameState, player: PlayerId, defId: CardDefId): GameState {
  const p = state.players[player];
  if (!p) return state;
  const inMatch = state.defsInMatch.includes(defId) ? state.defsInMatch : [...state.defsInMatch, defId];
  if (p.codex.includes(defId)) {
    return inMatch === state.defsInMatch ? state : { ...state, defsInMatch: inMatch };
  }
  return {
    ...state,
    defsInMatch: inMatch,
    players: { ...state.players, [player]: { ...p, codex: [...p.codex, defId] } },
  };
}

/**
 * B92 — the card appeared in the match, so every seated player has now seen it.
 * This is the hook for shop build, reveals, and any public play.
 */
export function noteSeenAll(state: GameState, defIds: CardDefId[]): GameState {
  if (defIds.length === 0) return state;
  let next = cloneState(state);
  const fresh: CardDefId[] = [];
  for (const defId of defIds) {
    if (!next.defsInMatch.includes(defId)) {
      next.defsInMatch.push(defId);
      fresh.push(defId);
    }
    for (const pid of next.playerOrder) {
      const p = next.players[pid];
      if (!p) continue;
      if (!p.codex.includes(defId)) p.codex.push(defId);
    }
  }
  if (fresh.length > 0) next = pushLog(next, 'codexSeen', { defIds: fresh });
  return next;
}

/** Apply the SB-18 seed to every seated player. Called at match setup. */
export function seedCodexes(state: GameState): GameState {
  if (!state.config.seedCodexWithCommons) return state;
  const seed = codexSeedIds();
  const next = cloneState(state);
  for (const pid of next.playerOrder) {
    const p = next.players[pid];
    if (!p) continue;
    const have = new Set(p.codex);
    for (const id of seed) if (!have.has(id)) p.codex.push(id);
  }
  return pushLog(next, 'codexSeeded', { count: seed.length });
}

/**
 * SB-28 / SB-29 — physically remove the banned ids from every shop pile.
 * Pool-level exclusion is handled by `poolExclusions`.
 */
export function stripExcludedFromShop(state: GameState): GameState {
  const banned = poolExclusions(state);
  if (banned.size === 0) return state;
  const next = cloneState(state);
  const removed: CardDefId[] = [];
  for (const pileId of Object.keys(next.shop.piles)) {
    const pile = next.shop.piles[pileId];
    const keep: string[] = [];
    for (const iid of pile.cards) {
      const inst = next.instances[iid];
      if (inst && banned.has(inst.defId)) {
        removed.push(inst.defId);
        delete next.instances[iid];
        continue;
      }
      keep.push(iid);
    }
    pile.cards = keep;
    if (keep.length === 0) {
      delete next.shop.piles[pileId];
      next.shop.order.resource = next.shop.order.resource.filter((p) => p !== pileId);
      next.shop.order.points = next.shop.order.points.filter((p) => p !== pileId);
      next.shop.order.prophet = next.shop.order.prophet.filter((p) => p !== pileId);
      next.shop.order.draft = next.shop.order.draft.filter((p) => p !== pileId);
    }
  }
  next.defsInMatch = next.defsInMatch.filter((id) => !banned.has(id));
  return pushLog(next, 'vpThresholdExclusion', { removed: [...banned], instances: removed.length });
}
