/**
 * Pure request logic for the relay route, extracted so it is testable with no
 * network and no Redis. `api/room/[code].ts` and the Vite dev middleware are
 * thin wrappers over this, and both use the same store adapters.
 *
 * The relay parses nothing about the game. A message is an opaque JSON blob
 * with an envelope the relay checks only for shape.
 *
 * Runs as plain Node ESM on Vercel: no path aliases, and no runtime imports.
 */

import type { RelayMessage } from '../../src/engine/types';

/** 256KB. A body larger than this is rejected with 413. */
export const MAX_BODY_BYTES = 256 * 1024;

/** Rooms self-destruct six hours after the last message. */
export const ROOM_TTL_SECONDS = 6 * 60 * 60;

/** A stream ends itself after this long, inside the function's 60s budget. */
export const STREAM_MAX_MS = 50_000;
/** A comment line this often keeps proxies and the client's watchdog happy. */
export const STREAM_HEARTBEAT_MS = 15_000;
/** How long the pub/sub subscription may take to confirm. */
export const STREAM_SUBSCRIBE_TIMEOUT_MS = 4_000;

export interface Subscription {
  /** Resolves when the upstream subscription ends on its own. */
  closed: Promise<void>;
}

/**
 * The storage operations the route needs. Redis (over Upstash REST) or memory.
 *
 * `append` is RPUSH + EXPIRE + PUBLISH in one round trip. `subscribe` is the
 * push half: it calls `onNotify` whenever something is appended to `key`.
 */
export interface RoomStore {
  append(key: string, value: string, ttlSeconds: number): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  llen(key: string): Promise<number>;
  subscribe?(key: string, onNotify: () => void, signal: AbortSignal): Promise<Subscription>;
}

export type RoomResult =
  | { status: 200; body: { seq: number } }
  | { status: 200; body: { messages: RelayMessage[] } }
  | { status: 200; body: { messages: RelayMessage[]; next: number } }
  | { status: 400; body: { error: 'bad_request' } }
  | { status: 404; body: { error: 'no_room' } }
  | { status: 413; body: { error: 'too_large' } };

const BAD_REQUEST: RoomResult = { status: 400, body: { error: 'bad_request' } };
const NO_ROOM: RoomResult = { status: 404, body: { error: 'no_room' } };
const TOO_LARGE: RoomResult = { status: 413, body: { error: 'too_large' } };

const CODE_RE = /^[A-Za-z0-9_-]{3,32}$/;

export function isValidRoomCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_RE.test(code);
}

export function roomKey(code: string): string {
  return `jlore:room:${code.toUpperCase()}`;
}

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Envelope shape check. Payload contents are never inspected. */
export function isValidEnvelope(v: unknown): v is Omit<RelayMessage, 'seq'> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const m = v as Record<string, unknown>;
  if (typeof m.from !== 'string' || m.from.length === 0 || m.from.length > 128) return false;
  if (m.to !== undefined && typeof m.to !== 'string') return false;
  if (m.kind !== 'intent' && m.kind !== 'view' && m.kind !== 'hello' && m.kind !== 'snapshot') return false;
  if (!('payload' in m)) return false;
  return true;
}

/** Coerce whatever the runtime handed us into a JSON string plus a parsed value. */
function normalizeBody(body: unknown): { text: string; value: unknown } | null {
  if (typeof body === 'string') {
    const text = body;
    try {
      return { text, value: JSON.parse(text) };
    } catch {
      return { text, value: undefined };
    }
  }
  if (body === undefined || body === null) return null;
  let text: string;
  try {
    text = JSON.stringify(body);
  } catch {
    return null;
  }
  if (typeof text !== 'string') return null;
  return { text, value: body };
}

/** `since` as a list index; 'end' is the list length. Null means malformed. */
export function parseSince(since: unknown): number | 'end' | null {
  if (since === undefined || since === null || since === '') return 0;
  const raw = Array.isArray(since) ? since[0] : since;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return raw < 0 ? 0 : Math.floor(raw);
  }
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t === 'end') return 'end';
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n)) return null;
  return n < 0 ? 0 : n;
}

/** One stored list entry as a message with its seq. Null if unreadable. */
export function toMessage(line: unknown, seq: number): RelayMessage | null {
  let parsed: unknown;
  if (typeof line === 'string') {
    try {
      parsed = JSON.parse(line);
    } catch {
      return null;
    }
  } else {
    parsed = line;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const m = parsed as Record<string, unknown>;
  const msg: RelayMessage = {
    seq,
    from: typeof m.from === 'string' ? m.from : '',
    kind: (m.kind as RelayMessage['kind']) ?? 'intent',
    payload: m.payload,
  };
  if (typeof m.to === 'string') msg.to = m.to;
  return msg;
}

/**
 * B105: POST appends and returns the new list length as `seq`.
 * B106: GET ?since=N returns only messages with index >= N. `since=end`
 *       returns no messages and `next`, the list length, for a reader that
 *       wants to start at the tail (NET-8).
 * B107: malformed body -> 400 bad_request, body over 256KB -> 413 too_large.
 */
export async function handleRoomRequest(
  method: string,
  code: string,
  body: unknown,
  since: unknown,
  store: RoomStore,
): Promise<RoomResult> {
  const verb = typeof method === 'string' ? method.toUpperCase() : '';
  if (!isValidRoomCode(code)) return BAD_REQUEST;
  const key = roomKey(code);

  if (verb === 'POST') {
    const norm = normalizeBody(body);
    if (norm === null) return BAD_REQUEST;
    if (byteLength(norm.text) > MAX_BODY_BYTES) return TOO_LARGE;
    if (!isValidEnvelope(norm.value)) return BAD_REQUEST;

    const env = norm.value as Record<string, unknown>;
    // Seq is assigned by position on read, so strip whatever the client sent.
    const stored: Record<string, unknown> = {
      from: env.from,
      kind: env.kind,
      payload: env.payload,
    };
    if (typeof env.to === 'string') stored.to = env.to;

    const line = JSON.stringify(stored);
    if (byteLength(line) > MAX_BODY_BYTES) return TOO_LARGE;

    const length = await store.append(key, line, ROOM_TTL_SECONDS);
    return { status: 200, body: { seq: length } };
  }

  if (verb === 'GET') {
    const from = parseSince(since);
    if (from === null) return BAD_REQUEST;
    if (from === 'end') {
      const next = await store.llen(key);
      if (next === 0) return NO_ROOM;
      return { status: 200, body: { messages: [], next } };
    }
    // One round trip (NET-5): Redis deletes an empty list, so "nothing from
    // index 0" is exactly "no such room".
    const raw = await store.lrange(key, from, -1);
    if (from === 0 && raw.length === 0) return NO_ROOM;
    const messages: RelayMessage[] = [];
    for (let i = 0; i < raw.length; i++) {
      const msg = toMessage(raw[i], from + i + 1);
      if (msg) messages.push(msg);
    }
    return { status: 200, body: { messages } };
  }

  return BAD_REQUEST;
}

// ---------------------------------------------------------------------------
// The push path
// ---------------------------------------------------------------------------

export interface StreamIO {
  write(chunk: string): void;
  /** Aborts when the client goes away. */
  signal: AbortSignal;
}

export interface StreamTiming {
  maxMs?: number;
  heartbeatMs?: number;
  subscribeTimeoutMs?: number;
}

function sseEvent(msg: RelayMessage): string {
  return `id: ${msg.seq}\ndata: ${JSON.stringify(msg)}\n\n`;
}

/**
 * Server-sent events for one room, from `since` on.
 *
 * Subscribe first, then read the backlog, so nothing appended in between is
 * missed. `: open` is written at once (a buffering platform shows up as its
 * absence); `: ready` only once the subscription has confirmed. Each
 * notification reads the list from the cursor; a notification that
 * arrives mid-read makes the read run once more instead of racing it. Ends with
 * `event: bye` after `maxMs` so it fits the platform's duration cap; the client
 * reopens from its cursor. Any failure writes `event: error` and ends, which
 * the client counts toward falling back to polling.
 */
export async function streamRoom(
  code: string,
  since: number,
  store: RoomStore,
  io: StreamIO,
  timing: StreamTiming = {},
): Promise<void> {
  const key = roomKey(code);
  const maxMs = timing.maxMs ?? STREAM_MAX_MS;
  const heartbeatMs = timing.heartbeatMs ?? STREAM_HEARTBEAT_MS;
  const subscribeTimeoutMs = timing.subscribeTimeoutMs ?? STREAM_SUBSCRIBE_TIMEOUT_MS;

  let cursor = since < 0 ? 0 : since;
  let done = false;
  let failed = false;
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const end = (): void => {
    if (done) return;
    done = true;
    finish();
  };
  const upstream = new AbortController();
  const onAbort = (): void => end();
  if (io.signal.aborted) return;
  io.signal.addEventListener('abort', onAbort);

  const safeWrite = (chunk: string): void => {
    if (done && !chunk.startsWith('event:')) return;
    try {
      io.write(chunk);
    } catch {
      end();
    }
  };
  const fail = (why: string): void => {
    if (done) return;
    failed = true;
    safeWrite(`event: error\ndata: ${JSON.stringify(why.slice(0, 120))}\n\n`);
    end();
  };

  // The first byte, at once: it tells the client the push path is alive, and
  // a platform that buffers responses shows up as its absence.
  safeWrite(`: open\n\n`);

  let busy = false;
  let again = false;
  const pump = async (): Promise<void> => {
    if (done) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        const raw = await store.lrange(key, cursor, -1);
        if (done) return;
        let chunk = '';
        for (let i = 0; i < raw.length; i++) {
          const msg = toMessage(raw[i], cursor + i + 1);
          if (msg) chunk += sseEvent(msg);
        }
        cursor += raw.length;
        if (chunk) safeWrite(chunk);
      } while (again && !done);
    } catch (err) {
      fail(`read_failed: ${String(err)}`);
    } finally {
      busy = false;
    }
  };

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  try {
    if (!store.subscribe) {
      fail('no_push');
    } else {
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        const sub = await Promise.race([
          store.subscribe(key, () => void pump(), upstream.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('subscribe_timeout')), subscribeTimeoutMs);
          }),
        ]);
        void sub.closed.then(() => {
          // The upstream went away; end cleanly and let the client reopen.
          end();
        });
      } catch (err) {
        fail(`subscribe_failed: ${String(err)}`);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (!done) {
      // The subscription is confirmed: this, not `: open`, is what tells the
      // client the push path works. A client that only ever sees `: open`
      // followed by an error keeps counting failures and falls back to polling
      // (NET-R1); resetting on the first byte would retry forever.
      safeWrite(`: ready\n\n`);
      await pump();
      heartbeat = setInterval(() => safeWrite(`: hb\n\n`), heartbeatMs);
      deadline = setTimeout(end, maxMs);
      await finished;
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (deadline) clearTimeout(deadline);
    io.signal.removeEventListener('abort', onAbort);
    upstream.abort();
    if (!failed && !io.signal.aborted) {
      try {
        io.write(`event: bye\ndata: {}\n\n`);
      } catch {
        /* the client is gone */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// In-process store. Tests, `npm run dev`, and a deployment with no credentials.
// ---------------------------------------------------------------------------

export function makeMemoryStore(): RoomStore & { lists: Map<string, string[]> } {
  const lists = new Map<string, string[]>();
  const subs = new Map<string, Set<() => void>>();
  return {
    lists,
    async append(key, value) {
      const list = lists.get(key) ?? [];
      list.push(value);
      lists.set(key, list);
      const listeners = subs.get(key);
      if (listeners) {
        for (const cb of Array.from(listeners)) {
          queueMicrotask(() => {
            try {
              cb();
            } catch {
              /* one dead subscriber must not stop the others */
            }
          });
        }
      }
      return list.length;
    },
    async lrange(key, start, stop) {
      const list = lists.get(key) ?? [];
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      const begin = start < 0 ? Math.max(0, list.length + start) : start;
      return list.slice(begin, Math.max(begin, end));
    },
    async llen(key) {
      return (lists.get(key) ?? []).length;
    },
    async subscribe(key, onNotify, signal) {
      const set = subs.get(key) ?? new Set<() => void>();
      subs.set(key, set);
      set.add(onNotify);
      const closed = new Promise<void>((resolve) => {
        const drop = (): void => {
          set.delete(onNotify);
          if (set.size === 0) subs.delete(key);
          resolve();
        };
        if (signal.aborted) drop();
        else signal.addEventListener('abort', drop, { once: true });
      });
      return { closed };
    },
  };
}

export default handleRoomRequest;
