/**
 * S-PLAGUE — tokens on a specific card instance, in any zone (B65).
 *
 * Plague lives on `instance.counters.plague`. Because it is per-instance and
 * every zone move carries the counters object with it, a plagued card in a shop
 * pile stays plagued when it is bought — no special case needed on the buy path.
 *
 * Crop Dusting, Plague Crawler, Plague Charger, Outbreak, Living Bomb,
 * Plandemic, Patient Zero, Antibody Extraction, Spider E.B., CNcias, Jalshi,
 * Juhan Wet Market and BOOM! Big Max all read this.
 */

import type { GameState, InstanceId } from '@engine/types';

const KEY = 'plague';

/** Plague tokens on one instance. Missing reads 0. */
export function plagueTokensOn(state: GameState, iid: InstanceId): number {
  return state.instances[iid]?.counters[KEY] ?? 0;
}
