import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { canBuy, isLocked } from '@engine/shop';
import { resolveEffects } from '@engine/effects';
import type { EffectContext } from '@engine/effects';
import { getCard } from '@engine/registry';
import type {
  CardDefId,
  EffectNode,
  GameState,
  MatchConfig,
  PileId,
  PlayerId,
} from '@engine/types';

// --- inline fixtures -------------------------------------------------------

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

function ctxFor(player: PlayerId): EffectContext {
  return { player, sourceIid: null, depth: 0, multiplier: 1, vars: {} };
}

function advanceToTurn(s: GameState, target: number): GameState {
  let cur = s;
  let guard = 30;
  while (cur.turn < target && guard > 0) {
    guard -= 1;
    const next = reduce(cur, { type: 'endTurn', player: cur.activePlayer });
    expect(next.turn).toBeGreaterThan(cur.turn);
    cur = next;
  }
  expect(cur.turn).toBe(target);
  return cur;
}

function lockPileManually(s: GameState, pileId: PileId, by: PlayerId, expiresOnTurn: number): GameState {
  const n = clone(s);
  n.shop.piles[pileId]!.locks.push({
    by,
    duration: { turns: expiresOnTurn - s.turn },
    expiresOnTurn,
  });
  return n;
}

// --- B50 -------------------------------------------------------------------

describe('B50 - a locked pile cannot be bought from', () => {
  test('B50: canBuy is true for an affordable pile and false once that pile is locked', () => {
    const s0 = mkMatch(21);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');

    const open = clone(s0);
    open.players[me]!.money = 10;
    open.players[me]!.buys = 1;
    expect(isLocked(open, copper)).toBe(false);
    expect(canBuy(open, copper, me)).toBe(true);

    const shut = lockPileManually(open, copper, me, open.turn + 2);
    expect(isLocked(shut, copper)).toBe(true);
    expect(canBuy(shut, copper, me)).toBe(false);
  });

  test('B50: reduce rejects a buy from a locked pile and leaves pile, GY, Buys and Money unchanged', () => {
    const s0 = mkMatch(22);
    const me = s0.activePlayer;
    const other = s0.playerOrder.find((p) => p !== me)!;
    const copper = pileByName(s0, 'resource', 'Copper');

    let s = clone(s0);
    s.players[me]!.money = 10;
    s.players[me]!.buys = 1;
    s = lockPileManually(s, copper, other, s.turn + 2);

    const pileBefore = [...s.shop.piles[copper]!.cards];
    const gyBefore = [...s.players[me]!.gy];
    const after = reduce(s, { type: 'buy', player: me, pileId: copper });

    expect(after.shop.piles[copper]!.cards).toEqual(pileBefore);
    expect(after.players[me]!.gy).toEqual(gyBefore);
    expect(after.players[me]!.buys).toBe(1);
    expect(after.players[me]!.money).toBe(10);
  });

  test('B50: the player who owns the lock is blocked by it too', () => {
    const s0 = mkMatch(23);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');

    let s = clone(s0);
    s.players[me]!.money = 10;
    s.players[me]!.buys = 2;
    s = lockPileManually(s, copper, me, s.turn + 2);

    expect(canBuy(s, copper, me)).toBe(false);
    const pileBefore = [...s.shop.piles[copper]!.cards];
    const after = reduce(s, { type: 'buy', player: me, pileId: copper });
    expect(after.shop.piles[copper]!.cards).toEqual(pileBefore);
    expect(after.players[me]!.buys).toBe(2);
  });

  test('B50: locking one pile does not block any other pile', () => {
    const s0 = mkMatch(24);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');
    const silver = pileByName(s0, 'resource', 'Silver');

    let s = clone(s0);
    s.players[me]!.money = 10;
    s.players[me]!.buys = 1;
    s = lockPileManually(s, copper, me, s.turn + 2);

    expect(isLocked(s, silver)).toBe(false);
    expect(canBuy(s, silver, me)).toBe(true);
    const after = reduce(s, { type: 'buy', player: me, pileId: silver });
    expect(after.players[me]!.gy.length).toBe(s.players[me]!.gy.length + 1);
  });
});

// --- B51 -------------------------------------------------------------------

describe('B51 - a lock carries an owner and a duration and expires on the turn it names', () => {
  test('B51: a lock records the player who created it and the duration it was given', () => {
    const s0 = mkMatch(25);
    const owner = s0.activePlayer;
    const nodes: EffectNode[] = [
      { op: 'lockPile', target: { shop: 'resource' }, duration: { turns: 2 } },
    ];
    const after = resolveEffects(s0, nodes, ctxFor(owner));

    const lockedIds = s0.shop.order.resource.filter((id) => after.shop.piles[id]!.locks.length > 0);
    expect(lockedIds.length).toBeGreaterThan(0);
    for (const id of lockedIds) {
      const lock = after.shop.piles[id]!.locks[0]!;
      expect(lock.by).toBe(owner);
      expect(lock.duration).toEqual({ turns: 2 });
      expect(typeof lock.expiresOnTurn).toBe('number');
      expect(lock.expiresOnTurn!).toBeGreaterThan(after.turn);
      expect(isLocked(after, id)).toBe(true);
    }
  });

  test('B51: a pile stays locked on every turn before the one the lock names', () => {
    const s0 = mkMatch(26);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');
    const expiry = s0.turn + 2;

    const locked = lockPileManually(s0, copper, me, expiry);
    expect(isLocked(locked, copper)).toBe(true);

    const nextTurn = advanceToTurn(locked, expiry - 1);
    expect(nextTurn.turn).toBeLessThan(expiry);
    expect(isLocked(nextTurn, copper)).toBe(true);
    expect(canBuy(nextTurn, copper, me)).toBe(false);
  });

  test('B51: a lock expires automatically on the turn it names', () => {
    const s0 = mkMatch(27);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');
    const expiry = s0.turn + 2;

    const locked = lockPileManually(s0, copper, me, expiry);
    const arrived = advanceToTurn(locked, expiry);

    expect(arrived.turn).toBe(expiry);
    expect(isLocked(arrived, copper)).toBe(false);
    expect(canBuy(arrived, copper, me)).toBe(true);
  });

  test('B51: once the lock has expired reduce accepts the buy again', () => {
    const s0 = mkMatch(28);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');
    const expiry = s0.turn + 2;

    const locked = lockPileManually(s0, copper, me, expiry);
    const arrived = advanceToTurn(locked, expiry);
    expect(arrived.activePlayer).toBe(me);

    const top = arrived.shop.piles[copper]!.cards[0]!;
    const after = reduce(arrived, { type: 'buy', player: me, pileId: copper });
    expect(after.players[me]!.gy).toContain(top);
    expect(after.shop.piles[copper]!.cards).not.toContain(top);
  });
});
