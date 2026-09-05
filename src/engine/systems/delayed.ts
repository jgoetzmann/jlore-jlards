/**
 * S-DELAYED — "next turn", "in N turns", "at the start of your Nth turn".
 *
 * `state.turn` counts player-turns, not rounds, so one full trip around the
 * table is `playerOrder.length` turns. Every relative schedule is converted to
 * an absolute `fireOnTurn` at schedule time, which keeps firing a pure
 * comparison and keeps replays exact.
 *
 * Careful/Reckless Investment, Preparation, Loan Shark, Biblical Greed, Moon
 * Dance, Rosemary Triscuit, Chron Job, Pocket Pouch, The Divined Cosmos,
 * Aggressive Taxation, 25th Hour and Energy Drink all route through here.
 */

import type {
  DelayedEffect,
  EffectNode,
  GameState,
  InstanceId,
  PlayerId,
} from '@engine/types';
import { resolveEffects } from '@engine/effects';
import { pushLog, withPlayer } from './internal';

/** The `when` vocabulary the effect DSL uses at authoring time. */
export type DelayWhen =
  | 'startOfNextTurn'
  | 'endOfTurn'
  | 'endOfNextTurn'
  | 'startOfTurn'
  | { inTurns: number }
  | { atTurn: number }
  | 'gameEnd';

const FAR_FUTURE = Number.MAX_SAFE_INTEGER;

/** Turns between one of a player's turns and the next: one lap of the table. */
export function turnCycle(state: GameState): number {
  const n = state.playerOrder.length;
  return n > 0 ? n : 1;
}

/**
 * Resolve an authoring-time `when` into the stored (window, absolute turn)
 * pair. The DelayedEffect record only knows three windows; the relative
 * vocabulary collapses into them plus a turn number.
 */
export function resolveSchedule(
  state: GameState,
  when: DelayWhen,
): { window: 'startOfTurn' | 'endOfTurn' | 'gameEnd'; fireOnTurn: number } {
  const cycle = turnCycle(state);

  if (when === 'startOfTurn') return { window: 'startOfTurn', fireOnTurn: state.turn };
  if (when === 'startOfNextTurn') return { window: 'startOfTurn', fireOnTurn: state.turn + cycle };
  if (when === 'endOfTurn') return { window: 'endOfTurn', fireOnTurn: state.turn };
  if (when === 'endOfNextTurn') return { window: 'endOfTurn', fireOnTurn: state.turn + cycle };
  if (when === 'gameEnd') return { window: 'gameEnd', fireOnTurn: FAR_FUTURE };

  if ('inTurns' in when) {
    const n = Math.max(0, Math.floor(when.inTurns));
    return { window: 'startOfTurn', fireOnTurn: state.turn + n * cycle };
  }

  return { window: 'startOfTurn', fireOnTurn: Math.max(0, Math.floor(when.atTurn)) };
}

/**
 * Queue effects onto a player. The id is derived from the log sequence and the
 * player's queue length, so it is stable across a replay and never collides.
 */
export function scheduleDelayed(
  state: GameState,
  player: PlayerId,
  when: DelayWhen,
  effects: EffectNode[],
  sourceIid: InstanceId | null,
): GameState {
  const p = state.players[player];
  if (!p) return state;
  if (effects.length === 0) return state;

  const { window, fireOnTurn } = resolveSchedule(state, when);
  const id = 'd_' + player + '_' + String(state.logSeq) + '_' + String(p.delayed.length);

  const entry: DelayedEffect = {
    id,
    fireOnTurn,
    when: window,
    effects: [...effects],
  };
  if (sourceIid !== null) entry.sourceIid = sourceIid;

  const next = withPlayer(state, player, (pl) => ({ ...pl, delayed: [...pl.delayed, entry] }));
  return pushLog(next, 'scheduleDelayed', player, { id, when: window, fireOnTurn, nodes: effects.length });
}

/**
 * Fire and remove every queued effect on this player whose window matches and
 * whose turn has arrived.
 *
 * Entries are removed from state *before* their effects resolve, so an effect
 * that schedules another copy of itself queues for a later turn instead of
 * being consumed by this same tick.
 */
export function tickDelayed(
  state: GameState,
  player: PlayerId,
  when: 'startOfTurn' | 'endOfTurn',
): GameState {
  const p = state.players[player];
  if (!p) return state;

  const due: DelayedEffect[] = [];
  const keep: DelayedEffect[] = [];
  for (const d of p.delayed) {
    if (d.when === when && d.fireOnTurn <= state.turn) due.push(d);
    else keep.push(d);
  }
  if (due.length === 0) return state;

  let next = withPlayer(state, player, (pl) => ({ ...pl, delayed: keep }));
  next = pushLog(next, 'delayedFired', player, { when, count: due.length });

  for (const d of due) {
    next = resolveEffects(next, d.effects, {
      player,
      sourceIid: d.sourceIid ?? null,
      depth: 0,
      multiplier: 1,
      vars: { delayedFireTurn: d.fireOnTurn },
    });
  }

  return next;
}
