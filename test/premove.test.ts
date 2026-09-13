/**
 * Premoves (SB-68). A player takes their next turn's actions during someone
 * else's turn; the active player stays authoritative, and a premove the turn
 * invalidates is rolled back. These pin:
 *
 *  1. THE regression: a rolled-back premoved draw re-rolls its randomness. The
 *     same draw premoved again does not show the cards the dropped preview
 *     showed, and without the reroll entry it would.
 *  2. The same for rng-driven actions: a Discover's offer and a `random` op.
 *  3. The batch sent at turn start, applied through lockstep, reproduces the
 *     preview for kept premoves, and a reroll in it lands identically everywhere.
 *  4. Invalidation: a transformed or removed card, a pile whose top or price
 *     moved, a refusal, and a library reordered under a premoved draw (drift).
 *  5. A premove that opens a prompt is the last one.
 *  6. Premoving is unavailable in hotseat, on your own turn, and during a draft
 *     until the last pick (MERGE-6).
 *  7. The `reroll` action: validation, own library only, a log line that says
 *     nothing (PS-M2), B118 logging, B119 replay.
 *  8. The debt survives a reload (PM-1); Clear keeps committed premoves (PM-2);
 *     premoves that reach another player's library or hand are refused (PM-2,
 *     PS-M1).
 */
import { afterEach, describe, expect, test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch, reduce } from '@engine/index';
import { viewFor } from '@engine/view';
import { canBuyPile } from '@engine/core/buy';
import { costOf } from '@engine/shop/cost';
import type { CardDefId, GameAction, GameState, InstanceId, MatchConfig, PlayerId } from '@engine/types';
import { makeLocalRelay } from '@net/relay';
import { makeStart, startSession, stateChecksum, type LockstepSession } from '@net/lockstep';
import {
  EMPTY_TRACKER,
  addPremove,
  advanceToTurnOf,
  clearPremoves,
  committedCount,
  deserializeTracker,
  foldPremoves,
  mergeRerolls,
  premoveAvailable,
  premoveCount,
  premoveStoreKey,
  premoveViewFor,
  rerollFor,
  serializeTracker,
  submitPremoves,
  syncPremoves,
  type PremoveActionEntry,
  type PremoveEntry,
  type PremoveRerollEntry,
  type PremoveStoreId,
  type PremoveTracker,
} from '@net/premove';
import { holdPremoveLock, readPremoveStore, writePremoveStore, type PremoveLocks } from '@net/storage';
import { usePremove } from '@ui/usePremove';
import { PremoveBar } from '@ui/PremoveBar';

const CFG = (playerCount: number, over: Partial<MatchConfig> = {}): MatchConfig => ({
  playerCount,
  draftPileCount: 10,
  anomalyChance: 0,
  winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
  pileSizeScale: 1,
  effectNodeBudget: 200,
  recursionDepth: 8,
  turnSeconds: 60,
  seedCodexWithCommons: true,
  ...over,
});

const PLAYERS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, codex: [] as CardDefId[] }));

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;

function deal(seed: number, players = 2): GameState {
  return createMatch(CFG(players), PLAYERS(players), seed, null);
}

function other(state: GameState): PlayerId {
  return state.playerOrder.find((p) => p !== state.activePlayer)!;
}

/** Turn cards in `pid`'s hand into `defIds`, in hand order. Returns the iids. */
function inject(state: GameState, pid: PlayerId, defIds: CardDefId[]): InstanceId[] {
  const hand = state.players[pid]!.hand;
  return defIds.map((defId, i) => {
    const iid = hand[i]!;
    state.instances[iid]!.defId = defId;
    if (!state.defsInMatch.includes(defId)) state.defsInMatch.push(defId);
    return iid;
  });
}

const play = (player: PlayerId, iid: InstanceId): GameAction => ({ type: 'play', player, iid });

/** Cards that arrived in `pid`'s hand between two states, in order. */
function drawn(before: GameState, after: GameState, pid: PlayerId): InstanceId[] {
  const had = new Set(before.players[pid]!.hand);
  return after.players[pid]!.hand.filter((iid) => !had.has(iid));
}

function added(tracker: PremoveTracker, auth: GameState, me: PlayerId, action: GameAction) {
  const r = addPremove(tracker, auth, me, action);
  expect(r.added, `premove ${action.type} should be queued`).toBe(true);
  return r;
}

function transformed(auth: GameState, iid: InstanceId, defId: CardDefId = 'copper'): GameState {
  const next = clone(auth);
  next.instances[iid]!.defId = defId;
  return next;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

// ---------------------------------------------------------------------------
// 1. The regression test
// ---------------------------------------------------------------------------

describe('SB-68: a rolled-back premove re-rolls its randomness instead of replaying it', () => {
  test('a premoved draw, rolled back, does not draw the cards its preview showed', () => {
    const auth = clone(deal(4101));
    const B = other(auth);
    const [first, second] = inject(auth, B, ['big_spenda', 'big_spenda']);

    // B premoves a +2 Cards during A's turn and is shown what it draws.
    const r1 = added(EMPTY_TRACKER, auth, B, play(B, first!));
    const f1 = r1.fold!;
    const seen = drawn(f1.states[0]!, f1.states[1]!, B);
    expect(seen).toHaveLength(2);
    const originalLibrary = f1.states[0]!.players[B]!.library.slice();

    // A's turn transforms the card: the premove is invalid and rolled back.
    const auth2 = transformed(auth, first!);
    expect(foldPremoves(auth2, B, r1.tracker.queue, { previous: r1.tracker.last })!.reason).toBe('expect');
    const synced = syncPremoves(r1.tracker, auth2, B);
    expect(synced.rolledBack).toBe(true);
    const queue = synced.tracker.queue;
    expect(queue).toHaveLength(1);
    const reroll = queue[queue.length - 1] as PremoveRerollEntry;
    expect(reroll.kind).toBe('reroll');
    expect(reroll.libraries).toContain(B);
    expect(reroll.skipTo).toBeGreaterThanOrEqual(f1.branch.rngCursor);

    // Nothing the dropped preview showed survives in what B is now shown.
    const shown = JSON.stringify(viewFor(synced.fold!.branch, B));
    for (const iid of seen) expect(shown).not.toContain(`"${iid}"`);

    // B premoves the same draw again, with the other copy.
    const r2 = added(synced.tracker, auth2, B, play(B, second!));
    const f2 = r2.fold!;
    expect(f2.states).toHaveLength(3); // start, after the reroll, after the draw
    const rerolled = f2.states[1]!;
    expect(rerolled.players[B]!.library).not.toEqual(originalLibrary);
    expect([...rerolled.players[B]!.library].sort()).toEqual([...originalLibrary].sort());
    expect(rerolled.rngCursor).toBeGreaterThanOrEqual(reroll.skipTo);
    const redrawn = drawn(f2.states[1]!, f2.states[2]!, B);
    expect(redrawn).toHaveLength(2);
    expect(redrawn).not.toEqual(seen);

    // The control that makes this meaningful: WITHOUT the reroll entry, the very
    // same premove draws exactly the cards the dropped preview showed.
    const drawEntry = r2.tracker.queue[1] as PremoveActionEntry;
    const bare = foldPremoves(auth2, B, [drawEntry])!;
    expect(bare.invalidAt).toBeNull();
    expect(drawn(bare.states[0]!, bare.states[1]!, B)).toEqual(seen);

    // And on B's turn the reroll goes out ahead of the draw, in one batch.
    const turn = advanceToTurnOf(auth2, B)!;
    const sub = submitPremoves(r2.tracker, turn, B)!;
    expect(sub.actions.map((a) => a.type)).toEqual(['reroll', 'play']);
  });

  test('PM-2: pressing Clear is not a mulligan: a draw whose preview showed cards stays queued', () => {
    const auth = clone(deal(4101));
    const B = other(auth);
    const [card] = inject(auth, B, ['big_spenda']);
    const r1 = added(EMPTY_TRACKER, auth, B, play(B, card!));
    const seen = drawn(r1.fold!.states[0]!, r1.fold!.states[1]!, B);
    const cleared = clearPremoves(r1.tracker);
    // Nothing clearable: the same tracker comes back, the draw is still queued, no reroll.
    expect(cleared).toBe(r1.tracker);
    expect(cleared.queue.map((e) => e.kind)).toEqual(['action']);
    // And on B's turn it draws exactly what B was shown.
    const turn = advanceToTurnOf(auth, B)!;
    const sub = submitPremoves(cleared, turn, B)!;
    expect(sub.actions.map((a) => a.type)).toEqual(['play']);
    const after = reduce(turn, sub.actions[0]!);
    expect(drawn(turn, after, B)).toEqual(seen);
  });
});

// ---------------------------------------------------------------------------
// 2. Rng-driven actions
// ---------------------------------------------------------------------------

describe('SB-68: the re-roll rule covers rng-driven actions too', () => {
  test('a premoved Discover, rolled back, does not offer the same cards again', () => {
    const auth = clone(deal(4102));
    const B = other(auth);
    const [first, second] = inject(auth, B, ['giants_horn', 'giants_horn']);

    const r1 = added(EMPTY_TRACKER, auth, B, play(B, first!));
    expect(r1.fold!.promptOpen).toBe(true);
    const offered = r1.fold!.branch.pending!.options.map((o) => o.defId);
    expect(offered).toHaveLength(3);

    const auth2 = transformed(auth, first!);
    const synced = syncPremoves(r1.tracker, auth2, B);
    expect(synced.rolledBack).toBe(true);
    const reroll = synced.tracker.queue[0] as PremoveRerollEntry;
    expect(reroll.kind).toBe('reroll');
    // A Discover moves no cards; what it revealed is rng positions.
    expect(reroll.skipTo).toBeGreaterThan(r1.fold!.states[0]!.rngCursor);

    const r2 = added(synced.tracker, auth2, B, play(B, second!));
    const f2 = r2.fold!;
    expect(f2.states[1]!.rngCursor).toBeGreaterThanOrEqual(reroll.skipTo);
    const reoffered = f2.branch.pending!.options.map((o) => o.defId);
    expect(reoffered).not.toEqual(offered);

    // Without the reroll it is a replay.
    const bare = foldPremoves(auth2, B, [r2.tracker.queue[1]!])!;
    expect(bare.branch.pending!.options.map((o) => o.defId)).toEqual(offered);
  });

  test('a premoved `random` op, rolled back, draws from rng positions its preview never used', () => {
    const auth = clone(deal(4103));
    const B = other(auth);
    const [first, second] = inject(auth, B, ['egg', 'egg']);

    const outcome = (before: GameState, after: GameState) =>
      after.log.filter((e) => e.seq > before.logSeq && e.kind === 'random').map((e) => e.detail['index']);

    const r1 = added(EMPTY_TRACKER, auth, B, play(B, first!));
    const f1 = r1.fold!;
    const seen = outcome(f1.states[0]!, f1.states[1]!);
    expect(seen).toHaveLength(1);
    const usedFrom = f1.states[0]!.rngCursor;
    const usedTo = f1.states[1]!.rngCursor;
    expect(usedTo).toBeGreaterThan(usedFrom);

    const auth2 = transformed(auth, first!);
    const synced = syncPremoves(r1.tracker, auth2, B);
    const reroll = synced.tracker.queue[0] as PremoveRerollEntry;
    expect(reroll.kind).toBe('reroll');
    expect(reroll.skipTo).toBeGreaterThanOrEqual(usedTo);

    const r2 = added(synced.tracker, auth2, B, play(B, second!));
    const f2 = r2.fold!;
    // The op resolves at or past skipTo: no position the dropped preview read.
    expect(f2.states[1]!.rngCursor).toBeGreaterThanOrEqual(usedTo);
    expect(outcome(f2.states[1]!, f2.states[2]!)).not.toEqual(seen);

    const bare = foldPremoves(auth2, B, [r2.tracker.queue[1]!])!;
    expect(bare.states[0]!.rngCursor).toBe(usedFrom);
    expect(outcome(bare.states[0]!, bare.states[1]!)).toEqual(seen);
  });
});

// ---------------------------------------------------------------------------
// 3. Submission through lockstep
// ---------------------------------------------------------------------------

describe('SB-68: the batch sent at turn start goes through lockstep like any intent', () => {
  function room(seed: number) {
    const relay = makeLocalRelay();
    const seats = ['h', 'g'];
    const start = makeStart({ seats, config: CFG(2), seed, players: PLAYERS(2) });
    const host = startSession(relay, { localSeats: ['h'], start, onChange: () => {} });
    const guest = startSession(relay, { localSeats: ['g'], onChange: () => {} });
    return { host, guest };
  }

  function roles(host: LockstepSession, guest: LockstepSession) {
    const A = host.core.predicted()!.activePlayer;
    const hostActive = host.core.playerOf('h') === A;
    const active = hostActive ? { s: host, seat: 'h' } : { s: guest, seat: 'g' };
    const prem = hostActive ? { s: guest, seat: 'g' } : { s: host, seat: 'h' };
    return { A, active, prem, me: prem.s.core.playerOf(prem.seat)! };
  }

  test('kept premoves (every Copper, then a buy) land exactly as previewed', async () => {
    const { host, guest } = room(606);
    try {
      await flush();
      const { A, active, prem, me } = roles(host, guest);
      const auth = prem.s.core.predicted()!;
      const turn = advanceToTurnOf(auth, me)!;
      const coppers = turn.players[me]!.hand.filter((iid) => turn.instances[iid]!.defId === 'copper');
      expect(coppers.length).toBeGreaterThan(1);

      let t: PremoveTracker = EMPTY_TRACKER;
      for (const iid of coppers) t = added(t, auth, me, play(me, iid)).tracker;
      const branch = t.last!.branch;
      const pile = Object.keys(branch.shop.piles)
        .filter((p) => canBuyPile(branch, me, p))
        .sort((a, b) => costOf(branch, b, me) - costOf(branch, a, me))[0]!;
      t = added(t, auth, me, { type: 'buy', player: me, pileId: pile }).tracker;
      const preview = t.last!.branch;

      active.s.send(active.seat, { type: 'endTurn', player: A });
      await flush();
      const real = prem.s.core.predicted()!;
      expect(real.activePlayer).toBe(me);

      const sub = submitPremoves(t, real, me)!;
      expect(sub.rolledBack).toBe(false);
      expect(sub.actions).toHaveLength(coppers.length + 1);
      prem.s.sendMany(prem.seat, sub.actions);
      await flush();

      // Both browsers agree, and the premover sees exactly what the preview showed.
      // (The preview's other seats hold Copper stand-ins for their hidden cards, so
      // the comparison is what `me` sees, not the whole state.)
      const confirmed = prem.s.core.confirmedState()!;
      expect(stateChecksum(active.s.core.confirmedState()!)).toBe(stateChecksum(confirmed));
      const seenBy = (s: GameState) => {
        const v = viewFor(s, me);
        return { you: v.you, shop: v.shop, turn: v.turn, activePlayer: v.activePlayer, cursor: s.rngCursor };
      };
      expect(seenBy(confirmed)).toEqual(seenBy(preview));
      expect(premoveViewFor(auth, t.last!, me).you).toEqual(viewFor(confirmed, me).you);
    } finally {
      host.stop();
      guest.stop();
    }
  });

  test('a rollback during the turn sends the kept premove, then the reroll, and every browser agrees', async () => {
    const { host, guest } = room(707);
    try {
      await flush();
      const { A, active, prem, me } = roles(host, guest);
      // The same edit on both browsers, standing in for a card a turn can give.
      let drawCard = '';
      const give = (s: GameState): GameState => {
        const next = clone(s);
        drawCard = next.players[me]!.hand.find((iid) => next.instances[iid]!.defId !== 'copper')
          ?? next.players[me]!.hand[1]!;
        next.instances[drawCard]!.defId = 'big_spenda';
        return next;
      };
      host.core.corruptForTest(give);
      guest.core.corruptForTest(give);

      const auth = prem.s.core.predicted()!;
      const turn = advanceToTurnOf(auth, me)!;
      const copper = turn.players[me]!.hand.find((iid) => turn.instances[iid]!.defId === 'copper')!;
      let t: PremoveTracker = added(EMPTY_TRACKER, auth, me, play(me, copper)).tracker;
      const r = added(t, auth, me, play(me, drawCard));
      t = r.tracker;
      const seenLibrary = r.fold!.states[1]!.players[me]!.library.slice();
      const seenDraw = drawn(r.fold!.states[1]!, r.fold!.states[2]!, me);
      const keptPreview = r.fold!.states[1]!;

      // A's turn transforms the card (on both browsers), then ends.
      const undo = (s: GameState): GameState => transformed(s, drawCard);
      host.core.corruptForTest(undo);
      guest.core.corruptForTest(undo);
      const synced = syncPremoves(t, prem.s.core.predicted()!, me);
      expect(synced.rolledBack).toBe(true);
      t = synced.tracker;
      expect(t.queue.map((e) => e.kind)).toEqual(['action', 'reroll']);

      active.s.send(active.seat, { type: 'endTurn', player: A });
      await flush();
      const real = prem.s.core.predicted()!;
      const sub = submitPremoves(t, real, me)!;
      expect(sub.actions.map((a) => a.type)).toEqual(['play', 'reroll']);
      prem.s.sendMany(prem.seat, sub.actions);
      await flush();

      const hostState = host.core.confirmedState()!;
      const guestState = guest.core.confirmedState()!;
      expect(stateChecksum(hostState)).toBe(stateChecksum(guestState));
      // The kept Copper resolved as previewed...
      expect(hostState.players[me]!.play).toEqual(keptPreview.players[me]!.play);
      expect(hostState.players[me]!.money).toBe(keptPreview.players[me]!.money);
      // ...and the library the dropped draw revealed is not in the order it showed.
      expect(hostState.players[me]!.library).not.toEqual(seenLibrary);
      expect(hostState.players[me]!.library.slice(0, 2)).not.toEqual(seenDraw);
      expect(hostState.log.some((e) => e.kind === 'reroll' && e.player === me)).toBe(true);
    } finally {
      host.stop();
      guest.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Invalidation
// ---------------------------------------------------------------------------

describe('SB-68: what invalidates a premove', () => {
  function withCopperBuy(seed: number) {
    const auth = clone(deal(seed));
    const B = other(auth);
    const turn = advanceToTurnOf(auth, B)!;
    const coppers = turn.players[B]!.hand.filter((iid) => turn.instances[iid]!.defId === 'copper');
    let t: PremoveTracker = EMPTY_TRACKER;
    for (const iid of coppers) t = added(t, auth, B, play(B, iid)).tracker;
    const branch = t.last!.branch;
    const pileId = Object.keys(branch.shop.piles).find(
      (p) => canBuyPile(branch, B, p) && branch.shop.piles[p]!.cards.length > 1,
    )!;
    t = added(t, auth, B, { type: 'buy', player: B, pileId }).tracker;
    return { auth, B, t, pileId, buyAt: coppers.length };
  }

  test('a transformed card (expect: defId)', () => {
    const auth = clone(deal(4201));
    const B = other(auth);
    const [card] = inject(auth, B, ['big_spenda']);
    const t = added(EMPTY_TRACKER, auth, B, play(B, card!)).tracker;
    const fold = foldPremoves(transformed(auth, card!, 'silver'), B, t.queue)!;
    expect([fold.invalidAt, fold.reason]).toEqual([0, 'expect']);
  });

  test('a card removed from the hand (expect: gone)', () => {
    const auth = clone(deal(4201));
    const B = other(auth);
    const [card] = inject(auth, B, ['big_spenda']);
    const t = added(EMPTY_TRACKER, auth, B, play(B, card!)).tracker;
    const gone = clone(auth);
    gone.players[B]!.hand = gone.players[B]!.hand.filter((iid) => iid !== card);
    gone.players[B]!.gy.push(card!);
    gone.instances[card!]!.zone = 'gy';
    const fold = foldPremoves(gone, B, t.queue)!;
    expect([fold.invalidAt, fold.reason]).toEqual([0, 'expect']);
  });

  test("a pile whose top card changed, or whose price changed (expect: topDefId, cost)", () => {
    const { auth, B, t, pileId, buyAt } = withCopperBuy(4202);
    expect(foldPremoves(auth, B, t.queue)!.invalidAt).toBeNull();

    const newTop = clone(auth);
    const top = newTop.shop.piles[pileId]!.cards[0]!;
    newTop.instances[top]!.defId = newTop.instances[top]!.defId === 'estate' ? 'duchy' : 'estate';
    const f1 = foldPremoves(newTop, B, t.queue)!;
    expect([f1.invalidAt, f1.reason]).toEqual([buyAt, 'expect']);

    const pricier = clone(auth);
    pricier.shop.piles[pileId]!.costOverride = costOf(auth, pileId, B) + 1;
    const f2 = foldPremoves(pricier, B, t.queue)!;
    expect([f2.invalidAt, f2.reason]).toEqual([buyAt, 'expect']);
  });

  test('a premove reduce now refuses (refused)', () => {
    const auth = clone(deal(4203));
    const B = other(auth);
    const hand = auth.players[B]!.hand.slice().reverse();
    const t = added(EMPTY_TRACKER, auth, B, { type: 'reorderHand', player: B, hand }).tracker;
    const changed = clone(auth);
    const lost = changed.players[B]!.hand.pop()!;
    changed.players[B]!.gy.push(lost);
    changed.instances[lost]!.zone = 'gy';
    const fold = foldPremoves(changed, B, t.queue)!;
    expect([fold.invalidAt, fold.reason]).toEqual([0, 'refused']);
  });

  test('dropping entry k keeps 0..k-1 exactly as previewed and leaves the reroll at k', () => {
    const auth = clone(deal(4204));
    const B = other(auth);
    const [card] = inject(auth, B, ['big_spenda']);
    const turn = advanceToTurnOf(auth, B)!;
    const coppers = turn.players[B]!.hand.filter((iid) => turn.instances[iid]!.defId === 'copper');
    let t = added(EMPTY_TRACKER, auth, B, play(B, coppers[0]!)).tracker;
    t = added(t, auth, B, play(B, card!)).tracker;
    t = added(t, auth, B, play(B, coppers[1]!)).tracker;
    const keptPreview = t.last!.states[1]!;

    const synced = syncPremoves(t, transformed(auth, card!), B);
    expect(synced.rolledBack).toBe(true);
    expect(synced.tracker.queue.map((e: PremoveEntry) => e.kind)).toEqual(['action', 'reroll']);
    // The kept Copper resolves as previewed; the only difference is the card the
    // authoritative turn transformed.
    expect(stateChecksum(synced.fold!.states[1]!)).toBe(stateChecksum(transformed(keptPreview, card!)));
  });

  test('drift: a library reordered under a premoved draw rolls it back with a reroll', () => {
    const auth = clone(deal(4205));
    const B = other(auth);
    const [card] = inject(auth, B, ['big_spenda']);
    const r = added(EMPTY_TRACKER, auth, B, play(B, card!));
    const seen = drawn(r.fold!.states[0]!, r.fold!.states[1]!, B);

    // A's turn puts a card on top of B's library: the preview would now show
    // the card below it too.
    const shifted = clone(auth);
    const lib = shifted.players[B]!.library;
    lib.unshift(lib.pop()!);
    const fold = foldPremoves(shifted, B, r.tracker.queue, { previous: r.tracker.last })!;
    expect([fold.invalidAt, fold.reason]).toEqual([0, 'drift']);
    // Without a previous fold to compare with, nothing was seen, so nothing drifted.
    expect(foldPremoves(shifted, B, r.tracker.queue)!.invalidAt).toBeNull();

    const synced = syncPremoves(r.tracker, shifted, B);
    const reroll = synced.tracker.queue[0] as PremoveRerollEntry;
    expect(reroll.kind).toBe('reroll');
    expect(reroll.libraries).toContain(B);
    const again = added(synced.tracker, shifted, B, play(B, card!));
    expect(drawn(again.fold!.states[1]!, again.fold!.states[2]!, B)).not.toEqual(seen);
  });

  test('rerollFor sees a peek that moves nothing: a logged library card, or a prompt showing one', () => {
    const before = clone(deal(4206));
    const B = other(before);
    const peeked = before.players[B]!.library[0]!;
    expect(rerollFor(before, before)).toBeNull();

    const logged = clone(before);
    logged.logSeq += 1;
    logged.log.push({ seq: logged.logSeq, turn: logged.turn, player: B, kind: 'reveal', detail: { iids: [peeked] } });
    expect(rerollFor(before, logged)).toEqual({ kind: 'reroll', libraries: [B], skipTo: before.rngCursor });

    const prompted = clone(before);
    prompted.pending = {
      id: 'pr_test',
      type: 'selectCards',
      player: B,
      prompt: 'Look',
      options: [{ key: peeked, label: 'card', iid: peeked }],
      min: 1,
      max: 1,
      then: [],
      ctx: {},
      defaultKeys: [peeked],
    } as unknown as GameState['pending'];
    expect(rerollFor(before, prompted)!.libraries).toEqual([B]);

    expect(
      mergeRerolls({ kind: 'reroll', libraries: ['p1'], skipTo: 5 }, { kind: 'reroll', libraries: ['p2', 'p1'], skipTo: 3 }),
    ).toEqual({ kind: 'reroll', libraries: ['p1', 'p2'], skipTo: 5 });
  });
});

// ---------------------------------------------------------------------------
// 5. Prompts
// ---------------------------------------------------------------------------

describe('SB-68: premoves end at a prompt', () => {
  test('a prompt-opening premove blocks further premoves', () => {
    const auth = clone(deal(4301));
    const B = other(auth);
    const [horn] = inject(auth, B, ['giants_horn']);
    const turn = advanceToTurnOf(auth, B)!;
    const copper = turn.players[B]!.hand.find((iid) => turn.instances[iid]!.defId === 'copper')!;

    const r = added(EMPTY_TRACKER, auth, B, play(B, horn!));
    expect(r.fold!.promptOpen).toBe(true);
    const blocked = addPremove(r.tracker, auth, B, play(B, copper));
    expect(blocked.added).toBe(false);
    expect(blocked.tracker.queue).toHaveLength(1);

    // A premove that (now) opens a prompt with more queued behind it is invalid.
    const hornEntry = r.tracker.queue[0]!;
    const copperEntry: PremoveActionEntry = {
      kind: 'action',
      action: { type: 'play', player: B, iid: copper },
      expect: { iid: copper, defId: 'copper' },
    };
    const fold = foldPremoves(auth, B, [hornEntry, copperEntry])!;
    expect([fold.invalidAt, fold.reason]).toEqual([0, 'prompt']);
  });

  test('never premovable: endTurn, resolve, concede', () => {
    const auth = clone(deal(4302));
    const B = other(auth);
    for (const action of [
      { type: 'endTurn', player: B },
      { type: 'resolve', player: B, promptId: 'x', keys: [] },
      { type: 'concede', player: B },
      { type: 'reroll', player: B, libraries: [B], skipTo: 0 },
    ] as GameAction[]) {
      expect(addPremove(EMPTY_TRACKER, auth, B, action).added, action.type).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Availability
// ---------------------------------------------------------------------------

describe('SB-68: premoving is for rooms, and for the seats waiting', () => {
  function Probe(props: { networked: boolean; state: GameState; me: PlayerId }): React.ReactElement {
    const pm = usePremove({ ...props, submit: () => {} });
    return React.createElement('i', {
      'data-available': String(pm.available),
      'data-active': String(pm.active),
      'data-count': pm.count,
    });
  }
  const probe = (networked: boolean, state: GameState, me: PlayerId): string =>
    renderToStaticMarkup(React.createElement(Probe, { networked, state, me }));

  test('unavailable in hotseat and on your own turn', () => {
    const auth = deal(4401);
    const A = auth.activePlayer;
    const B = other(auth);

    expect(premoveAvailable(true, auth, B)).toBe(true);
    expect(premoveAvailable(false, auth, B)).toBe(false);
    expect(premoveAvailable(true, auth, A)).toBe(false);
    expect(premoveAvailable(true, { ...auth, ended: true }, B)).toBe(false);

    expect(probe(true, auth, B)).toContain('data-available="true"');
    expect(probe(false, auth, B)).toContain('data-available="false"');
    expect(probe(true, auth, A)).toContain('data-available="false"');

    expect(addPremove(EMPTY_TRACKER, auth, A, play(A, auth.players[A]!.hand[0]!)).added).toBe(false);
  });

  test('unavailable while a prompt is open on the table', () => {
    const auth = clone(deal(4402));
    const B = other(auth);
    const [horn] = inject(auth, B, ['giants_horn']);
    const promptOnBsTurn = added(EMPTY_TRACKER, auth, B, play(B, horn!)).fold!.branch;
    const A = other(promptOnBsTurn);
    expect(premoveAvailable(true, promptOnBsTurn, A)).toBe(false);
    expect(advanceToTurnOf(promptOnBsTurn, A)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. The reroll action
// ---------------------------------------------------------------------------

describe('SB-68: the reroll action', () => {
  const lastLog = (s: GameState) => s.log[s.log.length - 1]!;

  test('refuses what it cannot apply, leaving the state as it was (B118: and logs it)', () => {
    const s = deal(4501);
    const A = s.activePlayer;
    const B = other(s);
    const bad: [GameAction, string][] = [
      [{ type: 'reroll', player: A, libraries: ['nobody'], skipTo: 0 }, 'illegalReroll'],
      [{ type: 'reroll', player: A, libraries: [A], skipTo: -1 }, 'illegalReroll'],
      [{ type: 'reroll', player: A, libraries: [A], skipTo: 1.5 }, 'illegalReroll'],
      [{ type: 'reroll', player: A, libraries: [A], skipTo: s.rngCursor + 1_000_001 }, 'illegalReroll'],
      [{ type: 'reroll', player: A, libraries: 'p1' as unknown as PlayerId[], skipTo: 0 }, 'illegalReroll'],
      [{ type: 'reroll', player: B, libraries: [B], skipTo: 0 }, 'notActivePlayer'],
      [{ type: 'reroll', player: A, libraries: [B], skipTo: 0 }, 'illegalReroll'],
      [{ type: 'reroll', player: A, libraries: [A, B], skipTo: 0 }, 'illegalReroll'],
    ];
    for (const [action, reason] of bad) {
      const next = reduce(s, action);
      expect(next.logSeq).toBe(s.logSeq + 1);
      expect(lastLog(next).kind).toBe('reject');
      expect(lastLog(next).detail['reason']).toBe(reason);
      expect({ ...next, log: [], logSeq: 0 }).toEqual({ ...s, log: [], logSeq: 0 });
    }
  });

  test("PM-2: a reroll refuses every library but the actor's own", () => {
    const s = deal(4504);
    const A = s.activePlayer;
    const B = other(s);
    for (const libraries of [[B], [A, B], [B, A]]) {
      const next = reduce(s, { type: 'reroll', player: A, libraries, skipTo: s.rngCursor + 5 });
      expect(lastLog(next).kind).toBe('reject');
      expect(lastLog(next).detail['why']).toBe('otherLibrary');
      expect(next.players[B]!.library).toEqual(s.players[B]!.library);
      expect(next.rngCursor).toBe(s.rngCursor);
    }
  });

  test('PS-M2: the reroll log line names the actor and nothing it re-rolled', () => {
    const s = deal(4505);
    const A = s.activePlayer;
    const B = other(s);
    const next = reduce(s, { type: 'reroll', player: A, libraries: [A], skipTo: s.rngCursor + 40 });
    const entry = lastLog(next);
    expect([entry.kind, entry.player]).toEqual(['reroll', A]);
    expect(entry.detail).toEqual({});
    const seenByB = JSON.stringify(viewFor(next, B).log[viewFor(next, B).log.length - 1]);
    for (const word of ['libraries', 'skipTo', 'cursor', 'from']) expect(seenByB).not.toContain(word);
  });

  test('moves the cursor to skipTo, reshuffles your own library, and logs it', () => {
    const s = deal(4502);
    const A = s.activePlayer;
    const B = other(s);
    const skipTo = s.rngCursor + 40;
    const next = reduce(s, { type: 'reroll', player: A, libraries: [A, A], skipTo });
    expect(lastLog(next).kind).toBe('reroll');
    expect(next.rngCursor).toBeGreaterThan(skipTo);
    expect([...next.players[A]!.library].sort()).toEqual([...s.players[A]!.library].sort());
    expect(next.players[A]!.library).not.toEqual(s.players[A]!.library);
    // Hands, piles and everyone else untouched.
    expect(next.players[B]!.library).toEqual(s.players[B]!.library);
    expect(next.players[A]!.hand).toEqual(s.players[A]!.hand);
    expect(next.shop).toEqual(s.shop);

    // A skipTo behind the cursor never moves it back.
    const behind = reduce(next, { type: 'reroll', player: A, libraries: [], skipTo: 0 });
    expect(behind.rngCursor).toBe(next.rngCursor);
    expect(lastLog(behind).kind).toBe('reroll');
  });

  test('B119: a match with rerolls in its action log replays to the identical state', () => {
    const seed = 4503;
    const actions: GameAction[] = [];
    let s = deal(seed);
    for (let turn = 0; turn < 6; turn++) {
      const me = s.activePlayer;
      const steps: GameAction[] = [
        { type: 'reroll', player: me, libraries: [me], skipTo: s.rngCursor + 3 + turn },
        ...s.players[me]!.hand
          .filter((iid) => s.instances[iid]!.defId === 'copper')
          .map((iid) => play(me, iid)),
        { type: 'endTurn', player: me },
      ];
      for (const a of steps) {
        actions.push(a);
        s = reduce(s, a);
      }
    }
    expect(s.log.filter((e) => e.kind === 'reroll')).toHaveLength(6);
    const replay = () => actions.reduce((acc, a) => reduce(acc, a), deal(seed));
    const r1 = replay();
    const r2 = replay();
    expect(r1).toEqual(s);
    expect(stateChecksum(r2)).toBe(stateChecksum(s));
  });
});

// ---------------------------------------------------------------------------
// 8. The debt survives a reload; Clear is not a mulligan; other players'
//    hidden cards are out of reach (review round 3)
// ---------------------------------------------------------------------------

/** A Storage that lives in the test. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => {
      data.delete(k);
    },
    setItem: (k: string, v: string) => {
      data.set(k, String(v));
    },
  };
}

describe('SB-68 PM-1: the premove tracker, and the reroll it owes, survive a reload', () => {
  const g = globalThis as unknown as { localStorage?: Storage };
  afterEach(() => {
    delete g.localStorage;
  });

  test('round-trips through storage, and after a reload the owed reroll still goes out at turn start', () => {
    g.localStorage = memoryStorage();
    const auth = clone(deal(4101));
    const B = other(auth);
    const [first, second] = inject(auth, B, ['big_spenda', 'big_spenda']);
    const r1 = added(EMPTY_TRACKER, auth, B, play(B, first!));
    const seen = drawn(r1.fold!.states[0]!, r1.fold!.states[1]!, B);
    const auth2 = transformed(auth, first!);
    const debt = syncPremoves(r1.tracker, auth2, B).tracker;
    expect(debt.queue.map((e) => e.kind)).toEqual(['reroll']);

    const id: PremoveStoreId = { room: 'ROOM42', seat: 'seat:b', seed: auth.seed, checksum: stateChecksum(auth) };
    const key = premoveStoreKey(id);
    writePremoveStore(key, serializeTracker(debt, key));

    // The reload: nothing in memory, a tracker read back from storage.
    const restored = deserializeTracker(readPremoveStore(key), key);
    expect(restored.queue).toEqual(debt.queue);
    expect(restored.exposure).toEqual(debt.exposure);
    expect(restored.seen).toEqual(debt.seen);
    expect(restored.last).toBeNull();

    // B's turn: the reroll goes out, and it is the one owed.
    const turn = advanceToTurnOf(auth2, B)!;
    const reroll = debt.queue[0] as PremoveRerollEntry;
    expect(submitPremoves(restored, turn, B)!.actions).toEqual([
      { type: 'reroll', player: B, libraries: [B], skipTo: reroll.skipTo },
    ]);
    // So the scouting attack fails across the reload: the same draw premoved
    // again does not show the cards the dropped preview showed.
    const again = added(restored, auth2, B, play(B, second!));
    expect(drawn(again.fold!.states[1]!, again.fold!.states[2]!, B)).not.toEqual(seen);

    // Any other room, seat or match, or text that is not a tracker, is an empty one.
    for (const otherId of [
      { ...id, room: 'ROOM43' },
      { ...id, seat: 'seat:a' },
      { ...id, seed: id.seed + 1 },
      { ...id, checksum: 'another deal' },
    ]) {
      expect(deserializeTracker(readPremoveStore(key), premoveStoreKey(otherId)).queue).toHaveLength(0);
    }
    expect(deserializeTracker('{', key).queue).toHaveLength(0);
    const bad = { v: 1, key, queue: [{ kind: 'reroll', libraries: [B], skipTo: -1 }], exposure: [null], seen: null };
    expect(deserializeTracker(JSON.stringify(bad), key).queue).toHaveLength(0);
    // An empty queue stores nothing (the key is removed).
    expect(serializeTracker(EMPTY_TRACKER, key)).toBeNull();
  });

  test('usePremove reads the stored queue for this room, seat and match on its first render', () => {
    g.localStorage = memoryStorage();
    const auth = clone(deal(4101));
    const B = other(auth);
    const [card] = inject(auth, B, ['big_spenda']);
    const t = added(EMPTY_TRACKER, auth, B, play(B, card!)).tracker;
    const id: PremoveStoreId = { room: 'ROOM42', seat: 'seat-b', seed: auth.seed, checksum: stateChecksum(auth) };
    const key = premoveStoreKey(id);
    writePremoveStore(key, serializeTracker(t, key));

    function Probe(props: { store: PremoveStoreId | null }): React.ReactElement {
      const pm = usePremove({ networked: true, state: auth, me: B, submit: () => {}, store: props.store });
      return React.createElement('i', { 'data-count': pm.count, 'data-committed': pm.committed });
    }
    const probe = (store: PremoveStoreId | null): string => renderToStaticMarkup(React.createElement(Probe, { store }));
    expect(probe(id)).toContain('data-count="1" data-committed="1"');
    expect(probe({ ...id, checksum: 'another deal' })).toContain('data-count="0"');
    expect(probe(null)).toContain('data-count="0"');
  });

  test('the drift rule still holds after a reload', () => {
    const auth = clone(deal(4205));
    const B = other(auth);
    const [card] = inject(auth, B, ['big_spenda']);
    const r = added(EMPTY_TRACKER, auth, B, play(B, card!));
    const key = premoveStoreKey({ room: 'R', seat: 's', seed: auth.seed, checksum: 'c' });
    const restored = deserializeTracker(serializeTracker(r.tracker, key), key);

    const shifted = clone(auth);
    const lib = shifted.players[B]!.library;
    lib.unshift(lib.pop()!);
    expect(foldPremoves(shifted, B, restored.queue, { previous: restored.seen })!.reason).toBe('drift');
    const synced = syncPremoves(restored, shifted, B);
    expect(synced.rolledBack).toBe(true);
    expect(synced.tracker.queue.map((e) => e.kind)).toEqual(['reroll']);
    expect((synced.tracker.queue[0] as PremoveRerollEntry).libraries).toEqual([B]);
  });
});

describe('SB-68 PM-2: Clear keeps committed premoves', () => {
  test('Clear drops the premoves that revealed nothing, and keeps a revealing one and what it built on', () => {
    const auth = clone(deal(4204));
    const B = other(auth);
    const [card] = inject(auth, B, ['big_spenda']);
    const turn = advanceToTurnOf(auth, B)!;
    const coppers = turn.players[B]!.hand.filter((iid) => turn.instances[iid]!.defId === 'copper');
    let t = added(EMPTY_TRACKER, auth, B, play(B, coppers[0]!)).tracker;
    expect(committedCount(t)).toBe(0);
    t = added(t, auth, B, play(B, card!)).tracker;
    t = added(t, auth, B, play(B, coppers[1]!)).tracker;
    expect([premoveCount(t), committedCount(t)]).toEqual([3, 2]);

    const cleared = clearPremoves(t);
    expect(cleared.queue).toEqual(t.queue.slice(0, 2));
    expect(cleared.queue.some((e) => e.kind === 'reroll')).toBe(false);
    expect(clearPremoves(cleared)).toBe(cleared);

    // Only Coppers: nothing was revealed, so Clear empties the queue and owes nothing.
    let plain = added(EMPTY_TRACKER, auth, B, play(B, coppers[0]!)).tracker;
    plain = added(plain, auth, B, play(B, coppers[1]!)).tracker;
    expect(committedCount(plain)).toBe(0);
    expect(clearPremoves(plain).queue).toEqual([]);
  });

  test("the bar says why committed premoves stay, and Clear is disabled when nothing is clearable", () => {
    const bar = (count: number, committed: number): string =>
      renderToStaticMarkup(
        React.createElement(PremoveBar, {
          available: true,
          active: true,
          showing: true,
          count,
          committed,
          rolledBack: 0,
          refused: 0,
          onActive: () => {},
          onClear: () => {},
        }),
      );
    const all = bar(2, 2);
    expect(all).toContain('data-testid="premove-committed"');
    expect(all).toMatch(/2 committed — they showed you cards, so they can.{1,6}t be cleared/);
    expect(all).toContain('data-testid="premove-clear" disabled=""');
    const some = bar(3, 2);
    expect(some).not.toContain('data-testid="premove-clear" disabled=""');
    const none = bar(1, 0);
    expect(none).not.toContain('premove-committed');
    expect(none).not.toContain('data-testid="premove-clear" disabled=""');
  });
});

describe("SB-68 PM-2 / PS-M1: a premove may not reach another player's hidden cards", () => {
  test("one that moves or reorders another player's library is refused, not queued", () => {
    const auth = clone(deal(4601));
    const A = auth.activePlayer;
    const B = other(auth);
    const [weasel] = inject(auth, B, ['weasel_turner']);
    const start = advanceToTurnOf(auth, B)!;
    // Control: on the branch the card really does change A's library.
    const played = reduce(start, play(B, weasel!));
    expect(played.players[A]!.library).not.toEqual(start.players[A]!.library);

    const r = addPremove(EMPTY_TRACKER, auth, B, play(B, weasel!));
    expect([r.added, r.refusal]).toEqual([false, 'opponent']);
    expect(r.tracker.queue).toHaveLength(0);
  });

  test("one that only names a card in another player's library or hand (moving nothing) is refused", () => {
    // Three players, so someone's library is still full at the start of B's branch.
    const auth = clone(deal(4601, 3));
    const A = auth.activePlayer;
    const B = other(auth);
    const start = advanceToTurnOf(auth, B)!;
    const copper = start.players[B]!.hand.find((iid) => start.instances[iid]!.defId === 'copper')!;
    const victim = start.playerOrder.find((p) => p !== B && start.players[p]!.library.length > 0)!;
    expect(victim).toBeDefined();
    // A stand-in for a peek: the Copper's play also logs one hidden card.
    const peekAt = (pick: (s: GameState) => InstanceId) => (s: GameState, a: GameAction): GameState => {
      const next = reduce(s, a);
      if (a.type !== 'play') return next;
      const out = clone(next);
      out.logSeq += 1;
      out.log.push({ seq: out.logSeq, turn: out.turn, player: B, kind: 'reveal', detail: { iids: [pick(out)] } });
      return out;
    };
    const libraryTop = peekAt((s) => s.players[victim]!.library[0]!);
    const nextHandCard = peekAt((s) => s.players[A]!.hand[0]!);
    expect(addPremove(EMPTY_TRACKER, auth, B, play(B, copper), libraryTop).refusal).toBe('opponent');
    expect(addPremove(EMPTY_TRACKER, auth, B, play(B, copper), nextHandCard).refusal).toBe('opponent');
    // A card A holds now (round 4): the branch discarded it into A's graveyard,
    // in the open, so naming it would say what A holds.
    const heldNow = auth.players[A]!.hand[0]!;
    expect(start.players[A]!.gy).toContain(heldNow);
    const currentHandCard = peekAt(() => heldNow);
    expect(addPremove(EMPTY_TRACKER, auth, B, play(B, copper), currentHandCard).refusal).toBe('opponent');
    // The same Copper without the peek is queued.
    expect(addPremove(EMPTY_TRACKER, auth, B, play(B, copper)).added).toBe(true);
  });

  test("one that trashes from another player's hand is refused before it shows the hand the branch dealt them", () => {
    const auth = clone(deal(4602));
    const A = auth.activePlayer;
    const B = other(auth);
    const [gluten] = inject(auth, B, ['distilled_gluten']);
    const start = advanceToTurnOf(auth, B)!;
    // A's next hand exists only on the branch: ending A's turn dealt it.
    const nextHand = start.players[A]!.hand;
    expect(nextHand.length).toBeGreaterThan(0);
    // Control: played on the branch, the card takes a card out of that hand.
    const played = reduce(start, play(B, gluten!));
    expect(played.players[A]!.hand).not.toEqual(nextHand);

    const r = addPremove(EMPTY_TRACKER, auth, B, play(B, gluten!));
    expect([r.added, r.refusal]).toEqual([false, 'opponent']);
    expect(r.tracker.queue).toHaveLength(0);
  });
});

describe('SB-68 MERGE-6: no premoves during a draft', () => {
  function Probe(props: { state: GameState; me: PlayerId }): React.ReactElement {
    const pm = usePremove({ networked: true, state: props.state, me: props.me, submit: () => {} });
    return React.createElement('i', { 'data-available': String(pm.available) });
  }
  const probe = (state: GameState, me: PlayerId): string =>
    renderToStaticMarkup(React.createElement(Probe, { state, me }));

  test('unavailable until the last pick, then available', () => {
    let s = createMatch(CFG(2, { draftMode: true }), PLAYERS(2), 4701, null);
    expect(s.draft).not.toBeNull();
    const B = other(s);
    const picks = s.draft!.slots.filter((slot) => slot.pick === null && slot.options.length > 0);
    expect(picks.length).toBeGreaterThan(1);
    for (const slot of picks) {
      expect(premoveAvailable(true, s, B)).toBe(false);
      expect(probe(s, B)).toContain('data-available="false"');
      expect(addPremove(EMPTY_TRACKER, s, B, play(B, s.players[B]!.hand[0]!)).added).toBe(false);
      s = reduce(s, { type: 'draftPick', player: slot.player, slot: slot.index, defId: slot.options[0]! });
    }
    expect(s.draft).toBeNull();
    expect(premoveAvailable(true, s, other(s))).toBe(true);
    expect(probe(s, other(s))).toContain('data-available="true"');
  });
});

// ---------------------------------------------------------------------------
// 9. Review round 4: what premove mode shows, prompt answers, one tab per seat
// ---------------------------------------------------------------------------

/** Every instance another player keeps hidden from `me` in `state`: their hands and libraries. */
function hiddenNow(state: GameState, me: PlayerId): InstanceId[] {
  return state.playerOrder
    .filter((p) => p !== me)
    .flatMap((p) => [...state.players[p]!.hand, ...state.players[p]!.library]);
}

describe("SB-68 round 4: premove mode shows nothing of other players' hidden cards", () => {
  test('entering premove mode shows none of the cards other players hold now (2 and 3 players)', () => {
    let rawLeaks = 0;
    for (const players of [2, 3]) {
      for (const seed of [4801, 4802, 4803]) {
        const auth = deal(seed, players);
        for (const me of auth.playerOrder) {
          if (me === auth.activePlayer) continue;
          const fold = foldPremoves(auth, me, [])!;
          expect(fold).not.toBeNull();
          const secret = hiddenNow(auth, me);
          const raw = JSON.stringify(viewFor(fold.branch, me));
          rawLeaks += secret.filter((iid) => raw.includes(`"${iid}"`)).length;
          const view = premoveViewFor(auth, fold, me);
          expect(view.activePlayer).toBe(me);
          const shown = JSON.stringify(view);
          for (const iid of secret) expect(shown, `${players}p seed ${seed} seat ${me}`).not.toContain(`"${iid}"`);
        }
      }
    }
    // The control: the branch's own view does show them, because ending the
    // turns before yours discarded those hands into the open.
    expect(rawLeaks).toBeGreaterThan(0);
  });

  test('the premove view keeps your premoves and shows the other seats as they are now', () => {
    const auth = clone(deal(4101));
    const B = other(auth);
    const [card] = inject(auth, B, ['big_spenda']);
    const r = added(EMPTY_TRACKER, auth, B, play(B, card!));
    const view = premoveViewFor(auth, r.fold!, B);
    expect(view.you.play.map((c) => c.iid)).toEqual([card]);
    expect(view.log.some((e) => e.seq > r.fold!.states[0]!.logSeq && e.player === B)).toBe(true);
    expect(view.others).toEqual(viewFor(auth, B).others);
  });

  test("the hypothetical turn ends never run another player's hidden cards (a Bullseye in the hand)", () => {
    const auth = clone(deal(4101));
    const A = auth.activePlayer;
    const B = other(auth);
    const armed = clone(auth);
    inject(armed, A, ['bullseye']);
    // Control: really ending A's turn, the discarded Bullseye Nerfs cards in B's hand.
    const handAfter = (s: GameState): string => JSON.stringify(viewFor(advanceToTurnOf(s, B)!, B).you.hand);
    expect(handAfter(armed)).not.toBe(handAfter(auth));
    // The premove branch is the same whatever A holds.
    const shownTo = (s: GameState): string => {
      const fold = foldPremoves(s, B, [])!;
      const v = premoveViewFor(s, fold, B);
      return JSON.stringify({ you: v.you, shop: v.shop, pending: v.pending, turn: v.turn, cursor: fold.branch.rngCursor });
    };
    expect(shownTo(armed)).toBe(shownTo(auth));
  });

  test("a premove whose outcome reads another player's hidden cards is refused: Bribe and Firing Squad", () => {
    for (const defId of ['bribe', 'firing_squad']) {
      for (const seed of [4821, 4822, 4823]) {
        const auth = clone(deal(seed));
        const B = other(auth);
        const [card, plain] = inject(auth, B, [defId, 'copper']);
        const r = addPremove(EMPTY_TRACKER, auth, B, play(B, card!));
        expect([defId, seed, r.added, r.refusal]).toEqual([defId, seed, false, 'opponent']);
        expect(r.tracker.queue).toHaveLength(0);
        // The same seat can still premove a Copper.
        expect(addPremove(EMPTY_TRACKER, auth, B, play(B, plain!)).added).toBe(true);
      }
    }
  });
});

describe('SB-68 round 4: answering a prompt drops committed premoves, whatever the answer', () => {
  test('Mother Witch has B pick a card: the premoved one or another, the premoved draw is dropped alike', () => {
    const auth = clone(deal(4101));
    const A = auth.activePlayer;
    const B = other(auth);
    const [spenda, copper] = inject(auth, B, ['big_spenda', 'copper']);
    const [witch] = inject(auth, A, ['mother_witch']);
    const r = added(EMPTY_TRACKER, auth, B, play(B, spenda!));
    expect(committedCount(r.tracker)).toBe(1);
    const key = premoveStoreKey({ room: 'R', seat: 's', seed: auth.seed, checksum: 'c' });
    const reloaded = deserializeTracker(serializeTracker(r.tracker, key), key);

    const attacked = reduce(auth, play(A, witch!));
    const prompt = attacked.pending!;
    expect(prompt.player).toBe(B);
    const pickSpenda = prompt.options.find((o) => o.iid === spenda)!;
    const pickOther = prompt.options.find((o) => o.iid !== undefined && o.iid !== spenda)!;
    expect(pickSpenda).toBeDefined();
    expect(pickOther).toBeDefined();

    const outcome = (tracker: PremoveTracker, key: string) => {
      const answered = reduce(attacked, { type: 'resolve', player: B, promptId: prompt.id, keys: [key] });
      expect(answered.pending).toBeNull();
      // Synced straight from before the attack: this seat never saw the prompt's own state.
      const synced = syncPremoves(tracker, answered, B);
      const turn = advanceToTurnOf(answered, B)!;
      return {
        rolledBack: synced.rolledBack,
        queue: synced.tracker.queue.map((e) => e.kind),
        submitted: submitPremoves(synced.tracker, turn, B)!.actions.map((a) => a.type),
      };
    };
    const dropped = { rolledBack: true, queue: ['reroll'], submitted: ['reroll'] };
    expect(outcome(r.tracker, pickSpenda.key)).toEqual(dropped);
    expect(outcome(r.tracker, pickOther.key)).toEqual(dropped);
    // After a reload too.
    expect(outcome(reloaded, pickOther.key)).toEqual(dropped);

    // A premove that revealed nothing is not committed, and stays.
    const plain = added(EMPTY_TRACKER, auth, B, play(B, copper!));
    expect(committedCount(plain.tracker)).toBe(0);
    const notCopper = prompt.options.find((o) => o.iid !== undefined && o.iid !== copper)!;
    expect(outcome(plain.tracker, notCopper.key)).toEqual({ rolledBack: false, queue: ['action'], submitted: ['play'] });
  });
});

describe('SB-68 round 4: one tab per seat holds the premoves', () => {
  /** A LockManager in miniature: exclusive locks, granted in request order, abortable while queued. */
  function fakeLocks(): PremoveLocks {
    const waiting = new Map<string, Array<() => void>>();
    const held = new Set<string>();
    const release = (name: string): void => {
      const next = waiting.get(name)?.shift();
      if (next) next();
      else held.delete(name);
    };
    return {
      request(name, options, callback) {
        return new Promise((resolve) => {
          const grant = (): void => {
            held.add(name);
            void Promise.resolve(callback({ name })).then((value) => {
              resolve(value);
              release(name);
            });
          };
          options.signal?.addEventListener('abort', () => {
            const queue = waiting.get(name) ?? [];
            const at = queue.indexOf(grant);
            if (at >= 0) queue.splice(at, 1);
            resolve(undefined);
          });
          if (held.has(name)) waiting.set(name, [...(waiting.get(name) ?? []), grant]);
          else grant();
        });
      },
    };
  }

  test('a second tab waits, and takes over only when the first lets go', async () => {
    const locks = fakeLocks();
    const got: string[] = [];
    const seat = 'jlore_premove:R:seat-b:1:c';
    const releaseOne = holdPremoveLock(seat, () => got.push('one'), locks);
    const releaseTwo = holdPremoveLock(seat, () => got.push('two'), locks);
    const releaseOther = holdPremoveLock('jlore_premove:R:seat-c:1:c', () => got.push('other seat'), locks);
    await flush();
    expect(got).toEqual(['one', 'other seat']);
    releaseOne();
    await flush();
    expect(got).toEqual(['one', 'other seat', 'two']);
    // A tab that closes while it waits never takes over.
    const releaseThree = holdPremoveLock(seat, () => got.push('three'), locks);
    releaseThree();
    releaseTwo();
    await flush();
    expect(got).toEqual(['one', 'other seat', 'two']);
    releaseOther();
    // No lock manager (an insecure page): the tab holds it at once, as before.
    const alone: string[] = [];
    holdPremoveLock(seat, () => alone.push('held'), null)();
    expect(alone).toEqual(['held']);
  });
});
