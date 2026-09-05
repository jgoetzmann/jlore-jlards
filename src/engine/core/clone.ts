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

/** B2: `reduce` clones at entry and never mutates its input. */
export function cloneState(state: GameState): GameState {
  return deepClone(state);
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
