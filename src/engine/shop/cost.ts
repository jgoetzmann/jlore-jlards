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

import type { CostMod, Duration, GameState, PileId, PlayerId } from '@engine/types';
import { appendLog, cloneState, clonePile, pileDefId, safeGetCard, withPile } from './util';
import { expiryTurnFor } from './locks';

/** Floors default to 0 unless a card names its own ("Minimum (1)", "minimum 0"). */
export const DEFAULT_COST_FLOOR = 0;

/** A mod still bites while its named turn has not arrived. */
export function costModIsActive(state: GameState, mod: CostMod): boolean {
  if (mod.expiresOnTurn === null || mod.expiresOnTurn === undefined) return true;
  return state.turn < mod.expiresOnTurn;
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

  const variant = state.variants[defId];
  if (variant) cost += variant.costDelta ?? 0;

  if (pile && pile.costOverride !== undefined) cost = pile.costOverride;

  for (const mod of costModStack(state, pileId, buyer)) {
    cost = applyCostMod(cost, mod);
  }

  return Math.round(cost);
}

/** The price with no buyer-specific modifiers — what the shop advertises. */
export function listCostOf(state: GameState, pileId: PileId): number {
  return listCostImpl(state, pileId);
}

/** Deterministic mod id: derived from state alone so `reduce` stays pure (B2). */
function modIdSeed(state: GameState): number {
  let n = state.shop.globalCostMods.length;
  for (const pileId of Object.keys(state.shop.piles)) n += state.shop.piles[pileId].costMods.length;
  return n;
}

/**
 * Build a CostMod with a resolved expiry. `source` is the card or aura name so a
 * log line can say who moved the price.
 */
export function makeCostMod(
  state: GameState,
  source: string,
  duration: Duration,
  opts: { delta?: number; setTo?: number; floor?: number; onlyFor?: PlayerId },
): CostMod {
  const seed = modIdSeed(state);
  const mod: CostMod = {
    id: `cm_${state.turn}_${state.logSeq}_${seed}`,
    floor: opts.floor ?? DEFAULT_COST_FLOOR,
    expiresOnTurn: expiryTurnFor(state, duration),
    source,
  };
  if (opts.delta !== undefined) mod.delta = opts.delta;
  if (opts.setTo !== undefined) mod.setTo = opts.setTo;
  if (opts.onlyFor !== undefined) mod.onlyFor = opts.onlyFor;
  return mod;
}

/**
 * Attach a cost modifier. Pass a pileId for a pile-scoped mod (Scripture of
 * Kwzki, Price Fixing) or null for a global one (The Jlore Must Flow, Invisible
 * Hand, Throttle Markets).
 */
export function addCostMod(state: GameState, pileId: PileId | null, mod: CostMod): GameState {
  if (pileId === null) {
    const next = cloneState(state);
    next.shop.globalCostMods = [...next.shop.globalCostMods, { ...mod }];
    return appendLog(next, 'costModAdded', {
      scope: 'global',
      source: mod.source,
      delta: mod.delta ?? null,
      setTo: mod.setTo ?? null,
      floor: mod.floor,
      expiresOnTurn: mod.expiresOnTurn,
    });
  }
  if (!state.shop.piles[pileId]) return state;
  const next = withPile(state, pileId, (p) => {
    p.costMods = [...p.costMods, { ...mod }];
  });
  return appendLog(next, 'costModAdded', {
    scope: 'pile',
    pileId,
    source: mod.source,
    delta: mod.delta ?? null,
    setTo: mod.setTo ?? null,
    floor: mod.floor,
    expiresOnTurn: mod.expiresOnTurn,
  });
}

/** Apply the same modifier to every pile in one shop. */
export function addShopCostMod(
  state: GameState,
  shop: 'resource' | 'points' | 'prophet' | 'draft',
  mod: CostMod,
): GameState {
  let next = state;
  for (const pileId of state.shop.order[shop]) {
    next = addCostMod(next, pileId, { ...mod, id: `${mod.id}_${pileId}` });
  }
  return next;
}

/** B56. Drop every modifier whose duration has run out, from piles and globals. */
export function expireCostMods(state: GameState): GameState {
  let changed = false;
  const next = cloneState(state);

  const keptGlobal = state.shop.globalCostMods.filter((m) => costModIsActive(state, m));
  if (keptGlobal.length !== state.shop.globalCostMods.length) {
    next.shop.globalCostMods = keptGlobal.map((m) => ({ ...m }));
    changed = true;
  }

  const cleared: PileId[] = [];
  for (const pileId of Object.keys(state.shop.piles)) {
    const pile = state.shop.piles[pileId];
    if (pile.costMods.length === 0) continue;
    const kept = pile.costMods.filter((m) => costModIsActive(state, m));
    if (kept.length === pile.costMods.length) continue;
    const copy = clonePile(pile);
    copy.costMods = kept.map((m) => ({ ...m }));
    next.shop.piles[pileId] = copy;
    cleared.push(pileId);
    changed = true;
  }

  if (!changed) return state;
  return appendLog(next, 'costModsExpired', { piles: cleared });
}

/** Cloud Nine: every price on the board reverts at once. */
export function clearCostMods(state: GameState): GameState {
  const next = cloneState(state);
  let any = state.shop.globalCostMods.length > 0;
  next.shop.globalCostMods = [];
  for (const pileId of Object.keys(state.shop.piles)) {
    const pile = state.shop.piles[pileId];
    if (pile.costMods.length === 0) continue;
    const copy = clonePile(pile);
    copy.costMods = [];
    next.shop.piles[pileId] = copy;
    any = true;
  }
  if (!any) return state;
  return appendLog(next, 'costModsCleared', {});
}

/** Remove one modifier by id, wherever it lives. */
export function removeCostMod(state: GameState, modId: string): GameState {
  const next = cloneState(state);
  next.shop.globalCostMods = next.shop.globalCostMods.filter((m) => m.id !== modId);
  for (const pileId of Object.keys(state.shop.piles)) {
    const pile = state.shop.piles[pileId];
    if (!pile.costMods.some((m) => m.id === modId)) continue;
    const copy = clonePile(pile);
    copy.costMods = copy.costMods.filter((m) => m.id !== modId);
    next.shop.piles[pileId] = copy;
  }
  return next;
}

/**
 * B55. What buying at this price does to the buyer's Money. Positive costs
 * subtract; negative costs credit. `money -= cost` either way, but naming it
 * keeps the sign convention honest at the call site.
 */
export function moneyAfterPurchase(money: number, cost: number): number {
  return money - cost;
}

/** True when the buyer's wallet covers the price. Negative prices always pass. */
export function canAffordMoney(money: number, cost: number): boolean {
  return cost <= 0 || money >= cost;
}

/** Same stack as costOf, minus every mod that names a specific buyer. */
function listCostImpl(state: GameState, pileId: PileId): number {
  const pile = state.shop.piles[pileId];
  const defId = pileDefId(state, pileId);
  if (!defId) return 0;
  const def = safeGetCard(defId);
  let cost = def?.cost.money ?? 0;
  const variant = state.variants[defId];
  if (variant) cost += variant.costDelta ?? 0;
  if (pile && pile.costOverride !== undefined) cost = pile.costOverride;
  const pileMods = pile ? pile.costMods.filter((m) => costModIsActive(state, m)) : [];
  const globalMods = state.shop.globalCostMods.filter((m) => costModIsActive(state, m));
  for (const mod of [...pileMods, ...globalMods]) {
    if (isBuyerSpecific(mod)) continue;
    cost = applyCostMod(cost, mod);
  }
  return Math.round(cost);
}
