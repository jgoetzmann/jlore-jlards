/**
 * T4 — Host loop and views (S-NET). Behaviors B109, B110, B111.
 *
 * B109/B110 pin `startHost`, the view-publishing host. The app no longer runs
 * it — since SB-65 every browser folds the relay list itself (lockstep) — but
 * it is still a working, tested module the lobby suite drives.
 *
 * B111 used to say "no view published to the relay carries a hidden instance
 * id". That described the old design, where the relay carried one filtered
 * view per seat. It no longer does: after the deal it carries intents, and
 * every browser holds the full state (hidden information is waived for
 * playtesting — SB-65). What stays true, and what B111 now pins, is the UI
 * boundary: the only thing React is ever handed is `viewFor(state, you)`, so
 * the table still never renders another player's hand or anyone's library.
 * The e2e hidden-hand test checks the same property against the live DOM.
 */
import { createMatch } from '@engine/index';
import { viewFor } from '@engine/view';
import { botAction } from '@sim/bot';
import { makeLocalRelay } from '@net/relay';
import { startHost } from '@net/host';
import { makeStart, startSession, type LockstepSession } from '@net/lockstep';
import type { Relay } from '@net/relay';
import type {
  CardDefId,
  GameState,
  GameView,
  MatchConfig,
  PlayerId,
  RelayMessage,
} from '@engine/types';

const CFG = (playerCount: number, over: Partial<MatchConfig> = {}): MatchConfig => ({
  playerCount,
  draftPileCount: 10,
  anomalyChance: 0,
  winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
  pileSizeScale: 1,
  effectNodeBudget: 500,
  recursionDepth: 8,
  turnSeconds: 60,
  seedCodexWithCommons: true,
  ...over,
});

const SEATS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    codex: [] as CardDefId[],
  }));

async function waitUntil(fn: () => Promise<boolean>, ms = 2000): Promise<boolean> {
  const started = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - started > ms) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function views(relay: Relay): Promise<RelayMessage[]> {
  return (await relay.poll(0)).filter((m) => m.kind === 'view');
}

function hiddenIidsFor(state: GameState, viewer: PlayerId): string[] {
  const out: string[] = [];
  for (const p of state.playerOrder) {
    if (p === viewer) continue;
    out.push(...state.players[p].library, ...state.players[p].hand);
  }
  return out;
}

describe('S-NET — host', () => {
  test('B109: starting the host publishes exactly one view per seat', async () => {
    const relay = makeLocalRelay();
    const state = createMatch(CFG(3), SEATS(3), 7001, null);
    const handle = startHost(relay, state);
    try {
      const ready = await waitUntil(async () => (await views(relay)).length >= 3);
      expect(ready).toBe(true);

      const published = await views(relay);
      expect(published).toHaveLength(3);
      expect(new Set(published.map((m) => m.to))).toEqual(new Set(['p1', 'p2', 'p3']));
      for (const m of published) {
        const v = m.payload as GameView;
        expect(v.you.id).toBe(m.to);
      }
    } finally {
      handle.stop();
    }
  });

  test('B109: every state change republishes one view per seat, reflecting the new state', async () => {
    const relay = makeLocalRelay();
    const state = createMatch(CFG(3), SEATS(3), 7002, null);
    const handle = startHost(relay, state);
    try {
      expect(await waitUntil(async () => (await views(relay)).length >= 3)).toBe(true);
      const before = handle.getState();

      handle.submit({ type: 'endTurn', player: before.activePlayer });
      expect(await waitUntil(async () => (await views(relay)).length >= 6)).toBe(true);

      const after = handle.getState();
      expect(after.activePlayer).not.toBe(before.activePlayer);

      const fresh = (await views(relay)).slice(3, 6);
      expect(new Set(fresh.map((m) => m.to))).toEqual(new Set(['p1', 'p2', 'p3']));
      for (const m of fresh) {
        const v = m.payload as GameView;
        expect(v.activePlayer).toBe(after.activePlayer);
        expect(v.turn).toBe(after.turn);
      }
    } finally {
      handle.stop();
    }
  });

  test('B109: the host never addresses a view to a seat that is not in the match', async () => {
    const relay = makeLocalRelay();
    const state = createMatch(CFG(2), SEATS(2), 7003, null);
    const handle = startHost(relay, state);
    try {
      expect(await waitUntil(async () => (await views(relay)).length >= 2)).toBe(true);
      handle.submit({ type: 'endTurn', player: handle.getState().activePlayer });
      expect(await waitUntil(async () => (await views(relay)).length >= 4)).toBe(true);

      const seats = new Set(handle.getState().playerOrder);
      for (const m of await views(relay)) {
        expect(m.to).toBeDefined();
        expect(seats.has(m.to as PlayerId)).toBe(true);
      }
    } finally {
      handle.stop();
    }
  });

  test('B110: a client that sends hello receives a fresh view addressed to its seat', async () => {
    const relay = makeLocalRelay();
    const state = createMatch(CFG(3), SEATS(3), 7004, null);
    const handle = startHost(relay, state);
    try {
      expect(await waitUntil(async () => (await views(relay)).length >= 3)).toBe(true);
      const baseline = (await views(relay)).length;

      await relay.post({ from: 'p2', kind: 'hello', payload: {} });
      expect(
        await waitUntil(async () =>
          (await views(relay)).slice(baseline).some((m) => m.to === 'p2'),
        ),
      ).toBe(true);

      const reply = (await views(relay)).slice(baseline).find((m) => m.to === 'p2')!;
      const v = reply.payload as GameView;
      expect(v.you.id).toBe('p2');
      expect(v.turn).toBe(handle.getState().turn);
      expect(v.activePlayer).toBe(handle.getState().activePlayer);
    } finally {
      handle.stop();
    }
  });

  test('B110: the view a seat gets back never lists that seat among the opponents', async () => {
    const relay = makeLocalRelay();
    const state = createMatch(CFG(3), SEATS(3), 7005, null);
    const handle = startHost(relay, state);
    try {
      expect(await waitUntil(async () => (await views(relay)).length >= 3)).toBe(true);
      await relay.post({ from: 'p3', kind: 'hello', payload: {} });
      expect(
        await waitUntil(async () => (await views(relay)).filter((x) => x.to === 'p3').length >= 2),
      ).toBe(true);

      const forP3 = (await views(relay)).filter((x) => x.to === 'p3');
      for (const m of forP3) {
        const v = m.payload as GameView;
        expect(v.others.map((o) => o.id)).not.toContain('p3');
        expect(new Set(v.others.map((o) => o.id))).toEqual(new Set(['p1', 'p2']));
      }
    } finally {
      handle.stop();
    }
  });

  test('HOST-1/TURN-5: the view host no longer drops an on-turn reorderHand', async () => {
    const relay = makeLocalRelay();
    const state = createMatch(CFG(2), SEATS(2), 7009, null);
    const handle = startHost(relay, state);
    try {
      const pid = state.activePlayer;
      const reversed = state.players[pid]!.hand.slice().reverse();
      handle.submit({ type: 'reorderHand', player: pid, hand: reversed });
      expect(handle.getState().players[pid]!.hand).toEqual(reversed);
    } finally {
      handle.stop();
    }
  });

  test('the view host no longer posts a full-state snapshot to the relay (NET-6)', async () => {
    const relay = makeLocalRelay();
    const state = createMatch(CFG(2), SEATS(2), 7010, null);
    const handle = startHost(relay, state);
    try {
      handle.submit({ type: 'endTurn', player: state.activePlayer });
      expect(await waitUntil(async () => (await views(relay)).length >= 4)).toBe(true);
      expect((await relay.poll(0)).some((m) => m.kind === 'snapshot')).toBe(false);
    } finally {
      handle.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// B111, restated for lockstep (SB-65)
// ---------------------------------------------------------------------------

describe('S-NET — what a lockstep browser renders (B111)', () => {
  /** Three browsers, one room, a bot playing every seat through its own session. */
  async function playTable(seed: number, steps: number, audit: (s: LockstepSession, seat: string) => void) {
    const relay = makeLocalRelay();
    const seats = ['s0', 's1', 's2'];
    const start = makeStart({ seats, config: CFG(3, { anomalyChance: 0.3 }), seed, players: SEATS(3) });
    const sessions = seats.map((seat, i) =>
      startSession(relay, { localSeats: [seat], start: i === 0 ? start : null, onChange: () => {} }),
    );
    try {
      await new Promise((r) => setTimeout(r, 0));
      for (let n = 0; n < steps; n++) {
        const st = sessions[0]!.core.predicted()!;
        if (st.ended) break;
        const who = st.pending ? st.pending.player : st.activePlayer;
        const i = st.playerOrder.indexOf(who);
        sessions[i]!.send(seats[i]!, botAction(sessions[i]!.core.predicted()!, who));
        await Promise.resolve();
        if (n % 5 === 0) {
          await new Promise((r) => setTimeout(r, 0));
          sessions.forEach((s, j) => audit(s, seats[j]!));
        }
      }
      await new Promise((r) => setTimeout(r, 0));
      sessions.forEach((s, j) => audit(s, seats[j]!));
      return { relay, sessions };
    } finally {
      for (const s of sessions) s.stop();
    }
  }

  test('B111: the view React is handed never contains another player’s library or hand ids', async () => {
    let audited = 0;
    await playTable(7106, 150, (s, seat) => {
      const st = s.core.predicted()!;
      const you = s.core.playerOf(seat)!;
      const json = JSON.stringify(viewFor(st, you));
      for (const iid of hiddenIidsFor(st, you)) {
        expect(json.includes(iid), `view for ${you} carries hidden instance ${iid}`).toBe(false);
      }
      audited++;
    });
    expect(audited).toBeGreaterThanOrEqual(30);
  });

  test('B111: the view React is handed carries none of the viewer’s own library ids either', async () => {
    await playTable(7107, 80, (s, seat) => {
      const st = s.core.predicted()!;
      const you = s.core.playerOf(seat)!;
      const json = JSON.stringify(viewFor(st, you));
      for (const iid of st.players[you]!.library) {
        expect(json.includes(iid), `view for ${you} carries own library card ${iid}`).toBe(false);
      }
    });
  });

  test('B111: opponents reach the view as hand counts, with no card list', async () => {
    await playTable(7108, 60, (s, seat) => {
      const st = s.core.predicted()!;
      const v = viewFor(st, s.core.playerOf(seat)!);
      for (const o of v.others) {
        expect(o.handCount).toBe(st.players[o.id]!.hand.length);
        expect((o as unknown as Record<string, unknown>).hand).toBeUndefined();
      }
    });
  });

  test('SB-65: after the deal the relay carries intents, not views — and a browser does hold full state', async () => {
    const { relay, sessions } = await playTable(7109, 40, () => {});
    const all = relay.messages();
    const startAt = all.findIndex((m) => (m.payload as { tag?: string })?.tag === 'jlore-start/1');
    expect(startAt).toBeGreaterThanOrEqual(0);
    expect(all.slice(startAt).some((m) => m.kind === 'view')).toBe(false);
    expect(all.slice(startAt + 1).filter((m) => m.kind === 'intent').length).toBeGreaterThan(10);
    // Stated plainly, because it is the trade SB-65 makes: every browser's
    // memory has every hand. Only the UI boundary above keeps them off screen.
    const st = sessions[1]!.core.confirmedState()!;
    expect(st.players.p1!.hand.length + st.players.p3!.hand.length).toBeGreaterThan(0);
  });
});
