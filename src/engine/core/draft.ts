/**
 * The Draft (`config.draftMode`).
 *
 * Instead of sampling the Draft Shop and the Prophet Shop, the players fill
 * them before turn play starts. Every Draft Shop slot is a choice of 4 cards,
 * every Prophet Shop slot a choice of 2, and each slot belongs to one player.
 *
 *   Deal   `dealDraft`, from `createMatch`, after the anomaly setup (so the
 *          SB-28 exclusions and `pileSizeScale` are already in force). Both
 *          candidate pools are shuffled once with the seeded rng and dealt out
 *          front to back, so every card shown to every player is distinct:
 *          there is no replacement to collide with.
 *   Short  A pool too small for full sets shrinks the sets instead of failing
 *          (the owner's ruling). Walking the slots round-robin by seat, each
 *          slot takes `min(setSize, cardsLeft - slotsLeftAfterIt)` cards and
 *          never fewer than 1 while any remain: 18 cards over 10 slots of 4 is
 *          4, 4, 3, 1, 1, 1, 1, 1, 1, 1. A 1-card set is not a choice, so it is
 *          picked at deal time. A slot past the last card gets none and makes no
 *          pile. Round-robin spreads the shrinking over every seat.
 *   Slots  Divided as evenly as possible; the leftovers go to players in
 *          seating order. Each player's slots are stored contiguously, seating
 *          order, Draft Shop slots before Prophet Shop slots.
 *   Picks  `draftPick`, from anyone, in any order (everyone drafts at once).
 *          While a draft runs, `reduce` refuses every other action.
 *   Build  When no slot is left to choose, the picks become the Draft and
 *          Prophet piles in slot order, through the same pile construction the
 *          sampled shops use (`addSampledPiles`), and `draft` goes back to null.
 *
 * Draft Shop candidates are `draftCandidates`, Prophet Shop candidates are
 * `prophetCandidates`; the two sets are disjoint, so "one shared pool" is the
 * catalog partitioned by which shop a card may sit in.
 */

import type {
  CardDefId,
  CardDefinition,
  CardView,
  DraftSlot,
  DraftState,
  DraftView,
  GameAction,
  GameState,
  PlayerId,
} from '@engine/types';
import type { Rng } from '@engine/rng';
import {
  addSampledPiles,
  draftCandidates,
  draftSlotCount,
  prophetCandidates,
  prophetSlotCount,
} from '@engine/shop';
import { applyAnomalyToDraftedPiles } from '@engine/meta';
import { getCard } from '@engine/registry';
import { appendLog, logReject } from './log.js';
import { advanceTurn, startTurn } from './turn.js'; // ---- fix:draft ----
import { finishGame } from './endgame.js'; // ---- fix:draft ----

/** Cards offered per Draft Shop slot. */
export const DRAFT_OPTIONS_PER_SLOT = 4;
/** Cards offered per Prophet Shop slot. */
export const PROPHET_OPTIONS_PER_SLOT = 2;

/**
 * `total` slots split across `players` seats as evenly as possible, the
 * leftovers going one each to the earliest seats: 10 over 3 is [4, 3, 3].
 */
export function divideSlots(total: number, players: number): number[] {
  const n = Math.max(1, Math.floor(players));
  const t = Math.max(0, Math.floor(total));
  const base = Math.floor(t / n);
  const extra = t % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * How many cards each of `slots` slots (in sizing order) is offered from a pool
 * of `cards`: at most `setSize`, one card held back for every later slot, never
 * fewer than 1 while cards remain, 0 once they have run out.
 */
export function draftSetSizes(cards: number, slots: number, setSize: number): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.floor(cards));
  const n = Math.max(0, Math.floor(slots));
  for (let i = 0; i < n; i++) {
    const later = n - i - 1;
    const size = left > 0 ? Math.max(1, Math.min(setSize, left - later)) : 0;
    out.push(size);
    left -= size;
  }
  return out;
}

/** Card sets for one shop, keyed `seat:nth`, sized round-robin by seat. */
function dealSets(share: readonly number[], deck: readonly CardDefId[], setSize: number): Map<string, CardDefId[]> {
  const walk: string[] = [];
  const rounds = Math.max(0, ...share);
  for (let r = 0; r < rounds; r++) {
    share.forEach((count, seat) => {
      if (count > r) walk.push(`${seat}:${r}`);
    });
  }
  const sizes = draftSetSizes(deck.length, walk.length, setSize);
  const out = new Map<string, CardDefId[]>();
  let at = 0;
  walk.forEach((key, i) => {
    const size = sizes[i] ?? 0;
    out.set(key, deck.slice(at, at + size));
    at += size;
  });
  return out;
}

/**
 * The slots for a table, from already-shuffled decks. Pure, so the sizing rule
 * is testable against a pool of any size.
 */
export function dealDraftSlots(
  order: readonly PlayerId[],
  counts: { draft: number; prophet: number },
  decks: { draft: readonly CardDefId[]; prophet: readonly CardDefId[] },
): DraftSlot[] {
  const draftShare = divideSlots(counts.draft, order.length);
  const prophetShare = divideSlots(counts.prophet, order.length);
  const draftSets = dealSets(draftShare, decks.draft, DRAFT_OPTIONS_PER_SLOT);
  const prophetSets = dealSets(prophetShare, decks.prophet, PROPHET_OPTIONS_PER_SLOT);

  const slots: DraftSlot[] = [];
  const push = (kind: DraftSlot['kind'], player: PlayerId, options: CardDefId[]): void => {
    // A single card is not a choice: it is picked here and never shown as one.
    slots.push({ index: slots.length, kind, player, options, pick: options.length === 1 ? options[0]! : null });
  };
  order.forEach((player, seat) => {
    for (let i = 0; i < (draftShare[seat] ?? 0); i++) push('draft', player, draftSets.get(`${seat}:${i}`) ?? []);
    for (let i = 0; i < (prophetShare[seat] ?? 0); i++) push('prophet', player, prophetSets.get(`${seat}:${i}`) ?? []);
  });
  return slots;
}

/** A slot still waiting on its player: unpicked and holding cards to pick from. */
export function isOpenSlot(slot: DraftSlot): boolean {
  return slot.pick === null && slot.options.length > 0;
}

/**
 * Deal the Draft onto a match being built. Mutates and returns `state`, and
 * advances `rng`; the caller writes the cursor back. Never throws for a small
 * pool: the sets shrink. When no slot is left to choose, the shops are built
 * at once.
 */
export function dealDraft(state: GameState, rng: Rng): GameState {
  const order = state.playerOrder;
  const draftSlots = draftSlotCount(state);
  const prophetSlots = prophetSlotCount(state);

  // Draw everything up front, without replacement.
  const draftPool = draftCandidates(state);
  const prophetPool = prophetCandidates(state);
  const draftDeck = rng.shuffle(draftPool.map((d) => d.id));
  const prophetDeck = rng.shuffle(prophetPool.map((d) => d.id));

  const slots = dealDraftSlots(order, { draft: draftSlots, prophet: prophetSlots }, { draft: draftDeck, prophet: prophetDeck });
  state.draft = { slots };

  // Counts only: which cards anyone was offered is theirs to see (viewFor).
  appendLog(state, 'draftDealt', null, {
    draftSlots,
    prophetSlots,
    draftPool: draftPool.length,
    prophetPool: prophetPool.length,
    remaining: draftRemaining(state.draft, order),
  });

  if (!slots.some(isOpenSlot)) return finishDraft(state);
  return state;
}

/** How many slots each player has left to pick. */
export function draftRemaining(draft: DraftState, order: readonly PlayerId[]): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {};
  for (const pid of order) out[pid] = 0;
  for (const slot of draft.slots) {
    if (isOpenSlot(slot)) out[slot.player] = (out[slot.player] ?? 0) + 1;
  }
  return out;
}

/** Every pick this player could send right now (B25: nothing `reduce` refuses). */
export function legalDraftPicks(state: GameState, player: PlayerId): GameAction[] {
  if (!state.draft) return [];
  const out: GameAction[] = [];
  for (const slot of state.draft.slots) {
    if (slot.player !== player || !isOpenSlot(slot)) continue;
    for (const defId of slot.options) out.push({ type: 'draftPick', player, slot: slot.index, defId });
  }
  return out;
}

/**
 * `reduce`'s draftPick branch. `s` is reduce's private draft of the state and
 * may be mutated. Every path logs (B118).
 */
export function applyDraftPick(
  s: GameState,
  action: { player: PlayerId; slot: number; defId: CardDefId },
): GameState {
  const draft = s.draft;
  if (!draft) return logReject(s, 'noDraft', action.player, {});
  if (!s.players[action.player]) return logReject(s, 'unknownPlayer', action.player, {});
  const slot = Number.isInteger(action.slot) ? draft.slots[action.slot] : undefined;
  if (!slot) return logReject(s, 'draftNoSuchSlot', action.player, { slot: action.slot });
  if (slot.player !== action.player) {
    return logReject(s, 'draftNotYourSlot', action.player, { slot: slot.index });
  }
  if (slot.pick !== null) return logReject(s, 'draftAlreadyPicked', action.player, { slot: slot.index });
  if (typeof action.defId !== 'string' || !slot.options.includes(action.defId)) {
    return logReject(s, 'draftNotAnOption', action.player, { slot: slot.index });
  }

  slot.pick = action.defId;
  // The pick itself stays out of the log until the shops are built: what the
  // others chose is not on the table yet.
  appendLog(s, 'draftPick', action.player, { slot: slot.index, kind: slot.kind });

  if (draft.slots.some(isOpenSlot)) return s;
  return finishDraft(s);
}

// ---- fix:draft ---- nobody stalls a draft forever (SB-69)
/**
 * Pick `options[0]` for every open slot whose player `who` accepts, in slot
 * order, each logged as an automatic `draftPick`. Builds the shops when that
 * leaves nothing to choose. Deterministic, so every browser folds the same.
 */
export function autoPickDraftSlots(s: GameState, who: (player: PlayerId) => boolean): GameState {
  const draft = s.draft;
  if (!draft) return s;
  for (const slot of draft.slots) {
    if (!who(slot.player) || !isOpenSlot(slot)) continue;
    slot.pick = slot.options[0]!;
    appendLog(s, 'draftPick', slot.player, { slot: slot.index, kind: slot.kind, auto: true });
  }
  if (draft.slots.some(isOpenSlot)) return s;
  return finishDraft(s);
}

/**
 * `reduce`'s concede while a draft runs. Concede is exempt from the drafting
 * gate, from any player (everyone drafts at once): the conceder is eliminated
 * and their open slots are auto-picked. A concession that ends the game closes
 * the draft for everyone, so the finished table has its shops; otherwise a
 * conceding active player passes the turn, exactly as a concession in turn
 * play does. Every path logs (B118).
 */
export function applyDraftConcede(s: GameState, player: PlayerId): GameState {
  const p = s.players[player];
  if (!p) return logReject(s, 'unknownPlayer', player, {});
  if (p.eliminated) return logReject(s, 'eliminated', player, { action: 'concede' });
  p.eliminated = true;
  appendLog(s, 'concede', player, {});
  const alive = s.playerOrder.filter((id) => !s.players[id]?.eliminated);
  if (alive.length <= 1) return finishGame(autoPickDraftSlots(s, () => true), 'concession');
  let next = autoPickDraftSlots(s, (pid) => pid === player);
  if (next.activePlayer === player) next = startTurn(advanceTurn(next));
  return next;
}
// ---- /fix:draft ----

function picksOf(draft: DraftState, kind: DraftSlot['kind']): CardDefinition[] {
  const out: CardDefinition[] = [];
  for (const slot of draft.slots) {
    if (slot.kind === kind && slot.pick !== null) out.push(getCard(slot.pick));
  }
  return out;
}

/** Nothing left to choose: build both shops from the picks and end the Draft. */
function finishDraft(s: GameState): GameState {
  const draft = s.draft as DraftState;
  const prophetDefs = picksOf(draft, 'prophet');
  const draftDefs = picksOf(draft, 'draft');

  // Same order as `buildShop`: Prophet piles, then Draft piles. A slot that was
  // dealt no cards has no pick and makes no pile.
  let next = addSampledPiles(s, 'prophet', prophetDefs);
  next = addSampledPiles(next, 'draft', draftDefs);
  next = applyAnomalyToDraftedPiles(next, [...next.shop.order.prophet, ...next.shop.order.draft]);

  // B92: every definition present in the match enters every codex.
  for (const pid of next.playerOrder) {
    const p = next.players[pid];
    if (!p) continue;
    for (const def of [...prophetDefs, ...draftDefs]) if (!p.codex.includes(def.id)) p.codex.push(def.id);
  }

  next.draft = null;
  return appendLog(next, 'draftComplete', null, {
    draftDefs: draftDefs.map((d) => d.id),
    prophetDefs: prophetDefs.map((d) => d.id),
  });
}

/** The viewer's own slots as printed faces, plus everyone's remaining count. */
export function draftViewFor(
  state: GameState,
  viewer: PlayerId,
  face: (defId: CardDefId, key: string) => CardView,
): DraftView | null {
  const draft = state.draft;
  if (!draft) return null;
  return {
    slots: draft.slots
      .filter((slot) => slot.player === viewer)
      .map((slot) => ({
        index: slot.index,
        kind: slot.kind,
        options: slot.options.map((defId, i) => face(defId, `draft_${slot.index}_${i}`)),
        pick: slot.pick,
      })),
    remaining: draftRemaining(draft, state.playerOrder),
  };
}
