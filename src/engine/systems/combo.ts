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
  CardDefId,
  Condition,
  EffectNode,
  GameState,
  InstanceId,
  PlayerId,
} from '@engine/types';
import { defOf, pushLog, tryGetCard, withInstance, withPlayer } from './internal';

const OFFSET_KEY = 'comboOffset';

/** Cards played this turn, after any mid-turn reset (B71). */
export function comboCount(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  if (!p) return 0;
  const offset = p.counters[OFFSET_KEY] ?? 0;
  return Math.max(0, p.playedThisTurn.length - offset);
}

/**
 * The ordinal this instance held at the moment it was played. A Combo N clause
 * asks "was the source at least the Nth card played this turn", which is a
 * question about the index at play time, not about the live count — the count
 * keeps rising while the card is still resolving.
 *
 * A card that is mid-resolution and not yet recorded reads as the next ordinal.
 */
export function comboAtPlay(state: GameState, player: PlayerId, iid: InstanceId): number {
  const p = state.players[player];
  if (!p) return 0;
  const offset = p.counters[OFFSET_KEY] ?? 0;
  const idx = p.playedThisTurn.lastIndexOf(iid);
  if (idx < 0) return Math.max(1, p.playedThisTurn.length - offset + 1);
  return Math.max(0, idx + 1 - offset);
}

/** B34: does this source satisfy `Combo n`? */
export function meetsCombo(state: GameState, player: PlayerId, iid: InstanceId | null, n: number): boolean {
  if (iid === null) return comboCount(state, player) >= n;
  return comboAtPlay(state, player, iid) >= n;
}

/** Record a play. Appends to the ordered history and refreshes the stored combo. */
export function recordPlay(state: GameState, player: PlayerId, iid: InstanceId): GameState {
  const p = state.players[player];
  if (!p) return state;
  const played = [...p.playedThisTurn, iid];
  const offset = p.counters[OFFSET_KEY] ?? 0;
  const combo = Math.max(0, played.length - offset);
  let next = withPlayer(state, player, (pl) => ({ ...pl, playedThisTurn: played, combo }));
  next = withInstance(next, iid, (inst) => ({ ...inst, playedOnTurn: next.turn }));
  return next;
}

/** Crime Wave / `{op:'resetCombo'}`: zero the count without clearing the history. */
export function resetCombo(state: GameState, player: PlayerId): GameState {
  const p = state.players[player];
  if (!p) return state;
  const next = withPlayer(state, player, (pl) => ({
    ...pl,
    combo: 0,
    counters: { ...pl.counters, [OFFSET_KEY]: pl.playedThisTurn.length },
  }));
  return pushLog(next, 'resetCombo', player, {});
}

/** Start of turn: history and offset both clear (B71). */
export function clearComboForTurn(state: GameState, player: PlayerId): GameState {
  const p = state.players[player];
  if (!p) return state;
  const counters = { ...p.counters };
  delete counters[OFFSET_KEY];
  return withPlayer(state, player, (pl) => ({
    ...pl,
    playedThisTurn: [],
    combo: 0,
    counters,
  }));
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

/** True when this instance's printed Combo clauses have been stolen away. */
export function comboClauseSuppressed(state: GameState, iid: InstanceId): boolean {
  return (state.instances[iid]?.counters.comboClauseStolen ?? 0) > 0;
}

/** Distinct definitions played this turn — several Combo payoffs count variety. */
export function distinctPlayedThisTurn(state: GameState, player: PlayerId): CardDefId[] {
  const p = state.players[player];
  if (!p) return [];
  const seen = new Set<CardDefId>();
  const out: CardDefId[] = [];
  for (const iid of p.playedThisTurn) {
    const inst = state.instances[iid];
    if (!inst || seen.has(inst.defId)) continue;
    if (!tryGetCard(inst.defId)) continue;
    seen.add(inst.defId);
    out.push(inst.defId);
  }
  return out;
}
