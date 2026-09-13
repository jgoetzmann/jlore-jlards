/**
 * Premoves (SB-68): take your turn's actions while someone else's turn is still
 * resolving.
 *
 * Everything here is pure and speculative. The shared state only ever changes
 * through real intents (SB-65); a premove lives in this browser as a queue
 * entry and is shown on a hypothetical branch of the match:
 *
 *   branch = the authoritative state, advanced by ending every intervening
 *            turn (`advanceToTurnOf`), then each queued premove applied in order.
 *
 * Every time the authoritative state changes the queue is folded again. The
 * active player is authoritative: a premove whose target changed under it (the
 * card was transformed or removed, a pile's top or price moved) or that `reduce`
 * now refuses is invalid, and it and everything queued after it are dropped.
 *
 * The part that needs care is what the dropped preview already SHOWED. A draw
 * revealed the top of a library, a Discover revealed what the rng would offer, a
 * `random` op revealed which branch it would take. Replaying the same premove
 * later would show exactly the same thing, so a player could scout their deck by
 * premoving a draw, getting rolled back, and drawing again. So a rollback leaves
 * a `reroll` entry where the dropped premoves were. On your turn it goes out as
 * an ordinary `reroll` action: the rng cursor jumps past every position any
 * preview of the dropped entries consumed, and your library is reshuffled if
 * they revealed it, so what the player saw predicts nothing.
 *
 * Three rules go beyond "refused or `expect` changed", each to close a scouting
 * path a plain refusal check would miss:
 *
 *   drift     A premove that revealed a library is invalid once that library's
 *             order changed under it (an opponent put a card on top of it, or
 *             milled it). Otherwise the preview would quietly start showing the
 *             next card down, and the player would have seen both.
 *   prompt    A premove that opens a prompt is the last one (premoves end at a
 *             prompt, which is answered live). One that newly opens a prompt with
 *             more premoves queued behind it is invalid, so a reroll can never sit
 *             behind a prompt, where a batch would never reach it.
 *   opponent  A premove that reveals, moves or reorders a card in another
 *             player's library, or names or moves a card in another player's hand,
 *             is invalid: refused when queued, rolled back if a later fold hits it.
 *             The branch dealt the players before you their next hands, and a
 *             reroll may only reshuffle the premover's own library, so nothing a
 *             premove shows may come from anyone else's hidden cards.
 *
 * And `exposure` is kept across folds rather than read off the last one: the
 * preview is refolded on every change, and each fold may have consumed a
 * different stretch of the rng. The reroll covers all of them.
 *
 * Committed entries: once an entry's preview (or a later entry's, which built on
 * it) revealed hidden information, Clear cannot remove it. It runs on your turn
 * or a forced rollback drops it (owing a reroll). Otherwise Clear would be a
 * mulligan: look at the draw, clear it if it is bad.
 *
 * The tracker survives a reload (`serializeTracker`, SB-68 persistence): the
 * seat comes back from its cookie, so the debt has to come back too.
 *
 * No React here, and nothing but the engine and lockstep's refusal check.
 */

import { reduce as engineReduce } from '@engine/index';
import { costOf } from '@engine/shop/cost';
import type { AuraId, CardDefId, GameAction, GameState, InstanceId, PileId, PlayerId } from '@engine/types';
import { isRejected, MAX_BATCH } from './lockstep';

type ReduceFn = (state: GameState, action: GameAction) => GameState;

/** The actions a player may premove. Never resolve, endTurn, concede, start or a draft pick. */
export type PremoveAction = Extract<GameAction, { type: 'play' | 'buy' | 'activateAura' | 'reorderHand' }>;

/**
 * What a premove referred to when it was made. A premove whose referent no
 * longer matches is invalid:
 *   play          { iid, defId }           the card is gone from your hand, or transformed
 *   buy           { pileId, topDefId, cost } the pile's top card or its price changed
 *   activateAura  { auraId }               the aura left your field
 *   reorderHand   {}                        (reduce refuses a hand that no longer matches)
 */
export interface PremoveExpect {
  iid?: InstanceId;
  defId?: CardDefId | null;
  pileId?: PileId;
  topDefId?: CardDefId | null;
  cost?: number | null;
  auraId?: AuraId;
}

export interface PremoveActionEntry {
  kind: 'action';
  action: PremoveAction;
  expect: PremoveExpect;
}

export interface PremoveRerollEntry {
  kind: 'reroll';
  /** Players whose library order the dropped preview revealed or changed. */
  libraries: PlayerId[];
  /** The rng cursor after the dropped preview: nothing before it may be reused. */
  skipTo: number;
}

export type PremoveEntry = PremoveActionEntry | PremoveRerollEntry;

export type PremoveInvalid = 'expect' | 'refused' | 'prompt' | 'drift' | 'opponent';

export interface PremoveFold {
  queue: readonly PremoveEntry[];
  /** The branch after every applied entry. */
  branch: GameState;
  /** states[0] is the branch before entry 0; states[i + 1] is after entry i. */
  states: GameState[];
  /** Entries applied, rerolls included. */
  applied: number;
  /** Action entries applied. */
  actions: number;
  /** Index of the first invalid entry, or null when every entry applied. */
  invalidAt: number | null;
  reason: PremoveInvalid | null;
  /** The last applied premove left a prompt open: nothing more may be queued. */
  promptOpen: boolean;
}

/**
 * What a complete fold showed, in plain JSON so it survives a reload. The drift
 * rule reads it: each applied entry (by content), the libraries its own step
 * revealed, and every library's order at the start of that branch.
 */
export interface PremoveSeen {
  entries: string[];
  revealed: PlayerId[][];
  start: Record<PlayerId, InstanceId[]>;
}

/** Room left in one intent (MAX_BATCH) for rerolls between the actions. */
export const MAX_PREMOVES = Math.floor((MAX_BATCH - 1) / 2);

const PREMOVABLE = new Set<string>(['play', 'buy', 'activateAura', 'reorderHand']);

export function isPremovable(action: GameAction | null | undefined): action is PremoveAction {
  return !!action && typeof action.type === 'string' && PREMOVABLE.has(action.type);
}

function drafting(state: GameState): boolean {
  // A draft in progress has no turns to premove. `!= null` rather than `!== null`:
  // a snapshot saved before The Draft existed has no field, and reduce's own gate
  // (`if (s.draft)`) reads that as no draft too.
  return state.draft != null;
}

/**
 * The state at the start of `me`'s next turn, if every intervening turn ended
 * now. The state itself when it is already `me`'s turn. Null when that cannot be
 * built: the game is over, a prompt or a draft is open, `me` is out, or a step is
 * refused or stops at a prompt (an end-of-turn trigger that asks something).
 */
export function advanceToTurnOf(
  state: GameState,
  me: PlayerId,
  reduce: ReduceFn = engineReduce,
): GameState | null {
  const mine = state.players[me];
  if (!mine || mine.eliminated) return null;
  let bound = state.playerOrder.length + 1;
  for (const pid of state.playerOrder) bound += Math.max(0, state.players[pid]?.extraTurns ?? 0);
  bound = Math.min(bound, 64);
  let s = state;
  for (let step = 0; ; step++) {
    if (s.ended || s.pending !== null || drafting(s)) return null;
    if (s.activePlayer === me) return s;
    if (step >= bound) return null;
    const next = reduce(s, { type: 'endTurn', player: s.activePlayer });
    if (isRejected(s, next)) return null;
    s = next;
  }
}

function topDefOf(state: GameState, pileId: PileId): CardDefId | null {
  const top = state.shop.piles[pileId]?.cards[0];
  if (top === undefined) return null;
  return state.instances[top]?.defId ?? null;
}

function priceOf(state: GameState, pileId: PileId, me: PlayerId): number | null {
  try {
    return costOf(state, pileId, me);
  } catch {
    return null;
  }
}

/** What `action` refers to on `branch`, recorded when it is queued. */
export function expectFor(branch: GameState, me: PlayerId, action: PremoveAction): PremoveExpect {
  switch (action.type) {
    case 'play':
      return { iid: action.iid, defId: branch.instances[action.iid]?.defId ?? null };
    case 'buy':
      return {
        pileId: action.pileId,
        topDefId: topDefOf(branch, action.pileId),
        cost: priceOf(branch, action.pileId, me),
      };
    case 'activateAura':
      return { auraId: action.auraId };
    default:
      return {};
  }
}

function expectHolds(branch: GameState, me: PlayerId, entry: PremoveActionEntry): boolean {
  const { action, expect } = entry;
  switch (action.type) {
    case 'play': {
      const inst = branch.instances[action.iid];
      if (!inst || inst.defId !== expect.defId) return false;
      return branch.players[me]?.hand.includes(action.iid) ?? false;
    }
    case 'buy':
      return (
        topDefOf(branch, action.pileId) === expect.topDefId &&
        priceOf(branch, action.pileId, me) === expect.cost
      );
    case 'activateAura':
      return branch.players[me]?.field.some((a) => a.auraId === action.auraId) ?? false;
    default:
      return true;
  }
}

export function rerollAction(entry: PremoveRerollEntry, me: PlayerId): GameAction {
  // The engine refuses a reroll that names any library but the actor's own
  // (SB-68). The opponent rule keeps other players' libraries out of every
  // exposure, so this filter is only a backstop: a stray id must not get the
  // whole reroll, cursor skip included, refused.
  return { type: 'reroll', player: me, libraries: entry.libraries.filter((pid) => pid === me), skipTo: entry.skipTo };
}

export function entryAction(entry: PremoveEntry, me: PlayerId): GameAction {
  if (entry.kind === 'reroll') return rerollAction(entry, me);
  return { ...entry.action, player: me } as GameAction;
}

function sameIds(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function collectOwners(value: unknown, owners: Map<InstanceId, PlayerId>, hit: Set<PlayerId>, depth: number): void {
  if (depth > 8 || hit.size === owners.size) return;
  if (typeof value === 'string') {
    const owner = owners.get(value);
    if (owner !== undefined) hit.add(owner);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectOwners(v, owners, hit, depth + 1);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectOwners(v, owners, hit, depth + 1);
  }
}

/**
 * The libraries whose order a step from `before` to `after` revealed or
 * changed: any library array that differs, plus any library whose cards (as of
 * `before`) are named by a log entry appended in between (a reveal or peek that
 * moves nothing) or by a prompt the step opened (a "look at your library"
 * choice shows its options without logging them).
 */
export function revealedLibraries(before: GameState, after: GameState): PlayerId[] {
  const out = new Set<PlayerId>();
  const owners = new Map<InstanceId, PlayerId>();
  for (const pid of before.playerOrder) {
    const b = before.players[pid]?.library;
    const a = after.players[pid]?.library;
    if (!sameIds(a, b)) {
      out.add(pid);
      continue;
    }
    for (const iid of b ?? []) owners.set(iid, pid);
  }
  if (owners.size > 0) {
    const hit = new Set<PlayerId>();
    for (let i = after.log.length - 1; i >= 0; i--) {
      const e = after.log[i]!;
      if (e.seq <= before.logSeq) break;
      collectOwners(e.detail, owners, hit, 0);
    }
    if (after.pending && (!before.pending || before.pending.id !== after.pending.id)) {
      collectOwners(after.pending.options, owners, hit, 0);
    }
    for (const pid of hit) out.add(pid);
  }
  return before.playerOrder.filter((pid) => out.has(pid));
}

function namesAny(value: unknown, ids: ReadonlySet<string>, depth: number): boolean {
  if (depth > 10) return false;
  if (typeof value === 'string') return ids.has(value);
  if (Array.isArray(value)) {
    for (const v of value) if (namesAny(v, ids, depth + 1)) return true;
    return false;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) if (namesAny(v, ids, depth + 1)) return true;
  }
  return false;
}

/**
 * The opponent rule (SB-68, PS-M1): whether a step from `before` to `after`
 * reached a card another player keeps hidden. It did when it changed another
 * player's hand or library, or when a log entry it appended or a prompt it
 * opened names a card that was in another player's hand or library at the start
 * of the branch (`start`). Hands count because the branch dealt every player
 * between the active one and `me` their next hand.
 */
export function reachesOpponent(start: GameState, before: GameState, after: GameState, me: PlayerId): boolean {
  const hidden = new Set<InstanceId>();
  for (const pid of start.playerOrder) {
    if (pid === me) continue;
    const b = before.players[pid];
    const a = after.players[pid];
    if (!sameIds(b?.hand, a?.hand) || !sameIds(b?.library, a?.library)) return true;
    for (const iid of start.players[pid]?.hand ?? []) hidden.add(iid);
    for (const iid of start.players[pid]?.library ?? []) hidden.add(iid);
  }
  if (hidden.size === 0) return false;
  for (let i = after.log.length - 1; i >= 0; i--) {
    const e = after.log[i]!;
    if (e.seq <= before.logSeq) break;
    if (namesAny(e.detail, hidden, 0)) return true;
  }
  if (after.pending && (!before.pending || before.pending.id !== after.pending.id)) {
    if (namesAny(after.pending, hidden, 0)) return true;
  }
  return false;
}

/**
 * The randomness a preview from `before` to `after` revealed: the libraries it
 * revealed and the cursor it reached. Null when it revealed nothing.
 */
export function rerollFor(before: GameState, after: GameState): PremoveRerollEntry | null {
  const libraries = revealedLibraries(before, after);
  const skipTo = after.rngCursor;
  if (libraries.length === 0 && skipTo <= before.rngCursor) return null;
  return { kind: 'reroll', libraries, skipTo };
}

/** One reroll that covers both. */
export function mergeRerolls(
  a: PremoveRerollEntry | null | undefined,
  b: PremoveRerollEntry | null | undefined,
): PremoveRerollEntry | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const libraries = a.libraries.slice();
  for (const pid of b.libraries) if (!libraries.includes(pid)) libraries.push(pid);
  return { kind: 'reroll', libraries, skipTo: Math.max(a.skipTo, b.skipTo) };
}

function entryKey(entry: PremoveEntry): string {
  return JSON.stringify(entry);
}

/** What a complete fold showed, for the drift rule (see `PremoveSeen`). */
export function seenOf(fold: PremoveFold): PremoveSeen {
  const entries: string[] = [];
  const revealed: PlayerId[][] = [];
  for (let i = 0; i < fold.applied; i++) {
    entries.push(entryKey(fold.queue[i]!));
    revealed.push(revealedLibraries(fold.states[i]!, fold.states[i + 1]!));
  }
  const s0 = fold.states[0]!;
  const start: Record<PlayerId, InstanceId[]> = {};
  for (const pid of s0.playerOrder) start[pid] = (s0.players[pid]?.library ?? []).slice();
  return { entries, revealed, start };
}

function asSeen(previous: PremoveFold | PremoveSeen | null | undefined): PremoveSeen | null {
  if (!previous) return null;
  return 'states' in previous ? seenOf(previous) : previous;
}

/**
 * Drift: entry `i` revealed a library, and that library is not in the order it
 * was in when the previous fold showed entry `i`. Compared at the start of the
 * branch, before any premove, so a reroll earlier in the queue shuffling at a
 * different cursor (fresh randomness nobody has seen) is not drift.
 */
function drifted(
  seen: PremoveSeen | null,
  i: number,
  entry: PremoveEntry,
  start: GameState,
  before: GameState,
  after: GameState,
): boolean {
  if (!seen || i >= seen.entries.length || seen.entries[i] !== entryKey(entry)) return false;
  const libs = new Set<PlayerId>([...(seen.revealed[i] ?? []), ...revealedLibraries(before, after)]);
  for (const pid of libs) {
    if (!sameIds(seen.start[pid], start.players[pid]?.library)) return true;
  }
  return false;
}

export interface FoldOptions {
  /** What the last fold that applied the whole queue showed, for the drift rule. */
  previous?: PremoveFold | PremoveSeen | null;
  reduce?: ReduceFn;
}

/**
 * Fold the queue onto the branch at the start of `me`'s next turn. Stops at the
 * first invalid action entry; a reroll entry always applies. Null when the
 * branch cannot be built at all (see `advanceToTurnOf`).
 */
export function foldPremoves(
  authoritative: GameState,
  me: PlayerId,
  queue: readonly PremoveEntry[],
  opts: FoldOptions = {},
): PremoveFold | null {
  const reduce = opts.reduce ?? engineReduce;
  const start = advanceToTurnOf(authoritative, me, reduce);
  if (!start) return null;
  const seen = asSeen(opts.previous);
  const states: GameState[] = [start];
  let s = start;
  let actions = 0;
  let invalidAt: number | null = null;
  let reason: PremoveInvalid | null = null;

  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i]!;
    if (s.pending !== null) {
      invalidAt = i;
      reason = 'prompt';
      break;
    }
    if (entry.kind === 'reroll') {
      s = reduce(s, rerollAction(entry, me));
      states.push(s);
      continue;
    }
    if (!expectHolds(s, me, entry)) {
      invalidAt = i;
      reason = 'expect';
      break;
    }
    const next = reduce(s, entryAction(entry, me));
    if (isRejected(s, next)) {
      invalidAt = i;
      reason = 'refused';
      break;
    }
    if (reachesOpponent(start, s, next, me)) {
      invalidAt = i;
      reason = 'opponent';
      break;
    }
    if (next.pending !== null && i < queue.length - 1) {
      invalidAt = i;
      reason = 'prompt';
      break;
    }
    if (drifted(seen, i, entry, start, s, next)) {
      invalidAt = i;
      reason = 'drift';
      break;
    }
    actions += 1;
    s = next;
    states.push(s);
  }

  return {
    queue,
    branch: s,
    states,
    applied: states.length - 1,
    actions,
    invalidAt,
    reason,
    promptOpen: s.pending !== null,
  };
}

// ---------------------------------------------------------------------------
// The tracker: a queue plus what its previews have revealed so far
// ---------------------------------------------------------------------------

export interface PremoveTracker {
  readonly queue: readonly PremoveEntry[];
  /**
   * exposure[i]: everything entries i.. of the queue revealed, merged over every
   * fold that showed them. Rolling back at k leaves exposure[k] as the reroll.
   * Non-null also means entry i is committed (see `committedLength`).
   */
  readonly exposure: readonly (PremoveRerollEntry | null)[];
  /** The last fold that applied the whole queue. Never persisted. */
  readonly last: PremoveFold | null;
  /** What that fold showed, for the drift rule. Persisted with the queue. */
  readonly seen: PremoveSeen | null;
}

export const EMPTY_TRACKER: PremoveTracker = { queue: [], exposure: [], last: null, seen: null };

export function premoveCount(tracker: PremoveTracker): number {
  let n = 0;
  for (const e of tracker.queue) if (e.kind === 'action') n += 1;
  return n;
}

/** Fold every entry's exposure in this (complete) fold into the tracker's. */
function observe(queue: readonly PremoveEntry[], exposure: readonly (PremoveRerollEntry | null)[], fold: PremoveFold): (PremoveRerollEntry | null)[] {
  const out: (PremoveRerollEntry | null)[] = [];
  for (let i = 0; i < queue.length; i++) {
    const seen = i + 1 < fold.states.length ? rerollFor(fold.states[i]!, fold.branch) : null;
    out.push(mergeRerolls(exposure[i] ?? null, seen));
  }
  return out;
}

/**
 * Drop entries k.. and leave one reroll where they were, covering everything
 * any preview of them revealed. Adjacent rerolls merge.
 */
export function rollbackAt(tracker: PremoveTracker, k: number): PremoveTracker {
  const at = Math.max(0, Math.min(k, tracker.queue.length));
  const reroll = tracker.exposure[at] ?? null;
  const queue = tracker.queue.slice(0, at);
  const exposure = tracker.exposure.slice(0, at);
  if (reroll) {
    const prev = queue[queue.length - 1];
    if (prev && prev.kind === 'reroll') {
      queue[queue.length - 1] = mergeRerolls(prev, reroll)!;
    } else {
      queue.push(reroll);
      exposure.push(reroll);
    }
  }
  return { queue, exposure, last: tracker.last, seen: tracker.seen };
}

export interface SyncResult {
  tracker: PremoveTracker;
  /** The fold to show (after any rollback), or null when no branch can be built. */
  fold: PremoveFold | null;
  rolledBack: boolean;
}

/** Refold on a new authoritative state, rolling back whatever it invalidated. */
export function syncPremoves(
  tracker: PremoveTracker,
  authoritative: GameState,
  me: PlayerId,
  reduce?: ReduceFn,
): SyncResult {
  let t = tracker;
  let rolledBack = false;
  // Each pass drops at least one action entry, so this ends; the bound is a backstop.
  for (let pass = 0; pass <= MAX_PREMOVES + 1; pass++) {
    const fold = foldPremoves(authoritative, me, t.queue, { previous: t.seen, reduce });
    if (!fold) return { tracker: t, fold: null, rolledBack };
    if (fold.invalidAt === null) {
      return {
        tracker: { queue: t.queue, exposure: observe(t.queue, t.exposure, fold), last: fold, seen: seenOf(fold) },
        fold,
        rolledBack,
      };
    }
    t = rollbackAt(t, fold.invalidAt);
    rolledBack = true;
  }
  return { tracker: t, fold: null, rolledBack };
}

export interface AddResult extends SyncResult {
  added: boolean;
  /**
   * Why the branch refused the new premove, when it did (`opponent`: it would
   * have shown another player's hidden cards). Null when it was queued, or was
   * turned away before it was tried (your own turn, no branch, a full queue).
   */
  refusal: PremoveInvalid | null;
}

/**
 * Queue one premove. Refused (nothing queued) when it is `me`'s own turn, the
 * branch cannot be built, a premove already left a prompt open, the queue is
 * full, or the action is invalid on the branch.
 */
export function addPremove(
  tracker: PremoveTracker,
  authoritative: GameState,
  me: PlayerId,
  action: GameAction,
  reduce?: ReduceFn,
): AddResult {
  if (authoritative.activePlayer === me) {
    return { tracker, fold: null, rolledBack: false, added: false, refusal: null };
  }
  const synced = syncPremoves(tracker, authoritative, me, reduce);
  const base = synced.fold;
  if (!isPremovable(action) || !base || base.promptOpen || premoveCount(synced.tracker) >= MAX_PREMOVES) {
    return { ...synced, added: false, refusal: null };
  }
  const bound = { ...action, player: me } as PremoveAction;
  const entry: PremoveActionEntry = { kind: 'action', action: bound, expect: expectFor(base.branch, me, bound) };
  const queue = [...synced.tracker.queue, entry];
  const fold = foldPremoves(authoritative, me, queue, { previous: synced.tracker.seen, reduce });
  if (!fold || fold.invalidAt !== null) {
    return { ...synced, added: false, refusal: fold ? fold.reason : null };
  }
  const exposure = observe(queue, [...synced.tracker.exposure, null], fold);
  return {
    tracker: { queue, exposure, last: fold, seen: seenOf(fold) },
    fold,
    rolledBack: synced.rolledBack,
    added: true,
    refusal: null,
  };
}

/**
 * How many queue entries are committed: everything up to and including the last
 * entry whose preview revealed hidden information (a library's cards or order,
 * or rng positions), or the last reroll. Entries before a revealing one are
 * committed with it, because its preview was built on them.
 */
export function committedLength(tracker: PremoveTracker): number {
  for (let i = tracker.queue.length - 1; i >= 0; i--) {
    if (tracker.queue[i]!.kind === 'reroll' || tracker.exposure[i]) return i + 1;
  }
  return 0;
}

/** Premoves (action entries) Clear cannot remove. */
export function committedCount(tracker: PremoveTracker): number {
  const n = committedLength(tracker);
  let count = 0;
  for (let i = 0; i < n; i++) if (tracker.queue[i]!.kind === 'action') count += 1;
  return count;
}

/**
 * Clear: discard the premoves that revealed nothing. Committed entries stay
 * queued until they run on your turn or a forced rollback drops them, so Clear
 * is never a mulligan and never owes a reroll. Returns the same tracker when
 * there is nothing to clear.
 */
export function clearPremoves(tracker: PremoveTracker): PremoveTracker {
  const keep = committedLength(tracker);
  if (keep === tracker.queue.length) return tracker;
  return {
    queue: tracker.queue.slice(0, keep),
    exposure: tracker.exposure.slice(0, keep),
    last: null,
    seen: tracker.seen,
  };
}

export interface Submission {
  /** One batch, in order: the kept premoves, rerolls where they belong. */
  actions: GameAction[];
  rolledBack: boolean;
}

/**
 * It is `me`'s turn: fold once more on the real state (no advance) and return
 * the batch to send. Whatever that last fold drops leaves its reroll after the
 * kept entries. Null when it is not a state premoves can be submitted on.
 */
export function submitPremoves(
  tracker: PremoveTracker,
  authoritative: GameState,
  me: PlayerId,
  reduce?: ReduceFn,
): Submission | null {
  if (authoritative.ended || authoritative.pending !== null || authoritative.activePlayer !== me) return null;
  if (tracker.queue.length === 0) return { actions: [], rolledBack: false };
  const synced = syncPremoves(tracker, authoritative, me, reduce);
  if (!synced.fold) return null;
  return {
    actions: synced.tracker.queue.map((e) => entryAction(e, me)).slice(0, MAX_BATCH),
    rolledBack: synced.rolledBack,
  };
}

/** Premoving is offered: a networked seat, someone else's turn, and a branch to show. */
export function premoveAvailable(networked: boolean, state: GameState | null, me: PlayerId | null): boolean {
  if (!networked || !state || !me || state.ended || state.activePlayer === me) return false;
  return advanceToTurnOf(state, me) !== null;
}

// ---------------------------------------------------------------------------
// Persistence (SB-68, PM-1): the debt lives as long as the seat
// ---------------------------------------------------------------------------

/** Which seat's premoves, in which match. */
export interface PremoveStoreId {
  room: string;
  seat: string;
  seed: number;
  /** The lockstep start payload's checksum: tells a rematch in the same room apart. */
  checksum: string;
}

export const PREMOVE_STORE_PREFIX = 'jlore_premove:';

/** Every key this room and seat may have written, whatever the match. */
export function premoveStorePrefix(id: Pick<PremoveStoreId, 'room' | 'seat'>): string {
  return `${PREMOVE_STORE_PREFIX}${encodeURIComponent(id.room)}:${encodeURIComponent(id.seat)}:`;
}

export function premoveStoreKey(id: PremoveStoreId): string {
  return `${premoveStorePrefix(id)}${id.seed}:${encodeURIComponent(id.checksum)}`;
}

interface StoredPremoves {
  v: 1;
  key: string;
  queue: readonly PremoveEntry[];
  exposure: readonly (PremoveRerollEntry | null)[];
  seen: PremoveSeen | null;
}

/**
 * The tracker as stored under `key`: queue, exposure (which also marks the
 * committed entries) and what the last fold showed. Null when there is nothing
 * to keep, so the caller removes the key.
 */
export function serializeTracker(tracker: PremoveTracker, key: string): string | null {
  if (tracker.queue.length === 0) return null;
  const stored: StoredPremoves = {
    v: 1,
    key,
    queue: tracker.queue,
    exposure: tracker.exposure,
    seen: tracker.seen,
  };
  return JSON.stringify(stored);
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function isRerollEntry(v: unknown): v is PremoveRerollEntry {
  return (
    isObj(v) &&
    v['kind'] === 'reroll' &&
    isStrings(v['libraries']) &&
    typeof v['skipTo'] === 'number' &&
    Number.isInteger(v['skipTo']) &&
    v['skipTo'] >= 0
  );
}

function isActionEntry(v: unknown): v is PremoveActionEntry {
  if (!isObj(v) || v['kind'] !== 'action' || !isObj(v['expect'])) return false;
  const a = v['action'];
  if (!isObj(a) || typeof a['player'] !== 'string') return false;
  switch (a['type']) {
    case 'play':
      return typeof a['iid'] === 'string';
    case 'buy':
      return typeof a['pileId'] === 'string';
    case 'activateAura':
      return typeof a['auraId'] === 'string';
    case 'reorderHand':
      return isStrings(a['hand']);
    default:
      return false;
  }
}

function isSeen(v: unknown): v is PremoveSeen {
  if (!isObj(v) || !isStrings(v['entries']) || !Array.isArray(v['revealed']) || !isObj(v['start'])) return false;
  if (v['revealed'].length !== v['entries'].length || !v['revealed'].every(isStrings)) return false;
  return Object.values(v['start']).every(isStrings);
}

/**
 * Read back what `serializeTracker` wrote. Anything malformed, or written under
 * a different key (another room, seat or match), gives the empty tracker.
 */
export function deserializeTracker(raw: string | null | undefined, key: string): PremoveTracker {
  if (typeof raw !== 'string') return EMPTY_TRACKER;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_TRACKER;
  }
  if (!isObj(data) || data['v'] !== 1 || data['key'] !== key) return EMPTY_TRACKER;
  const { queue, exposure, seen } = data;
  if (!Array.isArray(queue) || !queue.every((e) => isRerollEntry(e) || isActionEntry(e))) return EMPTY_TRACKER;
  if (!Array.isArray(exposure) || exposure.length !== queue.length) return EMPTY_TRACKER;
  if (!exposure.every((e) => e === null || isRerollEntry(e))) return EMPTY_TRACKER;
  if (seen !== null && !isSeen(seen)) return EMPTY_TRACKER;
  return {
    queue: queue as PremoveEntry[],
    exposure: exposure as (PremoveRerollEntry | null)[],
    last: null,
    seen: (seen as PremoveSeen | null) ?? null,
  };
}
