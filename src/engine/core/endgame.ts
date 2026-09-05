/**
 * The end of the game.
 *
 * B14 The trigger fires when the absolute empty-pile count is reached, or when
 *     `emptyPileFraction` of the draft piles are empty, whichever comes first,
 *     or when the Jlore pile empties (SB-3).
 * B15 On trigger the engine records `endTriggeredBy` and play continues around
 *     the table. The game ends at the start of that player's next turn, BEFORE
 *     any start-of-turn effect fires.
 */

import type { GameState, PileId, PlayerId } from '@engine/types';
import { checkEndCondition } from '@engine/meta';
import { appendLog } from './log.js';
import { fireTableTriggers, makeContext, runEffects } from './triggers.js';
import { computeScores, determineWinners, endOfGameCards } from './scoring.js';
import { safeDef, topOfPile } from './zones.js';

/** The Jlore pile: the Points pile whose cards are Jlore. */
export function jlorePileId(state: GameState): PileId | null {
  for (const id of state.shop.order.points) {
    if (id === 'jlore' || id.includes('jlore')) return id;
    const top = topOfPile(state, id);
    if (top) {
      const inst = state.instances[top];
      if (inst && inst.defId === 'jlore') return id;
    }
  }
  for (const id of Object.keys(state.shop.piles)) {
    if (id === 'jlore' || id.includes('jlore')) return id;
  }
  return null;
}

export function emptyDraftPiles(state: GameState): number {
  let n = 0;
  for (const id of state.shop.order.draft) {
    const pile = state.shop.piles[id];
    if (pile && pile.cards.length === 0) n += 1;
  }
  return n;
}

/** B14, computed locally so the engine still ends games without the meta slice. */
export function localEndCondition(state: GameState): { ended: boolean; reason: string | null } {
  const wc = state.config.winCondition;

  const jlore = jlorePileId(state);
  if (jlore) {
    const pile = state.shop.piles[jlore];
    if (pile && pile.cards.length === 0) return { ended: true, reason: 'jlorePileEmpty' };
  }

  const draftCount = state.shop.order.draft.length;
  if (draftCount > 0) {
    const empty = emptyDraftPiles(state);
    const absolute = wc.emptyPileAbsolute ?? 4;
    const fractional = Math.ceil(draftCount * (wc.emptyPileFraction ?? 0.4));
    const threshold = Math.max(1, Math.min(absolute, fractional));
    if (empty >= threshold) return { ended: true, reason: 'emptyPiles' };
  }

  if (state.hardEndTurn !== null && state.turn >= state.hardEndTurn) {
    return { ended: true, reason: 'hardEndTurn' };
  }

  const alive = state.playerOrder.filter((pid) => !state.players[pid]?.eliminated);
  if (alive.length <= 1 && state.playerOrder.length > 1) {
    return { ended: true, reason: 'lastPlayerStanding' };
  }

  return { ended: false, reason: null };
}

function evaluateEnd(state: GameState): { ended: boolean; reason: string | null } {
  const local = localEndCondition(state);
  if (local.ended) return local;
  try {
    const meta = checkEndCondition(state);
    if (meta && meta.ended) return { ended: true, reason: meta.reason ?? 'endCondition' };
  } catch {
    /* meta slice unavailable; the local check stands */
  }
  return { ended: false, reason: null };
}

/**
 * B15: record the trigger, do not end the game yet. Play wraps the table and
 * stops when it comes back to `endTriggeredBy`.
 */
export function noteEndCondition(state: GameState, triggerer: PlayerId | null): GameState {
  if (state.ended) return state;
  if (state.endTriggeredBy !== null) return state;
  const res = evaluateEnd(state);
  if (!res.ended) return state;

  // A "last player standing" or hard-turn end is immediate, not a lap of honour.
  if (res.reason === 'lastPlayerStanding' || res.reason === 'hardEndTurn') {
    return finishGame(state, res.reason);
  }

  state.endTriggeredBy = triggerer ?? state.activePlayer;
  state.endReason = res.reason;
  appendLog(state, 'endTriggered', state.endTriggeredBy, { reason: res.reason });
  return state;
}

/**
 * Called at the very top of every turn, before delayed effects, before the stat
 * reset, before any aura or card trigger (B15).
 */
export function endGameIfLapComplete(state: GameState): GameState {
  if (state.ended) return state;
  if (state.endTriggeredBy === null) return state;
  if (state.activePlayer !== state.endTriggeredBy) return state;
  return finishGame(state, state.endReason ?? 'endCondition');
}

/** Terminal. Fires gameEnd windows, scores, and freezes the state. */
export function finishGame(state: GameState, reason: string): GameState {
  if (state.ended) return state;
  let s = state;
  s.endReason = reason;

  // gameEnd delayed effects, then gameEnd triggers, then score.
  for (const pid of s.playerOrder) {
    const p = s.players[pid];
    if (!p) continue;
    const fire = p.delayed.filter((d) => d.when === 'gameEnd');
    p.delayed = p.delayed.filter((d) => d.when !== 'gameEnd');
    for (const d of fire) {
      s = runEffects(s, d.effects, makeContext(pid, d.sourceIid ?? null, 0, 1, {}));
    }
  }
  s = fireTableTriggers(s, 'gameEnd', 0);

  s.ended = true;
  s.pending = null;
  s.queue = [];

  const scores = computeScores(s);
  s.winners = determineWinners(s, scores);

  const detail: Record<string, unknown> = { reason, scores, winners: s.winners };
  for (const pid of s.playerOrder) {
    detail[`eog:${pid}`] = endOfGameCards(s, pid);
  }
  appendLog(s, 'gameEnd', null, detail);
  return s;
}

/** Convenience for effects that end the game outright ({op:'endGame'}). */
export function endGameNow(state: GameState, reason: string): GameState {
  return finishGame(state, reason);
}
