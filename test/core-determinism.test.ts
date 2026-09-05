/**
 * T1 - core rules and determinism.
 * Behaviors covered here: B117, B118, B119.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createMatch, isGameOver, legalActions, reduce } from '@engine/index';
import { getCard } from '@engine/registry';
import { costOf } from '@engine/shop/index';
import type {
  CardDefId,
  GameAction,
  GameState,
  InstanceId,
  MatchConfig,
  Pile,
  PileId,
  PlayerId,
  PlayerState,
} from '@engine/types';

// --------------------------------------------------------------------------
// inline fixtures
// --------------------------------------------------------------------------

function makeConfig(over: Partial<MatchConfig> = {}): MatchConfig {
  return {
    playerCount: 2,
    draftPileCount: 10,
    anomalyChance: 0,
    winCondition: {
      kind: 'standard',
      emptyPileFraction: 0.4,
      emptyPileAbsolute: 4,
      x: null,
    },
    pileSizeScale: 1,
    effectNodeBudget: 500,
    recursionDepth: 8,
    turnSeconds: 60,
    seedCodexWithCommons: true,
    ...over,
  };
}

const PLAYERS: { id: PlayerId; name: string; codex: CardDefId[] }[] = [
  { id: 'p1', name: 'Ada', codex: [] },
  { id: 'p2', name: 'Bo', codex: [] },
];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function newMatch(seed = 3141592): GameState {
  return createMatch(makeConfig(), PLAYERS, seed, null);
}

function P(state: GameState, id: PlayerId): PlayerState {
  const player = state.players[id];
  if (!player) throw new Error(`no such player: ${id}`);
  return player;
}

function pileOf(state: GameState, id: PileId): Pile {
  const pile = state.shop.piles[id];
  if (!pile) throw new Error(`no such pile: ${id}`);
  return pile;
}

function resourceInHand(state: GameState, id: PlayerId): InstanceId {
  for (const iid of P(state, id).hand) {
    const inst = state.instances[iid];
    if (inst && getCard(inst.defId).types.includes('Resource')) return iid;
  }
  throw new Error('no Resource card in hand');
}

function payablePile(state: GameState, buyer: PlayerId): PileId {
  const ids = [...state.shop.order.resource, ...state.shop.order.points];
  let best: { id: PileId; cost: number } | null = null;
  for (const id of ids) {
    const pile = pileOf(state, id);
    if (pile.cards.length === 0) continue;
    const cost = costOf(state, id, buyer);
    if (cost <= 0) continue;
    if (best === null || cost < best.cost) best = { id, cost };
  }
  if (!best) throw new Error('no payable pile in the resource or points shop');
  return best.id;
}

/** Deterministic scripted driver: always picks the same legal action for a given state. */
function playOut(
  start: GameState,
  steps: number,
): { final: GameState; actions: GameAction[]; snapshots: GameState[] } {
  let state = start;
  const actions: GameAction[] = [];
  const snapshots: GameState[] = [start];
  for (let i = 0; i < steps; i++) {
    if (isGameOver(state)) break;
    const seat = state.pending ? state.pending.player : state.activePlayer;
    const offered = legalActions(state, seat).filter(
      (a) => a.type !== 'concede' && a.type !== 'start',
    );
    if (offered.length === 0) break;
    const action = offered[i % offered.length]!;
    actions.push(action);
    state = reduce(state, action);
    snapshots.push(state);
  }
  return { final: state, actions, snapshots };
}

// --------------------------------------------------------------------------
// B117 - no wall clock, no unseeded randomness under src/engine
// --------------------------------------------------------------------------

const ENGINE_DIR = fileURLToPath(new URL('../src/engine/', import.meta.url));

function engineSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs|cjs|jsx)$/.test(entry.name)) out.push(full);
    }
  };
  walk(ENGINE_DIR);
  return out;
}

function offenders(needle: string): string[] {
  const bad: string[] = [];
  for (const file of engineSourceFiles()) {
    if (fs.readFileSync(file, 'utf8').includes(needle)) {
      bad.push(path.relative(ENGINE_DIR, file));
    }
  }
  return bad;
}

describe('B117 - the engine holds no clock and no unseeded randomness', () => {
  test('B117: no file under src/engine references Math.random', () => {
    expect(engineSourceFiles().length).toBeGreaterThan(0);
    expect(offenders('Math.random')).toEqual([]);
  });

  test('B117: no file under src/engine references Date.now', () => {
    expect(engineSourceFiles().length).toBeGreaterThan(0);
    expect(offenders('Date.now')).toEqual([]);
  });

  test('B117: no file under src/engine references new Date', () => {
    expect(engineSourceFiles().length).toBeGreaterThan(0);
    expect(offenders('new Date')).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// B118 - every state change is logged with a rising seq
// --------------------------------------------------------------------------

describe('B118 - every state change appends a LogEntry with a rising seq', () => {
  test('B118: playing a card appends at least one LogEntry', () => {
    const state = newMatch();
    const player = state.activePlayer;

    const next = reduce(state, { type: 'play', player, iid: resourceInHand(state, player) });

    expect(next.log.length).toBeGreaterThan(state.log.length);
  });

  test('B118: buying a card appends at least one LogEntry', () => {
    const state = clone(newMatch());
    const player = state.activePlayer;
    P(state, player).money = 50;
    const pileId = payablePile(state, player);

    const next = reduce(state, { type: 'buy', player, pileId });

    expect(next.log.length).toBeGreaterThan(state.log.length);
  });

  test('B118: ending a turn appends at least one LogEntry', () => {
    const state = newMatch();

    const next = reduce(state, { type: 'endTurn', player: state.activePlayer });

    expect(next.log.length).toBeGreaterThan(state.log.length);
  });

  test('B118: log seq values strictly increase across a run of actions', () => {
    const { final } = playOut(newMatch(), 24);

    expect(final.log.length).toBeGreaterThan(0);
    for (let i = 1; i < final.log.length; i++) {
      expect(final.log[i]!.seq).toBeGreaterThan(final.log[i - 1]!.seq);
    }
  });

  test('B118: no two log entries share a seq', () => {
    const { final } = playOut(newMatch(), 24);

    const seqs = final.log.map((entry) => entry.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  test('B118: a rejected action still appends a LogEntry', () => {
    const state = newMatch();
    const inactive = state.playerOrder.find((p) => p !== state.activePlayer)!;

    const next = reduce(state, { type: 'endTurn', player: inactive });

    expect(next.log.length).toBeGreaterThan(state.log.length);
  });

  test('B118: every log entry carries the turn it belongs to and a kind', () => {
    const { final } = playOut(newMatch(), 12);

    expect(final.log.length).toBeGreaterThan(0);
    for (const entry of final.log) {
      expect(typeof entry.kind).toBe('string');
      expect(entry.kind.length).toBeGreaterThan(0);
      expect(typeof entry.turn).toBe('number');
    }
  });
});

// --------------------------------------------------------------------------
// B119 - replay from (seed, actionLog)
// --------------------------------------------------------------------------

describe('B119 - a match replays exactly from seed and action log', () => {
  test('B119: two matches built from the same config, players and seed are identical', () => {
    expect(clone(newMatch(8080))).toEqual(clone(newMatch(8080)));
  });

  test('B119: replaying the recorded actions from createMatch reproduces the final state', () => {
    const { final, actions } = playOut(newMatch(8080), 24);
    expect(actions.length).toBeGreaterThan(3);

    let replayed = newMatch(8080);
    for (const action of actions) replayed = reduce(replayed, action);

    expect(clone(replayed)).toEqual(clone(final));
  });

  test('B119: replaying a prefix of the action log reproduces the matching intermediate state', () => {
    const { actions, snapshots } = playOut(newMatch(8080), 24);
    const cut = Math.min(5, actions.length);

    let replayed = newMatch(8080);
    for (const action of actions.slice(0, cut)) replayed = reduce(replayed, action);

    expect(clone(replayed)).toEqual(clone(snapshots[cut]!));
  });

  test('B119: the replayed state carries the same rngCursor and log as the original', () => {
    const { final, actions } = playOut(newMatch(8080), 24);

    let replayed = newMatch(8080);
    for (const action of actions) replayed = reduce(replayed, action);

    expect(replayed.rngCursor).toBe(final.rngCursor);
    expect(replayed.log.map((e) => e.seq)).toEqual(final.log.map((e) => e.seq));
  });

  test('B119: a different seed does not reproduce the same opening state', () => {
    expect(clone(newMatch(8080))).not.toEqual(clone(newMatch(9090)));
  });

  test('B119: replaying the same actions under a different seed does not reproduce the final state', () => {
    const { final, actions } = playOut(newMatch(8080), 12);

    let elsewhere = newMatch(9090);
    for (const action of actions) elsewhere = reduce(elsewhere, action);

    expect(clone(elsewhere)).not.toEqual(clone(final));
  });
});
