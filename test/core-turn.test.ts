/**
 * T1 - core rules and determinism.
 * Behaviors covered here: B4, B5, B6, B7, B8, B9, B13.
 *
 * Written from `.fullsend/SPEC.md` alone. Fixtures are inline on purpose.
 */
import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { getCard, registerCards } from '@engine/registry';
import { costOf } from '@engine/shop/index';
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
  Zone,
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
  const names = ['Ada', 'Bo', 'Cyd', 'Dot'];
  const out: { id: PlayerId; name: string; codex: CardDefId[] }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ id: `p${i + 1}`, name: names[i] ?? `P${i + 1}`, codex: [] });
  }
  return out;
}

function newMatch(playerCount = 2, seed = 991177): GameState {
  return createMatch(makeConfig({ playerCount }), makePlayers(playerCount), seed, null);
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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

function deckOf(state: GameState, id: PlayerId): InstanceId[] {
  const p = P(state, id);
  return [...p.library, ...p.hand, ...p.gy, ...p.play];
}

function endTurnBy(state: GameState): GameState {
  const action: GameAction = { type: 'endTurn', player: state.activePlayer };
  return reduce(state, action);
}

/** A card definition that does nothing but exist, so plays are predictable. */
let testCardSeq = 0;
function inertDef(over: Partial<CardDefinition> & { id: CardDefId }): CardDefinition {
  const base: CardDefinition = {
    id: over.id,
    name: over.id,
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
  return { ...base, ...over } as CardDefinition;
}

/** Registers `def` and drops a fresh instance of it into `zone` for `owner`. */
function mint(state: GameState, def: CardDefinition, owner: PlayerId, zone: Zone): InstanceId {
  registerCards([def]);
  const iid: InstanceId = `t_${def.id}_${testCardSeq++}`;
  state.instances[iid] = {
    iid,
    defId: def.id,
    owner,
    zone,
    addedKeywords: [],
    removedKeywords: [],
    counters: {},
    statDelta: {},
    extraEffects: [],
    playedOnTurn: null,
  };
  const p = P(state, owner);
  if (zone === 'hand') p.hand.push(iid);
  else if (zone === 'library') p.library.push(iid);
  else if (zone === 'gy') p.gy.push(iid);
  else if (zone === 'play') p.play.push(iid);
  else throw new Error(`mint does not handle zone ${zone}`);
  return iid;
}

/** The starting deck is 7 Copper + 3 Tix, so any 5-card hand holds >= 2 Resources. */
function resourceInHand(state: GameState, id: PlayerId, skip: InstanceId[] = []): InstanceId {
  for (const iid of P(state, id).hand) {
    if (skip.includes(iid)) continue;
    const inst = state.instances[iid];
    if (!inst) continue;
    if (getCard(inst.defId).types.includes('Resource')) return iid;
  }
  throw new Error('no Resource card in hand');
}

/** Cheapest resource-shop pile that actually costs money, for buy assertions. */
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
// B4 - action economy of playing
// --------------------------------------------------------------------------

describe('B4 - Resource plays are free, Action plays cost an Action', () => {
  test('B4: playing a Resource card spends no Action and moves it out of the hand', () => {
    const state = newMatch(2);
    const player = state.activePlayer;
    const iid = resourceInHand(state, player);

    const next = reduce(state, { type: 'play', player, iid });

    expect(P(next, player).actions).toBe(1);
    expect(P(next, player).hand).not.toContain(iid);
    expect(P(next, player).playedThisTurn).toContain(iid);
  });

  test('B4: playing an Action card spends exactly 1 Action', () => {
    const state = clone(newMatch(2));
    const player = state.activePlayer;
    const iid = mint(state, inertDef({ id: 'test_plain_action_b4' }), player, 'hand');
    expect(P(state, player).actions).toBe(1);

    const next = reduce(state, { type: 'play', player, iid });

    expect(P(next, player).actions).toBe(0);
    expect(P(next, player).hand).not.toContain(iid);
  });

  test('B4: playing an Action card with 0 Actions is rejected and returns the state unchanged', () => {
    const state = clone(newMatch(2));
    const player = state.activePlayer;
    const iid = mint(state, inertDef({ id: 'test_plain_action_b4_zero' }), player, 'hand');
    P(state, player).actions = 0;

    const next = reduce(state, { type: 'play', player, iid });

    expect(withoutLog(next)).toEqual(withoutLog(state));
    expect(P(next, player).hand).toContain(iid);
    expect(P(next, player).playedThisTurn).not.toContain(iid);
  });

  test('B4: a second Action play in the same turn is rejected once the Action is spent', () => {
    const state = clone(newMatch(2));
    const player = state.activePlayer;
    const first = mint(state, inertDef({ id: 'test_plain_action_b4_a' }), player, 'hand');
    const second = mint(state, inertDef({ id: 'test_plain_action_b4_b' }), player, 'hand');

    const afterFirst = reduce(state, { type: 'play', player, iid: first });
    expect(P(afterFirst, player).actions).toBe(0);

    const afterSecond = reduce(afterFirst, { type: 'play', player, iid: second });

    expect(withoutLog(afterSecond)).toEqual(withoutLog(afterFirst));
    expect(P(afterSecond, player).hand).toContain(second);
  });

  test('B4: a Resource card is still playable when no Actions remain', () => {
    const state = clone(newMatch(2));
    const player = state.activePlayer;
    P(state, player).actions = 0;
    const iid = resourceInHand(state, player);

    const next = reduce(state, { type: 'play', player, iid });

    expect(P(next, player).hand).not.toContain(iid);
    expect(P(next, player).playedThisTurn).toContain(iid);
    expect(P(next, player).actions).toBe(0);
  });
});

// --------------------------------------------------------------------------
// B5 - buying
// --------------------------------------------------------------------------

describe('B5 - buying costs one Buy plus the cost, and lands in the GY', () => {
  test('B5: a buy spends one Buy and the current cost, and the card lands in the GY', () => {
    const state = clone(newMatch(2));
    const player = state.activePlayer;
    P(state, player).money = 50;

    const pileId = payablePile(state, player);
    const cost = costOf(state, pileId, player);
    const top = pileOf(state, pileId).cards[0]!;
    const pileHeight = pileOf(state, pileId).cards.length;

    const next = reduce(state, { type: 'buy', player, pileId });

    expect(P(next, player).money).toBe(50 - cost);
    expect(P(next, player).buys).toBe(0);
    expect(P(next, player).gy).toContain(top);
    expect(next.instances[top]?.owner).toBe(player);
    expect(next.instances[top]?.zone).toBe('gy');
    expect(pileOf(next, pileId).cards).toHaveLength(pileHeight - 1);
    expect(pileOf(next, pileId).cards).not.toContain(top);
  });

  test('B5: a buy with no Buys remaining is rejected and returns the state unchanged', () => {
    const state = clone(newMatch(2));
    const player = state.activePlayer;
    P(state, player).money = 50;
    P(state, player).buys = 0;

    const pileId = payablePile(state, player);
    const top = pileOf(state, pileId).cards[0]!;

    const next = reduce(state, { type: 'buy', player, pileId });

    expect(withoutLog(next)).toEqual(withoutLog(state));
    expect(P(next, player).gy).not.toContain(top);
    expect(pileOf(next, pileId).cards).toContain(top);
  });

  test('B5: a buy from a pile with no cards left is rejected and returns the state unchanged', () => {
    const state = clone(newMatch(2));
    const player = state.activePlayer;
    P(state, player).money = 50;

    const pileId = payablePile(state, player);
    const pile = pileOf(state, pileId);
    for (const iid of pile.cards) delete state.instances[iid];
    pile.cards = [];

    const next = reduce(state, { type: 'buy', player, pileId });

    expect(withoutLog(next)).toEqual(withoutLog(state));
    expect(P(next, player).money).toBe(50);
    expect(P(next, player).buys).toBe(1);
  });

  test('B5: a buy naming a pile that does not exist is rejected and returns the state unchanged', () => {
    const state = clone(newMatch(2));
    const player = state.activePlayer;
    P(state, player).money = 50;

    const next = reduce(state, { type: 'buy', player, pileId: 'no_such_pile_at_all' });

    expect(withoutLog(next)).toEqual(withoutLog(state));
  });
});

// --------------------------------------------------------------------------
// B6 - buys and plays interleave
// --------------------------------------------------------------------------

describe('B6 - buys and plays interleave in one Main phase', () => {
  test('B6: a player may buy, then play, then buy again in the same turn', () => {
    let state = clone(newMatch(2));
    const player = state.activePlayer;
    P(state, player).money = 60;
    P(state, player).buys = 3;

    const firstPile = payablePile(state, player);
    const firstTop = pileOf(state, firstPile).cards[0]!;
    state = reduce(state, { type: 'buy', player, pileId: firstPile });

    const cardToPlay = resourceInHand(state, player);
    state = reduce(state, { type: 'play', player, iid: cardToPlay });

    const secondPile = payablePile(state, player);
    const secondTop = pileOf(state, secondPile).cards[0]!;
    state = reduce(state, { type: 'buy', player, pileId: secondPile });

    expect(P(state, player).gy).toContain(firstTop);
    expect(P(state, player).gy).toContain(secondTop);
    expect(P(state, player).hand).not.toContain(cardToPlay);
    expect(P(state, player).playedThisTurn).toContain(cardToPlay);
    expect(P(state, player).buys).toBe(1);
  });

  test('B6: a buy past the last remaining Buy is rejected and leaves the shop untouched', () => {
    let state = clone(newMatch(2));
    const player = state.activePlayer;
    P(state, player).money = 60;
    P(state, player).buys = 1;

    const firstPile = payablePile(state, player);
    state = reduce(state, { type: 'buy', player, pileId: firstPile });
    expect(P(state, player).buys).toBe(0);

    const secondPile = payablePile(state, player);
    const secondTop = pileOf(state, secondPile).cards[0]!;
    const next = reduce(state, { type: 'buy', player, pileId: secondPile });

    expect(withoutLog(next)).toEqual(withoutLog(state));
    expect(pileOf(next, secondPile).cards).toContain(secondTop);
  });

  test('B6: a play made between two buys does not restore the spent Buy', () => {
    let state = clone(newMatch(2));
    const player = state.activePlayer;
    P(state, player).money = 60;
    P(state, player).buys = 2;

    state = reduce(state, { type: 'buy', player, pileId: payablePile(state, player) });
    expect(P(state, player).buys).toBe(1);

    state = reduce(state, { type: 'play', player, iid: resourceInHand(state, player) });

    expect(P(state, player).buys).toBe(1);
  });
});

// --------------------------------------------------------------------------
// B7 - end of turn discard and draw
// --------------------------------------------------------------------------

describe('B7 - the hand is discarded and redrawn at end of turn', () => {
  test('B7: ending a turn discards the hand to the GY and draws 5 new cards', () => {
    const state = newMatch(2);
    const player = state.activePlayer;
    const oldHand = [...P(state, player).hand];
    const oldLibrary = [...P(state, player).library];
    expect(oldHand).toHaveLength(5);
    expect(oldLibrary).toHaveLength(5);

    const next = endTurnBy(state);

    expect(P(next, player).hand).toHaveLength(5);
    expect([...P(next, player).gy].sort()).toEqual([...oldHand].sort());
    expect([...P(next, player).hand].sort()).toEqual([...oldLibrary].sort());
    expect(P(next, player).library).toHaveLength(0);
  });

  test('B7: the newly drawn hand shares no card with the hand that was discarded', () => {
    const state = newMatch(2);
    const player = state.activePlayer;
    const oldHand = [...P(state, player).hand];

    const next = endTurnBy(state);

    for (const iid of oldHand) {
      expect(P(next, player).hand).not.toContain(iid);
    }
  });

  test('B7: no cards are drawn at the start of the next turn, because the hand was drawn at the end of the last one', () => {
    let state = newMatch(2);
    const player = state.activePlayer;

    state = endTurnBy(state);
    const handAfterEnding = [...P(state, player).hand];
    const libraryAfterEnding = [...P(state, player).library];

    state = endTurnBy(state);

    expect(state.activePlayer).toBe(player);
    expect(P(state, player).hand).toEqual(handAfterEnding);
    expect(P(state, player).library).toEqual(libraryAfterEnding);
  });

  test('B7: ending a turn passes the active seat to the next player in order', () => {
    const state = newMatch(2);
    const player = state.activePlayer;

    const next = endTurnBy(state);

    expect(next.activePlayer).toBe(otherPlayer(state, player));
    expect(next.turn).toBe(state.turn + 1);
  });

  test('B7: ending a turn does not leave any card behind in the hand or in play', () => {
    let state = clone(newMatch(2));
    const player = state.activePlayer;
    const played = resourceInHand(state, player);
    state = reduce(state, { type: 'play', player, iid: played });

    const next = endTurnBy(state);

    expect(P(next, player).play).toEqual([]);
    for (const iid of P(next, player).hand) {
      expect(next.instances[iid]?.zone).toBe('hand');
    }
  });
});

// --------------------------------------------------------------------------
// B8 - reshuffle on an empty library
// --------------------------------------------------------------------------

describe('B8 - drawing from an empty Library shuffles the GY in first', () => {
  test('B8: the second end of turn reshuffles the GY into the Library and draws 5', () => {
    let state = newMatch(2);
    const player = state.activePlayer;

    state = endTurnBy(state);
    expect(P(state, player).library).toHaveLength(0);
    expect(P(state, player).gy).toHaveLength(5);

    state = endTurnBy(state);
    expect(state.activePlayer).toBe(player);

    state = endTurnBy(state);

    expect(P(state, player).hand).toHaveLength(5);
    expect(P(state, player).gy).toHaveLength(0);
    expect(P(state, player).library).toHaveLength(5);
  });

  test('B8: a reshuffle neither creates nor destroys a card', () => {
    let state = newMatch(2);
    const player = state.activePlayer;
    const deckBefore = [...deckOf(state, player)].sort();

    state = endTurnBy(state);
    state = endTurnBy(state);
    state = endTurnBy(state);

    expect([...deckOf(state, player)].sort()).toEqual(deckBefore);
  });

  test('B8: a reshuffle does not pull any card out of another player deck', () => {
    let state = newMatch(2);
    const player = state.activePlayer;
    const opponent = otherPlayer(state, player);
    const opponentDeck = [...deckOf(state, opponent)].sort();

    state = endTurnBy(state);
    state = endTurnBy(state);
    state = endTurnBy(state);

    expect([...deckOf(state, opponent)].sort()).toEqual(opponentDeck);
    for (const iid of deckOf(state, player)) {
      expect(opponentDeck).not.toContain(iid);
    }
  });
});

// --------------------------------------------------------------------------
// B9 - cards played this turn are held aside during a reshuffle
// --------------------------------------------------------------------------

describe('B9 - cards played this turn survive the end-of-turn reshuffle', () => {
  test('B9: a card played this turn cannot be drawn again by the same turn reshuffle', () => {
    let state = newMatch(2);
    const player = state.activePlayer;

    state = endTurnBy(state);
    state = endTurnBy(state);
    expect(state.activePlayer).toBe(player);
    expect(P(state, player).library).toHaveLength(0);
    expect(P(state, player).gy).toHaveLength(5);

    const firstPlay = resourceInHand(state, player);
    state = reduce(state, { type: 'play', player, iid: firstPlay });
    const secondPlay = resourceInHand(state, player, [firstPlay]);
    state = reduce(state, { type: 'play', player, iid: secondPlay });

    state = endTurnBy(state);

    expect(P(state, player).hand).toHaveLength(5);
    expect(P(state, player).hand).not.toContain(firstPlay);
    expect(P(state, player).hand).not.toContain(secondPlay);
    expect(P(state, player).library).not.toContain(firstPlay);
    expect(P(state, player).library).not.toContain(secondPlay);
  });

  test('B9: cards played this turn are back in the GY once the reshuffle is done', () => {
    let state = newMatch(2);
    const player = state.activePlayer;

    state = endTurnBy(state);
    state = endTurnBy(state);

    const firstPlay = resourceInHand(state, player);
    state = reduce(state, { type: 'play', player, iid: firstPlay });
    const secondPlay = resourceInHand(state, player, [firstPlay]);
    state = reduce(state, { type: 'play', player, iid: secondPlay });

    state = endTurnBy(state);

    expect([...P(state, player).gy].sort()).toEqual([firstPlay, secondPlay].sort());
    expect(state.instances[firstPlay]?.zone).toBe('gy');
    expect(state.instances[secondPlay]?.zone).toBe('gy');
    expect(P(state, player).library).toHaveLength(3);
  });
});

// --------------------------------------------------------------------------
// B13 - hand order
// --------------------------------------------------------------------------

describe('B13 - hand order is preserved and reorderHand permutes it', () => {
  test('B13: reorderHand permutes the hand into exactly the order it was given', () => {
    const state = newMatch(2);
    const player = state.activePlayer;
    const reversed = [...P(state, player).hand].reverse();

    const next = reduce(state, { type: 'reorderHand', player, hand: reversed });

    expect(P(next, player).hand).toEqual(reversed);
  });

  test('B13: a reorderHand that drops a card is rejected and returns the state unchanged', () => {
    const state = newMatch(2);
    const player = state.activePlayer;
    const short = [...P(state, player).hand].slice(1);

    const next = reduce(state, { type: 'reorderHand', player, hand: short });

    expect(withoutLog(next)).toEqual(withoutLog(state));
    expect(P(next, player).hand).toHaveLength(5);
  });

  test('B13: a reorderHand naming a card that is not in the hand is rejected and returns the state unchanged', () => {
    const state = clone(newMatch(2));
    const player = state.activePlayer;
    const opponent = otherPlayer(state, player);
    const foreign = P(state, opponent).hand[0]!;
    const bogus = [...P(state, player).hand].slice(1).concat(foreign);

    const next = reduce(state, { type: 'reorderHand', player, hand: bogus });

    expect(withoutLog(next)).toEqual(withoutLog(state));
    expect(P(next, player).hand).not.toContain(foreign);
  });

  test('B13: a reorderHand that repeats a card is rejected and returns the state unchanged', () => {
    const state = newMatch(2);
    const player = state.activePlayer;
    const hand = P(state, player).hand;
    const duplicated = [hand[0]!, hand[0]!, hand[1]!, hand[2]!, hand[3]!];

    const next = reduce(state, { type: 'reorderHand', player, hand: duplicated });

    expect(withoutLog(next)).toEqual(withoutLog(state));
    expect(P(next, player).hand).toEqual(hand);
  });

  test('B13: the surviving hand keeps its order when one card is played out of the middle', () => {
    const state = newMatch(2);
    const player = state.activePlayer;
    const hand = [...P(state, player).hand];
    const middle = resourceInHand(state, player, [hand[0]!]);
    const expected = hand.filter((iid) => iid !== middle);

    const next = reduce(state, { type: 'play', player, iid: middle });

    expect(P(next, player).hand).toEqual(expected);
  });

  test('B13: a reorder followed by a play keeps the new order, not the dealt order', () => {
    let state = newMatch(2);
    const player = state.activePlayer;
    const reversed = [...P(state, player).hand].reverse();

    state = reduce(state, { type: 'reorderHand', player, hand: reversed });
    const target = resourceInHand(state, player);
    state = reduce(state, { type: 'play', player, iid: target });

    expect(P(state, player).hand).toEqual(reversed.filter((iid) => iid !== target));
  });
});
