/**
 * The relay, mounted into the Vite dev server.
 *
 * Without this, `npm run dev` serves the client and no `/api`, so multiplayer
 * cannot be exercised locally at all — you would have to deploy to Vercel to
 * find out whether two browsers can talk. It runs the same `handleRoomRequest`
 * the Vercel function does, so what you test locally is what ships.
 *
 * Uses Upstash when `UPSTASH_REDIS_REST_URL` / `_TOKEN` are in the environment,
 * and an in-process store otherwise, which is what the e2e run uses.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRoomRequest, roomKey, type RoomStore } from './roomHandler';

/** In-process store. Same semantics as Redis for the four ops we use. */
export function makeMemoryStore(): RoomStore {
  const lists = new Map<string, string[]>();
  return {
    async rpush(key, value) {
      const list = lists.get(key) ?? [];
      list.push(value);
      lists.set(key, list);
      return list.length;
    },
    async lrange(key, start, stop) {
      const list = lists.get(key) ?? [];
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      return list.slice(Math.max(0, start), Math.max(0, end));
    },
    async expire() {
      return 1;
    },
    async exists(key) {
      return lists.has(key) ? 1 : 0;
    },
  };
}

async function makeStore(): Promise<RoomStore> {
  const url = process.env['UPSTASH_REDIS_REST_URL'] ?? '';
  const token = process.env['UPSTASH_REDIS_REST_TOKEN'] ?? '';
  if (!url || !token || !url.startsWith('https://')) return makeMemoryStore();
  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({ url, token });
  return {
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
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      // Stop reading well past the handler's own 256KB limit; it still answers 413.
      if (size > 2 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** A Vite/Connect middleware serving POST+GET /api/room/:code. */
export function relayMiddleware(): (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => void {
  let storePromise: Promise<RoomStore> | null = null;

  return (req, res, next) => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/room/')) {
      next();
      return;
    }

    void (async () => {
      try {
        storePromise ??= makeStore();
        const store = await storePromise;

        const parsed = new URL(url, 'http://localhost');
        const code = decodeURIComponent(parsed.pathname.replace('/api/room/', '').split('/')[0] ?? '');
        const sinceRaw = parsed.searchParams.get('since');
        const since = sinceRaw === null ? undefined : Number(sinceRaw);

        let body: unknown;
        if (req.method === 'POST') {
          const raw = await readBody(req);
          try {
            body = JSON.parse(raw) as unknown;
          } catch {
            body = raw; // let the handler reject it as bad_request
          }
        }

        const result = await handleRoomRequest(req.method ?? 'GET', code, body, since, store);
        res.statusCode = result.status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(result.body));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'relay_failed', detail: String(err).slice(0, 200) }));
      }
    })();
  };
}

export { roomKey };
