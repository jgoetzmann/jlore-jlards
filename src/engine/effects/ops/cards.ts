/**
 * Stat and card-flow ops: gain, draw, mill, discard, discardDownTo, trash.
 */
import type { GameState, PlayerId, QueuedEffect, StatKey } from '@engine/types';
import { log, resolveWho } from '../runtime';
import { evalAmount } from '../evaluate';
import { ctxFor, resolveTargets, takeRng, commitRng, type OpResult, type Pre } from '../opkit';
import { discardInstance, drawCards, millCards, trashInstance } from '@engine/core/zones';

function addStat(s: GameState, player: PlayerId, stat: StatKey, delta: number): void {
  const p = s.players[player];
  if (!p) return;
  switch (stat) {
    case 'money':
      p.money += delta;
      break;
    case 'buys':
      p.buys += delta;
      break;
    case 'actions':
      p.actions += delta;
      break;
    case 'vp':
      p.vp += delta;
      break;
    case 'prophet':
      // Prophet is clamped at 0 (B60 / SB-38).
      p.prophet = Math.max(0, p.prophet + delta);
      break;
    default:
      break;
  }
}

/** B26 / B27: `{op:'gain', stat, amount}` scaled by the active multiplier. */
export function opGain(s: GameState, item: QueuedEffect, q: QueuedEffect[]): OpResult {
  const node = item.node;
  if (node.op !== 'gain') return 'ok';
  const ctx = ctxFor(item);
  const raw = evalAmount(s, node.amount, ctx);
  const mult = Number.isFinite(item.multiplier) && item.multiplier !== 0 ? item.multiplier : 1;
  const scaled = raw * mult;
  const delta = scaled < 0 ? Math.ceil(scaled) : Math.floor(scaled);

  const rng = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rng);
  if (node.who === 'randomOpponent') commitRng(s, rng);

  for (const pid of players) {
    if (node.stat === 'cards') {
      if (delta > 0) drawCards(s, pid, delta);
      continue;
    }
    addStat(s, pid, node.stat, delta);
    log(s, 'gain', { stat: node.stat, amount: delta, multiplier: mult }, pid);
  }
  return 'ok';
}

/** B29: draw as many as possible, reshuffling once, then stop. */
export function opDraw(s: GameState, item: QueuedEffect, q: QueuedEffect[]): OpResult {
  const node = item.node;
  if (node.op !== 'draw') return 'ok';
  const ctx = ctxFor(item);
  const mult = item.multiplier > 0 ? item.multiplier : 1;
  const n = Math.max(0, Math.floor(evalAmount(s, node.amount, ctx) * mult));
  const rng = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rng);
  if (node.who === 'randomOpponent') commitRng(s, rng);
  for (const pid of players) drawCards(s, pid, n);
  return 'ok';
}

export function opMill(s: GameState, item: QueuedEffect, q: QueuedEffect[]): OpResult {
  const node = item.node;
  if (node.op !== 'mill') return 'ok';
  const ctx = ctxFor(item);
  const n = Math.max(0, Math.floor(evalAmount(s, node.amount, ctx)));
  const rng = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rng);
  if (node.who === 'randomOpponent') commitRng(s, rng);
  for (const pid of players) millCards(s, pid, n);
  return 'ok';
}

export function opDiscard(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'discard') return 'ok';
  const targets = resolveTargets(s, item, q, node.target, pre, 'Discard');
  if (targets === null) return 'suspend';
  for (const iid of targets) discardInstance(s, iid);
  return 'ok';
}

/** Discard down to `amount` cards in hand, shedding from the back of the hand. */
export function opDiscardDownTo(s: GameState, item: QueuedEffect, q: QueuedEffect[]): OpResult {
  const node = item.node;
  if (node.op !== 'discardDownTo') return 'ok';
  const ctx = ctxFor(item);
  const target = Math.max(0, Math.floor(evalAmount(s, node.amount, ctx)));
  const rng = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rng);
  if (node.who === 'randomOpponent') commitRng(s, rng);

  for (const pid of players) {
    const p = s.players[pid];
    if (!p) continue;
    while (p.hand.length > target) {
      const iid = p.hand[p.hand.length - 1];
      const before = p.hand.length;
      discardInstance(s, iid);
      if (p.hand.length >= before) {
        // The instance refused to leave the hand; stop rather than spin.
        break;
      }
    }
    log(s, 'discardDownTo', { target, handSize: p.hand.length }, pid);
  }
  return 'ok';
}

/** B40: Indestructible instances stay exactly where they are. */
export function opTrash(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'trash') return 'ok';
  const targets = resolveTargets(s, item, q, node.target, pre, 'Trash');
  if (targets === null) return 'suspend';
  for (const iid of targets) trashInstance(s, iid);
  return 'ok';
}
