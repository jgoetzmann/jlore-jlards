/**
 * Trigger dispatch. Timing windows from gameplay doc 12.3: onGain and onBuy are
 * different events, onDiscard fires both from cleanup and from effects, and
 * start/end of turn are their own windows.
 *
 * A trigger fires only while its instance sits in one of its declared zones,
 * and at most `maxPerTurn` times per turn (tracked on the instance's counters
 * under a `trg:` prefix that turn cleanup wipes).
 */

import type {
  AuraId,
  Condition,
  EffectNode,
  GameState,
  InstanceId,
  PlayerId,
  Trigger,
  TriggerEvent,
} from '@engine/types';
import { resolveEffects, evalCondition } from '@engine/effects';
import type { EffectContext } from '@engine/effects';
import { getAura, hasAura } from '@engine/registry';
import { appendLog } from './log.js';
import { safeDef } from './zones.js';

export function makeContext(
  player: PlayerId,
  sourceIid: InstanceId | null,
  depth = 0,
  multiplier = 1,
  vars: Record<string, number> = {},
): EffectContext {
  return { player, sourceIid, depth, multiplier, vars };
}

function conditionHolds(state: GameState, cond: Condition | undefined, ctx: EffectContext): boolean {
  if (!cond) return true;
  try {
    return evalCondition(state, cond, ctx);
  } catch {
    return false;
  }
}

function budgetLeft(state: GameState): boolean {
  return state.nodesResolvedThisTurn < state.config.effectNodeBudget;
}

function counterKey(event: TriggerEvent, index: number): string {
  return `trg:${event}:${index}`;
}

function triggersOf(state: GameState, iid: InstanceId): Trigger[] {
  const inst = state.instances[iid];
  if (!inst) return [];
  return safeDef(inst.defId).triggers ?? [];
}

/** Run one instance's triggers for one event. */
export function fireInstanceTriggers(
  state: GameState,
  event: TriggerEvent,
  player: PlayerId,
  iid: InstanceId,
  depth = 0,
): GameState {
  const inst = state.instances[iid];
  if (!inst) return state;
  const list = triggersOf(state, iid);
  let s = state;
  for (let i = 0; i < list.length; i++) {
    const trig = list[i] as Trigger;
    if (trig.on !== event) continue;
    const live = s.instances[iid];
    if (!live) break;
    if (trig.zones && trig.zones.length && !trig.zones.includes(live.zone)) continue;
    if (trig.maxPerTurn !== undefined) {
      const key = counterKey(event, i);
      const used = live.counters[key] ?? 0;
      if (used >= trig.maxPerTurn) continue;
      live.counters[key] = used + 1;
    }
    const ctx = makeContext(player, iid, depth);
    if (!conditionHolds(s, trig.condition, ctx)) continue;
    if (!budgetLeft(s)) {
      appendLog(s, 'fizzle', player, { reason: 'nodeBudget', event, iid });
      break;
    }
    appendLog(s, 'trigger', player, { event, iid, defId: live.defId });
    s = runEffects(s, trig.effects, ctx);
    if (s.pending) break;
  }
  return s;
}

/**
 * Run one aura's triggers for one event.
 *
 * An Aura is not a card and has no instance, so it carries no zone and no
 * per-instance counters — `maxPerTurn` is tracked on the AuraInstance itself,
 * and the effect context has a null source.
 */
export function fireAuraTriggers(
  state: GameState,
  event: TriggerEvent,
  player: PlayerId,
  auraId: AuraId,
  depth = 0,
): GameState {
  const def = hasAura(auraId) ? getAura(auraId) : null;
  if (!def) return state;
  const list = def.triggers ?? [];
  let s = state;
  for (let i = 0; i < list.length; i++) {
    const trig = list[i] as Trigger;
    if (trig.on !== event) continue;
    const live = s.players[player]?.field.find((a) => a.auraId === auraId);
    if (!live) break;
    if (trig.maxPerTurn !== undefined) {
      const key = counterKey(event, i);
      const used = live.counters[key] ?? 0;
      if (used >= trig.maxPerTurn) continue;
      live.counters[key] = used + 1;
    }
    const ctx = makeContext(player, null, depth);
    if (!conditionHolds(s, trig.condition, ctx)) continue;
    if (!budgetLeft(s)) {
      appendLog(s, 'fizzle', player, { reason: 'nodeBudget', event, auraId });
      break;
    }
    appendLog(s, 'auraTrigger', player, { event, auraId });
    s = runEffects(s, trig.effects, ctx);
    if (s.pending) break;
  }
  return s;
}

/**
 * Fire the event across every instance a player owns, plus the aura triggers on
 * that player's field. Shop-pile instances are included for `onPileEmpty` and
 * `onPlagueAdded` style triggers only when the caller passes them explicitly.
 */
export function fireOwnedTriggers(
  state: GameState,
  event: TriggerEvent,
  player: PlayerId,
  depth = 0,
): GameState {
  const p = state.players[player];
  if (!p) return state;
  const candidates = [...p.play, ...p.hand, ...p.gy, ...p.library];
  let s = state;
  for (const iid of candidates) {
    const inst = s.instances[iid];
    if (!inst) continue;
    const list = safeDef(inst.defId).triggers ?? [];
    if (!list.some((t) => t.on === event)) continue;
    s = fireInstanceTriggers(s, event, player, iid, depth);
    if (s.pending) break;
  }
  if (s.pending) return s;
  // `startOfTurn` is the one aura window that already had an owner:
  // `auraStartOfTurn` (meta/auras.ts) fires it from step 3 of `startTurn`,
  // before card triggers, which is what B80 pins. Sweeping the Field here too
  // would resolve every Celestial twice a turn.
  if (event === 'startOfTurn') return s;
  return fireFieldTriggers(s, event, player, depth);
}

/**
 * Fire an event across a player's Field only.
 *
 * `fireOwnedTriggers` has always claimed to cover the Field and never did, so
 * the whole Celestial tier was inert along with the five anomalies that grant
 * one. Some events, though, are deliberately dispatched to a single instance —
 * `onBuy` reaches only the card just bought, `onPlay` only the card just
 * played — because sweeping every owned card on those would fire riders like
 * Lead's pile lock from a player's graveyard. Those sites call this instead, so
 * an aura sees the event without widening the card dispatch.
 */
export function fireFieldTriggers(
  state: GameState,
  event: TriggerEvent,
  player: PlayerId,
  depth = 0,
): GameState {
  let s = state;
  for (const aura of [...(s.players[player]?.field ?? [])]) {
    s = fireAuraTriggers(s, event, player, aura.auraId, depth);
    if (s.pending) break;
  }
  return s;
}

/** Fire an event for every player at the table, active player first. */
export function fireTableTriggers(state: GameState, event: TriggerEvent, depth = 0): GameState {
  let s = state;
  const order = [
    s.activePlayer,
    ...s.playerOrder.filter((id) => id !== s.activePlayer),
  ];
  for (const pid of order) {
    const p = s.players[pid];
    if (!p || p.eliminated) continue;
    s = fireOwnedTriggers(s, event, pid, depth);
    if (s.pending) break;
  }
  return s;
}

/** The one place the engine hands nodes to the effect interpreter. */
export function runEffects(state: GameState, nodes: EffectNode[], ctx: EffectContext): GameState {
  if (!nodes || nodes.length === 0) return state;
  if (ctx.depth > state.config.recursionDepth) {
    appendLog(state, 'fizzle', ctx.player, { reason: 'recursionDepth', depth: ctx.depth });
    return state;
  }
  if (state.nodesResolvedThisTurn >= state.config.effectNodeBudget) {
    appendLog(state, 'fizzle', ctx.player, { reason: 'nodeBudget' });
    return state;
  }
  try {
    return resolveEffects(state, nodes, ctx);
  } catch (err) {
    appendLog(state, 'effectError', ctx.player, { message: String(err) });
    return state;
  }
}

/** Wipe the per-turn `maxPerTurn` bookkeeping. */
export function clearTriggerCounters(state: GameState): void {
  for (const iid of Object.keys(state.instances)) {
    const inst = state.instances[iid];
    if (!inst) continue;
    for (const key of Object.keys(inst.counters)) {
      if (key.startsWith('trg:')) delete inst.counters[key];
    }
  }
}
