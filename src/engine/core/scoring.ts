/**
 * Final scoring.
 *
 * B16 Most VP wins; ties break by fewest turns taken, then smallest deck, then
 *     a shared win (SB-15).
 * B17 Count VP printed on every card in the whole deck (library + hand + GY +
 *     play), plus VP accrued onto instances, plus End of Game cards - which are
 *     excluded from the running `player.vp` during the match.
 *
 * The engine deliberately never adds a card's printed VP to `player.vp` when it
 * is played, so this scan is the only place printed VP is counted and nothing
 * is double counted. `player.vp` holds effect-granted VP only.
 */

import type { GameState, InstanceId, PlayerId } from '@engine/types';
import { statOf } from '@engine/systems';
import { deckOf, safeDef } from './zones.js';

export function deckSizeOf(state: GameState, player: PlayerId): number {
  return deckOf(state, player).length;
}

export function turnsTakenBy(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  if (!p) return 0;
  return p.counters['turnsTaken'] ?? 0;
}

/** VP that lives on one instance: printed + variant + instance delta + counters. */
export function vpOnInstance(state: GameState, iid: InstanceId): number {
  const inst = state.instances[iid];
  if (!inst) return 0;
  let total = statOf(state, iid, 'vp');
  total += inst.counters['vp'] ?? 0;
  // Ascendant Spread and friends bank their real value in `secret`.
  if (inst.secret && typeof inst.secret['vp'] === 'number') total += inst.secret['vp'];
  return total;
}

export function scoreFor(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  if (!p) return 0;
  let total = p.vp;
  for (const iid of deckOf(state, player)) total += vpOnInstance(state, iid);
  return total;
}

/** B17. */
export function computeScores(state: GameState): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {};
  for (const pid of state.playerOrder) out[pid] = scoreFor(state, pid);
  return out;
}

/** How many End of Game tagged cards a player holds, for the log. */
export function endOfGameCards(state: GameState, player: PlayerId): number {
  let n = 0;
  for (const iid of deckOf(state, player)) {
    const inst = state.instances[iid];
    if (!inst) continue;
    if (safeDef(inst.defId).tags.includes('EndOfGame')) n += 1;
  }
  return n;
}

/**
 * B16 / SB-15: most VP, then fewest turns taken, then smallest deck, then a
 * shared win. Eliminated players (Battle Royale) never win.
 */
export function determineWinners(
  state: GameState,
  scores: Record<PlayerId, number>,
): PlayerId[] {
  const contenders = state.playerOrder.filter((pid) => {
    const p = state.players[pid];
    return p ? !p.eliminated : false;
  });
  const pool = contenders.length ? contenders : [...state.playerOrder];
  if (pool.length === 0) return [];

  let best: PlayerId[] = [...pool];
  const bestBy = (metric: (pid: PlayerId) => number, prefer: 'max' | 'min'): PlayerId[] => {
    let extreme = metric(best[0] as PlayerId);
    for (const pid of best) {
      const v = metric(pid);
      if (prefer === 'max' ? v > extreme : v < extreme) extreme = v;
    }
    return best.filter((pid) => metric(pid) === extreme);
  };

  best = bestBy((pid) => scores[pid] ?? 0, 'max');
  if (best.length === 1) return best;

  best = bestBy((pid) => turnsTakenBy(state, pid), 'min');
  if (best.length === 1) return best;

  best = bestBy((pid) => deckSizeOf(state, pid), 'min');
  return best;
}
