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
  CardDefinition,
  Cost,
  EffectNode,
  Keyword,
  ProphetCost,
  Stats,
  Trigger,
} from '@engine/types';
import {
  addStats,
  maxComplexity,
  maxRarity,
  unique,
} from './internal';

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
