/**
 * The push transport and its polling fallback (SB-65).
 *
 *  - `streamRoom` sends the backlog, then each append as it happens, a
 *    heartbeat, and `bye` when its time is up; a store with no push says so.
 *  - The Vercel function and the dev middleware both serve it, over the same
 *    store adapter, and a real `makeRelay` client reads it over HTTP.
 *  - A client whose stream is refused falls back to polling and still hears
 *    everything; with the push path off it polls from the start.
 *  - The poll loop: one chain no matter how often it is kicked (NET-10), an
 *    idle stop that anything local undoes (NET-3) and that a visible live
 *    match never takes, and request timeouts that a stop() cuts short.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  makeMemoryStore,
  streamRoom,
  handleRoomRequest,
  type RoomStore,
} from '../src/relay/roomHandler';
import { relayMiddleware } from '../src/relay/devMiddleware';
import {
  makeRelay,
  pollIntervalFor,
  shouldIdle,
  startPolling,
  POLL_HOT_INTERVAL_MS,
  POLL_INTERVAL_MS,
  POLL_HIDDEN_INTERVAL_MS,
  type Relay,
} from '@net/relay';
import type { RelayMessage } from '@engine/types';

const env = (from: string, n: number) => ({ from, kind: 'intent' as const, payload: { n } });

async function until(fn: () => boolean, ms = 3000): Promise<boolean> {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
  return true;
}

describe('streamRoom', () => {
  test('backlog first, then each append, a heartbeat, and bye at the deadline', async () => {
    const store = makeMemoryStore();
    await handleRoomRequest('POST', 'STRM01', env('a', 1), undefined, store);
    await handleRoomRequest('POST', 'STRM01', env('b', 2), undefined, store);
    const chunks: string[] = [];
    const ctl = new AbortController();
    const done = streamRoom('STRM01', 1, store, { write: (c) => chunks.push(c), signal: ctl.signal }, {
      maxMs: 300,
      heartbeatMs: 60,
    });
    expect(await until(() => chunks.join('').includes('id: 2'))).toBe(true);
    expect(chunks.join('')).not.toContain('id: 1\n');
    await handleRoomRequest('POST', 'STRM01', env('c', 3), undefined, store);
    expect(await until(() => chunks.join('').includes('id: 3'))).toBe(true);
    await done;
    const all = chunks.join('');
    expect(all.startsWith(': open')).toBe(true);
    expect(all).toContain(': hb');
    expect(all.trimEnd().endsWith('event: bye\ndata: {}')).toBe(true);
    const ev = all.split('\n\n').find((b) => b.startsWith('id: 3'))!;
    const msg = JSON.parse(ev.split('\n')[1]!.slice(6)) as RelayMessage;
    expect(msg).toMatchObject({ seq: 3, from: 'c', kind: 'intent', payload: { n: 3 } });
  });

  test('appends that land mid-read are not lost or duplicated', async () => {
    const store = makeMemoryStore();
    await handleRoomRequest('POST', 'STRM02', env('a', 0), undefined, store);
    const chunks: string[] = [];
    const ctl = new AbortController();
    const done = streamRoom('STRM02', 0, store, { write: (c) => chunks.push(c), signal: ctl.signal }, { maxMs: 400 });
    for (let i = 1; i <= 30; i++) void handleRoomRequest('POST', 'STRM02', env('a', i), undefined, store);
    expect(await until(() => chunks.join('').includes('id: 31\n'))).toBe(true);
    ctl.abort();
    await done;
    const ids = chunks.join('').match(/^id: \d+$/gm)!.map((l) => Number(l.slice(4)));
    expect(ids).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    // A client that left gets no bye.
    expect(chunks.join('')).not.toContain('event: bye');
  });

  test('a store with no push path reports an error instead of pretending', async () => {
    const mem = makeMemoryStore();
    const store: RoomStore = { append: mem.append, lrange: mem.lrange, llen: mem.llen };
    const chunks: string[] = [];
    await streamRoom('STRM03', 0, store, { write: (c) => chunks.push(c), signal: new AbortController().signal });
    expect(chunks.join('')).toContain('event: error');
    expect(chunks.join('')).not.toContain('event: bye');
  });

  test('GET since=end reports the tail without the history (NET-8)', async () => {
    const store = makeMemoryStore();
    for (let i = 0; i < 4; i++) await handleRoomRequest('POST', 'TAIL01', env('a', i), undefined, store);
    const res = await handleRoomRequest('GET', 'TAIL01', undefined, 'end', store);
    expect(res).toEqual({ status: 200, body: { messages: [], next: 4 } });
    const none = await handleRoomRequest('GET', 'TAIL02', undefined, 'end', store);
    expect(none.status).toBe(404);
  });
});

describe('the Vercel function serves the stream', () => {
  test('?stream=1 answers text/event-stream with the room in it', async () => {
    const mod = await import('../api/room/[code]');
    mod.setStreamTimingForTest({ maxMs: 150, heartbeatMs: 1000 });
    const code = `VSTRM${Date.now().toString(36)}`;
    const post = async (n: number) => {
      const res: any = { status: () => res, json: () => res, end: () => res, setHeader: () => res };
      await mod.default({ method: 'POST', query: { code }, headers: {}, body: env('x', n) } as any, res);
    };
    await post(1);
    await post(2);
    const headers: Record<string, string> = {};
    const chunks: string[] = [];
    let status = 0;
    let ended = false;
    const res: any = {
      status(c: number) {
        status = c;
        return res;
      },
      setHeader(k: string, v: string) {
        headers[k.toLowerCase()] = v;
      },
      json(b: unknown) {
        chunks.push(JSON.stringify(b));
      },
      write(c: string) {
        chunks.push(c);
        return true;
      },
      end() {
        ended = true;
      },
      on() {},
    };
    await mod.default({ method: 'GET', query: { code, stream: '1', since: '1' }, headers: {} } as any, res);
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('text/event-stream');
    expect(chunks.join('')).toContain('id: 2');
    expect(chunks.join('')).not.toContain('id: 1\n');
    expect(chunks.join('')).toContain('event: bye');
    expect(ended).toBe(true);
    mod.setStreamTimingForTest({});
  });
});

describe('a real client over the dev middleware', () => {
  let server: http.Server;
  let base = '';
  let refuseStream = false;

  beforeAll(async () => {
    const mw = relayMiddleware({ store: makeMemoryStore(), timing: { maxMs: 400, heartbeatMs: 100 } });
    server = http.createServer((req, res) => {
      if (refuseStream && (req.url ?? '').includes('stream=1')) {
        res.statusCode = 404;
        res.end('{"error":"nope"}');
        return;
      }
      mw(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function collect(relay: Relay, code: string, writer: Relay, count: number, gapMs = 0) {
    const got: RelayMessage[] = [];
    const loop = startPolling(relay, 0, (m) => got.push(...m));
    const t0 = Date.now();
    for (let i = 1; i <= count; i++) {
      await writer.post(env('w', i));
      if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
    }
    const ok = await until(() => got.length >= count, 8000);
    return { got, loop, ok, ms: Date.now() - t0 };
  }

  test('the push path delivers every entry once, in order, across the server ending the stream', async () => {
    const code = `DEVS${Date.now().toString(36)}`;
    const writer = makeRelay(code, 'w', { base, stream: false });
    const reader = makeRelay(code, 'r', { base });
    const { got, loop, ok } = await collect(reader, code, writer, 12, 90); // ~1s: spans 2+ stream lifetimes
    try {
      expect(ok).toBe(true);
      expect(loop.mode()).toBe('stream');
      expect(got.map((m) => m.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    } finally {
      loop.stop();
      reader.stop();
      writer.stop();
    }
  });

  test('a pushed entry arrives within a round trip, not a poll interval', async () => {
    const code = `DEVL${Date.now().toString(36)}`;
    const writer = makeRelay(code, 'w', { base, stream: false });
    await writer.post(env('w', 0));
    const reader = makeRelay(code, 'r', { base });
    const got: RelayMessage[] = [];
    const loop = startPolling(reader, 1, (m) => got.push(...m));
    try {
      await new Promise((r) => setTimeout(r, 150));
      const t0 = Date.now();
      await writer.post(env('w', 1));
      expect(await until(() => got.length >= 1, 2000)).toBe(true);
      expect(Date.now() - t0).toBeLessThan(POLL_INTERVAL_MS / 2);
    } finally {
      loop.stop();
      reader.stop();
      writer.stop();
    }
  });

  test('with the push path off, the loop polls and still hears everything', async () => {
    const code = `DEVP${Date.now().toString(36)}`;
    const writer = makeRelay(code, 'w', { base, stream: false });
    const reader = makeRelay(code, 'r', { base, stream: false });
    const { got, loop, ok } = await collect(reader, code, writer, 5);
    try {
      expect(ok).toBe(true);
      expect(loop.mode()).toBe('poll');
      expect(got.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      loop.stop();
      reader.stop();
      writer.stop();
    }
  });

  test('a refused stream falls back to polling without losing anything', async () => {
    refuseStream = true;
    const code = `DEVF${Date.now().toString(36)}`;
    const writer = makeRelay(code, 'w', { base, stream: false });
    const reader = makeRelay(code, 'r', { base });
    const errors: unknown[] = [];
    const got: RelayMessage[] = [];
    const loop = startPolling(reader, 0, (m) => got.push(...m), (e) => errors.push(e));
    try {
      for (let i = 1; i <= 4; i++) await writer.post(env('w', i));
      expect(await until(() => got.length >= 4, 8000)).toBe(true);
      expect(await until(() => loop.mode() === 'poll', 4000)).toBe(true);
      expect(errors.length).toBeGreaterThan(0);
      expect(got.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    } finally {
      refuseStream = false;
      loop.stop();
      reader.stop();
      writer.stop();
    }
  });

  test('stop() aborts a request that is still in flight', async () => {
    const hang = http.createServer(() => {
      /* never answers */
    });
    await new Promise<void>((r) => hang.listen(0, '127.0.0.1', () => r()));
    const hb = `http://127.0.0.1:${(hang.address() as AddressInfo).port}`;
    const relay = makeRelay('HANG01', 's', { base: hb, stream: false });
    try {
      const t0 = Date.now();
      const p = relay.poll(0).then(
        () => 'ok',
        () => 'rejected',
      );
      setTimeout(() => relay.stop(), 50);
      expect(await p).toBe('rejected');
      expect(Date.now() - t0).toBeLessThan(1000);
    } finally {
      hang.closeAllConnections?.();
      await new Promise<void>((r) => hang.close(() => r()));
    }
  });

  test('a GET that hangs times out instead of freezing the loop', async () => {
    const hang = http.createServer(() => {
      /* never answers */
    });
    await new Promise<void>((r) => hang.listen(0, '127.0.0.1', () => r()));
    const hb = `http://127.0.0.1:${(hang.address() as AddressInfo).port}`;
    const relay = makeRelay('HANG02', 's', { base: hb, stream: false });
    try {
      const t0 = Date.now();
      const err = await relay.poll(0).then(
        () => null,
        (e: Error) => e,
      );
      expect(err?.message).toBe('poll_timeout');
      expect(Date.now() - t0).toBeLessThan(6000);
    } finally {
      relay.stop();
      hang.closeAllConnections?.();
      await new Promise<void>((r) => hang.close(() => r()));
    }
  }, 10000);
});

describe('the poll loop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('cadence: hot after traffic, 1s at rest, never the hidden backoff in a live match', () => {
    expect(pollIntervalFor({ hidden: false, live: false, hotUntilMs: 10, nowMs: 5 })).toBe(POLL_HOT_INTERVAL_MS);
    expect(pollIntervalFor({ hidden: false, live: false, hotUntilMs: 0, nowMs: 5 })).toBe(POLL_INTERVAL_MS);
    expect(pollIntervalFor({ hidden: true, live: false, hotUntilMs: 0, nowMs: 5 })).toBe(POLL_HIDDEN_INTERVAL_MS);
    expect(pollIntervalFor({ hidden: true, live: true, hotUntilMs: 0, nowMs: 5 })).toBe(POLL_INTERVAL_MS);
  });

  test('idle: a lobby parks after 10 quiet minutes; a visible live match never does', () => {
    expect(shouldIdle({ live: false, hidden: false, quietMs: 11 * 60_000, hiddenForMs: 0 })).toBe(true);
    expect(shouldIdle({ live: false, hidden: false, quietMs: 9 * 60_000, hiddenForMs: 0 })).toBe(false);
    expect(shouldIdle({ live: true, hidden: false, quietMs: 5 * 60 * 60_000, hiddenForMs: 0 })).toBe(false);
    expect(shouldIdle({ live: true, hidden: true, quietMs: 31 * 60_000, hiddenForMs: 31 * 60_000 })).toBe(true);
  });

  function fakeRelay() {
    const calls: number[] = [];
    let release: (() => void) | null = null;
    let hold = false;
    const relay: Relay = {
      async post() {
        return 0;
      },
      poll(since) {
        calls.push(since);
        if (!hold) return Promise.resolve([]);
        return new Promise((r) => {
          release = () => r([]);
        });
      },
      stop() {},
    };
    return {
      relay,
      calls,
      holdNext(v: boolean) {
        hold = v;
      },
      release() {
        const r = release;
        release = null;
        if (r) r();
      },
    };
  }

  test('NET-3: an idle loop is parked, not dead — a kick wakes it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const f = fakeRelay();
    const loop = startPolling(f.relay, 0, () => {});
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(loop.mode()).toBe('idle');
    const parked = f.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.calls.length).toBe(parked);
    loop.kick();
    await vi.advanceTimersByTimeAsync(10);
    expect(loop.mode()).toBe('poll');
    expect(f.calls.length).toBeGreaterThan(parked);
    loop.stop();
  });

  test('NET-3: a live match keeps polling through a long quiet spell', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const f = fakeRelay();
    const loop = startPolling(f.relay, 0, () => {}, undefined, { live: () => true });
    await vi.advanceTimersByTimeAsync(40 * 60_000);
    expect(loop.mode()).toBe('poll');
    const before = f.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.calls.length - before).toBeGreaterThanOrEqual(9);
    loop.stop();
  });

  test('NET-10: kicks during an in-flight read never start a second chain', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const f = fakeRelay();
    f.holdNext(true);
    const loop = startPolling(f.relay, 0, () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls.length).toBe(1);
    for (let i = 0; i < 10; i++) loop.kick();
    expect(f.calls.length).toBe(1); // still in flight: the kicks only set "again"
    f.holdNext(false);
    f.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls.length).toBe(2); // exactly one re-read for all ten kicks
    // Past the hot window the loop settles to one read a second — one chain.
    await vi.advanceTimersByTimeAsync(6000);
    const settled = f.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.calls.length - settled).toBeGreaterThanOrEqual(9);
    expect(f.calls.length - settled).toBeLessThanOrEqual(11);
    loop.stop();
  });
});
