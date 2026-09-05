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
  Stats,
  Zone,
} from '@engine/types';

// ---------------------------------------------------------------------------
// Cloning. `reduce` is pure, so every meta entry point returns a fresh state.
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

export function cloneInstance(i: CardInstance): CardInstance {
  const out: CardInstance = {
    ...i,
    addedKeywords: [...i.addedKeywords],
    removedKeywords: [...i.removedKeywords],
    counters: { ...i.counters },
    statDelta: { ...i.statDelta },
    extraEffects: [...i.extraEffects],
    playedOnTurn: i.playedOnTurn,
  };
  if (i.fusedFrom) out.fusedFrom = [...i.fusedFrom];
  if (i.secret) out.secret = { ...i.secret };
  return out;
}

export function cloneState(state: GameState): GameState {
  const players: Record<PlayerId, PlayerState> = {};
  for (const id of Object.keys(state.players)) players[id] = clonePlayer(state.players[id]);

  const instances: Record<InstanceId, CardInstance> = {};
  for (const iid of Object.keys(state.instances)) instances[iid] = cloneInstance(state.instances[iid]);

  const piles: GameState['shop']['piles'] = {};
  for (const pid of Object.keys(state.shop.piles)) {
    const p = state.shop.piles[pid];
    piles[pid] = {
      ...p,
      cards: [...p.cards],
      locks: p.locks.map((l) => ({ ...l })),
      costMods: p.costMods.map((m) => ({ ...m })),
    };
  }

  const variants: GameState['variants'] = {};
  for (const d of Object.keys(state.variants)) {
    const v = state.variants[d];
    variants[d] = { ...v, statDelta: { ...v.statDelta } };
  }

  return {
    ...state,
    playerOrder: [...state.playerOrder],
    players,
    instances,
    variants,
    shop: {
      piles,
      order: {
        resource: [...state.shop.order.resource],
        points: [...state.shop.order.points],
        prophet: [...state.shop.order.prophet],
        draft: [...state.shop.order.draft],
      },
      globalCostMods: state.shop.globalCostMods.map((m) => ({ ...m })),
    },
    config: { ...state.config, winCondition: { ...state.config.winCondition } },
    queue: state.queue.map((q) => ({ ...q, vars: { ...q.vars } })),
    log: [...state.log],
    winners: state.winners ? [...state.winners] : null,
    defsInMatch: [...state.defsInMatch],
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
  const seq = state.logSeq + 1;
  const entry: LogEntry = { seq, turn: state.turn, player, kind, detail };
  return { ...state, log: [...state.log, entry], logSeq: seq };
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

export function addStats(a: Stats, b: Stats): Stats {
  return {
    money: (a.money ?? 0) + (b.money ?? 0),
    buys: (a.buys ?? 0) + (b.buys ?? 0),
    actions: (a.actions ?? 0) + (b.actions ?? 0),
    cards: (a.cards ?? 0) + (b.cards ?? 0),
    vp: (a.vp ?? 0) + (b.vp ?? 0),
    prophet: (a.prophet ?? 0) + (b.prophet ?? 0),
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
