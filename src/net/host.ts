/**
 * The host runs the engine. It is the only place a full `GameState` exists.
 *
 * Loop: poll for `intent` messages, run `reduce`, then compute `viewFor` for
 * every seat and post one `view` message each (B109). A `hello` claims a seat,
 * records that seat's codex into match state, and gets a fresh view back
 * (B110). A `snapshot` goes out each turn so another client could take over.
 *
 * `startLobbyHost` is the phase before any of that: a room with people in it
 * and no cards yet. It speaks the same relay with no new message kind — see
 * the lobby wire format in `relay.ts`.
 */

import { reduce, legalActions } from '@engine/index';
import { viewFor } from '@engine/view';
import type {
  CardDefId,
  GameAction,
  GameState,
  GameView,
  PlayerId,
  RelayMessage,
} from '@engine/types';
import {
  clampSeatCap,
  startPolling,
  LOBBY_KEEPALIVE_MS,
  LOBBY_PRESENCE_TIMEOUT_MS,
  LOBBY_TAG,
  type LobbyPayload,
  type PollLoop,
  type Relay,
} from './relay';
import { saveSnapshot } from './storage';

export interface HostHandle {
  stop(): void;
  getState(): GameState;
  submit(action: GameAction): void;
}

export interface HostOptions {
  /**
   * Seat tokens in seating order: `seats[i]` owns `playerOrder[i]`. A lobby
   * hands this over so the match is dealt for the people who are actually
   * here, and every one of them has a view addressed to them on the very first
   * publish -- no hello round trip, no waiting for a seat to be assigned.
   */
  seats?: string[];
  /**
   * Relay cursor to start polling from. The lobby has already consumed its own
   * traffic; replaying it would re-answer every heartbeat with a full view.
   */
  since?: number;
}

export const HOST_FROM = 'host';

interface HelloPayload {
  codex?: CardDefId[];
  name?: string;
  seat?: string;
}

function isHello(payload: unknown): payload is HelloPayload {
  return payload === null || payload === undefined || typeof payload === 'object';
}

function isAction(payload: unknown): payload is GameAction {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    typeof (payload as { type?: unknown }).type === 'string'
  );
}

/** Two actions are the same move if their type and every scalar field match. */
function sameAction(a: GameAction, b: GameAction): boolean {
  if (a.type !== b.type) return false;
  const ao = a as unknown as Record<string, unknown>;
  const bo = b as unknown as Record<string, unknown>;
  for (const key of ['player', 'iid', 'pileId', 'auraId', 'promptId']) {
    if (ao[key] !== bo[key]) return false;
  }
  return true;
}

export function startHost(
  relay: Relay,
  state: GameState,
  options: HostOptions = {},
): HostHandle {
  let current = state;
  let stopped = false;
  let lastSnapshotTurn = -1;
  let lastPublishedSignature = '';

  /** seatId -> PlayerId. The only thing the host knows about who is who. */
  const seats = new Map<string, PlayerId>();
  const claimed = new Set<PlayerId>();

  // A seating plan from the lobby, applied before a single message is read.
  if (options.seats) {
    options.seats.forEach((seatId, i) => {
      const pid = current.playerOrder[i];
      if (typeof seatId !== 'string' || seatId.length === 0 || !pid) return;
      if (seats.has(seatId)) return;
      seats.set(seatId, pid);
      claimed.add(pid);
    });
  }

  function nextFreeSeat(): PlayerId | null {
    for (const pid of current.playerOrder) {
      if (!claimed.has(pid)) return pid;
    }
    return null;
  }

  function assignSeat(seatId: string): PlayerId | null {
    const existing = seats.get(seatId);
    if (existing) return existing;
    // A seat id that is already a player id in this match claims itself, so a
    // hotseat client (and the tests) address seats by the name the match uses.
    const pid =
      current.playerOrder.includes(seatId) && !claimed.has(seatId)
        ? (seatId as PlayerId)
        : nextFreeSeat();
    if (!pid) return null;
    seats.set(seatId, pid);
    claimed.add(pid);
    return pid;
  }

  /**
   * Where a seat's view is posted. A player that no client has claimed yet is
   * addressed by its own player id, so the opening position is on the wire
   * before anybody says hello (B109).
   */
  function addressOf(pid: PlayerId): string {
    for (const [seatId, seated] of seats) {
      if (seated === pid) return seatId;
    }
    return pid;
  }

  function recordCodex(pid: PlayerId, codex: CardDefId[] | undefined): void {
    if (!Array.isArray(codex) || codex.length === 0) return;
    const player = current.players[pid];
    if (!player) return;
    const merged = player.codex.slice();
    const seen = new Set(merged);
    let changed = false;
    for (const id of codex) {
      if (typeof id !== 'string' || seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
      changed = true;
    }
    if (!changed) return;
    current = {
      ...current,
      players: { ...current.players, [pid]: { ...player, codex: merged } },
    };
  }

  function recordName(pid: PlayerId, name: string | undefined): void {
    if (typeof name !== 'string' || name.length === 0) return;
    const player = current.players[pid];
    if (!player || player.name === name) return;
    // A refresh re-sends this browser's own settings, which is how two people
    // who both left the default alone arrive as the same name. Seating already
    // resolved that once; do not let a reload undo it and put two identically
    // named players at the same table.
    for (const other of current.playerOrder) {
      if (other !== pid && current.players[other]?.name === name) return;
    }
    current = {
      ...current,
      players: { ...current.players, [pid]: { ...player, name } },
    };
  }

  function publishTo(seatId: string, pid: PlayerId): void {
    const view: GameView = viewFor(current, pid);
    void relay
      .post({ from: HOST_FROM, to: seatId, kind: 'view', payload: view })
      .catch(() => undefined);
  }

  /**
   * One filtered view per seat in the match, after every state change (B109).
   * The roster is `playerOrder`, never the set of clients that have said hello
   * -- a seat nobody has claimed still gets its view, addressed to its player
   * id, and no seat outside the match is ever addressed.
   */
  function publishAll(): void {
    if (stopped) return;
    for (const pid of current.playerOrder) publishTo(addressOf(pid), pid);
    lastPublishedSignature = signature();
    maybeSnapshot();
  }

  function signature(): string {
    return `${current.turn}:${current.logSeq}:${current.activePlayer}:${
      current.pending ? current.pending.id : '-'
    }:${current.ended ? 1 : 0}`;
  }

  /** §8: a snapshot each turn, so another client could take over. */
  function maybeSnapshot(): void {
    if (current.turn === lastSnapshotTurn) return;
    lastSnapshotTurn = current.turn;
    void relay
      .post({ from: HOST_FROM, kind: 'snapshot', payload: current })
      .catch(() => undefined);
    try {
      saveSnapshot(String(current.seed), loopRef ? loopRef.cursor() : 0, current);
    } catch {
      /* storage is a convenience for the host only */
    }
  }

  function applyAction(action: GameAction, actor: PlayerId | null): boolean {
    if (current.ended) return false;
    const bound: GameAction = actor
      ? ({ ...(action as unknown as Record<string, unknown>), player: actor } as GameAction)
      : action;

    // B25: legalActions never offers something reduce would reject, so an
    // intent that is not in the list is a stale click. Skip it rather than
    // republishing an identical view to every seat.
    if (actor && bound.type !== 'resolve') {
      const legal = legalActions(current, actor);
      if (legal.length > 0 && !legal.some((a) => sameAction(a, bound))) return false;
    }

    const next = reduce(current, bound);
    if (next === current) return false;
    current = next;
    return true;
  }

  function handle(msgs: RelayMessage[]): void {
    if (stopped) return;
    let dirty = false;

    for (const msg of msgs) {
      if (!msg || msg.from === HOST_FROM) continue;

      if (msg.kind === 'hello') {
        const pid = assignSeat(msg.from);
        if (!pid) continue;
        if (isHello(msg.payload) && msg.payload) {
          recordCodex(pid, msg.payload.codex);
          recordName(pid, msg.payload.name);
        }
        // B110: a fresh view addressed to the seat that said hello.
        publishTo(msg.from, pid);
        dirty = true;
        continue;
      }

      if (msg.kind === 'intent') {
        const pid = seats.get(msg.from) ?? assignSeat(msg.from);
        if (!pid) continue;
        if (!isAction(msg.payload)) continue;
        if (applyAction(msg.payload, pid)) dirty = true;
      }
    }

    if (dirty || signature() !== lastPublishedSignature) publishAll();
  }

  let loopRef: PollLoop | null = null;
  loopRef = startPolling(relay, options.since ?? 0, handle);
  const loop: PollLoop = loopRef;

  // Announce the opening position to whoever is already listening.
  publishAll();

  return {
    stop() {
      stopped = true;
      loop.stop();
    },
    getState() {
      return current;
    },
    submit(action: GameAction) {
      if (stopped) return;
      const actor =
        (action as { player?: PlayerId }).player ?? current.activePlayer ?? null;
      if (applyAction(action, actor)) {
        loop.bump();
        publishAll();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The lobby host — a room before it is a match
// ---------------------------------------------------------------------------

export interface LobbyHostOptions {
  code: string;
  /** The host's own seat token. It is member one, and it is never pruned. */
  hostSeat: string;
  hostName: string;
  seatCap?: number;
  /** Called with every roster the host publishes, including the first. */
  onRoster?: (roster: LobbyPayload) => void;
  /** Injectable clock, for tests. */
  now?: () => number;
}

/** What the lobby hands the match when the host presses Start. */
export interface LobbyHandoff {
  /** Seat tokens in seating order. Length is the real player count. */
  seats: string[];
  /** Their names, same order. */
  names: string[];
  /** Relay cursor the match's host should start polling from. */
  since: number;
}

export interface LobbyHostHandle {
  stop(): void;
  setSeatCap(cap: number): void;
  roster(): LobbyPayload;
  /**
   * Freeze the roster, tell the room, and stop listening. Everything the match
   * needs to seat exactly these people comes back.
   */
  start(): LobbyHandoff;
}

interface LobbyMemberRecord {
  seat: string;
  name: string;
  host: boolean;
  seen: number;
}

function helloName(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return '';
  const name = (payload as HelloPayload).name;
  if (typeof name !== 'string') return '';
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 24) : '';
}

/**
 * Holds a room open while people arrive.
 *
 * Presence is a fact rather than an inference: a client in a lobby re-sends
 * `hello` every few seconds, so arriving shows up on the next poll (~2s end to
 * end) and a closed tab drops off after `LOBBY_PRESENCE_TIMEOUT_MS`. The host
 * broadcasts the roster on every change, plus a keepalive, and nothing here
 * touches the engine -- no match exists yet.
 */
export function startLobbyHost(relay: Relay, options: LobbyHostOptions): LobbyHostHandle {
  const now = options.now ?? (() => Date.now());
  const hostName = options.hostName.trim().slice(0, 24) || 'Host';

  let stopped = false;
  let started = false;
  let rev = 0;
  let seatCap = clampSeatCap(options.seatCap);
  let frozenSeats: string[] = [];

  const members: LobbyMemberRecord[] = [
    { seat: options.hostSeat, name: hostName, host: true, seen: now() },
  ];

  /** Seats the room had no room for, and when each last asked. */
  const turnedAway = new Map<string, number>();

  function roster(): LobbyPayload {
    return {
      tag: LOBBY_TAG,
      code: options.code,
      members: members.map((m) => ({ seat: m.seat, name: m.name, host: m.host })),
      seatCap,
      started,
      seats: frozenSeats.slice(),
      knocking: turnedAway.size,
      rev,
    };
  }

  function publish(): LobbyPayload {
    rev += 1;
    const payload = roster();
    if (!stopped) {
      void relay
        .post({ from: HOST_FROM, kind: 'view', payload })
        .catch(() => undefined);
    }
    if (options.onRoster) options.onRoster(payload);
    return payload;
  }

  /** Drop anyone whose heartbeat has stopped. The host keeps its own seat. */
  function sweep(): void {
    if (stopped || started) return;
    const cutoff = now() - LOBBY_PRESENCE_TIMEOUT_MS;
    let changed = false;
    for (let i = members.length - 1; i >= 1; i--) {
      if (members[i]!.seen < cutoff) {
        members.splice(i, 1);
        changed = true;
      }
    }
    for (const [seat, seen] of turnedAway) {
      if (seen < cutoff) {
        turnedAway.delete(seat);
        changed = true;
      }
    }
    if (changed) publish();
  }

  function handle(msgs: RelayMessage[]): void {
    if (stopped || started) return;
    let changed = false;

    for (const msg of msgs) {
      if (!msg || msg.kind !== 'hello') continue;
      const seat = msg.from;
      if (typeof seat !== 'string' || seat.length === 0 || seat === HOST_FROM) continue;

      const name = helloName(msg.payload);
      const existing = members.find((m) => m.seat === seat);
      if (existing) {
        existing.seen = now();
        if (name && existing.name !== name) {
          existing.name = name;
          changed = true;
        }
        continue;
      }
      // Beyond the cap they do not enter the roster, but they are still there:
      // they keep knocking, the host is told so, and raising the cap lets them
      // in on their next heartbeat without anybody reloading anything.
      if (members.length >= seatCap) {
        if (!turnedAway.has(seat)) changed = true;
        turnedAway.set(seat, now());
        continue;
      }
      turnedAway.delete(seat);
      members.push({ seat, name: name || 'Navigator', host: false, seen: now() });
      changed = true;
    }

    if (changed) publish();
  }

  const loop: PollLoop = startPolling(relay, 0, handle);

  const sweepTimer = setInterval(sweep, 2000) as unknown as ReturnType<typeof setTimeout>;
  const keepaliveTimer = setInterval(() => {
    if (stopped || started) return;
    publish();
  }, LOBBY_KEEPALIVE_MS) as unknown as ReturnType<typeof setTimeout>;

  function clearTimers(): void {
    clearInterval(sweepTimer as unknown as ReturnType<typeof setInterval>);
    clearInterval(keepaliveTimer as unknown as ReturnType<typeof setInterval>);
  }

  publish();

  return {
    stop() {
      stopped = true;
      clearTimers();
      loop.stop();
    },

    setSeatCap(cap: number) {
      if (stopped || started) return;
      const next = clampSeatCap(cap);
      const floor = members.length;
      const applied = next < floor ? clampSeatCap(floor) : next;
      if (applied === seatCap) return;
      seatCap = applied;
      publish();
    },

    roster,

    start(): LobbyHandoff {
      const seated = members.slice(0, seatCap);
      started = true;
      frozenSeats = seated.map((m) => m.seat);
      const names = seated.map((m) => m.name);
      // The last thing the room hears from the lobby. A browser that opens the
      // link from here on reads this and knows the match is already dealt, and
      // whether it was dealt with them in it.
      publish();
      const since = loop.cursor();
      clearTimers();
      loop.stop();
      stopped = true;
      return { seats: frozenSeats.slice(), names, since };
    },
  };
}
