/**
 * S-FUSE — composite cards from two or more parents, per SB-13 exactly.
 *
 *   Cost      sum of components, capped at 20
 *   Rarity    max of components
 *   Types     union
 *   Subtypes  union
 *   Tags      union
 *   Keywords  union, except Flimsy drops if any component lacks it, and
 *             Indestructible survives if any component has it
 *   Stats     per-stat sum
 *   Effects   concatenated in component order
 *   Name      "A · B"
 *   Art       art.key = 'fused'
 *
 * Matchmaker and Freaky Phil fuse cards already sitting in the Library, so
 * fusion mutates instances in place: the first component instance becomes the
 * fused card and keeps its identity, position and counters; the others are
 * consumed to `aside` rather than trashed, so no trash trigger fires on what is
 * really a merge.
 *
 * `chopped_chuzz` has an explicit anti-fusion clause: when it would fuse, it
 * trashes itself instead.
 */

import type {
  ArtSlot,
  CardDefId,
  CardDefinition,
  CardVariant,
  Cost,
  EffectNode,
  GameState,
  InstanceId,
  Keyword,
  ProphetCost,
  Stats,
  Trigger,
} from '@engine/types';
import { registerCards } from '@engine/registry';
import {
  addStats,
  maxComplexity,
  maxRarity,
  pushLog,
  tryGetCard,
  unique,
  withInstance,
} from './internal';
import { moveInstance } from '@engine/core/zones';

/** The card that refuses to fuse. */
export const CHOPPED_CHUZZ: CardDefId = 'chopped_chuzz';

/** Hard cap on a fused card's money cost (SB-13). */
export const FUSED_COST_CAP = 20;

/**
 * Build the composite definition for a set of components. Pure: it reads the
 * definitions and returns a new one, registering nothing.
 */
export function fusedDefinition(defs: CardDefinition[]): CardDefinition {
  const ids = defs.map((d) => d.id);

  // Cost: sum, capped. Undefined money cost counts as 0 rather than blocking.
  let money = 0;
  for (const d of defs) money += d.cost.money ?? 0;
  const cost: Cost = { money: Math.min(FUSED_COST_CAP, money) };

  // Prophet: the strictest threshold and the largest drain a component asked
  // for. Summing them would push every fusion past the 30-Prophet ceiling.
  const prophets: ProphetCost[] = defs.map((d) => d.cost.prophet).filter((p): p is ProphetCost => !!p);
  if (prophets.length > 0) {
    cost.prophet = {
      threshold: Math.max(...prophets.map((p) => p.threshold)),
      drain: Math.max(...prophets.map((p) => p.drain)),
    };
  }

  // Keywords: union, then the two exceptions.
  const unionKeywords = unique(defs.flatMap((d) => d.keywords));
  const everyoneFlimsy = defs.every((d) => d.keywords.includes('Flimsy'));
  const anyIndestructible = defs.some((d) => d.keywords.includes('Indestructible'));
  let keywords: Keyword[] = unionKeywords;
  if (!everyoneFlimsy) keywords = keywords.filter((k) => k !== 'Flimsy');
  if (anyIndestructible && !keywords.includes('Indestructible')) keywords.push('Indestructible');

  // Stats: per-stat sum, so a component printing 0 of a stat still contributes
  // its line to the composite.
  let stats: Stats = {};
  for (const d of defs) stats = addStats(stats, d.stats);

  const effects: EffectNode[] = defs.flatMap((d) => d.effects);
  const triggers: Trigger[] = defs.flatMap((d) => d.triggers);

  const art: ArtSlot = { key: 'fused', status: 'placeholder' };

  let bigAction: number | undefined;
  const bigs = defs.map((d) => d.bigAction ?? 1);
  const maxBig = Math.max(...bigs);
  if (maxBig > 1) bigAction = maxBig;

  const def: CardDefinition = {
    id: 'fused_' + ids.join('__'),
    name: defs.map((d) => d.name).join(' · '),
    cost,
    types: unique(defs.flatMap((d) => d.types)),
    subtypes: unique(defs.flatMap((d) => d.subtypes)),
    tags: unique(defs.flatMap((d) => d.tags)),
    rarity: maxRarity(defs.map((d) => d.rarity)),
    keywords,
    stats,
    effects,
    triggers,
    text: defs.map((d) => d.text).join(' '),
    complexity: maxComplexity(defs.map((d) => d.complexity)),
    subsystems: unique([...defs.flatMap((d) => d.subsystems), 'S-FUSE']),
    // A fused definition is generated mid-match: it must never appear in a shop
    // pile or a Discover pool, or a fusion would leak into the printed catalog.
    notPurchasable: true,
    excludeFromPools: true,
    art,
    wordCount: defs.reduce((sum, d) => sum + (d.wordCount ?? 0), 0),
  };

  if (bigAction !== undefined) def.bigAction = bigAction;

  const flavors = defs.map((d) => d.flavor).filter((f): f is string => !!f);
  if (flavors.length > 0) def.flavor = flavors.join(' ');

  return def;
}

/**
 * Fuse a set of instances in place.
 *
 * The first surviving component becomes the fused card. It keeps its instance
 * id, its owner, its zone and its position, which is what "fuses cards already
 * in your Library" requires. The other components are consumed to `aside`.
 *
 * Returns the state unchanged when fewer than two components survive the
 * Chopped Chuzz check.
 */
export function fuseInstances(state: GameState, iids: InstanceId[]): GameState {
  const present = iids.filter((iid) => !!state.instances[iid]);
  if (present.length === 0) return state;

  let next = state;

  // Chopped Chuzz trashes itself instead of fusing.
  const chuzz = present.filter((iid) => next.instances[iid].defId === CHOPPED_CHUZZ);
  const components = present.filter((iid) => next.instances[iid].defId !== CHOPPED_CHUZZ);
  for (const iid of chuzz) {
    moveInstance(next, iid, next.instances[iid].owner, 'trash');
    next = pushLog(next, 'fuseRefused', next.instances[iid].owner, { iid, defId: CHOPPED_CHUZZ });
  }

  if (components.length < 2) return next;

  const defs: CardDefinition[] = [];
  for (const iid of components) {
    const def = tryGetCard(next.instances[iid].defId);
    if (def) defs.push(def);
  }
  if (defs.length < 2) return next;

  const fused = fusedDefinition(defs);
  registerCards([fused]);

  // A fused definition needs a variant row so Universal Buff can reach it, and
  // it counts as present in the match for CNcias-style queries.
  if (!next.variants[fused.id]) {
    const variant: CardVariant = { defId: fused.id, statDelta: {}, costDelta: 0 };
    next = { ...next, variants: { ...next.variants, [fused.id]: variant } };
  }
  if (!next.defsInMatch.includes(fused.id)) {
    next = { ...next, defsInMatch: [...next.defsInMatch, fused.id] };
  }

  const host = components[0];
  const consumed = components.slice(1);

  // Merge the consumed instances' runtime state onto the host before they go.
  let mergedCounters: Record<string, number> = { ...next.instances[host].counters };
  let mergedAdded: Keyword[] = [...next.instances[host].addedKeywords];
  let mergedRemoved: Keyword[] = [...next.instances[host].removedKeywords];
  let mergedDelta: Stats = { ...next.instances[host].statDelta };
  let mergedExtra: EffectNode[] = [...next.instances[host].extraEffects];

  for (const iid of consumed) {
    const inst = next.instances[iid];
    for (const key of Object.keys(inst.counters)) {
      mergedCounters[key] = (mergedCounters[key] ?? 0) + inst.counters[key];
    }
    mergedAdded = unique([...mergedAdded, ...inst.addedKeywords]);
    mergedDelta = addStats(mergedDelta, inst.statDelta);
    mergedExtra = [...mergedExtra, ...inst.extraEffects];
    // A keyword stripped from one half is only stripped on the composite if it
    // was stripped from every half — same shape as the Flimsy rule.
    mergedRemoved = mergedRemoved.filter((k) => inst.removedKeywords.includes(k));
  }

  next = withInstance(next, host, (inst) => ({
    ...inst,
    defId: fused.id,
    fusedFrom: unique([...(inst.fusedFrom ?? []), ...defs.map((d) => d.id)]),
    counters: mergedCounters,
    addedKeywords: mergedAdded,
    removedKeywords: mergedRemoved,
    statDelta: mergedDelta,
    extraEffects: mergedExtra,
  }));

  for (const iid of consumed) {
    moveInstance(next, iid, next.instances[iid].owner, 'aside');
  }

  return pushLog(next, 'fuse', next.instances[host].owner, {
    host,
    consumed,
    defId: fused.id,
    name: fused.name,
    components: defs.map((d) => d.id),
  });
}

/** True when this instance is a fusion. */
export function isFused(state: GameState, iid: InstanceId): boolean {
  const inst = state.instances[iid];
  return !!inst && !!inst.fusedFrom && inst.fusedFrom.length > 1;
}

/** The printed definitions a fused instance was built from. */
export function fusionComponents(state: GameState, iid: InstanceId): CardDefId[] {
  return state.instances[iid]?.fusedFrom ? [...(state.instances[iid].fusedFrom as CardDefId[])] : [];
}

/** True when fusing this instance would be refused (Chopped Chuzz). */
export function refusesFusion(state: GameState, iid: InstanceId): boolean {
  return state.instances[iid]?.defId === CHOPPED_CHUZZ;
}
