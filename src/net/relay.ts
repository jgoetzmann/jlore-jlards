/**
 * The transport. Two implementations behind one interface:
 *
 *  - `makeRelay(code, seat)` talks to `/api/room/[code]`. It pushes: a
 *    server-sent event stream (`?stream=1`) delivers each list entry as it is
 *    appended. If the stream cannot be opened, or keeps failing, the same loop
 *    polls instead: 1s at rest, 250ms for a few seconds after any traffic.
 *  - `makeLocalRelay()` delivers posted messages to readers in the same process
 *    with no network at all (B108). Hotseat and tests run on this.
 *
 * `startPolling` drives either and hands new messages to a callback. The name
 * predates the push path; it is the one loop everything reads the room with.
 */

import type { RelayMessage } from '@engine/types';

export interface StreamHandlers {
  /** New entries, in order. */
  onMessages(msgs: RelayMessage[]): void;
  /**
   * The first byte arrived. That proves only that the response is not
   * buffered, not that the push path works: the server writes it before it
   * subscribes upstream.
   */
  onOpen(): void;
  /**
   * Proof the push path works: the server confirmed its subscription
   * (`: ready`), sent a heartbeat (it only does so once subscribed), or
   * delivered an entry.
   */
  onLive?(): void;
  /** The server closed the stream on purpose (its time budget). */
  onEnd(): void;
  /** The stream failed or went silent. */
  onError(err: unknown): void;
}

export interface Relay {
  post(msg: Omit<RelayMessage, 'seq'>): Promise<number>;
  poll(since: number): Promise<RelayMessage[]>;
  stop(): void;
  /** Push transport, when the relay has one. Returns a function that closes it. */
  stream?(since: number, handlers: StreamHandlers): () => void;
  /** Current list length, so a reader that wants no history can start there. */
  tail?(): Promise<number>;
}

/** Poll cadence, all in milliseconds. */
export const POLL_INTERVAL_MS = 1000;
export const POLL_HIDDEN_INTERVAL_MS = 3000;
/** Fast cadence right after traffic: a table that just acted is about to again. */
export const POLL_HOT_INTERVAL_MS = 250;
export const POLL_HOT_WINDOW_MS = 5000;
/** A loop with nothing happening goes idle. Anything local wakes it. */
export const POLL_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** A live match only idles when its tab has also been hidden this long. */
export const LIVE_HIDDEN_IDLE_MS = 30 * 60 * 1000;
export const LOCAL_TICK_MS = 500;

/** Request budgets. A hung request must not freeze the loop behind it. */
export const GET_TIMEOUT_MS = 4000;
export const POST_TIMEOUT_MS = 8000;
/** The push path must show a first byte this fast, or we poll instead. */
export const STREAM_OPEN_TIMEOUT_MS = 4000;
/** The server sends a heartbeat every ~15s; this much silence is a dead stream. */
export const STREAM_SILENCE_MS = 25000;
/** Consecutive stream failures before falling back to polling for a while. */
export const STREAM_MAX_FAILURES = 3;
export const STREAM_RETRY_AFTER_MS = 60000;
/**
 * A stream clears the failure count only once it has proved the push path
 * (confirmed subscription, heartbeat or entry) AND either lived this long or
 * delivered an entry. A stream that opens and dies at once — an upstream
 * SUBSCRIBE that is refused, or that closes right after confirming — never
 * clears it, so three of those in a row fall back to polling (NET-R1).
 */
export const STREAM_HEALTHY_MS = 5000;
/** Never reopen a stream sooner than this after the previous one opened. */
export const STREAM_MIN_REOPEN_MS = 1000;

/** A local relay additionally lets readers subscribe instead of ticking. */
export interface LocalRelay extends Relay {
  readonly local: true;
  subscribe(cb: () => void): () => void;
  messages(): RelayMessage[];
  /**
   * Synchronous `poll`. A lockstep session reads with this inside the
   * subscription callback, so a hotseat press is confirmed in the same task
   * that made it instead of a microtask (or a safety tick) later.
   */
  read(since: number): RelayMessage[];
}

export function isLocalRelay(relay: Relay): relay is LocalRelay {
  return (relay as Partial<LocalRelay>).local === true;
}

// ---------------------------------------------------------------------------
// Local relay — no network
// ---------------------------------------------------------------------------

export function makeLocalRelay(): LocalRelay {
  const list: RelayMessage[] = [];
  const listeners = new Set<() => void>();
  let stopped = false;

  function read(since: number): RelayMessage[] {
    if (stopped) return [];
    const from = since < 0 ? 0 : since;
    return list.slice(from).map((m) => ({ ...m }));
  }

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
      return read(since);
    },
    read,
    async tail() {
      return list.length;
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

export function roomUrl(roomCode: string, base = ''): string {
  return `${base}/api/room/${encodeURIComponent(roomCode)}`;
}

export interface HttpRelayOptions {
  /** Origin to prefix, for callers outside a browser page (tests, tools). */
  base?: string;
  /** Turn the push path off, e.g. to test the fallback. */
  stream?: boolean;
}

class TimeoutError extends Error {
  constructor(what: string) {
    super(`${what}_timeout`);
    this.name = 'TimeoutError';
  }
}

export function isTimeout(err: unknown): boolean {
  return err instanceof TimeoutError;
}

function isMessage(m: unknown): m is RelayMessage {
  return m !== null && typeof m === 'object' && typeof (m as RelayMessage).seq === 'number';
}

export function makeRelay(roomCode: string, seatId: string, options: HttpRelayOptions = {}): Relay {
  let stopped = false;
  const live = new Set<AbortController>();
  const base = options.base ?? '';

  async function request(input: string, init: RequestInit, timeoutMs: number, what: string): Promise<unknown> {
    const controller = new AbortController();
    live.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      let res: Response;
      try {
        res = await fetch(input, { ...init, signal: controller.signal });
      } catch (err) {
        if (timedOut) throw new TimeoutError(what);
        throw err;
      }
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
      try {
        return await res.json();
      } catch (err) {
        if (timedOut) throw new TimeoutError(what);
        throw err;
      }
    } finally {
      clearTimeout(timer);
      live.delete(controller);
    }
  }

  function stream(since: number, h: StreamHandlers): () => void {
    const controller = new AbortController();
    live.add(controller);
    let closed = false;
    let opened = false;
    let proven = false;
    let bye = false;
    let errored: string | null = null;
    let silence: ReturnType<typeof setTimeout> | null = null;
    const markLive = (): void => {
      if (proven) return;
      proven = true;
      if (h.onLive) h.onLive();
    };

    const fail = (err: unknown): void => {
      if (closed) return;
      close();
      h.onError(err);
    };
    const arm = (ms: number, why: string): void => {
      if (silence) clearTimeout(silence);
      silence = setTimeout(() => fail(new Error(why)), ms);
    };
    function close(): void {
      if (closed) return;
      closed = true;
      if (silence) clearTimeout(silence);
      silence = null;
      live.delete(controller);
      try {
        controller.abort();
      } catch {
        /* already settled */
      }
    }

    arm(STREAM_OPEN_TIMEOUT_MS, 'stream_open_timeout');

    void (async () => {
      let res: Response;
      try {
        res = await fetch(`${roomUrl(roomCode, base)}?stream=1&since=${since}`, {
          method: 'GET',
          headers: { accept: 'text/event-stream' },
          signal: controller.signal,
        });
      } catch (err) {
        fail(err);
        return;
      }
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !res.body || !type.includes('text/event-stream')) {
        fail(new Error(`stream_${res.status}`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (closed) return;
          if (done) break;
          if (!opened) {
            opened = true;
            h.onOpen();
          }
          arm(STREAM_SILENCE_MS, 'stream_silent');
          buf += decoder.decode(value, { stream: true });
          const batch: RelayMessage[] = [];
          let cut = buf.indexOf('\n\n');
          while (cut >= 0) {
            const block = buf.slice(0, cut);
            buf = buf.slice(cut + 2);
            cut = buf.indexOf('\n\n');
            let event = 'message';
            let data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) {
                const note = line.slice(1).trim();
                if (note === 'ready' || note === 'hb') markLive();
                continue;
              }
              const colon = line.indexOf(':');
              const field = colon < 0 ? line : line.slice(0, colon);
              const val = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
              if (field === 'event') event = val;
              else if (field === 'data') data += data ? `\n${val}` : val;
            }
            if (event === 'bye') {
              bye = true;
            } else if (event === 'message' && data) {
              try {
                const m = JSON.parse(data) as unknown;
                if (isMessage(m)) batch.push(m);
              } catch {
                /* a torn event is skipped; the next backlog read covers it */
              }
            } else if (event === 'error') {
              // Always a failure, whatever else the stream said (NET-R1).
              errored = data || 'error';
            }
          }
          if (batch.length > 0) {
            markLive();
            h.onMessages(batch);
          }
        }
      } catch (err) {
        fail(err);
        return;
      }
      if (closed) return;
      close();
      if (errored !== null) h.onError(new Error(`stream_error: ${errored}`));
      else if (bye) h.onEnd();
      else h.onError(new Error('stream_ended'));
    })();

    return close;
  }

  const relay: Relay = {
    async post(msg) {
      if (stopped) return 0;
      const body: Record<string, unknown> = {
        from: msg.from || seatId,
        kind: msg.kind,
        payload: msg.payload,
      };
      if (msg.to !== undefined) body.to = msg.to;
      const out = (await request(
        roomUrl(roomCode, base),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        POST_TIMEOUT_MS,
        'post',
      )) as { seq?: number };
      return typeof out?.seq === 'number' ? out.seq : 0;
    },

    async poll(since) {
      if (stopped) return [];
      const from = since < 0 ? 0 : since;
      const out = (await request(
        `${roomUrl(roomCode, base)}?since=${from}`,
        { method: 'GET', headers: { accept: 'application/json' } },
        GET_TIMEOUT_MS,
        'poll',
      )) as { messages?: unknown };
      if (!out || !Array.isArray(out.messages)) return [];
      return (out.messages as unknown[]).filter(isMessage);
    },

    async tail() {
      const out = (await request(
        `${roomUrl(roomCode, base)}?since=end`,
        { method: 'GET', headers: { accept: 'application/json' } },
        GET_TIMEOUT_MS,
        'tail',
      )) as { next?: number };
      return typeof out?.next === 'number' ? out.next : 0;
    },

    stop() {
      stopped = true;
      for (const c of Array.from(live)) {
        try {
          c.abort();
        } catch {
          /* aborting an already-settled request is fine */
        }
      }
      live.clear();
    },
  };
  if (options.stream !== false && typeof ReadableStream !== 'undefined') relay.stream = stream;
  return relay;
}

// ---------------------------------------------------------------------------
// The loop everything reads the room with
// ---------------------------------------------------------------------------

export interface PollLoop {
  stop(): void;
  /** Reset the idle timer, e.g. after a local action. Wakes an idle loop. */
  bump(): void;
  /** Read now and go hot. Call it right after posting. */
  kick(): void;
  cursor(): number;
  /** 'stream' while pushed to, 'poll' while polling, 'idle' when parked. */
  mode(): 'stream' | 'poll' | 'idle' | 'local';
}

export interface PollOptions {
  /**
   * True while a match is being played. A live loop never backs off for a
   * hidden tab and never parks while the tab is visible: nothing posts during
   * a long think, and a parked loop is a table that stopped responding.
   */
  live?: () => boolean;
  /** Use the push path when the relay has one. Default true. */
  stream?: boolean;
  /** Tests with short-lived streams shorten these. */
  streamHealthyMs?: number;
  streamMinReopenMs?: number;
}

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** Which interval applies. Exported for the test. */
export function pollIntervalFor(opts: {
  hidden: boolean;
  live: boolean;
  hotUntilMs: number;
  nowMs: number;
}): number {
  if (opts.nowMs < opts.hotUntilMs) return POLL_HOT_INTERVAL_MS;
  if (opts.hidden && !opts.live) return POLL_HIDDEN_INTERVAL_MS;
  return POLL_INTERVAL_MS;
}

/** Whether a loop that has been quiet this long should park. Exported for the test. */
export function shouldIdle(opts: {
  live: boolean;
  hidden: boolean;
  quietMs: number;
  hiddenForMs: number;
}): boolean {
  if (opts.live) return opts.hidden && opts.hiddenForMs > LIVE_HIDDEN_IDLE_MS && opts.quietMs > LIVE_HIDDEN_IDLE_MS;
  return opts.quietMs > POLL_IDLE_TIMEOUT_MS;
}

/**
 * Drives the relay and hands new messages to `onMessages`, advancing a cursor
 * by the seq of the last message seen.
 *
 * One chain, always: a kick while a read is in flight sets `again` and the
 * finishing read runs once more, instead of starting a second chain beside it
 * (NET-10). An idle loop is parked, never dead: `kick`, `bump` and the tab
 * becoming visible all wake it (NET-3).
 */
export function startPolling(
  relay: Relay,
  since: number,
  onMessages: (msgs: RelayMessage[]) => void,
  onError?: (err: unknown) => void,
  options: PollOptions = {},
): PollLoop {
  let cursor = since < 0 ? 0 : since;
  let stopped = false;
  const isLive = (): boolean => (options.live ? options.live() : false);

  function deliver(msgs: RelayMessage[]): boolean {
    const fresh = msgs.filter((m) => m && typeof m.seq === 'number' && m.seq > cursor);
    if (fresh.length === 0) return false;
    cursor = fresh[fresh.length - 1]!.seq;
    onMessages(fresh);
    return true;
  }

  // ---- local: delivered on post ----
  if (isLocalRelay(relay)) {
    let inFlight = false;
    let again = false;
    const tick = async (): Promise<void> => {
      if (stopped) return;
      if (inFlight) {
        // The post that woke us landed after our read started. Read again
        // rather than wait for the safety tick (HS-3).
        again = true;
        return;
      }
      inFlight = true;
      try {
        do {
          again = false;
          const msgs = await relay.poll(cursor);
          if (stopped) return;
          deliver(msgs);
        } while (again && !stopped);
      } catch (err) {
        if (onError) onError(err);
      } finally {
        inFlight = false;
      }
    };
    const unsubscribe = relay.subscribe(() => {
      void tick();
    });
    const timer = setInterval(() => {
      void tick();
    }, LOCAL_TICK_MS);
    void tick();
    return {
      stop() {
        stopped = true;
        unsubscribe();
        clearInterval(timer);
      },
      bump() {},
      kick() {
        void tick();
      },
      cursor() {
        return cursor;
      },
      mode() {
        return 'local';
      },
    };
  }

  // ---- remote ----
  let mode: 'stream' | 'poll' = relay.stream && options.stream !== false ? 'stream' : 'poll';
  let idle = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let again = false;
  let lastActivity = Date.now();
  let hotUntil = 0;
  let hiddenSince = documentHidden() ? Date.now() : 0;
  let closeStream: (() => void) | null = null;
  let streamFailures = 0;
  let streamRetryAt = 0;
  let reopenTimer: ReturnType<typeof setTimeout> | null = null;
  const healthyMs = options.streamHealthyMs ?? STREAM_HEALTHY_MS;
  const minReopenMs = options.streamMinReopenMs ?? STREAM_MIN_REOPEN_MS;
  /** The current stream: when it was opened, and what it has proved. */
  let streamOpenedAt = 0;
  let streamLive = false;
  let streamDelivered = false;

  const goHot = (): void => {
    hotUntil = Date.now() + POLL_HOT_WINDOW_MS;
  };

  function clearTimer(): void {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function checkIdle(): boolean {
    const now = Date.now();
    const hidden = documentHidden();
    if (
      shouldIdle({
        live: isLive(),
        hidden,
        quietMs: now - lastActivity,
        hiddenForMs: hidden && hiddenSince ? now - hiddenSince : 0,
      })
    ) {
      park();
      return true;
    }
    return false;
  }

  function park(): void {
    idle = true;
    clearTimer();
    if (reopenTimer) clearTimeout(reopenTimer);
    reopenTimer = null;
    if (closeStream) closeStream();
    closeStream = null;
  }

  function wake(): void {
    if (stopped || !idle) return;
    idle = false;
    lastActivity = Date.now();
    if (mode === 'stream') openStream();
    else run();
  }

  // -- push --
  /** Did the stream that just ended prove the push path works? */
  function streamWasHealthy(): boolean {
    if (!streamLive) return false;
    return streamDelivered || Date.now() - streamOpenedAt >= healthyMs;
  }

  function reopenAfter(ms: number): void {
    if (reopenTimer) clearTimeout(reopenTimer);
    // Never faster than one open per `minReopenMs`, whatever the reason.
    const wait = Math.max(ms, streamOpenedAt + minReopenMs - Date.now(), 0);
    reopenTimer = setTimeout(() => {
      reopenTimer = null;
      if (mode === 'stream') openStream();
    }, wait);
  }

  function streamFailed(err: unknown): void {
    if (onError) onError(err);
    if (streamWasHealthy()) streamFailures = 0;
    streamFailures += 1;
    if (streamFailures >= STREAM_MAX_FAILURES) {
      // The push path is not working here. Poll, and try it again later.
      mode = 'poll';
      streamRetryAt = Date.now() + STREAM_RETRY_AFTER_MS;
      run();
      return;
    }
    // Catch up with one read while the stream comes back.
    run();
    reopenAfter(250 * streamFailures);
  }

  function openStream(): void {
    if (stopped || idle || !relay.stream) return;
    if (closeStream) closeStream();
    streamOpenedAt = Date.now();
    streamLive = false;
    streamDelivered = false;
    closeStream = relay.stream(cursor, {
      onMessages(msgs) {
        if (stopped) return;
        if (deliver(msgs)) {
          streamDelivered = true;
          lastActivity = Date.now();
          goHot();
        }
      },
      onOpen() {
        /* only the first byte: not proof of anything (NET-R1) */
      },
      onLive() {
        streamLive = true;
      },
      onEnd() {
        closeStream = null;
        if (stopped || idle) return;
        if (!streamWasHealthy()) {
          // Ended "cleanly" before it proved anything: the upstream
          // subscription closed as soon as it opened. That is a failure.
          streamFailed(new Error('stream_ended_early'));
          return;
        }
        streamFailures = 0;
        if (checkIdle()) return;
        reopenAfter(0);
      },
      onError(err) {
        closeStream = null;
        if (stopped || idle) return;
        streamFailed(err);
      },
    });
  }

  // -- poll --
  function run(): void {
    if (stopped || idle) return;
    if (inFlight) {
      again = true;
      return;
    }
    clearTimer();
    inFlight = true;
    let rerun = false;
    relay
      .poll(cursor)
      .then(
        (msgs) => {
          if (stopped) return;
          if (deliver(msgs)) {
            lastActivity = Date.now();
            goHot();
          }
        },
        (err) => {
          if (onError) onError(err);
          // A timed-out read is re-armed at once, not after another interval.
          if (isTimeout(err)) rerun = true;
        },
      )
      .finally(() => {
        inFlight = false;
        if (stopped) return;
        if (again || rerun) {
          again = false;
          run();
          return;
        }
        schedule();
      });
  }

  function schedule(): void {
    clearTimer();
    if (stopped || idle) return;
    if (mode === 'stream') return;
    if (checkIdle()) return;
    if (relay.stream && options.stream !== false && Date.now() >= streamRetryAt && streamRetryAt > 0) {
      streamRetryAt = 0;
      streamFailures = 0;
      mode = 'stream';
      openStream();
      return;
    }
    const wait = pollIntervalFor({
      hidden: documentHidden(),
      live: isLive(),
      hotUntilMs: hotUntil,
      nowMs: Date.now(),
    });
    timer = setTimeout(run, wait);
  }

  const onVisibility = (): void => {
    if (documentHidden()) {
      if (!hiddenSince) hiddenSince = Date.now();
      return;
    }
    hiddenSince = 0;
    if (idle) wake();
    else if (mode === 'poll') kick();
  };
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  function kick(): void {
    if (stopped) return;
    lastActivity = Date.now();
    goHot();
    if (idle) {
      wake();
      return;
    }
    if (mode === 'poll') run();
  }

  if (mode === 'stream') openStream();
  else run();

  return {
    stop() {
      stopped = true;
      clearTimer();
      if (reopenTimer) clearTimeout(reopenTimer);
      reopenTimer = null;
      if (closeStream) closeStream();
      closeStream = null;
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    },
    bump() {
      lastActivity = Date.now();
      if (idle) wake();
    },
    kick,
    cursor() {
      return cursor;
    },
    mode() {
      return idle ? 'idle' : mode;
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
