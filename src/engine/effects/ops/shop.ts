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
  InstanceId,
  PlayerId,
  QueuedEffect,
} from '@engine/types';
import { costOf, costModExpiryFor, expiryTurnFor, pileDefId } from '@engine/shop';
import { log, opponentsOf, tryGetCard } from '../runtime';
import { evalAmount } from '../evaluate';
import { commitRng, ctxFor, resolvePiles, takeRng, type OpResult, type Pre } from '../opkit';
import { createInstance, moveToPile } from '@engine/core/zones';
import { fireEvent, trashWithTrigger } from '../triggers';
import { pileCost } from '../select';
import { resolveDefIdSpec } from '../pools';

/**
 * @deprecated Locks and cost mods use OPPOSITE conventions for
 * `expiresOnTurn` — a lock's names the first turn it is gone, a cost mod's the
 * last turn it bites — and this single helper could only be right for one of
 * them. Use `expiryTurnFor` (locks) or `costModExpiryFor` (cost mods).
 * Retained only because it is exported.
 */
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
      // A lock's `expiresOnTurn` names the first turn it is already GONE
      // (`lockIsActive` tests `turn < expiresOnTurn`), while a CostMod's names
      // the last turn it still bites. One helper was serving both, so it was
      // right for cost mods and one turn short for locks — every
      // `duration:'turn'` lock in the catalog was inert the instant it applied.
      expiresOnTurn: node.duration === undefined ? null : expiryTurnFor(s, node.duration),
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
  // Cost-mod convention: the last turn the modifier still applies.
  const expires = node.duration === undefined ? null : costModExpiryFor(s, node.duration);

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

  // A modifyCost carrying neither `delta` nor `setTo` is a CLEAR — Cloud Nine
  // removes every cost change in play. Expressed as a mod it could only ever
  // add another entry to the stack it is trying to empty.
  if (delta === undefined && setTo === undefined) {
    const scope = node.scope;
    if (scope === 'pile') {
      const piles = resolvePiles(s, item, q, node.target, pre, 'Clear pile costs');
      if (piles === null) return 'suspend';
      for (const pileId of piles) {
        const pile = s.shop.piles[pileId];
        if (!pile) continue;
        pile.costMods = [];
        delete pile.costOverride;
      }
      log(s, 'clearCostMods', { scope, piles: piles.length }, item.player);
      return 'ok';
    }
    for (const pileId of Object.keys(s.shop.piles)) {
      const pile = s.shop.piles[pileId];
      if (!pile) continue;
      pile.costMods = [];
      delete pile.costOverride;
    }
    s.shop.globalCostMods = [];
    log(s, 'clearCostMods', { scope: scope ?? 'allShops' }, item.player);
    return 'ok';
  }

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
    } else {
      // An emptied pile still knows what it was, but only through `pileDefId`:
      // a pile id is `<shop>:<defId>`, so `tryGetCard(pileId)` never resolved
      // and "fully replenish a Draft pile" could not reach an empty one — the
      // exact case the card exists for.
      defId = pileDefId(s, pileId);
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

  // A.9 892: "Shuffle two piles together and SPLIT THEM EVENLY between the
  // slots." Pouring one pile into the other instead emptied a Draft slot, which
  // counts toward `emptyPileAbsolute` / `emptyPileFraction` — so a (3) card
  // could push the game a quarter of the way to over.
  const ids = piles.filter((id) => !!s.shop.piles[id]);
  if (ids.length < 2) return 'ok';

  const pooled: InstanceId[] = [];
  let totalStarting = 0;
  for (const id of ids) {
    const pile = s.shop.piles[id];
    if (!pile) continue;
    pooled.push(...pile.cards);
    totalStarting += pile.startingSize;
    pile.cards = [];
  }

  const rng = takeRng(s);
  const shuffled = rng.shuffle(pooled);
  commitRng(s, rng);

  // Deal round-robin so the slots differ by at most one card.
  shuffled.forEach((iid, idx) => {
    const destId = ids[idx % ids.length] as PileId;
    const dest = s.shop.piles[destId];
    if (!dest) return;
    const inst = s.instances[iid];
    if (inst) inst.pileId = destId;
    dest.cards.push(iid);
  });

  const share = Math.max(1, Math.round(totalStarting / ids.length));
  for (const id of ids) {
    const pile = s.shop.piles[id];
    if (pile) pile.startingSize = share;
  }

  log(s, 'mergePiles', { piles: ids, dealt: shuffled.length }, item.player);
  for (const id of ids) {
    if (s.shop.piles[id]?.cards.length === 0) fireEvent(s, q, item, 'onPileEmpty', null, item.player);
  }
  return 'ok';
}
