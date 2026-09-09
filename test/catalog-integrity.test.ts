/**
 * T4 — Catalog integrity. Behaviors B95-B104.
 *
 * Written from .fullsend/SPEC.md against the frozen surface in src/engine/types.ts.
 * These are pure failure tests: every one of them asserts that a class of broken
 * card data does not exist anywhere in the registry.
 */
import {
  allAuras,
  allCards,
  registerAuras,
  registerCards,
} from '@engine/registry';
import { allAuraDefinitions, allCardDefinitions } from '@cards/index';
import type { CardDefId, CardDefinition, Complexity, EffectNode, Rarity } from '@engine/types';

/** Every op in the EffectNode union in src/engine/types.ts. Frozen list. */
const IMPLEMENTED_OPS: string[] = [
  'gain',
  'draw',
  'mill',
  'discard',
  'discardDownTo',
  'trash',
  'moveTo',
  'createCard',
  'gainCard',
  'copyCard',
  'transform',
  'recruit',
  'fuse',
  'shuffle',
  'sortLibraryByCost',
  'reveal',
  'discover',
  'choose',
  'selectCards',
  'lockPile',
  'unlockPile',
  'modifyCost',
  'replenishPile',
  'trashPile',
  'swapPileCosts',
  'addToPileTop',
  'mergePiles',
  'manifestAura',
  'activateAura',
  'buff',
  'nerf',
  'upgradeRelic',
  'delayed',
  'nextCardModifier',
  'endTurn',
  'extraTurn',
  'conditional',
  'repeat',
  'forEach',
  'random',
  'sequence',
  'playCard',
  'replayPlayedThisTurn',
  'multiplyNext',
  'plague',
  'removePlague',
  'addCounter',
  'scoreOnCard',
  'setKeyword',
  'resetCombo',
  'endGame',
  'incDoomsday',
  'questProgress',
  'noop',
];

const RARITIES: Rarity[] = ['basic', 'token', 'common', 'rare', 'epic', 'legendary', 'mythic'];
const COMPLEXITIES: Complexity[] = ['T1', 'T2', 'T3', 'T4'];
const BASIC_SHOP_NAMES = ['Copper', 'Silver', 'Gold', 'Diamond', 'Tix', 'Robux', 'Jlore'];

function walk(nodes: unknown, out: EffectNode[]): void {
  if (!Array.isArray(nodes)) return;
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue;
    const n = raw as EffectNode;
    out.push(n);
    const any = raw as Record<string, unknown>;
    walk(any.effects, out);
    walk(any.then, out);
    walk(any.else, out);
    if (Array.isArray(any.branches)) {
      for (const b of any.branches as Record<string, unknown>[]) walk(b?.effects, out);
    }
    if (Array.isArray(any.options)) {
      for (const o of any.options as Record<string, unknown>[]) walk(o?.effects, out);
    }
    const mod = any.mod as Record<string, unknown> | undefined;
    if (mod) walk(mod.appendEffects, out);
  }
}

/**
 * `$discovered` and `$selected` are placeholders for the card the player chose,
 * rewritten to a real defId by substituteDefId when a prompt resolves. They are
 * legal wherever a defId is and are not catalog entries.
 */
function isChoiceSentinel(ref: string): boolean {
  return ref === '$discovered' || ref === '$selected';
}

function nodesOf(c: CardDefinition): EffectNode[] {
  const out: EffectNode[] = [];
  walk(c.effects, out);
  for (const t of c.triggers ?? []) walk(t.effects, out);
  return out;
}

let cards: CardDefinition[] = [];
let everyNode: { card: CardDefinition; node: EffectNode }[] = [];

beforeAll(() => {
  if (allCards().length === 0) registerCards(allCardDefinitions());
  if (allAuras().length === 0) registerAuras(allAuraDefinitions());
  // The authored catalog, not the registry's view of it. The registry is keyed
  // by id and drops a duplicate silently, so a uniqueness assertion made
  // against `allCards()` is unfalsifiable — it deduplicates before we look.
  cards = allCardDefinitions();
  everyNode = [];
  for (const c of cards) {
    for (const node of nodesOf(c)) everyNode.push({ card: c, node });
  }
});

describe('cards — catalog integrity', () => {
  test('B95: no two card definitions share an id', () => {
    const seen = new Map<CardDefId, number>();
    for (const c of cards) seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);
    expect(dupes).toEqual([]);
  });

  test('B95: every card has a non-empty name, a known rarity and at least one type', () => {
    const nameless = cards.filter((c) => typeof c.name !== 'string' || c.name.trim() === '');
    expect(nameless.map((c) => c.id)).toEqual([]);

    const badRarity = cards.filter((c) => !RARITIES.includes(c.rarity));
    expect(badRarity.map((c) => `${c.id}:${String(c.rarity)}`)).toEqual([]);

    const typeless = cards.filter((c) => !Array.isArray(c.types) || c.types.length === 0);
    expect(typeless.map((c) => c.id)).toEqual([]);
  });

  test('B95: every card id is a non-empty string', () => {
    const bad = cards.filter((c) => typeof c.id !== 'string' || c.id.trim() === '');
    expect(bad).toHaveLength(0);
    expect(cards.length).toBeGreaterThan(0);
  });

  test('B96: no card uses an EffectNode op the interpreter does not implement', () => {
    const ops = new Set(IMPLEMENTED_OPS);
    const bad = everyNode
      .filter(({ node }) => !ops.has((node as { op: string }).op))
      .map(({ card, node }) => `${card.id}:${String((node as { op: string }).op)}`);
    expect([...new Set(bad)]).toEqual([]);
    expect(everyNode.length).toBeGreaterThan(0);
  });

  test('B97: every defId referenced by a createCard op resolves to a registered card', () => {
    const known = new Set(cards.map((c) => c.id));
    const bad: string[] = [];
    for (const { card, node } of everyNode) {
      if ((node as { op: string }).op !== 'createCard') continue;
      const defId = (node as { defId: unknown }).defId;
      if (typeof defId !== 'string') continue;
      if (isChoiceSentinel(defId)) continue;
      if (!known.has(defId)) bad.push(`${card.id} -> ${defId}`);
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  test('B97: every defId referenced by a transform op resolves to a registered card', () => {
    const known = new Set(cards.map((c) => c.id));
    const bad: string[] = [];
    for (const { card, node } of everyNode) {
      if ((node as { op: string }).op !== 'transform') continue;
      const into = (node as { into: unknown }).into;
      if (typeof into !== 'string') continue;
      if (into === 'upgrade' || into === 'downgrade') continue;
      if (isChoiceSentinel(into)) continue;
      if (!known.has(into)) bad.push(`${card.id} -> ${into}`);
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  test('B97: the choice sentinels are only ever used inside a prompt continuation', () => {
    // '$discovered' / '$selected' stand for the card the player picked and are
    // swapped for a real defId on resume. Outside a `then` there is nothing to
    // substitute them from, so they would reach the registry verbatim.
    const stray: string[] = [];
    for (const card of cards) {
      const walkOutsideThen = (value: unknown, insideThen: boolean): void => {
        if (Array.isArray(value)) {
          for (const item of value) walkOutsideThen(item, insideThen);
          return;
        }
        if (!value || typeof value !== 'object') return;
        const obj = value as Record<string, unknown>;
        for (const key of Object.keys(obj)) {
          const nested = key === 'then' || key === 'effects' ? insideThen || key === 'then' : insideThen;
          const child = obj[key];
          if (typeof child === 'string' && isChoiceSentinel(child) && !nested) {
            stray.push(`${card.id}.${key}`);
          }
          walkOutsideThen(child, nested);
        }
      };
      walkOutsideThen(card.effects, false);
      walkOutsideThen(card.triggers, false);
    }
    expect([...new Set(stray)]).toEqual([]);
  });

  test('B98: the registry holds at least 380 card definitions', () => {
    expect(cards.length).toBeGreaterThanOrEqual(380);
  });

  test('B98: all 7 Basic shop cards are present and Basic-rarity', () => {
    const byName = new Map(cards.map((c) => [c.name, c]));
    for (const name of BASIC_SHOP_NAMES) {
      const c = byName.get(name);
      expect(c, `missing Basic shop card ${name}`).toBeDefined();
      expect(c!.rarity).toBe('basic');
    }
    expect(cards.filter((c) => c.rarity === 'basic')).toHaveLength(7);
  });

  test('B98: all 23 Prophet Shop cards are present', () => {
    const prophet = cards.filter((c) => c.shop === 'prophet');
    expect(prophet).toHaveLength(23);
  });

  test('B99: every card with a Prophet cost carries both a threshold and a drain', () => {
    const priced = cards.filter((c) => c.cost.prophet !== undefined);
    expect(priced.length).toBeGreaterThan(0);
    const bad = priced
      .filter(
        (c) =>
          typeof c.cost.prophet!.threshold !== 'number' ||
          typeof c.cost.prophet!.drain !== 'number',
      )
      .map((c) => c.id);
    expect(bad).toEqual([]);
  });

  test('B99: Prophet-costed cards live in the prophet shop, and prophet-shop cards are Prophet-costed', () => {
    const strayShop = cards
      .filter((c) => c.cost.prophet !== undefined && c.shop !== 'prophet')
      .map((c) => c.id);
    expect(strayShop).toEqual([]);

    const strayCost = cards
      .filter((c) => c.shop === 'prophet' && c.cost.prophet === undefined)
      .map((c) => c.id);
    expect(strayCost).toEqual([]);
  });

  test('B100: every Book is cost 1, Temporary, Token-typed and grants +1 Action', () => {
    const books = cards.filter((c) => c.types.includes('Book'));
    expect(books.length).toBeGreaterThan(0);

    const bad = books
      .filter(
        (c) =>
          c.cost.money !== 1 ||
          !c.keywords.includes('Temporary') ||
          !c.types.includes('Token') ||
          (c.stats.actions ?? 0) !== 1,
      )
      .map((c) => c.id);
    expect(bad).toEqual([]);
  });

  test('B101: every Egg is cost 0, Flimsy, Token-typed and grants +1 Action', () => {
    const eggs = cards.filter((c) => c.subtypes.includes('Egg'));
    expect(eggs.length).toBeGreaterThanOrEqual(5);

    const bad = eggs
      .filter(
        (c) =>
          c.cost.money !== 0 ||
          !c.keywords.includes('Flimsy') ||
          !c.types.includes('Token') ||
          (c.stats.actions ?? 0) !== 1,
      )
      .map((c) => c.id);
    expect(bad).toEqual([]);
  });

  test('B101: the standard Egg drop table is weighted 70/15/9/5/1', () => {
    const tables = everyNode
      .filter(({ node }) => (node as { op: string }).op === 'random')
      .map(({ node }) => (node as { branches: { weight: number }[] }).branches ?? [])
      .filter((branches) => branches.length === 5)
      .map((branches) =>
        branches
          .map((b) => b.weight)
          .slice()
          .sort((a, b) => b - a),
      );
    const target = [70, 15, 9, 5, 1];
    const matches = tables.filter((t) => t.join(',') === target.join(','));
    expect(matches.length).toBeGreaterThan(0);
  });

  test('B102: every card declares a T1-T4 complexity', () => {
    const bad = cards
      .filter((c) => !COMPLEXITIES.includes(c.complexity))
      .map((c) => `${c.id}:${String(c.complexity)}`);
    expect(bad).toEqual([]);
  });

  test('B102: every card declares a non-empty subsystems list', () => {
    const bad = cards
      .filter(
        (c) =>
          !Array.isArray(c.subsystems) ||
          c.subsystems.length === 0 ||
          c.subsystems.some((s) => typeof s !== 'string' || s.trim() === ''),
      )
      .map((c) => c.id);
    expect(bad).toEqual([]);
  });

  test('B103: no two card definitions share a name', () => {
    const seen = new Map<string, CardDefId[]>();
    for (const c of cards) {
      const list = seen.get(c.name) ?? [];
      list.push(c.id);
      seen.set(c.name, list);
    }
    const dupes = [...seen.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([name, ids]) => `${name}: ${ids.join(' + ')}`);
    expect(dupes).toEqual([]);
  });

  test('B103: the two Blood Diamonds are disambiguated into two distinct names', () => {
    const bloods = cards.filter((c) => c.name.includes('Blood Diamond'));
    expect(bloods).toHaveLength(2);
    expect(bloods.map((c) => c.name)).toContain('Blood Diamond');
    expect(new Set(bloods.map((c) => c.name)).size).toBe(2);
    expect(new Set(bloods.map((c) => c.id)).size).toBe(2);
  });

  test('B104: every card carries an art slot', () => {
    const bad = cards
      .filter((c) => !c.art || typeof c.art.key !== 'string' || c.art.key.trim() === '')
      .map((c) => c.id);
    expect(bad).toEqual([]);
  });

  test('B104: no two cards share an art key', () => {
    const seen = new Map<string, CardDefId[]>();
    for (const c of cards) {
      const key = c.art?.key ?? `__missing__:${c.id}`;
      const list = seen.get(key) ?? [];
      list.push(c.id);
      seen.set(key, list);
    }
    const dupes = [...seen.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([key, ids]) => `${key}: ${ids.join(' + ')}`);
    expect(dupes).toEqual([]);
  });
});
