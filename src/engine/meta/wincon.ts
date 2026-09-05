/**
 * S-ENDGAME — `checkEndCondition` (B14, B86, B87, B88, B91, SB-3, SB-9).
 *
 * Four win conditions, all of which also end when the Jlore pile empties:
 *
 *   standard  — 4 draft piles empty OR `emptyPileFraction` of them, first wins.
 *   countdown — `x` turns, default `12 × playerCount`.
 *   duel      — a player leads by `x` VP, default 15.
 *   crown     — a player reaches `x` VP, default 30.
 *
 * Plus the overrides any card or anomaly may set: `state.hardEndTurn`,
 * `state.doomsdayCounter >= 10`, and Battle Royale's last-player-standing.
 */

import type { GameState, PileId, PlayerId } from '@engine/types';
import { livePlayers } from './util.js';
import { liveVp } from './scoring.js';

export const JLORE_PILE_ID: PileId = 'jlore';
export const DOOMSDAY_LIMIT = 10;

/** SB-9 defaults for the deliberate variants. */
export const COUNTDOWN_TURNS_PER_PLAYER = 12;
export const DUEL_DEFAULT_LEAD = 15;
export const CROWN_DEFAULT_TARGET = 30;

export interface EndCheck {
  ended: boolean;
  reason: string | null;
}

const NOT_ENDED: EndCheck = { ended: false, reason: null };

function pileIsEmpty(state: GameState, pileId: PileId): boolean {
  const pile = state.shop.piles[pileId];
  if (!pile) return true;
  return pile.cards.length === 0;
}

/** The Jlore pile emptying ends every variant. */
export function jloreEmpty(state: GameState): boolean {
  const direct = state.shop.piles[JLORE_PILE_ID];
  if (direct) return direct.cards.length === 0;
  // Fall back to finding it by the instances sitting in the points shop.
  for (const pileId of state.shop.order.points) {
    const pile = state.shop.piles[pileId];
    if (!pile) continue;
    const top = pile.cards[0];
    const defId = top ? state.instances[top]?.defId : undefined;
    if (pileId.includes('jlore') || defId === 'jlore') return pile.cards.length === 0;
  }
  return false;
}

export function emptyDraftPiles(state: GameState): number {
  return state.shop.order.draft.filter((id) => pileIsEmpty(state, id)).length;
}

/** SB-3: absolute count and fraction both apply, whichever fires first. */
export function standardPileTrigger(state: GameState): boolean {
  const draft = state.shop.order.draft;
  const total = draft.length;
  if (total === 0) return false;
  const empty = emptyDraftPiles(state);
  const wc = state.config.winCondition;
  const absolute = wc.emptyPileAbsolute === null ? 4 : wc.emptyPileAbsolute;
  if (empty >= absolute) return true;
  const fraction = wc.emptyPileFraction > 0 ? wc.emptyPileFraction : 0.4;
  return empty >= Math.ceil(fraction * total);
}

export function countdownTarget(state: GameState): number {
  const x = state.config.winCondition.x;
  if (x !== null && x !== undefined) return x;
  return COUNTDOWN_TURNS_PER_PLAYER * Math.max(1, state.config.playerCount);
}

export function duelTarget(state: GameState): number {
  const x = state.config.winCondition.x;
  return x === null || x === undefined ? DUEL_DEFAULT_LEAD : x;
}

export function crownTarget(state: GameState): number {
  const x = state.config.winCondition.x;
  return x === null || x === undefined ? CROWN_DEFAULT_TARGET : x;
}

/** VP lead of the front-runner over the best of everyone else. */
export function vpLead(state: GameState): { player: PlayerId | null; lead: number; top: number } {
  const alive = livePlayers(state);
  if (alive.length === 0) return { player: null, lead: 0, top: 0 };
  const scored = alive.map((id) => ({ id, vp: liveVp(state, id) }));
  scored.sort((a, b) => (b.vp - a.vp) || (a.id < b.id ? -1 : 1));
  const top = scored[0];
  if (scored.length === 1) return { player: top.id, lead: top.vp, top: top.vp };
  return { player: top.id, lead: top.vp - scored[1].vp, top: top.vp };
}

/** B91 / SPEC surface. */
export function checkEndCondition(state: GameState): EndCheck {
  if (state.ended) return { ended: true, reason: state.endReason ?? 'ended' };

  // Overrides first: a card or anomaly that set one wins over the variant.
  if (state.doomsdayCounter >= DOOMSDAY_LIMIT) {
    return { ended: true, reason: 'doomsday' };
  }
  if (state.hardEndTurn !== null && state.turn >= state.hardEndTurn) {
    return { ended: true, reason: state.anomaly === 'deaths_door' ? 'deathsDoor' : 'hardEndTurn' };
  }

  // Battle Royale: last player standing (B88).
  const alive = livePlayers(state);
  if (alive.length <= 1 && state.playerOrder.length > 1) {
    return { ended: true, reason: 'battleRoyale' };
  }

  // Every variant also ends on the Jlore pile emptying.
  if (jloreEmpty(state)) return { ended: true, reason: 'jloreEmpty' };

  // Anomaly end conditions layer on top of whatever variant is configured.
  if (state.anomaly === 'aim_for_the_moon') {
    const { top } = vpLead(state);
    if (top >= 20) return { ended: true, reason: 'aimForTheMoon' };
  }
  if (state.anomaly === 'heavy_is_the_crown') {
    const { lead } = vpLead(state);
    if (lead >= 10) return { ended: true, reason: 'heavyIsTheCrown' };
  }

  switch (state.config.winCondition.kind) {
    case 'standard': {
      if (standardPileTrigger(state)) return { ended: true, reason: 'pilesEmpty' };
      return NOT_ENDED;
    }
    case 'countdown': {
      if (state.turn >= countdownTarget(state)) return { ended: true, reason: 'countdown' };
      return NOT_ENDED;
    }
    case 'duel': {
      const { lead } = vpLead(state);
      if (lead >= duelTarget(state)) return { ended: true, reason: 'duel' };
      return NOT_ENDED;
    }
    case 'crown': {
      const { top } = vpLead(state);
      if (top >= crownTarget(state)) return { ended: true, reason: 'crown' };
      return NOT_ENDED;
    }
    default:
      return NOT_ENDED;
  }
}
