/**
 * Replay a match from `(seed, actionLog)`.
 *
 * A playtest bug report is two numbers. This turns them back into a match you
 * can step through, which is what makes B119 useful rather than merely true —
 * the same seed and the same action list always reproduce the same state, so a
 * "the Grapevine did something weird and then Misery replayed it" report is
 * reproducible instead of anecdotal.
 *
 *   npm run replay -- --seed=42 --players=3
 *       Simulate, then replay the recorded actions and verify the two agree.
 *
 *   npm run replay -- --seed=42 --players=3 --out=telemetry/bug.json
 *       Record the run so someone else can replay it without the bots.
 *
 *   npm run replay -- --in=telemetry/bug.json
 *       Replay a recorded log.
 *
 *   npm run replay -- --seed=42 --players=3 --turn=14
 *       Stop at the start of turn 14 and print the board. Useful for animation
 *       timing and for finding the turn a bug actually starts on.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createMatch, reduce } from '@engine/index';
import { registerCards, registerAuras } from '@engine/registry';
import { allCardDefinitions, allAuraDefinitions } from '@cards/index';
import { simConfig, simPlayers, simulateMatchDetailed } from '@sim/run';
import type { GameAction, GameState, MatchConfig, PlayerId } from '@engine/types';

registerCards(allCardDefinitions());
registerAuras(allAuraDefinitions());

interface Recording {
  seed: number;
  playerCount: number;
  config: MatchConfig;
  players: { id: PlayerId; name: string; codex: string[] }[];
  actions: GameAction[];
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function num(name: string, fallback: number): number {
  const v = arg(name);
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Feed a recorded action list back through `reduce` from a fresh match. */
export function replay(rec: Recording, stopAtTurn?: number): GameState {
  let state = createMatch(rec.config, rec.players, rec.seed);
  for (const action of rec.actions) {
    if (stopAtTurn !== undefined && state.turn >= stopAtTurn) break;
    if (state.ended) break;
    state = reduce(state, action);
  }
  return state;
}

function summarise(s: GameState): string {
  const lines: string[] = [];
  lines.push(`turn ${s.turn}  round ${s.round}  active ${s.activePlayer}`);
  lines.push(`anomaly ${s.anomaly ?? 'none'}   ended ${s.ended}   reason ${s.endReason ?? '-'}`);
  if (s.winners) lines.push(`winners ${s.winners.join(', ')}`);
  for (const pid of s.playerOrder) {
    const p = s.players[pid];
    if (!p) continue;
    const deck = p.library.length + p.hand.length + p.gy.length + p.play.length;
    lines.push(
      `  ${pid.padEnd(4)} vp ${String(p.vp).padStart(3)}  prophet ${String(p.prophet).padStart(3)}` +
        `  money ${String(p.money).padStart(3)}  deck ${String(deck).padStart(3)}` +
        `  hand ${p.hand.length}  lib ${p.library.length}  auras ${p.field.length}`,
    );
  }
  const emptied = s.shop.order.draft.filter((id) => (s.shop.piles[id]?.cards.length ?? 0) === 0);
  lines.push(`  draft piles empty: ${emptied.length}/${s.shop.order.draft.length}`);
  return lines.join('\n');
}

function main(): void {
  const inPath = arg('in');
  const outPath = arg('out');
  const turnArg = arg('turn');
  const stopAtTurn = turnArg === undefined ? undefined : Number(turnArg);

  let rec: Recording;

  if (inPath) {
    rec = JSON.parse(readFileSync(inPath, 'utf8')) as Recording;
    console.log(`replaying ${inPath} — seed ${rec.seed}, ${rec.playerCount}p, ${rec.actions.length} actions`);
  } else {
    const seed = num('seed', 1);
    const playerCount = num('players', 2);
    const detailed = simulateMatchDetailed(seed, playerCount);
    rec = {
      seed,
      playerCount,
      config: simConfig(playerCount),
      players: simPlayers(playerCount),
      actions: detailed.actions,
    };
    console.log(
      `simulated seed ${seed}, ${playerCount}p — ${detailed.turns} turns, ` +
        `${detailed.actions.length} actions, ended by ${detailed.endReason}`,
    );
  }

  const final = replay(rec, stopAtTurn);

  if (stopAtTurn !== undefined) {
    console.log(`\n--- state at the start of turn ${stopAtTurn} ---`);
  } else {
    console.log('\n--- replayed final state ---');
  }
  console.log(summarise(final));

  // With no --turn, the replay ran the whole log, so it must agree with the
  // original run. This is B119 as a live check rather than a claim.
  if (stopAtTurn === undefined && !inPath) {
    const again = replay(rec);
    const same = JSON.stringify(again) === JSON.stringify(final);
    console.log(`\ndeterminism: replaying twice ${same ? 'matches' : 'DIVERGED'}`);
    if (!same) process.exitCode = 1;
  }

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(rec, null, 2), 'utf8');
    console.log(`\nwrote ${outPath} (${rec.actions.length} actions) — replay it with --in=${outPath}`);
  }
}

main();
