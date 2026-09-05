/**
 * S-ENDGAME scoring — B17.
 *
 * `scoreFinal` = the running `player.vp` + VP printed on every card in the
 * whole deck (library + hand + gy + play) + VP accrued onto instances + the
 * End of Game cards, which are deliberately excluded from the running total.
 *
 * Two End of Game cards need real machinery rather than a printed number:
 *   Constellation — per copy, trash the longest run of (1),(2),…,(X)-cost cards
 *                   in the deck and score +X.
 *   Star Aligner  — +7 if exactly 7 cards in the deck cost (7).
 */

import type {
  CardDefId,
  CardDefinition,
  EffectNode,
  GameState,
  InstanceId,
  PlayerId,
} from '@engine/types';
import { getCard } from '@engine/registry';
import { evalAmount } from '@engine/effects';
import { statOf } from '@engine/systems/buff.js';
import { deckIidsOf } from './util.js';

export const CONSTELLATION_ID: CardDefId = 'constellation';
export const STAR_ALIGNER_ID: CardDefId = 'star_aligner';

function defOf(defId: CardDefId): CardDefinition | null {
  try {
    return getCard(defId);
  } catch {
    return null;
  }
}

export function isEndOfGame(def: CardDefinition): boolean {
  return def.tags.includes('EndOfGame');
}

/** VP scored onto the instance itself (Ascendant Spread, scoreOnCard). */
export function accruedVp(state: GameState, iid: InstanceId): number {
  const inst = state.instances[iid];
  if (!inst) return 0;
  return (inst.counters.vp ?? 0) + (inst.secret?.vp ?? 0);
}

/** Money cost of an instance as it stands at scoring time. */
function costOfInstance(state: GameState, iid: InstanceId): number {
  const inst = state.instances[iid];
  if (!inst) return 0;
  const def = defOf(inst.defId);
  const variant = state.variants[inst.defId];
  return (def?.cost.money ?? 0) + (variant?.costDelta ?? 0);
}

/**
 * Walk an effect tree summing every VP the node would grant at game end.
 * Used for End of Game cards whose payout is an expression rather than a
 * printed stat line. Never throws: an unevaluable expression scores 0.
 */
function sumVpGains(
  state: GameState,
  player: PlayerId,
  sourceIid: InstanceId | null,
  nodes: EffectNode[],
  depth: number,
): number {
  if (depth > 6) return 0;
  let total = 0;
  for (const node of nodes) {
    switch (node.op) {
      case 'gain': {
        if (node.stat !== 'vp') break;
        try {
          total += evalAmount(state, node.amount, {
            player,
            sourceIid,
            depth,
            multiplier: 1,
            vars: {},
          });
        } catch {
          /* unevaluable at scoring time scores nothing */
        }
        break;
      }
      case 'scoreOnCard': {
        try {
          total += evalAmount(state, node.amount, {
            player,
            sourceIid,
            depth,
            multiplier: 1,
            vars: {},
          });
        } catch {
          /* ignore */
        }
        break;
      }
      case 'sequence':
        total += sumVpGains(state, player, sourceIid, node.effects, depth + 1);
        break;
      case 'conditional':
        total += sumVpGains(state, player, sourceIid, node.then, depth + 1);
        break;
      case 'repeat':
        total += sumVpGains(state, player, sourceIid, node.effects, depth + 1);
        break;
      case 'delayed':
        total += sumVpGains(state, player, sourceIid, node.effects, depth + 1);
        break;
      default:
        break;
    }
  }
  return total;
}

interface DeckCard {
  iid: InstanceId;
  defId: CardDefId;
  cost: number;
  trashed: boolean;
}

/**
 * Constellation: find the longest run 1,2,…,X where the deck still holds an
 * untrashed card of each cost, trash exactly that run, and score X.
 */
function scoreConstellation(deck: DeckCard[]): number {
  const chosen: DeckCard[] = [];
  let x = 0;
  for (let want = 1; want <= 60; want += 1) {
    const hit = deck.find((c) => !c.trashed && c.cost === want && !chosen.includes(c));
    if (!hit) break;
    chosen.push(hit);
    x = want;
  }
  if (x === 0) return 0;
  for (const c of chosen) c.trashed = true;
  return x;
}

/** Star Aligner: +7 when exactly seven surviving cards cost (7). */
function scoreStarAligner(deck: DeckCard[]): number {
  const sevens = deck.filter((c) => !c.trashed && c.cost === 7).length;
  return sevens === 7 ? 7 : 0;
}

/** One player's total. Exported so the win conditions can read live VP. */
export function scoreFor(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  if (!p) return 0;

  const iids = deckIidsOf(state, player);
  const deck: DeckCard[] = iids.map((iid) => ({
    iid,
    defId: state.instances[iid]?.defId ?? '',
    cost: costOfInstance(state, iid),
    trashed: false,
  }));

  let total = p.vp;

  const endOfGameIids: InstanceId[] = [];
  for (const iid of iids) {
    const inst = state.instances[iid];
    if (!inst) continue;
    const def = defOf(inst.defId);
    total += accruedVp(state, iid);
    if (def && isEndOfGame(def)) {
      endOfGameIids.push(iid);
      continue;
    }
    total += statOf(state, iid, 'vp');
  }

  // Constellations resolve first: they consume cards the other scorers read.
  const constellations = endOfGameIids.filter(
    (iid) => state.instances[iid]?.defId === CONSTELLATION_ID,
  );
  for (let i = 0; i < constellations.length; i += 1) {
    total += scoreConstellation(deck);
  }

  for (const iid of endOfGameIids) {
    const inst = state.instances[iid];
    if (!inst) continue;
    if (inst.defId === CONSTELLATION_ID) continue;
    if (inst.defId === STAR_ALIGNER_ID) {
      total += scoreStarAligner(deck);
      continue;
    }
    const def = defOf(inst.defId);
    if (!def) continue;
    total += statOf(state, iid, 'vp');
    for (const trigger of def.triggers) {
      if (trigger.on !== 'gameEnd') continue;
      total += sumVpGains(state, player, iid, trigger.effects, 0);
    }
    if (inst.extraEffects.length > 0) {
      total += sumVpGains(state, player, iid, inst.extraEffects, 0);
    }
  }

  // Delayed effects parked for game end (Project: Doomsday, Wardrum).
  for (const d of p.delayed) {
    if (d.when !== 'gameEnd') continue;
    total += sumVpGains(state, player, d.sourceIid ?? null, d.effects, 0);
  }

  return total;
}

/** B17 / SPEC surface — every seated player's final score. */
export function scoreFinal(state: GameState): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {};
  for (const id of state.playerOrder) {
    out[id] = state.players[id]?.eliminated ? Number.NEGATIVE_INFINITY : scoreFor(state, id);
  }
  return out;
}

/**
 * Live VP for a win-condition check. Deliberately the same number as
 * `scoreFor`, because Crown and Duel are worded "a player's deck holds X VP".
 */
export function liveVp(state: GameState, player: PlayerId): number {
  return scoreFor(state, player);
}

function turnsTaken(state: GameState, player: PlayerId): number {
  return state.players[player]?.counters.turnsTaken ?? 0;
}
