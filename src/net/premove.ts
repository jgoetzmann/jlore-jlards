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
 * preview of the dropped entries consumed, and every library they revealed is
 * reshuffled, so what the player saw predicts nothing.
 *
 * Two rules go beyond "refused or `expect` changed", both to close scouting
 * paths a plain refusal check would miss:
 *
 *   drift   A premove that revealed a library is invalid once that library's
 *           order changed under it (an opponent put a card on top of it, or
 *           milled it). Otherwise the preview would quietly start showing the
 *           next card down, and the player would have seen both.
 *   prompt  A premove that opens a prompt is the last one (premoves end at a
 *           prompt, which is answered live). One that newly opens a prompt with
 *           more premoves queued behind it is invalid, so a reroll can never sit
 *           behind a prompt, where a batch would never reach it.
 *
 * And `exposure` is kept across folds rather than read off the last one: the
 * preview is refolded on every change, and each fold may have consumed a
 * different stretch of the rng. The reroll covers all of them.
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

export type PremoveInvalid = 'expect' | 'refused' | 'prompt' | 'drift';

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

/** Room left in one intent (MAX_BATCH) for rerolls between the actions. */
export const MAX_PREMOVES = Math.floor((MAX_BATCH - 1) / 2);

const PREMOVABLE = new Set<string>(['play', 'buy', 'activateAura', 'reorderHand']);

export function isPremovable(action: GameAction | null | undefined): action is PremoveAction {
  return !!action && typeof action.type === 'string' && PREMOVABLE.has(action.type);
}

function drafting(state: GameState): boolean {
  // Another track adds `GameState.draft`; a draft in progress has no turns to premove.
  const d = (state as unknown as { draft?: unknown }).draft;
  return d !== undefined && d !== null;
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
  return { type: 'reroll', player: me, libraries: entry.libraries.slice(), skipTo: entry.skipTo };
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

/**
 * Drift: entry `i` revealed a library, and that library is not in the order it
 * was in when the previous fold showed entry `i`. Compared at the start of the
 * branch, before any premove, so a reroll earlier in the queue shuffling at a
 * different cursor (fresh randomness nobody has seen) is not drift.
 */
function drifted(
  previous: PremoveFold | null | undefined,
  i: number,
  entry: PremoveEntry,
  start: GameState,
  before: GameState,
  after: GameState,
): boolean {
  if (!previous || previous.queue[i] !== entry || previous.states.length < i + 2) return false;
  const prevStart = previous.states[0]!;
  const libs = new Set<PlayerId>([
    ...revealedLibraries(previous.states[i]!, previous.states[i + 1]!),
    ...revealedLibraries(before, after),
  ]);
  for (const pid of libs) {
    if (!sameIds(prevStart.players[pid]?.library, start.players[pid]?.library)) return true;
  }
  return false;
}

export interface FoldOptions {
  /** The last fold that applied the whole queue, for the drift rule. */
  previous?: PremoveFold | null;
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
    if (next.pending !== null && i < queue.length - 1) {
      invalidAt = i;
      reason = 'prompt';
      break;
    }
    if (drifted(opts.previous, i, entry, start, s, next)) {
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
   */
  readonly exposure: readonly (PremoveRerollEntry | null)[];
  /** The last fold that applied the whole queue. */
  readonly last: PremoveFold | null;
}

export const EMPTY_TRACKER: PremoveTracker = { queue: [], exposure: [], last: null };

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
  return { queue, exposure, last: tracker.last };
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
    const fold = foldPremoves(authoritative, me, t.queue, { previous: t.last, reduce });
    if (!fold) return { tracker: t, fold: null, rolledBack };
    if (fold.invalidAt === null) {
      return {
        tracker: { queue: t.queue, exposure: observe(t.queue, t.exposure, fold), last: fold },
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
  if (authoritative.activePlayer === me) return { tracker, fold: null, rolledBack: false, added: false };
  const synced = syncPremoves(tracker, authoritative, me, reduce);
  const base = synced.fold;
  if (!isPremovable(action) || !base || base.promptOpen || premoveCount(synced.tracker) >= MAX_PREMOVES) {
    return { ...synced, added: false };
  }
  const bound = { ...action, player: me } as PremoveAction;
  const entry: PremoveActionEntry = { kind: 'action', action: bound, expect: expectFor(base.branch, me, bound) };
  const queue = [...synced.tracker.queue, entry];
  const fold = foldPremoves(authoritative, me, queue, { previous: synced.tracker.last, reduce });
  if (!fold || fold.invalidAt !== null) return { ...synced, added: false };
  const exposure = observe(queue, [...synced.tracker.exposure, null], fold);
  return { tracker: { queue, exposure, last: fold }, fold, rolledBack: synced.rolledBack, added: true };
}

/** Discard every premove; what their previews revealed stays owed as a reroll. */
export function clearPremoves(tracker: PremoveTracker): PremoveTracker {
  const t = rollbackAt(tracker, 0);
  return { queue: t.queue, exposure: t.exposure, last: null };
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
