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

// ---------------------------------------------------------------------------
// Comparison operators (SPEC.md Addendum A1)
// ---------------------------------------------------------------------------

interface Comparison {
  index: number;
  op: string;
}

/** The last top-level comparison operator in `src`, or null when there is none. */
function findComparison(src: string): Comparison | null {
  let depth = 0;
  let found: Comparison | null = null;
  for (let i = 0; i < src.length; i += 1) {
    const c = src.charAt(i);
    if (c === '(') {
      depth += 1;
      continue;
    }
    if (c === ')') {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    const two = src.slice(i, i + 2);
    if (two === '>=' || two === '<=' || two === '==' || two === '!=') {
      found = { index: i, op: two };
      i += 1;
      continue;
    }
    if (c === '>' || c === '<') found = { index: i, op: c };
  }
  return found;
}

/** True when the whole string is one redundant parenthesised group. */
function isWrapped(src: string): boolean {
  const t = src.trim();
  if (t.length < 2 || t.charAt(0) !== '(' || t.charAt(t.length - 1) !== ')') return false;
  let depth = 0;
  for (let i = 0; i < t.length; i += 1) {
    const c = t.charAt(i);
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i === t.length - 1;
    }
  }
  return false;
}

function compare(op: string, a: number, b: number): number {
  if (op === '>') return a > b ? 1 : 0;
  if (op === '<') return a < b ? 1 : 0;
  if (op === '>=') return a >= b ? 1 : 0;
  if (op === '<=') return a <= b ? 1 : 0;
  if (op === '==') return a === b ? 1 : 0;
  return a !== b ? 1 : 0;
}

/**
 * `evaluateExpr` plus A1's comparison operators. Everything without a
 * comparison goes straight through to the shared evaluator untouched.
 */
export function evalExprValue(expr: string, vars: Record<string, number>): number {
  const found = findComparison(expr);
  if (!found) {
    if (isWrapped(expr)) {
      const inner = expr.trim().slice(1, -1);
      if (findComparison(inner)) return evalExprValue(inner, vars);
    }
    return evaluateExpr(expr, vars);
  }
  const left = expr.slice(0, found.index);
  const right = expr.slice(found.index + found.op.length);
  if (left.trim() === '' || right.trim() === '') {
    throw new Error('comparison is missing an operand: ' + expr);
  }
  return compare(found.op, evalExprValue(left, vars), evalExprValue(right, vars));
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
    const v = evalExprValue(amount.expr, evalVars(state, ctx, amount.expr));
    return Number.isFinite(v) ? v : 0;
  } catch {
    // Authoring errors are caught by the catalog validator. At the table a bad
    // expression is worth 0, never a thrown match.
    return 0;
  }
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
      v = evalExprValue(cond.expr, evalVars(state, ctx, cond.expr));
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
