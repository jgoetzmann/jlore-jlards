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

export function lastLog(state: GameState): LogEntry | null {
  return state.log.length ? (state.log[state.log.length - 1] as LogEntry) : null;
}

/** Deterministic id generator for prompts and cost mods. Never uses a clock. */
export function nextIdFor(state: GameState, prefix: string): string {
  return `${prefix}_${state.turn}_${state.logSeq + 1}_${state.rngCursor}`;
}
