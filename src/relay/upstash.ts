/**
 * The Redis store, spoken over Upstash's REST API with plain `fetch`.
 *
 * One adapter for every caller — the Vercel function, the Vite dev middleware
 * and `npm run relay:check` — so they cannot drift apart. It replaces the
 * `@upstash/redis` client, which has PUBLISH but no SUBSCRIBE, decodes every
 * list element for us only to have it re-encoded, and base64s responses by
 * default (NET-5).
 *
 *   append    POST /pipeline  [RPUSH, EXPIRE, PUBLISH]   one round trip
 *   lrange    POST /          [LRANGE key start stop]
 *   subscribe POST /subscribe/<channel>, Accept: text/event-stream
 *             lines: `data: subscribe,<channel>,1` then `data: message,<channel>,<payload>`
 *
 * Runs as plain Node ESM on Vercel: no path aliases, no runtime imports.
 */

import type { RoomStore, Subscription } from './roomHandler';

export interface UpstashCreds {
  url: string;
  token: string;
}

type FetchLike = typeof fetch;

/**
 * Read the credentials, tolerating a pasted value that still has its quotes
 * on. `"https://x.upstash.io"` is truthy, so it would slip past a presence
 * check and fail at request time with an opaque error.
 */
export function readUpstashEnv(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): { creds: UpstashCreds | null; shape: string } {
  const clean = (v: string | undefined): string => (v ?? '').trim().replace(/^['"]|['"]$/g, '');
  const url = clean(env['UPSTASH_REDIS_REST_URL']).replace(/\/+$/, '');
  const token = clean(env['UPSTASH_REDIS_REST_TOKEN']);
  const https = url.startsWith('https://');
  const shape = `urlLen=${url.length},tokenLen=${token.length},https=${https}`;
  return { creds: url && token && https ? { url, token } : null, shape };
}

/** A channel/key in a URL path. Redis keys here are `jlore:room:CODE`. */
function pathSegment(s: string): string {
  return encodeURIComponent(s).replace(/%3A/gi, ':');
}

export interface UpstashStore extends RoomStore {
  /** Any single command, for tools. Returns `result`. */
  command(args: (string | number)[]): Promise<unknown>;
}

export function makeUpstashStore(creds: UpstashCreds, fetchImpl: FetchLike = fetch): UpstashStore {
  const auth = { authorization: `Bearer ${creds.token}` };

  async function command(args: (string | number)[]): Promise<unknown> {
    const res = await fetchImpl(creds.url, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(args.map(String)),
    });
    const out = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
    if (!res.ok || !out || out.error) throw new Error(`upstash_${res.status}: ${out?.error ?? 'bad response'}`);
    return out.result;
  }

  async function pipeline(cmds: (string | number)[][]): Promise<unknown[]> {
    const res = await fetchImpl(`${creds.url}/pipeline`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(cmds.map((c) => c.map(String))),
    });
    const out = (await res.json().catch(() => null)) as { result?: unknown; error?: string }[] | null;
    if (!res.ok || !Array.isArray(out)) throw new Error(`upstash_pipeline_${res.status}`);
    return out.map((r) => {
      if (r && r.error) throw new Error(`upstash: ${r.error}`);
      return r ? r.result : undefined;
    });
  }

  return {
    command,

    async append(key, value, ttlSeconds) {
      const [len] = await pipeline([
        ['RPUSH', key, value],
        ['EXPIRE', key, ttlSeconds],
        ['PUBLISH', key, '1'],
      ]);
      return Number(len);
    },

    async lrange(key, start, stop) {
      const raw = (await command(['LRANGE', key, start, stop])) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
    },

    async llen(key) {
      return Number((await command(['LLEN', key])) ?? 0);
    },

    async subscribe(key, onNotify, signal): Promise<Subscription> {
      const res = await fetchImpl(`${creds.url}/subscribe/${pathSegment(key)}`, {
        method: 'POST',
        headers: { ...auth, accept: 'text/event-stream' },
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`upstash_subscribe_${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let confirm: () => void = () => undefined;
      let refuse: (err: unknown) => void = () => undefined;
      const subscribed = new Promise<void>((resolve, reject) => {
        confirm = resolve;
        refuse = reject;
      });

      const closed = (async () => {
        let buf = '';
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl = buf.indexOf('\n');
            while (nl >= 0) {
              const line = buf.slice(0, nl).replace(/\r$/, '');
              buf = buf.slice(nl + 1);
              nl = buf.indexOf('\n');
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              const type = data.slice(0, data.indexOf(','));
              if (type === 'subscribe') confirm();
              else if (type === 'message') onNotify();
            }
          }
        } catch {
          /* aborted, or the connection dropped: either way it is over */
        }
        refuse(new Error('upstash_subscribe_closed'));
      })();

      await subscribed;
      return { closed };
    },
  };
}
