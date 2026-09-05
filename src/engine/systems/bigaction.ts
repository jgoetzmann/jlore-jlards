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

import type { GameState, InstanceId } from '@engine/types';
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
