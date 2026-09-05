/**
 * Buying a card.
 *
 * B5  1 Buy plus the current cost; the bought card goes to the buyer's GY.
 * B19 An unaffordable buy is rejected and the state is unchanged.
 * B50 A locked pile cannot be bought from.
 * B55 A negative cost credits the buyer.
 * B57 A Prophet card needs banked Prophet at least its threshold.
 * B58 A Prophet purchase drains Prophet and costs no Money.
 * B59 A Prophet purchase does not consume a Buy.
 * B61 The Unconcerned Lion is the only card that may go negative on Prophet.
 * B92 A bought defId enters the buyer's codex.
 */

import type { GameState, InstanceId, NextCardMod, PileId, PlayerId, Zone } from '@engine/types';
import { canBuy as shopCanBuy, costOf, isLocked } from '@engine/shop';
import { appendLog } from './log.js';
import { fireInstanceTriggers, fireOwnedTriggers } from './triggers.js';
import { hasKeyword, moveInstance, safeDef, topOfPile } from './zones.js';
import { playCard } from './play.js';
import { noteEndCondition } from './endgame.js';

/** The one card allowed to bank negative Prophet (SB-5 / B61). */
function allowsNegativeProphet(defId: string): boolean {
  return defId.includes('unconcerned_lion');
}

interface BuyMods {
  costDelta: number;
  costFloor: number | null;
  buyTo: Zone | null;
}

function peekBuyMods(state: GameState, player: PlayerId): BuyMods {
  const p = state.players[player];
  const out: BuyMods = { costDelta: 0, costFloor: null, buyTo: null };
  if (!p) return out;
  for (const mod of p.nextCardMods) {
    if (mod.appliesTo !== 'buy') continue;
    if (mod.costDelta) out.costDelta += mod.costDelta;
    if (mod.costFloor !== undefined) {
      out.costFloor = out.costFloor === null ? mod.costFloor : Math.max(out.costFloor, mod.costFloor);
    }
    if (mod.buyTo) out.buyTo = mod.buyTo;
  }
  return out;
}

function consumeBuyMods(state: GameState, player: PlayerId): BuyMods {
  const p = state.players[player];
  const out = peekBuyMods(state, player);
  if (!p) return out;
  const keep: NextCardMod[] = [];
  for (const mod of p.nextCardMods) {
    if (mod.appliesTo !== 'buy') {
      keep.push(mod);
      continue;
    }
    const uses = (mod.uses ?? 1) - 1;
    if (uses > 0) keep.push({ ...mod, uses });
  }
  p.nextCardMods = keep;
  return out;
}

/** Current money price of a pile for a buyer, after next-buy modifiers. */
export function priceFor(state: GameState, pileId: PileId, buyer: PlayerId): number {
  let base: number;
  try {
    base = costOf(state, pileId, buyer);
  } catch {
    const iid = topOfPile(state, pileId);
    const def = iid ? safeDef(state.instances[iid]!.defId) : null;
    base = def?.cost.money ?? 0;
  }
  if (!Number.isFinite(base)) base = 0;
  const mods = peekBuyMods(state, buyer);
  let price = base + mods.costDelta;
  if (mods.costFloor !== null && price < mods.costFloor) price = mods.costFloor;
  return Math.round(price);
}

/**
 * The one legality gate for buys. `legalActions` and `reduce` both call it,
 * which is what makes B25 true by construction.
 */
export function canBuyPile(state: GameState, player: PlayerId, pileId: PileId): boolean {
  if (state.ended) return false;
  if (state.pending) return false;
  if (state.activePlayer !== player) return false;
  const p = state.players[player];
  if (!p || p.eliminated) return false;

  const pile = state.shop.piles[pileId];
  if (!pile || pile.cards.length === 0) return false;

  // B50: locked piles are unbuyable.
  try {
    if (isLocked(state, pileId)) return false;
  } catch {
    /* shop slice unavailable; fall through to the local checks */
  }

  const iid = topOfPile(state, pileId);
  if (!iid) return false;
  const inst = state.instances[iid];
  if (!inst) return false;
  const def = safeDef(inst.defId);

  // B62/B48: token cards never sit in a purchasable pile in the first place.
  if (def.notPurchasable) return false;

  if (def.cost.prophet) {
    // B57: threshold gate. B59: no Buy consumed, so buys are not checked.
    if (p.prophet < def.cost.prophet.threshold) return false;
  } else {
    if (p.buys < 1) return false;
    const price = priceFor(state, pileId, player);
    if (price > p.money) return false; // B19 (a negative price is always affordable, B55)
  }

  try {
    if (!shopCanBuy(state, pileId, player)) return false;
  } catch {
    /* shop slice unavailable; the local checks above stand on their own */
  }
  return true;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export function buyCard(state: GameState, player: PlayerId, pileId: PileId): GameState {
  let s = state;
  const p = s.players[player];
  const pile = s.shop.piles[pileId];
  if (!p || !pile) return s;

  const iid = topOfPile(s, pileId); // B49: the top card is what you get.
  if (!iid) return s;
  const inst = s.instances[iid];
  if (!inst) return s;
  const def = safeDef(inst.defId);

  const mods = consumeBuyMods(s, player);
  let paid = 0;
  let prophetPaid = 0;

  if (def.cost.prophet) {
    // B58: drain Prophet, spend no Money. B59: no Buy consumed.
    prophetPaid = def.cost.prophet.drain;
    p.prophet -= prophetPaid;
    if (p.prophet < 0 && !allowsNegativeProphet(inst.defId)) p.prophet = 0; // B60/B61
  } else {
    let price = priceFor(s, pileId, player);
    if (mods.costFloor !== null && price < mods.costFloor) price = mods.costFloor;
    paid = price;
    p.money -= price; // B55: a negative price credits the buyer.
    p.buys -= 1;
    p.buysUsedThisTurn += 1;
  }

  // B5: to GY, unless a NextCardMod redirected it (Express Shipping).
  const dest: Zone = mods.buyTo ?? 'gy';
  moveInstance(s, iid, player, dest, dest === 'library' ? 'top' : 'bottom');
  p.cardsGainedThisTurn += 1;
  if (!p.codex.includes(inst.defId)) p.codex.push(inst.defId); // B92
  if (!s.defsInMatch.includes(inst.defId)) s.defsInMatch.push(inst.defId);

  appendLog(s, 'buy', player, {
    iid,
    defId: inst.defId,
    pileId,
    paid,
    prophetPaid,
    to: dest,
    moneyLeft: p.money,
    buysLeft: p.buys,
  });

  // Triggers: onBuy and onGain are different windows (12.3).
  s = fireInstanceTriggers(s, 'onBuy', player, iid, 0);
  s = fireInstanceTriggers(s, 'onGain', player, iid, 0);
  for (const other of s.playerOrder) {
    if (other === player) continue;
    s = fireOwnedTriggers(s, 'onOpponentBuy', other, 0);
  }

  // PlayOnBuy fires on purchase, for free.
  const live = s.instances[iid];
  if (live && hasKeyword(s, iid, 'PlayOnBuy') && live.zone !== 'trash') {
    if (live.zone !== 'hand') moveInstance(s, iid, player, 'hand', 'bottom');
    s = playCard(s, player, iid, { free: true, depth: 0 });
  }

  // B14: emptying a pile can trigger the end of the game.
  if (pile.cards.length === 0) {
    appendLog(s, 'pileEmpty', player, { pileId });
    s = fireOwnedTriggers(s, 'onPileEmpty', player, 0);
    s = noteEndCondition(s, player);
  }

  return s;
}

/** Every pile the player could legally buy from right now. */
export function buyablePiles(state: GameState, player: PlayerId): PileId[] {
  const out: PileId[] = [];
  const order = state.shop.order;
  const ids = [...order.resource, ...order.points, ...order.prophet, ...order.draft];
  const seen = new Set<PileId>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (canBuyPile(state, player, id)) out.push(id);
  }
  for (const id of Object.keys(state.shop.piles)) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (canBuyPile(state, player, id)) out.push(id);
  }
  return out;
}

/** Every instance id that currently sits on top of a pile, for the view layer. */
export function pileTops(state: GameState): Record<PileId, InstanceId | null> {
  const out: Record<PileId, InstanceId | null> = {};
  for (const id of Object.keys(state.shop.piles)) out[id] = topOfPile(state, id);
  return out;
}
