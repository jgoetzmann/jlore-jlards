/**
 * T4 — Host loop and view publishing (S-NET). Behaviors B109, B110, B111.
 *
 * Written from .fullsend/SPEC.md against the frozen surface in src/engine/types.ts.
 *
 * B111 is the load-bearing one: it serializes every published view and refuses
 * to find a single instance id that belongs in somebody else's library or hand.
 * It must never be weakened or deleted.
 */
import { createMatch } from '@engine/index';
import { makeLocalRelay } from '@net/relay';
import { startHost } from '@net/host';
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

  test('B111: no published view, serialized to JSON, contains an instance id from another player’s library or hand', async () => {
    const relay = makeLocalRelay();
    const state = createMatch(CFG(3), SEATS(3), 7006, null);
    const handle = startHost(relay, state);
    let audited = 0;

    async function auditAgainstCurrentState(expected: number) {
      expect(await waitUntil(async () => (await views(relay)).length >= expected)).toBe(true);
      const published = await views(relay);
      const st = handle.getState();

      for (const m of published.slice(audited)) {
        const viewer = m.to as PlayerId;
        expect(st.playerOrder).toContain(viewer);
        const json = JSON.stringify(m.payload);
        for (const iid of hiddenIidsFor(st, viewer)) {
          expect(
            json.includes(iid),
            `view for ${viewer} leaked hidden instance ${iid}`,
          ).toBe(false);
        }
      }
      audited = published.length;
      expect(audited).toBeGreaterThanOrEqual(expected);
    }

    try {
      await auditAgainstCurrentState(3);
      for (let i = 0; i < 4; i++) {
        handle.submit({ type: 'endTurn', player: handle.getState().activePlayer });
        await auditAgainstCurrentState(3 * (i + 2));
      }
      expect(audited).toBeGreaterThanOrEqual(15);
    } finally {
      handle.stop();
    }
  });

  test('B111: a published view does not carry the viewer’s own library instance ids either', async () => {
    const relay = makeLocalRelay();
    const state = createMatch(CFG(2), SEATS(2), 7007, null);
    const handle = startHost(relay, state);
    try {
      expect(await waitUntil(async () => (await views(relay)).length >= 2)).toBe(true);
      const st = handle.getState();

      for (const m of await views(relay)) {
        const viewer = m.to as PlayerId;
        const json = JSON.stringify(m.payload);
        for (const iid of st.players[viewer].library) {
          expect(json.includes(iid), `view for ${viewer} leaked own library card ${iid}`).toBe(
            false,
          );
        }
      }
    } finally {
      handle.stop();
    }
  });

  test('B111: every published view reports opponents by hand count only, with no card list', async () => {
    const relay = makeLocalRelay();
    const state = createMatch(CFG(3), SEATS(3), 7008, null);
    const handle = startHost(relay, state);
    try {
      expect(await waitUntil(async () => (await views(relay)).length >= 3)).toBe(true);
      const st = handle.getState();

      for (const m of await views(relay)) {
        const v = m.payload as GameView;
        for (const o of v.others) {
          expect(typeof o.handCount).toBe('number');
          expect(o.handCount).toBe(st.players[o.id].hand.length);
          expect((o as unknown as Record<string, unknown>).hand).toBeUndefined();
        }
      }
    } finally {
      handle.stop();
    }
  });
});
