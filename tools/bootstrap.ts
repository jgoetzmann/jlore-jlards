/**
 * Shared startup for every script in tools/.
 *
 * The engine registry is empty until someone fills it. Nothing under src/ may
 * perform that side effect at import time without making module load order part
 * of the rules, so the CLIs do it explicitly, once, here.
 */

import type { AuraDefinition, CardDefinition } from '@engine/types';
import { allAuras, allCards, registerAuras, registerCards } from '@engine/registry';
import { allAuraDefinitions, allCardDefinitions } from '@cards/index';

let done = false;

/** Populate the registry. Idempotent: safe to call from several entry points. */
export function bootstrap(): { cards: CardDefinition[]; auras: AuraDefinition[] } {
  if (!done) {
    done = true;
    if (allCards().length === 0) registerCards(allCardDefinitions());
    if (allAuras().length === 0) registerAuras(allAuraDefinitions());
  }
  return { cards: allCards(), auras: allAuras() };
}

/** `--games=200 --json` style argv parsing. Bare flags become "true". */
export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of argv) {
    if (raw.indexOf('--') !== 0) continue;
    const body = raw.slice(2);
    const eq = body.indexOf('=');
    if (eq < 0) out[body] = 'true';
    else out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}

export function intArg(args: Record<string, string>, key: string, fallback: number): number {
  const raw = args[key];
  if (raw === undefined || raw === 'true') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Filesystem-safe, sortable stamp for output filenames. */
export function stamp(): string {
  const d = new Date();
  const p = (n: number, w: number): string => String(n).padStart(w, '0');
  return (
    d.getFullYear() +
    p(d.getMonth() + 1, 2) +
    p(d.getDate(), 2) +
    '-' +
    p(d.getHours(), 2) +
    p(d.getMinutes(), 2) +
    p(d.getSeconds(), 2)
  );
}

export function pct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return (v * 100).toFixed(1) + '%';
}

export function fixed(v: number | null, places: number): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return v.toFixed(places);
}
