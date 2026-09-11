/**
 * Lockstep sessions (SB-65). Every browser folds the same relay list through
 * `reduce`; these pin the properties that make that safe:
 *
 *  - one start message builds the identical state everywhere (B119),
 *  - a press is applied locally before it is posted, and confirmed without a
 *    second reduce when it comes back in order,
 *  - a foreign intent landing first forces a refold, and the refold agrees,
 *  - many bot-driven turns across a host and two clients never diverge,
 *  - a batch unrolls in order and stops at the first refusal or prompt,
 *  - reorderHand reaches the engine (it used to be dropped by a legality gate),
 *  - a refresh replays the room and lands on the same state,
 *  - a drifted client notices, rebuilds, and if that fails, adopts the host's.
 */
import { createMatch, reduce } from '@engine/index';
import { viewFor } from '@engine/view';
import { botAction } from '@sim/bot';
import { makeLocalRelay } from '@net/relay';
import {
  applyActions,
  buildStartState,
  LockstepCore,
  makeStart,
  parseIntent,
  startSession,
  stateChecksum,
  START_TAG,
  type LockstepSession,
  type StartPayload,
} from '@net/lockstep';
import type { CardDefId, GameAction, GameState, MatchConfig, PlayerId } from '@engine/types';

const CFG = (playerCount: number, over: Partial<MatchConfig> = {}): MatchConfig => ({
  playerCount,
  draftPileCount: 10,
  anomalyChance: 0.3,
  winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
  pileSizeScale: 1,
  effectNodeBudget: 200,
  recursionDepth: 8,
  turnSeconds: 60,
  seedCodexWithCommons: true,
  ...over,
});

const PLAYERS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    codex: [] as CardDefId[],
  }));

function dealSpec(n: number, seed: number, seats: string[]) {
  return { seats, config: CFG(n), seed, players: PLAYERS(n) };
}

/** Who has to act next: a prompt's owner, else the active player. */
function mover(state: GameState): PlayerId {
  return state.pending ? state.pending.player : state.activePlayer;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function copperIn(state: GameState, pid: PlayerId): string | null {
  for (const iid of state.players[pid]!.hand) {
    if (state.instances[iid]?.defId === 'copper') return iid;
  }
  return null;
}

describe('lockstep — pure pieces', () => {
  test('B119: a start payload builds the identical state on every client', () => {
    const { payload, state } = makeStart(dealSpec(3, 4242, ['a', 'b', 'c']));
    const wire = JSON.parse(JSON.stringify(payload)) as StartPayload;
    const rebuilt = buildStartState(wire);
    expect(stateChecksum(rebuilt)).toBe(payload.checksum);
    expect(stateChecksum(state)).toBe(payload.checksum);
    expect(rebuilt).toEqual(state);
  });

  test('the checksum ignores key order and the log body, and sees real differences', () => {
    const st = createMatch(CFG(2), PLAYERS(2), 77);
    const shuffled = JSON.parse(JSON.stringify({ ...st, log: [] })) as GameState;
    expect(stateChecksum(shuffled)).toBe(stateChecksum(st));
    const moved = reduce(st, { type: 'endTurn', player: st.activePlayer });
    expect(stateChecksum(moved)).not.toBe(stateChecksum(st));
  });

  test('parseIntent accepts a batch, a bare action, and refuses a start', () => {
    expect(parseIntent({ nonce: 'n1', actions: [{ type: 'endTurn', player: 'p1' }] })).toEqual({
      nonce: 'n1',
      actions: [{ type: 'endTurn', player: 'p1' }],
    });
    expect(parseIntent({ type: 'endTurn', player: 'p1' })?.actions).toHaveLength(1);
    expect(parseIntent({ nonce: 'x', actions: [{ type: 'start' }] })).toBeNull();
    expect(parseIntent(null)).toBeNull();
  });

  test('a batch stops at the first refused action', () => {
    const st = createMatch(CFG(2, { anomalyChance: 0 }), PLAYERS(2), 91);
    const pid = st.activePlayer;
    const coppers = st.players[pid]!.hand.filter((iid) => st.instances[iid]?.defId === 'copper');
    expect(coppers.length).toBeGreaterThan(1);
    const actions: GameAction[] = [
      { type: 'play', player: pid, iid: coppers[0]! },
      { type: 'play', player: pid, iid: 'i_does_not_exist' },
      { type: 'play', player: pid, iid: coppers[1]! },
    ];
    const after = applyActions(st, actions, pid);
    // The first Copper resolved, the bogus one was refused, the third never ran.
    expect(after.players[pid]!.hand).toContain(coppers[1]);
    expect(after.players[pid]!.hand).not.toContain(coppers[0]);
    expect(after.log.some((e) => e.kind === 'reject')).toBe(true);
  });

  test('the actor comes from the binding, never from the payload', () => {
    const st = createMatch(CFG(2, { anomalyChance: 0 }), PLAYERS(2), 92);
    const other = st.playerOrder.find((p) => p !== st.activePlayer)!;
    // Claims to be the active player; bound to the other seat, it is refused.
    const after = applyActions(st, [{ type: 'endTurn', player: st.activePlayer }], other);
    expect(after.activePlayer).toBe(st.activePlayer);
    expect(after.log[after.log.length - 1]!.kind).toBe('reject');
  });
});

describe('lockstep — sessions over a local relay', () => {
  function table(n: number, seed: number, opts: { checks?: boolean } = {}) {
    const relay = makeLocalRelay();
    const seats = Array.from({ length: n }, (_, i) => `seat${i}`);
    const start = makeStart(dealSpec(n, seed, seats));
    const changes = new Map<string, number>();
    const bump = (s: string) => () => changes.set(s, (changes.get(s) ?? 0) + 1);
    const sessions: LockstepSession[] = [
      startSession(relay, {
        localSeats: [seats[0]!],
        start,
        onChange: bump(seats[0]!),
        checks: opts.checks,
      }),
    ];
    for (let i = 1; i < n; i++) {
      sessions.push(
        startSession(relay, { localSeats: [seats[i]!], onChange: bump(seats[i]!), checks: opts.checks }),
      );
    }
    return { relay, seats, sessions, start, changes };
  }

  test('a host and two clients reach identical states over many bot-driven turns', async () => {
    const { seats, sessions } = table(3, 1337, { checks: true });
    try {
      await flush();
      for (const s of sessions) expect(s.core.started()).toBe(true);

      let steps = 0;
      while (steps < 400) {
        const st = sessions[0]!.core.predicted()!;
        if (st.ended) break;
        const pid = mover(st);
        const idx = st.playerOrder.indexOf(pid);
        const s = sessions[idx]!;
        const own = s.core.predicted()!;
        s.send(seats[idx]!, botAction(own, pid));
        steps++;
        if (steps % 7 === 0) await flush();
        else await Promise.resolve();
      }
      await flush();
      const sums = sessions.map((s) => stateChecksum(s.core.confirmedState()!));
      expect(new Set(sums).size).toBe(1);
      for (const s of sessions) {
        expect(s.core.pendingCount()).toBe(0);
        expect(s.core.desynced()).toBe(false);
      }
      const turn = sessions[0]!.core.confirmedState()!.turn;
      expect(turn).toBeGreaterThan(6);
    } finally {
      for (const s of sessions) s.stop();
    }
  });

  test('a press renders before the relay answers, and its echo is adopted without a second reduce', async () => {
    const { seats, sessions } = table(2, 2024);
    try {
      await flush();
      const st = sessions[0]!.core.predicted()!;
      const pid = st.activePlayer;
      const idx = st.playerOrder.indexOf(pid);
      const s = sessions[idx]!;
      const iid = copperIn(s.core.predicted()!, pid);
      expect(iid).not.toBeNull();

      s.send(seats[idx]!, { type: 'play', player: pid, iid: iid! });
      // Synchronously: the prediction already has the Copper in play.
      const predicted = s.core.predicted()!;
      expect(predicted.players[pid]!.play).toContain(iid);
      expect(s.core.pendingCount()).toBe(1);

      await flush();
      // The echo confirmed exactly the object we predicted: no refold happened.
      expect(s.core.pendingCount()).toBe(0);
      expect(s.core.confirmedState()).toBe(predicted);
      // The other client folded it itself and agrees.
      const other = sessions[1 - idx]!;
      expect(stateChecksum(other.core.confirmedState()!)).toBe(stateChecksum(predicted));
    } finally {
      for (const s of sessions) s.stop();
    }
  });

  test('a foreign intent landing first forces a refold that agrees with everyone', async () => {
    // Drive the cores directly so the interleaving is exact.
    const { payload, state } = makeStart(dealSpec(2, 5150, ['A', 'B']));
    const a = new LockstepCore({ localSeats: ['A'] });
    const b = new LockstepCore({ localSeats: ['B'] });
    const startMsg = { seq: 1, from: 'A', kind: 'snapshot' as const, payload };
    a.adoptLocalStart(payload, state);
    a.ingest([startMsg]);
    b.ingest([startMsg]);

    const active = state.activePlayer;
    const seatOfActive = active === 'p1' ? 'A' : 'B';
    const actor = seatOfActive === 'A' ? a : b;
    const bystander = seatOfActive === 'A' ? b : a;
    const bystanderSeat = seatOfActive === 'A' ? 'B' : 'A';
    const bystanderPid = bystanderSeat === 'A' ? 'p1' : 'p2';

    // The bystander predicts something (an off-turn reorder: refused by B20,
    // but the refusal is itself a logged state change) ...
    const hand = state.players[bystanderPid]!.hand.slice().reverse();
    const mine = bystander.propose(bystanderSeat, [
      { type: 'reorderHand', player: bystanderPid, hand },
    ])!;
    // ... while the active player's endTurn reaches the relay first.
    const theirs = actor.propose(seatOfActive, [{ type: 'endTurn', player: active }])!;

    const list = [
      { seq: 2, from: seatOfActive, kind: 'intent' as const, payload: theirs },
      { seq: 3, from: bystanderSeat, kind: 'intent' as const, payload: mine },
    ];
    bystander.ingest([list[0]!]);
    // The pending reorder was refolded on top of the new turn.
    expect(bystander.pendingCount()).toBe(1);
    expect(bystander.confirmedState()!.activePlayer).not.toBe(active);
    bystander.ingest([list[1]!]);
    actor.ingest(list);

    expect(bystander.pendingCount()).toBe(0);
    expect(actor.pendingCount()).toBe(0);
    expect(stateChecksum(bystander.confirmedState()!)).toBe(stateChecksum(actor.confirmedState()!));
    // It is now the bystander's turn, so the reorder was legal and took effect.
    expect(bystander.confirmedState()!.players[bystanderPid]!.hand).toEqual(hand);
  });

  test('TURN-5: an on-turn reorderHand takes effect and every client sees the new order', async () => {
    const { seats, sessions } = table(2, 808);
    try {
      await flush();
      const st = sessions[0]!.core.predicted()!;
      const pid = st.activePlayer;
      const idx = st.playerOrder.indexOf(pid);
      const reversed = st.players[pid]!.hand.slice().reverse();
      sessions[idx]!.send(seats[idx]!, { type: 'reorderHand', player: pid, hand: reversed });
      expect(viewFor(sessions[idx]!.core.predicted()!, pid).you.hand.map((c) => c.iid)).toEqual(reversed);
      await flush();
      for (const s of sessions) {
        expect(s.core.confirmedState()!.players[pid]!.hand).toEqual(reversed);
      }
    } finally {
      for (const s of sessions) s.stop();
    }
  });

  test('sendMany posts one intent that every client unrolls in order', async () => {
    const relay = makeLocalRelay();
    const seats = ['h', 'g'];
    const start = makeStart({ ...dealSpec(2, 606, seats), config: CFG(2, { anomalyChance: 0 }) });
    const host = startSession(relay, { localSeats: ['h'], start, onChange: () => {} });
    const guest = startSession(relay, { localSeats: ['g'], onChange: () => {} });
    try {
      await flush();
      const st = host.core.predicted()!;
      const pid = st.activePlayer;
      const s = pid === 'p1' ? host : guest;
      const seat = pid === 'p1' ? 'h' : 'g';
      const coppers = st.players[pid]!.hand.filter((iid) => st.instances[iid]?.defId === 'copper');
      expect(coppers.length).toBeGreaterThan(1);
      const intentsBefore = relay.messages().filter((m) => m.kind === 'intent').length;
      s.sendMany(
        seat,
        coppers.map((iid) => ({ type: 'play', player: pid, iid }) as GameAction),
      );
      await flush();
      const intents = relay.messages().filter((m) => m.kind === 'intent');
      expect(intents.length - intentsBefore).toBe(1);
      for (const x of [host, guest]) {
        const conf = x.core.confirmedState()!;
        for (const iid of coppers) expect(conf.players[pid]!.play).toContain(iid);
        expect(conf.players[pid]!.money).toBeGreaterThanOrEqual(coppers.length);
      }
    } finally {
      host.stop();
      guest.stop();
    }
  });

  test('a refresh replays the room from index 0 and lands on the same state and seat', async () => {
    const { relay, seats, sessions } = table(2, 3141);
    try {
      await flush();
      for (let i = 0; i < 60; i++) {
        const st = sessions[0]!.core.predicted()!;
        if (st.ended) break;
        const pid = mover(st);
        const idx = st.playerOrder.indexOf(pid);
        sessions[idx]!.send(seats[idx]!, botAction(sessions[idx]!.core.predicted()!, pid));
        await Promise.resolve();
      }
      await flush();
      // The guest's tab reloads: a brand-new session with the same seat token.
      sessions[1]!.stop();
      const back = startSession(relay, { localSeats: [seats[1]!], onChange: () => {} });
      await flush();
      expect(back.core.playerOf(seats[1]!)).toBe('p2');
      expect(stateChecksum(back.core.confirmedState()!)).toBe(
        stateChecksum(sessions[0]!.core.confirmedState()!),
      );
      sessions[1] = back;
    } finally {
      for (const s of sessions) s.stop();
    }
  });

  test('the host reloading comes back as its own seat, and play continues', async () => {
    const { relay, seats, sessions } = table(2, 2718, { checks: true });
    try {
      await flush();
      sessions[0]!.stop();
      const host = startSession(relay, { localSeats: [seats[0]!], onChange: () => {}, checks: true });
      sessions[0] = host;
      await flush();
      expect(host.core.playerOf(seats[0]!)).toBe('p1');
      expect(host.core.isAuthority()).toBe(true);
      const st = host.core.predicted()!;
      const idx = st.playerOrder.indexOf(st.activePlayer);
      sessions[idx]!.send(seats[idx]!, { type: 'endTurn', player: st.activePlayer });
      await flush();
      expect(stateChecksum(sessions[0]!.core.confirmedState()!)).toBe(
        stateChecksum(sessions[1]!.core.confirmedState()!),
      );
      expect(sessions[1]!.core.confirmedState()!.turn).toBe(2);
    } finally {
      for (const s of sessions) s.stop();
    }
  });

  test('a drifted client is caught at the next turn boundary and rebuilds from the list', async () => {
    const { seats, sessions } = table(2, 4040, { checks: true });
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((m: string) => errors.push(m));
    try {
      await flush();
      // Something went wrong in the guest's fold (a bad prediction, a bug).
      sessions[1]!.core.corruptForTest((s) => ({ ...s, rngCursor: s.rngCursor + 999 }));
      const st = sessions[0]!.core.predicted()!;
      const idx = st.playerOrder.indexOf(st.activePlayer);
      sessions[idx]!.send(seats[idx]!, { type: 'endTurn', player: st.activePlayer });
      await flush();
      await flush();
      expect(errors.some((m) => m.includes('rebuilt'))).toBe(true);
      expect(stateChecksum(sessions[1]!.core.confirmedState()!)).toBe(
        stateChecksum(sessions[0]!.core.confirmedState()!),
      );
      expect(sessions[1]!.core.desynced()).toBe(false);
    } finally {
      spy.mockRestore();
      for (const s of sessions) s.stop();
    }
  });

  test('a client whose engine disagrees says so loudly and adopts the host state', async () => {
    const relay = makeLocalRelay();
    const seats = ['h', 'g'];
    const start = makeStart(dealSpec(2, 5555, seats));
    // The guest's reducer quietly differs: every endTurn nudges rngCursor.
    const skewed = (s: GameState, a: GameAction): GameState => {
      const next = reduce(s, a);
      return a.type === 'endTurn' ? { ...next, rngCursor: next.rngCursor + 1 } : next;
    };
    const reports: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((m: string) => reports.push(m));
    const host = startSession(relay, { localSeats: ['h'], start, onChange: () => {}, checks: true });
    const guest = startSession(relay, {
      localSeats: ['g'],
      onChange: () => {},
      checks: true,
      reduce: skewed,
    });
    try {
      await flush();
      const st = host.core.predicted()!;
      const s = st.activePlayer === 'p1' ? host : guest;
      s.send(st.activePlayer === 'p1' ? 'h' : 'g', { type: 'endTurn', player: st.activePlayer });
      await flush();
      await flush();
      expect(reports.some((m) => m.includes('DESYNC'))).toBe(true);
      // The host's state came over the relay and the guest took it.
      expect(relay.messages().some((m) => (m.payload as { tag?: string })?.tag === 'jlore-state/1')).toBe(true);
      expect(stateChecksum(guest.core.confirmedState()!)).toBe(stateChecksum(host.core.confirmedState()!));
      expect(guest.core.desynced()).toBe(false);
    } finally {
      spy.mockRestore();
      host.stop();
      guest.stop();
    }
  });

  test('the first start in a room is the match; a second one is ignored', async () => {
    const relay = makeLocalRelay();
    const one = makeStart(dealSpec(2, 1, ['a', 'b']));
    const two = makeStart(dealSpec(2, 2, ['a', 'b']));
    await relay.post({ from: 'a', kind: 'snapshot', payload: one.payload });
    await relay.post({ from: 'a', kind: 'snapshot', payload: two.payload });
    const s = startSession(relay, { localSeats: ['b'], onChange: () => {} });
    try {
      expect(s.core.startPayload()?.checksum).toBe(one.payload.checksum);
      expect(s.core.startPayload()?.tag).toBe(START_TAG);
    } finally {
      s.stop();
    }
  });

  test('a resumed match with an open seat is claimed by the next hello, deterministically', async () => {
    const relay = makeLocalRelay();
    const mid = createMatch(CFG(2), PLAYERS(2), 999);
    const start = makeStart({ seats: ['host'], state: mid });
    const host = startSession(relay, { localSeats: ['host'], start, onChange: () => {} });
    const guest = startSession(relay, {
      localSeats: ['guest'],
      onChange: () => {},
      hello: { name: 'G', codex: [] },
      heartbeatMs: 20,
    });
    const late = startSession(relay, {
      localSeats: ['late'],
      onChange: () => {},
      hello: { name: 'L', codex: [] },
      heartbeatMs: 20,
    });
    try {
      await flush();
      await new Promise((r) => setTimeout(r, 80));
      expect(guest.core.playerOf('guest') ?? late.core.playerOf('late')).toBe('p2');
      // Exactly one of them got the seat, and every client agrees which.
      const claimant = guest.core.playerOf('guest') === 'p2' ? 'guest' : 'late';
      for (const s of [host, guest, late]) expect(s.core.playerOf(claimant)).toBe('p2');
      const loser = claimant === 'guest' ? 'late' : 'guest';
      for (const s of [host, guest, late]) expect(s.core.playerOf(loser)).toBeNull();
    } finally {
      host.stop();
      guest.stop();
      late.stop();
    }
  });
});
