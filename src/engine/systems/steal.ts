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
import { blankInstance, mintInstance, pushLog, tryGetCard } from './internal';
import { moveInstance } from '@engine/core/zones';
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

  moveInstance(state, iid, thief, to, position);
  let next = pushLog(state, 'steal', thief, { iid, defId: inst.defId, from: victim, to });
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
  moveInstance(minted.state, minted.iid, thief, to, position);
  let next = pushLog(minted.state, 'copyCard', thief, { source: iid, copy: minted.iid, defId: inst.defId, to });
  return next;
}

/** Every opponent of `player` who is still in the match, in seat order. */
export function opponentsOf(state: GameState, player: PlayerId): PlayerId[] {
  return state.playerOrder.filter((id) => id !== player && !state.players[id]?.eliminated);
}
