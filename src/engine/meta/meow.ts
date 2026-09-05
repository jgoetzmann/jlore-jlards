/**
 * B89 — MEOW MEOW MEOW.
 *
 * A display-layer text filter and nothing else. It rewrites words to "meow"
 * while leaving every keyword token and every numeric value exactly as printed.
 * It never touches card behaviour: nothing in this file is reachable from
 * effect resolution.
 */

import type { CardInstance, GameState, InstanceId } from '@engine/types';
import { renderCardText } from '@engine/view';

export const MEOW_ANOMALY_ID = 'meow_meow_meow';

/**
 * Tokens that survive the filter.
 *
 * B89 names exactly two protected classes — keyword tokens and numeric values —
 * so this set is the six `Keyword` values and nothing else. Stat, zone and type
 * words are deliberately *not* protected: "All words become meow" is the
 * anomaly's own text, and a card whose whole line is stat words ("+2 Actions,
 * +2 Buys, +2 Cards, +2 Money") has to read differently under MEOW or the
 * anomaly does not exist. Numbers survive because the filter only ever matches
 * runs of letters.
 */
const KEEP: ReadonlySet<string> = new Set([
  'flimsy', 'temporary', 'indestructible', 'unfathomable',
  // the enum spellings; the prose "Play on Buy" / "Play on Draw" are held as
  // whole phrases in `meowify` so their middle word survives too.
  'playonbuy', 'playondraw',
]);

const HOLE = '\u0000';

function matchCase(original: string, replacement: string): string {
  if (original.length > 1 && original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * Rewrite every non-keyword word to "meow", preserving capitalisation shape,
 * `{template}` tokens, punctuation, and all digits.
 */
export function meowify(text: string): string {
  if (!text) return text;

  const held: string[] = [];
  const hold = (m: string): string => {
    held.push(m);
    return `${HOLE}${held.length - 1}${HOLE}`;
  };

  // Protect `{counter}` templates so live values survive verbatim, and the two
  // multi-word keywords whose middle word is an ordinary preposition.
  let holed = text.replace(/\{[^}]*\}/g, hold);
  holed = holed.replace(/\bPlay\s+on\s+(?:Buy|Draw)\b/gi, hold);

  const out = holed.replace(/[A-Za-z][A-Za-z'\u2019-]*/g, (word) => {
    const bare = word.replace(/[^A-Za-z]/g, '').toLowerCase();
    if (bare.length === 0) return word;
    if (KEEP.has(bare)) return word;
    // Single letters are almost always variables (X, N, Y) — leave them.
    if (bare.length === 1) return word;
    return matchCase(word, 'meow');
  });

  // NB: assembled from a plain string, not a template literal. Inside a
  // template literal `\d` collapses to a bare `d` and no hole is ever restored.
  return out.replace(new RegExp(HOLE + '(\\d+)' + HOLE, 'g'), (_m, i: string) => held[Number(i)]);
}

/** True when this match rolled MEOW MEOW MEOW. */
export function isMeowActive(state: GameState): boolean {
  return state.anomaly === MEOW_ANOMALY_ID;
}

/** Convenience for the view layer: filter only when the anomaly is live. */
export function displayText(state: GameState, text: string): string {
  return isMeowActive(state) ? meowify(text) : text;
}

/**
 * B89 — bake the filtered text onto every instance in the match.
 *
 * `renderCardText` reads `CardInstance.displayTextOverride` before it reads the
 * definition (B120), so that field is the one hook a display-only anomaly has
 * into every view without touching card behaviour. The override is computed
 * from the fully rendered text, so `{counter}` templates keep the numbers they
 * would otherwise have shown. Instances that already carry an override (Call to
 * Chaos 12-15) are left alone, which also makes this idempotent and cheap to
 * re-run for instances minted after setup.
 */
export function applyMeowText(state: GameState): GameState {
  if (!isMeowActive(state)) return state;
  const fallbackViewer = state.playerOrder[0] ?? '';
  let instances: Record<InstanceId, CardInstance> | null = null;

  for (const iid of Object.keys(state.instances)) {
    const inst = state.instances[iid];
    if (!inst || inst.displayTextOverride !== undefined) continue;
    const viewer = inst.owner ?? fallbackViewer;
    let rendered: string;
    try {
      rendered = renderCardText(state, iid, viewer);
    } catch {
      continue;
    }
    if (rendered === '') continue;
    if (instances === null) instances = { ...state.instances };
    instances[iid] = { ...inst, displayTextOverride: meowify(rendered) };
  }

  if (instances === null) return state;
  return { ...state, instances };
}
