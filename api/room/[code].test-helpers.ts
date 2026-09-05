/**
 * Pure request logic for the relay route, extracted so it is testable with no
 * network and no Redis. `api/room/[code].ts` is a thin wrapper over this.
 *
 * The relay parses nothing about the game. A message is an opaque JSON blob
 * with an envelope the relay checks only for shape.
 */

import type { RelayMessage } from '../../src/engine/types';

/** 256KB. A body larger than this is rejected with 413. */
export const MAX_BODY_BYTES = 256 * 1024;

/** Rooms self-destruct six hours after the last message. */
export const ROOM_TTL_SECONDS = 6 * 60 * 60;

/** The four storage operations the route needs. Redis or memory. */
export interface RoomStore {
  rpush(key: string, value: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  expire(key: string, seconds: number): Promise<unknown>;
  exists(key: string): Promise<number>;
}

export type RoomResult =
  | { status: 200; body: { seq: number } }
  | { status: 200; body: { messages: RelayMessage[] } }
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

function parseSince(since: unknown): number | null {
  if (since === undefined || since === null || since === '') return 0;
  const raw = Array.isArray(since) ? since[0] : since;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return raw < 0 ? 0 : Math.floor(raw);
  }
  if (typeof raw !== 'string') return null;
  if (!/^-?\d+$/.test(raw.trim())) return null;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return null;
  return n < 0 ? 0 : n;
}

/**
 * B105: POST appends and returns the new list length as `seq`.
 * B106: GET ?since=N returns only messages with index >= N.
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

    const length = await store.rpush(key, line);
    await store.expire(key, ROOM_TTL_SECONDS);
    return { status: 200, body: { seq: length } };
  }

  if (verb === 'GET') {
    const from = parseSince(since);
    if (from === null) return BAD_REQUEST;
    const exists = await store.exists(key);
    if (!exists) return NO_ROOM;
    const raw = await store.lrange(key, from, -1);
    const messages: RelayMessage[] = [];
    for (let i = 0; i < raw.length; i++) {
      const line = raw[i];
      let parsed: unknown;
      if (typeof line === 'string') {
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
      } else {
        parsed = line;
      }
      if (parsed === null || typeof parsed !== 'object') continue;
      const m = parsed as Record<string, unknown>;
      const msg: RelayMessage = {
        seq: from + i + 1,
        from: typeof m.from === 'string' ? m.from : '',
        kind: (m.kind as RelayMessage['kind']) ?? 'intent',
        payload: m.payload,
      };
      if (typeof m.to === 'string') msg.to = m.to;
      messages.push(msg);
    }
    return { status: 200, body: { messages } };
  }

  return BAD_REQUEST;
}

/** In-process store. Used by tests and by `vercel dev` without Upstash creds. */
export function makeMemoryStore(): RoomStore & { lists: Map<string, string[]> } {
  const lists = new Map<string, string[]>();
  return {
    lists,
    async rpush(key, value) {
      const list = lists.get(key) ?? [];
      list.push(value);
      lists.set(key, list);
      return list.length;
    },
    async lrange(key, start, stop) {
      const list = lists.get(key) ?? [];
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      const begin = start < 0 ? Math.max(0, list.length + start) : start;
      return list.slice(begin, Math.max(begin, end));
    },
    async expire() {
      return 1;
    },
    async exists(key) {
      return lists.has(key) ? 1 : 0;
    },
  };
}

export default handleRoomRequest;
