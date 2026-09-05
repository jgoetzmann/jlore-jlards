/**
 * S-BIGACTION — Big Action N (SB-1).
 *
 * Playing the card costs N Actions instead of 1. It changes nothing else about
 * the card. B72, B73.
 *
 * Too Many Stats rerolls its own Big Action value at the start of each turn and
 * parks the roll on `counters.bigAction`; that override wins when present so the
 * card does not need engine changes.
 */

import type { GameState, InstanceId, PlayerId } from '@engine/types';
import { defOf } from './internal';

/** Actions it costs to play this instance. Defaults to 1 (B72). */
export function bigActionCost(state: GameState, iid: InstanceId): number {
  const inst = state.instances[iid];
  if (!inst) return 1;

  const override = inst.counters.bigAction;
  if (override !== undefined && Number.isFinite(override)) {
    return Math.max(1, Math.floor(override));
  }

  const def = defOf(state, iid);
  if (!def || def.bigAction === undefined) return 1;
  return Math.max(1, Math.floor(def.bigAction));
}

/** True when the card is a Big Action, i.e. costs more than the standard 1. */
export function isBigAction(state: GameState, iid: InstanceId): boolean {
  return bigActionCost(state, iid) > 1;
}

/**
 * B73: a card with Big Action N cannot be played with fewer than N Actions.
 * Resources cost no Action at all, so they are always affordable.
 */
export function canAffordBigAction(state: GameState, player: PlayerId, iid: InstanceId): boolean {
  const p = state.players[player];
  if (!p) return false;
  const def = defOf(state, iid);
  if (def && def.types.includes('Resource') && !def.types.includes('Action')) return true;
  return p.actions >= bigActionCost(state, iid);
}

/**
 * Actions actually spent by playing this instance. Resources cost none; every
 * other card costs its Big Action value.
 */
export function actionCostOfPlay(state: GameState, iid: InstanceId): number {
  const def = defOf(state, iid);
  if (def && def.types.includes('Resource') && !def.types.includes('Action')) return 0;
  return bigActionCost(state, iid);
}

/** Deduct the Big Action cost. Returns the state unchanged when unaffordable (B18, B73). */
export function payBigAction(state: GameState, player: PlayerId, iid: InstanceId): GameState {
  const p = state.players[player];
  if (!p) return state;
  const cost = actionCostOfPlay(state, iid);
  if (cost === 0) return state;
  if (p.actions < cost) return state;
  return {
    ...state,
    players: { ...state.players, [player]: { ...p, actions: p.actions - cost } },
  };
}

/** Set a rolled Big Action value on one instance (Too Many Stats). */
export function setBigActionOverride(state: GameState, iid: InstanceId, value: number): GameState {
  const inst = state.instances[iid];
  if (!inst) return state;
  const bumped = {
    ...inst,
    counters: { ...inst.counters, bigAction: Math.max(1, Math.floor(value)) },
  };
  return { ...state, instances: { ...state.instances, [iid]: bumped } };
}
