/**
 * Shop upkeep at turn boundaries, and the self-lock that makes negative-cost
 * cards a decision instead of an engine. B51, B56, SB-27.
 */

import type { GameState, PileId, PlayerId } from '@engine/types';
import { expireCostMods } from './cost';
import { expireLocks, lockPile } from './locks';
import { pileDefId } from './util';

/**
 * SB-27. Buying one of these locks its own pile for the rest of the turn. Lead
 * pays out its own price, and the Series Funding cards pay you to take negative
 * VP — with enough Buys either one loops forever, so the pile shuts after one
 * purchase. Any pile bought at a negative price self-locks for the same reason.
 */
export const SELF_LOCK_ON_BUY_DEF_IDS: string[] = [
  'lead',
  'series_a_funding',
  'series_b_funding',
  'series_c_funding',
  'series_d_funding',
  'series_e_funding',
  'series_f_funding',
  'series_x_funding',
];

/**
 * Called by the reducer right after a purchase resolves. `paidCost` is the
 * signed price the buyer actually paid.
 */
export function applyPurchaseSelfLock(
  state: GameState,
  pileId: PileId,
  buyer: PlayerId,
  paidCost: number,
): GameState {
  const defId = pileDefId(state, pileId);
  const named = defId !== null && SELF_LOCK_ON_BUY_DEF_IDS.includes(defId);
  if (!named && paidCost >= 0) return state;
  return lockPile(state, pileId, buyer, 'turn');
}

/**
 * B51, B56. Sweep expired locks and expired cost modifiers. Runs at the start of
 * each turn, after the stat reset and before any start-of-turn trigger, so a
 * card whose lock names this turn is already open when the player looks at it.
 */
export function shopStartOfTurn(state: GameState): GameState {
  let next = expireLocks(state);
  next = expireCostMods(next);
  return next;
}

/** Same sweep at end of turn, for `'turn'`-duration effects that name turn + 1. */
export function shopEndOfTurn(state: GameState): GameState {
  let next = expireLocks(state);
  next = expireCostMods(next);
  return next;
}
