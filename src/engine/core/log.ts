/**
 * The match log. B118: every state change appends at least one LogEntry with a
 * monotonically increasing `seq`. Nothing in the engine ever writes to console.
 */

import type { GameState, LogEntry, PlayerId } from '@engine/types';
import { deepClone } from '@engine/core/clone';

/**
 * The one way a LogEntry is built. Every write path (appendLog here, meta/util.ts
 * pushLog, systems/internal.ts pushLog, shop/util.ts appendLog) goes through it.
 *
 * `detail` is deep-copied. cloneState shares LogEntry objects between states
 * (ENGINE-1), so an entry must own everything it points at. Call sites routinely
 * hand in live objects: reorderHand passed the caller's `action.hand`,
 * nextCardModifier the same mod object it pushes onto `nextCardMods`, gameEnd
 * `state.winners`. Without the copy, a later write to one of those would change
 * the log in every state that shares the entry. Details are a handful of fields,
 * so this costs far less than the per-reduce deep clone of the whole log that
 * sharing replaced.
 */
export function makeLogEntry(
  seq: number,
  turn: number,
  player: PlayerId | null,
  kind: string,
  detail: Record<string, unknown>,
): LogEntry {
  return { seq, turn, player, kind, detail: deepClone(detail) };
}

/** Appends to the draft state in place and returns it, for chaining. */
export function appendLog(
  state: GameState,
  kind: string,
  player: PlayerId | null,
  detail: Record<string, unknown> = {},
): GameState {
  state.logSeq = (state.logSeq ?? 0) + 1;
  state.log.push(makeLogEntry(state.logSeq, state.turn, player, kind, detail));
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
