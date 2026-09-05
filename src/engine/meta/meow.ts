/**
 * B89 — MEOW MEOW MEOW.
 *
 * A display-layer text filter and nothing else. It rewrites prose words to
 * "meow" while leaving every keyword token, every mechanic noun, and every
 * numeric value exactly as printed. It never touches card behaviour: nothing in
 * this file is reachable from effect resolution.
 */

import type { GameState } from '@engine/types';

export const MEOW_ANOMALY_ID = 'meow_meow_meow';

/**
 * Tokens that survive the filter. Anything mechanically load-bearing: the six
 * keywords, the card types, the stat names, the zone names, the rarity ladder,
 * and the verbs the rules glossary defines.
 */
const KEEP: ReadonlySet<string> = new Set([
  // keywords
  'flimsy', 'temporary', 'indestructible', 'unfathomable',
  // card types and subtypes that gate effects
  'action', 'actions', 'resource', 'resources', 'points', 'token', 'tokens',
  'relic', 'relics', 'book', 'books', 'food', 'egg', 'eggs', 'truss', 'grape',
  'grapes', 'scripture', 'scriptures', 'diamond', 'diamonds', 'copper', 'silver',
  'gold', 'tix', 'robux', 'jlore',
  // stats
  'money', 'buy', 'buys', 'card', 'cards', 'vp', 'prophet', 'coin', 'coins',
  // zones
  'hand', 'deck', 'library', 'gy', 'graveyard', 'play', 'field', 'trash',
  'shop', 'pile', 'piles', 'aside',
  // mechanic verbs and nouns
  'plays', 'played', 'draw', 'draws', 'drawn', 'discard', 'discards',
  'discarded', 'trashes', 'trashed', 'gain', 'gains', 'gained', 'discover',
  'buff', 'nerf', 'fuse', 'fused', 'fusion', 'recruit', 'recruits', 'lock',
  'locks', 'locked', 'unlock', 'unlocks', 'combo', 'manifest', 'manifests',
  'aura', 'auras', 'heroic', 'celestial', 'hypercelestial', 'plague', 'mutilate',
  'reveal', 'reveals', 'revealed', 'shuffle', 'shuffles', 'shuffled', 'turn',
  'turns', 'mill', 'transform', 'upgrade', 'downgrade', 'copy', 'copies',
  'known', 'entire', 'universe', 'big',
  // rarity ladder
  'basic', 'common', 'rare', 'epic', 'legendary', 'mythic', 'legacy',
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

  // Protect `{counter}` templates so live values survive verbatim.
  const held: string[] = [];
  const holed = text.replace(/\{[^}]*\}/g, (m) => {
    held.push(m);
    return `${HOLE}${held.length - 1}${HOLE}`;
  });

  const out = holed.replace(/[A-Za-z][A-Za-z'\u2019-]*/g, (word) => {
    const bare = word.replace(/[^A-Za-z]/g, '').toLowerCase();
    if (bare.length === 0) return word;
    if (KEEP.has(bare)) return word;
    // Single letters are almost always variables (X, N, Y) — leave them.
    if (bare.length === 1) return word;
    return matchCase(word, 'meow');
  });

  return out.replace(new RegExp(`${HOLE}(\d+)${HOLE}`, 'g'), (_m, i: string) => held[Number(i)]);
}

/** True when this match rolled MEOW MEOW MEOW. */
export function isMeowActive(state: GameState): boolean {
  return state.anomaly === MEOW_ANOMALY_ID;
}

/** Convenience for the view layer: filter only when the anomaly is live. */
export function displayText(state: GameState, text: string): string {
  return isMeowActive(state) ? meowify(text) : text;
}
