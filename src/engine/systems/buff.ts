/**
 * S-BUFF — Buff, Nerf and the three levels of card identity.
 *
 * Behaviors B67–B70.
 *
 * Buff writes to exactly one of three places and nothing else reads printed
 * stats directly:
 *
 *   allCopies -> state.variants[defId].statDelta   (Universal Buff! / Nerf!)
 *   instance  -> instance.statDelta                (Quick Patch, Relics)
 *   pile      -> every instance currently in the pile
 *
 * `effectiveStats` is the only correct way to read a card's stat line: it
 * composes definition + variant + instance. Reading `def.stats` alone loses
 * every buff in the match.
 */

import type {
  CardDefId,
  CardInstance,
  CardVariant,
  GameState,
  InstanceId,
  PileId,
  StatKey,
  Stats,
} from '@engine/types';
import { BUFFABLE_STATS } from '@engine/types';
import type { Rng } from '@engine/rng';
import { resolveEffects } from '@engine/effects';
import {
  addStats,
  allIids,
  bumpStat,
  copiesOf,
  defOf,
  pileContents,
  pushLog,
  tryGetCard,
  withInstance,
  withInstances,
} from './internal';

/**
 * The composed stat line for one instance: printed stats + the match-wide
 * variant delta + this instance's own delta.
 *
 * A stat the card prints as 0 (or does not print at all) appears here as soon
 * as a delta touches it — that is B70 / SB-17 falling straight out of the
 * representation rather than needing a special case.
 */
export function effectiveStats(state: GameState, iid: InstanceId): Stats {
  const inst = state.instances[iid];
  if (!inst) return {};
  const def = tryGetCard(inst.defId);
  const printed: Stats = def ? def.stats : {};
  const variant = state.variants[inst.defId];
  const variantDelta: Stats = variant ? variant.statDelta : {};
  return addStats(addStats(printed, variantDelta), inst.statDelta);
}

/** The composed stat line for a definition, ignoring any single instance. */
export function effectiveDefStats(state: GameState, defId: CardDefId): Stats {
  const def = tryGetCard(defId);
  const printed: Stats = def ? def.stats : {};
  const variant = state.variants[defId];
  return addStats(printed, variant ? variant.statDelta : {});
}

/** One stat off `effectiveStats`, defaulting to 0. */
export function statOf(state: GameState, iid: InstanceId, stat: StatKey): number {
  return effectiveStats(state, iid)[stat] ?? 0;
}

/** Ensure a CardVariant row exists for this definition. */
export function ensureVariant(state: GameState, defId: CardDefId): GameState {
  if (state.variants[defId]) return state;
  const variant: CardVariant = { defId, statDelta: {}, costDelta: 0 };
  return { ...state, variants: { ...state.variants, [defId]: variant } };
}

/**
 * Pick the stat a Buff/Nerf lands on. Uniform over the five buffable stats.
 * Prophet is deliberately not in BUFFABLE_STATS and can never be picked (B69).
 */
export function pickBuffStat(rng: Rng): StatKey {
  return rng.pick(BUFFABLE_STATS);
}

/**
 * Apply one Buff (delta 1) or Nerf (delta -1).
 *
 * `target` is a CardDefId for scope 'allCopies', an InstanceId for scope
 * 'instance', and a PileId for scope 'pile'. `stat` null means "roll one",
 * which picks uniformly from the five buffable stats.
 */
export function applyBuff(
  state: GameState,
  scope: 'instance' | 'allCopies' | 'pile',
  target: string,
  delta: 1 | -1,
  stat: StatKey | null,
  rng: Rng,
): GameState {
  return applyBuffAt(state, scope, target, delta, stat, rng, 0);
}

function applyBuffAt(
  state: GameState,
  scope: 'instance' | 'allCopies' | 'pile',
  target: string,
  delta: 1 | -1,
  stat: StatKey | null,
  rng: Rng,
  depth: number,
): GameState {
  const chosen: StatKey = stat ?? pickBuffStat(rng);
  let next = state;
  let touched: InstanceId[] = [];

  if (scope === 'allCopies') {
    const defId: CardDefId = target;
    next = ensureVariant(next, defId);
    const variant = next.variants[defId];
    const updated: CardVariant = {
      ...variant,
      statDelta: bumpStat(variant.statDelta, chosen, delta),
    };
    next = { ...next, variants: { ...next.variants, [defId]: updated } };
    // Every copy in every zone, including shop piles, now reads the new value
    // through effectiveStats — nothing else has to be rewritten (B67).
    touched = copiesOf(next, defId);
  } else if (scope === 'instance') {
    const iid: InstanceId = target;
    if (!next.instances[iid]) return state;
    next = withInstance(next, iid, (inst: CardInstance) => ({
      ...inst,
      statDelta: bumpStat(inst.statDelta, chosen, delta),
    }));
    touched = [iid];
  } else {
    const pileId: PileId = target;
    const contents = pileContents(next, pileId);
    if (contents.length === 0) return state;
    next = withInstances(next, contents, (inst: CardInstance) => ({
      ...inst,
      statDelta: bumpStat(inst.statDelta, chosen, delta),
    }));
    touched = contents;
  }

  next = pushLog(next, delta > 0 ? 'buff' : 'nerf', null, {
    scope,
    target,
    stat: chosen,
    delta,
    affected: touched.length,
  });

  return fireOnBuff(next, scope, target, chosen, delta, touched, depth);
}

/**
 * Indirect Buffalo and friends: anything with an `onBuff` trigger fires once
 * per buff event. Capped by config.recursionDepth so a buff that buffs cannot
 * run away.
 */
function fireOnBuff(
  state: GameState,
  scope: string,
  target: string,
  stat: StatKey,
  delta: number,
  touched: readonly InstanceId[],
  depth: number,
): GameState {
  if (depth >= state.config.recursionDepth) return state;

  let next = state;
  const touchedSet = new Set(touched);

  for (const iid of allIids(next)) {
    const inst = next.instances[iid];
    if (!inst || !inst.owner) continue;
    const def = defOf(next, iid);
    if (!def) continue;
    const triggers = def.triggers.filter((t) => t.on === 'onBuff');
    if (triggers.length === 0) continue;
    for (const trg of triggers) {
      if (trg.zones && !trg.zones.includes(inst.zone)) continue;
      next = resolveEffects(next, trg.effects, {
        player: inst.owner,
        sourceIid: iid,
        depth: depth + 1,
        multiplier: 1,
        vars: {
          buffDelta: delta,
          buffedSelf: touchedSet.has(iid) ? 1 : 0,
          buffScopeAllCopies: scope === 'allCopies' ? 1 : 0,
        },
      });
    }
  }

  return next;
}
