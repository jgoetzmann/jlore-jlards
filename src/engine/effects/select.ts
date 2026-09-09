/**
 * Selector and filter resolution.
 *
 * `selectInstances` is the pure, exported form: it never advances the rng
 * cursor, so `pick:'random'` from a query path is stable for a given state.
 * Ops that genuinely consume randomness call `selectInstancesWith` and hand it
 * a live rng, then write the cursor back.
 */
import type {
  CardDefinition,
  CardFilter,
  GameState,
  InstanceId,
  Keyword,
  NumericFilter,
  PileId,
  PileSelector,
  PlayerId,
  Selector,
  Zone,
} from '@engine/types';
import type { Rng } from '@engine/rng';
import { effectiveKeywords } from '@engine/systems/keywords.js';
import {
  asArray,
  defCost,
  instanceCost,
  peekRng,
  resolveWho,
  tryGetCard,
  uniq,
  type EffectContext,
} from './runtime';
import { evalAmount } from './evaluate';

// ---------------------------------------------------------------------------
// Named filters, addressable from expressions as count(<name>)
// ---------------------------------------------------------------------------

export const NAMED_FILTERS: Record<string, CardFilter> = {
  all: {},
  action: { type: 'Action' },
  resource: { type: 'Resource' },
  points: { type: 'Points' },
  token: { type: 'Token' },
  relic: { type: 'Relic' },
  book: { type: 'Book' },
  food: { type: 'Food' },
  basic: { rarity: 'basic' },
  common: { rarity: 'common' },
  rare: { rarity: 'rare' },
  epic: { rarity: 'epic' },
  legendary: { rarity: 'legendary' },
  mythic: { rarity: 'mythic' },
  legacy: { tag: 'Legacy' },
  pvp: { tag: 'PvP' },
  endOfGame: { tag: 'EndOfGame' },
  miracle: { tag: 'Miracle' },
  chaos: { tag: 'Chaos' },
  crafted: { tag: 'Crafted' },
  flimsy: { keyword: 'Flimsy' },
  temporary: { keyword: 'Temporary' },
  indestructible: { keyword: 'Indestructible' },
  plagued: { plagued: true },
  egg: { subtype: 'Egg' },
  grape: { subtype: 'Grape' },
  gold: { subtype: 'Gold' },
  scripture: { subtype: 'Scripture' },
  distilled: { subtype: 'Distilled' },
  felinor: { subtype: 'Felinor' },
  truss: { subtype: 'Truss' },
  cn: { subtype: 'CN' },
  ricochet: { subtype: 'Ricochet' },
  cheap: { cost: { lte: 3 } },
  expensive: { cost: { gte: 6 } },
  zeroCost: { cost: { eq: 0 } },

  // `count(<name>)` resolves through this table and an unregistered name reads
  // as 0 rather than raising, so a filter a card names but nobody registered is
  // a silent zero. These five are named by shipped card expressions.
  oneCost: { cost: { eq: 1 } }, // snowball
  cost7: { cost: { eq: 7 } }, // star_aligner
  diamond: { subtype: 'Diamond' }, // treasure_vault
  soul_shard: { defId: 'soul_shard' }, // soulcologist_mike_kwzka
  kwzki_cultist: { defId: 'kwzki_cultist' }, // kwzki_cultist
};

// ---------------------------------------------------------------------------
// Numeric filters
// ---------------------------------------------------------------------------

export function matchesNumeric(n: number, f: NumericFilter | undefined): boolean {
  if (!f) return true;
  if (typeof f.eq === 'number' && n !== f.eq) return false;
  if (typeof f.lt === 'number' && !(n < f.lt)) return false;
  if (typeof f.lte === 'number' && !(n <= f.lte)) return false;
  if (typeof f.gt === 'number' && !(n > f.gt)) return false;
  if (typeof f.gte === 'number' && !(n >= f.gte)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Definition-level filter
// ---------------------------------------------------------------------------

export function matchesDefFilter(
  def: CardDefinition,
  filter?: CardFilter,
  state?: GameState,
): boolean {
  if (!filter) return true;
  if (!def) return false;

  const types = asArray(filter.type);
  if (types.length > 0 && !types.some((t) => def.types.indexOf(t) >= 0)) return false;

  const subs = asArray(filter.subtype);
  if (subs.length > 0 && !subs.some((t) => def.subtypes.indexOf(t) >= 0)) return false;

  const tags = asArray(filter.tag);
  if (tags.length > 0 && !tags.some((t) => def.tags.indexOf(t) >= 0)) return false;

  const rarities = asArray(filter.rarity);
  if (rarities.length > 0 && rarities.indexOf(def.rarity) < 0) return false;

  const keywords = asArray(filter.keyword);
  if (keywords.length > 0 && !keywords.some((k) => def.keywords.indexOf(k as Keyword) >= 0)) {
    return false;
  }

  if (typeof filter.name === 'string' && def.name !== filter.name) return false;

  const defIds = asArray(filter.defId);
  if (defIds.length > 0 && defIds.indexOf(def.id) < 0) return false;

  if (filter.cost) {
    const cost = state ? defCost(state, def.id) : typeof def.cost.money === 'number' ? def.cost.money : 0;
    if (!matchesNumeric(cost, filter.cost)) return false;
  }

  if (typeof filter.inMatch === 'boolean') {
    const present = !!state && state.defsInMatch.indexOf(def.id) >= 0;
    if (present !== filter.inMatch) return false;
  }

  if (filter.not && matchesDefFilter(def, filter.not, state)) return false;

  // `plagued` is instance state; a bare definition can never satisfy it.
  if (filter.plagued === true) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Instance-level filter
// ---------------------------------------------------------------------------

export function matchesFilter(state: GameState, iid: InstanceId, filter?: CardFilter): boolean {
  const i = state.instances[iid];
  if (!i) return false;
  if (!filter) return true;

  const def = tryGetCard(i.defId);
  if (!def) return false;

  const types = asArray(filter.type);
  if (types.length > 0 && !types.some((t) => def.types.indexOf(t) >= 0)) return false;

  const subs = asArray(filter.subtype);
  if (subs.length > 0 && !subs.some((t) => def.subtypes.indexOf(t) >= 0)) return false;

  const tags = asArray(filter.tag);
  if (tags.length > 0 && !tags.some((t) => def.tags.indexOf(t) >= 0)) return false;

  const rarities = asArray(filter.rarity);
  if (rarities.length > 0 && rarities.indexOf(def.rarity) < 0) return false;

  const wanted = asArray(filter.keyword);
  if (wanted.length > 0) {
    const live = effectiveKeywords(state, iid);
    if (!wanted.some((k) => live.indexOf(k as Keyword) >= 0)) return false;
  }

  if (typeof filter.name === 'string' && def.name !== filter.name) return false;

  const defIds = asArray(filter.defId);
  if (defIds.length > 0 && defIds.indexOf(i.defId) < 0) return false;

  if (filter.cost && !matchesNumeric(instanceCost(state, iid), filter.cost)) return false;

  if (typeof filter.plagued === 'boolean') {
    const plague = typeof i.counters.plague === 'number' ? i.counters.plague : 0;
    if (filter.plagued !== plague > 0) return false;
  }

  if (typeof filter.inMatch === 'boolean') {
    const present = state.defsInMatch.indexOf(i.defId) >= 0;
    if (present !== filter.inMatch) return false;
  }

  if (filter.counter) {
    const held = typeof i.counters[filter.counter.key] === 'number' ? i.counters[filter.counter.key] : 0;
    if (!matchesNumeric(held, filter.counter)) return false;
  }

  if (filter.not && matchesFilter(state, iid, filter.not)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Zone reads
// ---------------------------------------------------------------------------

export function zoneIds(state: GameState, player: PlayerId | null, zone: Zone): InstanceId[] {
  if (zone === 'library' || zone === 'hand' || zone === 'gy' || zone === 'play') {
    if (!player) return [];
    const p = state.players[player];
    if (!p) return [];
    if (zone === 'library') return p.library.slice();
    if (zone === 'hand') return p.hand.slice();
    if (zone === 'gy') return p.gy.slice();
    return p.play.slice();
  }
  if (zone === 'shop') {
    const out: InstanceId[] = [];
    for (const pid of Object.keys(state.shop.piles)) {
      const pile = state.shop.piles[pid];
      if (pile) out.push(...pile.cards);
    }
    return out;
  }
  // trash, field, aside: no ordered array exists, so scan the registry.
  const out: InstanceId[] = [];
  for (const iid of Object.keys(state.instances)) {
    const i = state.instances[iid];
    if (!i || i.zone !== zone) continue;
    if (player && i.owner !== player) continue;
    out.push(iid);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Selector resolution
// ---------------------------------------------------------------------------

const DEFAULT_ZONES: Zone[] = ['hand'];

export function selectInstancesWith(
  state: GameState,
  sel: Selector | undefined,
  ctx: EffectContext,
  rng: Rng | null,
): InstanceId[] {
  if (!sel) return [];

  if (sel.self) {
    return ctx.sourceIid && state.instances[ctx.sourceIid] ? [ctx.sourceIid] : [];
  }

  const zones: Zone[] = sel.zone ? asArray(sel.zone) : DEFAULT_ZONES;
  const players = resolveWho(state, sel.who, ctx.player, rng);

  const candidates: InstanceId[] = [];
  for (const zone of zones) {
    if (zone === 'shop' || zone === 'trash') {
      candidates.push(...zoneIds(state, null, zone));
      continue;
    }
    for (const pid of players) candidates.push(...zoneIds(state, pid, zone));
  }

  let matched = uniq(candidates).filter((iid) => matchesFilter(state, iid, sel.filter));
  if (matched.length === 0) return [];

  const wantRaw = sel.count === undefined ? matched.length : evalAmount(state, sel.count, ctx);
  const want = Math.max(0, Math.floor(wantRaw));
  if (want === 0) return [];
  if (want >= matched.length && sel.pick !== 'bottom') return matched;

  switch (sel.pick) {
    case 'random': {
      const r = rng ?? peekRng(state, 1);
      matched = r.shuffle(matched);
      break;
    }
    case 'bottom':
      matched = matched.slice().reverse();
      break;
    case 'mostExpensive':
      matched = matched.slice().sort((a, b) => instanceCost(state, b) - instanceCost(state, a));
      break;
    case 'cheapest':
      matched = matched.slice().sort((a, b) => instanceCost(state, a) - instanceCost(state, b));
      break;
    case 'lastPlayed': {
      const order: InstanceId[] = [];
      for (const pid of players) {
        const p = state.players[pid];
        if (p) order.push(...p.playedThisTurn);
      }
      const rank = new Map<InstanceId, number>();
      order.forEach((iid, idx) => rank.set(iid, idx));
      matched = matched
        .slice()
        .sort((a, b) => (rank.get(b) ?? -1) - (rank.get(a) ?? -1));
      break;
    }
    case 'top':
    case 'choose':
    default:
      // Zone order already is top-first; 'choose' falls back to the first N so
      // that a query path stays total even without a prompt.
      break;
  }

  return matched.slice(0, want);
}

export function selectInstances(
  state: GameState,
  sel: Selector,
  ctx: EffectContext,
): InstanceId[] {
  return selectInstancesWith(state, sel, ctx, null);
}

// ---------------------------------------------------------------------------
// Pile selection
// ---------------------------------------------------------------------------

export function pileTopDef(state: GameState, pileId: PileId): CardDefinition | null {
  const pile = state.shop.piles[pileId];
  if (!pile || pile.cards.length === 0) return null;
  const i = state.instances[pile.cards[0]];
  if (!i) return null;
  return tryGetCard(i.defId);
}

export function pileCost(state: GameState, pileId: PileId): number {
  const pile = state.shop.piles[pileId];
  if (!pile) return 0;
  if (typeof pile.costOverride === 'number') return pile.costOverride;
  const def = pileTopDef(state, pileId);
  return def ? defCost(state, def.id) : 0;
}

export function selectPilesWith(
  state: GameState,
  sel: PileSelector | undefined,
  ctx: EffectContext,
  rng: Rng | null,
): PileId[] {
  const shop = sel && sel.shop ? sel.shop : 'draft';
  let ids: PileId[] = [];
  if (shop === 'all') {
    ids = ids
      .concat(state.shop.order.draft)
      .concat(state.shop.order.resource)
      .concat(state.shop.order.points)
      .concat(state.shop.order.prophet);
  } else {
    ids = (state.shop.order[shop] ?? []).slice();
  }
  ids = ids.filter((id) => !!state.shop.piles[id]);

  if (sel && sel.excludeJlore) {
    ids = ids.filter((id) => {
      const def = pileTopDef(state, id);
      return !(def && (def.id === 'jlore' || def.name === 'Jlore'));
    });
  }

  if (sel && sel.filter) {
    ids = ids.filter((id) => {
      const pile = state.shop.piles[id];
      if (!pile) return false;
      if (pile.cards.length === 0) return false;
      return matchesFilter(state, pile.cards[0], sel.filter);
    });
  }

  if (ids.length === 0) return [];

  const wantRaw = sel && sel.count !== undefined ? evalAmount(state, sel.count, ctx) : ids.length;
  const want = Math.max(0, Math.floor(wantRaw));
  if (want === 0) return [];
  if (want >= ids.length) return ids;

  switch (sel && sel.pick) {
    case 'random': {
      const r = rng ?? peekRng(state, 2);
      ids = r.shuffle(ids);
      break;
    }
    case 'tallest':
      ids = ids
        .slice()
        .sort((a, b) => (state.shop.piles[b]?.cards.length ?? 0) - (state.shop.piles[a]?.cards.length ?? 0));
      break;
    case 'shortest':
      ids = ids
        .slice()
        .sort((a, b) => (state.shop.piles[a]?.cards.length ?? 0) - (state.shop.piles[b]?.cards.length ?? 0));
      break;
    case 'mostExpensive':
      ids = ids.slice().sort((a, b) => pileCost(state, b) - pileCost(state, a));
      break;
    case 'cheapest':
      ids = ids.slice().sort((a, b) => pileCost(state, a) - pileCost(state, b));
      break;
    default:
      break;
  }

  return ids.slice(0, want);
}

export function isPileSelector(v: unknown): v is PileSelector {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return 'shop' in o || 'excludeJlore' in o;
}
