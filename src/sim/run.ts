/**
 * Headless match runner.
 *
 * B112: a match runs to a terminal state and never exceeds 500 turns.
 * B113: the same (seed, playerCount) always yields an identical MatchResult —
 *       nothing here reads a clock, an env var, or Math.random.
 * B115: per-card buy counts and Discover offered/picked counts survive into the
 *       result so `aggregate` can sum them across matches.
 * B116: the terminal state's end reason lands in `endReason`.
 */

import type {
  AnomalyId,
  CardDefId,
  GameAction,
  GameState,
  InstanceId,
  MatchConfig,
  PileId,
  PlayerId,
  Prompt,
  WinConditionKind,
} from '@engine/types';
import { createMatch, finalScores, isGameOver, reduce } from '@engine/index';
import { botAction } from './bot';

/** Hard turn ceiling for a simulated match (B112). */
export const MAX_TURNS = 500;

/** Belt-and-braces ceiling on reduce calls, so a livelock cannot hang a run. */
export const MAX_STEPS = 200000;

export interface MatchResult {
  seed: number;
  turns: number;
  winners: PlayerId[];
  scores: Record<PlayerId, number>;
  anomaly: AnomalyId | null;
  endReason: string;
  buysByCard: Record<CardDefId, number>;
  discoverOffered: Record<CardDefId, number>;
  discoverPicked: Record<CardDefId, number>;
}

/**
 * Everything the balance report wants that does not fit the frozen MatchResult
 * shape. `simulateMatch` returns one of these behind a `MatchResult` type, so
 * telemetry can read the extras defensively without widening the spec surface.
 */
export interface DetailedMatchResult extends MatchResult {
  playerCount: number;
  winCondition: WinConditionKind;
  /** Turn number of the first purchase of each card, across all players. */
  firstBuyTurn: Record<CardDefId, number>;
  /** Buys made specifically by players who went on to win. */
  winnerBuys: Record<CardDefId, number>;
  buysByPlayer: Record<PlayerId, Record<CardDefId, number>>;
  /** Every action fed to reduce, in order. Replayable via `replay`. */
  actions: GameAction[];
  steps: number;
  /** True when the 500-turn ceiling stopped the match rather than a rule. */
  cappedOut: boolean;
}

export const DEFAULT_SIM_CONFIG: MatchConfig = {
  playerCount: 2,
  draftPileCount: 10,
  anomalyChance: 0.25,
  winCondition: {
    kind: 'standard',
    emptyPileFraction: 0.4,
    emptyPileAbsolute: 4,
    x: null,
  },
  pileSizeScale: 1,
  effectNodeBudget: 500,
  recursionDepth: 8,
  turnSeconds: 60,
  seedCodexWithCommons: true,
};

export function simConfig(playerCount: number, overrides?: Partial<MatchConfig>): MatchConfig {
  const base = DEFAULT_SIM_CONFIG;
  const win = overrides && overrides.winCondition ? overrides.winCondition : base.winCondition;
  return {
    playerCount,
    draftPileCount: overrides && overrides.draftPileCount !== undefined ? overrides.draftPileCount : base.draftPileCount,
    anomalyChance: overrides && overrides.anomalyChance !== undefined ? overrides.anomalyChance : base.anomalyChance,
    winCondition: {
      kind: win.kind,
      emptyPileFraction: win.emptyPileFraction,
      emptyPileAbsolute: win.emptyPileAbsolute,
      x: win.x,
    },
    pileSizeScale: overrides && overrides.pileSizeScale !== undefined ? overrides.pileSizeScale : base.pileSizeScale,
    effectNodeBudget:
      overrides && overrides.effectNodeBudget !== undefined ? overrides.effectNodeBudget : base.effectNodeBudget,
    recursionDepth: overrides && overrides.recursionDepth !== undefined ? overrides.recursionDepth : base.recursionDepth,
    turnSeconds: overrides && overrides.turnSeconds !== undefined ? overrides.turnSeconds : base.turnSeconds,
    seedCodexWithCommons:
      overrides && overrides.seedCodexWithCommons !== undefined
        ? overrides.seedCodexWithCommons
        : base.seedCodexWithCommons,
  };
}

export function simPlayers(playerCount: number): { id: PlayerId; name: string; codex: CardDefId[] }[] {
  const out: { id: PlayerId; name: string; codex: CardDefId[] }[] = [];
  for (let i = 0; i < playerCount; i++) {
    out.push({ id: 'p' + (i + 1), name: 'Bot ' + (i + 1), codex: [] });
  }
  return out;
}

function bump(map: Record<string, number>, key: string, by: number): void {
  map[key] = (map[key] === undefined ? 0 : map[key]) + by;
}

function pileTopIid(state: GameState, pileId: PileId): InstanceId | null {
  const shop = state.shop;
  const pile = shop && shop.piles ? shop.piles[pileId] : undefined;
  if (!pile || !pile.cards || pile.cards.length === 0) return null;
  return pile.cards[0];
}

function deckSize(state: GameState, id: PlayerId): number {
  const p = state.players ? state.players[id] : undefined;
  if (!p) return 0;
  return (
    (p.library ? p.library.length : 0) +
    (p.hand ? p.hand.length : 0) +
    (p.gy ? p.gy.length : 0) +
    (p.play ? p.play.length : 0)
  );
}

/**
 * B16 tiebreak, used only when the engine did not already name winners:
 * most VP, then fewest turns taken, then smallest deck, then a shared win.
 */
export function pickWinners(
  state: GameState,
  scores: Record<PlayerId, number>,
  turnsTaken: Record<PlayerId, number>,
): PlayerId[] {
  const ids = (state.playerOrder && state.playerOrder.length > 0 ? state.playerOrder : Object.keys(scores)).filter(
    (id) => {
      const p = state.players ? state.players[id] : undefined;
      return !p || !p.eliminated;
    },
  );
  const pool = ids.length > 0 ? ids : Object.keys(scores);
  if (pool.length === 0) return [];
  let best: PlayerId[] = [];
  let bestKey: [number, number, number] | null = null;
  for (const id of pool) {
    const key: [number, number, number] = [
      scores[id] === undefined ? 0 : scores[id],
      -(turnsTaken[id] === undefined ? 0 : turnsTaken[id]),
      -deckSize(state, id),
    ];
    if (bestKey === null) {
      bestKey = key;
      best = [id];
      continue;
    }
    const cmp =
      key[0] !== bestKey[0] ? key[0] - bestKey[0] : key[1] !== bestKey[1] ? key[1] - bestKey[1] : key[2] - bestKey[2];
    if (cmp > 0) {
      bestKey = key;
      best = [id];
    } else if (cmp === 0) {
      best.push(id);
    }
  }
  return best;
}

/**
 * Full instrumented run. `simulateMatch` is the spec-shaped face of this.
 */
export function simulateMatchDetailed(
  seed: number,
  playerCount: number,
  config?: Partial<MatchConfig>,
): DetailedMatchResult {
  const cfg = simConfig(playerCount, config);
  const players = simPlayers(playerCount);

  let state: GameState = createMatch(cfg, players, seed);

  const buysByCard: Record<CardDefId, number> = {};
  const discoverOffered: Record<CardDefId, number> = {};
  const discoverPicked: Record<CardDefId, number> = {};
  const firstBuyTurn: Record<CardDefId, number> = {};
  const buysByPlayer: Record<PlayerId, Record<CardDefId, number>> = {};
  const turnsTaken: Record<PlayerId, number> = {};
  const actions: GameAction[] = [];
  for (const p of players) {
    buysByPlayer[p.id] = {};
    turnsTaken[p.id] = 0;
  }

  // A prompt is "offered" the first time we see its id in state.pending.
  const seenPrompts: Record<string, boolean> = {};
  const recordOffer = (prompt: Prompt | null): void => {
    if (!prompt || seenPrompts[prompt.id]) return;
    seenPrompts[prompt.id] = true;
    if (prompt.type !== 'discover') return;
    const opts = prompt.options ? prompt.options : [];
    for (const o of opts) {
      if (o.defId) bump(discoverOffered, o.defId, 1);
    }
  };
  recordOffer(state.pending);

  let steps = 0;
  let stalled = 0;
  let lastActive = state.activePlayer;
  turnsTaken[lastActive] = (turnsTaken[lastActive] === undefined ? 0 : turnsTaken[lastActive]) + 1;
  let cappedOut = false;

  while (!isGameOver(state) && !state.ended) {
    if (state.turn > MAX_TURNS) {
      cappedOut = true;
      break;
    }
    if (steps >= MAX_STEPS) {
      cappedOut = true;
      break;
    }

    const actor: PlayerId = state.pending ? state.pending.player : state.activePlayer;
    const action = botAction(state, actor);

    // Pre-reduce snapshots for instrumentation.
    let boughtIid: InstanceId | null = null;
    if (action.type === 'buy') boughtIid = pileTopIid(state, action.pileId);
    const pendingBefore = state.pending;

    const next = reduce(state, action);
    actions.push(action);
    steps++;

    if (action.type === 'buy' && boughtIid) {
      const inst = next.instances ? next.instances[boughtIid] : undefined;
      // The buy landed only if the instance actually left the shop pile.
      if (inst && inst.zone !== 'shop') {
        bump(buysByCard, inst.defId, 1);
        const owner = inst.owner ? inst.owner : action.player;
        if (!buysByPlayer[owner]) buysByPlayer[owner] = {};
        bump(buysByPlayer[owner], inst.defId, 1);
        if (firstBuyTurn[inst.defId] === undefined) firstBuyTurn[inst.defId] = state.turn;
      }
    }

    if (
      action.type === 'resolve' &&
      pendingBefore &&
      pendingBefore.id === action.promptId &&
      pendingBefore.type === 'discover' &&
      (!next.pending || next.pending.id !== pendingBefore.id)
    ) {
      const byKey: Record<string, string | undefined> = {};
      const opts = pendingBefore.options ? pendingBefore.options : [];
      for (const o of opts) byKey[o.key] = o.defId;
      for (const k of action.keys ? action.keys : []) {
        const defId = byKey[k];
        if (defId) bump(discoverPicked, defId, 1);
      }
    }

    recordOffer(next.pending);

    // Livelock guard: reduce rejected everything and nothing moved.
    if (next.logSeq === state.logSeq && next.turn === state.turn && next.rngCursor === state.rngCursor) {
      stalled++;
      if (stalled > 8) {
        const forced: GameAction = { type: 'endTurn', player: state.activePlayer };
        const forcedNext = reduce(next, forced);
        actions.push(forced);
        steps++;
        stalled = 0;
        if (forcedNext.turn === next.turn && forcedNext.logSeq === next.logSeq) {
          state = forcedNext;
          cappedOut = true;
          break;
        }
        state = forcedNext;
        if (state.activePlayer !== lastActive) {
          lastActive = state.activePlayer;
          turnsTaken[lastActive] = (turnsTaken[lastActive] === undefined ? 0 : turnsTaken[lastActive]) + 1;
        }
        continue;
      }
    } else {
      stalled = 0;
    }

    state = next;
    if (state.activePlayer !== lastActive) {
      lastActive = state.activePlayer;
      turnsTaken[lastActive] = (turnsTaken[lastActive] === undefined ? 0 : turnsTaken[lastActive]) + 1;
    }
  }

  const scores = finalScores(state);
  const winners = state.winners && state.winners.length > 0 ? state.winners : pickWinners(state, scores, turnsTaken);

  const winnerBuys: Record<CardDefId, number> = {};
  for (const w of winners) {
    const owned = buysByPlayer[w];
    if (!owned) continue;
    for (const defId of Object.keys(owned)) bump(winnerBuys, defId, owned[defId]);
  }

  const endReason = state.endReason ? state.endReason : cappedOut ? 'turnCap' : 'unknown';

  return {
    seed,
    turns: state.turn,
    winners,
    scores,
    anomaly: state.anomaly === undefined ? null : state.anomaly,
    endReason,
    buysByCard,
    discoverOffered,
    discoverPicked,
    playerCount,
    winCondition: cfg.winCondition.kind,
    firstBuyTurn,
    winnerBuys,
    buysByPlayer,
    actions,
    steps,
    cappedOut,
  };
}

/** Spec surface (B112, B113, B116). */
export function simulateMatch(seed: number, playerCount: number, config?: Partial<MatchConfig>): MatchResult {
  return simulateMatchDetailed(seed, playerCount, config);
}

/** Spec surface (B115). Seeds are 1..count so a run is reproducible by count alone. */
export function simulateMany(count: number, playerCount: number): MatchResult[] {
  const out: MatchResult[] = [];
  for (let i = 0; i < count; i++) out.push(simulateMatch(i + 1, playerCount));
  return out;
}

/** Same runs, instrumented, for the balance report. */
export function simulateManyDetailed(
  count: number,
  playerCount: number,
  startSeed: number,
  config?: Partial<MatchConfig>,
): DetailedMatchResult[] {
  const out: DetailedMatchResult[] = [];
  for (let i = 0; i < count; i++) out.push(simulateMatchDetailed(startSeed + i, playerCount, config));
  return out;
}
