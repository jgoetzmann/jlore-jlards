/**
 * Replay support (B119).
 *
 * A match is fully described by `(seed, config, players, actionLog)`: feeding
 * the logged actions back through `reduce` from `createMatch` reproduces the
 * final state exactly, because `reduce` is pure and every random draw comes from
 * `state.seed` + `state.rngCursor`.
 *
 * That makes a playtest bug report two values instead of a save file, and lets
 * animation timing be re-run against a fixed match as many times as needed.
 */

import type { GameAction, GameState, InstanceId, LogEntry, MatchConfig, PlayerId, CardDefId } from '@engine/types';
import { createMatch, isGameOver, reduce } from '@engine/index';

/**
 * Rebuild the final state of a match from its seed and its action log.
 *
 * `start` actions in the log are skipped: `createMatch` already performed the
 * setup they describe, and replaying one would reset the match mid-stream.
 */
export function replay(
  seed: number,
  config: MatchConfig,
  players: { id: PlayerId; name: string; codex: CardDefId[] }[],
  actions: GameAction[],
): GameState {
  let state: GameState = createMatch(config, players, seed);
  for (const action of actions) {
    if (!action || action.type === 'start') continue;
    if (state.ended || isGameOver(state)) break;
    state = reduce(state, action);
  }
  return state;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function strArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') return null;
    out.push(x);
  }
  return out;
}

const ACTION_TYPES: Record<string, boolean> = {
  start: true,
  play: true,
  buy: true,
  activateAura: true,
  reorderHand: true,
  endTurn: true,
  resolve: true,
  concede: true,
};

/**
 * Decode one log entry back into the action that produced it.
 *
 * Two shapes are accepted, because the engine may log either: an entry whose
 * `detail.action` is the whole action object, or an entry whose `kind` names the
 * action and whose `detail` carries its fields. Anything else yields null and is
 * skipped — log entries that describe consequences rather than inputs are not
 * actions and must not be replayed.
 */
export function actionFromLog(entry: LogEntry): GameAction | null {
  if (!entry) return null;
  const detail: Record<string, unknown> = entry.detail ? entry.detail : {};

  const embedded = detail.action;
  if (embedded && typeof embedded === 'object') {
    const t = str((embedded as Record<string, unknown>).type);
    if (t && ACTION_TYPES[t]) return embedded as GameAction;
  }

  const player: PlayerId = entry.player ? entry.player : (str(detail.player) as PlayerId) || '';
  switch (entry.kind) {
    case 'play':
    case 'playCard': {
      const iid = str(detail.iid) || str(detail.instance);
      if (!iid || !player) return null;
      return { type: 'play', player, iid: iid as InstanceId };
    }
    case 'buy':
    case 'buyCard': {
      const pileId = str(detail.pileId) || str(detail.pile);
      if (!pileId || !player) return null;
      return { type: 'buy', player, pileId };
    }
    case 'activateAura': {
      const auraId = str(detail.auraId) || str(detail.aura);
      if (!auraId || !player) return null;
      return { type: 'activateAura', player, auraId };
    }
    case 'reorderHand': {
      const hand = strArray(detail.hand);
      if (!hand || !player) return null;
      return { type: 'reorderHand', player, hand: hand as InstanceId[] };
    }
    case 'endTurn': {
      if (!player) return null;
      return { type: 'endTurn', player };
    }
    case 'resolve': {
      const promptId = str(detail.promptId) || str(detail.prompt);
      const keys = strArray(detail.keys);
      if (!promptId || !keys || !player) return null;
      return { type: 'resolve', player, promptId, keys };
    }
    case 'concede': {
      if (!player) return null;
      return { type: 'concede', player };
    }
    default:
      return null;
  }
}

/**
 * Pull the replayable action list out of a finished (or in-progress) state.
 *
 * Entries are read in `seq` order so a log that was appended out of order still
 * replays in the order the engine actually applied.
 */
export function extractActions(state: GameState): GameAction[] {
  const log: LogEntry[] = state && state.log ? state.log.slice() : [];
  log.sort((a, b) => a.seq - b.seq);
  const out: GameAction[] = [];
  for (const entry of log) {
    const action = actionFromLog(entry);
    if (action && action.type !== 'start') out.push(action);
  }
  return out;
}

/**
 * Convenience for a bug report: replay a state's own log and hand back both the
 * reconstructed state and the actions used, so a caller can diff them.
 */
export function replayState(
  state: GameState,
  players: { id: PlayerId; name: string; codex: CardDefId[] }[],
): { state: GameState; actions: GameAction[] } {
  const actions = extractActions(state);
  return { state: replay(state.seed, state.config, players, actions), actions };
}
