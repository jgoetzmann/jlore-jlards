/**
 * The entire backend. A message queue that has never heard of a card game.
 *
 *   POST /api/room/[code]           -> RPUSH, EXPIRE 6h, return new length as seq
 *   GET  /api/room/[code]?since=N   -> LRANGE N -1
 *
 * It parses nothing about the game. Behaviors B105, B106, B107.
 */

import { Redis } from '@upstash/redis';
import {
  handleRoomRequest,
  makeMemoryStore,
  MAX_BODY_BYTES,
  type RoomStore,
} from '../../src/relay/roomHandler';

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
}

const REST_URL = process.env.UPSTASH_REDIS_REST_URL ?? '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';

const fallbackStore = makeMemoryStore();

let cachedStore: RoomStore | null = null;

function getStore(): RoomStore {
  if (cachedStore) return cachedStore;
  if (!REST_URL || !REST_TOKEN) {
    cachedStore = fallbackStore;
    return cachedStore;
  }
  const redis = new Redis({ url: REST_URL, token: REST_TOKEN });
  cachedStore = {
    async rpush(key, value) {
      return (await redis.rpush(key, value)) as number;
    },
    async lrange(key, start, stop) {
      const raw = (await redis.lrange(key, start, stop)) as unknown[];
      return raw.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
    },
    async expire(key, seconds) {
      return await redis.expire(key, seconds);
    },
    async exists(key) {
      return (await redis.exists(key)) as number;
    },
  };
  return cachedStore;
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

function readSince(req: VercelLikeRequest): string | undefined {
  const q = req.query?.since;
  if (typeof q === 'string') return q;
  if (Array.isArray(q) && typeof q[0] === 'string') return q[0];
  const url = req.url ?? '';
  const qi = url.indexOf('?');
  if (qi < 0) return undefined;
  const params = new URLSearchParams(url.slice(qi + 1));
  return params.get('since') ?? undefined;
}

function contentLength(req: VercelLikeRequest): number {
  const h = req.headers?.['content-length'];
  const raw = Array.isArray(h) ? h[0] : h;
  if (typeof raw !== 'string') return -1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : -1;
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse,
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
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
    const result = await handleRoomRequest(
      method,
      readCode(req),
      req.body,
      readSince(req),
      getStore(),
    );
    res.status(result.status).json(result.body);
  } catch {
    res.status(400).json({ error: 'bad_request' });
  }
}
