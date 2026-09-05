/**
 * Balance telemetry: turns a pile of MatchResults into the numbers a designer
 * can act on.
 *
 * The balance surface here is randomized anomalies x permanent Buff/Nerf, which
 * is not analytically tractable — every number below is measured, not derived.
 * The one that matters most is the Discover offered-vs-picked ratio: a card the
 * engine offers constantly and no bot ever takes is a dead card, and nothing but
 * this report will ever tell you that.
 */

import type { AnomalyId, CardDefId, PlayerId, Rarity } from '@engine/types';
import { allCards } from '@engine/registry';
import type { MatchResult } from './run';

/** Optional extras `simulateMatchDetailed` attaches to each result. */
interface ResultExtras {
  playerCount?: number;
  winCondition?: string;
  firstBuyTurn?: Record<CardDefId, number>;
  winnerBuys?: Record<CardDefId, number>;
  cappedOut?: boolean;
}

type AnyResult = MatchResult & ResultExtras;

export interface CardBalance {
  defId: CardDefId;
  name: string;
  rarity: Rarity | 'unknown';
  /** Total purchases across every match. */
  buys: number;
  /** Matches in which at least one player bought it. */
  matchesBought: number;
  /** Matches in which a *winning* player bought it. */
  matchesWonWhenBought: number;
  /** matchesWonWhenBought / matchesBought. Null when never bought. */
  winRateWhenBought: number | null;
  /** matchesBought / matches. */
  buyRate: number;
  buysPerMatch: number;
  meanFirstBuyTurn: number | null;
  discoverOffered: number;
  discoverPicked: number;
  /** picked / offered. Null when never offered. */
  pickRate: number | null;
}

export interface AnomalyBalance {
  anomaly: AnomalyId | 'none';
  matches: number;
  share: number;
  meanTurns: number;
  /** Fraction of these matches won outright by the first seat. */
  firstSeatWinRate: number;
  /** Fraction ending in a shared win. */
  sharedWinRate: number;
  meanWinningScore: number;
}

export interface VariantLength {
  variant: string;
  matches: number;
  meanTurns: number;
  minTurns: number;
  maxTurns: number;
}

export interface DeadCard {
  defId: CardDefId;
  name: string;
  discoverOffered: number;
  discoverPicked: number;
  pickRate: number;
}

export interface BalanceReport {
  matches: number;
  meanPlayerCount: number;
  meanTurns: number;
  medianTurns: number;
  minTurns: number;
  maxTurns: number;
  /** Bucketed by tens: "1-10", "11-20", ... */
  turnHistogram: Record<string, number>;
  /** How often each end condition fired. */
  endReasons: Record<string, number>;
  /** Matches stopped by the 500-turn ceiling rather than by a rule. */
  cappedMatches: number;
  matchLengthByVariant: VariantLength[];
  anomalies: AnomalyBalance[];
  /** Sorted by total buys, descending. */
  cards: CardBalance[];
  /** Offered repeatedly and (almost) never taken. */
  deadCards: DeadCard[];
  /** Purchasable definitions no bot ever bought. */
  neverBought: CardDefId[];
  totalBuys: number;
  totalDiscoversOffered: number;
  totalDiscoversPicked: number;
}

function bump(map: Record<string, number>, key: string, by: number): void {
  map[key] = (map[key] === undefined ? 0 : map[key]) + by;
}

function get(map: Record<string, number> | undefined, key: string): number {
  if (!map) return 0;
  const v = map[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let t = 0;
  for (const x of xs) t += x;
  return t / xs.length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function bucketLabel(turns: number): string {
  const lo = Math.floor(Math.max(0, turns - 1) / 10) * 10 + 1;
  return lo + '-' + (lo + 9);
}

/** Aggregate a run of matches into one report. Pure; safe to call anywhere. */
export function aggregate(results: MatchResult[]): BalanceReport {
  const rs = results as AnyResult[];
  const matches = rs.length;

  const buys: Record<CardDefId, number> = {};
  const matchesBought: Record<CardDefId, number> = {};
  const winnerMatches: Record<CardDefId, number> = {};
  const firstBuySum: Record<CardDefId, number> = {};
  const firstBuyCount: Record<CardDefId, number> = {};
  const offered: Record<CardDefId, number> = {};
  const picked: Record<CardDefId, number> = {};
  const endReasons: Record<string, number> = {};
  const seenDefs: Record<CardDefId, boolean> = {};

  const turnsAll: number[] = [];
  const playerCounts: number[] = [];
  let cappedMatches = 0;

  const byAnomaly: Record<string, AnyResult[]> = {};
  const byVariant: Record<string, number[]> = {};

  for (const r of rs) {
    turnsAll.push(r.turns);
    playerCounts.push(r.playerCount === undefined ? 0 : r.playerCount);
    if (r.cappedOut) cappedMatches++;
    bump(endReasons, r.endReason ? r.endReason : 'unknown', 1);

    const anomKey: string = r.anomaly === null || r.anomaly === undefined ? 'none' : r.anomaly;
    if (!byAnomaly[anomKey]) byAnomaly[anomKey] = [];
    byAnomaly[anomKey].push(r);

    const variant = r.winCondition ? r.winCondition : 'standard';
    if (!byVariant[variant]) byVariant[variant] = [];
    byVariant[variant].push(r.turns);

    for (const defId of Object.keys(r.buysByCard ? r.buysByCard : {})) {
      seenDefs[defId] = true;
      const n = get(r.buysByCard, defId);
      if (n <= 0) continue;
      bump(buys, defId, n);
      bump(matchesBought, defId, 1);
      if (get(r.winnerBuys, defId) > 0) bump(winnerMatches, defId, 1);
      const fb = r.firstBuyTurn ? r.firstBuyTurn[defId] : undefined;
      if (typeof fb === 'number' && Number.isFinite(fb)) {
        bump(firstBuySum, defId, fb);
        bump(firstBuyCount, defId, 1);
      }
    }
    for (const defId of Object.keys(r.discoverOffered ? r.discoverOffered : {})) {
      seenDefs[defId] = true;
      bump(offered, defId, get(r.discoverOffered, defId));
    }
    for (const defId of Object.keys(r.discoverPicked ? r.discoverPicked : {})) {
      seenDefs[defId] = true;
      bump(picked, defId, get(r.discoverPicked, defId));
    }
  }

  // Card metadata, tolerant of a registry that has not been populated.
  const meta: Record<CardDefId, { name: string; rarity: Rarity | 'unknown'; purchasable: boolean }> = {};
  let registry: { id: CardDefId; name: string; rarity: Rarity; notPurchasable?: boolean }[] = [];
  try {
    registry = allCards();
  } catch {
    registry = [];
  }
  for (const c of registry) {
    meta[c.id] = { name: c.name, rarity: c.rarity, purchasable: !c.notPurchasable };
    seenDefs[c.id] = true;
  }

  const cards: CardBalance[] = [];
  for (const defId of Object.keys(seenDefs)) {
    const m = meta[defId];
    const b = get(buys, defId);
    const mb = get(matchesBought, defId);
    const off = get(offered, defId);
    const pick = get(picked, defId);
    const fbc = get(firstBuyCount, defId);
    cards.push({
      defId,
      name: m ? m.name : defId,
      rarity: m ? m.rarity : 'unknown',
      buys: b,
      matchesBought: mb,
      matchesWonWhenBought: get(winnerMatches, defId),
      winRateWhenBought: mb > 0 ? get(winnerMatches, defId) / mb : null,
      buyRate: matches > 0 ? mb / matches : 0,
      buysPerMatch: matches > 0 ? b / matches : 0,
      meanFirstBuyTurn: fbc > 0 ? get(firstBuySum, defId) / fbc : null,
      discoverOffered: off,
      discoverPicked: pick,
      pickRate: off > 0 ? pick / off : null,
    });
  }
  cards.sort((a, b) => (b.buys !== a.buys ? b.buys - a.buys : a.defId < b.defId ? -1 : a.defId > b.defId ? 1 : 0));

  // A card offered a meaningful number of times and essentially never taken.
  const deadCards: DeadCard[] = [];
  for (const c of cards) {
    if (c.discoverOffered < 5) continue;
    const rate = c.pickRate === null ? 0 : c.pickRate;
    if (c.discoverPicked === 0 || rate <= 0.05) {
      deadCards.push({
        defId: c.defId,
        name: c.name,
        discoverOffered: c.discoverOffered,
        discoverPicked: c.discoverPicked,
        pickRate: rate,
      });
    }
  }
  deadCards.sort((a, b) =>
    b.discoverOffered !== a.discoverOffered
      ? b.discoverOffered - a.discoverOffered
      : a.defId < b.defId
        ? -1
        : a.defId > b.defId
          ? 1
          : 0,
  );

  const neverBought: CardDefId[] = [];
  for (const c of cards) {
    const m = meta[c.defId];
    const purchasable = m ? m.purchasable : true;
    if (purchasable && c.buys === 0) neverBought.push(c.defId);
  }
  neverBought.sort();

  const anomalies: AnomalyBalance[] = [];
  for (const key of Object.keys(byAnomaly)) {
    const group = byAnomaly[key];
    let firstSeatWins = 0;
    let shared = 0;
    const winScores: number[] = [];
    for (const r of group) {
      const ws = r.winners ? r.winners : [];
      if (ws.length > 1) shared++;
      if (ws.length === 1 && ws[0] === 'p1') firstSeatWins++;
      let best = 0;
      let any = false;
      for (const w of ws) {
        const s = r.scores ? r.scores[w] : undefined;
        if (typeof s === 'number' && (!any || s > best)) {
          best = s;
          any = true;
        }
      }
      if (any) winScores.push(best);
    }
    anomalies.push({
      anomaly: key as AnomalyId | 'none',
      matches: group.length,
      share: matches > 0 ? group.length / matches : 0,
      meanTurns: mean(group.map((r) => r.turns)),
      firstSeatWinRate: group.length > 0 ? firstSeatWins / group.length : 0,
      sharedWinRate: group.length > 0 ? shared / group.length : 0,
      meanWinningScore: mean(winScores),
    });
  }
  anomalies.sort((a, b) =>
    b.matches !== a.matches ? b.matches - a.matches : a.anomaly < b.anomaly ? -1 : a.anomaly > b.anomaly ? 1 : 0,
  );

  const matchLengthByVariant: VariantLength[] = [];
  for (const key of Object.keys(byVariant)) {
    const lens = byVariant[key];
    matchLengthByVariant.push({
      variant: key,
      matches: lens.length,
      meanTurns: mean(lens),
      minTurns: lens.length > 0 ? Math.min.apply(null, lens) : 0,
      maxTurns: lens.length > 0 ? Math.max.apply(null, lens) : 0,
    });
  }
  matchLengthByVariant.sort((a, b) => (a.variant < b.variant ? -1 : a.variant > b.variant ? 1 : 0));

  const turnHistogram: Record<string, number> = {};
  for (const t of turnsAll) bump(turnHistogram, bucketLabel(t), 1);

  let totalBuys = 0;
  let totalOffered = 0;
  let totalPicked = 0;
  for (const c of cards) {
    totalBuys += c.buys;
    totalOffered += c.discoverOffered;
    totalPicked += c.discoverPicked;
  }

  return {
    matches,
    meanPlayerCount: mean(playerCounts),
    meanTurns: mean(turnsAll),
    medianTurns: median(turnsAll),
    minTurns: turnsAll.length > 0 ? Math.min.apply(null, turnsAll) : 0,
    maxTurns: turnsAll.length > 0 ? Math.max.apply(null, turnsAll) : 0,
    turnHistogram,
    endReasons,
    cappedMatches,
    matchLengthByVariant,
    anomalies,
    cards,
    deadCards,
    neverBought,
    totalBuys,
    totalDiscoversOffered: totalOffered,
    totalDiscoversPicked: totalPicked,
  };
}

/** Winners as a per-seat tally, for spotting seat advantage across a run. */
export function winsBySeat(results: MatchResult[]): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {};
  for (const r of results) {
    for (const w of r.winners ? r.winners : []) bump(out, w, 1);
  }
  return out;
}
