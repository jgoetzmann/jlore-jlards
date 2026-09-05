/**
 * Pile mechanics. B49: a pile is an ordered stack, top first — `cards[0]` is the
 * card the next buyer gets. Water Into Swine, Crop Dusting, Supernova,
 * Chron Cache, The Big Backening and Missed Vintage all read or write that slot
 * specifically, so top-of-pile is a first-class operation here.
 */

import type {
  CardDefId,
  CardInstance,
  GameState,
  InstanceId,
  Pile,
  PileId,
  Stats,
} from '@engine/types';
import type { Rng } from '@engine/rng';
import { moveInstance } from '@engine/core/zones';
import {
  appendLog,
  cloneState,
  clonePile,
  makePileId,
  nextIid,
  pileDefId,
  safeGetCard,
  withPile,
} from './util';

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function getPile(state: GameState, pileId: PileId): Pile | null {
  return state.shop.piles[pileId] ?? null;
}

/** B49. The instance a buyer would take right now, or null for an empty pile. */
export function topOf(state: GameState, pileId: PileId): InstanceId | null {
  const pile = state.shop.piles[pileId];
  if (!pile || pile.cards.length === 0) return null;
  return pile.cards[0];
}

export function pileHeight(state: GameState, pileId: PileId): number {
  const pile = state.shop.piles[pileId];
  return pile ? pile.cards.length : 0;
}

export function isPileEmpty(state: GameState, pileId: PileId): boolean {
  return pileHeight(state, pileId) === 0;
}

export function emptyPileIds(
  state: GameState,
  shop?: 'resource' | 'points' | 'prophet' | 'draft',
): PileId[] {
  const out: PileId[] = [];
  for (const id of Object.keys(state.shop.piles)) {
    const pile = state.shop.piles[id];
    if (shop && pile.shop !== shop) continue;
    if (pile.cards.length === 0) out.push(id);
  }
  return out;
}

/** All pile ids in a shop, in stable display order. */
export function pileIdsIn(
  state: GameState,
  shop: 'resource' | 'points' | 'prophet' | 'draft',
): PileId[] {
  return [...state.shop.order[shop]];
}

/** The pile a shop instance currently sits in, if any. */
export function pileOfInstance(state: GameState, iid: InstanceId): PileId | null {
  const inst = state.instances[iid];
  if (!inst || inst.zone !== 'shop') return null;
  return inst.pileId ?? null;
}

// ---------------------------------------------------------------------------
// Instance construction
// ---------------------------------------------------------------------------

/**
 * Mint one physical card into a shop pile. Returns the new state plus the id so
 * callers can immediately push it somewhere.
 */
export function createShopInstance(
  state: GameState,
  defId: CardDefId,
  pileId: PileId,
  opts?: { counters?: Record<string, number>; statDelta?: Stats },
): { state: GameState; iid: InstanceId } {
  const seq = state.nextInstanceSeq;
  const iid = nextIid(seq);
  const inst: CardInstance = {
    iid,
    defId,
    owner: null,
    zone: 'shop',
    pileId,
    addedKeywords: [],
    removedKeywords: [],
    counters: opts?.counters ? { ...opts.counters } : {},
    statDelta: opts?.statDelta ? { ...opts.statDelta } : {},
    extraEffects: [],
    playedOnTurn: null,
  };
  const next: GameState = {
    ...state,
    instances: { ...state.instances, [iid]: inst },
    nextInstanceSeq: seq + 1,
  };
  return { state: next, iid };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** B49. Remove and return the top card. The buy path goes through here. */
export function takeTop(
  state: GameState,
  pileId: PileId,
): { state: GameState; iid: InstanceId | null } {
  const pile = state.shop.piles[pileId];
  if (!pile || pile.cards.length === 0) return { state, iid: null };
  const iid = pile.cards[0];
  const next = withPile(state, pileId, (p) => {
    p.cards = p.cards.slice(1);
  });
  return { state: next, iid };
}

/** Remove a specific instance from whatever pile holds it. */
export function removeFromPile(state: GameState, iid: InstanceId): GameState {
  const pileId = pileOfInstance(state, iid);
  if (!pileId) return state;
  return withPile(state, pileId, (p) => {
    p.cards = p.cards.filter((x) => x !== iid);
  });
}

/**
 * B49. Put an existing instance on top of a pile. `addToPileTop` and the cards
 * that seed a pile with something unexpected land here.
 */
export function pushTop(state: GameState, pileId: PileId, iid: InstanceId): GameState {
  const pile = state.shop.piles[pileId];
  if (!pile) return state;
  const stripped = removeFromPile(state, iid);
  const next = withPile(stripped, pileId, (p) => {
    p.cards = [iid, ...p.cards.filter((x) => x !== iid)];
  });
  const inst = next.instances[iid];
  if (!inst) return next;
  return {
    ...next,
    instances: {
      ...next.instances,
      [iid]: { ...inst, zone: 'shop', owner: null, pileId },
    },
  };
}

export function pushBottom(state: GameState, pileId: PileId, iid: InstanceId): GameState {
  const pile = state.shop.piles[pileId];
  if (!pile) return state;
  const stripped = removeFromPile(state, iid);
  const next = withPile(stripped, pileId, (p) => {
    p.cards = [...p.cards.filter((x) => x !== iid), iid];
  });
  const inst = next.instances[iid];
  if (!inst) return next;
  return {
    ...next,
    instances: {
      ...next.instances,
      [iid]: { ...inst, zone: 'shop', owner: null, pileId },
    },
  };
}

/** Mint `count` fresh copies of `defId` onto the top of a pile. */
export function addToPileTop(
  state: GameState,
  pileId: PileId,
  defId: CardDefId,
  count = 1,
  costOverride?: number,
): GameState {
  if (!state.shop.piles[pileId]) return state;
  let next = state;
  for (let i = 0; i < Math.max(0, count); i += 1) {
    const made = createShopInstance(next, defId, pileId);
    next = pushTop(made.state, pileId, made.iid);
  }
  if (costOverride !== undefined) {
    next = withPile(next, pileId, (p) => {
      p.costOverride = costOverride;
    });
  }
  if (!next.defsInMatch.includes(defId)) {
    next = { ...next, defsInMatch: [...next.defsInMatch, defId] };
  }
  return appendLog(next, 'pileTopAdded', { pileId, defId, count });
}

/**
 * Refill a pile back to its starting height with fresh copies of what it sells.
 * The rng cursor is carried forward so a replenish stays visible in the
 * deterministic stream even though refilling itself needs no randomness.
 */
export function replenish(state: GameState, pileId: PileId, rng: Rng): GameState {
  const pile = state.shop.piles[pileId];
  if (!pile) return state;
  const missing = pile.startingSize - pile.cards.length;
  if (missing <= 0) return state;
  const defId = pileDefId(state, pileId);
  if (!defId || !safeGetCard(defId)) return state;
  let next = state;
  const minted: InstanceId[] = [];
  for (let i = 0; i < missing; i += 1) {
    const made = createShopInstance(next, defId, pileId);
    next = made.state;
    minted.push(made.iid);
  }
  next = withPile(next, pileId, (p) => {
    p.cards = [...p.cards, ...minted];
  });
  next = { ...next, rngCursor: Math.max(next.rngCursor, rng.cursor()) };
  return appendLog(next, 'pileReplenished', { pileId, defId, added: minted.length });
}

/** Every card in the pile goes to the trash zone; the pile stays as an empty pile. */
export function trashPile(state: GameState, pileId: PileId): GameState {
  const pile = state.shop.piles[pileId];
  if (!pile || pile.cards.length === 0) return state;
  const doomed = [...pile.cards];
  let next = withPile(state, pileId, (p) => {
    p.cards = [];
  });
  for (const iid of doomed) {
    const inst = next.instances[iid];
    if (!inst) continue;
    const def = safeGetCard(inst.defId);
    const indestructible =
      inst.addedKeywords.includes('Indestructible') ||
      (!!def &&
        def.keywords.includes('Indestructible') &&
        !inst.removedKeywords.includes('Indestructible'));
    if (indestructible) {
      // B40 in spirit: Indestructible beats every trash source, so it stays put.
      next = withPile(next, pileId, (p) => {
        p.cards = [...p.cards, iid];
      });
      continue;
    }
    // `moveInstance` (core/zones) mutates the draft in place and returns void
    // per Addendum A5. `next` is already a detached clone from `withPile`, so
    // mutating it here is safe and no post-move fixup is needed: the move sets
    // `zone`, `owner` and clears `pileId` itself.
    moveInstance(next, iid, inst.owner, 'trash');
  }
  return appendLog(next, 'pileTrashed', { pileId, count: doomed.length });
}

/**
 * Fold `sourceId` into `targetId`: source cards go under the target's stack, the
 * source pile is removed from the board and from display order.
 */
export function mergePiles(state: GameState, targetId: PileId, sourceId: PileId): GameState {
  if (targetId === sourceId) return state;
  const target = state.shop.piles[targetId];
  const source = state.shop.piles[sourceId];
  if (!target || !source) return state;

  const next = cloneState(state);
  const merged = clonePile(target);
  merged.cards = [...target.cards, ...source.cards];
  merged.startingSize = target.startingSize + source.startingSize;
  merged.locks = [
    ...target.locks.map((l) => ({ ...l })),
    ...source.locks.map((l) => ({ ...l })),
  ];
  merged.costMods = [
    ...target.costMods.map((m) => ({ ...m })),
    ...source.costMods.map((m) => ({ ...m })),
  ];
  next.shop.piles[targetId] = merged;
  delete next.shop.piles[sourceId];

  const shops: ('resource' | 'points' | 'prophet' | 'draft')[] = [
    'resource',
    'points',
    'prophet',
    'draft',
  ];
  for (const s of shops) {
    next.shop.order[s] = next.shop.order[s].filter((id) => id !== sourceId);
  }

  const instances = { ...next.instances };
  for (const iid of source.cards) {
    const inst = instances[iid];
    if (inst) instances[iid] = { ...inst, pileId: targetId };
  }
  next.instances = instances;

  return appendLog(next, 'pilesMerged', { targetId, sourceId, height: merged.cards.length });
}

/**
 * Swap the standing price of two piles by writing each pile's current effective
 * base cost into the other's `costOverride`. Buyer-specific and timed modifiers
 * are deliberately left alone — only the printed price trades places.
 */
export function swapCosts(state: GameState, aId: PileId, bId: PileId): GameState {
  if (aId === bId) return state;
  const a = state.shop.piles[aId];
  const b = state.shop.piles[bId];
  if (!a || !b) return state;
  const aCost = printedCostOf(state, aId);
  const bCost = printedCostOf(state, bId);
  let next = withPile(state, aId, (p) => {
    p.costOverride = bCost;
  });
  next = withPile(next, bId, (p) => {
    p.costOverride = aCost;
  });
  return appendLog(next, 'pileCostsSwapped', { aId, bId, aCost: bCost, bCost: aCost });
}

/**
 * Base + variant + pile override, with no timed modifiers and no buyer. This is
 * the number a pile "prints"; `costOf` layers the modifier stack on top of it.
 */
export function printedCostOf(state: GameState, pileId: PileId): number {
  const pile = state.shop.piles[pileId];
  const defId = pileDefId(state, pileId);
  if (!defId) return 0;
  const def = safeGetCard(defId);
  let cost = def?.cost.money ?? 0;
  const variant = state.variants[defId];
  if (variant) cost += variant.costDelta ?? 0;
  if (pile && pile.costOverride !== undefined) cost = pile.costOverride;
  return Math.round(cost);
}

/** Which pile sells this definition, if any. */
export function pileForDef(state: GameState, defId: CardDefId): PileId | null {
  const shops: ('resource' | 'points' | 'prophet' | 'draft')[] = [
    'resource',
    'points',
    'prophet',
    'draft',
  ];
  for (const s of shops) {
    const candidate = makePileId(s, defId);
    if (state.shop.piles[candidate]) return candidate;
  }
  for (const id of Object.keys(state.shop.piles)) {
    if (pileDefId(state, id) === defId) return id;
  }
  return null;
}
