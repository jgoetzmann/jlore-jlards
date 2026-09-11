/**
 * Shared plumbing for the systems slice.
 *
 * Everything in here is local to `src/engine/systems/`. It is duplicated on
 * purpose: other slices almost certainly wrote their own clone/log/stat
 * helpers, and coordinating on one would have cost more than deleting the
 * loser later.
 *
 * All helpers are non-mutating: they return a new GameState with structural
 * sharing on the parts they did not touch, so `reduce` stays pure (B2).
 */

import type {
  CardDefId,
  CardDefinition,
  CardInstance,
  Complexity,
  GameState,
  InstanceId,
  LogEntry,
  PileId,
  PlayerId,
  PlayerState,
  Rarity,
  StatKey,
  Stats,
  Zone,
} from '@engine/types';
import { getCard } from '@engine/registry';
import { makeLogEntry } from '@engine/core/log';

/** Every stat key, including prophet. Buff never picks prophet — see BUFFABLE_STATS. */
export const ALL_STAT_KEYS: readonly StatKey[] = ['money', 'buys', 'actions', 'cards', 'vp', 'prophet'];

/** `getCard` throws on unknown ids; systems code must never throw across `reduce`. */
export function tryGetCard(defId: CardDefId): CardDefinition | null {
  try {
    return getCard(defId);
  } catch {
    return null;
  }
}

/** Deep-enough copy of one instance so callers can mutate the copy freely. */
export function copyInstance(inst: CardInstance): CardInstance {
  const next: CardInstance = {
    ...inst,
    addedKeywords: [...inst.addedKeywords],
    removedKeywords: [...inst.removedKeywords],
    counters: { ...inst.counters },
    statDelta: { ...inst.statDelta },
    extraEffects: [...inst.extraEffects],
  };
  if (inst.fusedFrom) next.fusedFrom = [...inst.fusedFrom];
  if (inst.secret) next.secret = { ...inst.secret };
  return next;
}

/** Deep-enough copy of one player so callers can mutate the copy freely. */
export function copyPlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    library: [...p.library],
    hand: [...p.hand],
    gy: [...p.gy],
    play: [...p.play],
    field: p.field.map((a) => ({ ...a, counters: { ...a.counters } })),
    codex: [...p.codex],
    playedThisTurn: [...p.playedThisTurn],
    delayed: p.delayed.map((d) => ({ ...d, effects: [...d.effects] })),
    nextCardMods: p.nextCardMods.map((m) => ({ ...m })),
    turnModifiers: { ...p.turnModifiers },
    playCounts: { ...p.playCounts },
    counters: { ...p.counters },
    quest: p.quest
      ? { ...p.quest, progress: { ...p.quest.progress }, completedFloors: [...p.quest.completedFloors] }
      : null,
  };
}

/** Rewrite one instance. No-op when the instance does not exist. */
export function withInstance(
  state: GameState,
  iid: InstanceId,
  fn: (inst: CardInstance) => CardInstance,
): GameState {
  const cur = state.instances[iid];
  if (!cur) return state;
  const next = fn(copyInstance(cur));
  return { ...state, instances: { ...state.instances, [iid]: next } };
}

/** Rewrite several instances in one pass. */
export function withInstances(
  state: GameState,
  iids: readonly InstanceId[],
  fn: (inst: CardInstance) => CardInstance,
): GameState {
  let touched = false;
  const bag: Record<InstanceId, CardInstance> = { ...state.instances };
  for (const iid of iids) {
    const cur = bag[iid];
    if (!cur) continue;
    bag[iid] = fn(copyInstance(cur));
    touched = true;
  }
  return touched ? { ...state, instances: bag } : state;
}

/** Rewrite one player. No-op when the player does not exist. */
export function withPlayer(
  state: GameState,
  playerId: PlayerId,
  fn: (p: PlayerState) => PlayerState,
): GameState {
  const cur = state.players[playerId];
  if (!cur) return state;
  const next = fn(copyPlayer(cur));
  return { ...state, players: { ...state.players, [playerId]: next } };
}

/** Append one LogEntry with a monotonically increasing seq (B118). */
export function pushLog(
  state: GameState,
  kind: string,
  player: PlayerId | null,
  detail: Record<string, unknown>,
): GameState {
  const seq = state.logSeq + 1;
  const entry = makeLogEntry(seq, state.turn, player, kind, detail);
  return { ...state, log: [...state.log, entry], logSeq: seq };
}

/** Per-stat sum. Keys present in either operand survive, so a 0-printed stat gains a line (B70). */
export function addStats(a: Stats | undefined, b: Stats | undefined): Stats {
  const out: Stats = {};
  for (const k of ALL_STAT_KEYS) {
    const va = a && a[k] !== undefined ? (a[k] as number) : undefined;
    const vb = b && b[k] !== undefined ? (b[k] as number) : undefined;
    if (va === undefined && vb === undefined) continue;
    out[k] = (va ?? 0) + (vb ?? 0);
  }
  return out;
}

/**
 * Add `delta` to one stat line, creating the line when the card prints the stat
 * as 0 or does not print it at all (B70 / SB-17).
 */
export function bumpStat(stats: Stats, stat: StatKey, delta: number): Stats {
  const out: Stats = { ...stats };
  out[stat] = (out[stat] ?? 0) + delta;
  return out;
}

/** Every instance id in the match, in a stable order. */
export function allIids(state: GameState): InstanceId[] {
  return Object.keys(state.instances).sort();
}

/** Every instance id currently stacked in a pile, top first. */
export function pileContents(state: GameState, pileId: PileId): InstanceId[] {
  const pile = state.shop.piles[pileId];
  return pile ? [...pile.cards] : [];
}

/** Every instance of `defId` anywhere in the match, including shop piles. */
export function copiesOf(state: GameState, defId: CardDefId): InstanceId[] {
  const out: InstanceId[] = [];
  for (const iid of allIids(state)) {
    if (state.instances[iid].defId === defId) out.push(iid);
  }
  return out;
}

/** Mint the next instance id in `i_0000` shape and advance the counter. */
export function mintInstance(
  state: GameState,
  inst: Omit<CardInstance, 'iid'>,
): { state: GameState; iid: InstanceId } {
  const seq = state.nextInstanceSeq;
  const iid: InstanceId = 'i_' + String(seq).padStart(4, '0');
  const made: CardInstance = { ...inst, iid };
  return {
    state: {
      ...state,
      nextInstanceSeq: seq + 1,
      instances: { ...state.instances, [iid]: made },
    },
    iid,
  };
}

/** A blank instance carrying no runtime state. */
export function blankInstance(
  defId: CardDefId,
  owner: PlayerId | null,
  zone: Zone,
): Omit<CardInstance, 'iid'> {
  return {
    defId,
    owner,
    zone,
    addedKeywords: [],
    removedKeywords: [],
    counters: {},
    statDelta: {},
    extraEffects: [],
    playedOnTurn: null,
  };
}

const RARITY_RANK: Record<Rarity, number> = {
  token: 0,
  basic: 1,
  common: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
  mythic: 6,
};

export function rarityRank(r: Rarity): number {
  return RARITY_RANK[r] ?? 0;
}

export function maxRarity(rs: readonly Rarity[]): Rarity {
  let best: Rarity = 'common';
  let bestRank = -1;
  for (const r of rs) {
    const rank = rarityRank(r);
    if (rank > bestRank) {
      bestRank = rank;
      best = r;
    }
  }
  return best;
}

const COMPLEXITY_RANK: Record<Complexity, number> = { T1: 1, T2: 2, T3: 3, T4: 4 };

export function maxComplexity(cs: readonly Complexity[]): Complexity {
  let best: Complexity = 'T1';
  for (const c of cs) {
    if ((COMPLEXITY_RANK[c] ?? 1) > (COMPLEXITY_RANK[best] ?? 1)) best = c;
  }
  return best;
}

/** Order-preserving dedupe. */
export function unique<T>(xs: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of xs) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

/** Definition behind an instance, or null when the instance/def is unknown. */
export function defOf(state: GameState, iid: InstanceId): CardDefinition | null {
  const inst = state.instances[iid];
  if (!inst) return null;
  return tryGetCard(inst.defId);
}
