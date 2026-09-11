/**
 * The lobby: a room that exists before a match does.
 *
 * The bug this pins was measured in three real browsers. Creating a room dealt
 * a match immediately, for a player count guessed on the start screen, so seats
 * existed before people did: the first joiner waited out a hello retry cycle for
 * one (>20s), and the second never had one at all — "Joining…" forever.
 *
 * So the properties worth testing are about *when* cards are dealt and *who*
 * they are dealt for:
 *
 *   - a fresh room has a roster and no game state,
 *   - somebody arriving shows up on the roster within a poll or two,
 *   - Start deals for the people actually present, not a guess,
 *   - every one of them is addressed on the very first publish, with no hello
 *     round trip,
 *   - and a browser that opens the link afterwards is told so, rather than
 *     being left on a spinner.
 *
 * There is no new `RelayMessage.kind` here. Presence rides `hello` and the
 * roster rides a broadcast `view`; `isLobbyPayload` and the client's `isView`
 * are mutually exclusive, so neither reader ever sees the other's traffic.
 */
import { createMatch } from '@engine/index';
import { makeLocalRelay, isLobbyPayload, type LobbyPayload, type Relay } from '@net/relay';
import { startHost, startLobbyHost } from '@net/host';
import { startClient } from '@net/client';
import type { CardDefId, GameView, MatchConfig, RelayMessage } from '@engine/types';

const CFG = (playerCount: number): MatchConfig => ({
  playerCount,
  draftPileCount: 10,
  anomalyChance: 0,
  winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
  pileSizeScale: 1,
  effectNodeBudget: 500,
  recursionDepth: 8,
  turnSeconds: 60,
  seedCodexWithCommons: true,
});

async function waitUntil(fn: () => boolean | Promise<boolean>, ms = 3000): Promise<boolean> {
  const started = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - started > ms) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Somebody opening the room link, before any UI exists. */
async function knock(relay: Relay, seat: string, name: string): Promise<void> {
  await relay.post({ from: seat, kind: 'hello', payload: { name, seat, codex: [] as CardDefId[] } });
}

async function gameViews(relay: Relay): Promise<RelayMessage[]> {
  return (await relay.poll(0)).filter((m) => m.kind === 'view' && !isLobbyPayload(m.payload));
}

describe('S-NET — lobby', () => {
  test('a new room has a roster with only the host in it, and no match', async () => {
    const relay = makeLocalRelay();
    const seen: LobbyPayload[] = [];
    const lobby = startLobbyHost(relay, {
      code: 'AAA111',
      hostSeat: 's_host',
      hostName: 'Ada',
      seatCap: 4,
      onRoster: (r) => seen.push(r),
    });
    try {
      expect(seen.length).toBeGreaterThan(0);
      const first = seen[seen.length - 1]!;
      expect(first.members).toHaveLength(1);
      expect(first.members[0]).toMatchObject({ seat: 's_host', name: 'Ada', host: true });
      expect(first.started).toBe(false);
      expect(first.seatCap).toBe(4);

      // Nothing has been dealt: the room carries a roster and nothing else.
      expect(await gameViews(relay)).toHaveLength(0);
    } finally {
      lobby.stop();
    }
  });

  test('three people arriving all appear on the roster, promptly', async () => {
    const relay = makeLocalRelay();
    let roster: LobbyPayload | null = null;
    const lobby = startLobbyHost(relay, {
      code: 'AAA222',
      hostSeat: 's_host',
      hostName: 'Ada',
      seatCap: 4,
      onRoster: (r) => {
        roster = r;
      },
    });
    try {
      await knock(relay, 's_one', 'Bru');
      await knock(relay, 's_two', 'Cyd');

      expect(
        await waitUntil(() => (roster?.members.length ?? 0) === 3),
        'both joiners should reach the roster',
      ).toBe(true);

      const names = (roster as unknown as LobbyPayload).members.map((m) => m.name);
      expect(names).toEqual(['Ada', 'Bru', 'Cyd']);
      const hosts = (roster as unknown as LobbyPayload).members.filter((m) => m.host);
      expect(hosts).toHaveLength(1);
      expect(hosts[0]!.seat).toBe('s_host');
    } finally {
      lobby.stop();
    }
  });

  test('the roster is capped, and the cap can be raised but never below the room', async () => {
    const relay = makeLocalRelay();
    let roster: LobbyPayload | null = null;
    const lobby = startLobbyHost(relay, {
      code: 'AAA333',
      hostSeat: 's_host',
      hostName: 'Ada',
      seatCap: 2,
      onRoster: (r) => {
        roster = r;
      },
    });
    try {
      await knock(relay, 's_one', 'Bru');
      await knock(relay, 's_two', 'Cyd');
      expect(await waitUntil(() => (roster?.members.length ?? 0) === 2)).toBe(true);

      // Cyd found a full room, so Cyd is not on the roster.
      await new Promise((r) => setTimeout(r, 60));
      expect((roster as unknown as LobbyPayload).members.map((m) => m.seat)).toEqual([
        's_host',
        's_one',
      ]);

      // But the host is told somebody is out there, which is the only reason
      // the seat-count control has anything to prompt it.
      expect((roster as unknown as LobbyPayload).knocking).toBe(1);

      lobby.setSeatCap(4);
      await knock(relay, 's_two', 'Cyd');
      expect(await waitUntil(() => (roster?.members.length ?? 0) === 3)).toBe(true);
      expect((roster as unknown as LobbyPayload).knocking).toBe(0);

      // And it cannot be shrunk out from under the people already seated.
      lobby.setSeatCap(2);
      expect(lobby.roster().seatCap).toBe(3);
    } finally {
      lobby.stop();
    }
  });

  test('Start deals for the people in the room, and seats every one of them on the first publish', async () => {
    const relay = makeLocalRelay();
    let roster: LobbyPayload | null = null;
    const lobby = startLobbyHost(relay, {
      code: 'AAA444',
      hostSeat: 's_host',
      hostName: 'Ada',
      seatCap: 4,
      onRoster: (r) => {
        roster = r;
      },
    });

    await knock(relay, 's_one', 'Bru');
    await knock(relay, 's_two', 'Cyd');
    expect(await waitUntil(() => (roster?.members.length ?? 0) === 3)).toBe(true);

    const handoff = lobby.start();
    expect(handoff.seats).toEqual(['s_host', 's_one', 's_two']);
    expect(handoff.names).toEqual(['Ada', 'Bru', 'Cyd']);

    // Three people were here, so the match is dealt for three -- not for the 4
    // the start screen had been carrying around.
    const state = createMatch(
      CFG(handoff.seats.length),
      handoff.seats.map((_, i) => ({
        id: `p${i + 1}`,
        name: handoff.names[i]!,
        codex: [] as CardDefId[],
      })),
      9001,
      null,
    );
    expect(state.playerOrder).toEqual(['p1', 'p2', 'p3']);

    const host = startHost(relay, state, { seats: handoff.seats, since: handoff.since });
    try {
      expect(await waitUntil(async () => (await gameViews(relay)).length >= 3)).toBe(true);
      const published = (await gameViews(relay)).slice(0, 3);

      // Addressed to the seat tokens the lobby collected, not to bare player
      // ids that a browser would then have to claim with a hello.
      expect(new Set(published.map((m) => m.to))).toEqual(
        new Set(['s_host', 's_one', 's_two']),
      );

      const bySeat = new Map(published.map((m) => [m.to as string, m.payload as GameView]));
      expect(bySeat.get('s_host')!.you.id).toBe('p1');
      expect(bySeat.get('s_one')!.you.id).toBe('p2');
      expect(bySeat.get('s_two')!.you.id).toBe('p3');

      // And the names people typed in the lobby are the names on the table.
      expect(bySeat.get('s_host')!.you.name).toBe('Ada');
      expect(bySeat.get('s_two')!.you.name).toBe('Cyd');
      expect(bySeat.get('s_host')!.others.map((o) => o.name).sort()).toEqual(['Bru', 'Cyd']);
    } finally {
      host.stop();
      lobby.stop();
    }
  });

  test('a client seated by the lobby renders a view without a hello round trip', async () => {
    const relay = makeLocalRelay();
    const lobby = startLobbyHost(relay, {
      code: 'AAA555',
      hostSeat: 's_host',
      hostName: 'Ada',
      seatCap: 4,
    });

    const rosters: LobbyPayload[] = [];
    const views: GameView[] = [];
    const guest = startClient(relay, 's_one', (v) => views.push(v), {
      onLobby: (r) => rosters.push(r),
    });

    try {
      // The guest's own hello is what puts it on the roster, and the roster is
      // what its lobby screen renders.
      expect(
        await waitUntil(() => rosters.some((r) => r.members.some((m) => m.seat === 's_one'))),
        'the guest should see itself in the room',
      ).toBe(true);
      expect(views).toHaveLength(0);

      const handoff = lobby.start();
      expect(handoff.seats).toEqual(['s_host', 's_one']);

      const state = createMatch(
        CFG(2),
        [
          { id: 'p1', name: 'Ada', codex: [] },
          { id: 'p2', name: handoff.names[1]!, codex: [] },
        ],
        9002,
        null,
      );
      const host = startHost(relay, state, { seats: handoff.seats, since: handoff.since });
      try {
        expect(await waitUntil(() => views.length > 0), 'the guest should be dealt in').toBe(
          true,
        );
        expect(views[0]!.you.id).toBe('p2');
        // The roster it last saw says the match started with it in it.
        const last = rosters[rosters.length - 1]!;
        expect(last.started).toBe(true);
        expect(last.seats).toContain('s_one');
      } finally {
        host.stop();
      }
    } finally {
      guest.stop();
      lobby.stop();
    }
  });

  test('someone opening the link after Start is told the match began, not left on a spinner', async () => {
    const relay = makeLocalRelay();
    const lobby = startLobbyHost(relay, {
      code: 'AAA666',
      hostSeat: 's_host',
      hostName: 'Ada',
      seatCap: 2,
    });
    await knock(relay, 's_one', 'Bru');
    expect(await waitUntil(() => lobby.roster().members.length === 2)).toBe(true);

    const handoff = lobby.start();
    const state = createMatch(
      CFG(2),
      [
        { id: 'p1', name: 'Ada', codex: [] },
        { id: 'p2', name: 'Bru', codex: [] },
      ],
      9003,
      null,
    );
    const host = startHost(relay, state, { seats: handoff.seats, since: handoff.since });

    const rosters: LobbyPayload[] = [];
    const views: GameView[] = [];
    const latecomer = startClient(relay, 's_late', (v) => views.push(v), {
      onLobby: (r) => rosters.push(r),
    });

    try {
      expect(await waitUntil(() => rosters.some((r) => r.started))).toBe(true);
      const shut = rosters.filter((r) => r.started).pop()!;
      // The seating plan is on the wire, so the answer is immediate and
      // definite rather than a timeout: this match is not one we are in.
      expect(shut.seats).toEqual(['s_host', 's_one']);
      expect(shut.seats).not.toContain('s_late');

      // And no seat was quietly taken from anyone to make room.
      await new Promise((r) => setTimeout(r, 150));
      expect(views).toHaveLength(0);
      expect(host.getState().playerOrder).toEqual(['p1', 'p2']);
    } finally {
      latecomer.stop();
      host.stop();
      lobby.stop();
    }
  });

  test('a player who refreshes comes back to their own seat', async () => {
    const relay = makeLocalRelay();
    const lobby = startLobbyHost(relay, {
      code: 'AAA777',
      hostSeat: 's_host',
      hostName: 'Ada',
      seatCap: 2,
    });
    await knock(relay, 's_one', 'Bru');
    expect(await waitUntil(() => lobby.roster().members.length === 2)).toBe(true);

    const handoff = lobby.start();
    const state = createMatch(
      CFG(2),
      [
        { id: 'p1', name: 'Ada', codex: [] },
        { id: 'p2', name: 'Bru', codex: [] },
      ],
      9004,
      null,
    );
    const host = startHost(relay, state, { seats: handoff.seats, since: handoff.since });

    // The reload: a brand new client, same seat cookie. The seat is what has
    // to survive -- the name comes back off that device's own settings.
    const views: GameView[] = [];
    const back = startClient(relay, 's_one', (v) => views.push(v));
    try {
      expect(await waitUntil(() => views.length > 0)).toBe(true);
      expect(views[views.length - 1]!.you.id).toBe('p2');
      expect(host.getState().playerOrder).toEqual(['p1', 'p2']);
      // And nobody was bumped to make room for the returning player.
      expect(host.getState().players.p1!.name).toBe('Ada');
    } finally {
      back.stop();
      host.stop();
      lobby.stop();
    }
  });

  test('lobby traffic and match traffic never read as each other', async () => {
    const relay = makeLocalRelay();
    const lobby = startLobbyHost(relay, {
      code: 'AAA888',
      hostSeat: 's_host',
      hostName: 'Ada',
      seatCap: 2,
    });
    await knock(relay, 's_one', 'Bru');
    expect(await waitUntil(() => lobby.roster().members.length === 2)).toBe(true);
    const handoff = lobby.start();

    const state = createMatch(
      CFG(2),
      [
        { id: 'p1', name: 'Ada', codex: [] },
        { id: 'p2', name: 'Bru', codex: [] },
      ],
      9005,
      null,
    );
    const host = startHost(relay, state, { seats: handoff.seats, since: handoff.since });
    try {
      expect(await waitUntil(async () => (await gameViews(relay)).length >= 2)).toBe(true);

      const all = await relay.poll(0);
      // Every message is one kind of thing or the other, never both and never
      // neither -- which is what lets both rosters and views ride `view`.
      const kinds = new Set(all.map((m) => m.kind));
      expect(kinds.has('hello')).toBe(true);
      expect(kinds.has('view')).toBe(true);
      for (const m of all.filter((x) => x.kind === 'view')) {
        const asLobby = isLobbyPayload(m.payload);
        const asGame =
          m.payload !== null &&
          typeof m.payload === 'object' &&
          typeof (m.payload as GameView).turn === 'number';
        expect(asLobby && asGame).toBe(false);
        expect(asLobby || asGame).toBe(true);
        // Rosters are broadcast; views are addressed.
        expect(asLobby ? m.to === undefined : typeof m.to === 'string').toBe(true);
      }
    } finally {
      host.stop();
      lobby.stop();
    }
  });
});
