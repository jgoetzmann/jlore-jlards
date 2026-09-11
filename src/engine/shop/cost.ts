/**
 * Cost resolution. B53, B54, B55, B56.
 *
 * The order in B54 is the whole contract:
 *
 *   base def.cost.money
 *     -> variant.costDelta
 *     -> pile.costOverride
 *     -> pile.costMods, in array order
 *     -> shop.globalCostMods, in array order
 *     -> every mod whose `onlyFor` names this buyer, pile mods then global mods
 *
 * Each modifier clamps to *its own* floor, not to a shared one (B53), and a
 * modifier carrying `setTo` throws away every delta applied before it. The
 * result is a signed integer that may legitimately be negative (B55) — Series C
 * Funding at -3 credits the buyer 3 Money.
 */

import type { CostMod, Duration, GameState, NextCardMod, PileId, PlayerId, Zone } from '@engine/types';
import { pileDefId, safeGetCard } from './util';
import { expiryTurnFor } from './locks';
import { dynamicPriceFor } from './dynamic';

/** Floors default to 0 unless a card names its own ("Minimum (1)", "minimum 0"). */
export const DEFAULT_COST_FLOOR = 0;

/**
 * B56. A cost mod's `expiresOnTurn` names the **last turn it still bites**: it
 * applies for the whole of that turn and is swept when that turn ends. That is
 * one turn earlier than a `PileLock`'s `expiresOnTurn`, which names the first
 * turn the lock is already gone -- see `costModExpiryFor` below, which converts
 * between the two conventions so both durations mean the same span of play.
 */
export function costModIsActive(state: GameState, mod: CostMod): boolean {
  if (mod.expiresOnTurn === null || mod.expiresOnTurn === undefined) return true;
  return state.turn <= mod.expiresOnTurn;
}

/**
 * The last turn a mod of this duration still bites. `expiryTurnFor` returns the
 * first turn a lock of the same duration is gone, so a cost mod's turn is one
 * lower.
 */
export function costModExpiryFor(state: GameState, duration: Duration): number | null {
  const gone = expiryTurnFor(state, duration);
  return gone === null ? null : gone - 1;
}

function appliesToBuyer(mod: CostMod, buyer: PlayerId): boolean {
  return mod.onlyFor === undefined || mod.onlyFor === buyer;
}

function isBuyerSpecific(mod: CostMod): boolean {
  return mod.onlyFor !== undefined;
}

/** Apply one modifier to a running cost, honouring setTo and the mod's own floor. */
export function applyCostMod(cost: number, mod: CostMod): number {
  let out = cost;
  if (mod.setTo !== undefined) {
    out = mod.setTo;
  } else if (mod.delta !== undefined) {
    out += mod.delta;
  }
  const floor = mod.floor ?? DEFAULT_COST_FLOOR;
  if (out < floor) out = floor;
  return out;
}

/**
 * The ordered modifier stack a given buyer faces on a given pile. Exported
 * because the view layer wants to explain a price, not just print it.
 */
export function costModStack(state: GameState, pileId: PileId, buyer: PlayerId): CostMod[] {
  const pile = state.shop.piles[pileId];
  const pileMods = pile ? pile.costMods.filter((m) => costModIsActive(state, m)) : [];
  const globalMods = state.shop.globalCostMods.filter((m) => costModIsActive(state, m));
  const relevant = (mods: CostMod[], buyerSpecific: boolean) =>
    mods.filter((m) => appliesToBuyer(m, buyer) && isBuyerSpecific(m) === buyerSpecific);
  return [
    ...relevant(pileMods, false),
    ...relevant(globalMods, false),
    ...relevant(pileMods, true),
    ...relevant(globalMods, true),
  ];
}

/**
 * B54. The current Money price of a pile for one buyer. Signed: negative means
 * the purchase pays out.
 */
export function costOf(state: GameState, pileId: PileId, buyer: PlayerId): number {
  const pile = state.shop.piles[pileId];
  const defId = pileDefId(state, pileId);
  if (!defId) return 0;
  const def = safeGetCard(defId);

  let cost = def?.cost.money ?? 0;

  // A few cards print a price that is a reading of the board rather than a
  // number — "costs (0) if your hand is empty", Lead's per-turn reroll. Those
  // replace the printed cost here, ahead of the modifier stack, so an ordinary
  // discount still applies on top of them.
  const dynamic = dynamicPriceFor(state, defId, buyer);
  if (dynamic !== null) cost = dynamic;

  const variant = state.variants[defId];
  if (variant) cost += variant.costDelta ?? 0;

  if (pile && pile.costOverride !== undefined) cost = pile.costOverride;

  for (const mod of costModStack(state, pileId, buyer)) {
    cost = applyCostMod(cost, mod);
  }

  return Math.round(cost);
}

/** True when the buyer's wallet covers the price. Negative prices always pass. */
export function canAffordMoney(money: number, cost: number): boolean {
  return cost <= 0 || money >= cost;
}

// ---------------------------------------------------------------------------
// Next-buy modifiers (Miracle Prep, Express Shipping)
// ---------------------------------------------------------------------------

/**
 * A player's pending "your next buy costs N less" modifiers, folded together.
 *
 * This lives here, next to `costOf`, because it is part of the price: every
 * reader that asks what a pile costs a given buyer has to apply it, and the two
 * that did not agree were the whole of the Miracle Prep bug. `core/buy.ts`
 * consumes these on a purchase; nothing in this module mutates them.
 */
export interface BuyMods {
  costDelta: number;
  costFloor: number | null;
  buyTo: Zone | null;
}

export function peekBuyMods(state: GameState, player: PlayerId): BuyMods {
  const out: BuyMods = { costDelta: 0, costFloor: null, buyTo: null };
  const p = state.players[player];
  if (!p) return out;
  for (const mod of p.nextCardMods as NextCardMod[]) {
    if (mod.appliesTo !== 'buy') continue;
    if (mod.costDelta) out.costDelta += mod.costDelta;
    if (mod.costFloor !== undefined) {
      out.costFloor = out.costFloor === null ? mod.costFloor : Math.max(out.costFloor, mod.costFloor);
    }
    if (mod.buyTo) out.buyTo = mod.buyTo;
  }
  return out;
}

/** `base` after one set of next-buy modifiers, with the modifier's own floor. */
export function applyBuyMods(base: number, mods: BuyMods): number {
  let price = base + mods.costDelta;
  if (mods.costFloor !== null && price < mods.costFloor) price = mods.costFloor;
  return Math.round(price);
}

/**
 * What this pile actually costs this buyer right now: the modifier stack (B54)
 * and then any pending next-buy modifier.
 *
 * The single source of truth for the price. `canBuy` here, `canBuyPile` and
 * `buyCard` in `core/buy.ts`, and the price the view prints all read it, so a
 * pile the table shows at (1) is a pile the engine sells at 1 and gates at 1.
 */
export function priceOfPileFor(state: GameState, pileId: PileId, buyer: PlayerId): number {
  const base = costOf(state, pileId, buyer);
  return applyBuyMods(Number.isFinite(base) ? base : 0, peekBuyMods(state, buyer));
}
