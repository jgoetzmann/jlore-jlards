/**
 * The effective keyword set for an instance, and the two destination rules that
 * fall out of it.
 *
 * Effective set = printed keywords + addedKeywords - removedKeywords.
 * Corrosion and Book of Blood grant; Card Sleeve, Archivist and Goatman Family
 * Genetics strip.
 *
 * B12 / SB-16: **Indestructible beats Flimsy.** An Indestructible Flimsy card
 * goes to GY when played instead of being trashed. Indestructible is printed on
 * exactly three cards (Series E/F/X Funding) and being unremovable is their
 * entire drawback; a single Corrosion must not be able to undo that.
 */

import type { GameState, InstanceId, Keyword, Zone } from '@engine/types';
import { defOf, pushLog, withInstance, withInstances } from './internal';

/** printed + added - removed, deduped, in a stable order. */
export function effectiveKeywords(state: GameState, iid: InstanceId): Keyword[] {
  const inst = state.instances[iid];
  if (!inst) return [];
  const def = defOf(state, iid);
  const printed: Keyword[] = def ? def.keywords : [];
  const removed = new Set<Keyword>(inst.removedKeywords);
  const out: Keyword[] = [];
  const seen = new Set<Keyword>();
  for (const kw of [...printed, ...inst.addedKeywords]) {
    if (removed.has(kw) || seen.has(kw)) continue;
    seen.add(kw);
    out.push(kw);
  }
  return out;
}

/** Does this instance currently have the keyword? */
export function hasKeyword(state: GameState, iid: InstanceId, kw: Keyword): boolean {
  const inst = state.instances[iid];
  if (!inst) return false;
  if (inst.removedKeywords.includes(kw)) return false;
  if (inst.addedKeywords.includes(kw)) return true;
  const def = defOf(state, iid);
  return def ? def.keywords.includes(kw) : false;
}

/** Grant a keyword at runtime. Cancels any prior strip of the same keyword. */
export function grantKeyword(state: GameState, iid: InstanceId, kw: Keyword): GameState {
  const inst = state.instances[iid];
  if (!inst) return state;
  const next = withInstance(state, iid, (i) => ({
    ...i,
    addedKeywords: i.addedKeywords.includes(kw) ? i.addedKeywords : [...i.addedKeywords, kw],
    removedKeywords: i.removedKeywords.filter((k) => k !== kw),
  }));
  return pushLog(next, 'grantKeyword', inst.owner, { iid, keyword: kw });
}

/** Strip a keyword at runtime, printed or granted. */
export function stripKeyword(state: GameState, iid: InstanceId, kw: Keyword): GameState {
  const inst = state.instances[iid];
  if (!inst) return state;
  const next = withInstance(state, iid, (i) => ({
    ...i,
    addedKeywords: i.addedKeywords.filter((k) => k !== kw),
    removedKeywords: i.removedKeywords.includes(kw) ? i.removedKeywords : [...i.removedKeywords, kw],
  }));
  return pushLog(next, 'stripKeyword', inst.owner, { iid, keyword: kw });
}

/** `{op:'setKeyword', on}` in one call. */
export function setKeyword(state: GameState, iid: InstanceId, kw: Keyword, on: boolean): GameState {
  return on ? grantKeyword(state, iid, kw) : stripKeyword(state, iid, kw);
}

/** Grant the same keyword to a batch of instances. */
export function grantKeywordMany(
  state: GameState,
  iids: readonly InstanceId[],
  kw: Keyword,
): GameState {
  return withInstances(state, iids, (i) => ({
    ...i,
    addedKeywords: i.addedKeywords.includes(kw) ? i.addedKeywords : [...i.addedKeywords, kw],
    removedKeywords: i.removedKeywords.filter((k) => k !== kw),
  }));
}

/** B40: Indestructible beats every trash source. */
export function canBeTrashed(state: GameState, iid: InstanceId): boolean {
  return !hasKeyword(state, iid, 'Indestructible');
}

/**
 * Where a card goes after it finishes resolving.
 *
 * Indestructible wins over both Flimsy and Temporary, so an Indestructible
 * Flimsy card goes to GY (B12 / SB-16). Otherwise Flimsy and Temporary both
 * trash on play, and everything else goes to GY.
 */
export function destinationAfterPlay(state: GameState, iid: InstanceId): Zone {
  if (hasKeyword(state, iid, 'Indestructible')) return 'gy';
  if (hasKeyword(state, iid, 'Flimsy')) return 'trash';
  if (hasKeyword(state, iid, 'Temporary')) return 'trash';
  return 'gy';
}

/**
 * Where a card goes when discarded. Temporary is strictly stronger than Flimsy:
 * it trashes on discard too (B11). Indestructible still wins.
 */
export function destinationAfterDiscard(state: GameState, iid: InstanceId): Zone {
  if (hasKeyword(state, iid, 'Indestructible')) return 'gy';
  if (hasKeyword(state, iid, 'Temporary')) return 'trash';
  return 'gy';
}

/** True when playing this card destroys it (B10, B11, and not B12). */
export function trashesOnPlay(state: GameState, iid: InstanceId): boolean {
  return destinationAfterPlay(state, iid) === 'trash';
}

/** True when discarding this card destroys it. */
export function trashesOnDiscard(state: GameState, iid: InstanceId): boolean {
  return destinationAfterDiscard(state, iid) === 'trash';
}

/** SB-8: an Unfathomable card is excluded from every pool, copy and steal route. */
export function isUnfathomable(state: GameState, iid: InstanceId): boolean {
  return hasKeyword(state, iid, 'Unfathomable');
}

/** Play on Buy: resolves on purchase, costs no Action. */
export function playsOnBuy(state: GameState, iid: InstanceId): boolean {
  return hasKeyword(state, iid, 'PlayOnBuy');
}

/**
 * Play on Draw, capped by SB-35: a card may not trigger its own Play-on-Draw
 * within one resolution chain, and the chain is bounded by
 * `config.recursionDepth` like everything else.
 */
export function playsOnDraw(state: GameState, iid: InstanceId, depth: number): boolean {
  if (depth >= state.config.recursionDepth) return false;
  return hasKeyword(state, iid, 'PlayOnDraw');
}
