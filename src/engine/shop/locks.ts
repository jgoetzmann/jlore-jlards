/**
 * Pile locks. B50, B51, B52.
 *
 * A lock carries an owner and a duration and expires on the turn it names. The
 * one rule that is easy to get wrong: re-locking a locked pile is a no-op — it
 * does not stack and it does not extend (B52). That is what makes Chains of the
 * Sovereign and Seal the Rift fight over the same piles instead of chaining.
 */

import type { Duration, GameState, PileId, PileLock, PlayerId } from '@engine/types';
import { appendLog, cloneState, clonePile, playerCountOf, withPile } from './util';

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

export function discardCostThresholdFor(duration: Duration): number | undefined {
  if (typeof duration === 'object' && 'untilDiscarded' in duration) {
    return duration.untilDiscarded;
  }
  return undefined;
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

/** The active locks on a pile, in application order. */
export function activeLocks(state: GameState, pileId: PileId): PileLock[] {
  const pile = state.shop.piles[pileId];
  if (!pile) return [];
  return pile.locks.filter((l) => lockIsActive(state, l));
}

/** When the pile frees up, for the view layer. Null means never / no lock. */
export function lockedUntil(state: GameState, pileId: PileId): number | null {
  const locks = activeLocks(state, pileId);
  if (locks.length === 0) return null;
  let latest: number | null = null;
  for (const lock of locks) {
    if (lock.expiresOnTurn === null || lock.expiresOnTurn === undefined) return null;
    if (latest === null || lock.expiresOnTurn > latest) latest = lock.expiresOnTurn;
  }
  return latest;
}

export function lockOwner(state: GameState, pileId: PileId): PlayerId | null {
  const locks = activeLocks(state, pileId);
  return locks.length > 0 ? locks[0].by : null;
}

/**
 * B52. Lock a pile. If it is already locked the call does nothing at all — the
 * existing lock keeps its own owner and its own expiry.
 */
export function lockPile(
  state: GameState,
  pileId: PileId,
  by: PlayerId,
  duration: Duration,
): GameState {
  const pile = state.shop.piles[pileId];
  if (!pile) return state;
  if (isLocked(state, pileId)) {
    return appendLog(state, 'lockRefused', { pileId, by, reason: 'alreadyLocked' }, by);
  }
  const lock: PileLock = {
    by,
    duration,
    expiresOnTurn: expiryTurnFor(state, duration),
  };
  const threshold = discardCostThresholdFor(duration);
  if (threshold !== undefined) {
    lock.unlockOnDiscardedCost = threshold;
    lock.accruedDiscardCost = 0;
  }
  const next = withPile(state, pileId, (p) => {
    // Dead locks are swept here so a pile never accumulates history.
    p.locks = [...p.locks.filter((l) => lockIsActive(state, l)), lock];
  });
  return appendLog(next, 'pileLocked', { pileId, by, expiresOnTurn: lock.expiresOnTurn }, by);
}

/** Drop every lock on one pile. */
export function unlockPile(state: GameState, pileId: PileId): GameState {
  const pile = state.shop.piles[pileId];
  if (!pile || pile.locks.length === 0) return state;
  const next = withPile(state, pileId, (p) => {
    p.locks = [];
  });
  return appendLog(next, 'pileUnlocked', { pileId });
}

/** B51. Sweep every lock whose named turn has arrived. Called at turn boundaries. */
export function expireLocks(state: GameState): GameState {
  let changed = false;
  const next = cloneState(state);
  const expired: PileId[] = [];
  for (const pileId of Object.keys(state.shop.piles)) {
    const pile = state.shop.piles[pileId];
    if (pile.locks.length === 0) continue;
    const kept = pile.locks.filter((l) => lockIsActive(state, l));
    if (kept.length === pile.locks.length) continue;
    const copy = clonePile(pile);
    copy.locks = kept.map((l) => ({ ...l }));
    next.shop.piles[pileId] = copy;
    expired.push(pileId);
    changed = true;
  }
  if (!changed) return state;
  return appendLog(next, 'locksExpired', { piles: expired });
}

/** Cloud Nine: every pile on the board comes unlocked at once. */
export function clearAllLocks(state: GameState): GameState {
  let any = false;
  const next = cloneState(state);
  for (const pileId of Object.keys(state.shop.piles)) {
    const pile = state.shop.piles[pileId];
    if (pile.locks.length === 0) continue;
    const copy = clonePile(pile);
    copy.locks = [];
    next.shop.piles[pileId] = copy;
    any = true;
  }
  if (!any) return state;
  return appendLog(next, 'allLocksCleared', {});
}

/**
 * Archwarden. Discarded cost accrues against a `{ untilDiscarded: n }` lock, and
 * the lock falls off on its own once the total reaches the threshold.
 */
export function accrueDiscardCost(state: GameState, pileId: PileId, amount: number): GameState {
  const pile = state.shop.piles[pileId];
  if (!pile || pile.locks.length === 0 || amount === 0) return state;
  let touched = false;
  const next = withPile(state, pileId, (p) => {
    p.locks = p.locks.map((lock) => {
      if (lock.unlockOnDiscardedCost === undefined) return lock;
      touched = true;
      return { ...lock, accruedDiscardCost: (lock.accruedDiscardCost ?? 0) + amount };
    });
  });
  if (!touched) return state;
  return appendLog(next, 'lockCostAccrued', { pileId, amount });
}

/** Total discarded cost banked against this pile's locks, for card text. */
export function accruedDiscardCost(state: GameState, pileId: PileId): number {
  const pile = state.shop.piles[pileId];
  if (!pile) return 0;
  let total = 0;
  for (const lock of pile.locks) total += lock.accruedDiscardCost ?? 0;
  return total;
}

/** Chains of the Sovereign fails when at least half the piles are already locked. */
export function lockedPileCount(
  state: GameState,
  shop?: 'resource' | 'points' | 'prophet' | 'draft',
): number {
  let n = 0;
  for (const pileId of Object.keys(state.shop.piles)) {
    if (shop && state.shop.piles[pileId].shop !== shop) continue;
    if (isLocked(state, pileId)) n += 1;
  }
  return n;
}

/** Idol of the False God locks the whole Prophet Shop at once. */
export function lockShop(
  state: GameState,
  shop: 'resource' | 'points' | 'prophet' | 'draft',
  by: PlayerId,
  duration: Duration,
): GameState {
  let next = state;
  for (const pileId of state.shop.order[shop]) {
    next = lockPile(next, pileId, by, duration);
  }
  return next;
}
