import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { canBuy } from '@engine/shop';
import { resolveEffects } from '@engine/effects';
import type { EffectContext } from '@engine/effects';
import { getCard } from '@engine/registry';
import type {
  CardDefId,
  CardDefinition,
  EffectNode,
  GameState,
  MatchConfig,
  PileId,
  PlayerId,
} from '@engine/types';

// --- inline fixtures -------------------------------------------------------

const LION_ID: CardDefId = 'the_unconcerned_lion';

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function mkConfig(over: Partial<MatchConfig> = {}): MatchConfig {
  return {
    playerCount: 2,
    draftPileCount: 10,
    anomalyChance: 0,
    winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
    pileSizeScale: 1,
    effectNodeBudget: 500,
    recursionDepth: 8,
    turnSeconds: 90,
    seedCodexWithCommons: true,
    ...over,
  };
}

function mkMatch(seed: number, over: Partial<MatchConfig> = {}): GameState {
  return createMatch(
    mkConfig(over),
    [
      { id: 'p1', name: 'One', codex: [] },
      { id: 'p2', name: 'Two', codex: [] },
    ],
    seed,
    null,
  );
}

function topDefId(s: GameState, pileId: PileId): CardDefId {
  return s.instances[s.shop.piles[pileId]!.cards[0]!]!.defId;
}

function pileByName(s: GameState, shop: 'resource' | 'points', name: string): PileId {
  const found = s.shop.order[shop].find((id) => getCard(topDefId(s, id)).name === name);
  if (!found) throw new Error('no ' + shop + ' pile printing ' + name);
  return found;
}

interface ProphetPile {
  pileId: PileId;
  def: CardDefinition;
  threshold: number;
  drain: number;
}

function prophetPiles(s: GameState): ProphetPile[] {
  return s.shop.order.prophet.map((pileId) => {
    const def = getCard(topDefId(s, pileId));
    return {
      pileId,
      def,
      threshold: def.cost.prophet?.threshold ?? 0,
      drain: def.cost.prophet?.drain ?? 0,
    };
  });
}

/** A Prophet pile with a real threshold and no on-buy side effects to muddy the numbers. */
function plainProphet(s: GameState): ProphetPile {
  const found = prophetPiles(s).find(
    (p) =>
      p.def.id !== LION_ID &&
      p.threshold > 0 &&
      !p.def.keywords.includes('PlayOnBuy') &&
      p.def.triggers.every((t) => t.on !== 'onBuy' && t.on !== 'onGain'),
  );
  if (!found) throw new Error('no plain Prophet pile in the shop');
  return found;
}

function lionPile(s: GameState): ProphetPile {
  const found = prophetPiles(s).find((p) => p.def.id === LION_ID);
  if (!found) throw new Error('The Unconcerned Lion is not in the Prophet Shop');
  return found;
}

function ctxFor(player: PlayerId): EffectContext {
  return { player, sourceIid: null, depth: 0, multiplier: 1, vars: {} };
}

// --- B57 -------------------------------------------------------------------

describe('B57 - Prophet cards are gated by threshold', () => {
  test('B57: the Prophet Shop is stocked and every pile in it prints a prophet cost', () => {
    const s = mkMatch(61);
    const piles = prophetPiles(s);
    expect(piles.length).toBeGreaterThan(0);
    for (const p of piles) {
      expect(p.def.cost.prophet).toBeDefined();
    }
  });

  test('B57: canBuy is false when banked Prophet is one short of the threshold', () => {
    const s0 = mkMatch(62);
    const me = s0.activePlayer;
    const target = plainProphet(s0);

    const s = clone(s0);
    s.players[me]!.prophet = target.threshold - 1;
    s.players[me]!.money = 100;
    s.players[me]!.buys = 1;

    expect(canBuy(s, target.pileId, me)).toBe(false);
  });

  test('B57: reduce rejects a Prophet buy below threshold and changes nothing', () => {
    const s0 = mkMatch(63);
    const me = s0.activePlayer;
    const target = plainProphet(s0);

    const s = clone(s0);
    s.players[me]!.prophet = target.threshold - 1;
    s.players[me]!.money = 100;
    s.players[me]!.buys = 1;

    const pileBefore = [...s.shop.piles[target.pileId]!.cards];
    const gyBefore = [...s.players[me]!.gy];
    const after = reduce(s, { type: 'buy', player: me, pileId: target.pileId });

    expect(after.shop.piles[target.pileId]!.cards).toEqual(pileBefore);
    expect(after.players[me]!.gy).toEqual(gyBefore);
    expect(after.players[me]!.prophet).toBe(target.threshold - 1);
    expect(after.players[me]!.buys).toBe(1);
  });

  test('B57: no Prophet pile with a threshold is buyable at 0 banked Prophet', () => {
    const s0 = mkMatch(64);
    const me = s0.activePlayer;
    const s = clone(s0);
    s.players[me]!.prophet = 0;
    s.players[me]!.money = 100;
    s.players[me]!.buys = 5;

    const gated = prophetPiles(s).filter((p) => p.threshold > 0);
    expect(gated.length).toBeGreaterThan(0);
    for (const p of gated) {
      expect(canBuy(s, p.pileId, me)).toBe(false);
    }
  });

  test('B57: at exactly the threshold the Prophet card becomes buyable', () => {
    const s0 = mkMatch(65);
    const me = s0.activePlayer;
    const target = plainProphet(s0);

    const s = clone(s0);
    s.players[me]!.prophet = target.threshold;
    s.players[me]!.money = 0;
    s.players[me]!.buys = 1;

    expect(canBuy(s, target.pileId, me)).toBe(true);
    const top = s.shop.piles[target.pileId]!.cards[0]!;
    const after = reduce(s, { type: 'buy', player: me, pileId: target.pileId });
    expect(after.players[me]!.gy).toContain(top);
  });
});

// --- B58 -------------------------------------------------------------------

describe('B58 - a Prophet purchase drains Prophet, not Money', () => {
  test('B58: buying a Prophet card subtracts exactly its drain from banked Prophet', () => {
    const s0 = mkMatch(66);
    const me = s0.activePlayer;
    const target = plainProphet(s0);

    const s = clone(s0);
    s.players[me]!.prophet = target.threshold + target.drain;
    s.players[me]!.money = 0;
    s.players[me]!.buys = 1;

    const after = reduce(s, { type: 'buy', player: me, pileId: target.pileId });
    expect(after.players[me]!.prophet).toBe(target.threshold);
  });

  test('B58: a Prophet purchase costs no Money', () => {
    const s0 = mkMatch(67);
    const me = s0.activePlayer;
    const target = plainProphet(s0);

    const s = clone(s0);
    s.players[me]!.prophet = target.threshold + target.drain;
    s.players[me]!.money = 4;
    s.players[me]!.buys = 1;

    const after = reduce(s, { type: 'buy', player: me, pileId: target.pileId });
    expect(after.players[me]!.money).toBe(4);
  });

  test('B58: a Prophet card is buyable with 0 Money in hand', () => {
    const s0 = mkMatch(68);
    const me = s0.activePlayer;
    const target = plainProphet(s0);

    const s = clone(s0);
    s.players[me]!.prophet = target.threshold + target.drain;
    s.players[me]!.money = 0;
    s.players[me]!.buys = 1;

    expect(canBuy(s, target.pileId, me)).toBe(true);
    const top = s.shop.piles[target.pileId]!.cards[0]!;
    const after = reduce(s, { type: 'buy', player: me, pileId: target.pileId });
    expect(after.players[me]!.gy).toContain(top);
    expect(after.players[me]!.money).toBe(0);
  });
});

// --- B59 -------------------------------------------------------------------

describe('B59 - a Prophet purchase does not consume a Buy', () => {
  test('B59: Buys are unchanged by a Prophet purchase', () => {
    const s0 = mkMatch(69);
    const me = s0.activePlayer;
    const target = plainProphet(s0);

    const s = clone(s0);
    s.players[me]!.prophet = target.threshold + target.drain;
    s.players[me]!.money = 0;
    s.players[me]!.buys = 1;

    const after = reduce(s, { type: 'buy', player: me, pileId: target.pileId });
    expect(after.players[me]!.buys).toBe(1);
  });

  test('B59: a Prophet purchase leaves the buyer able to buy a Resource in the same turn', () => {
    const s0 = mkMatch(70);
    const me = s0.activePlayer;
    const target = plainProphet(s0);
    const copper = pileByName(s0, 'resource', 'Copper');

    const s = clone(s0);
    s.players[me]!.prophet = target.threshold + target.drain;
    s.players[me]!.money = 5;
    s.players[me]!.buys = 1;

    const bought = reduce(s, { type: 'buy', player: me, pileId: target.pileId });
    expect(bought.players[me]!.buys).toBe(1);

    const top = bought.shop.piles[copper]!.cards[0]!;
    const after = reduce(bought, { type: 'buy', player: me, pileId: copper });
    expect(after.players[me]!.gy).toContain(top);
    expect(after.players[me]!.buys).toBe(0);
  });

  test('B59: a Prophet purchase with 0 Buys remaining is still allowed', () => {
    const s0 = mkMatch(71);
    const me = s0.activePlayer;
    const target = plainProphet(s0);

    const s = clone(s0);
    s.players[me]!.prophet = target.threshold + target.drain;
    s.players[me]!.money = 0;
    s.players[me]!.buys = 0;

    const top = s.shop.piles[target.pileId]!.cards[0]!;
    const after = reduce(s, { type: 'buy', player: me, pileId: target.pileId });
    expect(after.players[me]!.gy).toContain(top);
    expect(after.players[me]!.buys).toBe(0);
  });
});

// --- B60 -------------------------------------------------------------------

describe('B60 - Prophet persists and is clamped at 0', () => {
  test('B60: banked Prophet does not reset between turns', () => {
    const s0 = mkMatch(72);
    const me = s0.activePlayer;

    const s = clone(s0);
    s.players[me]!.prophet = 7;

    let cur = reduce(s, { type: 'endTurn', player: me });
    expect(cur.players[me]!.prophet).toBe(7);
    cur = reduce(cur, { type: 'endTurn', player: cur.activePlayer });
    expect(cur.activePlayer).toBe(me);
    expect(cur.players[me]!.prophet).toBe(7);
  });

  test('B60: Prophet is clamped at 0 when an effect would drive it negative', () => {
    const s0 = mkMatch(73);
    const me = s0.activePlayer;

    const s = clone(s0);
    s.players[me]!.prophet = 3;
    const nodes: EffectNode[] = [{ op: 'gain', stat: 'prophet', amount: -10 }];
    const after = resolveEffects(s, nodes, ctxFor(me));
    expect(after.players[me]!.prophet).toBe(0);
  });

  test('B60: Prophet already at 0 stays at 0 rather than going negative', () => {
    const s0 = mkMatch(74);
    const me = s0.activePlayer;

    const s = clone(s0);
    s.players[me]!.prophet = 0;
    const nodes: EffectNode[] = [{ op: 'gain', stat: 'prophet', amount: -1 }];
    const after = resolveEffects(s, nodes, ctxFor(me));
    expect(after.players[me]!.prophet).toBe(0);
  });
});

// --- B61 -------------------------------------------------------------------

describe('B61 - only The Unconcerned Lion may be bought into negative Prophet', () => {
  test('B61: The Unconcerned Lion is in the Prophet Shop and drains more than its threshold', () => {
    const s = mkMatch(75);
    const lion = lionPile(s);
    expect(lion.def.name).toBe('The Unconcerned Lion');
    expect(lion.def.cost.prophet).toBeDefined();
    expect(lion.drain).toBeGreaterThan(lion.threshold);
  });

  test('B61: buying The Unconcerned Lion at exactly its threshold leaves Prophet negative', () => {
    const s0 = mkMatch(76);
    const me = s0.activePlayer;
    const lion = lionPile(s0);

    const s = clone(s0);
    s.players[me]!.prophet = lion.threshold;
    s.players[me]!.money = 0;
    s.players[me]!.buys = 1;

    const top = s.shop.piles[lion.pileId]!.cards[0]!;
    const after = reduce(s, { type: 'buy', player: me, pileId: lion.pileId });
    expect(after.players[me]!.gy).toContain(top);
    expect(after.players[me]!.prophet).toBe(lion.threshold - lion.drain);
    expect(after.players[me]!.prophet).toBeLessThan(0);
  });

  test('B61: no other Prophet card can be bought into negative Prophet', () => {
    const s0 = mkMatch(77);
    const me = s0.activePlayer;
    const others = prophetPiles(s0).filter((p) => p.def.id !== LION_ID);
    expect(others.length).toBeGreaterThan(0);

    for (const p of others) {
      const s = clone(s0);
      s.players[me]!.prophet = p.threshold;
      s.players[me]!.money = 0;
      s.players[me]!.buys = 1;
      const after = reduce(s, { type: 'buy', player: me, pileId: p.pileId });
      expect(after.players[me]!.prophet).toBeGreaterThanOrEqual(0);
    }
  });
});
