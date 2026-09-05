/**
 * Upgrade — the two distinct meanings (gameplay doc §3.2).
 *
 *   UpgradeResource — a Resource card steps up the ladder:
 *                     Copper -> Silver -> Gold -> Diamond.
 *                     Pennymelting runs it backwards.
 *   UpgradeRelic    — this instance permanently gains +1 of one stat and its
 *                     `counters.upgrades` goes up. Monumental Works reads that
 *                     counter.
 *
 * Both are transforms in the B39 sense: the card is replaced in its zone at its
 * position, and no trash or gain trigger fires.
 */

import type { CardDefId, GameState, InstanceId, StatKey } from '@engine/types';
import { BUFFABLE_STATS } from '@engine/types';
import type { Rng } from '@engine/rng';
import { bumpStat, pushLog, withInstance } from './internal';

/** The Resource ladder, cheapest first. */
export const RESOURCE_LADDER: readonly CardDefId[] = ['copper', 'silver', 'gold', 'diamond'];

/** The next rung up, or null when the id is not on the ladder. */
export function upgradedDefId(defId: CardDefId): CardDefId | null {
  const i = RESOURCE_LADDER.indexOf(defId);
  if (i < 0) return null;
  if (i === RESOURCE_LADDER.length - 1) return RESOURCE_LADDER[i];
  return RESOURCE_LADDER[i + 1];
}

/** The next rung down, or null when the id is not on the ladder. Copper stays Copper. */
export function downgradedDefId(defId: CardDefId): CardDefId | null {
  const i = RESOURCE_LADDER.indexOf(defId);
  if (i < 0) return null;
  if (i === 0) return RESOURCE_LADDER[0];
  return RESOURCE_LADDER[i - 1];
}

/** True when this instance sits somewhere on the Copper/Silver/Gold/Diamond ladder. */
export function isUpgradableResource(state: GameState, iid: InstanceId): boolean {
  const inst = state.instances[iid];
  if (!inst) return false;
  return RESOURCE_LADDER.includes(inst.defId);
}

/**
 * Copper -> Silver -> Gold -> Diamond, in place. Diamond is the top of the
 * ladder and stays a Diamond. Instance counters, plague tokens and granted
 * keywords all survive the swap (B63, B65).
 */
export function upgradeResource(state: GameState, iid: InstanceId): GameState {
  const inst = state.instances[iid];
  if (!inst) return state;
  const to = upgradedDefId(inst.defId);
  if (to === null || to === inst.defId) return state;
  const next = withInstance(state, iid, (i) => ({ ...i, defId: to }));
  return pushLog(next, 'upgradeResource', inst.owner, { iid, from: inst.defId, to });
}

/**
 * Pennymelting: Diamond -> Gold -> Silver -> Copper. A Copper stays a Copper
 * rather than being destroyed.
 */
export function downgradeResource(state: GameState, iid: InstanceId): GameState {
  const inst = state.instances[iid];
  if (!inst) return state;
  const to = downgradedDefId(inst.defId);
  if (to === null || to === inst.defId) return state;
  const next = withInstance(state, iid, (i) => ({ ...i, defId: to }));
  return pushLog(next, 'downgradeResource', inst.owner, { iid, from: inst.defId, to });
}

/**
 * Relic upgrade: +1 to this instance's own stat line, permanently, plus one on
 * `counters.upgrades`. Never touches the definition or the variant, so two
 * Relics of the same printed card can hold different upgrades.
 */
export function upgradeRelic(state: GameState, iid: InstanceId, stat: StatKey): GameState {
  const inst = state.instances[iid];
  if (!inst) return state;
  const next = withInstance(state, iid, (i) => ({
    ...i,
    statDelta: bumpStat(i.statDelta, stat, 1),
    counters: { ...i.counters, upgrades: (i.counters.upgrades ?? 0) + 1 },
  }));
  return pushLog(next, 'upgradeRelic', inst.owner, { iid, stat, upgrades: (inst.counters.upgrades ?? 0) + 1 });
}

/** Relic upgrade on a rolled stat. Never rolls prophet. */
export function upgradeRelicRandom(state: GameState, iid: InstanceId, rng: Rng): GameState {
  return upgradeRelic(state, iid, rng.pick(BUFFABLE_STATS));
}

/** Relic upgrade on all five buffable stats at once (Relic of Totality). */
export function upgradeRelicAll(state: GameState, iid: InstanceId): GameState {
  let next = state;
  for (const stat of BUFFABLE_STATS) {
    next = upgradeRelic(next, iid, stat);
  }
  return next;
}

/** How many times this instance has been Relic-upgraded. Monumental Works reads this. */
export function upgradeCount(state: GameState, iid: InstanceId): number {
  return state.instances[iid]?.counters.upgrades ?? 0;
}

/** Total Relic upgrades across everything a player owns. */
export function totalUpgrades(state: GameState, player: string): number {
  let total = 0;
  for (const iid of Object.keys(state.instances)) {
    const inst = state.instances[iid];
    if (inst.owner !== player) continue;
    total += inst.counters.upgrades ?? 0;
  }
  return total;
}
