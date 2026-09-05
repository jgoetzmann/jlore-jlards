/**
 * T4 — Codex and universes (S-CODEX). Behaviors B92, B93, B94.
 *
 * Written from .fullsend/SPEC.md against the frozen surface in src/engine/types.ts.
 */
import { createMatch } from '@engine/index';
import { allCards, registerAuras, registerCards } from '@engine/registry';
import { allAuraDefinitions, allCardDefinitions } from '@cards/index';
import { entireUniverse, knownUniverse } from '@engine/meta';
import type { CardDefId, CardDefinition, GameState, MatchConfig } from '@engine/types';

const CFG = (playerCount: number, over: Partial<MatchConfig> = {}): MatchConfig => ({
  playerCount,
  draftPileCount: 10,
  anomalyChance: 0,
  winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
  pileSizeScale: 1,
  effectNodeBudget: 500,
  recursionDepth: 8,
  turnSeconds: 60,
  seedCodexWithCommons: true,
  ...over,
});

const SEATS = (n: number, codex: CardDefId[] = []) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    codex: [...codex],
  }));

function deckDefIds(s: GameState, p: string): CardDefId[] {
  const pl = s.players[p];
  return [...pl.library, ...pl.hand, ...pl.gy, ...pl.play].map((iid) => s.instances[iid].defId);
}

function shopTopDefIds(s: GameState): CardDefId[] {
  const out: CardDefId[] = [];
  for (const pile of Object.values(s.shop.piles)) {
    const top = pile.cards[0];
    if (top) out.push(s.instances[top].defId);
  }
  return out;
}

function byRarity(rarities: CardDefinition['rarity'][]): CardDefinition[] {
  return allCards().filter((c) => rarities.includes(c.rarity) && !c.excludeFromPools);
}

beforeAll(() => {
  if (allCards().length === 0) {
    registerCards(allCardDefinitions());
    registerAuras(allAuraDefinitions());
  }
});

describe('S-CODEX', () => {
  test('B92: every card present in the match is written into every seated player’s codex', () => {
    const s = createMatch(CFG(3, { seedCodexWithCommons: false }), SEATS(3), 4001, null);
    expect(s.defsInMatch.length).toBeGreaterThan(0);

    for (const p of s.playerOrder) {
      const codex = new Set(s.players[p].codex);
      for (const defId of deckDefIds(s, p)) {
        expect(codex.has(defId)).toBe(true);
      }
      for (const defId of shopTopDefIds(s)) {
        expect(codex.has(defId)).toBe(true);
      }
    }
  });

  test('B92: with seeding off, a codex never gains an id that is not in the match', () => {
    const s = createMatch(CFG(3, { seedCodexWithCommons: false }), SEATS(3), 4002, null);
    const inMatch = new Set(s.defsInMatch);

    for (const p of s.playerOrder) {
      for (const defId of s.players[p].codex) {
        expect(inMatch.has(defId)).toBe(true);
      }
    }
  });

  test('B92: with seeding off, a registered card absent from the match is absent from the codex', () => {
    const s = createMatch(CFG(2, { seedCodexWithCommons: false }), SEATS(2), 4003, null);
    const inMatch = new Set(s.defsInMatch);
    const absent = allCards().filter((c) => !inMatch.has(c.id));
    expect(absent.length).toBeGreaterThan(0);

    for (const p of s.playerOrder) {
      const codex = new Set(s.players[p].codex);
      const known = new Set(knownUniverse(s, p));
      for (const c of absent.slice(0, 25)) {
        expect(codex.has(c.id)).toBe(false);
        expect(known.has(c.id)).toBe(false);
      }
    }
  });

  test('B93: with seedCodexWithCommons on, every Known Universe starts with all Basic, Common and Rare cards', () => {
    const s = createMatch(CFG(3, { seedCodexWithCommons: true }), SEATS(3), 4004, null);
    const required = byRarity(['basic', 'common', 'rare']);
    expect(required.length).toBeGreaterThan(0);

    for (const p of s.playerOrder) {
      const known = new Set(knownUniverse(s, p));
      const missing = required.filter((c) => !known.has(c.id)).map((c) => c.id);
      expect(missing).toEqual([]);
    }
  });

  test('B93: seeding does not hand out Epic, Legendary or Mythic cards the player has never met', () => {
    const s = createMatch(CFG(2, { seedCodexWithCommons: true }), SEATS(2), 4005, null);
    const inMatch = new Set(s.defsInMatch);
    const unearned = byRarity(['epic', 'legendary', 'mythic']).filter((c) => !inMatch.has(c.id));
    expect(unearned.length).toBeGreaterThan(0);

    for (const p of s.playerOrder) {
      const known = new Set(knownUniverse(s, p));
      for (const c of unearned) {
        expect(known.has(c.id)).toBe(false);
      }
    }
  });

  test('B93: with seeding off, Common and Rare cards outside the match stay out of the Known Universe', () => {
    const s = createMatch(CFG(2, { seedCodexWithCommons: false }), SEATS(2), 4006, null);
    const inMatch = new Set(s.defsInMatch);
    const outside = byRarity(['common', 'rare']).filter((c) => !inMatch.has(c.id));
    expect(outside.length).toBeGreaterThan(0);

    for (const p of s.playerOrder) {
      const known = new Set(knownUniverse(s, p));
      for (const c of outside) {
        expect(known.has(c.id)).toBe(false);
      }
    }
  });

  test('B94: knownUniverse is per player — two seats at the same table hold different universes', () => {
    const pool = allCards().filter((c) => c.rarity === 'epic' || c.rarity === 'legendary');
    expect(pool.length).toBeGreaterThanOrEqual(4);

    const players = [
      { id: 'p1', name: 'Player 1', codex: [pool[0].id, pool[1].id] },
      { id: 'p2', name: 'Player 2', codex: [pool[2].id, pool[3].id] },
    ];
    const s = createMatch(CFG(2, { seedCodexWithCommons: false }), players, 4007, null);

    const u1 = new Set(knownUniverse(s, 'p1'));
    const u2 = new Set(knownUniverse(s, 'p2'));
    const inMatch = new Set(s.defsInMatch);

    for (const id of [pool[0].id, pool[1].id]) {
      expect(u1.has(id)).toBe(true);
      if (!inMatch.has(id)) expect(u2.has(id)).toBe(false);
    }
    for (const id of [pool[2].id, pool[3].id]) {
      expect(u2.has(id)).toBe(true);
      if (!inMatch.has(id)) expect(u1.has(id)).toBe(false);
    }
  });

  test('B94: a seeded codex id survives into that player’s Known Universe and no other', () => {
    const pool = allCards().filter((c) => c.rarity === 'mythic');
    expect(pool.length).toBeGreaterThan(0);
    const secret = pool[0].id;

    const players = [
      { id: 'p1', name: 'Player 1', codex: [secret] },
      { id: 'p2', name: 'Player 2', codex: [] as CardDefId[] },
      { id: 'p3', name: 'Player 3', codex: [] as CardDefId[] },
    ];
    const s = createMatch(CFG(3, { seedCodexWithCommons: false }), players, 4008, null);

    if (!new Set(s.defsInMatch).has(secret)) {
      expect(knownUniverse(s, 'p1')).toContain(secret);
      expect(knownUniverse(s, 'p2')).not.toContain(secret);
      expect(knownUniverse(s, 'p3')).not.toContain(secret);
    } else {
      // The card turned up in the shop, so everyone met it — B92 then applies.
      expect(knownUniverse(s, 'p2')).toContain(secret);
    }
  });

  test('B94: entireUniverse is not per player — it is the whole registry, the same for every seat', () => {
    const s = createMatch(CFG(3, { seedCodexWithCommons: false }), SEATS(3), 4009, null);
    const whole = new Set(entireUniverse());

    const missing = allCards()
      .filter((c) => !c.excludeFromPools)
      .filter((c) => !whole.has(c.id))
      .map((c) => c.id);
    expect(missing).toEqual([]);

    expect(entireUniverse()).toEqual(entireUniverse());

    // Every seat's Known Universe is a strict subset of it while codices are cold.
    for (const p of s.playerOrder) {
      expect(knownUniverse(s, p).length).toBeLessThan(whole.size);
    }
  });
});
