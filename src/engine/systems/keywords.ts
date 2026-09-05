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

import type { GameState, InstanceId, Keyword } from '@engine/types';
import { defOf, pushLog, withInstance } from './internal';

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

/** SB-8: an Unfathomable card is excluded from every pool, copy and steal route. */
export function isUnfathomable(state: GameState, iid: InstanceId): boolean {
  return hasKeyword(state, iid, 'Unfathomable');
}
