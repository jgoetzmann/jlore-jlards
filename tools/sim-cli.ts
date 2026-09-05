/**
 * npm run sim -- --games=500 --players=3 --seed=1 --json=telemetry/run.json
 *
 * Plays bot matches headlessly and prints a readable summary. Everything that
 * touches the filesystem or the clock lives here, never in src/sim.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { simulateManyDetailed } from '@sim/run';
import type { DetailedMatchResult } from '@sim/run';
import { aggregate, winsBySeat } from '@sim/telemetry';
import { bootstrap, fixed, intArg, parseArgs, pct, stamp } from './bootstrap';

function bar(n: number, max: number, width: number): string {
  if (max <= 0) return '';
  const filled = Math.max(0, Math.min(width, Math.round((n / max) * width)));
  return '#'.repeat(filled);
}

function slim(r: DetailedMatchResult): Record<string, unknown> {
  return {
    seed: r.seed,
    turns: r.turns,
    winners: r.winners,
    scores: r.scores,
    anomaly: r.anomaly,
    endReason: r.endReason,
    playerCount: r.playerCount,
    winCondition: r.winCondition,
    cappedOut: r.cappedOut,
    steps: r.steps,
    buysByCard: r.buysByCard,
    discoverOffered: r.discoverOffered,
    discoverPicked: r.discoverPicked,
    firstBuyTurn: r.firstBuyTurn,
    winnerBuys: r.winnerBuys,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const games = Math.max(1, intArg(args, 'games', 200));
  const players = Math.max(2, intArg(args, 'players', 2));
  const startSeed = intArg(args, 'seed', 1);

  const { cards, auras } = bootstrap();
  process.stdout.write(
    'jlore jlards sim — ' +
      games +
      ' games, ' +
      players +
      ' players, seeds ' +
      startSeed +
      '..' +
      (startSeed + games - 1) +
      '\n' +
      'registry: ' +
      cards.length +
      ' cards, ' +
      auras.length +
      ' auras\n\n',
  );

  const started = Date.now();
  const results = simulateManyDetailed(games, players, startSeed);
  const elapsed = Date.now() - started;
  const report = aggregate(results);
  const seats = winsBySeat(results);

  const lines: string[] = [];
  lines.push('MATCHES');
  lines.push('  played         ' + report.matches + '  in ' + (elapsed / 1000).toFixed(1) + 's');
  lines.push(
    '  turns          mean ' +
      fixed(report.meanTurns, 1) +
      '  median ' +
      fixed(report.medianTurns, 1) +
      '  min ' +
      report.minTurns +
      '  max ' +
      report.maxTurns,
  );
  lines.push('  hit turn cap   ' + report.cappedMatches + ' (' + pct(report.matches ? report.cappedMatches / report.matches : 0) + ')');
  lines.push('');

  lines.push('MATCH LENGTH');
  const histKeys = Object.keys(report.turnHistogram).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  let histMax = 0;
  for (const k of histKeys) histMax = Math.max(histMax, report.turnHistogram[k]);
  for (const k of histKeys) {
    lines.push('  ' + k.padEnd(10) + String(report.turnHistogram[k]).padStart(5) + '  ' + bar(report.turnHistogram[k], histMax, 32));
  }
  lines.push('');

  lines.push('END CONDITIONS');
  const reasons = Object.keys(report.endReasons).sort((a, b) => report.endReasons[b] - report.endReasons[a]);
  for (const r of reasons) {
    lines.push('  ' + r.padEnd(28) + String(report.endReasons[r]).padStart(5) + '  ' + pct(report.endReasons[r] / Math.max(1, report.matches)));
  }
  lines.push('');

  lines.push('SEAT WINS');
  const seatIds = Object.keys(seats).sort();
  for (const s of seatIds) {
    lines.push('  ' + s.padEnd(10) + String(seats[s]).padStart(5) + '  ' + pct(seats[s] / Math.max(1, report.matches)));
  }
  lines.push('');

  lines.push('ANOMALIES');
  for (const a of report.anomalies.slice(0, 20)) {
    lines.push(
      '  ' +
        String(a.anomaly).padEnd(28) +
        String(a.matches).padStart(5) +
        '  turns ' +
        fixed(a.meanTurns, 1).padStart(6) +
        '  seat1 ' +
        pct(a.firstSeatWinRate).padStart(6) +
        '  tie ' +
        pct(a.sharedWinRate).padStart(6),
    );
  }
  lines.push('');

  lines.push('TOP BUYS');
  for (const c of report.cards.filter((c) => c.buys > 0).slice(0, 20)) {
    lines.push(
      '  ' +
        c.name.slice(0, 30).padEnd(31) +
        String(c.buys).padStart(6) +
        '  /match ' +
        fixed(c.buysPerMatch, 2).padStart(6) +
        '  win ' +
        pct(c.winRateWhenBought).padStart(6) +
        '  1st buy t' +
        fixed(c.meanFirstBuyTurn, 1),
    );
  }
  lines.push('');

  lines.push('DEAD DISCOVER CARDS (offered, never taken)');
  if (report.deadCards.length === 0) lines.push('  none');
  for (const d of report.deadCards.slice(0, 20)) {
    lines.push(
      '  ' + d.name.slice(0, 30).padEnd(31) + 'offered ' + String(d.discoverOffered).padStart(5) + '  picked ' + String(d.discoverPicked).padStart(5),
    );
  }
  lines.push('');

  lines.push(
    'NEVER BOUGHT   ' +
      report.neverBought.length +
      ' of ' +
      report.cards.length +
      ' definitions  (' +
      pct(report.cards.length ? report.neverBought.length / report.cards.length : 0) +
      ')',
  );
  lines.push(
    'DISCOVER       ' +
      report.totalDiscoversOffered +
      ' offered, ' +
      report.totalDiscoversPicked +
      ' picked (' +
      pct(report.totalDiscoversOffered ? report.totalDiscoversPicked / report.totalDiscoversOffered : 0) +
      ')',
  );
  lines.push('TOTAL BUYS     ' + report.totalBuys);

  process.stdout.write(lines.join('\n') + '\n');

  const jsonArg = args.json;
  if (jsonArg !== undefined) {
    const rel = jsonArg === 'true' ? 'telemetry/sim-' + stamp() + '.json' : jsonArg;
    const outPath = isAbsolute(rel) ? rel : resolve(process.cwd(), rel);
    mkdirSync(dirname(outPath), { recursive: true });
    const payload = {
      games,
      players,
      startSeed,
      elapsedMs: elapsed,
      report,
      matches: results.map(slim),
    };
    writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    process.stdout.write('\nwrote ' + outPath + '\n');
  }
}

main();
