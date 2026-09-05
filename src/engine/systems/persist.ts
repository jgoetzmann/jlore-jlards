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

import type { CardDefId, GameState, InstanceId, PlayerId, Zone } from '@engine/types';
import { pushLog, withInstance, withInstances, withPlayer } from './internal';
import { moveInstance, wholeDeck } from './zoneops';

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

/** True when the current count is any of the listed milestones (Runebinder). */
export function isMilestonePlay(
  state: GameState,
  player: PlayerId,
  defId: CardDefId,
  milestones: readonly number[],
): boolean {
  const count = playCountOf(state, player, defId);
  return milestones.includes(count);
}

/** Runebinder's ladder, frozen here so the card file does not carry engine numbers. */
export const RUNEBINDER_MILESTONES: readonly number[] = [7, 9, 13, 14, 18, 21, 26, 27, 28];

/** Every definition this player has played at least once. */
export function playedDefinitions(state: GameState, player: PlayerId): CardDefId[] {
  const p = state.players[player];
  if (!p) return [];
  return Object.keys(p.playCounts)
    .filter((defId) => (p.playCounts[defId] ?? 0) > 0)
    .sort();
}

/** Total cards this player has played this match, across every definition. */
export function totalPlays(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  if (!p) return 0;
  let total = 0;
  for (const defId of Object.keys(p.playCounts)) total += p.playCounts[defId] ?? 0;
  return total;
}

// ---------------------------------------------------------------------------
// Per-instance counters (B63)
// ---------------------------------------------------------------------------

/** Read one counter off an instance. Missing counters read 0, never undefined. */
export function counterOf(state: GameState, iid: InstanceId, key: string): number {
  return state.instances[iid]?.counters[key] ?? 0;
}

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

/** Set one counter on an instance outright. */
export function setCounter(
  state: GameState,
  iid: InstanceId,
  key: string,
  value: number,
): GameState {
  if (!state.instances[iid]) return state;
  return withInstance(state, iid, (inst) => ({
    ...inst,
    counters: { ...inst.counters, [key]: value },
  }));
}

/** Remove one counter entirely. */
export function clearCounter(state: GameState, iid: InstanceId, key: string): GameState {
  const inst = state.instances[iid];
  if (!inst || inst.counters[key] === undefined) return state;
  return withInstance(state, iid, (i) => {
    const counters = { ...i.counters };
    delete counters[key];
    return { ...i, counters };
  });
}

/** Bump the same counter on many instances at once. */
export function bumpCounterMany(
  state: GameState,
  iids: readonly InstanceId[],
  key: string,
  amount: number,
): GameState {
  return withInstances(state, iids, (inst) => ({
    ...inst,
    counters: { ...inst.counters, [key]: (inst.counters[key] ?? 0) + amount },
  }));
}

/** Per-player named counters (astrologistsTrashed, ricochetUsedThisTurn, ...). */
export function playerCounterOf(state: GameState, player: PlayerId, key: string): number {
  return state.players[player]?.counters[key] ?? 0;
}

export function bumpPlayerCounter(
  state: GameState,
  player: PlayerId,
  key: string,
  amount: number,
): GameState {
  if (!state.players[player]) return state;
  return withPlayer(state, player, (p) => ({
    ...p,
    counters: { ...p.counters, [key]: (p.counters[key] ?? 0) + amount },
  }));
}

/**
 * A zone move that provably preserves every persistent field (B63). This is the
 * only mover the persistence-reading cards should be routed through, because it
 * is the one with the guarantee written on it.
 */
export function moveKeepingCounters(
  state: GameState,
  iid: InstanceId,
  owner: PlayerId | null,
  zone: Zone,
  position: 'top' | 'bottom' = 'top',
): GameState {
  const before = state.instances[iid];
  if (!before) return state;
  const carried = { ...before.counters };
  const keptAdded = [...before.addedKeywords];
  const keptRemoved = [...before.removedKeywords];
  const keptDelta = { ...before.statDelta };
  const keptExtra = [...before.extraEffects];

  let next = moveInstance(state, iid, owner, zone, position);
  next = withInstance(next, iid, (inst) => ({
    ...inst,
    counters: carried,
    addedKeywords: keptAdded,
    removedKeywords: keptRemoved,
    statDelta: keptDelta,
    extraEffects: keptExtra,
  }));
  return next;
}

/**
 * Sum of one counter across everything a player owns. Skyscraper, Tixatus and
 * Oh Mr. Lebon all score off a total like this.
 */
export function counterTotalForPlayer(state: GameState, player: PlayerId, key: string): number {
  let total = 0;
  for (const iid of wholeDeck(state, player)) {
    total += state.instances[iid]?.counters[key] ?? 0;
  }
  return total;
}

/** Every instance a player owns carrying a nonzero value on one counter. */
export function instancesWithCounter(
  state: GameState,
  player: PlayerId,
  key: string,
): InstanceId[] {
  return wholeDeck(state, player).filter((iid) => (state.instances[iid]?.counters[key] ?? 0) > 0);
}
