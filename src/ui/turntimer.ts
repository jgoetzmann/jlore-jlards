/**
 * The turn timer, as rules the table can test without a browser (SB-67).
 *
 * The clock used to be a readout and nothing more: at 0:00 it stopped, the turn
 * never passed, and a table waiting on somebody who had stepped away looked
 * frozen for everyone. Expiry now acts, through the same two actions a player
 * would send, so every browser folds exactly the same thing (SB-65):
 *
 *   1. An open prompt is answered with its own `defaultKeys` — the timeout
 *      path the engine already documents (core/resume.ts) — by the browser
 *      that controls the prompt's owner.
 *   2. With nothing pending, the active player's turn is ended, by the browser
 *      that controls the active seat. The engine refuses an `endTurn` from
 *      anybody else (notActivePlayer), so no other browser may send one.
 *
 * `config.turnSeconds` already includes Time Flail — the engine divides it once
 * at setup (SB-36) — and 0 means the match plays without a timer.
 */

import type { GameAction, GameState, PlayerId } from '@engine/types';

/** Seconds a turn lasts, or 0 for no timer. Anything unusable reads as "no timer". */
export function timerLimitSeconds(turnSeconds: number | null | undefined): number {
  if (typeof turnSeconds !== 'number' || !Number.isFinite(turnSeconds) || turnSeconds <= 0) return 0;
  return Math.round(turnSeconds);
}

/** One turn's identity. The clock restarts whenever this changes. */
export function turnKey(state: Pick<GameState, 'turn' | 'activePlayer'>): string {
  return `${state.turn}:${state.activePlayer}`;
}

export interface TimeoutMove {
  /** Sent at most once per key, so an answer the engine refuses cannot loop. */
  key: string;
  /** Who acts. The caller sends as the seat bound to them. */
  player: PlayerId;
  action: GameAction;
}

/**
 * What this browser should send now that the turn is out of time, or null.
 *
 * `controls(pid)` says whether this browser acts for that player: every seat in
 * hotseat, only your own seat in a room. `done` holds the keys already sent.
 */
export function timeoutMove(
  state: Pick<GameState, 'turn' | 'activePlayer' | 'pending' | 'ended'>,
  controls: (player: PlayerId) => boolean,
  done: ReadonlySet<string> = new Set(),
): TimeoutMove | null {
  if (state.ended) return null;
  const pending = state.pending;
  if (pending) {
    // Nobody can end a turn over an open prompt, so it is answered first, by
    // whoever owns it, with the pick the prompt itself names for a timeout.
    const key = `resolve:${pending.id}`;
    if (!controls(pending.player) || done.has(key)) return null;
    return {
      key,
      player: pending.player,
      action: { type: 'resolve', player: pending.player, promptId: pending.id, keys: [...pending.defaultKeys] },
    };
  }
  const key = `end:${turnKey(state)}`;
  if (!controls(state.activePlayer) || done.has(key)) return null;
  return { key, player: state.activePlayer, action: { type: 'endTurn', player: state.activePlayer } };
}
