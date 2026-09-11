/**
 * The relay, mounted into the Vite dev server.
 *
 * Without this, `npm run dev` serves the client and no `/api`, so multiplayer
 * cannot be exercised locally at all — you would have to deploy to Vercel to
 * find out whether two browsers can talk. It runs the same `handleRoomRequest`
 * and `streamRoom` the Vercel function does, over the same store adapters, so
 * what you test locally is what ships — the push path included, which is what
 * the e2e suite exercises.
 *
 * Uses Upstash when `UPSTASH_REDIS_REST_URL` / `_TOKEN` are in the environment,
 * and an in-process store otherwise, which is what the e2e run uses.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  handleRoomRequest,
  isValidRoomCode,
  makeMemoryStore,
  parseSince,
  roomKey,
  streamRoom,
  type RoomStore,
  type StreamTiming,
} from './roomHandler';
import { makeUpstashStore, readUpstashEnv } from './upstash';

export { makeMemoryStore };

function makeStore(): RoomStore {
  const { creds } = readUpstashEnv(process.env);
  return creds ? makeUpstashStore(creds) : makeMemoryStore();
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

export interface RelayMiddlewareOptions {
  store?: RoomStore;
  timing?: StreamTiming;
}

/** A Vite/Connect middleware serving POST, GET and the event stream at /api/room/:code. */
export function relayMiddleware(options: RelayMiddlewareOptions = {}): (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => void {
  let store: RoomStore | null = options.store ?? null;

  return (req, res, next) => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/room/')) {
      next();
      return;
    }

    void (async () => {
      try {
        store ??= makeStore();

        const parsed = new URL(url, 'http://localhost');
        const code = decodeURIComponent(parsed.pathname.replace('/api/room/', '').split('/')[0] ?? '');
        const sinceRaw = parsed.searchParams.get('since');

        if (req.method === 'GET' && parsed.searchParams.get('stream') === '1') {
          const lastId = req.headers['last-event-id'];
          const since = parseSince(typeof lastId === 'string' && lastId ? lastId : sinceRaw ?? '0');
          if (!isValidRoomCode(code) || since === null || since === 'end') {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'bad_request' }));
            return;
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'text/event-stream; charset=utf-8');
          res.setHeader('cache-control', 'no-cache, no-transform');
          res.setHeader('x-accel-buffering', 'no');
          res.flushHeaders();
          const gone = new AbortController();
          res.on('close', () => gone.abort());
          await streamRoom(code, since, store, { write: (c) => res.write(c), signal: gone.signal }, options.timing);
          if (!res.writableEnded) res.end();
          return;
        }

        const since = sinceRaw === null ? undefined : sinceRaw;

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
        if (res.headersSent) {
          if (!res.writableEnded) res.end();
          return;
        }
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'relay_failed', detail: String(err).slice(0, 200) }));
      }
    })();
  };
}

export { roomKey };
