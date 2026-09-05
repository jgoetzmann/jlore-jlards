/**
 * S5 engine-meta — internal helpers.
 *
 * Deliberately duplicated inside this slice rather than shared: reconcile keeps
 * whichever copy survives. Nothing here is part of the public meta surface.
 */

import type {
  CardDefId,
  CardInstance,
  GameState,
  InstanceId,
  LogEntry,
  PlayerId,
  PlayerState,
  Zone,
} from '@engine/types';

// ---------------------------------------------------------------------------
// Player copying
// ---------------------------------------------------------------------------

export function clonePlayer(p: PlayerState): PlayerState {
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
    quest: p.quest
      ? {
          floor: p.quest.floor,
          progress: { ...p.quest.progress },
          completedFloors: [...p.quest.completedFloors],
        }
      : null,
    playCounts: { ...p.playCounts },
    counters: { ...p.counters },
  };
}

// ---------------------------------------------------------------------------
// Logging. Never console; always a LogEntry on state.log (B118).
// ---------------------------------------------------------------------------

export function pushLog(
  state: GameState,
  kind: string,
  detail: Record<string, unknown>,
  player: PlayerId | null = null,
): GameState {
  state.logSeq += 1;
  const entry: LogEntry = { seq: state.logSeq, turn: state.turn, player, kind, detail };
  state.log.push(entry);
  return state;
}

// ---------------------------------------------------------------------------
// Deck reads
// ---------------------------------------------------------------------------

/** library + hand + gy + play — a player's "whole deck" for scoring (B17). */
export function deckIidsOf(state: GameState, player: PlayerId): InstanceId[] {
  const p = state.players[player];
  if (!p) return [];
  return [...p.library, ...p.hand, ...p.gy, ...p.play];
}

export function livePlayers(state: GameState): PlayerId[] {
  return state.playerOrder.filter((id) => {
    const p = state.players[id];
    return !!p && !p.eliminated;
  });
}

// ---------------------------------------------------------------------------
// Instance creation. Local so this slice never depends on zone-module shape
// for the one thing it cannot do without (anomaly starting decks).
// ---------------------------------------------------------------------------

export function makeInstance(
  state: GameState,
  defId: CardDefId,
  owner: PlayerId | null,
  zone: Zone,
): { state: GameState; iid: InstanceId } {
  const seq = state.nextInstanceSeq;
  const iid = `i_${String(seq).padStart(4, '0')}`;
  const inst: CardInstance = {
    iid,
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
  return {
    state: { ...state, nextInstanceSeq: seq + 1, instances: { ...state.instances, [iid]: inst } },
    iid,
  };
}

export function withPlayer(
  state: GameState,
  player: PlayerId,
  fn: (p: PlayerState) => PlayerState,
): GameState {
  const cur = state.players[player];
  if (!cur) return state;
  const next = fn(clonePlayer(cur));
  return { ...state, players: { ...state.players, [player]: next } };
}
