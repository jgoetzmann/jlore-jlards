/**
 * T2 - Expression evaluator.
 * Behavior B28.
 *
 * B28: evaluateExpr supports + - * / %, parentheses, and
 *      floor ceil round abs min max sqrt log, and throws on unknown identifiers.
 *
 * types.ts adds: "plus + - * / % and parentheses. No other syntax is legal."
 * The malformed-syntax tests below rest on that sentence; see spec-gaps-T2.md.
 */
import { describe, test, expect } from 'vitest';

import { evaluateExpr } from '@engine/expr';

// --- operators -------------------------------------------------------------

describe('B28 - arithmetic operators', () => {
  test('B28: evaluateExpr adds with +', () => {
    expect(evaluateExpr('1 + 2', {})).toBe(3);
  });

  test('B28: evaluateExpr subtracts with -', () => {
    expect(evaluateExpr('7 - 2', {})).toBe(5);
  });

  test('B28: evaluateExpr multiplies with *', () => {
    expect(evaluateExpr('3 * 4', {})).toBe(12);
  });

  test('B28: evaluateExpr divides with / and does not truncate to an integer', () => {
    expect(evaluateExpr('10 / 4', {})).toBe(2.5);
  });

  test('B28: evaluateExpr takes a remainder with %', () => {
    expect(evaluateExpr('10 % 3', {})).toBe(1);
  });

  test('B28: evaluateExpr honours * over + precedence', () => {
    expect(evaluateExpr('2 + 3 * 4', {})).toBe(14);
  });

  test('B28: parentheses override precedence', () => {
    expect(evaluateExpr('(2 + 3) * 4', {})).toBe(20);
  });

  test('B28: nested parentheses evaluate innermost first', () => {
    expect(evaluateExpr('((1 + 2) * (3 + 1)) / 2', {})).toBe(6);
  });

  test('B28: division producing a fraction feeds floor correctly', () => {
    expect(evaluateExpr('floor(10 / 4)', {})).toBe(2);
    expect(evaluateExpr('ceil(10 / 4)', {})).toBe(3);
  });
});

// --- functions -------------------------------------------------------------

describe('B28 - function library', () => {
  test('B28: floor rounds down', () => {
    expect(evaluateExpr('floor(7 / 2)', {})).toBe(3);
  });

  test('B28: ceil rounds up', () => {
    expect(evaluateExpr('ceil(7 / 2)', {})).toBe(4);
  });

  test('B28: round rounds to the nearest integer', () => {
    expect(evaluateExpr('round(2.4)', {})).toBe(2);
    expect(evaluateExpr('round(2.6)', {})).toBe(3);
  });

  test('B28: abs returns the magnitude', () => {
    expect(evaluateExpr('abs(0 - 5)', {})).toBe(5);
    expect(evaluateExpr('abs(5)', {})).toBe(5);
  });

  test('B28: min returns the smaller of two arguments', () => {
    expect(evaluateExpr('min(3, 7)', {})).toBe(3);
  });

  test('B28: max returns the larger of two arguments', () => {
    expect(evaluateExpr('max(3, 7)', {})).toBe(7);
  });

  test('B28: sqrt returns the square root', () => {
    expect(evaluateExpr('sqrt(16)', {})).toBe(4);
  });

  test('B28: log(1) is 0 in any base', () => {
    expect(evaluateExpr('log(1)', {})).toBe(0);
  });

  test('B28: functions compose with operators and variables', () => {
    expect(evaluateExpr('max(2, floor(deckSize / 3)) + 1', { deckSize: 10 })).toBe(4);
  });
});

// --- variables -------------------------------------------------------------

describe('B28 - variables supplied by the caller', () => {
  test('B28: a supplied variable resolves to its value', () => {
    expect(evaluateExpr('x + 1', { x: 4 })).toBe(5);
  });

  test('B28: several supplied variables resolve independently', () => {
    expect(evaluateExpr('deckSize - handSize', { deckSize: 10, handSize: 5 })).toBe(5);
  });

  test('B28: a supplied variable of 0 evaluates as 0, not as missing', () => {
    expect(evaluateExpr('comboCount * 5', { comboCount: 0 })).toBe(0);
  });

  test('B28: a negative supplied variable participates in arithmetic', () => {
    expect(evaluateExpr('vpLead * 2', { vpLead: -3 })).toBe(-6);
  });
});

// --- failure cases: unknown identifiers ------------------------------------

describe('B28 - unknown identifiers throw', () => {
  test('B28: evaluateExpr throws on an unknown identifier', () => {
    expect(() => evaluateExpr('bogusVar + 1', {})).toThrow();
  });

  test('B28: evaluateExpr throws on a bare unknown identifier', () => {
    expect(() => evaluateExpr('notAThing', {})).toThrow();
  });

  test('B28: evaluateExpr throws on an unknown identifier nested inside a function call', () => {
    expect(() => evaluateExpr('floor(nonsense / 2)', {})).toThrow();
  });

  test('B28: evaluateExpr throws on an unknown identifier even when other vars are supplied', () => {
    expect(() => evaluateExpr('deckSize + mystery', { deckSize: 10 })).toThrow();
  });

  test('B28: evaluateExpr throws on a function name outside the supported set', () => {
    expect(() => evaluateExpr('tan(1)', {})).toThrow();
  });

  test('B28: evaluateExpr throws on a second unsupported function name', () => {
    expect(() => evaluateExpr('pow(2, 3)', {})).toThrow();
  });

  test('B28: evaluateExpr throws rather than reaching host globals', () => {
    expect(() => evaluateExpr('Math.random()', {})).toThrow();
  });

  test('B28: evaluateExpr throws rather than evaluating a property access', () => {
    expect(() => evaluateExpr('globalThis.x', {})).toThrow();
  });

  test('B28: evaluateExpr throws on a string literal identifier', () => {
    expect(() => evaluateExpr('true + 1', {})).toThrow();
  });
});

// --- failure cases: malformed syntax ---------------------------------------

describe('B28 - malformed syntax is rejected', () => {
  test('B28: evaluateExpr throws on a trailing operator', () => {
    expect(() => evaluateExpr('1 +', {})).toThrow();
  });

  test('B28: evaluateExpr throws on a leading binary operator', () => {
    expect(() => evaluateExpr('* 3', {})).toThrow();
  });

  test('B28: evaluateExpr throws on an unbalanced opening parenthesis', () => {
    expect(() => evaluateExpr('(1 + 2', {})).toThrow();
  });

  test('B28: evaluateExpr throws on an unbalanced closing parenthesis', () => {
    expect(() => evaluateExpr('1 + 2)', {})).toThrow();
  });

  test('B28: evaluateExpr throws on the empty string', () => {
    expect(() => evaluateExpr('', {})).toThrow();
  });

  test('B28: evaluateExpr throws on whitespace only', () => {
    expect(() => evaluateExpr('   ', {})).toThrow();
  });

  test('B28: evaluateExpr throws on two numbers with no operator between them', () => {
    expect(() => evaluateExpr('2 3', {})).toThrow();
  });

  test('B28: evaluateExpr throws on an operator outside the supported set', () => {
    expect(() => evaluateExpr('2 ** 3', {})).toThrow();
  });

  test('B28: evaluateExpr throws on a bitwise operator', () => {
    expect(() => evaluateExpr('6 & 3', {})).toThrow();
  });

  test('B28: evaluateExpr throws on a comparison operator', () => {
    expect(() => evaluateExpr('2 > 1', {})).toThrow();
  });

  test('B28: evaluateExpr throws on an assignment', () => {
    expect(() => evaluateExpr('x = 5', { x: 1 })).toThrow();
  });

  test('B28: evaluateExpr throws on a dangling comma outside a function call', () => {
    expect(() => evaluateExpr('1, 2', {})).toThrow();
  });

  test('B28: evaluateExpr throws on a function call missing its closing parenthesis', () => {
    expect(() => evaluateExpr('floor(3 / 2', {})).toThrow();
  });

  test('B28: evaluateExpr throws on an empty function argument list', () => {
    expect(() => evaluateExpr('floor()', {})).toThrow();
  });

  test('B28: evaluateExpr throws on a function call written without parentheses', () => {
    expect(() => evaluateExpr('floor 3', {})).toThrow();
  });

  test('B28: evaluateExpr throws on empty parentheses', () => {
    expect(() => evaluateExpr('()', {})).toThrow();
  });

  test('B28: evaluateExpr throws on a bare operator', () => {
    expect(() => evaluateExpr('%', {})).toThrow();
  });

  test('B28: evaluateExpr throws on two division operators in a row', () => {
    expect(() => evaluateExpr('1 / / 2', {})).toThrow();
  });

  test('B28: evaluateExpr throws on a trailing comma in an argument list', () => {
    expect(() => evaluateExpr('min(1,)', {})).toThrow();
  });

  test('B28: evaluateExpr throws on an illegal character', () => {
    expect(() => evaluateExpr('$x + 1', { x: 1 })).toThrow();
  });
});
