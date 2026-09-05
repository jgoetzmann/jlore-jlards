/**
 * `legalActions`.
 *
 * B25: this must never return an action `reduce` would reject, which is why
 * every entry here runs through the exact same gate `reduce` uses -
 * `canPlayCard`, `canBuyPile`, `canActivateAura`, `isValidResolution`.
 */

import type { GameAction, GameState, InstanceId, PlayerId } from '@engine/types';
import { canPlayCard } from './play.js';
import { buyablePiles } from './buy.js';
import { activatableAuras } from './aura.js';
import { legalResolutions } from './resume.js';

export function legalActions(state: GameState, player: PlayerId): GameAction[] {
  if (state.ended) return [];
  const p = state.players[player];
  if (!p || p.eliminated) return [];

  // A pending prompt freezes everything except its own answer, and the answer
  // may come from a player who is not the active player.
  if (state.pending) {
    if (state.pending.player !== player) return [];
    const prompt = state.pending;
    return legalResolutions(prompt).map(
      (keys): GameAction => ({ type: 'resolve', player, promptId: prompt.id, keys }),
    );
  }

  if (state.activePlayer !== player) return [];

  const out: GameAction[] = [];

  for (const iid of p.hand) {
    if (canPlayCard(state, player, iid as InstanceId)) {
      out.push({ type: 'play', player, iid });
    }
  }

  for (const pileId of buyablePiles(state, player)) {
    out.push({ type: 'buy', player, pileId });
  }

  for (const auraId of activatableAuras(state, player)) {
    out.push({ type: 'activateAura', player, auraId });
  }

  out.push({ type: 'endTurn', player });
  return out;
}

/** True when `hand` is a permutation of the player's current hand (B13). */
export function isHandPermutation(state: GameState, player: PlayerId, hand: InstanceId[]): boolean {
  const p = state.players[player];
  if (!p) return false;
  if (hand.length !== p.hand.length) return false;
  const counts = new Map<InstanceId, number>();
  for (const iid of p.hand) counts.set(iid, (counts.get(iid) ?? 0) + 1);
  for (const iid of hand) {
    const n = counts.get(iid);
    if (!n) return false;
    counts.set(iid, n - 1);
  }
  for (const n of counts.values()) if (n !== 0) return false;
  return true;
}
