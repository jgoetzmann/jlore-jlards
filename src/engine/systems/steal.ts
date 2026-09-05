/**
 * S-STEAL — cross-player zone reads and writes.
 *
 * The source doc uses "steal" for two different operations and is inconsistent
 * card to card (§3.2), so both are exported and each card picks the one its
 * text actually means:
 *
 *   stealInstance — the physical card moves. The victim loses it, counters,
 *                   plague tokens, granted keywords and all.
 *   copyToOwn     — a fresh instance of the same definition is created. The
 *                   victim keeps theirs; the copy starts clean.
 *
 * Griftah, Thought Steal, Spyglass, Antics, Bribe, Corruption Scandal, Petty
 * Theft, Corpo Espionage, Ambush Bid, The Curator, Midnight Raid, Loot Attack,
 * IP Theft and Cult Leader all sit on one of these two.
 */

import type { GameState, InstanceId, PlayerId, Zone } from '@engine/types';
import type { Rng } from '@engine/rng';
import { allIids, blankInstance, copyInstance, mintInstance, pushLog, tryGetCard } from './internal';
import { attach, detach, wholeDeck } from './zoneops';
import { isUnfathomable } from './keywords';

/**
 * Move a card out of one player's zone and into another's. Every persistent
 * field rides along (B63, B65) — a stolen plagued card is still plagued.
 *
 * Unfathomable cards refuse to be stolen (SB-8).
 */
export function stealInstance(
  state: GameState,
  iid: InstanceId,
  thief: PlayerId,
  to: Zone = 'gy',
  position: 'top' | 'bottom' = 'top',
): GameState {
  const inst = state.instances[iid];
  if (!inst) return state;
  if (!state.players[thief]) return state;
  if (isUnfathomable(state, iid)) return state;

  const victim = inst.owner;
  if (victim === thief && inst.zone === to) return state;

  let next = attach(detach(state, iid), iid, thief, to, position);
  next = pushLog(next, 'steal', thief, { iid, defId: inst.defId, from: victim, to });
  return next;
}

/**
 * Add a copy rather than moving the original. The copy is a fresh instance with
 * empty counters, no plague and no granted keywords — it is a new physical card
 * off the same printed definition.
 *
 * Unfathomable cards refuse to be copied (SB-8).
 */
export function copyToOwn(
  state: GameState,
  iid: InstanceId,
  thief: PlayerId,
  to: Zone = 'hand',
  position: 'top' | 'bottom' = 'top',
): GameState {
  const inst = state.instances[iid];
  if (!inst) return state;
  if (!state.players[thief]) return state;
  if (isUnfathomable(state, iid)) return state;
  if (!tryGetCard(inst.defId)) return state;

  const minted = mintInstance(state, blankInstance(inst.defId, thief, to));
  let next = attach(minted.state, minted.iid, thief, to, position);
  next = pushLog(next, 'copyCard', thief, { source: iid, copy: minted.iid, defId: inst.defId, to });
  return next;
}

/**
 * A copy that carries the original's runtime state too — counters, granted
 * keywords, instance buffs and absorbed effects. Used by the handful of cards
 * that copy "as it is now" rather than "as printed".
 */
export function copyToOwnWithState(
  state: GameState,
  iid: InstanceId,
  thief: PlayerId,
  to: Zone = 'hand',
): GameState {
  const inst = state.instances[iid];
  if (!inst) return state;
  if (!state.players[thief]) return state;
  if (isUnfathomable(state, iid)) return state;

  const template = copyInstance(inst);
  const minted = mintInstance(state, {
    defId: template.defId,
    owner: thief,
    zone: to,
    addedKeywords: template.addedKeywords,
    removedKeywords: template.removedKeywords,
    counters: template.counters,
    statDelta: template.statDelta,
    extraEffects: template.extraEffects,
    playedOnTurn: null,
  });

  let next = attach(minted.state, minted.iid, thief, to, 'top');
  next = pushLog(next, 'copyCard', thief, { source: iid, copy: minted.iid, defId: inst.defId, to, withState: true });
  return next;
}

/** Every opponent of `player` who is still in the match, in seat order. */
export function opponentsOf(state: GameState, player: PlayerId): PlayerId[] {
  return state.playerOrder.filter((id) => id !== player && !state.players[id]?.eliminated);
}

/** One opponent picked from the seeded rng. Null when the player has none. */
export function randomOpponent(state: GameState, player: PlayerId, rng: Rng): PlayerId | null {
  const opps = opponentsOf(state, player);
  if (opps.length === 0) return null;
  return rng.pick(opps);
}

/**
 * Steal candidates in an opponent's zone. Unfathomable cards are filtered out
 * here so no caller has to remember the rule.
 */
export function stealableIn(state: GameState, victim: PlayerId, zone: Zone): InstanceId[] {
  const p = state.players[victim];
  if (!p) return [];
  const pool =
    zone === 'library' ? p.library
      : zone === 'hand' ? p.hand
        : zone === 'gy' ? p.gy
          : zone === 'play' ? p.play
            : allIids(state).filter((iid) => {
              const i = state.instances[iid];
              return i.owner === victim && i.zone === zone;
            });
  return pool.filter((iid) => !isUnfathomable(state, iid));
}

/** Steal one random card out of an opponent's zone (Midnight Raid, Loot Attack). */
export function stealRandomFrom(
  state: GameState,
  victim: PlayerId,
  thief: PlayerId,
  zone: Zone,
  to: Zone,
  rng: Rng,
): GameState {
  const candidates = stealableIn(state, victim, zone);
  if (candidates.length === 0) return state;
  return stealInstance(state, rng.pick(candidates), thief, to);
}

/** The most expensive stealable card in an opponent's zone (The Curator). */
export function mostExpensiveStealable(
  state: GameState,
  victim: PlayerId,
  zone: Zone,
): InstanceId | null {
  let best: InstanceId | null = null;
  let bestCost = -Infinity;
  for (const iid of stealableIn(state, victim, zone)) {
    const def = tryGetCard(state.instances[iid].defId);
    const cost = def?.cost.money ?? 0;
    if (cost > bestCost) {
      bestCost = cost;
      best = iid;
    }
  }
  return best;
}

/** Total cards an opponent holds across their whole deck — for scaling reads. */
export function opponentDeckSize(state: GameState, victim: PlayerId): number {
  return wholeDeck(state, victim).length;
}
