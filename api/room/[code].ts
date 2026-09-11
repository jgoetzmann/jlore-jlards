/**
 * The entire backend. A message queue that has never heard of a card game.
 *
 *   POST /api/room/[code]                  -> RPUSH + EXPIRE 6h + PUBLISH, return new length as seq
 *   GET  /api/room/[code]?since=N          -> LRANGE N -1
 *   GET  /api/room/[code]?since=end        -> { messages: [], next: LLEN }
 *   GET  /api/room/[code]?stream=1&since=N -> text/event-stream, one event per entry,
 *                                            pushed via Upstash pub/sub; ends after ~50s
 *
 * It parses nothing about the game. Behaviors B105, B106, B107.
 *
 * Runs as plain Node ESM: relative imports with explicit .js, never @ aliases.
 */

import {
  handleRoomRequest,
  isValidRoomCode,
  makeMemoryStore,
  MAX_BODY_BYTES,
  parseSince,
  streamRoom,
  type RoomStore,
  type StreamTiming,
} from '../../src/relay/roomHandler.js';
import { makeUpstashStore, readUpstashEnv } from '../../src/relay/upstash.js';

/** Minimal structural shape of a Vercel Node request/response. */
interface VercelLikeRequest {
  method?: string;
  url?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelLikeResponse {
  status(code: number): VercelLikeResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  end(body?: string): void;
  write?(chunk: string): unknown;
  flushHeaders?(): void;
  on?(event: 'close', cb: () => void): unknown;
  writableEnded?: boolean;
}

const ENV = readUpstashEnv();

/** Which store answered. Surfaced as a response header so a deployment can be
 *  diagnosed with curl instead of a dashboard log hunt. */
const storeKind: 'redis' | 'memory' = ENV.creds ? 'redis' : 'memory';

// Anything that is not a usable https REST url falls back rather than
// throwing. A degraded room that still serves hotseat beats a 500 on every
// request, and the header says which one you got.
const store: RoomStore = ENV.creds ? makeUpstashStore(ENV.creds) : makeMemoryStore();

/** Tests shorten the stream's clock. */
let streamTiming: StreamTiming = {};
export function setStreamTimingForTest(t: StreamTiming): void {
  streamTiming = t;
}

function queryParam(req: VercelLikeRequest, name: string): string | undefined {
  const q = req.query?.[name];
  if (typeof q === 'string') return q;
  if (Array.isArray(q) && typeof q[0] === 'string') return q[0];
  const url = req.url ?? '';
  const qi = url.indexOf('?');
  if (qi < 0) return undefined;
  return new URLSearchParams(url.slice(qi + 1)).get(name) ?? undefined;
}

function readCode(req: VercelLikeRequest): string {
  const q = req.query?.code;
  if (typeof q === 'string') return q;
  if (Array.isArray(q) && typeof q[0] === 'string') return q[0];
  const url = req.url ?? '';
  const path = url.split('?')[0];
  const parts = path.split('/').filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] ?? '');
}

function header(req: VercelLikeRequest, name: string): string | undefined {
  const h = req.headers?.[name];
  const raw = Array.isArray(h) ? h[0] : h;
  return typeof raw === 'string' ? raw : undefined;
}

function contentLength(req: VercelLikeRequest): number {
  const raw = header(req, 'content-length');
  if (raw === undefined) return -1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : -1;
}

async function stream(req: VercelLikeRequest, res: VercelLikeResponse): Promise<void> {
  const code = readCode(req);
  const lastId = header(req, 'last-event-id');
  const since = parseSince(lastId ? lastId : queryParam(req, 'since') ?? '0');
  if (!isValidRoomCode(code) || since === null || since === 'end' || typeof res.write !== 'function') {
    res.status(400).json({ error: 'bad_request' });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  const gone = new AbortController();
  // The response's close, not the request's: a GET's request "closes" as soon
  // as its (empty) body has been read.
  if (typeof res.on === 'function') res.on('close', () => gone.abort());
  const write = res.write.bind(res);
  await streamRoom(code, since, store, { write: (c) => void write(c), signal: gone.signal }, streamTiming);
  if (!res.writableEnded) res.end();
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse,
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('x-jlore-store', storeKind);
  // Ops diagnostic: is the relay actually configured? Reports the *shape* of
  // the credentials, never their values, so a half-configured deployment can be
  // identified with curl. Distinguishes "no variable" (len 0) from "wrong kind
  // of url" (https=false, e.g. a redis:// connection string) — the two ways
  // this has actually been got wrong.
  res.setHeader('x-jlore-env', ENV.shape);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, last-event-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (method === 'POST' && contentLength(req) > MAX_BODY_BYTES) {
    res.status(413).json({ error: 'too_large' });
    return;
  }

  try {
    if (method === 'GET' && queryParam(req, 'stream') === '1') {
      await stream(req, res);
      return;
    }
    const result = await handleRoomRequest(
      method,
      readCode(req),
      req.body,
      queryParam(req, 'since'),
      store,
    );
    res.status(result.status).json(result.body);
  } catch {
    if (res.writableEnded) return;
    res.status(400).json({ error: 'bad_request' });
  }
}
