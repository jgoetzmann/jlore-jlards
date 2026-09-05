/**
 * T1 - core rules and determinism.
 * Behaviors covered here: B1, B2, B3.
 *
 * Written from `.fullsend/SPEC.md` alone. Fixtures are inline on purpose.
 */
import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { getCard } from '@engine/registry';
import type {
  CardDefId,
  GameAction,
  GameState,
  MatchConfig,
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

function makePlayers(count: number): { id: PlayerId; name: string; codex: CardDefId[] }[] {
  const names = ['Ada', 'Bo', 'Cyd', 'Dot', 'Eve', 'Fen'];
  const out: { id: PlayerId; name: string; codex: CardDefId[] }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ id: `p${i + 1}`, name: names[i] ?? `P${i + 1}`, codex: [] });
  }
  return out;
}

function newMatch(playerCount = 2, seed = 424242): GameState {
  return createMatch(
    makeConfig({ playerCount }),
    makePlayers(playerCount),
    seed,
    null,
  );
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function withoutLog(state: GameState): Record<string, unknown> {
  const copy = clone(state) as unknown as Record<string, unknown>;
  delete copy.log;
  delete copy.logSeq;
  return copy;
}

function P(state: GameState, id: PlayerId): PlayerState {
  const player = state.players[id];
  if (!player) throw new Error(`no such player: ${id}`);
  return player;
}

function deckOf(state: GameState, id: PlayerId): string[] {
  const p = P(state, id);
  return [...p.library, ...p.hand, ...p.gy, ...p.play];
}

function nameOf(state: GameState, iid: string): string {
  const inst = state.instances[iid];
  if (!inst) throw new Error(`no such instance: ${iid}`);
  return getCard(inst.defId).name;
}

function countNames(state: GameState, iids: string[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const iid of iids) {
    const name = nameOf(state, iid);
    tally[name] = (tally[name] ?? 0) + 1;
  }
  return tally;
}

function otherPlayer(state: GameState, id: PlayerId): PlayerId {
  const other = state.playerOrder.find((p) => p !== id);
  if (!other) throw new Error('match has only one player');
  return other;
}

function endTurnBy(state: GameState): GameState {
  const action: GameAction = { type: 'endTurn', player: state.activePlayer };
  return reduce(state, action);
}

// --------------------------------------------------------------------------
// B1 - opening deal
// --------------------------------------------------------------------------

describe('B1 - a new match deals 7 Copper + 3 Tix and a 5-card opening hand', () => {
  test('B1: every player in a 2-player match owns exactly 7 Copper and 3 Tix', () => {
    const state = newMatch(2);
    for (const id of state.playerOrder) {
      const deck = deckOf(state, id);
      expect(deck).toHaveLength(10);
      expect(countNames(state, deck)).toEqual({ Copper: 7, Tix: 3 });
    }
  });

  test('B1: every player in a 4-player match owns exactly 7 Copper and 3 Tix', () => {
    const state = newMatch(4);
    expect(state.playerOrder).toHaveLength(4);
    for (const id of state.playerOrder) {
      expect(countNames(state, deckOf(state, id))).toEqual({ Copper: 7, Tix: 3 });
    }
  });

  test('B1: every player opens with a 5-card hand and the other 5 cards in the library', () => {
    const state = newMatch(3);
    for (const id of state.playerOrder) {
      const p = P(state, id);
      expect(p.hand).toHaveLength(5);
      expect(p.library).toHaveLength(5);
    }
  });

  test('B1: no player opens with cards in the GY, in play, or in the field', () => {
    const state = newMatch(3);
    for (const id of state.playerOrder) {
      const p = P(state, id);
      expect(p.gy).toEqual([]);
      expect(p.play).toEqual([]);
      expect(p.field).toEqual([]);
      expect(p.playedThisTurn).toEqual([]);
    }
  });

  test('B1: no opening instance is owned by two players and no opening card is anything but Copper or Tix', () => {
    const state = newMatch(3);
    const seen = new Set<string>();
    for (const id of state.playerOrder) {
      for (const iid of deckOf(state, id)) {
        expect(seen.has(iid)).toBe(false);
        seen.add(iid);
        expect(state.instances[iid]?.owner).toBe(id);
        expect(['Copper', 'Tix']).toContain(nameOf(state, iid));
      }
    }
    expect(seen.size).toBe(30);
  });

  test('B1: no player opens with money, or with more than one Action or Buy', () => {
    const state = newMatch(3);
    for (const id of state.playerOrder) {
      const p = P(state, id);
      expect(p.money).toBe(0);
      expect(p.actions).toBeLessThanOrEqual(1);
      expect(p.buys).toBeLessThanOrEqual(1);
    }
  });
});

// --------------------------------------------------------------------------
// B2 - reduce is pure
// --------------------------------------------------------------------------

describe('B2 - reduce is pure', () => {
  test('B2: reduce called twice on the same (state, action) returns deeply equal states', () => {
    const state = newMatch(2);
    const action: GameAction = { type: 'endTurn', player: state.activePlayer };
    const first = reduce(state, action);
    const second = reduce(state, action);
    expect(clone(second)).toEqual(clone(first));
  });

  test('B2: reduce does not mutate the state it is given', () => {
    const state = newMatch(2);
    const before = clone(state);
    reduce(state, { type: 'endTurn', player: state.activePlayer });
    expect(clone(state)).toEqual(before);
  });

  test('B2: a rejected action does not mutate the state it is given', () => {
    const state = newMatch(2);
    const inactive = otherPlayer(state, state.activePlayer);
    const before = clone(state);
    reduce(state, { type: 'endTurn', player: inactive });
    expect(clone(state)).toEqual(before);
  });

  test('B2: reduce returns a new state object for an action that changes the game', () => {
    const state = newMatch(2);
    const next = reduce(state, { type: 'endTurn', player: state.activePlayer });
    expect(next).not.toBe(state);
    expect(next.players).not.toBe(state.players);
  });

  test('B2: replaying the same action from a shared starting state twice does not compound', () => {
    const state = newMatch(2);
    const action: GameAction = { type: 'endTurn', player: state.activePlayer };
    const once = reduce(state, action);
    reduce(state, action);
    const again = reduce(state, action);
    expect(clone(again)).toEqual(clone(once));
  });
});

// --------------------------------------------------------------------------
// B3 - start-of-turn reset
// --------------------------------------------------------------------------

describe('B3 - start of turn resets Actions, Buys and Money', () => {
  test('B3: the incoming player begins their turn with 1 Action, 1 Buy and 0 Money', () => {
    let state = newMatch(2);
    const first = state.activePlayer;
    const second = otherPlayer(state, first);

    state = clone(state);
    P(state, second).money = 9;
    P(state, second).buys = 0;
    P(state, second).actions = 0;

    state = endTurnBy(state);

    expect(state.activePlayer).toBe(second);
    expect(P(state, second).actions).toBe(1);
    expect(P(state, second).buys).toBe(1);
    expect(P(state, second).money).toBe(0);
  });

  test('B3: money held at the end of a turn does not carry into the next turn of that player', () => {
    let state = newMatch(2);
    const first = state.activePlayer;

    state = clone(state);
    P(state, first).money = 7;

    state = endTurnBy(state);
    state = endTurnBy(state);

    expect(state.activePlayer).toBe(first);
    expect(P(state, first).money).toBe(0);
  });

  test('B3: spent Actions and Buys are restored to 1 when the player comes around again', () => {
    let state = newMatch(2);
    const first = state.activePlayer;

    state = clone(state);
    P(state, first).actions = 0;
    P(state, first).buys = 0;

    state = endTurnBy(state);
    state = endTurnBy(state);

    expect(state.activePlayer).toBe(first);
    expect(P(state, first).actions).toBe(1);
    expect(P(state, first).buys).toBe(1);
  });

  test('B3: the reset touches only the incoming player stats, not their GY or hand', () => {
    let state = newMatch(2);
    const first = state.activePlayer;

    state = endTurnBy(state);
    const gyAfterFirstTurn = [...P(state, first).gy];
    const handAfterFirstTurn = [...P(state, first).hand];
    expect(gyAfterFirstTurn.length).toBeGreaterThan(0);

    state = endTurnBy(state);

    expect(state.activePlayer).toBe(first);
    expect(P(state, first).gy).toEqual(gyAfterFirstTurn);
    expect(P(state, first).hand).toEqual(handAfterFirstTurn);
  });

  test('B3: the reset does not raise Actions or Buys above 1 for a player who spent nothing', () => {
    let state = newMatch(2);
    const first = state.activePlayer;
    const second = otherPlayer(state, first);

    state = endTurnBy(state);
    state = endTurnBy(state);

    expect(P(state, first).actions).toBe(1);
    expect(P(state, first).buys).toBe(1);
    expect(P(state, second).actions).toBeLessThanOrEqual(1);
    expect(P(state, second).buys).toBeLessThanOrEqual(1);
  });

  test('B3: an out-of-turn endTurn does not reset the stats of any player', () => {
    let state = newMatch(2);
    const first = state.activePlayer;
    const second = otherPlayer(state, first);

    state = clone(state);
    P(state, second).money = 4;
    P(state, second).actions = 0;

    const rejected = reduce(state, { type: 'endTurn', player: second });

    expect(withoutLog(rejected)).toEqual(withoutLog(state));
    expect(P(rejected, second).money).toBe(4);
    expect(P(rejected, second).actions).toBe(0);
  });
});
