/**
 * Counter, plague, keyword and game-state ops.
 */
import type { GameState, InstanceId, QueuedEffect } from '@engine/types';
import { bumpCounter, log, resolveWho } from '../runtime';
import { evalAmount } from '../evaluate';
import {
  commitRng,
  ctxFor,
  resolvePiles,
  resolveTargets,
  takeRng,
  type OpResult,
  type Pre,
} from '../opkit';
import { isPileSelector } from '../select';
import { fireEvent } from '../triggers';
import { resetComboInPlace } from '@engine/systems/combo.js';

function pileTops(s: GameState, pileIds: string[]): InstanceId[] {
  const out: InstanceId[] = [];
  for (const pid of pileIds) {
    const pile = s.shop.piles[pid];
    if (pile && pile.cards.length > 0) out.push(pile.cards[0]);
  }
  return out;
}

/** B65: plague lives on one instance, in any zone, including shop piles. */
export function opPlague(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'plague') return 'ok';
  const ctx = ctxFor(item);
  const amount = Math.max(0, Math.floor(evalAmount(s, node.amount, ctx)));
  if (amount === 0) return 'ok';

  let iids: InstanceId[];
  if (isPileSelector(node.target)) {
    const piles = resolvePiles(s, item, q, node.target, pre, 'Plague a pile');
    if (piles === null) return 'suspend';
    iids = pileTops(s, piles);
  } else {
    const targets = resolveTargets(s, item, q, node.target, pre, 'Plague a card');
    if (targets === null) return 'suspend';
    iids = targets;
  }

  for (const iid of iids) {
    bumpCounter(s, iid, 'plague', amount);
    const i = s.instances[iid];
    log(s, 'plague', { iid, defId: i ? i.defId : null, amount }, item.player);
    fireEvent(s, q, item, 'onPlagueAdded', iid, item.player);
  }
  return 'ok';
}

export function opRemovePlague(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'removePlague') return 'ok';

  let iids: InstanceId[];
  if (isPileSelector(node.target)) {
    const piles = resolvePiles(s, item, q, node.target, pre, 'Cure a pile');
    if (piles === null) return 'suspend';
    iids = pileTops(s, piles);
  } else {
    const targets = resolveTargets(s, item, q, node.target, pre, 'Cure a card');
    if (targets === null) return 'suspend';
    iids = targets;
  }

  for (const iid of iids) {
    const i = s.instances[iid];
    if (!i) continue;
    if (i.counters.plague) {
      i.counters.plague = 0;
      log(s, 'removePlague', { iid, defId: i.defId }, item.player);
    }
  }
  return 'ok';
}

/** B63: counters survive zone changes, shuffles and end-of-turn discards. */
export function opAddCounter(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'addCounter') return 'ok';
  const ctx = ctxFor(item);
  const amount = Math.round(evalAmount(s, node.amount, ctx));

  // A player-scoped counter, for marks that belong to the seat rather than to a
  // card: "one Ricochet per turn" has to stop a *different* Ricochet too, so an
  // instance counter cannot express it. A `turn:` prefix clears at start of turn.
  if (node.scope === 'player') {
    const rng = takeRng(s);
    const players = resolveWho(s, node.who, item.player, rng, item.sourceIid);
    commitRng(s, rng);
    for (const pid of players) {
      const p = s.players[pid];
      if (!p) continue;
      p.counters[node.key] = (p.counters[node.key] ?? 0) + amount;
      log(s, 'addPlayerCounter', { key: node.key, amount, value: p.counters[node.key] }, pid);
    }
    return 'ok';
  }

  const targets = resolveTargets(s, item, q, node.target, pre, 'Add a counter');
  if (targets === null) return 'suspend';
  const iids = targets.length > 0 ? targets : item.sourceIid ? [item.sourceIid] : [];
  for (const iid of iids) {
    bumpCounter(s, iid, node.key, amount);
    log(s, 'addCounter', { iid, key: node.key, amount }, item.player);
  }
  return 'ok';
}

/** B17 / B24: VP accrued onto an instance, optionally only its owner may see. */
export function opScoreOnCard(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'scoreOnCard') return 'ok';
  const ctx = ctxFor(item);
  const amount = Math.round(evalAmount(s, node.amount, ctx));
  const targets = resolveTargets(s, item, q, node.target, pre, 'Score onto a card');
  if (targets === null) return 'suspend';
  const iids = targets.length > 0 ? targets : item.sourceIid ? [item.sourceIid] : [];

  for (const iid of iids) {
    const i = s.instances[iid];
    if (!i) continue;
    if (node.secret) {
      if (!i.secret) i.secret = {};
      const cur = typeof i.secret.vp === 'number' ? i.secret.vp : 0;
      i.secret.vp = cur + amount;
    } else {
      bumpCounter(s, iid, 'vp', amount);
    }
    log(s, 'scoreOnCard', { iid, amount, secret: !!node.secret }, item.player);
  }
  return 'ok';
}

export function opSetKeyword(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'setKeyword') return 'ok';
  const targets = resolveTargets(s, item, q, node.target, pre, 'Change a keyword');
  if (targets === null) return 'suspend';
  const iids = targets.length > 0 ? targets : item.sourceIid ? [item.sourceIid] : [];

  for (const iid of iids) {
    const i = s.instances[iid];
    if (!i) continue;
    if (node.on) {
      i.removedKeywords = i.removedKeywords.filter((k) => k !== node.keyword);
      if (i.addedKeywords.indexOf(node.keyword) < 0) i.addedKeywords.push(node.keyword);
    } else {
      i.addedKeywords = i.addedKeywords.filter((k) => k !== node.keyword);
      if (i.removedKeywords.indexOf(node.keyword) < 0) i.removedKeywords.push(node.keyword);
    }
    log(s, 'setKeyword', { iid, keyword: node.keyword, on: node.on }, item.player);
  }
  return 'ok';
}

/**
 * B71: Crime Wave zeroes the combo counter mid-turn. It must zero the *live*
 * counter `comboCount` reads, not just the stored `player.combo` field, or the
 * derived count keeps climbing off `playedThisTurn`.
 */
export function opResetCombo(s: GameState, item: QueuedEffect): OpResult {
  const node = item.node;
  if (node.op !== 'resetCombo') return 'ok';
  if (!resetComboInPlace(s, item.player)) return 'ok';
  log(s, 'resetCombo', {}, item.player);
  return 'ok';
}

export function opEndGame(s: GameState, item: QueuedEffect): OpResult {
  const node = item.node;
  if (node.op !== 'endGame') return 'ok';
  s.ended = true;
  s.endReason = node.reason ?? 'cardEffect';
  s.endTriggeredBy = item.player;
  log(s, 'endGame', { reason: s.endReason }, item.player);
  return 'ok';
}

export function opIncDoomsday(s: GameState, item: QueuedEffect): OpResult {
  const node = item.node;
  if (node.op !== 'incDoomsday') return 'ok';
  const ctx = ctxFor(item);
  const amount = Math.round(evalAmount(s, node.amount, ctx));
  s.doomsdayCounter += amount;
  log(s, 'incDoomsday', { amount, total: s.doomsdayCounter }, item.player);
  return 'ok';
}

export function opQuestProgress(s: GameState, item: QueuedEffect): OpResult {
  const node = item.node;
  if (node.op !== 'questProgress') return 'ok';
  const ctx = ctxFor(item);
  const amount = Math.round(evalAmount(s, node.amount, ctx));
  const p = s.players[item.player];
  if (!p) return 'ok';
  if (!p.quest) p.quest = { floor: 'f1', progress: {}, completedFloors: [] };
  const cur = typeof p.quest.progress[node.key] === 'number' ? p.quest.progress[node.key] : 0;
  p.quest.progress[node.key] = cur + amount;
  log(s, 'questProgress', { key: node.key, amount, total: p.quest.progress[node.key] }, item.player);
  return 'ok';
}

export function opNoop(): OpResult {
  return 'ok';
}
