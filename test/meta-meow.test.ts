/**
 * T4 — MEOW MEOW MEOW and starting-aura anomalies. Behaviors B89, B90.
 *
 * Written from .fullsend/SPEC.md against the frozen surface in src/engine/types.ts.
 *
 * NOTE ON IDS: SPEC.md never fixes AnomalyId strings. B89 freezes
 * `meow_meow_meow` from the snake_case-of-display-name convention used for card
 * ids in docs/SOLVED-BLOCKERS.md. B90 needs no id at all — it discovers the
 * starting-aura anomalies through rollAnomaly. Recorded in
 * .fullsend/notes/spec-gaps-T4.md.
 */
import { createMatch } from '@engine/index';
import { makeRng } from '@engine/rng';
import { renderCardText, viewFor } from '@engine/view';
import {
  allAuras,
  allCards,
  getAura,
  getCard,
  registerAuras,
  registerCards,
} from '@engine/registry';
import { allAuraDefinitions, allCardDefinitions } from '@cards/index';
import { rollAnomaly } from '@engine/meta';
import type { AnomalyId, CardDefId, GameState, MatchConfig, PileView } from '@engine/types';

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

const MEOW: AnomalyId = 'meow_meow_meow';

/** Every keyword the glossary spells out, in both the enum and prose spellings. */
const KEYWORD_TOKENS = [
  'Flimsy',
  'Temporary',
  'Indestructible',
  'Unfathomable',
  'PlayOnBuy',
  'PlayOnDraw',
  'Play on Buy',
  'Play on Draw',
];

function firstIidByDef(s: GameState): Map<CardDefId, string> {
  const m = new Map<CardDefId, string>();
  for (const [iid, inst] of Object.entries(s.instances)) {
    if (!m.has(inst.defId)) m.set(inst.defId, iid);
  }
  return m;
}

function numbersIn(text: string): string {
  return (text.match(/\d+/g) ?? []).join('|');
}

function alphaWords(text: string): string[] {
  return text.match(/[A-Za-z]+/g) ?? [];
}

function allAnomalyIds(seeds = 400): AnomalyId[] {
  const out = new Set<AnomalyId>();
  for (let seed = 1; seed <= seeds; seed++) {
    const got = rollAnomaly(makeRng(seed, 0), 1);
    if (got !== null) out.add(got);
  }
  return [...out];
}

function pileViews(v: { shop: { resource: PileView[]; points: PileView[] } }): PileView[] {
  return [...v.shop.resource, ...v.shop.points];
}

beforeAll(() => {
  if (allCards().length === 0) registerCards(allCardDefinitions());
  if (allAuras().length === 0) registerAuras(allAuraDefinitions());
});

describe('S-ANOMALY / MEOW MEOW MEOW', () => {
  test('B89: MEOW MEOW MEOW leaves every numeric value in the rendered text intact', () => {
    const base = createMatch(CFG(2), SEATS(2), 9001, null);
    const meow = createMatch(CFG(2, { anomalyChance: 1 }), SEATS(2), 9001, MEOW);
    expect(meow.anomaly).toBe(MEOW);

    const bMap = firstIidByDef(base);
    const mMap = firstIidByDef(meow);
    const shared = [...mMap.keys()].filter((d) => bMap.has(d));
    expect(shared.length).toBeGreaterThanOrEqual(7);

    const viewer = base.playerOrder[0];
    const meowViewer = meow.playerOrder[0];
    for (const defId of shared) {
      const before = renderCardText(base, bMap.get(defId)!, viewer);
      const after = renderCardText(meow, mMap.get(defId)!, meowViewer);
      expect(numbersIn(after)).toBe(numbersIn(before));
    }
  });

  test('B89: MEOW MEOW MEOW leaves every keyword token in the rendered text intact', () => {
    const base = createMatch(CFG(2), SEATS(2), 9002, null);
    const meow = createMatch(CFG(2, { anomalyChance: 1 }), SEATS(2), 9002, MEOW);

    const bMap = firstIidByDef(base);
    const mMap = firstIidByDef(meow);
    const shared = [...mMap.keys()].filter((d) => bMap.has(d));
    expect(shared.length).toBeGreaterThanOrEqual(7);

    const viewer = base.playerOrder[0];
    const meowViewer = meow.playerOrder[0];
    for (const defId of shared) {
      const before = renderCardText(base, bMap.get(defId)!, viewer);
      const after = renderCardText(meow, mMap.get(defId)!, meowViewer);
      for (const kw of KEYWORD_TOKENS) {
        if (before.includes(kw)) {
          expect(after.includes(kw)).toBe(true);
        }
      }
    }
  });

  test('B89: MEOW MEOW MEOW does rewrite the display words of keyword-free cards', () => {
    const base = createMatch(CFG(2), SEATS(2), 9003, null);
    const meow = createMatch(CFG(2, { anomalyChance: 1 }), SEATS(2), 9003, MEOW);

    const bMap = firstIidByDef(base);
    const mMap = firstIidByDef(meow);
    const viewer = base.playerOrder[0];
    const meowViewer = meow.playerOrder[0];

    const candidates = [...mMap.keys()].filter((d) => {
      if (!bMap.has(d)) return false;
      const def = getCard(d);
      if (def.keywords.length > 0) return false;
      return alphaWords(renderCardText(base, bMap.get(d)!, viewer)).length >= 2;
    });
    expect(candidates.length).toBeGreaterThan(0);

    for (const defId of candidates) {
      const before = renderCardText(base, bMap.get(defId)!, viewer);
      const after = renderCardText(meow, mMap.get(defId)!, meowViewer);
      expect(after).not.toBe(before);
    }
  });

  test('B89: MEOW MEOW MEOW is display only — costs, stats and keywords in the view are untouched', () => {
    const base = createMatch(CFG(2), SEATS(2), 9004, null);
    const meow = createMatch(CFG(2, { anomalyChance: 1 }), SEATS(2), 9004, MEOW);

    const bView = viewFor(base, base.playerOrder[0]);
    const mView = viewFor(meow, meow.playerOrder[0]);

    const bTops = new Map(
      pileViews(bView).filter((p) => p.top).map((p) => [p.top!.defId, p]),
    );
    const mTops = new Map(
      pileViews(mView).filter((p) => p.top).map((p) => [p.top!.defId, p]),
    );
    const shared = [...mTops.keys()].filter((d) => bTops.has(d));
    expect(shared.length).toBeGreaterThanOrEqual(7);

    for (const defId of shared) {
      const b = bTops.get(defId)!;
      const m = mTops.get(defId)!;
      expect(m.cost).toEqual(b.cost);
      expect(m.prophetCost).toEqual(b.prophetCost);
      expect(m.top!.stats).toEqual(b.top!.stats);
      expect(m.top!.keywords).toEqual(b.top!.keywords);
      expect(m.top!.types).toEqual(b.top!.types);
      expect(m.top!.rarity).toBe(b.top!.rarity);
    }
  });
});

describe('S-ANOMALY / starting auras', () => {
  test('B90: with no anomaly, no player starts the match holding an aura', () => {
    for (const seed of [1, 2, 3, 42]) {
      const s = createMatch(CFG(3), SEATS(3), seed, null);
      for (const p of s.playerOrder) {
        expect(s.players[p].field).toHaveLength(0);
      }
    }
  });

  test('B90: at least one anomaly manifests a starting aura', () => {
    const ids = allAnomalyIds();
    expect(ids.length).toBeGreaterThan(0);

    const granting = ids.filter((id) => {
      const s = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 1234, id);
      return s.playerOrder.some((p) => s.players[p].field.length > 0);
    });
    expect(granting.length).toBeGreaterThan(0);
  });

  test('B90: a starting-aura anomaly gives every player the same single Celestial aura', () => {
    const ids = allAnomalyIds();
    const granting = ids.filter((id) => {
      const s = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 1234, id);
      return s.playerOrder.some((p) => s.players[p].field.length > 0);
    });
    expect(granting.length).toBeGreaterThan(0);

    for (const id of granting) {
      for (const n of [2, 3, 4]) {
        const s = createMatch(CFG(n, { anomalyChance: 1 }), SEATS(n), 1234, id);
        const held = s.playerOrder.map((p) => s.players[p].field.map((a) => a.auraId));
        for (const f of held) {
          expect(f).toHaveLength(1);
          expect(getAura(f[0]).tier).toBe('celestial');
        }
        for (const f of held.slice(1)) {
          expect(f).toEqual(held[0]);
        }
      }
    }
  });

  test('B90: a starting-aura anomaly never leaves one player unaurad while others are aurad', () => {
    const ids = allAnomalyIds();
    for (const id of ids) {
      for (const n of [2, 3, 4]) {
        const s = createMatch(CFG(n, { anomalyChance: 1 }), SEATS(n), 4321, id);
        const sizes = s.playerOrder.map((p) => s.players[p].field.length);
        expect(new Set(sizes).size).toBe(1);
      }
    }
  });
});
