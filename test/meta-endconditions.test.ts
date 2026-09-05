/**
 * T4 — End conditions (S-ENDGAME). Behaviors B86, B87, B88, B91.
 *
 * Written from .fullsend/SPEC.md against the frozen surface in src/engine/types.ts.
 *
 * NOTE ON IDS: SPEC.md names anomalies by display name and never fixes their
 * AnomalyId strings. These tests freeze the snake_case-of-display-name
 * convention used for card ids in docs/SOLVED-BLOCKERS.md. Recorded in
 * .fullsend/notes/spec-gaps-T4.md.
 */
import { createMatch, reduce, isGameOver } from '@engine/index';
import { allCards, getCard, registerCards, registerAuras } from '@engine/registry';
import { allAuraDefinitions, allCardDefinitions } from '@cards/index';
import { checkEndCondition } from '@engine/meta';
import type { AnomalyId, CardDefId, GameState, MatchConfig, PileId } from '@engine/types';

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

const DEATHS_DOOR: AnomalyId = 'deaths_door';
const HEAVY_IS_THE_CROWN: AnomalyId = 'heavy_is_the_crown';
const AIM_FOR_THE_MOON: AnomalyId = 'aim_for_the_moon';
const BATTLE_ROYALE: AnomalyId = 'battle_royale';

/** Pass turns with no plays and no buys until the game ends or the cap is hit. */
function passTurns(start: GameState, maxTurns: number): GameState {
  let s = start;
  for (let i = 0; i < maxTurns && !isGameOver(s); i++) {
    s = reduce(s, { type: 'endTurn', player: s.activePlayer });
  }
  return s;
}

function withVp(s: GameState, vps: Record<string, number>): GameState {
  const c = structuredClone(s) as GameState;
  for (const [p, vp] of Object.entries(vps)) c.players[p].vp = vp;
  return c;
}

function jlorePileId(s: GameState): PileId {
  for (const id of s.shop.order.points) {
    const top = s.shop.piles[id].cards[0];
    if (top && getCard(s.instances[top].defId).name === 'Jlore') return id;
  }
  throw new Error('no Jlore pile in the Points Shop');
}

beforeAll(() => {
  if (allCards().length === 0) {
    registerCards(allCardDefinitions());
    registerAuras(allAuraDefinitions());
  }
});

describe('S-ENDGAME', () => {
  test('B86: Death’s Door sets the hard end turn to 10 x playerCount', () => {
    for (const n of [2, 3, 4]) {
      const s = createMatch(CFG(n, { anomalyChance: 1 }), SEATS(n), 8080, DEATHS_DOOR);
      expect(s.anomaly).toBe(DEATHS_DOOR);
      expect(s.hardEndTurn).toBe(10 * n);
    }
  });

  test('B86: Death’s Door does not end the game before turn 10 x playerCount', () => {
    const s = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 8081, DEATHS_DOOR);
    const mid = passTurns(s, 28);
    expect(isGameOver(mid)).toBe(false);
    expect(mid.ended).toBe(false);
    expect(mid.endReason).toBeNull();
  });

  test('B86: Death’s Door ends the game at the end of turn 10 x playerCount', () => {
    const s = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 8082, DEATHS_DOOR);
    const done = passTurns(s, 60);
    expect(isGameOver(done)).toBe(true);
    expect(done.ended).toBe(true);
    expect(done.endReason).not.toBeNull();
    expect(done.turn).toBeGreaterThanOrEqual(29);
    expect(done.turn).toBeLessThanOrEqual(31);
  });

  test('B87: Heavy is the Crown ends the game once a player leads by 10 VP', () => {
    const s = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 6060, HEAVY_IS_THE_CROWN);
    expect(s.anomaly).toBe(HEAVY_IS_THE_CROWN);
    const [a, b, c] = s.playerOrder;

    const lead10 = checkEndCondition(withVp(s, { [a]: 10, [b]: 0, [c]: 0 }));
    expect(lead10.ended).toBe(true);
    expect(lead10.reason).not.toBeNull();
    expect(typeof lead10.reason).toBe('string');

    const lead100 = checkEndCondition(withVp(s, { [a]: 100, [b]: 0, [c]: 0 }));
    expect(lead100.ended).toBe(true);
  });

  test('B87: Heavy is the Crown does not end the game on a lead of 9 or on a level board', () => {
    const s = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 6061, HEAVY_IS_THE_CROWN);
    const [a, b, c] = s.playerOrder;

    expect(checkEndCondition(withVp(s, { [a]: 9, [b]: 0, [c]: 0 })).ended).toBe(false);
    expect(checkEndCondition(withVp(s, { [a]: 0, [b]: 0, [c]: 0 })).ended).toBe(false);
    expect(checkEndCondition(withVp(s, { [a]: 8, [b]: 8, [c]: 8 })).ended).toBe(false);
  });

  test('B87: Aim for the Moon ends the game at 20 VP', () => {
    const s = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 6062, AIM_FOR_THE_MOON);
    expect(s.anomaly).toBe(AIM_FOR_THE_MOON);
    const [a, b, c] = s.playerOrder;

    const hit = checkEndCondition(withVp(s, { [a]: 20, [b]: 0, [c]: 0 }));
    expect(hit.ended).toBe(true);
    expect(hit.reason).not.toBeNull();

    expect(checkEndCondition(withVp(s, { [a]: 25, [b]: 0, [c]: 0 })).ended).toBe(true);
  });

  test('B87: Aim for the Moon does not end the game with nobody scoring', () => {
    const s = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 6063, AIM_FOR_THE_MOON);
    const [a, b, c] = s.playerOrder;
    const res = checkEndCondition(withVp(s, { [a]: 0, [b]: 0, [c]: 0 }));
    expect(res.ended).toBe(false);
    expect(res.reason).toBeNull();
  });

  test('B88: Battle Royale is not selectable in a 2-player match', () => {
    const s = createMatch(CFG(2, { anomalyChance: 1 }), SEATS(2), 5050, BATTLE_ROYALE);
    expect(s.anomaly).not.toBe(BATTLE_ROYALE);
    for (const p of s.playerOrder) {
      expect(s.players[p].eliminated).toBe(false);
    }
  });

  test('B88: a 2-player table never eliminates anyone, however many turns pass', () => {
    const s = createMatch(CFG(2, { anomalyChance: 1 }), SEATS(2), 5051, BATTLE_ROYALE);
    const done = passTurns(s, 40);
    const eliminated = done.playerOrder.filter((p) => done.players[p].eliminated);
    expect(eliminated).toHaveLength(0);
  });

  test('B88: Battle Royale is selectable with 3 players and eliminates nobody before turn 15', () => {
    const s = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 5052, BATTLE_ROYALE);
    expect(s.anomaly).toBe(BATTLE_ROYALE);

    const mid = passTurns(s, 13);
    expect(mid.playerOrder.filter((p) => mid.players[p].eliminated)).toHaveLength(0);
  });

  test('B88: Battle Royale eliminates exactly the lowest-VP player at turn 15', () => {
    const fresh = createMatch(CFG(3, { anomalyChance: 1 }), SEATS(3), 5053, BATTLE_ROYALE);
    expect(fresh.anomaly).toBe(BATTLE_ROYALE);
    const [a, b, c] = fresh.playerOrder;
    const s = withVp(fresh, { [a]: 0, [b]: 6, [c]: 12 });

    let cur = s;
    for (let i = 0; i < 20 && !isGameOver(cur) && cur.turn <= 16; i++) {
      cur = reduce(cur, { type: 'endTurn', player: cur.activePlayer });
    }

    const eliminated = cur.playerOrder.filter((p) => cur.players[p].eliminated);
    expect(eliminated).toHaveLength(1);
    expect(eliminated[0]).toBe(a);
  });

  test('B91: countdown reads winCondition.x and does not end the game early', () => {
    const cfg = CFG(2, {
      winCondition: { kind: 'countdown', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: 8 },
    });
    const s = createMatch(cfg, SEATS(2), 3030, null);
    const at = (t: number) => {
      const c = structuredClone(s) as GameState;
      c.turn = t;
      return checkEndCondition(c);
    };
    expect(at(1).ended).toBe(false);
    expect(at(7).ended).toBe(false);
    expect(at(9).ended).toBe(true);
    expect(at(9).reason).not.toBeNull();
  });

  test('B91: duel reads winCondition.x as a VP lead', () => {
    const cfg = CFG(3, {
      winCondition: { kind: 'duel', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: 6 },
    });
    const s = createMatch(cfg, SEATS(3), 3031, null);
    const [a, b, c] = s.playerOrder;

    expect(checkEndCondition(withVp(s, { [a]: 5, [b]: 0, [c]: 0 })).ended).toBe(false);
    const hit = checkEndCondition(withVp(s, { [a]: 6, [b]: 0, [c]: 0 }));
    expect(hit.ended).toBe(true);
    expect(hit.reason).not.toBeNull();
  });

  test('B91: crown reads winCondition.x as a VP target', () => {
    const cfg = CFG(3, {
      winCondition: { kind: 'crown', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: 25 },
    });
    const s = createMatch(cfg, SEATS(3), 3032, null);
    const [a, b, c] = s.playerOrder;

    expect(checkEndCondition(withVp(s, { [a]: 0, [b]: 0, [c]: 0 })).ended).toBe(false);
    const hit = checkEndCondition(withVp(s, { [a]: 25, [b]: 0, [c]: 0 }));
    expect(hit.ended).toBe(true);
    expect(hit.reason).not.toBeNull();
  });

  test('B91: every variant still falls back to the Jlore pile emptying', () => {
    for (const kind of ['countdown', 'duel', 'crown'] as const) {
      const cfg = CFG(3, {
        winCondition: { kind, emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: 9999 },
      });
      const s = createMatch(cfg, SEATS(3), 3033, null);

      expect(checkEndCondition(s).ended).toBe(false);

      const drained = structuredClone(s) as GameState;
      drained.shop.piles[jlorePileId(s)].cards = [];
      const res = checkEndCondition(drained);
      expect(res.ended).toBe(true);
      expect(res.reason).not.toBeNull();
    }
  });
});
