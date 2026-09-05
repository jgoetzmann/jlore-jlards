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

import type { GameState, InstanceId, PileId, PlayerId, Zone } from '@engine/types';
import type { Rng } from '@engine/rng';
import { resolveEffects } from '@engine/effects';
import { allIids, defOf, pushLog, withInstance, withInstances } from './internal';

const KEY = 'plague';

/** Plague tokens on one instance. Missing reads 0. */
export function plagueTokensOn(state: GameState, iid: InstanceId): number {
  return state.instances[iid]?.counters[KEY] ?? 0;
}

/** True when the instance carries at least one token. Feeds `CardFilter.plagued`. */
export function isPlagued(state: GameState, iid: InstanceId): boolean {
  return plagueTokensOn(state, iid) > 0;
}

/**
 * Add tokens to one instance and fire every `onPlagueAdded` trigger. Works in
 * any zone, including shop piles, where the instance has no owner and the
 * triggers fire for the active player instead.
 */
export function addPlague(state: GameState, iid: InstanceId, amount = 1): GameState {
  const inst = state.instances[iid];
  if (!inst || amount <= 0) return state;

  const now = (inst.counters[KEY] ?? 0) + amount;
  let next = withInstance(state, iid, (i) => ({
    ...i,
    counters: { ...i.counters, [KEY]: now },
  }));
  next = pushLog(next, 'plagueAdded', inst.owner, { iid, amount, total: now });
  return firePlagueTriggers(next, iid);
}

/** Add tokens to a batch of instances in one pass. */
export function addPlagueMany(
  state: GameState,
  iids: readonly InstanceId[],
  amount = 1,
): GameState {
  let next = state;
  for (const iid of iids) next = addPlague(next, iid, amount);
  return next;
}

/** Antibody Extraction: strip every token off one instance. */
export function removeAllPlague(state: GameState, iid: InstanceId): GameState {
  const inst = state.instances[iid];
  if (!inst || (inst.counters[KEY] ?? 0) === 0) return state;
  const removed = inst.counters[KEY] ?? 0;
  const next = withInstance(state, iid, (i) => {
    const counters = { ...i.counters };
    delete counters[KEY];
    return { ...i, counters };
  });
  return pushLog(next, 'plagueRemoved', inst.owner, { iid, removed });
}

/** Strip tokens off a batch. */
export function removeAllPlagueMany(state: GameState, iids: readonly InstanceId[]): GameState {
  let next = state;
  for (const iid of iids) next = removeAllPlague(next, iid);
  return next;
}

/** Remove exactly `amount` tokens, floored at 0. */
export function removePlague(state: GameState, iid: InstanceId, amount: number): GameState {
  const cur = plagueTokensOn(state, iid);
  if (cur === 0) return state;
  const now = Math.max(0, cur - amount);
  if (now === 0) return removeAllPlague(state, iid);
  return withInstance(state, iid, (i) => ({ ...i, counters: { ...i.counters, [KEY]: now } }));
}

/**
 * Every plagued instance, optionally narrowed to one zone. Sorted, because
 * anything downstream of this feeds a seeded random pick.
 */
export function plaguedInstances(state: GameState, zone?: Zone): InstanceId[] {
  return allIids(state).filter((iid) => {
    const inst = state.instances[iid];
    if ((inst.counters[KEY] ?? 0) <= 0) return false;
    if (zone !== undefined && inst.zone !== zone) return false;
    return true;
  });
}

/** Every plagued instance a player owns. */
export function plaguedOwnedBy(state: GameState, player: PlayerId): InstanceId[] {
  return plaguedInstances(state).filter((iid) => state.instances[iid].owner === player);
}

/** Every plagued instance stacked in one pile. */
export function plaguedInPile(state: GameState, pileId: PileId): InstanceId[] {
  const pile = state.shop.piles[pileId];
  if (!pile) return [];
  return pile.cards.filter((iid) => plagueTokensOn(state, iid) > 0);
}

/** Total tokens on the board, for Outbreak-style scaling reads. */
export function totalPlagueInMatch(state: GameState): number {
  let total = 0;
  for (const iid of allIids(state)) total += state.instances[iid].counters[KEY] ?? 0;
  return total;
}

/**
 * Plandemic: every plagued card infects one clean neighbour.
 *
 * A "neighbour" is a card in the same locality — the same pile for shop cards,
 * the same owner's same zone for owned cards. Contagion that jumped zones would
 * make plague unavoidable rather than something you can quarantine by trashing
 * or by not buying from an infected pile.
 *
 * Deterministic given `rng`: candidates are enumerated in sorted order and one
 * is picked with `rng.pick`.
 */
export function spreadPlague(state: GameState, rng: Rng): GameState {
  const sources = plaguedInstances(state);
  if (sources.length === 0) return state;

  const infected: InstanceId[] = [];

  for (const src of sources) {
    const inst = state.instances[src];
    if (!inst) continue;

    const candidates = allIids(state).filter((iid) => {
      if (iid === src) return false;
      const other = state.instances[iid];
      if ((other.counters[KEY] ?? 0) > 0) return false;
      if (infected.includes(iid)) return false;
      if (inst.zone === 'shop') return other.zone === 'shop' && other.pileId === inst.pileId;
      return other.owner === inst.owner && other.zone === inst.zone;
    });

    if (candidates.length === 0) continue;
    infected.push(rng.pick(candidates));
  }

  if (infected.length === 0) return state;

  let next = withInstances(state, infected, (inst) => ({
    ...inst,
    counters: { ...inst.counters, [KEY]: (inst.counters[KEY] ?? 0) + 1 },
  }));
  next = pushLog(next, 'plagueSpread', null, { infected: infected.length });
  for (const iid of infected) next = firePlagueTriggers(next, iid);
  return next;
}

/** Fire the `onPlagueAdded` triggers printed on the newly infected card. */
function firePlagueTriggers(state: GameState, iid: InstanceId): GameState {
  const inst = state.instances[iid];
  if (!inst) return state;
  const def = defOf(state, iid);
  if (!def) return state;

  const who: PlayerId = inst.owner ?? state.activePlayer;
  let next = state;
  for (const trg of def.triggers) {
    if (trg.on !== 'onPlagueAdded') continue;
    if (trg.zones && !trg.zones.includes(inst.zone)) continue;
    next = resolveEffects(next, trg.effects, {
      player: who,
      sourceIid: iid,
      depth: 0,
      multiplier: 1,
      vars: { plagueTokens: next.instances[iid]?.counters[KEY] ?? 0 },
    });
  }
  return next;
}
