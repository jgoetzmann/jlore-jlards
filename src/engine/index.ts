/**
 * The engine's public surface.
 *
 * `reduce` is pure: the same (state, action) always yields the same result, it
 * performs no I/O, reads no clock, and uses no unseeded randomness. All of it
 * comes from `state.seed` + `state.rngCursor` and the returned state carries the
 * advanced cursor (SB-31).
 *
 * B2  The input state is deep-cloned at entry and never mutated.
 * B18 A play with no Actions left is rejected, state unchanged.
 * B19 An unaffordable buy is rejected, state unchanged.
 * B20 An action from a non-active player is rejected, state unchanged.
 * B25 `legalActions` never offers something this function rejects.
 * B118 Every branch appends at least one LogEntry.
 * B119 Replaying the logged actions from `createMatch` reproduces the state.
 *
 * Nothing here ever throws across the boundary: an unexpected error is caught,
 * logged onto a clean copy of the input state, and returned.
 */

import type { GameAction, GameState, PlayerId } from '@engine/types';
import { cloneState } from './core/clone.js';
import { appendLog, logReject } from './core/log.js';
import { createMatch as createMatchImpl } from './core/setup.js';
import { legalActions as legalActionsImpl, isHandPermutation } from './core/actions.js';
import { canPlayCard, playCard } from './core/play.js';
import { canBuyPile, buyCard } from './core/buy.js';
import { canActivateAura, activateAura } from './core/aura.js';
import { endTurn as endTurnImpl, advanceTurn, startTurn } from './core/turn.js';
import { drainQueue, resolvePrompt } from './core/resume.js';
import { finishGame, noteEndCondition } from './core/endgame.js';
import { computeScores } from './core/scoring.js';

export { createMatch } from './core/setup.js';
export { legalActions } from './core/actions.js';

function actorOf(action: GameAction): PlayerId | null {
  if (action.type === 'start') return null;
  return action.player;
}

export function isGameOver(state: GameState): boolean {
  return state.ended === true;
}

export function finalScores(state: GameState): Record<PlayerId, number> {
  return computeScores(state);
}

// ---------------------------------------------------------------------------
// reduce
// ---------------------------------------------------------------------------

export function reduce(state: GameState, action: GameAction): GameState {
  if (action && action.type === 'start') {
    return createMatchImpl(action.config, action.players, action.seed, action.anomaly);
  }

  const draft = cloneState(state);
  try {
    return dispatch(draft, action);
  } catch (err) {
    const safe = cloneState(state);
    logReject(safe, 'engineError', actorOf(action), {
      action: action?.type ?? 'unknown',
      message: String(err),
    });
    return safe;
  }
}

function dispatch(s: GameState, action: GameAction): GameState {
  const actor = actorOf(action);

  if (!action || typeof action.type !== 'string') {
    return logReject(s, 'malformedAction', null, {});
  }

  // `start` is answered by `reduce` before a draft ever exists, so it cannot
  // reach here. Rejecting it explicitly also narrows the union: `start` is the
  // one variant with no `player`, and every branch below reads `action.player`.
  if (action.type === 'start') {
    return logReject(s, 'unexpectedStart', null, { action: action.type });
  }

  if (s.ended) {
    return logReject(s, 'gameOver', actor, { action: action.type });
  }

  // A pending prompt freezes the table. Only its own answer gets through, and
  // it may come from a player who is not the active player.
  if (s.pending) {
    if (action.type !== 'resolve') {
      return logReject(s, 'promptPending', actor, {
        action: action.type,
        waitingOn: s.pending.player,
      });
    }
    if (action.player !== s.pending.player) {
      return logReject(s, 'notYourPrompt', actor, { waitingOn: s.pending.player });
    }
    if (action.promptId !== s.pending.id) {
      return logReject(s, 'stalePrompt', actor, { promptId: action.promptId });
    }
    let next = resolvePrompt(s, action.player, action.promptId, action.keys ?? []);
    next = noteEndCondition(next, next.activePlayer);
    return next;
  }

  if (action.type === 'resolve') {
    return logReject(s, 'noPrompt', actor, { promptId: action.promptId });
  }

  // B20: only the active player may act.
  if (action.player !== s.activePlayer) {
    return logReject(s, 'notActivePlayer', actor, {
      action: action.type,
      activePlayer: s.activePlayer,
    });
  }

  const p = s.players[action.player];
  if (!p) return logReject(s, 'unknownPlayer', actor, {});
  if (p.eliminated) return logReject(s, 'eliminated', actor, { action: action.type });

  switch (action.type) {
    case 'play': {
      // B18 / B73: no Actions left, or not in hand.
      if (!canPlayCard(s, action.player, action.iid)) {
        return logReject(s, 'illegalPlay', actor, {
          iid: action.iid,
          actions: p.actions,
        });
      }
      let next = playCard(s, action.player, action.iid, {});
      next = drainQueue(next);
      next = noteEndCondition(next, action.player);
      return next;
    }

    case 'buy': {
      // B19 / B50: unaffordable, locked, or empty.
      if (!canBuyPile(s, action.player, action.pileId)) {
        return logReject(s, 'illegalBuy', actor, {
          pileId: action.pileId,
          money: p.money,
          buys: p.buys,
          prophet: p.prophet,
        });
      }
      let next = buyCard(s, action.player, action.pileId);
      next = drainQueue(next);
      next = noteEndCondition(next, action.player);
      return next;
    }

    case 'activateAura': {
      if (!canActivateAura(s, action.player, action.auraId)) {
        return logReject(s, 'illegalAuraActivation', actor, {
          auraId: action.auraId,
          money: p.money,
        });
      }
      let next = activateAura(s, action.player, action.auraId);
      next = drainQueue(next);
      return next;
    }

    case 'reorderHand': {
      // B13: hand order is real, and this permutes it.
      if (!isHandPermutation(s, action.player, action.hand)) {
        return logReject(s, 'illegalHandOrder', actor, { given: action.hand.length });
      }
      p.hand = [...action.hand];
      return appendLog(s, 'reorderHand', action.player, { hand: action.hand });
    }

    case 'endTurn': {
      let next = endTurnImpl(s);
      next = drainQueue(next);
      return next;
    }

    case 'concede': {
      p.eliminated = true;
      appendLog(s, 'concede', action.player, {});
      const alive = s.playerOrder.filter((id) => !s.players[id]?.eliminated);
      if (alive.length <= 1) {
        return finishGame(s, 'concession');
      }
      let next = advanceTurn(s);
      next = startTurn(next);
      return next;
    }

    default: {
      const unknown = action as { type?: unknown };
      return logReject(s, 'unknownAction', actor, { action: String(unknown.type) });
    }
  }
}

// Re-exported for slices that want the same primitives the reducer uses.
export { legalActionsImpl as legalActionsFor };
