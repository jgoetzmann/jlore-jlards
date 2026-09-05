/**
 * T4 — Anomalies (S-ANOMALY). Behaviors B81-B85.
 *
 * Written from .fullsend/SPEC.md against the frozen surface in src/engine/types.ts.
 *
 * NOTE ON IDS: SPEC.md names anomalies by display name and never fixes their
 * AnomalyId strings. These tests freeze the id convention already used for card
 * ids throughout docs/SOLVED-BLOCKERS.md (`blood_diamond`, `chicken_coop`,
 * `arc_of_the_universe`): snake_case of the display name with punctuation
 * dropped. Recorded in .fullsend/notes/spec-gaps-T4.md.
 */
import { createMatch, reduce } from '@engine/index';
import { makeRng } from '@engine/rng';
import { allCards, registerCards, registerAuras } from '@engine/registry';
import { allAuraDefinitions, allCardDefinitions } from '@cards/index';
import { rollAnomaly, applyAnomalySetup } from '@engine/meta';
import type { AnomalyId, CardDefId, GameState, MatchConfig, PlayerId } from '@engine/types';

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

const SEATS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    codex: [] as CardDefId[],
  }));

const MINIATURE_DECK: AnomalyId = 'miniature_deck';
const ECONOMIC_HEDGE: AnomalyId = 'economic_hedge';
const XUSHIS_GAME: AnomalyId = 'xushis_game';
const ACCELERATED_GAME: AnomalyId = 'accelerated_game';
const PROLONGED_GAME: AnomalyId = 'prolonged_game';

const STAT_ANOMALIES: { id: AnomalyId; stat: 'buys' | 'money' | 'actions' | 'cards'; sign: 1 | -1 }[] =
  [
    { id: 'extra_buy', stat: 'buys', sign: 1 },
    { id: 'extra_gold', stat: 'money', sign: 1 },
    { id: 'extra_action', stat: 'actions', sign: 1 },
    { id: 'extra_cards', stat: 'cards', sign: 1 },
    { id: 'less_cards', stat: 'cards', sign: -1 },
    { id: 'less_money', stat: 'money', sign: -1 },
  ];

function deckDefIds(s: GameState, p: PlayerId): CardDefId[] {
  const pl = s.players[p];
  return [...pl.library, ...pl.hand, ...pl.gy, ...pl.play]
    .map((iid) => s.instances[iid].defId)
    .sort();
}

beforeAll(() => {
  if (allCards().length === 0) {
    registerCards(allCardDefinitions());
    registerAuras(allAuraDefinitions());
  }
});

describe('S-ANOMALY', () => {
  test('B81: rollAnomaly with chance 0 returns null for every seed', () => {
    for (let seed = 1; seed <= 200; seed++) {
      expect(rollAnomaly(makeRng(seed, 0), 0)).toBeNull();
    }
  });

  test('B81: rollAnomaly with chance 1 always returns exactly one anomaly id', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const got = rollAnomaly(makeRng(seed, 0), 1);
      expect(got).not.toBeNull();
      expect(typeof got).toBe('string');
      expect((got as string).length).toBeGreaterThan(0);
    }
  });

  test('B81: rollAnomaly is reproducible for a given seed and cursor', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const a = rollAnomaly(makeRng(seed, 0), 0.5);
      const b = rollAnomaly(makeRng(seed, 0), 0.5);
      expect(b).toEqual(a);
    }
  });

  test('B81: rollAnomaly returns null at roughly 1 - chance', () => {
    let hits = 0;
    const runs = 2000;
    for (let seed = 1; seed <= runs; seed++) {
      if (rollAnomaly(makeRng(seed, 0), 0.25) !== null) hits++;
    }
    const rate = hits / runs;
    expect(rate).toBeGreaterThan(0.18);
    expect(rate).toBeLessThan(0.32);
  });

  test('B82: a roll yields a single anomaly id, never a collection, across 500 seeds', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const got = rollAnomaly(makeRng(seed, 0), 1);
      expect(Array.isArray(got)).toBe(false);
      expect(typeof got).toBe('string');
      expect((got as string).includes(',')).toBe(false);
    }
  });

  test('B82: at most one anomaly is ever attached to a match', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const rolled = rollAnomaly(makeRng(seed, 0), 1) as AnomalyId;
      seen.add(rolled);
      const s = createMatch(CFG(2, { anomalyChance: 1 }), SEATS(2), seed, rolled);
      expect(Array.isArray(s.anomaly)).toBe(false);
      expect(s.anomaly).toBe(rolled);
    }
    // The roller is not stuck on a single outcome, so "at most one" is a real
    // constraint rather than an artefact of a constant.
    expect(seen.size).toBeGreaterThan(1);
  });

  test('B82: applying a second anomaly never leaves the match holding two', () => {
    const first = rollAnomaly(makeRng(11, 0), 1) as AnomalyId;
    let second: AnomalyId = first;
    for (let seed = 12; seed < 400 && second === first; seed++) {
      second = rollAnomaly(makeRng(seed, 0), 1) as AnomalyId;
    }
    expect(second).not.toBe(first);

    const s = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 909, first);
    expect(s.anomaly).toBe(first);

    const after = applyAnomalySetup(s, second, makeRng(909, s.rngCursor));
    expect(Array.isArray(after.anomaly)).toBe(false);
    expect(typeof after.anomaly === 'string' || after.anomaly === null).toBe(true);
  });

  test('B82: a match created with no anomaly carries null, not an empty collection', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = createMatch(CFG(2), SEATS(2), seed, null);
      expect(s.anomaly).toBeNull();
    }
  });

  test('B83: Miniature Deck, Economic Hedge and Xushi’s Game each replace the starting deck', () => {
    const base = createMatch(CFG(3), SEATS(3), 5150, null);
    const baseDeck = deckDefIds(base, base.playerOrder[0]);

    for (const id of [MINIATURE_DECK, ECONOMIC_HEDGE, XUSHIS_GAME]) {
      const s = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 5150, id);
      expect(s.anomaly).toBe(id);
      const deck = deckDefIds(s, s.playerOrder[0]);
      expect(deck).not.toEqual(baseDeck);
      expect(deck.length).toBeGreaterThan(0);
    }
  });

  test('B83: Xushi’s Game gives every player the identical 10 cards', () => {
    const s = createMatch(CFG(4, { anomalyChance: 1 }), SEATS(4), 777, XUSHIS_GAME);
    expect(s.anomaly).toBe(XUSHIS_GAME);

    const decks = s.playerOrder.map((p) => deckDefIds(s, p));
    for (const d of decks) {
      expect(d).toHaveLength(10);
    }
    for (const d of decks.slice(1)) {
      expect(d).toEqual(decks[0]);
    }
  });

  test('B83: without a starting-deck anomaly every player keeps the default opening deck', () => {
    const s = createMatch(CFG(3), SEATS(3), 5151, null);
    const decks = s.playerOrder.map((p) => deckDefIds(s, p));
    for (const d of decks) {
      expect(d).toHaveLength(10);
      expect(d).toEqual(decks[0]);
      expect(new Set(d).size).toBe(2);
    }
  });

  test('B84: Accelerated Game scales every pile’s starting size by 0.6', () => {
    const base = createMatch(CFG(3), SEATS(3), 4242, null);
    const acc = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 4242, ACCELERATED_GAME);

    expect(acc.anomaly).toBe(ACCELERATED_GAME);
    expect(acc.config.pileSizeScale).toBe(0.6);

    const fixed = [...base.shop.order.resource, ...base.shop.order.points];
    expect(fixed.length).toBeGreaterThan(0);
    for (const pileId of fixed) {
      const b = base.shop.piles[pileId];
      const a = acc.shop.piles[pileId];
      expect(a).toBeDefined();
      expect(a.startingSize).toBe(Math.round(b.startingSize * 0.6));
      expect(a.startingSize).toBeLessThan(b.startingSize);
    }
  });

  test('B84: Prolonged Game scales every pile’s starting size by 1.4', () => {
    const base = createMatch(CFG(3), SEATS(3), 4243, null);
    const pro = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 4243, PROLONGED_GAME);

    expect(pro.anomaly).toBe(PROLONGED_GAME);
    expect(pro.config.pileSizeScale).toBe(1.4);

    const fixed = [...base.shop.order.resource, ...base.shop.order.points];
    expect(fixed.length).toBeGreaterThan(0);
    for (const pileId of fixed) {
      const b = base.shop.piles[pileId];
      const a = pro.shop.piles[pileId];
      expect(a).toBeDefined();
      expect(a.startingSize).toBe(Math.round(b.startingSize * 1.4));
      expect(a.startingSize).toBeGreaterThan(b.startingSize);
    }
  });

  test('B84: scaling changes pile heights only — the Resource and Points shops hold the same piles', () => {
    const base = createMatch(CFG(3), SEATS(3), 4244, null);
    for (const id of [ACCELERATED_GAME, PROLONGED_GAME]) {
      const scaled = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 4244, id);
      expect(scaled.shop.order.resource).toEqual(base.shop.order.resource);
      expect(scaled.shop.order.points).toEqual(base.shop.order.points);
      expect(scaled.shop.order.draft).toHaveLength(base.shop.order.draft.length);
    }
  });

  test('B85: each stat anomaly writes a signed turn modifier for every player', () => {
    for (const { id, stat, sign } of STAT_ANOMALIES) {
      const s = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 3131, id);
      expect(s.anomaly).toBe(id);
      for (const p of s.playerOrder) {
        const delta = s.players[p].turnModifiers[stat] ?? 0;
        expect(delta).not.toBe(0);
        expect(Math.sign(delta)).toBe(sign);
      }
    }
  });

  test('B85: the stat anomaly delta is applied at the turn reset, not once at setup', () => {
    for (const { id, stat } of STAT_ANOMALIES) {
      if (stat === 'cards') continue; // cards is a draw count, not a turn stat slot
      let s = createMatch(CFG(2, { anomalyChance: 1 }), SEATS(2), 2626, id);
      const p1 = s.activePlayer;
      const p2 = s.playerOrder.find((x) => x !== p1)!;
      const delta = s.players[p1].turnModifiers[stat] ?? 0;
      const baseFor = { money: 0, buys: 1, actions: 1 } as const;

      expect(s.players[p1][stat]).toBe(baseFor[stat] + delta);

      s = reduce(s, { type: 'endTurn', player: p1 });
      expect(s.players[p2][stat]).toBe(baseFor[stat] + (s.players[p2].turnModifiers[stat] ?? 0));

      s = reduce(s, { type: 'endTurn', player: p2 });
      expect(s.activePlayer).toBe(p1);
      expect(s.players[p1][stat]).toBe(baseFor[stat] + delta);
    }
  });

  test('B85: a stat anomaly touches only the stat it is named for', () => {
    const tracked: ('money' | 'buys' | 'actions' | 'cards' | 'vp' | 'prophet')[] = [
      'money',
      'buys',
      'actions',
      'cards',
      'vp',
      'prophet',
    ];
    for (const { id, stat } of STAT_ANOMALIES) {
      const s = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 3132, id);
      for (const p of s.playerOrder) {
        const mods = s.players[p].turnModifiers;
        for (const other of tracked) {
          if (other === stat) continue;
          expect(mods[other] ?? 0).toBe(0);
        }
      }
    }
  });

  test('B85: a match with no anomaly writes no turn modifiers at all', () => {
    const s = createMatch(CFG(3), SEATS(3), 2627, null);
    for (const p of s.playerOrder) {
      const mods = s.players[p].turnModifiers;
      for (const v of Object.values(mods)) {
        expect(v ?? 0).toBe(0);
      }
      expect(s.players[s.activePlayer].buys).toBe(1);
      expect(s.players[s.activePlayer].actions).toBe(1);
      expect(s.players[s.activePlayer].money).toBe(0);
    }
  });
});
