/**
 * B28 / B119 across browsers: an expression gives the same number in every
 * JavaScript engine.
 *
 * Lockstep has every client run reduce itself, so two browsers that disagree
 * on one expression desync the match. ECMAScript pins the basic operators and
 * sqrt/floor/ceil/round/abs/min/max to exact IEEE-754 results but leaves the
 * library logarithm implementation-approximated (V8 gives
 * floor(ln(1000) / ln(10)) === 2 by one ulp). expr.ts therefore computes `log`
 * from basic arithmetic and snaps it to 1e-9.
 *
 *   D1  exact logarithms land on their integers, so floor/ceil see the obvious value
 *   D2  log still agrees with the true logarithm (to the 1e-9 snap)
 *   D3  golden values: the exact output bits are pinned, so any engine that ran
 *       this file would have to produce the same literals
 *   D4  nothing the evaluator exposes reaches an implementation-approximated
 *       Math function (static check of expr.ts)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { evaluateExpr } from '@engine/expr';

describe('B28 - expressions are engine-independent', () => {
  test('D1: floor(log(1000, 10)) is 3, not 2', () => {
    expect(evaluateExpr('floor(log(1000, 10))', {})).toBe(3);
    expect(evaluateExpr('log(1000, 10)', {})).toBe(3);
  });

  test('D1: exact powers give exact integers in any base', () => {
    for (const [x, b, want] of [
      [8, 2, 3],
      [1024, 2, 10],
      [81, 3, 4],
      [1e6, 10, 6],
      [125, 5, 3],
      [1 / 8, 2, -3],
      [2 ** 52, 2, 52],
      [7, 7, 1],
    ] as const) {
      expect(evaluateExpr(`log(${x}, ${b})`, {})).toBe(want);
      expect(evaluateExpr(`floor(log(${x}, ${b}))`, {})).toBe(want);
      expect(evaluateExpr(`ceil(log(${x}, ${b}))`, {})).toBe(want);
    }
  });

  test('D1: log of a variable-driven count floors the way a card author expects', () => {
    // e.g. "floor(log(uniqueCardsInDeck, 2))" at exactly 16 unique cards.
    expect(evaluateExpr('floor(log(x, 2))', { x: 16 })).toBe(4);
    expect(evaluateExpr('floor(log(x, 2))', { x: 15 })).toBe(3);
  });

  test('D2: log agrees with the true natural logarithm to the snap precision', () => {
    const xs = [1e-300, 1e-9, 0.001, 0.3, 0.5, 0.9, 1.0001, 1.5, 2, Math.E, 3, 7, 10, 42, 99.5, 1e3, 12345.678, 1e15, 1e300];
    for (const x of xs) {
      const got = evaluateExpr(`log(${x})`, {});
      expect(Math.abs(got - Math.log(x))).toBeLessThanOrEqual(1e-9);
    }
  });

  test('D2: edge cases stay finite and never NaN', () => {
    expect(evaluateExpr('log(1)', {})).toBe(0);
    expect(evaluateExpr('log(0)', {})).toBe(0);
    expect(evaluateExpr('log(-4)', {})).toBe(0);
    expect(evaluateExpr('log(5, 1)', {})).toBe(0);
    expect(evaluateExpr('log(5, 0)', {})).toBe(0);
    expect(Object.is(evaluateExpr('log(1, 10)', {}), 0)).toBe(true);
  });

  test('D3: golden values (the exact doubles every engine must produce)', () => {
    // Computed once, by the arithmetic-only implementation. A change here means
    // the implementation changed, and old replays may not reproduce.
    const golden: [string, number][] = GOLDEN;
    for (const [expr, want] of golden) {
      expect(Object.is(evaluateExpr(expr, {}), want)).toBe(true);
    }
  });

  test('D4: expr.ts calls no implementation-approximated Math function', () => {
    const src = readFileSync(resolve(__dirname, '../src/engine/expr.ts'), 'utf8');
    const approximated = [
      'log', 'log2', 'log10', 'log1p', 'exp', 'expm1', 'pow', 'cbrt', 'hypot',
      'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
      'asinh', 'acosh', 'atanh',
    ];
    for (const fn of approximated) {
      expect(src.includes(`Math.${fn}(`), `Math.${fn}( in expr.ts`).toBe(false);
    }
    expect(/\*\*/.test(src.replace(/\/\*\*[\s\S]*?\*\//g, ''))).toBe(false);
  });
});

const GOLDEN: [string, number][] = [
  ['log(2)', 0.693147181],
  ['log(10)', 2.302585093],
  ['log(3)', 1.098612289],
  ['log(0.5)', -0.693147181],
  ['log(7.25)', 1.981001469],
  ['log(1000)', 6.907755279],
  ['log(123456789)', 18.631401766],
  ['log(0.001)', -6.907755279],
  ['log(10, 3)', 2.095903274],
  ['log(100, 7)', 2.366589325],
  ['log(2, 10)', 0.301029996],
  ['log(999, 10)', 2.999565488],
  ['log(1001, 10)', 3.000434077],
  // Exactly-rounded operations, pinned for completeness.
  ['sqrt(2)', 1.4142135623730951],
  ['sqrt(17) * 3 / 7', 1.7670452681218545],
  ['10 % 3.3', 0.10000000000000053],
  ['1 / 3 + 2 / 7', 0.6190476190476191],
];
