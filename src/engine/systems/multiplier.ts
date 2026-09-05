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
  NextCardMod,
  PlayerId,
  StatKey,
} from '@engine/types';
import { comboCount } from './combo';
import { pushLog, withPlayer } from './internal';

// ---------------------------------------------------------------------------
// Five Elements (B75)
// ---------------------------------------------------------------------------

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

/** Remember the element just played, so the next card can be measured against it. */
export function recordElement(state: GameState, player: PlayerId, element: Element | null): GameState {
  if (!state.players[player]) return state;
  return withPlayer(state, player, (p) => ({ ...p, lastElement: element }));
}

// ---------------------------------------------------------------------------
// The composed hook
// ---------------------------------------------------------------------------

/** Cards whose presence multiplies without needing a NextCardMod. */
const SYMPHONY_OF_3 = 'symphony_of_3';
const GROUP_LEADER = 'group_leader';
const HONEST_LIVING = 'honest_living';
const KYS_CHOSEN = 'kys_chosen';
const SOLAR_ECLIPSE = 'solar_eclipse';

/** The stats KY's Chosen doubles. Everything else is untouched by it. */
const KYS_CHOSEN_STATS: readonly StatKey[] = ['buys', 'money', 'cards', 'actions'];

/** True when this player has a copy of `defId` on the table right now. */
export function hasInPlay(state: GameState, player: PlayerId, defId: CardDefId): boolean {
  const p = state.players[player];
  if (!p) return false;
  return p.play.some((iid) => state.instances[iid]?.defId === defId);
}

/**
 * The multiplier applying to the card currently resolving.
 *
 * `iid` is the card being played — it is needed for the Five Elements lookup
 * and for the Group Leader Combo 1 window. Omitting it drops those two terms
 * and leaves the NextCardMod and on-table sources, which is the right answer
 * for an effect that has no source card.
 *
 * `stat` narrows KY's Chosen, which only doubles Buy, Money, Draw and Action.
 */
export function pendingMultiplier(
  state: GameState,
  player: PlayerId,
  iid: InstanceId | null = null,
  stat: StatKey | null = null,
): number {
  const p = state.players[player];
  if (!p) return 1;

  let mult = 1;

  // 1. Queued `{op:'multiplyNext'}` mods — Solar Eclipse ×2 and everything else
  //    that parks a factor on the player.
  for (const mod of p.nextCardMods) {
    if (mod.appliesTo !== undefined && mod.appliesTo !== 'play') continue;
    if (mod.multiply === undefined) continue;
    if (mod.multiplyStats && stat !== null && !mod.multiplyStats.includes(stat)) continue;
    mult *= mod.multiply;
  }

  // 2. Solar Eclipse and KY's Chosen while they sit on the table.
  if (hasInPlay(state, player, SOLAR_ECLIPSE)) mult *= 2;
  if (hasInPlay(state, player, KYS_CHOSEN)) {
    if (stat === null || KYS_CHOSEN_STATS.includes(stat)) mult *= 2;
  }

  // 3. Symphony of 3: every third card played this turn triggers twice.
  if (hasInPlay(state, player, SYMPHONY_OF_3)) {
    const n = comboCount(state, player);
    if (n > 0 && n % 3 === 0) mult *= 2;
  }

  // 4. Group Leader: the Combo 1 card — the first card of the turn — is cast twice.
  if (hasInPlay(state, player, GROUP_LEADER) && comboCount(state, player) === 1) mult *= 2;

  // 5. Honest Living doubles Money only.
  if (hasInPlay(state, player, HONEST_LIVING) && (stat === null || stat === 'money')) mult *= 2;

  // 6. Five Elements. Applied last because ×0 must survive everything above it.
  if (state.anomaly === 'dongfang_youxi_sheji' && iid !== null) {
    mult *= elementMultiplier(p.lastElement, elementOfInstance(state, iid));
  }

  return mult;
}

/** Apply a multiplier to one numeric output. Stats are integers, so this rounds. */
export function applyMultiplier(value: number, mult: number): number {
  if (mult === 1) return value;
  if (mult === 0) return 0;
  return Math.round(value * mult);
}

/**
 * Spend the one-shot half of the multiplier: every `multiply` NextCardMod loses
 * one use and is dropped at zero. Persistent sources (Solar Eclipse on the
 * table, the elements rule) are untouched, because they are not consumed by
 * being read.
 *
 * Also advances `lastElement` to whatever just resolved, which is what makes the
 * Five Elements chain a chain (B75).
 */
export function consumeMultiplier(
  state: GameState,
  player: PlayerId,
  iid: InstanceId | null = null,
): GameState {
  const p = state.players[player];
  if (!p) return state;

  const kept: NextCardMod[] = [];
  let consumed = 0;
  for (const mod of p.nextCardMods) {
    if (mod.multiply === undefined || (mod.appliesTo !== undefined && mod.appliesTo !== 'play')) {
      kept.push(mod);
      continue;
    }
    const uses = (mod.uses ?? 1) - 1;
    consumed += 1;
    if (uses > 0) kept.push({ ...mod, uses });
  }

  let next = state;
  if (consumed > 0) {
    next = withPlayer(next, player, (pl) => ({ ...pl, nextCardMods: kept }));
    next = pushLog(next, 'multiplierConsumed', player, { consumed });
  }

  if (iid !== null) {
    const element = elementOfInstance(next, iid);
    if (element !== null) next = recordElement(next, player, element);
  }

  return next;
}

/** Queue a `{op:'multiplyNext'}` mod on a player (B41, B74). */
export function queueMultiplyNext(
  state: GameState,
  player: PlayerId,
  factor: number,
  stats?: StatKey[],
  count = 1,
): GameState {
  if (!state.players[player]) return state;
  const mod: NextCardMod = { multiply: factor, appliesTo: 'play', uses: Math.max(1, count) };
  if (stats && stats.length > 0) mod.multiplyStats = [...stats];
  const next = withPlayer(state, player, (p) => ({ ...p, nextCardMods: [...p.nextCardMods, mod] }));
  return pushLog(next, 'multiplyNext', player, { factor, count, stats: stats ?? null });
}

/**
 * The whole hook in one call: read the multiplier, scale the value, and return
 * both so the caller can log the factor it actually used.
 */
export function multipliedGain(
  state: GameState,
  player: PlayerId,
  iid: InstanceId | null,
  stat: StatKey,
  amount: number,
): { value: number; multiplier: number } {
  const multiplier = pendingMultiplier(state, player, iid, stat);
  return { value: applyMultiplier(amount, multiplier), multiplier };
}

/** Assign an element to every definition in the match (Dongfang Youxi Sheji setup). */
export function assignElement(state: GameState, defId: CardDefId, element: Element): GameState {
  const cur = state.variants[defId] ?? { defId, statDelta: {}, costDelta: 0 };
  return { ...state, variants: { ...state.variants, [defId]: { ...cur, element } } };
}

/** The element cycle in generative order, for setup code that needs to walk it. */
export const ELEMENT_CYCLE: readonly Element[] = ['wood', 'fire', 'earth', 'metal', 'water'];
