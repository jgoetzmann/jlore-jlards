/**
 * Amount and Condition evaluation.
 *
 * Amounts and conditions read *live* state, not the snapshot taken when the
 * node was queued (B27), so `{expr:'handSize'}` inside a repeat sees the hand
 * shrink. Loop variables carried on the context (`x`, forEach indices) win over
 * the computed values.
 */
import type { Amount, Condition, GameState, InstanceId } from '@engine/types';
import { evaluateExpr } from '@engine/expr';
import type { EffectContext } from './runtime';
import { buildVars } from './context';
import * as selectNs from './select';

const PREV_KEY = '__previousDidSomething';

export function needsCounts(expr: string): boolean {
  return expr.indexOf('count') >= 0;
}

/** The merged variable record an expression sees. */
export function evalVars(state: GameState, ctx: EffectContext, expr?: string): Record<string, number> {
  const withCounts = expr ? needsCounts(expr) : false;
  return buildVars(state, ctx.player, ctx.sourceIid, ctx.vars, withCounts);
}

export function evalAmount(state: GameState, amount: Amount, ctx: EffectContext): number {
  if (typeof amount === 'number') return Number.isFinite(amount) ? amount : 0;
  if (!amount || typeof amount !== 'object' || typeof amount.expr !== 'string') return 0;
  try {
    const v = evaluateExpr(amount.expr, evalVars(state, ctx, amount.expr));
    return Number.isFinite(v) ? v : 0;
  } catch {
    // Authoring errors are caught by the catalog validator. At the table a bad
    // expression is worth 0, never a thrown match.
    return 0;
  }
}

/** Amount rounded down to a whole card / stat count, never negative. */
export function evalCount(state: GameState, amount: Amount | undefined, ctx: EffectContext, fallback: number): number {
  if (amount === undefined) return fallback;
  const raw = evalAmount(state, amount, ctx);
  const n = Math.floor(raw);
  return n < 0 ? 0 : n;
}

/** Signed amount, floored toward zero, used for stat deltas. */
export function evalSigned(state: GameState, amount: Amount | undefined, ctx: EffectContext, fallback: number): number {
  if (amount === undefined) return fallback;
  const raw = evalAmount(state, amount, ctx);
  return raw < 0 ? Math.ceil(raw) : Math.floor(raw);
}

/**
 * Combo N: the source instance is at least the Nth card played this turn (B34).
 */
export function comboPositionOf(state: GameState, ctx: EffectContext): number {
  const p = state.players[ctx.player];
  if (!p) return 0;
  if (ctx.sourceIid) {
    const idx = p.playedThisTurn.indexOf(ctx.sourceIid);
    if (idx >= 0) return idx + 1;
  }
  return p.playedThisTurn.length;
}

export function evalCondition(state: GameState, cond: Condition, ctx: EffectContext): boolean {
  if (!cond || typeof cond !== 'object') return true;

  if (typeof cond.expr === 'string') {
    let v = 0;
    try {
      v = evaluateExpr(cond.expr, evalVars(state, ctx, cond.expr));
    } catch {
      return false;
    }
    if (v === 0) return false;
  }

  if (typeof cond.combo === 'number') {
    if (comboPositionOf(state, ctx) < cond.combo) return false;
  }

  if (cond.has) {
    const atLeast = typeof cond.has.atLeast === 'number' ? cond.has.atLeast : 1;
    const found: InstanceId[] = selectForCondition(state, cond, ctx);
    if (found.length < atLeast) return false;
  }

  if (cond.ifPrevious === true) {
    const prev = ctx.vars[PREV_KEY];
    if (!(typeof prev === 'number' && prev !== 0)) return false;
  }
  if (cond.ifPrevious === false) {
    const prev = ctx.vars[PREV_KEY];
    if (typeof prev === 'number' && prev !== 0) return false;
  }

  if (cond.not && evalCondition(state, cond.not, ctx)) return false;

  if (cond.all) {
    for (const c of cond.all) if (!evalCondition(state, c, ctx)) return false;
  }

  if (cond.any && cond.any.length > 0) {
    let ok = false;
    for (const c of cond.any) {
      if (evalCondition(state, c, ctx)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }

  return true;
}

// Called only at resolution time, which keeps the select <-> evaluate module
// cycle resolvable at init.
function selectForCondition(state: GameState, cond: Condition, ctx: EffectContext): InstanceId[] {
  if (!cond.has) return [];
  return selectNs.selectInstancesWith(state, cond.has.target, ctx, null);
}

export const PREVIOUS_DID_SOMETHING = PREV_KEY;
