/**
 * T4 — Auras (S-AURA). Behaviors B76-B80.
 *
 * Written from .fullsend/SPEC.md against the frozen surface in src/engine/types.ts.
 * Fixtures are inline on purpose.
 */
import { createMatch, reduce, legalActions } from '@engine/index';
import {
  allAuras,
  allCards,
  getAura,
  registerAuras,
  registerCards,
} from '@engine/registry';
import { allAuraDefinitions, allCardDefinitions } from '@cards/index';
import { resolveEffects, type EffectContext } from '@engine/effects';
import { auraStartOfTurn } from '@engine/meta';
import type {
  AuraDefinition,
  CardDefId,
  GameState,
  MatchConfig,
  PlayerId,
  StatKey,
} from '@engine/types';

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

const CTX = (player: PlayerId): EffectContext => ({
  player,
  sourceIid: null,
  depth: 0,
  multiplier: 1,
  vars: {},
});

/** Everything except the log, so a "state unchanged" rejection may still log. */
function sansLog(s: GameState): unknown {
  const c = structuredClone(s) as GameState;
  c.log = [];
  c.logSeq = 0;
  return c;
}

function snap(s: GameState, p: PlayerId) {
  const pl = s.players[p];
  return { money: pl.money, buys: pl.buys, actions: pl.actions, vp: pl.vp };
}

/**
 * Sum of the plain-number self stat gains an aura's unconditional start-of-turn
 * triggers hand out. Returns null when the aura does anything more interesting
 * than that, so the tests only reason about auras whose output is predictable.
 */
function startOfTurnStatGain(a: AuraDefinition): Partial<Record<StatKey, number>> | null {
  const trigs = a.triggers.filter((t) => t.on === 'startOfTurn' && !t.condition);
  if (trigs.length === 0) return null;
  const out: Partial<Record<StatKey, number>> = {};
  for (const t of trigs) {
    for (const n of t.effects) {
      if (n.op !== 'gain') return null;
      if (typeof n.amount !== 'number') return null;
      if (n.who !== undefined && n.who !== 'self') return null;
      out[n.stat] = (out[n.stat] ?? 0) + n.amount;
    }
  }
  return out;
}

const PREDICTABLE: StatKey[] = ['money', 'buys', 'actions', 'vp'];

function celestialsWithPredictableStartGain(): AuraDefinition[] {
  return allAuras().filter((a) => {
    if (a.tier !== 'celestial') return false;
    const g = startOfTurnStatGain(a);
    if (!g) return false;
    return PREDICTABLE.some((k) => (g[k] ?? 0) !== 0);
  });
}

beforeAll(() => {
  if (allCards().length === 0) registerCards(allCardDefinitions());
  if (allAuras().length === 0) registerAuras(allAuraDefinitions());
});

describe('S-AURA', () => {
  test('B76: manifesting a second Heroic aura replaces the first and the field still holds exactly one', () => {
    const heroics = allAuras().filter((a) => a.tier === 'heroic');
    expect(heroics.length).toBeGreaterThanOrEqual(2);

    let s = createMatch(CFG(2), SEATS(2), 1001, null);
    const p = s.activePlayer;

    s = resolveEffects(s, [{ op: 'manifestAura', tier: 'heroic', auraId: heroics[0].id }], CTX(p));
    expect(s.players[p].field.map((a) => a.auraId)).toEqual([heroics[0].id]);

    s = resolveEffects(s, [{ op: 'manifestAura', tier: 'heroic', auraId: heroics[1].id }], CTX(p));
    const held = s.players[p].field.filter((a) => getAura(a.auraId).tier === 'heroic');
    expect(held).toHaveLength(1);
    expect(held[0].auraId).toBe(heroics[1].id);
    expect(s.players[p].field).toHaveLength(1);
  });

  test('B76: five successive Heroic manifests never accumulate — the field length stays 1', () => {
    const heroics = allAuras().filter((a) => a.tier === 'heroic');
    expect(heroics.length).toBeGreaterThanOrEqual(2);

    let s = createMatch(CFG(2), SEATS(2), 1002, null);
    const p = s.activePlayer;
    for (let i = 0; i < 5; i++) {
      const pick = heroics[i % heroics.length];
      s = resolveEffects(s, [{ op: 'manifestAura', tier: 'heroic', auraId: pick.id }], CTX(p));
      expect(s.players[p].field.filter((a) => getAura(a.auraId).tier === 'heroic')).toHaveLength(1);
    }
    expect(s.players[p].field).toHaveLength(1);
  });

  test('B77: every Heroic aura definition prints an activation cost of 2 Money', () => {
    const heroics = allAuras().filter((a) => a.tier === 'heroic');
    expect(heroics.length).toBeGreaterThan(0);
    for (const a of heroics) {
      expect(a.activationCost).toBe(2);
    }
  });

  test('B77: activating a Heroic aura with 2 Money spends the 2 and marks it used this turn', () => {
    const heroic = allAuras().filter((a) => a.tier === 'heroic')[0];
    let s = createMatch(CFG(2), SEATS(2), 1003, null);
    const p = s.activePlayer;
    s = resolveEffects(s, [{ op: 'manifestAura', tier: 'heroic', auraId: heroic.id }], CTX(p));

    const staged = structuredClone(s) as GameState;
    staged.players[p].money = 2;
    staged.players[p].field[0].usedThisTurn = false;

    const after = reduce(staged, { type: 'activateAura', player: p, auraId: heroic.id });
    expect(after.players[p].money).toBe(0);
    expect(after.players[p].field[0].usedThisTurn).toBe(true);
  });

  test('B77: activating a Heroic aura with fewer than 2 Money is rejected and changes nothing', () => {
    const heroic = allAuras().filter((a) => a.tier === 'heroic')[0];
    let s = createMatch(CFG(2), SEATS(2), 1004, null);
    const p = s.activePlayer;
    s = resolveEffects(s, [{ op: 'manifestAura', tier: 'heroic', auraId: heroic.id }], CTX(p));

    const staged = structuredClone(s) as GameState;
    staged.players[p].money = 1;
    staged.players[p].field[0].usedThisTurn = false;

    const after = reduce(staged, { type: 'activateAura', player: p, auraId: heroic.id });
    expect(after.players[p].money).toBe(1);
    expect(after.players[p].field[0].usedThisTurn).toBe(false);
    expect(sansLog(after)).toEqual(sansLog(staged));
  });

  test('B77: activating the same Heroic aura twice in one turn is rejected the second time', () => {
    const heroic = allAuras().filter((a) => a.tier === 'heroic')[0];
    let s = createMatch(CFG(2), SEATS(2), 1005, null);
    const p = s.activePlayer;
    s = resolveEffects(s, [{ op: 'manifestAura', tier: 'heroic', auraId: heroic.id }], CTX(p));

    const staged = structuredClone(s) as GameState;
    staged.players[p].money = 4;
    staged.players[p].field[0].usedThisTurn = false;

    const once = reduce(staged, { type: 'activateAura', player: p, auraId: heroic.id });
    expect(once.players[p].money).toBe(2);
    expect(once.players[p].field[0].usedThisTurn).toBe(true);

    const twice = reduce(once, { type: 'activateAura', player: p, auraId: heroic.id });
    expect(twice.players[p].money).toBe(2);
    expect(sansLog(twice)).toEqual(sansLog(once));
  });

  test('B77: legalActions offers no activateAura for a Heroic aura the player cannot pay for or has already used', () => {
    const heroic = allAuras().filter((a) => a.tier === 'heroic')[0];
    let s = createMatch(CFG(2), SEATS(2), 1006, null);
    const p = s.activePlayer;
    s = resolveEffects(s, [{ op: 'manifestAura', tier: 'heroic', auraId: heroic.id }], CTX(p));

    const broke = structuredClone(s) as GameState;
    broke.players[p].money = 1;
    broke.players[p].field[0].usedThisTurn = false;
    expect(
      legalActions(broke, p).filter((a) => a.type === 'activateAura' && a.auraId === heroic.id),
    ).toHaveLength(0);

    const used = structuredClone(s) as GameState;
    used.players[p].money = 10;
    used.players[p].field[0].usedThisTurn = true;
    expect(
      legalActions(used, p).filter((a) => a.type === 'activateAura' && a.auraId === heroic.id),
    ).toHaveLength(0);
  });

  test('B78: Celestial auras are unlimited — three manifests leave all three held', () => {
    const celestials = allAuras().filter((a) => a.tier === 'celestial');
    expect(celestials.length).toBeGreaterThanOrEqual(3);

    let s = createMatch(CFG(2), SEATS(2), 1007, null);
    const p = s.activePlayer;
    for (const c of celestials.slice(0, 3)) {
      s = resolveEffects(s, [{ op: 'manifestAura', tier: 'celestial', auraId: c.id }], CTX(p));
    }
    const held = s.players[p].field.filter((a) => getAura(a.auraId).tier === 'celestial');
    expect(held).toHaveLength(3);
    expect(new Set(held.map((a) => a.auraId))).toEqual(
      new Set(celestials.slice(0, 3).map((c) => c.id)),
    );
  });

  test('B78: a Celestial aura fires its start-of-turn trigger every turn it is held, not once', () => {
    const cands = celestialsWithPredictableStartGain();
    expect(cands.length).toBeGreaterThan(0);
    const def = cands[0];
    const gain = startOfTurnStatGain(def)!;

    let s = createMatch(CFG(2), SEATS(2), 1008, null);
    const p = s.activePlayer;
    s = resolveEffects(s, [{ op: 'manifestAura', tier: 'celestial', auraId: def.id }], CTX(p));

    const before = snap(s, p);
    const t1 = auraStartOfTurn(s, p);
    const a1 = snap(t1, p);
    expect(a1.money).toBe(before.money + (gain.money ?? 0));
    expect(a1.buys).toBe(before.buys + (gain.buys ?? 0));
    expect(a1.actions).toBe(before.actions + (gain.actions ?? 0));
    expect(a1.vp).toBe(before.vp + (gain.vp ?? 0));

    const nextTurn = structuredClone(t1) as GameState;
    nextTurn.turn = t1.turn + 1;
    for (const a of nextTurn.players[p].field) a.usedThisTurn = false;

    const mid = snap(nextTurn, p);
    const t2 = auraStartOfTurn(nextTurn, p);
    const a2 = snap(t2, p);
    expect(a2.money).toBe(mid.money + (gain.money ?? 0));
    expect(a2.buys).toBe(mid.buys + (gain.buys ?? 0));
    expect(a2.actions).toBe(mid.actions + (gain.actions ?? 0));
    expect(a2.vp).toBe(mid.vp + (gain.vp ?? 0));

    expect(t2.players[p].field.map((a) => a.auraId)).toContain(def.id);
  });

  test('B78: manifesting Celestial auras never displaces a held Heroic aura', () => {
    const heroic = allAuras().filter((a) => a.tier === 'heroic')[0];
    const celestials = allAuras().filter((a) => a.tier === 'celestial').slice(0, 2);
    expect(celestials).toHaveLength(2);

    let s = createMatch(CFG(2), SEATS(2), 1009, null);
    const p = s.activePlayer;
    s = resolveEffects(s, [{ op: 'manifestAura', tier: 'heroic', auraId: heroic.id }], CTX(p));
    for (const c of celestials) {
      s = resolveEffects(s, [{ op: 'manifestAura', tier: 'celestial', auraId: c.id }], CTX(p));
    }
    expect(s.players[p].field.map((a) => a.auraId)).toContain(heroic.id);
    expect(s.players[p].field.filter((a) => getAura(a.auraId).tier === 'heroic')).toHaveLength(1);
    expect(s.players[p].field.filter((a) => getAura(a.auraId).tier === 'celestial')).toHaveLength(2);
  });

  test('B79: manifesting a second Hypercelestial aura replaces the first — exactly one is held', () => {
    const hypers = allAuras().filter((a) => a.tier === 'hypercelestial');
    expect(hypers.length).toBeGreaterThanOrEqual(2);

    let s = createMatch(CFG(2), SEATS(2), 1010, null);
    const p = s.activePlayer;
    s = resolveEffects(
      s,
      [{ op: 'manifestAura', tier: 'hypercelestial', auraId: hypers[0].id }],
      CTX(p),
    );
    s = resolveEffects(
      s,
      [{ op: 'manifestAura', tier: 'hypercelestial', auraId: hypers[1].id }],
      CTX(p),
    );

    const held = s.players[p].field.filter((a) => getAura(a.auraId).tier === 'hypercelestial');
    expect(held).toHaveLength(1);
    expect(held[0].auraId).toBe(hypers[1].id);
    expect(s.players[p].field).toHaveLength(1);
  });

  test('B79: a replaced Hypercelestial does not take Celestial auras with it', () => {
    const hypers = allAuras().filter((a) => a.tier === 'hypercelestial');
    const celestials = allAuras().filter((a) => a.tier === 'celestial').slice(0, 2);
    expect(hypers.length).toBeGreaterThanOrEqual(2);
    expect(celestials).toHaveLength(2);

    let s = createMatch(CFG(2), SEATS(2), 1011, null);
    const p = s.activePlayer;
    for (const c of celestials) {
      s = resolveEffects(s, [{ op: 'manifestAura', tier: 'celestial', auraId: c.id }], CTX(p));
    }
    s = resolveEffects(
      s,
      [{ op: 'manifestAura', tier: 'hypercelestial', auraId: hypers[0].id }],
      CTX(p),
    );
    s = resolveEffects(
      s,
      [{ op: 'manifestAura', tier: 'hypercelestial', auraId: hypers[1].id }],
      CTX(p),
    );

    expect(s.players[p].field.filter((a) => getAura(a.auraId).tier === 'celestial')).toHaveLength(2);
    expect(
      s.players[p].field.filter((a) => getAura(a.auraId).tier === 'hypercelestial'),
    ).toHaveLength(1);
  });

  test('B80: the start-of-turn reset lands before aura triggers — with no aura the turn opens at 0 Money, 1 Action, 1 Buy', () => {
    const s = createMatch(CFG(2), SEATS(2), 1012, null);
    const p1 = s.activePlayer;
    const p2 = s.playerOrder.find((x) => x !== p1)!;

    const staged = structuredClone(s) as GameState;
    staged.players[p1].money = 99;
    staged.players[p1].actions = 9;
    staged.players[p1].buys = 9;

    let after = reduce(staged, { type: 'endTurn', player: p1 });
    after = reduce(after, { type: 'endTurn', player: p2 });

    expect(after.activePlayer).toBe(p1);
    expect(after.players[p1].money).toBe(0);
    expect(after.players[p1].actions).toBe(1);
    expect(after.players[p1].buys).toBe(1);
  });

  test('B80: aura triggers fire on top of the reset, not instead of it', () => {
    const cands = celestialsWithPredictableStartGain();
    expect(cands.length).toBeGreaterThan(0);
    const def = cands[0];
    const gain = startOfTurnStatGain(def)!;

    let s = createMatch(CFG(2), SEATS(2), 1013, null);
    const p1 = s.activePlayer;
    const p2 = s.playerOrder.find((x) => x !== p1)!;
    s = resolveEffects(s, [{ op: 'manifestAura', tier: 'celestial', auraId: def.id }], CTX(p1));

    const staged = structuredClone(s) as GameState;
    staged.players[p1].money = 99;
    staged.players[p1].actions = 9;
    staged.players[p1].buys = 9;

    let after = reduce(staged, { type: 'endTurn', player: p1 });
    after = reduce(after, { type: 'endTurn', player: p2 });

    expect(after.activePlayer).toBe(p1);
    expect(after.players[p1].money).toBe(0 + (gain.money ?? 0));
    expect(after.players[p1].actions).toBe(1 + (gain.actions ?? 0));
    expect(after.players[p1].buys).toBe(1 + (gain.buys ?? 0));
  });
});
