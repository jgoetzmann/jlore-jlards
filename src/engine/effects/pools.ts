/**
 * PoolSpec sampling — the source of every Discover, every random pull, and
 * every "a random card from the Entire Universe".
 *
 * Two invariants hold everywhere: a card with `excludeFromPools` (or the
 * Unfathomable keyword) never appears (B33 / SB-8), and a sample never contains
 * the same definition twice (B31).
 */
import type {
  AuraDefinition,
  AuraId,
  AuraTier,
  CardDefId,
  CardDefinition,
  GameState,
  PoolSpec,
  Zone,
} from '@engine/types';
import type { Rng } from '@engine/rng';
import { allAuras, allCards } from '@engine/registry';
import { rarityPullWeight } from '@engine/shop';
import { entireUniverse, knownUniverse } from '@engine/meta';
import { opponentsOf, tryGetCard, uniq, type EffectContext } from './runtime';
import { matchesDefFilter, resolveFilter, zoneIds } from './select';

const CATALOGS: Record<string, (def: CardDefinition) => boolean> = {
  miracle: (d) => d.tags.indexOf('Miracle') >= 0,
  chaos: (d) => d.tags.indexOf('Chaos') >= 0,
  book: (d) => d.types.indexOf('Book') >= 0 || d.subtypes.indexOf('Book') >= 0,
  egg: (d) => d.subtypes.indexOf('Egg') >= 0,
  food: (d) => d.types.indexOf('Food') >= 0 || d.subtypes.indexOf('Food') >= 0,
  grape: (d) => d.subtypes.indexOf('Grape') >= 0,
  relic: (d) => d.types.indexOf('Relic') >= 0 || d.subtypes.indexOf('Relic') >= 0,
  scripture: (d) => d.subtypes.indexOf('Scripture') >= 0,
};

const AURA_CATALOGS: Record<string, AuraTier> = {
  heroicAura: 'heroic',
  celestialAura: 'celestial',
  hypercelestialAura: 'hypercelestial',
};

export function isPoolBlocked(def: CardDefinition | null): boolean {
  if (!def) return true;
  if (def.excludeFromPools === true) return true;
  if (def.keywords.indexOf('Unfathomable') >= 0) return true;
  return false;
}

function safeAllCards(): CardDefinition[] {
  try {
    return allCards();
  } catch {
    return [];
  }
}

function safeAllAuras(): AuraDefinition[] {
  try {
    return allAuras();
  } catch {
    return [];
  }
}

function safeKnownUniverse(state: GameState, player: string): CardDefId[] {
  try {
    return knownUniverse(state, player);
  } catch {
    const p = state.players[player];
    return p ? p.codex.slice() : [];
  }
}

function safeEntireUniverse(): CardDefId[] {
  try {
    return entireUniverse();
  } catch {
    return safeAllCards().map((d) => d.id);
  }
}

function zoneDefIds(state: GameState, ctx: EffectContext, scope: string): CardDefId[] {
  const out: CardDefId[] = [];
  const collect = (player: string | null, zone: Zone): void => {
    for (const iid of zoneIds(state, player, zone)) {
      const i = state.instances[iid];
      if (i) out.push(i.defId);
    }
  };
  switch (scope) {
    case 'shop':
      collect(null, 'shop');
      break;
    case 'deck': {
      collect(ctx.player, 'library');
      collect(ctx.player, 'hand');
      collect(ctx.player, 'gy');
      collect(ctx.player, 'play');
      break;
    }
    case 'gy':
      collect(ctx.player, 'gy');
      break;
    case 'hand':
      collect(ctx.player, 'hand');
      break;
    case 'library':
      collect(ctx.player, 'library');
      break;
    case 'opponentLibrary':
      for (const o of opponentsOf(state, ctx.player)) collect(o, 'library');
      break;
    case 'opponentHand':
      for (const o of opponentsOf(state, ctx.player)) collect(o, 'hand');
      break;
    case 'opponentGy':
      for (const o of opponentsOf(state, ctx.player)) collect(o, 'gy');
      break;
    default:
      break;
  }
  return out;
}

const UNIVERSE_SCOPES = ['knownUniverse', 'entireUniverse'];

export function poolIsWeightedByDefault(spec: PoolSpec | undefined): boolean {
  const scope = spec && spec.scope ? spec.scope : 'knownUniverse';
  if (spec && typeof spec.weighted === 'boolean') return spec.weighted;
  if (spec && spec.catalog) return false;
  return UNIVERSE_SCOPES.indexOf(scope) >= 0;
}

/** Every definition id the spec admits, deduplicated and pool-legal. */
export function poolCandidates(
  state: GameState,
  spec: PoolSpec | undefined,
  ctx: EffectContext,
): CardDefId[] {
  const scope = spec && spec.scope ? spec.scope : 'knownUniverse';
  let ids: CardDefId[];

  if (spec && spec.catalog && CATALOGS[spec.catalog]) {
    const pred = CATALOGS[spec.catalog];
    ids = safeAllCards().filter(pred).map((d) => d.id);
  } else if (spec && spec.catalog && AURA_CATALOGS[spec.catalog]) {
    // Aura catalogs never yield card ids; use sampleAuraPool instead.
    return [];
  } else if (scope === 'entireUniverse') {
    ids = safeEntireUniverse();
  } else if (scope === 'knownUniverse') {
    ids = safeKnownUniverse(state, ctx.player);
  } else {
    ids = zoneDefIds(state, ctx, scope);
  }

  // Expression bounds have to be evaluated here too, not only on the selector
  // path — otherwise a pool filter like "costing at most your Money" is
  // silently ignored and the offer is unfiltered, which is a worse failure than
  // gating after the pick. Cult Leader's "add a card you can currently afford"
  // is a constraint on what is OFFERED.
  const filter = resolveFilter(state, spec ? spec.filter : undefined, ctx);
  const out: CardDefId[] = [];
  for (const id of uniq(ids)) {
    const def = tryGetCard(id);
    if (isPoolBlocked(def)) continue;
    if (!matchesDefFilter(def as CardDefinition, filter, state)) continue;
    out.push(id);
  }
  return out;
}

function weightOf(state: GameState, defId: CardDefId): number {
  const def = tryGetCard(defId);
  if (!def) return 0;
  let w = 0;
  try {
    w = rarityPullWeight(def.rarity);
  } catch {
    w = 1;
  }
  return w > 0 ? w : 0;
}

/**
 * Sample up to `n` distinct definition ids. Weighted by rarity pull weight when
 * the spec asks for it (or when it is a universe scope and did not say).
 */
export function samplePool(
  state: GameState,
  spec: PoolSpec | undefined,
  ctx: EffectContext,
  rng: Rng,
  n: number,
): CardDefId[] {
  const candidates = poolCandidates(state, spec, ctx);
  if (candidates.length === 0 || n <= 0) return [];
  if (candidates.length <= n) return rng.shuffle(candidates);

  if (!poolIsWeightedByDefault(spec)) {
    return rng.shuffle(candidates).slice(0, n);
  }

  const remaining = candidates.slice();
  const picked: CardDefId[] = [];
  while (picked.length < n && remaining.length > 0) {
    const entries = remaining.map((id) => ({ item: id, weight: weightOf(state, id) }));
    const total = entries.reduce((acc, e) => acc + e.weight, 0);
    let chosen: CardDefId;
    if (total <= 0) {
      chosen = rng.pick(remaining);
    } else {
      chosen = rng.weighted(entries);
    }
    picked.push(chosen);
    const at = remaining.indexOf(chosen);
    if (at >= 0) remaining.splice(at, 1);
  }
  return picked;
}

/** One definition id, or null when the pool is empty. */
export function sampleOne(
  state: GameState,
  spec: PoolSpec | undefined,
  ctx: EffectContext,
  rng: Rng,
): CardDefId | null {
  const got = samplePool(state, spec, ctx, rng, 1);
  return got.length > 0 ? got[0] : null;
}

/** Aura ids for the `heroicAura` / `celestialAura` catalogs. */
export function sampleAuraPool(
  state: GameState,
  spec: PoolSpec | undefined,
  rng: Rng,
  n: number,
  tierHint?: AuraTier,
): AuraId[] {
  const tier =
    spec && spec.catalog && AURA_CATALOGS[spec.catalog] ? AURA_CATALOGS[spec.catalog] : tierHint;
  const all = safeAllAuras().filter((a) => (tier ? a.tier === tier : true));
  if (all.length === 0) return [];
  const ids = all.map((a) => a.id);
  if (ids.length <= n) return rng.shuffle(ids);
  return rng.shuffle(ids).slice(0, n);
}

/** Resolve `defId: CardDefId | {pool: PoolSpec}` in one call. */
export function resolveDefIdSpec(
  state: GameState,
  spec: CardDefId | { pool: PoolSpec },
  ctx: EffectContext,
  rng: Rng,
): CardDefId | null {
  if (typeof spec === 'string') return spec;
  if (spec && typeof spec === 'object' && 'pool' in spec) {
    return sampleOne(state, spec.pool, ctx, rng);
  }
  return null;
}
