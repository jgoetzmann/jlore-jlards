/**
 * The transport. Two implementations behind one interface:
 *
 *  - `makeRelay(code, seat)` talks to `/api/room/[code]` over HTTP. It polls at
 *    1s, backs off to 3s while `document.hidden`, and stops after 10 minutes
 *    idle (ARCHITECTURE.md §6).
 *  - `makeLocalRelay()` delivers posted messages to pollers in the same process
 *    with no network at all (B108). Hotseat and tests run on this.
 */

import type { RelayMessage } from '@engine/types';

export interface Relay {
  post(msg: Omit<RelayMessage, 'seq'>): Promise<number>;
  poll(since: number): Promise<RelayMessage[]>;
  stop(): void;
}

/** Poll cadence, all in milliseconds. */
export const POLL_INTERVAL_MS = 1000;
export const POLL_HIDDEN_INTERVAL_MS = 3000;
export const POLL_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const LOCAL_TICK_MS = 30;

/** A local relay additionally lets pollers subscribe instead of ticking. */
export interface LocalRelay extends Relay {
  readonly local: true;
  subscribe(cb: () => void): () => void;
  messages(): RelayMessage[];
}

export function isLocalRelay(relay: Relay): relay is LocalRelay {
  return (relay as Partial<LocalRelay>).local === true;
}

// ---------------------------------------------------------------------------
// Local relay — no network
// ---------------------------------------------------------------------------

export function makeLocalRelay(): Relay {
  const list: RelayMessage[] = [];
  const listeners = new Set<() => void>();
  let stopped = false;

  const relay: LocalRelay = {
    local: true,
    async post(msg) {
      if (stopped) return list.length;
      const stamped: RelayMessage = {
        seq: list.length + 1,
        from: msg.from,
        kind: msg.kind,
        payload: msg.payload,
      };
      if (msg.to !== undefined) stamped.to = msg.to;
      list.push(stamped);
      const seq = list.length;
      for (const cb of Array.from(listeners)) {
        try {
          cb();
        } catch {
          /* a dead listener must not stop delivery to the others */
        }
      }
      return seq;
    },
    async poll(since) {
      if (stopped) return [];
      const from = since < 0 ? 0 : since;
      return list.slice(from).map((m) => ({ ...m }));
    },
    stop() {
      stopped = true;
      listeners.clear();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    messages() {
      return list.map((m) => ({ ...m }));
    },
  };

  return relay;
}

// ---------------------------------------------------------------------------
// HTTP relay
// ---------------------------------------------------------------------------

export function roomUrl(roomCode: string): string {
  return `/api/room/${encodeURIComponent(roomCode)}`;
}

export function makeRelay(roomCode: string, seatId: string): Relay {
  let stopped = false;
  let controller: AbortController | null = null;

  async function request(input: string, init: RequestInit): Promise<unknown> {
    controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const signal = controller ? controller.signal : undefined;
    const res = await fetch(input, { ...init, signal });
    if (!res.ok) {
      let error = `relay_${res.status}`;
      try {
        const parsed = (await res.json()) as { error?: string };
        if (parsed && typeof parsed.error === 'string') error = parsed.error;
      } catch {
        /* body was not JSON; the status code is enough */
      }
      throw new Error(error);
    }
    return await res.json();
  }

  return {
    async post(msg) {
      if (stopped) return 0;
      const body: Record<string, unknown> = {
        from: msg.from || seatId,
        kind: msg.kind,
        payload: msg.payload,
      };
      if (msg.to !== undefined) body.to = msg.to;
      const out = (await request(roomUrl(roomCode), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })) as { seq?: number };
      return typeof out?.seq === 'number' ? out.seq : 0;
    },

    async poll(since) {
      if (stopped) return [];
      const from = since < 0 ? 0 : since;
      const out = (await request(`${roomUrl(roomCode)}?since=${from}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
      })) as { messages?: unknown };
      if (!out || !Array.isArray(out.messages)) return [];
      return (out.messages as RelayMessage[]).filter(
        (m) => m !== null && typeof m === 'object' && typeof m.seq === 'number',
      );
    },

    stop() {
      stopped = true;
      if (controller) {
        try {
          controller.abort();
        } catch {
          /* aborting an already-settled request is fine */
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The poll loop both host and client run
// ---------------------------------------------------------------------------

export interface PollLoop {
  stop(): void;
  /** Reset the idle timer, e.g. after a local action. */
  bump(): void;
  cursor(): number;
}

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Drives `relay.poll` and hands new messages to `onMessages`, advancing an
 * internal cursor. Local relays skip the timer entirely and deliver on post.
 */
export function startPolling(
  relay: Relay,
  since: number,
  onMessages: (msgs: RelayMessage[]) => void,
  onError?: (err: unknown) => void,
): PollLoop {
  let cursor = since < 0 ? 0 : since;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let lastActivity = Date.now();
  let unsubscribe: (() => void) | null = null;

  async function tick(): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const msgs = await relay.poll(cursor);
      if (stopped) return;
      if (msgs.length > 0) {
        cursor += msgs.length;
        lastActivity = Date.now();
        onMessages(msgs);
      }
    } catch (err) {
      if (onError) onError(err);
    } finally {
      inFlight = false;
    }
  }

  function schedule(): void {
    if (stopped) return;
    if (Date.now() - lastActivity > POLL_IDLE_TIMEOUT_MS) {
      stopped = true;
      return;
    }
    const wait = documentHidden() ? POLL_HIDDEN_INTERVAL_MS : POLL_INTERVAL_MS;
    timer = setTimeout(() => {
      void tick().then(schedule);
    }, wait);
  }

  if (isLocalRelay(relay)) {
    unsubscribe = relay.subscribe(() => {
      void tick();
    });
    // A short safety tick catches anything posted before subscribing.
    timer = setInterval(() => {
      void tick();
    }, LOCAL_TICK_MS) as unknown as ReturnType<typeof setTimeout>;
    void tick();
    return {
      stop() {
        stopped = true;
        if (unsubscribe) unsubscribe();
        if (timer) clearInterval(timer as unknown as ReturnType<typeof setInterval>);
        timer = null;
      },
      bump() {
        lastActivity = Date.now();
      },
      cursor() {
        return cursor;
      },
    };
  }

  void tick().then(schedule);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    bump() {
      lastActivity = Date.now();
      if (stopped) return;
    },
    cursor() {
      return cursor;
    },
  };
}

/** Six alphanumeric characters, ambiguous glyphs removed. */
export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lobby wire format
// ---------------------------------------------------------------------------

/**
 * `RelayMessage.kind` is a frozen four-value union in `@engine/types`, so the
 * lobby does not get a kind of its own. It rides the two that already fit:
 *
 *   presence    `hello`  — the message a client already sends to announce
 *                          itself. In a lobby it repeats every few seconds, so
 *                          "who is here" is a fact the host keeps rather than
 *                          guesses.
 *   lobby state `view`   — a broadcast (no `to`), because a lobby has nothing
 *                          hidden in it. `isLobbyPayload` and the game client's
 *                          `isView` are mutually exclusive, so neither reader
 *                          ever mistakes one for the other.
 */
export const LOBBY_TAG = 'jlore-lobby/1';

/** How often a client in a lobby re-announces itself, and how long the host
 *  keeps someone in the roster after their last `hello`. */
export const LOBBY_HEARTBEAT_MS = 4000;
export const LOBBY_PRESENCE_TIMEOUT_MS = 20000;
/** The host re-broadcasts this often even when nothing changed: it heals a
 *  dropped post and keeps every poll loop clear of the 10-minute idle stop. */
export const LOBBY_KEEPALIVE_MS = 15000;

export const MIN_SEAT_CAP = 2;
export const MAX_SEAT_CAP = 4;

export interface LobbyMemberWire {
  /** The seat token from the player's cookie. Opaque to everyone but them. */
  seat: string;
  name: string;
  host: boolean;
}

export interface LobbyPayload {
  tag: typeof LOBBY_TAG;
  code: string;
  members: LobbyMemberWire[];
  seatCap: number;
  /** Set once the host has dealt. `seats` is then the frozen seating order. */
  started: boolean;
  /** Seat tokens in `playerOrder` order, so a latecomer can tell at a glance
   *  whether the match that started is one they are in. */
  seats: string[];
  /** How many people are asking for a seat the room has no room for. The host
   *  can raise the cap; without this the control has nothing to prompt it. */
  knocking: number;
  rev: number;
}

export function isLobbyPayload(payload: unknown): payload is LobbyPayload {
  if (payload === null || typeof payload !== 'object') return false;
  const p = payload as Partial<LobbyPayload>;
  return (
    p.tag === LOBBY_TAG &&
    Array.isArray(p.members) &&
    Array.isArray(p.seats) &&
    typeof p.seatCap === 'number'
  );
}

export function clampSeatCap(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : MAX_SEAT_CAP;
  if (v < MIN_SEAT_CAP) return MIN_SEAT_CAP;
  if (v > MAX_SEAT_CAP) return MAX_SEAT_CAP;
  return v;
}
