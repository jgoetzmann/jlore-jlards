/**
 * Structural clone. `structuredClone` is not available in every target this
 * build ships to, so the engine carries its own. GameState is plain JSON data:
 * objects, arrays, numbers, strings, booleans, null. Nothing else is cloned.
 */

import type { GameState } from '@engine/types';

function cloneAny(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const len = v.length;
    const out: unknown[] = new Array(len);
    for (let i = 0; i < len; i++) out[i] = cloneAny(v[i]);
    return out;
  }
  const src = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src)) out[k] = cloneAny(src[k]);
  return out;
}

export function deepClone<T>(value: T): T {
  return cloneAny(value) as T;
}

/**
 * B2: `reduce` clones at entry and never mutates its input.
 *
 * Everything is deep-cloned except the log's entries: the array is copied, the
 * LogEntry objects inside it are shared with the input. That keeps the clone's
 * cost from growing with the match (the log reaches 2-3k entries late in a game
 * and was the bulk of every clone). ENGINE-1.
 *
 * Sharing is safe because of two rules, and it depends on both:
 *  1. Entries are append-only. Every write path builds a fresh entry with
 *     core/log.ts makeLogEntry and pushes or spreads it onto the array. Nothing
 *     indexes into a past entry to change it.
 *  2. An entry owns everything it points at. makeLogEntry deep-copies `detail`,
 *     so no entry aliases a dispatched action, a caller's array or live state.
 * Callers get the usual contract: a returned state is theirs to read, not to
 * mutate. Past entries are now shared by every later state, so writing to one
 * would show up in all of them.
 */
export function cloneState(state: GameState): GameState {
  // Key order is kept identical to the input, so JSON.stringify of a clone
  // matches the original byte for byte (lockstep checksums rely on that).
  const src = state as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src)) {
    out[k] = k === 'log' && Array.isArray(src[k]) ? (src[k] as unknown[]).slice() : cloneAny(src[k]);
  }
  return out as unknown as GameState;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    const x = a as unknown[];
    const y = b as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!deepEqual(x[i], y[i])) return false;
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const xk = Object.keys(x);
  const yk = Object.keys(y);
  if (xk.length !== yk.length) return false;
  for (const k of xk) {
    if (!Object.prototype.hasOwnProperty.call(y, k)) return false;
    if (!deepEqual(x[k], y[k])) return false;
  }
  return true;
}
