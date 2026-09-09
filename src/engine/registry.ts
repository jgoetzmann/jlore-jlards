/**
 * The card and aura registry.
 *
 * A module-level map populated once from `@cards/index`. `getCard` throws on an
 * unknown id — that is the one place in the engine where throwing is correct,
 * because an unregistered defId is a programming error, not a game event.
 */

import type {
  AuraDefinition,
  AuraId,
  CardDefId,
  CardDefinition,
  CardFilter,
  CardType,
  CardTag,
  Keyword,
  NumericFilter,
  Rarity,
} from '@engine/types';
import { allCardDefinitions, allAuraDefinitions } from '@cards/index';

const cardMap = new Map<CardDefId, CardDefinition>();
const auraMap = new Map<AuraId, AuraDefinition>();
let cardOrder: CardDefId[] = [];
let auraOrder: AuraId[] = [];
let bootstrapped = false;

/**
 * Populate from the catalog the first time anybody touches the registry, so a
 * test that imports only the engine still sees the full card pool.
 */
function ensureBootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    const cards = allCardDefinitions();
    if (Array.isArray(cards)) registerCards(cards);
  } catch {
    /* catalog unavailable (partial build); explicit registrations still work */
  }
  try {
    const auras = allAuraDefinitions();
    if (Array.isArray(auras)) registerAuras(auras);
  } catch {
    /* same */
  }
}

/**
 * Addendum A3. Merges into the registry, overwriting by `id`, and never refuses
 * or ignores a call made after first access -- tests mint inert definitions
 * this way and Homebrew-style runtime definitions use the same door. The
 * bootstrap runs first so registering before anybody reads the registry adds to
 * the catalog instead of replacing it.
 */
export function registerCards(defs: CardDefinition[]): void {
  ensureBootstrap();
  for (const def of defs) {
    if (!def || typeof def.id !== 'string') continue;
    if (!cardMap.has(def.id)) cardOrder.push(def.id);
    cardMap.set(def.id, def);
  }
}

export function registerAuras(defs: AuraDefinition[]): void {
  for (const def of defs) {
    if (!def || typeof def.id !== 'string') continue;
    if (!auraMap.has(def.id)) auraOrder.push(def.id);
    auraMap.set(def.id, def);
  }
}

export function getCard(defId: CardDefId): CardDefinition {
  ensureBootstrap();
  const def = cardMap.get(defId);
  if (!def) throw new Error(`registry: unknown card definition "${defId}"`);
  return def;
}

export function hasCard(defId: CardDefId): boolean {
  ensureBootstrap();
  return cardMap.has(defId);
}

export function allCards(): CardDefinition[] {
  ensureBootstrap();
  const out: CardDefinition[] = [];
  for (const id of cardOrder) {
    const def = cardMap.get(id);
    if (def) out.push(def);
  }
  return out;
}

export function getAura(auraId: AuraId): AuraDefinition {
  ensureBootstrap();
  const def = auraMap.get(auraId);
  if (!def) throw new Error(`registry: unknown aura definition "${auraId}"`);
  return def;
}

export function hasAura(auraId: AuraId): boolean {
  ensureBootstrap();
  return auraMap.has(auraId);
}

export function allAuras(): AuraDefinition[] {
  ensureBootstrap();
  const out: AuraDefinition[] = [];
  for (const id of auraOrder) {
    const def = auraMap.get(id);
    if (def) out.push(def);
  }
  return out;
}

export function cardsMatching(filter: CardFilter): CardDefinition[] {
  return allCards().filter((def) => matchesCardFilter(def, filter));
}

// ---------------------------------------------------------------------------
// Definition-level filter matching (state-free; plagued / inMatch are ignored
// here because they need live state — the effects slice handles those).
// ---------------------------------------------------------------------------

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * A NumericFilter bound may be an expression. This is the state-free,
 * definition-level path with no context to evaluate one against, so a non
 * literal bound is skipped — the same way `plagued` and `inMatch` are ignored
 * here. The selector and pool paths resolve them first (see `resolveFilter`).
 */
function numOk(value: number | undefined, nf: NumericFilter | undefined): boolean {
  if (!nf) return true;
  const v = value ?? 0;
  const lit = (b: NumericFilter[keyof NumericFilter]): number | undefined =>
    typeof b === 'number' ? b : undefined;
  const eq = lit(nf.eq);
  const lt = lit(nf.lt);
  const lte = lit(nf.lte);
  const gt = lit(nf.gt);
  const gte = lit(nf.gte);
  if (eq !== undefined && v !== eq) return false;
  if (lt !== undefined && !(v < lt)) return false;
  if (lte !== undefined && !(v <= lte)) return false;
  if (gt !== undefined && !(v > gt)) return false;
  if (gte !== undefined && !(v >= gte)) return false;
  return true;
}

export function matchesCardFilter(def: CardDefinition, filter: CardFilter | undefined): boolean {
  if (!filter) return true;

  const types = asArray<CardType>(filter.type);
  if (types.length && !types.some((t) => def.types.includes(t))) return false;

  const subs = asArray<string>(filter.subtype);
  if (subs.length && !subs.some((s) => def.subtypes.includes(s))) return false;

  const tags = asArray<CardTag>(filter.tag);
  if (tags.length && !tags.some((t) => def.tags.includes(t))) return false;

  const rarities = asArray<Rarity>(filter.rarity);
  if (rarities.length && !rarities.includes(def.rarity)) return false;

  const kws = asArray<Keyword>(filter.keyword);
  if (kws.length && !kws.some((k) => def.keywords.includes(k))) return false;

  if (filter.name !== undefined && def.name !== filter.name) return false;

  const defIds = asArray<CardDefId>(filter.defId);
  if (defIds.length && !defIds.includes(def.id)) return false;

  if (!numOk(def.cost.money, filter.cost)) return false;

  if (filter.not && matchesCardFilter(def, filter.not)) return false;

  return true;
}
