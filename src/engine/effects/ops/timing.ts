/**
 * Timing ops: delayed queues, next-card modifiers, and turn control.
 */
import type { DelayedEffect, GameState, QueuedEffect } from '@engine/types';
import { log, resolveWho } from '../runtime';
import { commitRng, takeRng, type OpResult } from '../opkit';

type When = 'startOfTurn' | 'endOfTurn' | 'gameEnd';

function resolveWhen(
  s: GameState,
  when: Extract<QueuedEffect['node'], { op: 'delayed' }>['when'],
): { fireOnTurn: number; when: When } {
  const around = Math.max(1, s.playerOrder.length);
  if (when === 'endOfTurn') return { fireOnTurn: s.turn, when: 'endOfTurn' };
  if (when === 'endOfNextTurn') return { fireOnTurn: s.turn + around, when: 'endOfTurn' };
  if (when === 'startOfNextTurn' || when === 'startOfTurn') {
    return { fireOnTurn: s.turn + around, when: 'startOfTurn' };
  }
  if (when === 'gameEnd') return { fireOnTurn: -1, when: 'gameEnd' };
  if (typeof when === 'object' && 'inTurns' in when) {
    return { fireOnTurn: s.turn + Math.max(1, Math.floor(when.inTurns)) * around, when: 'startOfTurn' };
  }
  if (typeof when === 'object' && 'atTurn' in when) {
    return { fireOnTurn: Math.max(1, Math.floor(when.atTurn)), when: 'startOfTurn' };
  }
  return { fireOnTurn: s.turn + around, when: 'startOfTurn' };
}

export function opDelayed(s: GameState, item: QueuedEffect): OpResult {
  const node = item.node;
  if (node.op !== 'delayed') return 'ok';
  if (node.effects.length === 0) return 'ok';

  const rng = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rng, item.sourceIid);
  commitRng(s, rng);

  const timing = resolveWhen(s, node.when);
  for (const pid of players) {
    const p = s.players[pid];
    if (!p) continue;
    const entry: DelayedEffect = {
      id: 'dl_' + String(s.logSeq) + '_' + String(p.delayed.length) + '_' + pid,
      fireOnTurn: timing.fireOnTurn,
      when: timing.when,
      effects: node.effects,
    };
    if (item.sourceIid) entry.sourceIid = item.sourceIid;
    p.delayed.push(entry);
    log(s, 'delayed', { id: entry.id, fireOnTurn: entry.fireOnTurn, when: entry.when }, pid);
  }
  return 'ok';
}

export function opNextCardModifier(s: GameState, item: QueuedEffect): OpResult {
  const node = item.node;
  if (node.op !== 'nextCardModifier') return 'ok';
  const mod = node.mod;

  const rng = takeRng(s);
  const players = resolveWho(s, mod.who, item.player, rng);
  commitRng(s, rng);

  for (const pid of players) {
    const p = s.players[pid];
    if (!p) continue;
    const copy = { ...mod };
    if (copy.uses === undefined) copy.uses = 1;
    if (copy.appliesTo === undefined) copy.appliesTo = 'play';
    if (copy.absorbInto === undefined && item.sourceIid && mod.bind) copy.absorbInto = item.sourceIid;
    p.nextCardMods.push(copy);
    log(s, 'nextCardModifier', { mod: copy }, pid);
  }
  return 'ok';
}

/** Ends the acting player's turn: nothing left to spend, nothing left to play. */
export function opEndTurn(s: GameState, item: QueuedEffect): OpResult {
  const node = item.node;
  if (node.op !== 'endTurn') return 'ok';
  const rng = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rng, item.sourceIid);
  commitRng(s, rng);
  for (const pid of players) {
    const p = s.players[pid];
    if (!p) continue;
    p.actions = 0;
    p.buys = 0;
    p.counters.endTurnRequested = 1;
    log(s, 'endTurnRequested', {}, pid);
  }
  return 'ok';
}

export function opExtraTurn(s: GameState, item: QueuedEffect): OpResult {
  const node = item.node;
  if (node.op !== 'extraTurn') return 'ok';
  const rng = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rng, item.sourceIid);
  commitRng(s, rng);
  for (const pid of players) {
    const p = s.players[pid];
    if (!p) continue;
    p.extraTurns += 1;
    log(s, 'extraTurn', { owed: p.extraTurns }, pid);
  }
  return 'ok';
}
