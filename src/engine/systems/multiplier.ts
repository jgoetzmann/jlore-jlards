/**
 * S-MULTIPLIER — one hook every effect respects (B74, B75).
 *
 * `{op:'multiplyNext'}`, Symphony of 3, Group Leader, Honest Living, KY's
 * Chosen, Solar Eclipse and the Five Elements rule all compose here rather than
 * each card scripting its own doubling. That is the whole point of B74: two
 * unrelated sources of "×3" route through the same number.
 *
 * Sources compose multiplicatively, so a doubled effect under a tripling
 * element is ×6, and anything under a destructive element is ×0 regardless of
 * what else was stacked on it.
 */

import type {
  CardDefId,
  Element,
  GameState,
  InstanceId,
  PlayerId,
} from '@engine/types';

// ---------------------------------------------------------------------------
// Five Elements (B75)
// ---------------------------------------------------------------------------

/** Dongfang Youxi Sheji, snake_case of the display name (SPEC.md A2). */
export const DONGFANG: string = 'dongfang_youxi_sheji';


/** Generative cycle: Wood feeds Fire, Fire feeds Earth, and so on round. */
export const GENERATES: Record<Element, Element> = {
  wood: 'fire',
  fire: 'earth',
  earth: 'metal',
  metal: 'water',
  water: 'wood',
};

/** Destructive cycle: Wood breaks Earth, Earth breaks Water, and so on round. */
export const DESTROYS: Record<Element, Element> = {
  wood: 'earth',
  earth: 'water',
  water: 'fire',
  fire: 'metal',
  metal: 'wood',
};

/**
 * The element multiplier for playing `current` after `previous`.
 *
 * B75 reads "playing an element that generates the previous one triples the
 * effect; a destructive element negates it entirely", so the relation is read
 * from the card being played back to the element already on the table.
 *
 *   ×3 when GENERATES[current] === previous
 *   ×0 when DESTROYS[current]  === previous
 *   ×1 otherwise, including the first element of the match
 */
export function elementMultiplier(previous: Element | null, current: Element | null): number {
  if (previous === null || current === null) return 1;
  if (GENERATES[current] === previous) return 3;
  if (DESTROYS[current] === previous) return 0;
  return 1;
}

/** The element assigned to a definition this match, under Dongfang Youxi Sheji. */
export function elementOf(state: GameState, defId: CardDefId): Element | null {
  return state.variants[defId]?.element ?? null;
}

/** The element of the card an instance represents. */
export function elementOfInstance(state: GameState, iid: InstanceId): Element | null {
  const inst = state.instances[iid];
  if (!inst) return null;
  return elementOf(state, inst.defId);
}

/**
 * The element that was on the table *before* `iid` was played.
 *
 * `player.lastElement` is advanced the moment a card reaches the play area, so
 * by the time a stat line or an effect body resolves it already names the card
 * currently resolving, not the one before it. The ordered play history is the
 * honest source: walk back from `iid` to the nearest earlier card that carries
 * an element. Falls back to `lastElement` for an effect with no source card,
 * which is the right answer when nothing is mid-play.
 */
export function previousElementOf(
  state: GameState,
  player: PlayerId,
  iid: InstanceId | null,
): Element | null {
  const p = state.players[player];
  if (!p) return null;
  if (iid === null) return p.lastElement;
  const at = p.playedThisTurn.lastIndexOf(iid);
  if (at < 0) return p.lastElement;
  for (let k = at - 1; k >= 0; k -= 1) {
    const earlier = elementOfInstance(state, p.playedThisTurn[k]);
    if (earlier !== null) return earlier;
  }
  // Nothing earlier this turn carries an element: fall back to what carried
  // over from an earlier turn, unless that is this card's own element.
  const own = elementOfInstance(state, iid);
  return p.lastElement === own ? null : p.lastElement;
}

/**
 * The Five Elements factor for the card `iid` resolving right now (B75).
 * Returns 1 whenever Dongfang Youxi Sheji is not the match's anomaly, so every
 * caller can multiply by it unconditionally.
 */
export function elementMultiplierFor(
  state: GameState,
  player: PlayerId,
  iid: InstanceId | null,
): number {
  if (state.anomaly !== DONGFANG) return 1;
  if (iid === null) return 1;
  return elementMultiplier(previousElementOf(state, player, iid), elementOfInstance(state, iid));
}

// ---------------------------------------------------------------------------
// The composed hook
// ---------------------------------------------------------------------------
