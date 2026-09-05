/**
 * The match log. B118: every state change appends at least one LogEntry with a
 * monotonically increasing `seq`. Nothing in the engine ever writes to console.
 */

import type { GameState, LogEntry, PlayerId } from '@engine/types';

/** Appends to the draft state in place and returns it, for chaining. */
export function appendLog(
  state: GameState,
  kind: string,
  player: PlayerId | null,
  detail: Record<string, unknown> = {},
): GameState {
  state.logSeq = (state.logSeq ?? 0) + 1;
  const entry: LogEntry = {
    seq: state.logSeq,
    turn: state.turn,
    player,
    kind,
    detail,
  };
  state.log.push(entry);
  return state;
}

/** A rejection is still a state change in the log's eyes: it records the refusal. */
export function logReject(
  state: GameState,
  reason: string,
  player: PlayerId | null,
  detail: Record<string, unknown> = {},
): GameState {
  return appendLog(state, 'reject', player, { reason, ...detail });
}
