/**
 * npx tsx tools/bench-reduce.ts --games=6 --players=2,4 --seed=1 --reps=3
 *
 * Headless cost of `reduce` (and of `viewFor`, which every client now runs
 * after every action) across whole bot matches. Lockstep puts one reduce per
 * press on every client, plus a full replay on refresh, so this is the number
 * that turns into click latency.
 *
 * Method: simulate each match once with the bots to record its action list,
 * replay it once untimed to warm the JIT, then replay it `reps` times timing
 * every `reduce` call individually. Calls are bucketed by the turn they ran on:
 *   early = turns 1-10, late = the last 20% of that match's turns.
 * Each bucket reports the mean over all its calls, and p95. The clock lives here
 * because src/engine may not touch it (B117).
 */

import { performance } from 'node:perf_hooks';
import { createMatch, reduce } from '@engine/index';
import { viewFor } from '@engine/view';
import { simConfig, simPlayers, simulateMatchDetailed } from '@sim/run';
import type { GameAction, GameState, MatchConfig, PlayerId } from '@engine/types';
import { bootstrap, intArg, parseArgs } from './bootstrap';

interface Recorded {
  seed: number;
  playerCount: number;
  config: MatchConfig;
  players: { id: PlayerId; name: string; codex: string[] }[];
  actions: GameAction[];
  turns: number;
}

interface Bucket {
  reduce: number[];
  view: number[];
  logLen: number[];
}

function emptyBucket(): Bucket {
  return { reduce: [], view: [], logLen: [] };
}

function record(seed: number, playerCount: number): Recorded {
  const detailed = simulateMatchDetailed(seed, playerCount);
  return {
    seed,
    playerCount,
    config: simConfig(playerCount),
    players: simPlayers(playerCount),
    actions: detailed.actions,
    turns: detailed.turns,
  };
}

/** One replay; when `into` is given, every reduce and viewFor is timed. */
function run(rec: Recorded, into: { early: Bucket; late: Bucket; all: Bucket } | null): GameState {
  let state = createMatch(rec.config, rec.players, rec.seed);
  const lateFrom = Math.max(11, Math.floor(rec.turns * 0.8));
  for (const action of rec.actions) {
    if (state.ended) break;
    const turn = state.turn;
    const t0 = performance.now();
    state = reduce(state, action);
    const t1 = performance.now();
    // What a lockstep client renders after each press: its own seat's view.
    viewFor(state, state.playerOrder[0]!);
    const t2 = performance.now();
    if (!into) continue;
    const buckets = [into.all];
    if (turn <= 10) buckets.push(into.early);
    if (turn >= lateFrom) buckets.push(into.late);
    for (const b of buckets) {
      b.reduce.push(t1 - t0);
      b.view.push(t2 - t1);
      b.logLen.push(state.log.length);
    }
  }
  return state;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function p95(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
}

function row(label: string, b: Bucket): string {
  return (
    label.padEnd(7) +
    String(b.reduce.length).padStart(7) +
    mean(b.reduce).toFixed(3).padStart(10) +
    p95(b.reduce).toFixed(3).padStart(10) +
    mean(b.view).toFixed(3).padStart(10) +
    Math.round(mean(b.logLen)).toString().padStart(9)
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const games = Math.max(1, intArg(args, 'games', 6));
  const startSeed = intArg(args, 'seed', 1);
  const reps = Math.max(1, intArg(args, 'reps', 3));
  const counts = (args['players'] ?? '2,4')
    .split(',')
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 2 && n <= 4);

  bootstrap();
  process.stdout.write(
    `bench-reduce — ${games} games per player count, seeds ${startSeed}..${startSeed + games - 1}, ${reps} timed reps\n`,
  );

  for (const playerCount of counts) {
    const recs: Recorded[] = [];
    for (let i = 0; i < games; i++) recs.push(record(startSeed + i, playerCount));
    for (const rec of recs) run(rec, null); // warm-up

    const into = { early: emptyBucket(), late: emptyBucket(), all: emptyBucket() };
    const wall0 = performance.now();
    for (let r = 0; r < reps; r++) for (const rec of recs) run(rec, into);
    const wall = performance.now() - wall0;

    const actions = recs.reduce((n, r) => n + r.actions.length, 0);
    const turns = recs.map((r) => r.turns);
    process.stdout.write(
      `\n${playerCount}p: ${actions} actions, turns ${Math.min(...turns)}-${Math.max(...turns)}, ` +
        `full replay of all ${games} matches x${reps}: ${wall.toFixed(0)} ms\n`,
    );
    process.stdout.write('bucket   calls  reduce ms   p95 ms   view ms  log len\n');
    process.stdout.write(row('early', into.early) + '\n');
    process.stdout.write(row('late', into.late) + '\n');
    process.stdout.write(row('all', into.all) + '\n');
  }
}

main();
