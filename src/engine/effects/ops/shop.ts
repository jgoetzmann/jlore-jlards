/**
 * Shop-facing ops. The cost arithmetic itself belongs to `@engine/shop`; these
 * ops only write the modifiers, locks and pile contents it reads.
 */
import type {
  CostMod,
  Duration,
  GameState,
  PileId,
  PileLock,
  PlayerId,
  QueuedEffect,
} from '@engine/types';
import { costOf, isLocked } from '@engine/shop';
import { log, opponentsOf, tryGetCard } from '../runtime';
import { evalAmount } from '../evaluate';
import { commitRng, ctxFor, resolvePiles, takeRng, type OpResult, type Pre } from '../opkit';
import { createInstance, moveToPile } from '@engine/core/zones';
import { fireEvent, trashWithTrigger } from '../triggers';
import { pileCost } from '../select';
import { resolveDefIdSpec } from '../pools';

/** Turn index a duration expires on, or null for permanent. (B51 / B56) */
export function expiryTurn(s: GameState, duration: Duration | undefined): number | null {
  const around = Math.max(1, s.playerOrder.length);
  if (duration === undefined || duration === 'permanent') return null;
  if (duration === 'turn') return s.turn;
  if (duration === 'untilYourNextTurn') return s.turn + around;
  if (duration === 'untilEndOfYourNextTurn') return s.turn + around;
  if (typeof duration === 'object' && 'turns' in duration) return s.turn + Math.max(0, Math.floor(duration.turns));
  if (typeof duration === 'object' && 'untilDiscarded' in duration) return null;
  return s.turn;
}

function modId(s: GameState, source: string): string {
  return 'cm_' + source + '_' + String(s.logSeq) + '_' + String(s.nodesResolvedThisTurn);
}

/** B52: locking an already-locked pile does nothing and does not extend it. */
export function opLockPile(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'lockPile') return 'ok';
  const piles = resolvePiles(s, item, q, node.target, pre, 'Lock a pile');
  if (piles === null) return 'suspend';

  for (const pileId of piles) {
    const pile = s.shop.piles[pileId];
    if (!pile) continue;
    if (pile.locks.length > 0) {
      log(s, 'lockNoOp', { pileId }, item.player);
      continue;
    }
    const lock: PileLock = {
      by: item.player,
      duration: node.duration,
      expiresOnTurn: expiryTurn(s, node.duration),
    };
    if (typeof node.duration === 'object' && 'untilDiscarded' in node.duration) {
      lock.unlockOnDiscardedCost = node.duration.untilDiscarded;
      lock.accruedDiscardCost = 0;
    }
    pile.locks.push(lock);
    log(s, 'lockPile', { pileId, expiresOnTurn: lock.expiresOnTurn }, item.player);
    fireEvent(s, q, item, 'onLock', null, item.player);
  }
  return 'ok';
}

export function opUnlockPile(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'unlockPile') return 'ok';
  const piles = resolvePiles(s, item, q, node.target, pre, 'Unlock a pile');
  if (piles === null) return 'suspend';
  for (const pileId of piles) {
    const pile = s.shop.piles[pileId];
    if (!pile || pile.locks.length === 0) continue;
    pile.locks = [];
    log(s, 'unlockPile', { pileId }, item.player);
    fireEvent(s, q, item, 'onUnlock', null, item.player);
  }
  return 'ok';
}

/** B53 / B54 / B56: modifiers stack in order, each with its own floor. */
export function opModifyCost(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'modifyCost') return 'ok';
  const ctx = ctxFor(item);
  const delta = node.delta === undefined ? undefined : Math.round(evalAmount(s, node.delta, ctx));
  const setTo = node.setTo === undefined ? undefined : Math.round(evalAmount(s, node.setTo, ctx));
  const floor = typeof node.floor === 'number' ? node.floor : 0;
  const expires = expiryTurn(s, node.duration);

  const make = (source: string, onlyFor?: PlayerId): CostMod => {
    const mod: CostMod = {
      id: modId(s, source),
      floor,
      expiresOnTurn: expires,
      source,
    };
    if (delta !== undefined) mod.delta = delta;
    if (setTo !== undefined) mod.setTo = setTo;
    if (onlyFor) mod.onlyFor = onlyFor;
    return mod;
  };

  if (node.scope === 'nextBuy' || node.scope === 'nextBuyOpponent') {
    const who: PlayerId[] = node.scope === 'nextBuy' ? [item.player] : opponentsOf(s, item.player);
    for (const pid of who) {
      const p = s.players[pid];
      if (!p) continue;
      p.nextCardMods.push({
        costDelta: delta ?? 0,
        costFloor: floor,
        appliesTo: 'buy',
        uses: 1,
      });
      log(s, 'modifyNextBuy', { delta: delta ?? 0, floor }, pid);
    }
    return 'ok';
  }

  if (node.scope === 'pile') {
    const piles = resolvePiles(s, item, q, node.target, pre, 'Modify a pile cost');
    if (piles === null) return 'suspend';
    for (const pileId of piles) {
      const pile = s.shop.piles[pileId];
      if (!pile) continue;
      pile.costMods.push(make('pile:' + pileId));
      log(s, 'modifyCost', { pileId, delta, setTo, floor, expiresOnTurn: expires }, item.player);
    }
    return 'ok';
  }

  if (node.scope === 'allShops') {
    s.shop.globalCostMods.push(make('allShops'));
    log(s, 'modifyCost', { scope: 'allShops', delta, setTo, floor }, item.player);
    return 'ok';
  }

  const shopKey =
    node.scope === 'draftShop'
      ? 'draft'
      : node.scope === 'resourceShop'
        ? 'resource'
        : node.scope === 'pointsShop'
          ? 'points'
          : 'prophet';
  const ids: PileId[] = s.shop.order[shopKey] ?? [];
  for (const pileId of ids) {
    const pile = s.shop.piles[pileId];
    if (!pile) continue;
    pile.costMods.push(make(String(node.scope)));
  }
  log(s, 'modifyCost', { scope: node.scope, piles: ids.length, delta, setTo, floor }, item.player);
  return 'ok';
}

/** Refill a pile back up to its starting size with copies of its own card. */
export function opReplenishPile(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'replenishPile') return 'ok';
  const piles = resolvePiles(s, item, q, node.target, pre, 'Replenish a pile');
  if (piles === null) return 'suspend';

  for (const pileId of piles) {
    const pile = s.shop.piles[pileId];
    if (!pile) continue;
    let defId: string | null = null;
    if (pile.cards.length > 0) {
      const top = s.instances[pile.cards[0]];
      if (top) defId = top.defId;
    } else if (tryGetCard(pileId)) {
      defId = pileId;
    }
    if (!defId) continue;
    const need = Math.max(0, pile.startingSize - pile.cards.length);
    for (let k = 0; k < need; k += 1) {
      moveToPile(s, createInstance(s, defId, null, 'shop').iid, pileId, 'bottom');
    }
    if (need > 0) log(s, 'replenishPile', { pileId, added: need, defId }, item.player);
  }
  return 'ok';
}

export function opTrashPile(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'trashPile') return 'ok';
  const piles = resolvePiles(s, item, q, node.target, pre, 'Trash a pile');
  if (piles === null) return 'suspend';
  for (const pileId of piles) {
    const pile = s.shop.piles[pileId];
    if (!pile) continue;
    for (const iid of pile.cards.slice()) trashWithTrigger(s, item, q, iid, item.player);
    log(s, 'trashPile', { pileId }, item.player);
    if (pile.cards.length === 0) fireEvent(s, q, item, 'onPileEmpty', null, item.player);
  }
  return 'ok';
}

/** Swap the effective cost of two piles by writing crossed overrides. */
export function opSwapPileCosts(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'swapPileCosts') return 'ok';
  const piles = resolvePiles(s, item, q, node.target, pre, 'Swap two pile costs');
  if (piles === null) return 'suspend';
  if (piles.length < 2) return 'ok';

  for (let k = 0; k + 1 < piles.length; k += 2) {
    const aId = piles[k];
    const bId = piles[k + 1];
    const a = s.shop.piles[aId];
    const b = s.shop.piles[bId];
    if (!a || !b) continue;
    const aCost = safeCost(s, aId, item.player);
    const bCost = safeCost(s, bId, item.player);
    a.costOverride = bCost;
    b.costOverride = aCost;
    log(s, 'swapPileCosts', { a: aId, b: bId, aCost, bCost }, item.player);
  }
  return 'ok';
}

function safeCost(s: GameState, pileId: PileId, buyer: PlayerId): number {
  try {
    return costOf(s, pileId, buyer);
  } catch {
    return pileCost(s, pileId);
  }
}

/** B49: the pile is an ordered stack, so adding to the top changes the next buy. */
export function opAddToPileTop(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'addToPileTop') return 'ok';
  const piles = resolvePiles(s, item, q, node.target, pre, 'Add to a pile');
  if (piles === null) return 'suspend';

  const ctx = ctxFor(item);
  const count = node.count === undefined ? 1 : Math.max(0, Math.floor(evalAmount(s, node.count, ctx)));
  const rng = takeRng(s);

  for (const pileId of piles) {
    const pile = s.shop.piles[pileId];
    if (!pile) continue;
    for (let k = 0; k < count; k += 1) {
      const defId = resolveDefIdSpec(s, node.defId, ctx, rng);
      if (!defId) continue;
      moveToPile(s, createInstance(s, defId, null, 'shop').iid, pileId, 'top');
      log(s, 'addToPileTop', { pileId, defId }, item.player);
    }
    if (typeof node.costOverride === 'number') pile.costOverride = node.costOverride;
  }
  commitRng(s, rng);
  return 'ok';
}

/** Fold the second pile's stack into the first. */
export function opMergePiles(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'mergePiles') return 'ok';
  const piles = resolvePiles(s, item, q, node.target, pre, 'Merge piles');
  if (piles === null) return 'suspend';
  if (piles.length < 2) return 'ok';

  const targetId = piles[0];
  const target = s.shop.piles[targetId];
  if (!target) return 'ok';

  for (let k = 1; k < piles.length; k += 1) {
    const src = s.shop.piles[piles[k]];
    if (!src || src.id === targetId) continue;
    for (const iid of src.cards) {
      const i = s.instances[iid];
      if (i) i.pileId = targetId;
      target.cards.push(iid);
    }
    target.startingSize += src.startingSize;
    src.cards = [];
    log(s, 'mergePiles', { into: targetId, from: src.id }, item.player);
    fireEvent(s, q, item, 'onPileEmpty', null, item.player);
  }
  return 'ok';
}

export function pileIsLocked(s: GameState, pileId: PileId): boolean {
  try {
    return isLocked(s, pileId);
  } catch {
    const pile = s.shop.piles[pileId];
    return !!pile && pile.locks.length > 0;
  }
}
