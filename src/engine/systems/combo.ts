/**
 * S-COMBO — the per-turn played-card counter (B71, B34).
 *
 * The live count is derived from `player.playedThisTurn.length` minus an
 * offset, so a mid-turn reset (Crime Wave, `{op:'resetCombo'}`) can zero the
 * count without destroying the ordered play history that Combo N clauses and
 * `replayPlayedThisTurn` both read.
 *
 * `player.combo` is kept in sync with the derived value so anything reading the
 * stored field agrees with anything calling `comboCount`.
 */

import type {
  Condition,
  EffectNode,
  GameState,
  InstanceId,
  PlayerId,
} from '@engine/types';
import { defOf, pushLog, withInstance, withPlayer } from './internal';

/** Cards already played when the counter was last zeroed mid-turn. */
export const COMBO_OFFSET_KEY = 'comboOffset';
/** The turn that offset belongs to. A stale offset from an older turn is ignored. */
export const COMBO_OFFSET_TURN_KEY = 'comboOffsetTurn';

const OFFSET_KEY = COMBO_OFFSET_KEY;

/**
 * The live reset offset, or 0 when the stored one belongs to an earlier turn.
 * Turn cleanup empties `playedThisTurn` but does not touch player counters, so
 * the offset carries its own turn stamp rather than relying on being wiped.
 */
export function comboOffsetOf(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  if (!p) return 0;
  const stamp = p.counters[COMBO_OFFSET_TURN_KEY];
  if (typeof stamp === 'number' && stamp !== state.turn) return 0;
  const offset = p.counters[OFFSET_KEY] ?? 0;
  return offset > 0 ? offset : 0;
}

/** Cards played this turn, after any mid-turn reset (B71). */
export function comboCount(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  if (!p) return 0;
  return Math.max(0, p.playedThisTurn.length - comboOffsetOf(state, player));
}

/** Crime Wave / `{op:'resetCombo'}`: zero the count without clearing the history. */
export function resetCombo(state: GameState, player: PlayerId): GameState {
  const p = state.players[player];
  if (!p) return state;
  const next = withPlayer(state, player, (pl) => ({
    ...pl,
    combo: 0,
    counters: {
      ...pl.counters,
      [OFFSET_KEY]: pl.playedThisTurn.length,
      [COMBO_OFFSET_TURN_KEY]: state.turn,
    },
  }));
  return pushLog(next, 'resetCombo', player, {});
}

/**
 * The same reset, written straight onto a draft the interpreter is mutating
 * (SPEC.md A5). `{op:'resetCombo'}` runs inside `resolveEffects`, which owns a
 * draft and discards returned states, so it needs the in-place form.
 */
export function resetComboInPlace(state: GameState, player: PlayerId): boolean {
  const p = state.players[player];
  if (!p) return false;
  p.combo = 0;
  p.counters[OFFSET_KEY] = p.playedThisTurn.length;
  p.counters[COMBO_OFFSET_TURN_KEY] = state.turn;
  return true;
}

/** Every `{op:'conditional', if:{combo:N}}` node reachable from a card. */
export function comboClausesOf(state: GameState, iid: InstanceId): EffectNode[] {
  const inst = state.instances[iid];
  if (!inst) return [];
  const def = defOf(state, iid);
  const nodes: EffectNode[] = [
    ...(def ? def.effects : []),
    ...inst.extraEffects,
  ];
  const found: EffectNode[] = [];
  collectComboNodes(nodes, found);
  if (def) {
    for (const trg of def.triggers) collectComboNodes(trg.effects, found);
  }
  return found;
}

function collectComboNodes(nodes: readonly EffectNode[], out: EffectNode[]): void {
  for (const node of nodes) {
    if (node.op === 'conditional') {
      if (conditionMentionsCombo(node.if)) {
        out.push(node);
        continue;
      }
      collectComboNodes(node.then, out);
      if (node.else) collectComboNodes(node.else, out);
      continue;
    }
    if (node.op === 'sequence') collectComboNodes(node.effects, out);
    else if (node.op === 'repeat') collectComboNodes(node.effects, out);
    else if (node.op === 'forEach') collectComboNodes(node.effects, out);
    else if (node.op === 'random') {
      for (const branch of node.branches) collectComboNodes(branch.effects, out);
    } else if (node.op === 'discover') collectComboNodes(node.then, out);
    else if (node.op === 'selectCards') collectComboNodes(node.then, out);
    else if (node.op === 'choose') {
      for (const opt of node.options) collectComboNodes(opt.effects, out);
    } else if (node.op === 'delayed') collectComboNodes(node.effects, out);
  }
}

function conditionMentionsCombo(cond: Condition): boolean {
  if (cond.combo !== undefined) return true;
  if (cond.not && conditionMentionsCombo(cond.not)) return true;
  if (cond.all && cond.all.some(conditionMentionsCombo)) return true;
  if (cond.any && cond.any.some(conditionMentionsCombo)) return true;
  return false;
}

/**
 * Wombo Combo: permanently steal another card's Combo clause. The clause is
 * copied onto the thief instance's `extraEffects`, where it survives zone
 * changes and shuffles like every other per-instance state (B63), and is
 * removed from the victim instance so it is genuinely stolen rather than shared.
 */
export function stealComboClause(
  state: GameState,
  thief: InstanceId,
  victim: InstanceId,
): GameState {
  if (!state.instances[thief] || !state.instances[victim]) return state;
  const clauses = comboClausesOf(state, victim);
  if (clauses.length === 0) return state;

  let next = withInstance(state, thief, (inst) => ({
    ...inst,
    extraEffects: [...inst.extraEffects, ...clauses],
  }));

  // Suppress the clause on the victim: anything the victim had absorbed goes,
  // and printed clauses are shadowed by a per-instance suppression counter that
  // the interpreter honours when it walks def.effects.
  next = withInstance(next, victim, (inst) => ({
    ...inst,
    extraEffects: inst.extraEffects.filter((n) => !clauses.includes(n)),
    counters: { ...inst.counters, comboClauseStolen: (inst.counters.comboClauseStolen ?? 0) + 1 },
  }));

  return pushLog(next, 'stealComboClause', state.instances[thief].owner, {
    thief,
    victim,
    clauses: clauses.length,
  });
}
