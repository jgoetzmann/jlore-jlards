/**
 * Pile locks. B50, B51, B52.
 *
 * A lock carries an owner and a duration and expires on the turn it names. The
 * one rule that is easy to get wrong: re-locking a locked pile is a no-op — it
 * does not stack and it does not extend (B52). That is what makes Chains of the
 * Sovereign and Seal the Rift fight over the same piles instead of chaining.
 */

import type { Duration, GameState, PileId, PileLock } from '@engine/types';
import { playerCountOf } from './util';

/**
 * Turn index a duration expires on, given the turn it was applied. `null` means
 * it never expires on its own.
 *
 * Turn numbers increment once per player turn, so "until your next turn" is one
 * full pass around the table.
 */
export function expiryTurnFor(state: GameState, duration: Duration): number | null {
  const turn = state.turn;
  const players = playerCountOf(state);
  if (duration === 'permanent') return null;
  if (duration === 'turn') return turn + 1;
  if (duration === 'untilYourNextTurn') return turn + players;
  if (duration === 'untilEndOfYourNextTurn') return turn + players + 1;
  if (typeof duration === 'object' && 'turns' in duration) {
    return turn + Math.max(1, Math.round(duration.turns));
  }
  // { untilDiscarded: n } has no turn expiry — it clears on accrued cost.
  return null;
}

/** True while this individual lock still binds. */
export function lockIsActive(state: GameState, lock: PileLock): boolean {
  if (lock.unlockOnDiscardedCost !== undefined) {
    const accrued = lock.accruedDiscardCost ?? 0;
    if (accrued >= lock.unlockOnDiscardedCost) return false;
  }
  if (lock.expiresOnTurn === null || lock.expiresOnTurn === undefined) return true;
  // B51: the lock is gone once the named turn arrives.
  return state.turn < lock.expiresOnTurn;
}

/** B50. A pile is locked while it carries at least one live lock. */
export function isLocked(state: GameState, pileId: PileId): boolean {
  const pile = state.shop.piles[pileId];
  if (!pile) return false;
  for (const lock of pile.locks) {
    if (lockIsActive(state, lock)) return true;
  }
  return false;
}

/** Total discarded cost banked against this pile's locks, for card text. */
export function accruedDiscardCost(state: GameState, pileId: PileId): number {
  const pile = state.shop.piles[pileId];
  if (!pile) return 0;
  let total = 0;
  for (const lock of pile.locks) total += lock.accruedDiscardCost ?? 0;
  return total;
}
