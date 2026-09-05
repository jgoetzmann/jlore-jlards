/**
 * Auras on the Field.
 *
 * B76 A player holds at most one Heroic aura; manifesting a second replaces it.
 * B77 Activating a Heroic aura costs 2 Money and works once per turn.
 * B78 Celestial auras are unlimited and persistent.
 * B79 A player holds at most one Hypercelestial aura.
 */

import type { AuraId, AuraInstance, GameState, PlayerId } from '@engine/types';
import { getAura, hasAura } from '@engine/registry';
import { appendLog } from './log.js';
import { makeContext, runEffects } from './triggers.js';

export const HEROIC_ACTIVATION_COST = 2;

export function activationCostOf(auraId: AuraId): number {
  if (!hasAura(auraId)) return HEROIC_ACTIVATION_COST;
  const def = getAura(auraId);
  if (def.activationCost !== undefined) return def.activationCost;
  return def.tier === 'heroic' ? HEROIC_ACTIVATION_COST : 0;
}

export function auraOf(state: GameState, player: PlayerId, auraId: AuraId): AuraInstance | null {
  const p = state.players[player];
  if (!p) return null;
  return p.field.find((a) => a.auraId === auraId) ?? null;
}

/** The one legality gate for `activateAura`, shared with `legalActions` (B25). */
export function canActivateAura(state: GameState, player: PlayerId, auraId: AuraId): boolean {
  if (state.ended) return false;
  if (state.pending) return false;
  if (state.activePlayer !== player) return false;
  const p = state.players[player];
  if (!p || p.eliminated) return false;
  const aura = auraOf(state, player, auraId);
  if (!aura) return false;
  if (aura.usedThisTurn) return false; // B77: once per turn
  if (!hasAura(auraId)) return false;
  const def = getAura(auraId);
  if (def.tier !== 'heroic' && def.activationCost === undefined) return false;
  return p.money >= activationCostOf(auraId);
}

export function activateAura(state: GameState, player: PlayerId, auraId: AuraId): GameState {
  let s = state;
  const p = s.players[player];
  if (!p) return s;
  const aura = auraOf(s, player, auraId);
  if (!aura) return s;

  const cost = activationCostOf(auraId);
  p.money -= cost; // B77
  aura.usedThisTurn = true;
  appendLog(s, 'activateAura', player, { auraId, cost });

  if (hasAura(auraId)) {
    const def = getAura(auraId);
    s = runEffects(s, def.effects, makeContext(player, null, 0, 1, {}));
  }
  return s;
}

export function activatableAuras(state: GameState, player: PlayerId): AuraId[] {
  const p = state.players[player];
  if (!p) return [];
  return p.field.map((a) => a.auraId).filter((id) => canActivateAura(state, player, id));
}
