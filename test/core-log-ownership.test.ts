/**
 * ENGINE-1 / ENG-R1 - log entries own their contents.
 * Behaviors touched: B2 (reduce never mutates its input), B118 (the log).
 *
 * cloneState shares LogEntry objects between successive states rather than
 * deep-cloning the log on every reduce. That is only sound if no entry points at
 * anything outside itself. Before core/log.ts makeLogEntry deep-copied `detail`,
 * reorderHand stored the caller's `action.hand` array and nextCardModifier the
 * same mod object it pushed onto `nextCardMods`. So a later write to either
 * rewrote history in every state that shared the entry.
 */
import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { simConfig, simPlayers, simulateMatchDetailed } from '@sim/run';
import type { GameAction, GameState, LogEntry } from '@engine/types';

/** Every object and array reachable from `v`. */
function reachable(v: unknown, into: Set<object> = new Set()): Set<object> {
  if (v === null || typeof v !== 'object' || into.has(v)) return into;
  into.add(v);
  if (Array.isArray(v)) for (const x of v) reachable(x, into);
  else for (const k of Object.keys(v)) reachable((v as Record<string, unknown>)[k], into);
  return into;
}

/** Everything reachable from a state except through its log. */
function reachableOutsideLog(s: GameState): Set<object> {
  const { log: _log, ...rest } = s;
  return reachable(rest);
}

describe('ENG-R1: log entries never alias caller or state objects', () => {
  test('mutating a dispatched reorderHand array afterwards does not rewrite the log', () => {
    const s0 = createMatch(simConfig(2), simPlayers(2), 7);
    const player = s0.activePlayer;
    const hand = [...s0.players[player]!.hand].reverse();
    expect(hand.length).toBeGreaterThan(1);

    const s1 = reduce(s0, { type: 'reorderHand', player, hand });
    const entry = s1.log[s1.log.length - 1]!;
    expect(entry.kind).toBe('reorderHand');
    const snapshot = JSON.stringify(entry.detail);

    // A second, unrelated reduce so the entry is now shared by s1 and s2.
    const s2 = reduce(s1, { type: 'buy', player: 'nobody', pileId: 'none' } as unknown as GameAction);
    hand[0] = 'MUTATED_BY_CALLER';

    const inS2 = s2.log.find((e) => e.seq === entry.seq)!;
    expect(JSON.stringify(inS2.detail)).toBe(snapshot);
    expect(JSON.stringify(entry.detail)).toBe(snapshot);
    expect((inS2.detail as { hand: unknown }).hand).not.toBe(hand);
  });

  // Replays bot matches and, after every reduce, checks the entries that reduce
  // appended: nothing in their `detail` may be an object that is also reachable
  // from the new state, the previous state, or the dispatched action. This is the
  // runtime scan that found nextCardModifier and gameEnd aliasing state.
  test.each([
    [2, 1],
    [4, 2],
  ])('no appended entry shares an object with state or action (%ip seed %i)', (pc, seed) => {
    const { actions } = simulateMatchDetailed(seed, pc);
    let s = createMatch(simConfig(pc), simPlayers(pc), seed);
    const offenders: string[] = [];
    let checkedEntries = 0;
    // A prefix keeps this fast. Long enough to cover buys, plays, prompts and
    // several turn ends.
    for (const action of actions.slice(0, 400)) {
      if (s.ended) break;
      const prev = s;
      s = reduce(prev, action);
      const fresh: LogEntry[] = s.log.slice(prev.log.length);
      if (fresh.length === 0) continue;
      const foreign = reachableOutsideLog(s);
      for (const o of reachableOutsideLog(prev)) foreign.add(o);
      for (const o of reachable(action)) foreign.add(o);
      for (const e of fresh) {
        checkedEntries += 1;
        for (const o of reachable(e.detail)) {
          if (o !== e.detail && foreign.has(o)) offenders.push(`${e.kind} (action ${action.type})`);
        }
        if (foreign.has(e.detail)) offenders.push(`${e.kind}.detail itself (action ${action.type})`);
      }
    }
    expect(checkedEntries).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });

  test('a finished match: gameEnd winners is a copy, not state.winners', () => {
    const { actions } = simulateMatchDetailed(3, 2);
    let s = createMatch(simConfig(2), simPlayers(2), 3);
    for (const a of actions) {
      if (s.ended) break;
      s = reduce(s, a);
    }
    expect(s.ended).toBe(true);
    const end = s.log.find((e) => e.kind === 'gameEnd');
    expect(end).toBeDefined();
    const winners = (end!.detail as { winners: unknown }).winners;
    expect(winners).toEqual(s.winners);
    expect(winners).not.toBe(s.winners);
  });
});
