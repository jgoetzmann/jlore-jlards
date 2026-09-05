/**
 * Seeded randomness for the whole engine.
 *
 * mulberry32, seeded from `hash(seed) + cursor`. No unseeded randomness and no
 * wall-clock reads exist anywhere under `src/engine/` (B117).
 *
 * The stream is *resumable*: `makeRng(seed, c)` advanced k times produces
 * exactly the values `makeRng(seed, c + k)` produces from its first call, which
 * is what makes `reduce` replayable from `(seed, rngCursor)` alone.
 */

const MULBERRY_STEP = 0x6d2b79f5;

/** Deterministic 32-bit avalanche of the match seed. */
export function hashSeed(seed: number): number {
  let h = (seed | 0) >>> 0;
  h = (h ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: readonly T[]): T[];
  weighted<T>(entries: readonly { item: T; weight: number }[]): T;
  cursor(): number;
}

export function makeRng(seed: number, cursor: number): Rng {
  const base = hashSeed(seed);
  let drawn = 0;
  const start = Number.isFinite(cursor) ? Math.floor(cursor) : 0;

  function raw(): number {
    // state for draw number (start + drawn), then advance.
    let a = (base + Math.imul(start + drawn, MULBERRY_STEP) + MULBERRY_STEP) | 0;
    drawn += 1;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const rng: Rng = {
    next(): number {
      return raw();
    },
    int(maxExclusive: number): number {
      if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) {
        raw();
        return 0;
      }
      const m = Math.floor(maxExclusive);
      const v = Math.floor(raw() * m);
      return v >= m ? m - 1 : v;
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) {
        throw new RangeError('rng.pick called on an empty array');
      }
      return arr[rng.int(arr.length)] as T;
    },
    shuffle<T>(arr: readonly T[]): T[] {
      const out = arr.slice() as T[];
      for (let i = out.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
      }
      return out;
    },
    weighted<T>(entries: readonly { item: T; weight: number }[]): T {
      if (entries.length === 0) {
        throw new RangeError('rng.weighted called on an empty table');
      }
      let total = 0;
      for (const e of entries) total += e.weight > 0 ? e.weight : 0;
      if (total <= 0) return rng.pick(entries.map((e) => e.item));
      let r = raw() * total;
      for (const e of entries) {
        const w = e.weight > 0 ? e.weight : 0;
        if (r < w) return e.item;
        r -= w;
      }
      return entries[entries.length - 1]!.item;
    },
    cursor(): number {
      return start + drawn;
    },
  };
  return rng;
}
