/**
 * The `reroll` action (SB-68).
 *
 * A premove is previewed locally on a hypothetical branch of the match. When the
 * active player's turn invalidates one, the premove is discarded, but the
 * preview already showed its outcome: which cards a draw would take off the
 * library, which cards a Discover would offer, which branch a `random` op
 * would pick. Replaying the same action later would show the same thing, so a
 * player could scout their deck by premoving a draw and getting rolled back.
 *
 * A reroll closes that. It moves the rng cursor past every position the
 * dropped preview consumed and reshuffles the actor's library if the preview
 * revealed it. What the player saw then predicts nothing. It is an ordinary
 * active-player action carried in an ordinary intent, so every browser applies
 * the identical shuffle (SB-65) and replay reproduces it (B119).
 *
 * Only the actor's own library: a premove that would reveal anyone else's is
 * refused before it is ever shown, so a reroll never needs to touch another
 * player's library, and must not (it would undo their deliberate placements).
 *
 * The log line carries no detail: which library was shuffled and how far the
 * cursor jumped would tell every opponent what the undone premove revealed.
 *
 * The cost: a reshuffle discards any deliberate top-of-library placement. That
 * only happens after a rollback, and only to the actor's library, when the
 * dropped preview actually revealed it.
 */

import type { GameAction, GameState, PlayerId } from '@engine/types';
import { makeRng } from '@engine/rng';
import { appendLog, logReject } from './log.js';

/** The farthest a reroll may push the cursor past where it stands. */
export const REROLL_MAX_SKIP = 1_000_000;

type RerollAction = Extract<GameAction, { type: 'reroll' }>;

function rejectReroll(s: GameState, action: RerollAction, why: string): GameState {
  return logReject(s, 'illegalReroll', action.player, { why });
}

/**
 * Apply a validated reroll to the draft. The caller (`reduce`) has already
 * checked the game is running, nothing is pending, and the actor is the active
 * player (B20).
 */
export function applyReroll(s: GameState, action: RerollAction): GameState {
  const libs = (action as { libraries?: unknown }).libraries;
  const skipTo = (action as { skipTo?: unknown }).skipTo;

  if (!Array.isArray(libs) || libs.length > s.playerOrder.length * 4) {
    return rejectReroll(s, action, 'libraries');
  }
  const libraries: PlayerId[] = [];
  for (const pid of libs) {
    if (typeof pid !== 'string' || !s.players[pid]) return rejectReroll(s, action, 'unknownPlayer');
    // SB-68: a reroll reshuffles the actor's own library and nobody else's.
    if (pid !== action.player) return rejectReroll(s, action, 'otherLibrary');
    if (!libraries.includes(pid)) libraries.push(pid);
  }
  if (
    typeof skipTo !== 'number' ||
    !Number.isInteger(skipTo) ||
    skipTo < 0 ||
    skipTo > s.rngCursor + REROLL_MAX_SKIP
  ) {
    return rejectReroll(s, action, 'skipTo');
  }

  if (skipTo > s.rngCursor) s.rngCursor = skipTo;
  for (const pid of libraries) {
    const p = s.players[pid];
    if (!p || p.library.length < 2) continue;
    const rng = makeRng(s.seed, s.rngCursor);
    p.library = rng.shuffle(p.library);
    s.rngCursor = rng.cursor();
  }
  return appendLog(s, 'reroll', action.player, {});
}
