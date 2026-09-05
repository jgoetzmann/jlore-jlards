/**
 * Recursive-descent expression evaluator for the effect DSL. (B28)
 *
 * Grammar:
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/' | '%') unary)*
 *   unary   := ('-' | '+') unary | primary
 *   primary := number | '(' expr ')' | ident | ident '(' args ')'
 *
 * Recognised functions: floor ceil round abs min max sqrt log
 * Plus the two count forms, which read pre-computed values out of `vars`:
 *   count(<name>)            -> vars['count:<name>']
 *   countIn(<zone>, <name>)  -> vars['countIn:<zone>:<name>']
 *
 * No eval. No Function. No dynamic property access on anything but the caller's
 * own `vars` record. Unknown identifiers throw: that is an authoring error and
 * it is caught by the catalog validator, never at the table.
 */
import { EXPR_VARS } from '@engine/types';

const VAR_SET: ReadonlySet<string> = new Set<string>(EXPR_VARS as readonly string[]);

const ARITY_1 = new Set(['floor', 'ceil', 'round', 'abs', 'sqrt']);
const ARITY_N = new Set(['min', 'max']);

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExprError';
  }
}

type TokKind = 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma';

interface Tok {
  k: TokKind;
  s: string;
  n: number;
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function isIdentPart(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}

export function tokenizeExpr(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(src.charAt(i + 1)))) {
      let j = i;
      let seenDot = false;
      while (j < src.length) {
        const d = src.charAt(j);
        if (isDigit(d)) {
          j += 1;
        } else if (d === '.' && !seenDot) {
          seenDot = true;
          j += 1;
        } else {
          break;
        }
      }
      const text = src.slice(i, j);
      const value = Number(text);
      if (!Number.isFinite(value)) throw new ExprError('bad number literal: ' + text);
      out.push({ k: 'num', s: text, n: value });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i;
      while (j < src.length && isIdentPart(src.charAt(j))) j += 1;
      out.push({ k: 'ident', s: src.slice(i, j), n: 0 });
      i = j;
      continue;
    }
    if (c === '(') {
      out.push({ k: 'lparen', s: c, n: 0 });
      i += 1;
      continue;
    }
    if (c === ')') {
      out.push({ k: 'rparen', s: c, n: 0 });
      i += 1;
      continue;
    }
    if (c === ',') {
      out.push({ k: 'comma', s: c, n: 0 });
      i += 1;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '%') {
      out.push({ k: 'op', s: c, n: 0 });
      i += 1;
      continue;
    }
    throw new ExprError('unexpected character ' + JSON.stringify(c) + ' in expression');
  }
  return out;
}

class Parser {
  private readonly toks: Tok[];
  private pos = 0;
  private readonly vars: Record<string, number>;

  constructor(toks: Tok[], vars: Record<string, number>) {
    this.toks = toks;
    this.vars = vars;
  }

  private peek(): Tok | null {
    return this.pos < this.toks.length ? this.toks[this.pos] : null;
  }

  private take(): Tok {
    const t = this.peek();
    if (!t) throw new ExprError('unexpected end of expression');
    this.pos += 1;
    return t;
  }

  private expect(kind: TokKind, text?: string): Tok {
    const t = this.take();
    if (t.k !== kind || (text !== undefined && t.s !== text)) {
      throw new ExprError('expected ' + (text ?? kind) + ' but found ' + t.s);
    }
    return t;
  }

  atEnd(): boolean {
    return this.pos >= this.toks.length;
  }

  parseExpr(): number {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (!t || t.k !== 'op' || (t.s !== '+' && t.s !== '-')) return left;
      this.pos += 1;
      const right = this.parseTerm();
      left = t.s === '+' ? left + right : left - right;
    }
  }

  private parseTerm(): number {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (!t || t.k !== 'op' || (t.s !== '*' && t.s !== '/' && t.s !== '%')) return left;
      this.pos += 1;
      const right = this.parseUnary();
      if (t.s === '*') {
        left = left * right;
      } else if (t.s === '/') {
        left = right === 0 ? 0 : left / right;
      } else {
        left = right === 0 ? 0 : left % right;
      }
    }
  }

  private parseUnary(): number {
    const t = this.peek();
    if (t && t.k === 'op' && (t.s === '-' || t.s === '+')) {
      this.pos += 1;
      const v = this.parseUnary();
      return t.s === '-' ? -v : v;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const t = this.take();
    if (t.k === 'num') return t.n;
    if (t.k === 'lparen') {
      const v = this.parseExpr();
      this.expect('rparen');
      return v;
    }
    if (t.k !== 'ident') throw new ExprError('unexpected token ' + t.s);

    const name = t.s;
    const next = this.peek();
    const isCall = next !== null && next.k === 'lparen';

    if (!isCall) return this.readVar(name);

    this.pos += 1; // consume '('

    if (name === 'count') {
      const arg = this.expect('ident').s;
      this.expect('rparen');
      return this.lookup('count:' + arg);
    }
    if (name === 'countIn') {
      const zone = this.expect('ident').s;
      this.expect('comma');
      const arg = this.expect('ident').s;
      this.expect('rparen');
      return this.lookup('countIn:' + zone + ':' + arg);
    }

    const args: number[] = [];
    const first = this.peek();
    if (first && first.k !== 'rparen') {
      args.push(this.parseExpr());
      for (;;) {
        const c = this.peek();
        if (!c || c.k !== 'comma') break;
        this.pos += 1;
        args.push(this.parseExpr());
      }
    }
    this.expect('rparen');
    return applyFn(name, args);
  }

  private readVar(name: string): number {
    if (VAR_SET.has(name) || Object.prototype.hasOwnProperty.call(this.vars, name)) {
      const v = this.vars[name];
      return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    }
    throw new ExprError('unknown identifier: ' + name);
  }

  private lookup(key: string): number {
    if (Object.prototype.hasOwnProperty.call(this.vars, key)) {
      const v = this.vars[key];
      return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    }
    return 0;
  }
}

function applyFn(name: string, args: number[]): number {
  if (ARITY_1.has(name)) {
    if (args.length !== 1) throw new ExprError(name + ' takes exactly 1 argument');
    const a = args[0];
    if (name === 'floor') return Math.floor(a);
    if (name === 'ceil') return Math.ceil(a);
    if (name === 'round') return Math.round(a);
    if (name === 'abs') return Math.abs(a);
    return a <= 0 ? 0 : Math.sqrt(a);
  }
  if (ARITY_N.has(name)) {
    if (args.length === 0) throw new ExprError(name + ' needs at least 1 argument');
    return name === 'min' ? Math.min.apply(null, args) : Math.max.apply(null, args);
  }
  if (name === 'log') {
    if (args.length === 1) return args[0] <= 0 ? 0 : Math.log(args[0]);
    if (args.length === 2) {
      if (args[0] <= 0 || args[1] <= 0 || args[1] === 1) return 0;
      return Math.log(args[0]) / Math.log(args[1]);
    }
    throw new ExprError('log takes 1 or 2 arguments');
  }
  throw new ExprError('unknown function: ' + name);
}

/**
 * Evaluate `expr` against `vars`. Throws ExprError on malformed input or an
 * unknown identifier. Never returns NaN or Infinity: a non-finite result
 * collapses to 0 so a bad divisor can never poison a stat line.
 */
export function evaluateExpr(expr: string, vars: Record<string, number>): number {
  if (typeof expr !== 'string' || expr.trim() === '') throw new ExprError('empty expression');
  const toks = tokenizeExpr(expr);
  if (toks.length === 0) throw new ExprError('empty expression');
  const p = new Parser(toks, vars ?? {});
  const value = p.parseExpr();
  if (!p.atEnd()) throw new ExprError('trailing tokens in expression: ' + expr);
  if (!Number.isFinite(value)) return 0;
  return value;
}

export default evaluateExpr;
