/**
 * Verify the relay backend end to end against real Upstash Redis.
 *
 * The relay is the only part of this project that cannot be proven by the test
 * suite: `npx vitest run` exercises the handler against an in-memory store, so
 * a green suite says nothing about whether your credentials, your database, or
 * the network path actually work. This drives the real `handleRoomRequest` and
 * `streamRoom` against real Redis, through the same REST adapter the deployed
 * function uses, and checks the same behaviors the suite does (B105-B107) plus
 * the pub/sub push path.
 *
 *   npm run relay:check
 *
 * Reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from `.env` (or the
 * environment, which is what it uses on Vercel). Prints no secrets. Cleans up
 * the key it creates. Exits non-zero on any failure, so CI can gate on it.
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  handleRoomRequest,
  roomKey,
  streamRoom,
  ROOM_TTL_SECONDS,
} from '../src/relay/roomHandler.js';
import { makeUpstashStore, readUpstashEnv } from '../src/relay/upstash.js';

/** Minimal .env loader: strips surrounding quotes, never overwrites a real env var. */
function loadDotEnv(): void {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    if (process.env[key]) continue;
    process.env[key] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
}

async function main(): Promise<void> {
  loadDotEnv();
  const { creds, shape } = readUpstashEnv(process.env);

  if (!creds) {
    console.log(`No usable Upstash credentials found (${shape}).`);
    console.log('Set UPSTASH_REDIS_REST_URL (the https:// REST url, not redis://) and');
    console.log('UPSTASH_REDIS_REST_TOKEN in .env (copy .env.example). The app still runs hotseat without them.');
    process.exitCode = 1;
    return;
  }

  const store = makeUpstashStore(creds);
  const code = `CHK${String(Date.now() % 100000).padStart(5, '0')}`;
  console.log(`checking relay against ${new URL(creds.url).host} using room ${code}\n`);

  try {
    const p1 = await handleRoomRequest('POST', code, { from: 'p1', kind: 'hello', payload: {} }, undefined, store);
    check('B105 POST appends and returns the new length as seq', p1.status === 200 && (p1.body as { seq: number }).seq === 1);

    const p2 = await handleRoomRequest('POST', code, { from: 'p2', kind: 'intent', payload: { type: 'endTurn' } }, undefined, store);
    check('B105 a second POST increments seq', p2.status === 200 && (p2.body as { seq: number }).seq === 2);

    const g0 = await handleRoomRequest('GET', code, undefined, 0, store);
    check('B106 GET since=0 returns every message', g0.status === 200 && (g0.body as { messages: unknown[] }).messages.length === 2);

    const g1 = await handleRoomRequest('GET', code, undefined, 1, store);
    check('B106 GET since=1 returns only newer messages', (g1.body as { messages: unknown[] }).messages.length === 1);

    const tail = await handleRoomRequest('GET', code, undefined, 'end', store);
    check('GET since=end reports the tail', (tail.body as { next?: number }).next === 2);

    const bad = await handleRoomRequest('POST', code, { nope: true }, undefined, store);
    check('B107 a malformed body is 400 bad_request', bad.status === 400 && (bad.body as { error: string }).error === 'bad_request');

    const big = await handleRoomRequest('POST', code, { from: 'p1', kind: 'intent', payload: { blob: 'x'.repeat(300 * 1024) } }, undefined, store);
    check('B107 an oversize body is 413 too_large', big.status === 413 && (big.body as { error: string }).error === 'too_large');

    const gone = await handleRoomRequest('GET', 'NOSUCHROOM', undefined, 0, store);
    check('B107 an unknown room is 404 no_room', gone.status === 404);

    const ttl = Number(await store.command(['TTL', roomKey(code)]));
    check('rooms expire', ttl > 0 && ttl <= ROOM_TTL_SECONDS, `ttl ${ttl}s of ${ROOM_TTL_SECONDS}`);

    // The push path: open a stream from the tail, append, and time the event.
    const chunks: string[] = [];
    const client = new AbortController();
    const streaming = streamRoom(code, 2, store, { write: (c) => chunks.push(c), signal: client.signal }, { maxMs: 8000 });
    await new Promise((r) => setTimeout(r, 1200));
    const t0 = Date.now();
    await handleRoomRequest('POST', code, { from: 'p1', kind: 'intent', payload: { type: 'endTurn' } }, undefined, store);
    let seenAt = 0;
    while (Date.now() - t0 < 5000) {
      if (chunks.join('').includes('id: 3')) {
        seenAt = Date.now();
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    client.abort();
    await streaming;
    check('pub/sub pushes an appended entry to an open stream', seenAt > 0, seenAt ? `${seenAt - t0}ms` : 'no event in 5s');
    check('the stream did not report an error', !chunks.join('').includes('event: error'), chunks.find((c) => c.includes('error')) ?? '');

    await store.command(['DEL', roomKey(code)]);
  } catch (e) {
    check('reached Upstash', false, String(e).slice(0, 200));
  }

  console.log(failures === 0 ? '\nrelay OK — multiplayer will work' : `\n${failures} check(s) failed`);
  if (failures > 0) process.exitCode = 1;
}

void main();
