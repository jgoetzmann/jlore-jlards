/**
 * S-AURA machinery — B76, B77, B78, B79, B80 (SB-12).
 *
 * The aura *definitions* are data owned by the card slice. This file owns the
 * rules around them:
 *
 *   B76  at most one Heroic; manifesting a second replaces the first
 *   B77  activating a Heroic costs 2 Money, once per turn
 *   B78  Celestials are unlimited and persistent
 *   B79  at most one Hypercelestial
 *   B80  aura triggers fire in the start-of-turn window, after the stat reset
 *        and before card triggers
 *
 * Plus the two auras whose behaviour is machinery rather than data: Outstanding
 * Debt (timed, formula-driven) and Oathbound Memory (bound to a card id).
 */

import type {
  AuraDefinition,
  AuraId,
  AuraInstance,
  AuraTier,
  CardDefId,
  EffectNode,
  GameState,
  PlayerId,
} from '@engine/types';
import { getAura, allAuras } from '@engine/registry';
import { resolveEffects } from '@engine/effects';
import { cloneState, pushLog, withPlayer } from './util.js';

export const HEROIC_ACTIVATION_COST = 2;

/** Timed aura: Outstanding Debt runs for four turns (§9.2). */
export const OUTSTANDING_DEBT_ID: AuraId = 'outstanding_debt';
export const OUTSTANDING_DEBT_TURNS = 4;
/** Bound aura: Infini Scepter's Oathbound Memory: [Card]. */
export const OATHBOUND_MEMORY_ID: AuraId = 'oathbound_memory';

function auraDef(auraId: AuraId): AuraDefinition | null {
  try {
    return getAura(auraId);
  } catch {
    return null;
  }
}

/** Definition tier wins over the caller's claim when the two disagree. */
export function tierOf(auraId: AuraId, fallback: AuraTier): AuraTier {
  return auraDef(auraId)?.tier ?? fallback;
}

export function fieldOf(state: GameState, player: PlayerId): AuraInstance[] {
  return state.players[player]?.field ?? [];
}

export function hasAura(state: GameState, player: PlayerId, auraId: AuraId): boolean {
  return fieldOf(state, player).some((a) => a.auraId === auraId);
}

export function aurasOfTier(state: GameState, player: PlayerId, tier: AuraTier): AuraInstance[] {
  return fieldOf(state, player).filter((a) => tierOf(a.auraId, 'celestial') === tier);
}

export function heroicOf(state: GameState, player: PlayerId): AuraInstance | null {
  return aurasOfTier(state, player, 'heroic')[0] ?? null;
}

export function hypercelestialOf(state: GameState, player: PlayerId): AuraInstance | null {
  return aurasOfTier(state, player, 'hypercelestial')[0] ?? null;
}

export function celestialsOf(state: GameState, player: PlayerId): AuraInstance[] {
  return aurasOfTier(state, player, 'celestial');
}

export function auraIdsForTier(tier: AuraTier): AuraId[] {
  return allAuras()
    .filter((a) => a.tier === tier)
    .map((a) => a.id)
    .sort();
}

/** Drop an aura off a player's field. */
export function removeAura(state: GameState, player: PlayerId, auraId: AuraId): GameState {
  if (!hasAura(state, player, auraId)) return state;
  const next = withPlayer(state, player, (p) => ({
    ...p,
    field: p.field.filter((a) => a.auraId !== auraId),
  }));
  return pushLog(next, 'auraRemoved', { auraId }, player);
}

function newInstance(player: PlayerId, auraId: AuraId, boundDefId?: CardDefId): AuraInstance {
  const inst: AuraInstance = {
    auraId,
    owner: player,
    usedThisTurn: false,
    counters: {},
  };
  if (auraId === OUTSTANDING_DEBT_ID) inst.turnsRemaining = OUTSTANDING_DEBT_TURNS;
  if (boundDefId !== undefined) inst.boundDefId = boundDefId;
  return inst;
}

/**
 * B76 / B78 / B79 — put an aura on a player's field, enforcing the slot caps.
 * Heroic replaces the held Heroic; Hypercelestial replaces the held
 * Hypercelestial; Celestials are unlimited but never stack the same id twice.
 */
export function manifestAura(
  state: GameState,
  player: PlayerId,
  auraId: AuraId,
  tier: AuraTier,
  boundDefId?: CardDefId,
): GameState {
  if (!state.players[player]) return state;
  const realTier = tierOf(auraId, tier);

  let next = state;

  if (realTier === 'heroic') {
    const held = heroicOf(next, player);
    if (held && held.auraId !== auraId) {
      next = removeAura(next, player, held.auraId);
      next = pushLog(next, 'auraReplaced', { tier: 'heroic', replaced: held.auraId, with: auraId }, player);
    } else if (held && held.auraId === auraId) {
      return pushLog(next, 'auraRefreshed', { auraId }, player);
    }
  } else if (realTier === 'hypercelestial') {
    const held = hypercelestialOf(next, player);
    if (held && held.auraId !== auraId) {
      next = removeAura(next, player, held.auraId);
      next = pushLog(next, 'auraReplaced', { tier: 'hypercelestial', replaced: held.auraId, with: auraId }, player);
    } else if (held && held.auraId === auraId) {
      return pushLog(next, 'auraRefreshed', { auraId }, player);
    }
  } else if (hasAura(next, player, auraId)) {
    // Unlimited Celestials, but a second copy of the same one is a refresh.
    if (auraId === OUTSTANDING_DEBT_ID) {
      next = withPlayer(next, player, (p) => ({
        ...p,
        field: p.field.map((a) =>
          a.auraId === auraId ? { ...a, turnsRemaining: OUTSTANDING_DEBT_TURNS } : a,
        ),
      }));
    }
    if (boundDefId !== undefined) {
      next = withPlayer(next, player, (p) => ({
        ...p,
        field: p.field.map((a) => (a.auraId === auraId ? { ...a, boundDefId } : a)),
      }));
    }
    return pushLog(next, 'auraRefreshed', { auraId }, player);
  }

  next = withPlayer(next, player, (p) => ({
    ...p,
    field: [...p.field, newInstance(player, auraId, boundDefId)],
  }));
  return pushLog(next, 'auraManifested', { auraId, tier: realTier }, player);
}

/** Bind Oathbound Memory to a definition id (Infini Scepter). */
export function bindAura(
  state: GameState,
  player: PlayerId,
  auraId: AuraId,
  defId: CardDefId,
): GameState {
  if (!hasAura(state, player, auraId)) return state;
  const next = withPlayer(state, player, (p) => ({
    ...p,
    field: p.field.map((a) => (a.auraId === auraId ? { ...a, boundDefId: defId } : a)),
  }));
  return pushLog(next, 'auraBound', { auraId, defId }, player);
}

/**
 * B77 — activate a Heroic aura. Costs 2 Money (or the definition's own
 * `activationCost`) and is usable once per turn. Rejections return the state
 * unchanged with a LogEntry, never a throw.
 */
export function activateAura(state: GameState, player: PlayerId, auraId: AuraId): GameState {
  const p = state.players[player];
  if (!p) return state;

  const held = p.field.find((a) => a.auraId === auraId);
  if (!held) return pushLog(state, 'auraActivateRejected', { auraId, why: 'notHeld' }, player);

  const def = auraDef(auraId);
  const tier = def?.tier ?? 'heroic';
  if (tier !== 'heroic') {
    return pushLog(state, 'auraActivateRejected', { auraId, why: 'notHeroic' }, player);
  }
  if (held.usedThisTurn) {
    return pushLog(state, 'auraActivateRejected', { auraId, why: 'alreadyUsedThisTurn' }, player);
  }

  const cost = def?.activationCost ?? HEROIC_ACTIVATION_COST;
  if (p.money < cost) {
    return pushLog(state, 'auraActivateRejected', { auraId, why: 'notEnoughMoney', cost }, player);
  }

  let next = withPlayer(state, player, (q) => ({
    ...q,
    money: q.money - cost,
    field: q.field.map((a) => (a.auraId === auraId ? { ...a, usedThisTurn: true } : a)),
  }));
  next = pushLog(next, 'auraActivated', { auraId, cost }, player);

  if (def && def.effects.length > 0) {
    next = resolveEffects(next, def.effects, {
      player,
      sourceIid: null,
      depth: 0,
      multiplier: 1,
      vars: {},
    });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Start-of-turn window (B80)
// ---------------------------------------------------------------------------

/** Outstanding Debt: −ceil((20 − unspent Money)/4) Money, for four turns. */
export function outstandingDebtAmount(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  if (!p) return 0;
  // "Unspent Money" is what the player finished their last turn holding; the
  // turn reset has already zeroed `money` by the time this window runs, so the
  // end-of-turn snapshot in counters is the authority when it exists.
  const unspent = p.counters.unspentMoney ?? p.money;
  return Math.ceil((20 - unspent) / 4);
}

/** Oathbound Memory: a Temporary copy of the bound card to hand, +1 Action. */
function oathboundEffects(defId: CardDefId): EffectNode[] {
  return [
    { op: 'createCard', defId, to: 'hand', keywords: ['Temporary'] },
    { op: 'gain', stat: 'actions', amount: 1 },
  ];
}

/**
 * B80 — the aura half of the start-of-turn window. Runs after the stat reset
 * and before any card trigger. Clears Heroic activation flags, ticks timed
 * auras down, then fires every held aura's `startOfTurn` triggers in field
 * order.
 */
export function auraStartOfTurn(state: GameState, player: PlayerId): GameState {
  const p0 = state.players[player];
  if (!p0 || p0.eliminated) return state;
  if (p0.field.length === 0) {
    return withPlayer(state, player, (p) => ({ ...p, field: [] }));
  }

  let next = cloneState(state);

  // Heroics refresh their once-per-turn activation.
  next = withPlayer(next, player, (p) => ({
    ...p,
    field: p.field.map((a) => ({ ...a, usedThisTurn: false })),
  }));

  const order = (next.players[player]?.field ?? []).map((a) => a.auraId);

  for (const auraId of order) {
    const inst = next.players[player]?.field.find((a) => a.auraId === auraId);
    if (!inst) continue;

    // --- timed auras -----------------------------------------------------
    if (inst.turnsRemaining !== undefined) {
      if (inst.turnsRemaining <= 0) {
        next = removeAura(next, player, auraId);
        continue;
      }
    }

    // --- Outstanding Debt (machinery, not data) ---------------------------
    if (auraId === OUTSTANDING_DEBT_ID) {
      const x = outstandingDebtAmount(next, player);
      next = withPlayer(next, player, (p) => ({ ...p, money: p.money - x }));
      next = pushLog(next, 'auraTriggered', { auraId, money: -x }, player);
    }

    // --- Oathbound Memory (bound aura) ------------------------------------
    if (auraId === OATHBOUND_MEMORY_ID && inst.boundDefId) {
      next = resolveEffects(next, oathboundEffects(inst.boundDefId), {
        player,
        sourceIid: null,
        depth: 0,
        multiplier: 1,
        vars: {},
      });
      next = pushLog(next, 'auraTriggered', { auraId, boundDefId: inst.boundDefId }, player);
    }

    // --- data-driven triggers --------------------------------------------
    const def = auraDef(auraId);
    if (def) {
      for (const trigger of def.triggers) {
        if (trigger.on !== 'startOfTurn') continue;
        if (trigger.effects.length === 0) continue;
        next = resolveEffects(next, trigger.effects, {
          player,
          sourceIid: null,
          depth: 0,
          multiplier: 1,
          vars: {},
        });
        next = pushLog(next, 'auraTriggered', { auraId }, player);
      }
    }

    // --- tick the clock after the aura has fired this turn -----------------
    const after = next.players[player]?.field.find((a) => a.auraId === auraId);
    if (after && after.turnsRemaining !== undefined) {
      const left = after.turnsRemaining - 1;
      if (left <= 0) {
        next = removeAura(next, player, auraId);
        next = pushLog(next, 'auraExpired', { auraId }, player);
      } else {
        next = withPlayer(next, player, (p) => ({
          ...p,
          field: p.field.map((a) => (a.auraId === auraId ? { ...a, turnsRemaining: left } : a)),
        }));
      }
    }
  }

  return next;
}

/** Fire every held aura's `endOfTurn` triggers. Companion to B80's window. */
export function auraEndOfTurn(state: GameState, player: PlayerId): GameState {
  const p = state.players[player];
  if (!p || p.field.length === 0) return state;
  let next = state;
  for (const inst of [...p.field]) {
    const def = auraDef(inst.auraId);
    if (!def) continue;
    for (const trigger of def.triggers) {
      if (trigger.on !== 'endOfTurn') continue;
      next = resolveEffects(next, trigger.effects, {
        player,
        sourceIid: null,
        depth: 0,
        multiplier: 1,
        vars: {},
      });
    }
  }
  // Snapshot unspent money so Outstanding Debt has a number to read next turn.
  return withPlayer(next, player, (q) => ({
    ...q,
    counters: { ...q.counters, unspentMoney: q.money },
  }));
}
