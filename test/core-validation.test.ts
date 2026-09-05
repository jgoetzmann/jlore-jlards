/**
 * T1 - core rules and determinism.
 * Behaviors covered here: B18, B19, B20, B25.
 *
 * The frozen convention `error.style: return state unchanged and append a
 * LogEntry, never throw across reduce` means "unchanged" is asserted over
 * everything except `log` and `logSeq`.
 */
import { describe, expect, test } from 'vitest';
import { createMatch, legalActions, reduce } from '@engine/index';
import { getCard, registerCards } from '@engine/registry';
import { canBuy, costOf } from '@engine/shop/index';
import type {
  CardDefId,
  CardDefinition,
  GameAction,
  GameState,
  InstanceId,
  MatchConfig,
  Pile,
  PileId,
  PlayerId,
  PlayerState,
} from '@engine/types';

// --------------------------------------------------------------------------
// inline fixtures
// --------------------------------------------------------------------------

function makeConfig(over: Partial<MatchConfig> = {}): MatchConfig {
  return {
    playerCount: 2,
    draftPileCount: 10,
    anomalyChance: 0,
    winCondition: {
      kind: 'standard',
      emptyPileFraction: 0.4,
      emptyPileAbsolute: 4,
      x: null,
    },
    pileSizeScale: 1,
    effectNodeBudget: 500,
    recursionDepth: 8,
    turnSeconds: 60,
    seedCodexWithCommons: true,
    ...over,
  };
}

function makePlayers(count: number): { id: PlayerId; name: string; codex: CardDefId[] }[] {
  const names = ['Ada', 'Bo', 'Cyd'];
  const out: { id: PlayerId; name: string; codex: CardDefId[] }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ id: `p${i + 1}`, name: names[i] ?? `P${i + 1}`, codex: [] });
  }
  return out;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function newMatch(playerCount = 2, seed = 777001): GameState {
  return clone(createMatch(makeConfig({ playerCount }), makePlayers(playerCount), seed, null));
}

function withoutLog(state: GameState): Record<string, unknown> {
  const copy = clone(state) as unknown as Record<string, unknown>;
  delete copy.log;
  delete copy.logSeq;
  return copy;
}

function P(state: GameState, id: PlayerId): PlayerState {
  const player = state.players[id];
  if (!player) throw new Error(`no such player: ${id}`);
  return player;
}

function pileOf(state: GameState, id: PileId): Pile {
  const pile = state.shop.piles[id];
  if (!pile) throw new Error(`no such pile: ${id}`);
  return pile;
}

function otherPlayer(state: GameState, id: PlayerId): PlayerId {
  const other = state.playerOrder.find((p) => p !== id);
  if (!other) throw new Error('match has only one player');
  return other;
}

let testCardSeq = 0;

function inertActionDef(id: CardDefId): CardDefinition {
  return {
    id,
    name: id,
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [],
    triggers: [],
    text: 'A test card that does nothing.',
    complexity: 'T1',
    subsystems: ['test'],
    notPurchasable: true,
    excludeFromPools: true,
  };
}

function mintInHand(state: GameState, def: CardDefinition, owner: PlayerId): InstanceId {
  registerCards([def]);
  const iid: InstanceId = `t_${def.id}_${testCardSeq++}`;
  state.instances[iid] = {
    iid,
    defId: def.id,
    owner,
    zone: 'hand',
    addedKeywords: [],
    removedKeywords: [],
    counters: {},
    statDelta: {},
    extraEffects: [],
    playedOnTurn: null,
  };
  P(state, owner).hand.push(iid);
  return iid;
}

/** Cheapest pile that actually costs money, so affordability is testable. */
function payablePile(state: GameState, buyer: PlayerId): PileId {
  const ids = [...state.shop.order.resource, ...state.shop.order.points];
  let best: { id: PileId; cost: number } | null = null;
  for (const id of ids) {
    const pile = pileOf(state, id);
    if (pile.cards.length === 0) continue;
    const cost = costOf(state, id, buyer);
    if (cost <= 0) continue;
    if (best === null || cost < best.cost) best = { id, cost };
  }
  if (!best) throw new Error('no payable pile in the resource or points shop');
  return best.id;
}

// --------------------------------------------------------------------------
// B18 - playing with no Actions is rejected
// --------------------------------------------------------------------------

describe('B18 - a play with no Actions remaining is rejected', () => {
  test('B18: playing an Action card with 0 Actions returns the state unchanged', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(state, inertActionDef('test_b18_no_actions'), player);
    P(state, player).actions = 0;

    const next = reduce(state, { type: 'play', player, iid });

    expect(withoutLog(next)).toEqual(withoutLog(state));
  });

  test('B18: a rejected play leaves the card in hand and out of playedThisTurn', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(state, inertActionDef('test_b18_stays_in_hand'), player);
    P(state, player).actions = 0;

    const next = reduce(state, { type: 'play', player, iid });

    expect(P(next, player).hand).toContain(iid);
    expect(P(next, player).play).not.toContain(iid);
    expect(P(next, player).playedThisTurn).not.toContain(iid);
    expect(next.instances[iid]?.zone).toBe('hand');
  });

  test('B18: a rejected play appends a LogEntry and changes nothing else', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(state, inertActionDef('test_b18_logs'), player);
    P(state, player).actions = 0;

    const next = reduce(state, { type: 'play', player, iid });

    expect(next.log.length).toBeGreaterThan(state.log.length);
    expect(withoutLog(next)).toEqual(withoutLog(state));
  });

  test('B18: the play that spends the last Action succeeds and the one after it is rejected', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const first = mintInHand(state, inertActionDef('test_b18_first'), player);
    const second = mintInHand(state, inertActionDef('test_b18_second'), player);

    const afterFirst = reduce(state, { type: 'play', player, iid: first });
    expect(P(afterFirst, player).actions).toBe(0);
    expect(P(afterFirst, player).hand).not.toContain(first);

    const afterSecond = reduce(afterFirst, { type: 'play', player, iid: second });

    expect(withoutLog(afterSecond)).toEqual(withoutLog(afterFirst));
  });

  test('B18: playing a card that is not in the hand at all is rejected and returns the state unchanged', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const notInHand = P(state, player).library[0]!;

    const next = reduce(state, { type: 'play', player, iid: notInHand });

    expect(withoutLog(next)).toEqual(withoutLog(state));
    expect(P(next, player).play).not.toContain(notInHand);
  });
});

// --------------------------------------------------------------------------
// B19 - an unaffordable buy is rejected
// --------------------------------------------------------------------------

describe('B19 - a buy the player cannot afford is rejected', () => {
  test('B19: buying one short of the cost returns the state unchanged', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const pileId = payablePile(state, player);
    P(state, player).money = costOf(state, pileId, player) - 1;

    const next = reduce(state, { type: 'buy', player, pileId });

    expect(withoutLog(next)).toEqual(withoutLog(state));
  });

  test('B19: a rejected buy leaves the pile untouched', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const pileId = payablePile(state, player);
    const before = [...pileOf(state, pileId).cards];
    P(state, player).money = 0;

    const next = reduce(state, { type: 'buy', player, pileId });

    expect(pileOf(next, pileId).cards).toEqual(before);
    expect(P(next, player).gy).toEqual(P(state, player).gy);
  });

  test('B19: a rejected buy spends neither a Buy nor any Money', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const pileId = payablePile(state, player);
    P(state, player).money = costOf(state, pileId, player) - 1;
    const moneyBefore = P(state, player).money;

    const next = reduce(state, { type: 'buy', player, pileId });

    expect(P(next, player).money).toBe(moneyBefore);
    expect(P(next, player).buys).toBe(1);
  });

  test('B19: a rejected buy appends a LogEntry and changes nothing else', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const pileId = payablePile(state, player);
    P(state, player).money = 0;

    const next = reduce(state, { type: 'buy', player, pileId });

    expect(next.log.length).toBeGreaterThan(state.log.length);
    expect(withoutLog(next)).toEqual(withoutLog(state));
  });

  test('B19: a buy at exactly the current cost is accepted', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const pileId = payablePile(state, player);
    const cost = costOf(state, pileId, player);
    P(state, player).money = cost;
    const top = pileOf(state, pileId).cards[0]!;

    const next = reduce(state, { type: 'buy', player, pileId });

    expect(P(next, player).money).toBe(0);
    expect(P(next, player).gy).toContain(top);
  });
});

// --------------------------------------------------------------------------
// B20 - out-of-turn actions are rejected
// --------------------------------------------------------------------------

describe('B20 - an action from a player who is not the active player is rejected', () => {
  test('B20: an out-of-turn play returns the state unchanged', () => {
    const state = newMatch();
    const inactive = otherPlayer(state, state.activePlayer);
    const iid = mintInHand(state, inertActionDef('test_b20_play'), inactive);

    const next = reduce(state, { type: 'play', player: inactive, iid });

    expect(withoutLog(next)).toEqual(withoutLog(state));
    expect(P(next, inactive).hand).toContain(iid);
  });

  test('B20: an out-of-turn buy returns the state unchanged', () => {
    const state = newMatch();
    const inactive = otherPlayer(state, state.activePlayer);
    P(state, inactive).money = 50;
    const pileId = payablePile(state, inactive);
    const top = pileOf(state, pileId).cards[0]!;

    const next = reduce(state, { type: 'buy', player: inactive, pileId });

    expect(withoutLog(next)).toEqual(withoutLog(state));
    expect(pileOf(next, pileId).cards).toContain(top);
    expect(P(next, inactive).money).toBe(50);
  });

  test('B20: an out-of-turn endTurn returns the state unchanged and does not pass the seat', () => {
    const state = newMatch();
    const active = state.activePlayer;
    const inactive = otherPlayer(state, active);

    const next = reduce(state, { type: 'endTurn', player: inactive });

    expect(withoutLog(next)).toEqual(withoutLog(state));
    expect(next.activePlayer).toBe(active);
    expect(next.turn).toBe(state.turn);
  });

  test('B20: an out-of-turn reorderHand returns the state unchanged', () => {
    const state = newMatch();
    const inactive = otherPlayer(state, state.activePlayer);
    const reversed = [...P(state, inactive).hand].reverse();

    const next = reduce(state, { type: 'reorderHand', player: inactive, hand: reversed });

    expect(withoutLog(next)).toEqual(withoutLog(state));
    expect(P(next, inactive).hand).toEqual(P(state, inactive).hand);
  });

  test('B20: an action from a player id that is not in the match is rejected', () => {
    const state = newMatch();

    const next = reduce(state, { type: 'endTurn', player: 'not_a_seat_in_this_match' });

    expect(withoutLog(next)).toEqual(withoutLog(state));
    expect(next.activePlayer).toBe(state.activePlayer);
  });

  test('B20: an out-of-turn action from the third seat is rejected too', () => {
    const state = newMatch(3);
    const active = state.activePlayer;
    const third = state.playerOrder.filter((p) => p !== active)[1]!;
    P(state, third).money = 50;
    const pileId = payablePile(state, third);

    const next = reduce(state, { type: 'buy', player: third, pileId });

    expect(withoutLog(next)).toEqual(withoutLog(state));
  });

  test('B20: a rejected out-of-turn action appends a LogEntry and changes nothing else', () => {
    const state = newMatch();
    const inactive = otherPlayer(state, state.activePlayer);

    const next = reduce(state, { type: 'endTurn', player: inactive });

    expect(next.log.length).toBeGreaterThan(state.log.length);
    expect(withoutLog(next)).toEqual(withoutLog(state));
  });
});

// --------------------------------------------------------------------------
// B25 - legalActions never offers something reduce would reject
// --------------------------------------------------------------------------

describe('B25 - legalActions never returns an action reduce would reject', () => {
  test('B25: legalActions offers at least one action to the active player of a fresh match', () => {
    const state = newMatch();

    const actions = legalActions(state, state.activePlayer);

    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('B25: every action legalActions returns is accepted by reduce', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const offered = legalActions(state, player).filter((a) => a.type !== 'reorderHand');
    expect(offered.length).toBeGreaterThan(0);

    for (const action of offered) {
      const next = reduce(state, action);
      expect(withoutLog(next)).not.toEqual(withoutLog(state));
    }
  });

  test('B25: legalActions offers nothing to a player who is not the active player', () => {
    const state = newMatch();
    const inactive = otherPlayer(state, state.activePlayer);
    expect(state.pending).toBeNull();

    expect(legalActions(state, inactive)).toEqual([]);
  });

  test('B25: legalActions never offers a buy the player cannot afford', () => {
    const state = newMatch();
    const player = state.activePlayer;
    P(state, player).money = 0;

    for (const action of legalActions(state, player)) {
      if (action.type !== 'buy') continue;
      expect(canBuy(state, action.pileId, player)).toBe(true);
      const next = reduce(state, action);
      expect(withoutLog(next)).not.toEqual(withoutLog(state));
    }
  });

  test('B25: legalActions never offers playing an Action card when no Actions remain', () => {
    const state = newMatch();
    const player = state.activePlayer;
    mintInHand(state, inertActionDef('test_b25_unplayable'), player);
    P(state, player).actions = 0;

    for (const action of legalActions(state, player)) {
      if (action.type !== 'play') continue;
      const inst = state.instances[action.iid];
      expect(inst).toBeDefined();
      expect(getCard(inst!.defId).types).not.toContain('Action');
    }
  });

  test('B25: legalActions never offers playing a card that is not in the player hand', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const hand = P(state, player).hand;

    for (const action of legalActions(state, player)) {
      if (action.type !== 'play') continue;
      expect(hand).toContain(action.iid);
    }
  });

  test('B25: legalActions never offers a buy from an empty pile', () => {
    const state = newMatch();
    const player = state.activePlayer;
    P(state, player).money = 99;
    const pileId = state.shop.order.draft[0]!;
    const pile = pileOf(state, pileId);
    for (const iid of pile.cards) delete state.instances[iid];
    pile.cards = [];

    for (const action of legalActions(state, player)) {
      if (action.type !== 'buy') continue;
      expect(action.pileId).not.toBe(pileId);
    }
  });

  test('B25: legalActions never offers an action attributed to another player', () => {
    const state = newMatch(3);
    const player = state.activePlayer;

    for (const action of legalActions(state, player)) {
      if (action.type === 'start') continue;
      expect((action as unknown as { player: PlayerId }).player).toBe(player);
    }
  });

  test('B25: an action legalActions did not offer for an inactive seat is rejected by reduce', () => {
    const state = newMatch();
    const inactive = otherPlayer(state, state.activePlayer);
    const invented: GameAction = { type: 'endTurn', player: inactive };

    expect(legalActions(state, inactive)).not.toContainEqual(invented);
    expect(withoutLog(reduce(state, invented))).toEqual(withoutLog(state));
  });
});
