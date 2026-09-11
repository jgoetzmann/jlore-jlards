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

/**
 * The hot window.
 *
 * At rest the loop polls once a second, which ARCHITECTURE §6 chose on the
 * grounds that nobody notices a second in a turn-based game. They do notice it
 * on their own click: an intent waited up to a full interval for the host to
 * see it and another for the view to come back, so pressing a card cost one to
 * two seconds of nothing before the card moved.
 *
 * So the cadence is now conversational. Acting kicks a poll immediately, and
 * any traffic at all — sent or received — puts the loop into a short fast
 * window, because a table that just did something is about to do something
 * else. It falls back to 1s on its own the moment the exchange stops, so the
 * resting request rate is unchanged and only an active turn costs more.
 */
export const POLL_HOT_INTERVAL_MS = 250;
export const POLL_HOT_WINDOW_MS = 4000;

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
  /**
   * Poll now and go hot. Call it right after posting, so a player's own action
   * is not waiting on the next scheduled tick to come back to them.
   */
  kick(): void;
  cursor(): number;
}

/** Exported for the test: which interval applies in a given condition. */
export function pollIntervalFor(opts: {
  hidden: boolean;
  hotUntilMs: number;
  nowMs: number;
}): number {
  if (opts.hidden) return POLL_HIDDEN_INTERVAL_MS;
  return opts.nowMs < opts.hotUntilMs ? POLL_HOT_INTERVAL_MS : POLL_INTERVAL_MS;
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
  let hotUntil = 0;
  let unsubscribe: (() => void) | null = null;

  function goHot(): void {
    hotUntil = Date.now() + POLL_HOT_WINDOW_MS;
  }

  async function tick(): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const msgs = await relay.poll(cursor);
      if (stopped) return;
      if (msgs.length > 0) {
        cursor += msgs.length;
        lastActivity = Date.now();
        // Traffic begets traffic: an exchange is starting, so stay fast.
        goHot();
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
    const wait = pollIntervalFor({
      hidden: documentHidden(),
      hotUntilMs: hotUntil,
      nowMs: Date.now(),
    });
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
      kick() {
        // A local relay already delivers on post; ticking is only belt and
        // braces for anything posted before this loop subscribed.
        void tick();
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
    kick() {
      if (stopped) return;
      lastActivity = Date.now();
      goHot();
      // Drop the scheduled tick and take one now, so the reply to what we just
      // posted is not sitting behind a timer we are already waiting out.
      if (timer) clearTimeout(timer);
      timer = null;
      void tick().then(schedule);
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
