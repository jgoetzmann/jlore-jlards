/**
 * T4 — Relay (S-NET). Behaviors B105, B106, B107, B108.
 *
 * Written from .fullsend/SPEC.md against the frozen surface in src/engine/types.ts.
 *
 * The HTTP behaviors are tested against the route handler the Surface's routes
 * imply — `api/room/[code]` under the Vercel file convention, default-exporting
 * a (req, res) handler. The handler is imported dynamically inside each test so
 * a storage-layer import failure cannot take the makeLocalRelay tests with it.
 */
import { makeLocalRelay } from '@net/relay';
import type { RelayMessage } from '@engine/types';

interface Captured {
  status: number | null;
  body: any;
}

async function call(
  method: 'GET' | 'POST',
  code: string,
  opts: { body?: unknown; since?: number } = {},
): Promise<Captured> {
  const mod: any = await import('../api/room/[code]');
  const handler = mod.default ?? mod.handler;
  expect(typeof handler).toBe('function');

  const query: Record<string, string> = { code };
  if (opts.since !== undefined) query.since = String(opts.since);

  const req: any = {
    method,
    query,
    headers: { 'content-type': 'application/json' },
    body: opts.body,
    url: `/api/room/${code}${opts.since === undefined ? '' : `?since=${opts.since}`}`,
  };

  const out: Captured = { status: null, body: null };
  const res: any = {
    status(c: number) {
      out.status = c;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      return res;
    },
    send(b: unknown) {
      out.body = b;
      return res;
    },
    end(b?: unknown) {
      if (b !== undefined) out.body = b;
      return res;
    },
    setHeader() {
      return res;
    },
  };

  await handler(req, res);
  return out;
}

const msg = (from: string, payload: unknown): Omit<RelayMessage, 'seq'> => ({
  from,
  kind: 'intent',
  payload,
});

let room = 0;
const nextRoom = () => `t4room${Date.now().toString(36)}${room++}`;

describe('S-NET — relay HTTP surface', () => {
  test('B105: POST /api/room/[code] appends a message and returns the new list length as seq', async () => {
    const code = nextRoom();

    const first = await call('POST', code, { body: msg('seat-a', { n: 1 }) });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ seq: 1 });

    const second = await call('POST', code, { body: msg('seat-b', { n: 2 }) });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ seq: 2 });

    const third = await call('POST', code, { body: msg('seat-a', { n: 3 }) });
    expect(third.status).toBe(200);
    expect(third.body).toEqual({ seq: 3 });
  });

  test('B106: GET /api/room/[code]?since=N returns only messages with index >= N', async () => {
    const code = nextRoom();
    await call('POST', code, { body: msg('seat-a', { n: 1 }) });
    await call('POST', code, { body: msg('seat-b', { n: 2 }) });
    await call('POST', code, { body: msg('seat-c', { n: 3 }) });

    const all = await call('GET', code, { since: 0 });
    expect(all.status).toBe(200);
    expect(all.body.messages).toHaveLength(3);
    expect(all.body.messages.map((m: RelayMessage) => m.seq)).toEqual([1, 2, 3]);

    const tail = await call('GET', code, { since: 1 });
    expect(tail.status).toBe(200);
    expect(tail.body.messages).toHaveLength(2);
    expect(tail.body.messages.map((m: RelayMessage) => m.seq)).toEqual([2, 3]);
    expect(tail.body.messages.map((m: RelayMessage) => m.from)).toEqual(['seat-b', 'seat-c']);
  });

  test('B106: GET with since past the end of the list returns an empty message list, not an error', async () => {
    const code = nextRoom();
    await call('POST', code, { body: msg('seat-a', { n: 1 }) });
    await call('POST', code, { body: msg('seat-b', { n: 2 }) });

    const past = await call('GET', code, { since: 2 });
    expect(past.status).toBe(200);
    expect(past.body.messages).toEqual([]);

    const wayPast = await call('GET', code, { since: 99 });
    expect(wayPast.status).toBe(200);
    expect(wayPast.body.messages).toEqual([]);
  });

  test('B106: GET for a room that has never been posted to returns 404 no_room', async () => {
    const res = await call('GET', `${nextRoom()}-never`, { since: 0 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'no_room' });
  });

  test('B107: a POST body that is not a relay message returns 400 bad_request', async () => {
    const code = nextRoom();
    const res = await call('POST', code, { body: '{"nope":' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad_request' });
  });

  test('B107: a POST body missing required relay message fields returns 400 bad_request', async () => {
    const code = nextRoom();

    const noKind = await call('POST', code, { body: { from: 'seat-a', payload: {} } });
    expect(noKind.status).toBe(400);
    expect(noKind.body).toEqual({ error: 'bad_request' });

    const noFrom = await call('POST', code, { body: { kind: 'intent', payload: {} } });
    expect(noFrom.status).toBe(400);
    expect(noFrom.body).toEqual({ error: 'bad_request' });

    const empty = await call('POST', code, { body: {} });
    expect(empty.status).toBe(400);
    expect(empty.body).toEqual({ error: 'bad_request' });
  });

  test('B107: a POST body over 256KB returns 413 too_large', async () => {
    const code = nextRoom();
    const huge = 'x'.repeat(300 * 1024);
    const res = await call('POST', code, { body: msg('seat-a', huge) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'too_large' });
  });

  test('B107: a POST body comfortably under 256KB is accepted', async () => {
    const code = nextRoom();
    const chunky = 'y'.repeat(100 * 1024);
    const res = await call('POST', code, { body: msg('seat-a', chunky) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ seq: 1 });
  });
});

describe('S-NET — makeLocalRelay', () => {
  test('B108: a posted message reaches a poller in the same process', async () => {
    const relay = makeLocalRelay();
    try {
      const seq = await relay.post(msg('seat-a', { hello: 'world' }));
      expect(seq).toBe(1);

      const got = await relay.poll(0);
      expect(got).toHaveLength(1);
      expect(got[0].from).toBe('seat-a');
      expect(got[0].kind).toBe('intent');
      expect(got[0].payload).toEqual({ hello: 'world' });
      expect(got[0].seq).toBe(1);
    } finally {
      relay.stop();
    }
  });

  test('B108: seq increments by one per post and poll(since) honours the index cutoff', async () => {
    const relay = makeLocalRelay();
    try {
      expect(await relay.post(msg('a', 1))).toBe(1);
      expect(await relay.post(msg('b', 2))).toBe(2);
      expect(await relay.post(msg('c', 3))).toBe(3);

      expect(await relay.poll(0)).toHaveLength(3);
      expect((await relay.poll(1)).map((m) => m.from)).toEqual(['b', 'c']);
      expect((await relay.poll(2)).map((m) => m.from)).toEqual(['c']);
    } finally {
      relay.stop();
    }
  });

  test('B108: a fresh local relay polls empty rather than failing', async () => {
    const relay = makeLocalRelay();
    try {
      expect(await relay.poll(0)).toEqual([]);
      expect(await relay.poll(5)).toEqual([]);
    } finally {
      relay.stop();
    }
  });

  test('B108: an addressed message keeps its from/to/kind envelope through the local relay', async () => {
    const relay = makeLocalRelay();
    try {
      await relay.post({ from: 'host', to: 'seat-b', kind: 'view', payload: { v: 7 } });
      const got = await relay.poll(0);
      expect(got).toHaveLength(1);
      expect(got[0].from).toBe('host');
      expect(got[0].to).toBe('seat-b');
      expect(got[0].kind).toBe('view');
      expect(got[0].payload).toEqual({ v: 7 });
    } finally {
      relay.stop();
    }
  });
});
