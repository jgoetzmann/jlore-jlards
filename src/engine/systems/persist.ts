/**
 * S-PERSIST — counters that outlive the moment they were set (B63, B64).
 *
 * Two independent stores:
 *
 *   CardInstance.counters      — per physical card. Survives zone changes,
 *                                shuffles and end-of-turn discards, because
 *                                every zone move rewrites one array and one
 *                                `zone` field and never rebuilds the object.
 *   PlayerState.playCounts     — per player, per definition, for the whole
 *                                match. Lection (5th play), Coal (3rd),
 *                                Journey to the Moon (25th), Wish Upon the
 *                                Stars (100th), Runebinder (7/9/13/14/18/21/
 *                                26/27/28), Outsourcing R&D (3rd) and 25th
 *                                Hour all read it.
 */

import type { CardDefId, GameState, InstanceId, PlayerId } from '@engine/types';
import { pushLog, withInstance, withPlayer } from './internal';

// ---------------------------------------------------------------------------
// Per-player, per-definition play counts (B64)
// ---------------------------------------------------------------------------

/** Increment this player's lifetime play count for a definition and return it. */
export function bumpPlayCount(state: GameState, player: PlayerId, defId: CardDefId): GameState {
  const p = state.players[player];
  if (!p) return state;
  const now = (p.playCounts[defId] ?? 0) + 1;
  const next = withPlayer(state, player, (pl) => ({
    ...pl,
    playCounts: { ...pl.playCounts, [defId]: now },
  }));
  return pushLog(next, 'playCount', player, { defId, count: now });
}

/** How many times this player has played this definition this match. */
export function playCountOf(state: GameState, player: PlayerId, defId: CardDefId): number {
  return state.players[player]?.playCounts[defId] ?? 0;
}

/**
 * True when the play that just happened was the Nth. Call after `bumpPlayCount`.
 * Lection asks `isNthPlay(s, p, 'lection', 5)`.
 */
export function isNthPlay(state: GameState, player: PlayerId, defId: CardDefId, n: number): boolean {
  return playCountOf(state, player, defId) === n;
}

// ---------------------------------------------------------------------------
// Per-instance counters (B63)
// ---------------------------------------------------------------------------

/** Add to one counter on an instance. Negative amounts subtract. */
export function bumpCounter(
  state: GameState,
  iid: InstanceId,
  key: string,
  amount: number,
): GameState {
  if (!state.instances[iid]) return state;
  return withInstance(state, iid, (inst) => ({
    ...inst,
    counters: { ...inst.counters, [key]: (inst.counters[key] ?? 0) + amount },
  }));
}
