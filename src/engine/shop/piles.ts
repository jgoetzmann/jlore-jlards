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
import {
  appendLog,
  nextIid,
  pileDefId,
  safeGetCard,
  withPile,
} from './util';

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

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
