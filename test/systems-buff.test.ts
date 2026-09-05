import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { applyBuff } from '@engine/systems';
import { makeRng } from '@engine/rng';
import { allCards, getCard } from '@engine/registry';
import { BUFFABLE_STATS } from '@engine/types';
import type {
  CardDefId,
  GameState,
  InstanceId,
  MatchConfig,
  PileId,
  PlayerId,
  StatKey,
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

function copperDefId(): CardDefId {
  const c = allCards().find((x) => x.name === 'Copper');
  if (!c) throw new Error('no Copper in the registry');
  return c.id;
}

function addToHand(s: GameState, defId: CardDefId, iid: InstanceId, owner: PlayerId): GameState {
  const n = clone(s);
  n.instances[iid] = {
    iid,
    defId,
    owner,
    zone: 'hand',
    addedKeywords: [],
    removedKeywords: [],
    counters: {},
    statDelta: {},
    extraEffects: [],
    playedOnTurn: null,
  };
  n.players[owner]!.hand.push(iid);
  return n;
}

/** Lift a specific instance out of a shop pile and into a player's hand. */
function takeFromPile(s: GameState, pileId: PileId, iid: InstanceId, owner: PlayerId): GameState {
  const n = clone(s);
  n.shop.piles[pileId]!.cards = n.shop.piles[pileId]!.cards.filter((c) => c !== iid);
  const inst = n.instances[iid]!;
  inst.zone = 'hand';
  inst.owner = owner;
  delete inst.pileId;
  n.players[owner]!.hand.push(iid);
  return n;
}

function moneyFromPlay(s: GameState, iid: InstanceId): number {
  const me = s.activePlayer;
  const before = s.players[me]!.money;
  const after = reduce(s, { type: 'play', player: me, iid });
  return after.players[me]!.money - before;
}

function actionsFromPlay(s: GameState, iid: InstanceId): number {
  const me = s.activePlayer;
  const before = s.players[me]!.actions;
  const after = reduce(s, { type: 'play', player: me, iid });
  return after.players[me]!.actions - before;
}

function twoCoppersInHand(seed: number): { s: GameState; me: PlayerId; defId: CardDefId } {
  const base = mkMatch(seed);
  const me = base.activePlayer;
  const defId = copperDefId();
  let s = addToHand(base, defId, 'test_cu_a', me);
  s = addToHand(s, defId, 'test_cu_b', me);
  return { s, me, defId };
}

function changedStats(delta: Record<string, number | undefined>): string[] {
  return Object.keys(delta).filter((k) => (delta[k] ?? 0) !== 0);
}

// --- B67 + B68, the pair ---------------------------------------------------

describe('B67 + B68 - allCopies versus instance', () => {
  test('B67 + B68: allCopies changes every copy while instance changes only the one it names', () => {
    const { s, defId } = twoCoppersInHand(101);
    const rng = makeRng(1, 0);

    const baseA = moneyFromPlay(s, 'test_cu_a');
    const baseB = moneyFromPlay(s, 'test_cu_b');
    expect(baseA).toBeGreaterThan(0);
    expect(baseB).toBe(baseA);

    // allCopies: both copies move.
    const all = applyBuff(s, 'allCopies', defId, 1, 'money', rng);
    expect(moneyFromPlay(all, 'test_cu_a')).toBe(baseA + 1);
    expect(moneyFromPlay(all, 'test_cu_b')).toBe(baseB + 1);
    expect(all.variants[defId]!.statDelta.money).toBe(1);

    // instance: only the named copy moves, and the variant is left alone.
    const one = applyBuff(s, 'instance', 'test_cu_a', 1, 'money', rng);
    expect(moneyFromPlay(one, 'test_cu_a')).toBe(baseA + 1);
    expect(moneyFromPlay(one, 'test_cu_b')).toBe(baseB);
    expect(one.instances['test_cu_a']!.statDelta.money).toBe(1);
    expect(one.instances['test_cu_b']!.statDelta.money ?? 0).toBe(0);
    expect(one.variants[defId]?.statDelta.money ?? 0).toBe(0);
  });
});

// --- B67 -------------------------------------------------------------------

describe('B67 - allCopies writes the match CardVariant', () => {
  test('B67: applyBuff allCopies records the delta on the definition variant', () => {
    const { s, defId } = twoCoppersInHand(102);
    const after = applyBuff(s, 'allCopies', defId, 1, 'money', makeRng(2, 0));
    expect(after.variants[defId]).toBeDefined();
    expect(after.variants[defId]!.defId).toBe(defId);
    expect(after.variants[defId]!.statDelta.money).toBe(1);
  });

  test('B67: applyBuff allCopies writes no per-instance statDelta', () => {
    const { s, defId } = twoCoppersInHand(103);
    const after = applyBuff(s, 'allCopies', defId, 1, 'money', makeRng(3, 0));
    for (const iid of Object.keys(after.instances)) {
      if (after.instances[iid]!.defId !== defId) continue;
      expect(changedStats(after.instances[iid]!.statDelta as Record<string, number>)).toEqual([]);
    }
  });

  test('B67: an allCopies buff reaches the copy sitting in a shop pile', () => {
    const s0 = mkMatch(104);
    const me = s0.activePlayer;
    const defId = copperDefId();
    const pileId = pileByName(s0, 'resource', 'Copper');
    const shopCopy = s0.shop.piles[pileId]!.cards[0]!;
    expect(s0.instances[shopCopy]!.defId).toBe(defId);

    const control = takeFromPile(s0, pileId, shopCopy, me);
    const base = moneyFromPlay(control, shopCopy);
    expect(base).toBeGreaterThan(0);

    const buffed = applyBuff(s0, 'allCopies', defId, 1, 'money', makeRng(4, 0));
    expect(buffed.shop.piles[pileId]!.cards).toContain(shopCopy);
    const taken = takeFromPile(buffed, pileId, shopCopy, me);
    expect(moneyFromPlay(taken, shopCopy)).toBe(base + 1);
  });

  test('B67: an allCopies nerf of -1 moves every copy down by one', () => {
    const { s, defId } = twoCoppersInHand(105);
    const base = moneyFromPlay(s, 'test_cu_a');
    const after = applyBuff(s, 'allCopies', defId, -1, 'money', makeRng(5, 0));
    expect(after.variants[defId]!.statDelta.money).toBe(-1);
    expect(moneyFromPlay(after, 'test_cu_a')).toBe(base - 1);
    expect(moneyFromPlay(after, 'test_cu_b')).toBe(base - 1);
  });

  test('B67: an allCopies buff on one definition leaves a different definition alone', () => {
    const s0 = mkMatch(106);
    const me = s0.activePlayer;
    const copper = copperDefId();
    const silver = allCards().find((c) => c.name === 'Silver');
    expect(silver).toBeDefined();

    const s = addToHand(s0, silver!.id, 'test_ag_a', me);
    const base = moneyFromPlay(s, 'test_ag_a');
    const after = applyBuff(s, 'allCopies', copper, 1, 'money', makeRng(6, 0));
    expect(moneyFromPlay(after, 'test_ag_a')).toBe(base);
    expect(after.variants[silver!.id]?.statDelta.money ?? 0).toBe(0);
  });
});

// --- B68 -------------------------------------------------------------------

describe('B68 - instance writes only that instance statDelta', () => {
  test('B68: applyBuff instance writes the named instance statDelta and nothing else', () => {
    const { s, defId } = twoCoppersInHand(107);
    const after = applyBuff(s, 'instance', 'test_cu_a', 1, 'money', makeRng(7, 0));
    expect(after.instances['test_cu_a']!.statDelta.money).toBe(1);
    expect(changedStats(after.instances['test_cu_b']!.statDelta as Record<string, number>)).toEqual(
      [],
    );
    expect(after.variants[defId]?.statDelta.money ?? 0).toBe(0);
  });

  test('B68: applyBuff instance with delta -1 records a negative statDelta', () => {
    const { s } = twoCoppersInHand(108);
    const base = moneyFromPlay(s, 'test_cu_a');
    const after = applyBuff(s, 'instance', 'test_cu_a', -1, 'money', makeRng(8, 0));
    expect(after.instances['test_cu_a']!.statDelta.money).toBe(-1);
    expect(moneyFromPlay(after, 'test_cu_a')).toBe(base - 1);
  });

  test('B68: two instance buffs on the same instance stack and still touch no other copy', () => {
    const { s } = twoCoppersInHand(109);
    const base = moneyFromPlay(s, 'test_cu_b');
    const once = applyBuff(s, 'instance', 'test_cu_a', 1, 'money', makeRng(9, 0));
    const twice = applyBuff(once, 'instance', 'test_cu_a', 1, 'money', makeRng(9, 0));
    expect(twice.instances['test_cu_a']!.statDelta.money).toBe(2);
    expect(moneyFromPlay(twice, 'test_cu_a')).toBe(base + 2);
    expect(moneyFromPlay(twice, 'test_cu_b')).toBe(base);
  });

  test('B68: an instance buff on a card in hand leaves the shop pile copies alone', () => {
    const s0 = mkMatch(110);
    const me = s0.activePlayer;
    const defId = copperDefId();
    const pileId = pileByName(s0, 'resource', 'Copper');
    const shopCopy = s0.shop.piles[pileId]!.cards[0]!;

    const s = addToHand(s0, defId, 'test_cu_a', me);
    const control = takeFromPile(s, pileId, shopCopy, me);
    const base = moneyFromPlay(control, shopCopy);

    const buffed = applyBuff(s, 'instance', 'test_cu_a', 1, 'money', makeRng(10, 0));
    const taken = takeFromPile(buffed, pileId, shopCopy, me);
    expect(moneyFromPlay(taken, shopCopy)).toBe(base);
    expect(changedStats(buffed.instances[shopCopy]!.statDelta as Record<string, number>)).toEqual(
      [],
    );
  });
});

// --- B69 -------------------------------------------------------------------

describe('B69 - a random buff picks one of the five buffable stats', () => {
  const picks = (seeds: number): string[] => {
    const { s } = twoCoppersInHand(111);
    const out: string[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const after = applyBuff(s, 'instance', 'test_cu_a', 1, null, makeRng(seed, 0));
      const keys = changedStats(after.instances['test_cu_a']!.statDelta as Record<string, number>);
      expect(keys).toHaveLength(1);
      out.push(keys[0]!);
    }
    return out;
  };

  test('B69: a random buff never picks prophet', () => {
    const chosen = picks(300);
    expect(chosen).not.toContain('prophet');
    expect(chosen.filter((stat) => stat === 'prophet')).toHaveLength(0);
  });

  test('B69: every random pick is one of the five stats in BUFFABLE_STATS', () => {
    const allowed = new Set<string>(BUFFABLE_STATS as readonly string[]);
    expect(allowed.size).toBe(5);
    expect(allowed.has('prophet')).toBe(false);
    for (const stat of picks(300)) {
      expect(allowed.has(stat)).toBe(true);
    }
  });

  test('B69: over many seeds all five buffable stats get picked, roughly evenly', () => {
    const chosen = picks(500);
    for (const stat of BUFFABLE_STATS) {
      const share = chosen.filter((k) => k === stat).length / chosen.length;
      expect(share).toBeGreaterThan(0.05);
      expect(share).toBeLessThan(0.5);
    }
  });

  test('B69: an explicit stat is always the stat written, whatever the rng', () => {
    const { s } = twoCoppersInHand(112);
    for (let seed = 1; seed <= 50; seed++) {
      const after = applyBuff(s, 'instance', 'test_cu_a', 1, 'buys', makeRng(seed, 0));
      expect(changedStats(after.instances['test_cu_a']!.statDelta as Record<string, number>)).toEqual(
        ['buys'],
      );
    }
  });
});

// --- B70 -------------------------------------------------------------------

describe('B70 - buffing a stat the card prints as 0', () => {
  test('B70: buffing a stat the card does not print adds that stat line', () => {
    const { s } = twoCoppersInHand(113);
    const printed = getCard(copperDefId()).stats;
    expect(printed.actions ?? 0).toBe(0);

    const after = applyBuff(s, 'instance', 'test_cu_a', 1, 'actions', makeRng(11, 0));
    expect(after.instances['test_cu_a']!.statDelta.actions).toBe(1);
  });

  test('B70: the added stat line actually pays out when the card is played', () => {
    const { s } = twoCoppersInHand(114);
    const base = actionsFromPlay(s, 'test_cu_a');
    const after = applyBuff(s, 'instance', 'test_cu_a', 1, 'actions', makeRng(12, 0));
    expect(actionsFromPlay(after, 'test_cu_a')).toBe(base + 1);
  });

  test('B70: buffing a printed-0 stat through allCopies adds the line to the variant', () => {
    const { s, defId } = twoCoppersInHand(115);
    const base = actionsFromPlay(s, 'test_cu_b');
    const after = applyBuff(s, 'allCopies', defId, 1, 'actions', makeRng(13, 0));
    expect(after.variants[defId]!.statDelta.actions).toBe(1);
    expect(actionsFromPlay(after, 'test_cu_b')).toBe(base + 1);
  });

  test('B70: buffing a printed-0 stat is not a no-op on any of the five stats', () => {
    const { s } = twoCoppersInHand(116);
    for (const stat of BUFFABLE_STATS as readonly StatKey[]) {
      const after = applyBuff(s, 'instance', 'test_cu_a', 1, stat, makeRng(14, 0));
      expect(after.instances['test_cu_a']!.statDelta[stat]).toBe(1);
    }
  });
});
