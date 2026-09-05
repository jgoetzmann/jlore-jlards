/**
 * T1 - core rules and determinism.
 * Behaviors covered here: B14, B15, B16, B17.
 *
 * The end-condition scenarios are rigged through the shop rather than through
 * a long match: three draft piles are emptied outright and a fourth is reduced
 * to a single inert card, so one ordinary buy fires the trigger.
 */
import { describe, expect, test } from 'vitest';
import { createMatch, finalScores, isGameOver, legalActions, reduce } from '@engine/index';
import { checkEndCondition } from '@engine/meta/index';
import { getCard, registerCards } from '@engine/registry';
import type {
  CardDefId,
  CardDefinition,
  CardTag,
  GameAction,
  GameState,
  InstanceId,
  MatchConfig,
  Pile,
  PileId,
  PlayerId,
  PlayerState,
  Stats,
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
  const names = ['Ada', 'Bo', 'Cyd'];
  const out: { id: PlayerId; name: string; codex: CardDefId[] }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ id: `p${i + 1}`, name: names[i] ?? `P${i + 1}`, codex: [] });
  }
  return out;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function newMatch(playerCount = 2, seed = 606060, over: Partial<MatchConfig> = {}): GameState {
  return clone(
    createMatch(makeConfig({ playerCount, ...over }), makePlayers(playerCount), seed, null),
  );
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

let testCardSeq = 0;

function testDef(
  id: CardDefId,
  over: { stats?: Stats; tags?: CardTag[]; purchasable?: boolean; cost?: number } = {},
): CardDefinition {
  return {
    id,
    name: id,
    cost: { money: over.cost ?? 1 },
    types: ['Resource'],
    subtypes: [],
    tags: over.tags ?? [],
    rarity: 'common',
    keywords: [],
    stats: over.stats ?? {},
    effects: [],
    triggers: [],
    text: 'A test card that does nothing.',
    complexity: 'T1',
    subsystems: ['test'],
    notPurchasable: over.purchasable === true ? false : true,
    excludeFromPools: true,
  };
}

/** Drop an instance into one of a player own zones. */
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

/** Register an instance that belongs to no zone array (trash, shop). */
function mintLoose(
  state: GameState,
  def: CardDefinition,
  owner: PlayerId | null,
  zone: Zone,
): InstanceId {
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
  return iid;
}

function clearPile(state: GameState, pileId: PileId): Pile {
  const pile = pileOf(state, pileId);
  for (const iid of pile.cards) delete state.instances[iid];
  pile.cards = [];
  pile.locks = [];
  pile.costMods = [];
  return pile;
}

/** One draft pile holding exactly one inert, cheap, buyable card. */
function plantSingleCardPile(state: GameState, pileId: PileId, def: CardDefinition): InstanceId {
  const pile = clearPile(state, pileId);
  const iid = mintLoose(state, def, null, 'shop');
  state.instances[iid]!.pileId = pileId;
  pile.cards = [iid];
  pile.costOverride = def.cost.money ?? 1;
  return iid;
}

/**
 * Empty three draft piles and reduce a fourth to one card, so that buying that
 * card empties the fourth pile and meets the default 4-pile end condition.
 */
function rigEndTrigger(state: GameState, buyer: PlayerId): PileId {
  const draft = state.shop.order.draft;
  expect(draft.length).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < 3; i++) clearPile(state, draft[i]!);
  const targetId = draft[3]!;
  plantSingleCardPile(
    state,
    targetId,
    testDef(`test_end_trigger_${testCardSeq}`, { purchasable: true, cost: 1 }),
  );
  P(state, buyer).money = 50;
  P(state, buyer).buys = 3;
  return targetId;
}

/** Level the two scores by accruing VP onto one instance the lower player owns. */
function equalizeVp(state: GameState, a: PlayerId, b: PlayerId): void {
  const scores = finalScores(state);
  const diff = (scores[a] ?? 0) - (scores[b] ?? 0);
  if (diff === 0) return;
  const lower = diff > 0 ? b : a;
  const owned = [...P(state, lower).gy, ...P(state, lower).hand, ...P(state, lower).library];
  const inst = state.instances[owned[0]!];
  if (!inst) throw new Error('the lower-scoring player owns no card to accrue VP onto');
  inst.counters = { ...inst.counters, vp: (inst.counters.vp ?? 0) + Math.abs(diff) };
}

function jlorePile(state: GameState): PileId {
  for (const id of state.shop.order.points) {
    const top = pileOf(state, id).cards[0];
    if (!top) continue;
    const inst = state.instances[top];
    if (inst && getCard(inst.defId).name === 'Jlore') return id;
  }
  throw new Error('no Jlore pile in the points shop');
}

/** The triggering buy happens on the very first turn of the match. */
function triggerOnFirstTurn(seed = 606060): {
  state: GameState;
  trigger: PlayerId;
  other: PlayerId;
} {
  const state = newMatch(2, seed);
  const trigger = state.activePlayer;
  const other = otherPlayer(state, trigger);
  const pileId = rigEndTrigger(state, trigger);
  const after = reduce(state, { type: 'buy', player: trigger, pileId });
  expect(pileOf(after, pileId).cards).toHaveLength(0);
  return { state: clone(after), trigger, other };
}

// --------------------------------------------------------------------------
// B14 - the game-end trigger
// --------------------------------------------------------------------------

describe('B14 - the game-end trigger', () => {
  test('B14: a fresh match has not met the end condition', () => {
    const state = newMatch();

    expect(checkEndCondition(state).ended).toBe(false);
    expect(isGameOver(state)).toBe(false);
  });

  test('B14: two empty draft piles of ten do not fire the end condition', () => {
    const state = newMatch();
    clearPile(state, state.shop.order.draft[0]!);
    clearPile(state, state.shop.order.draft[1]!);

    expect(checkEndCondition(state).ended).toBe(false);
  });

  test('B14: three empty draft piles of ten do not fire the end condition', () => {
    const state = newMatch();
    for (let i = 0; i < 3; i++) clearPile(state, state.shop.order.draft[i]!);

    expect(checkEndCondition(state).ended).toBe(false);
  });

  test('B14: four empty draft piles fire the end condition with a reason', () => {
    const state = newMatch();
    for (let i = 0; i < 4; i++) clearPile(state, state.shop.order.draft[i]!);

    const result = checkEndCondition(state);

    expect(result.ended).toBe(true);
    expect(typeof result.reason).toBe('string');
    expect(result.reason).not.toBe('');
  });

  test('B14: a lower emptyPileFraction fires before the absolute count', () => {
    const state = newMatch(2, 606060, {
      winCondition: {
        kind: 'standard',
        emptyPileFraction: 0.2,
        emptyPileAbsolute: null,
        x: null,
      },
    });
    clearPile(state, state.shop.order.draft[0]!);
    clearPile(state, state.shop.order.draft[1]!);

    expect(checkEndCondition(state).ended).toBe(true);
  });

  test('B14: a lower absolute count fires before the fraction', () => {
    const state = newMatch(2, 606060, {
      winCondition: {
        kind: 'standard',
        emptyPileFraction: 0.9,
        emptyPileAbsolute: 4,
        x: null,
      },
    });
    for (let i = 0; i < 4; i++) clearPile(state, state.shop.order.draft[i]!);

    expect(checkEndCondition(state).ended).toBe(true);
  });

  test('B14: three empty draft piles under a 0.9 fraction and no absolute do not end the game', () => {
    const state = newMatch(2, 606060, {
      winCondition: {
        kind: 'standard',
        emptyPileFraction: 0.9,
        emptyPileAbsolute: null,
        x: null,
      },
    });
    for (let i = 0; i < 3; i++) clearPile(state, state.shop.order.draft[i]!);

    expect(checkEndCondition(state).ended).toBe(false);
  });

  test('B14: emptying the Jlore pile ends the game on its own', () => {
    const state = newMatch();
    clearPile(state, jlorePile(state));

    expect(checkEndCondition(state).ended).toBe(true);
  });

  test('B14: an empty Resource pile does not count toward the draft-pile threshold', () => {
    const state = newMatch();
    for (let i = 0; i < 3; i++) clearPile(state, state.shop.order.draft[i]!);
    clearPile(state, state.shop.order.resource[0]!);

    expect(checkEndCondition(state).ended).toBe(false);
  });

  test('B14: an empty Points pile that is not Jlore does not end the game', () => {
    const state = newMatch();
    const jlore = jlorePile(state);
    const victim = state.shop.order.points.find((id) => id !== jlore);
    expect(victim).toBeDefined();
    clearPile(state, victim!);

    expect(checkEndCondition(state).ended).toBe(false);
  });
});

// --------------------------------------------------------------------------
// B15 - play continues around the table
// --------------------------------------------------------------------------

describe('B15 - the game ends at the start of the triggering player next turn', () => {
  test('B15: the game does not end on the turn the condition is triggered', () => {
    const { state } = triggerOnFirstTurn();

    expect(state.ended).toBe(false);
    expect(isGameOver(state)).toBe(false);
    expect(state.winners).toBeNull();
  });

  test('B15: reduce records which player triggered the end condition', () => {
    const { state, trigger } = triggerOnFirstTurn();

    expect(state.endTriggeredBy).toBe(trigger);
  });

  test('B15: play continues to the next seat after the condition triggers', () => {
    const { state, trigger, other } = triggerOnFirstTurn();

    const next = endTurnBy(state);

    expect(next.activePlayer).toBe(other);
    expect(next.ended).toBe(false);
    expect(isGameOver(next)).toBe(false);
    expect(legalActions(next, other).length).toBeGreaterThan(0);
    expect(next.endTriggeredBy).toBe(trigger);
  });

  test('B15: the game ends when the turn comes back around to the triggering player', () => {
    const { state } = triggerOnFirstTurn();

    let next = endTurnBy(state);
    next = endTurnBy(next);

    expect(next.ended).toBe(true);
    expect(isGameOver(next)).toBe(true);
    expect(next.winners).not.toBeNull();
    expect(typeof next.endReason).toBe('string');
  });

  test('B15: the game ends on the triggering player seat, two turns after the trigger', () => {
    const { state, trigger } = triggerOnFirstTurn();

    let next = endTurnBy(state);
    next = endTurnBy(next);

    expect(next.ended).toBe(true);
    expect(next.activePlayer).toBe(trigger);
    expect(next.turn).toBe(state.turn + 2);
  });

  test('B15: the triggering player draws no new turn worth of cards after the game ends', () => {
    const { state, trigger } = triggerOnFirstTurn();

    const afterTrigger = endTurnBy(state);
    const handAtHandover = [...P(afterTrigger, trigger).hand];
    const ended = endTurnBy(afterTrigger);

    expect(ended.ended).toBe(true);
    expect(P(ended, trigger).hand).toEqual(handAtHandover);
  });
});

// --------------------------------------------------------------------------
// B16 - who wins
// --------------------------------------------------------------------------

describe('B16 - most VP, then fewest turns, then smallest deck, then a shared win', () => {
  test('B16: winners is null while the game is still running', () => {
    const state = newMatch();

    expect(state.winners).toBeNull();
    expect(state.ended).toBe(false);
  });

  test('B16: the player with the most VP wins', () => {
    const { state, trigger, other } = triggerOnFirstTurn();
    const boosted = clone(state);
    const iid = P(boosted, trigger).gy[0]!;
    const inst = boosted.instances[iid]!;
    inst.counters = { ...inst.counters, vp: (inst.counters.vp ?? 0) + 50 };

    let ended = endTurnBy(boosted);
    ended = endTurnBy(ended);

    expect(ended.ended).toBe(true);
    const scores = finalScores(ended);
    expect(scores[trigger]!).toBeGreaterThan(scores[other]!);
    expect(ended.winners).toEqual([trigger]);
  });

  test('B16: a VP tie is broken toward the player who has taken fewer turns', () => {
    let state = newMatch(2, 717171);
    const first = state.activePlayer;
    const second = otherPlayer(state, first);

    state = clone(endTurnBy(state));
    expect(state.activePlayer).toBe(second);

    const pileId = rigEndTrigger(state, second);
    state = clone(reduce(state, { type: 'buy', player: second, pileId }));
    expect(state.endTriggeredBy).toBe(second);

    equalizeVp(state, first, second);

    state = endTurnBy(state);
    expect(state.activePlayer).toBe(first);
    expect(state.ended).toBe(false);

    state = endTurnBy(state);

    expect(state.ended).toBe(true);
    const scores = finalScores(state);
    expect(scores[first]).toBe(scores[second]);
    expect(state.winners).toEqual([second]);
  });

  test('B16: a tie on VP and turns is broken toward the smaller deck', () => {
    const { state, trigger, other } = triggerOnFirstTurn(818181);
    const tied = clone(state);
    equalizeVp(tied, trigger, other);

    let ended = endTurnBy(tied);
    ended = endTurnBy(ended);

    expect(ended.ended).toBe(true);
    const scores = finalScores(ended);
    expect(scores[trigger]).toBe(scores[other]);
    expect(deckOf(ended, trigger).length).toBeGreaterThan(deckOf(ended, other).length);
    expect(ended.winners).toEqual([other]);
  });

  test('B16: a tie on VP, turns and deck size is a shared win', () => {
    const { state, trigger, other } = triggerOnFirstTurn(919191);
    const tied = clone(state);
    mint(tied, testDef('test_deck_balancer'), other, 'gy');
    equalizeVp(tied, trigger, other);

    let ended = endTurnBy(tied);
    ended = endTurnBy(ended);

    expect(ended.ended).toBe(true);
    const scores = finalScores(ended);
    expect(scores[trigger]).toBe(scores[other]);
    expect(deckOf(ended, trigger).length).toBe(deckOf(ended, other).length);
    expect(ended.winners).not.toBeNull();
    expect([...ended.winners!].sort()).toEqual([trigger, other].sort());
  });

  test('B16: a losing player is never listed among the winners', () => {
    const { state, trigger, other } = triggerOnFirstTurn(232323);
    const boosted = clone(state);
    const iid = P(boosted, other).hand[0]!;
    const inst = boosted.instances[iid]!;
    inst.counters = { ...inst.counters, vp: (inst.counters.vp ?? 0) + 40 };

    let ended = endTurnBy(boosted);
    ended = endTurnBy(ended);

    expect(ended.ended).toBe(true);
    expect(ended.winners).not.toContain(trigger);
    expect(ended.winners).toEqual([other]);
  });
});

// --------------------------------------------------------------------------
// B17 - final scoring
// --------------------------------------------------------------------------

describe('B17 - finalScores counts the whole deck plus accrued VP', () => {
  test('B17: finalScores returns a score for every player in the match', () => {
    const state = newMatch(3);

    const scores = finalScores(state);

    expect(Object.keys(scores).sort()).toEqual([...state.playerOrder].sort());
  });

  test('B17: finalScores counts VP printed on cards in the library, hand, GY and play', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const before = finalScores(state)[player]!;
    const def = testDef('test_printed_vp_four', { stats: { vp: 4 } });
    mint(state, def, player, 'library');
    mint(state, def, player, 'hand');
    mint(state, def, player, 'gy');
    mint(state, def, player, 'play');

    expect(finalScores(state)[player]!).toBe(before + 16);
  });

  test('B17: finalScores counts VP accrued onto an instance', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const before = finalScores(state)[player]!;
    const iid = P(state, player).hand[0]!;
    const inst = state.instances[iid]!;
    inst.counters = { ...inst.counters, vp: 7 };

    expect(finalScores(state)[player]!).toBe(before + 7);
  });

  test('B17: finalScores does not count a card sitting in the trash', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const before = finalScores(state)[player]!;
    mintLoose(state, testDef('test_trashed_vp_nine', { stats: { vp: 9 } }), player, 'trash');

    expect(finalScores(state)[player]!).toBe(before);
  });

  test('B17: finalScores does not count a card still sitting in a shop pile', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const before = finalScores(state)[player]!;
    const pileId = state.shop.order.draft[0]!;
    const iid = mintLoose(state, testDef('test_shop_vp_nine', { stats: { vp: 9 } }), player, 'shop');
    state.instances[iid]!.pileId = pileId;
    pileOf(state, pileId).cards.unshift(iid);

    expect(finalScores(state)[player]!).toBe(before);
  });

  test('B17: finalScores does not credit a player for VP printed on another player cards', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const opponent = otherPlayer(state, player);
    const before = finalScores(state)[player]!;
    mint(state, testDef('test_opponent_vp_nine', { stats: { vp: 9 } }), opponent, 'hand');

    expect(finalScores(state)[player]!).toBe(before);
  });

  test('B17: buying an End of Game card does not raise the running player vp', () => {
    const state = newMatch();
    const player = state.activePlayer;
    P(state, player).money = 50;
    const pileId = state.shop.order.draft[0]!;
    plantSingleCardPile(
      state,
      pileId,
      testDef('test_end_of_game_five', {
        stats: { vp: 5 },
        tags: ['EndOfGame'],
        purchasable: true,
        cost: 2,
      }),
    );
    const vpBefore = P(state, player).vp;

    const next = reduce(state, { type: 'buy', player, pileId });

    expect(P(next, player).gy).toHaveLength(1);
    expect(P(next, player).vp).toBe(vpBefore);
  });

  test('B17: finalScores does add the VP of an End of Game card that was bought', () => {
    const state = newMatch();
    const player = state.activePlayer;
    P(state, player).money = 50;
    const pileId = state.shop.order.draft[0]!;
    plantSingleCardPile(
      state,
      pileId,
      testDef('test_end_of_game_five_scored', {
        stats: { vp: 5 },
        tags: ['EndOfGame'],
        purchasable: true,
        cost: 2,
      }),
    );
    const before = finalScores(state)[player]!;

    const next = reduce(state, { type: 'buy', player, pileId });

    expect(finalScores(next)[player]!).toBe(before + 5);
  });
});
