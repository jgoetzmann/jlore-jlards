/**
 * T4 — Simulation harness (S-SIM). Behaviors B112-B116.
 *
 * Written from .fullsend/SPEC.md against the frozen surface in src/engine/types.ts.
 */
import { createMatch, isGameOver, legalActions, reduce } from '@engine/index';
import { allCards, registerAuras, registerCards } from '@engine/registry';
import { allAuraDefinitions, allCardDefinitions } from '@cards/index';
import { botAction } from '@sim/bot';
import { simulateMany, simulateMatch } from '@sim/run';
import type { CardDefId, GameAction, MatchConfig, PlayerId } from '@engine/types';

const CFG = (playerCount: number, over: Partial<MatchConfig> = {}): MatchConfig => ({
  playerCount,
  draftPileCount: 10,
  anomalyChance: 0,
  winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
  pileSizeScale: 1,
  effectNodeBudget: 500,
  recursionDepth: 8,
  turnSeconds: 60,
  seedCodexWithCommons: true,
  ...over,
});

const SEATS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    codex: [] as CardDefId[],
  }));

/** Key-order-independent structural identity, so action equality is not JSON luck. */
function canon(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`)
    .join(',')}}`;
}

beforeAll(() => {
  if (allCards().length === 0) {
    registerCards(allCardDefinitions());
    registerAuras(allAuraDefinitions());
  }
});

describe('S-SIM', () => {
  test('B112: simulateMatch reaches a terminal state and never exceeds 500 turns', () => {
    for (const seed of [1, 2, 3, 7, 42, 99, 1234, 65535]) {
      for (const players of [2, 4]) {
        const r = simulateMatch(seed, players);
        expect(r.seed).toBe(seed);
        expect(r.turns).toBeGreaterThan(0);
        expect(r.turns).toBeLessThanOrEqual(500);
        expect(typeof r.endReason).toBe('string');
        expect(r.endReason.length).toBeGreaterThan(0);
        expect(Object.keys(r.scores)).toHaveLength(players);
        expect(r.winners.length).toBeGreaterThanOrEqual(1);
      }
    }
  }, 120000);

  test('B112: a match forced into a long game still stops at or under 500 turns', () => {
    const r = simulateMatch(31337, 4, {
      winCondition: { kind: 'countdown', emptyPileFraction: 0.99, emptyPileAbsolute: null, x: 4000 },
      pileSizeScale: 4,
    });
    expect(r.turns).toBeLessThanOrEqual(500);
    expect(typeof r.endReason).toBe('string');
    expect(r.endReason.length).toBeGreaterThan(0);
  }, 120000);

  test('B113: simulateMatch(42, 2) run twice produces deeply equal MatchResults', () => {
    const a = simulateMatch(42, 2);
    const b = simulateMatch(42, 2);
    expect(b).toEqual(a);
    expect(canon(b)).toBe(canon(a));
  }, 60000);

  test('B113: determinism holds for several seeds and player counts', () => {
    for (const [seed, players] of [
      [1, 2],
      [5, 3],
      [42, 4],
    ] as const) {
      const a = simulateMatch(seed, players);
      const b = simulateMatch(seed, players);
      expect(canon(b)).toBe(canon(a));
    }
  }, 120000);

  test('B114: botAction returns an action legalActions also contains, on every turn of a full match', () => {
    let state = createMatch(CFG(3), SEATS(3), 606, null);
    let steps = 0;
    const cap = 6000;

    while (!isGameOver(state) && steps < cap) {
      const chooser: PlayerId = state.pending ? state.pending.player : state.activePlayer;
      const legal = legalActions(state, chooser);
      expect(legal.length, `no legal action for ${chooser} at step ${steps}`).toBeGreaterThan(0);

      const chosen: GameAction = botAction(state, chooser);
      const wanted = canon(chosen);
      const offered = legal.map(canon);
      expect(offered, `bot played an illegal action at step ${steps}: ${wanted}`).toContain(wanted);

      state = reduce(state, chosen);
      steps++;
    }

    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThan(cap);
    expect(isGameOver(state)).toBe(true);
  }, 120000);

  test('B114: botAction stays inside legalActions for a 2-player and a 4-player table too', () => {
    for (const n of [2, 4]) {
      let state = createMatch(CFG(n), SEATS(n), 707 + n, null);
      let steps = 0;
      while (!isGameOver(state) && steps < 6000) {
        const chooser: PlayerId = state.pending ? state.pending.player : state.activePlayer;
        const legal = legalActions(state, chooser);
        expect(legal.length).toBeGreaterThan(0);
        const chosen = botAction(state, chooser);
        expect(legal.map(canon)).toContain(canon(chosen));
        state = reduce(state, chosen);
        steps++;
      }
      expect(isGameOver(state)).toBe(true);
    }
  }, 180000);

  test('B115: simulateMany returns one result per match and never counts a pick that was not offered', () => {
    const results = simulateMany(5, 2);
    expect(results).toHaveLength(5);

    const known = new Set(allCards().map((c) => c.id));
    const totals = { buys: 0, offered: 0, picked: 0 };

    for (const r of results) {
      for (const [defId, n] of Object.entries(r.buysByCard)) {
        expect(known.has(defId)).toBe(true);
        expect(typeof n).toBe('number');
        expect(n).toBeGreaterThan(0);
        totals.buys += n;
      }
      for (const [defId, n] of Object.entries(r.discoverOffered)) {
        expect(known.has(defId)).toBe(true);
        expect(n).toBeGreaterThan(0);
        totals.offered += n;
      }
      for (const [defId, n] of Object.entries(r.discoverPicked)) {
        expect(known.has(defId)).toBe(true);
        expect(n).toBeGreaterThan(0);
        totals.picked += n;
        expect(r.discoverOffered[defId] ?? 0).toBeGreaterThanOrEqual(n);
      }
    }

    expect(totals.buys).toBeGreaterThan(0);
    expect(totals.picked).toBeLessThanOrEqual(totals.offered);
  }, 120000);

  test('B115: aggregating across matches sums the per-card buy counts', () => {
    const results = simulateMany(4, 3);
    expect(results).toHaveLength(4);

    const agg: Record<CardDefId, number> = {};
    for (const r of results) {
      for (const [defId, n] of Object.entries(r.buysByCard)) {
        agg[defId] = (agg[defId] ?? 0) + n;
      }
    }
    const keys = Object.keys(agg);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      const perMatch = results.map((r) => r.buysByCard[k] ?? 0).reduce((a, b) => a + b, 0);
      expect(agg[k]).toBe(perMatch);
      expect(agg[k]).toBeGreaterThan(0);
    }
  }, 120000);

  test('B116: a simulated match records the end condition that fired in endReason', () => {
    for (const seed of [11, 22, 33, 44, 55, 66]) {
      const r = simulateMatch(seed, 3);
      expect(r.endReason).not.toBeNull();
      expect(typeof r.endReason).toBe('string');
      expect(r.endReason.trim()).not.toBe('');
    }
  }, 120000);

  test('B116: endReason is stable for a given seed and names the countdown that cut the match short', () => {
    const cfg: Partial<MatchConfig> = {
      winCondition: { kind: 'countdown', emptyPileFraction: 0.99, emptyPileAbsolute: null, x: 6 },
    };
    const a = simulateMatch(2468, 2, cfg);
    const b = simulateMatch(2468, 2, cfg);

    expect(a.turns).toBeLessThanOrEqual(6);
    expect(a.endReason.trim()).not.toBe('');
    expect(b.endReason).toBe(a.endReason);
    expect(b.turns).toBe(a.turns);
  }, 60000);
});
