/**
 * T1 - core rules and determinism.
 * Behaviors covered here: B10, B11, B12.
 *
 * Written from `.fullsend/SPEC.md` alone. Fixtures are inline on purpose.
 * Every card used here is a purpose-built inert definition so that the only
 * thing under test is the keyword.
 */
import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { registerCards } from '@engine/registry';
import type {
  CardDefId,
  CardDefinition,
  GameAction,
  GameState,
  InstanceId,
  Keyword,
  MatchConfig,
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
  const names = ['Ada', 'Bo'];
  const out: { id: PlayerId; name: string; codex: CardDefId[] }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ id: `p${i + 1}`, name: names[i] ?? `P${i + 1}`, codex: [] });
  }
  return out;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function newMatch(seed = 5150): GameState {
  return clone(createMatch(makeConfig(), makePlayers(2), seed, null));
}

function P(state: GameState, id: PlayerId): PlayerState {
  const player = state.players[id];
  if (!player) throw new Error(`no such player: ${id}`);
  return player;
}

function zoneOf(state: GameState, iid: InstanceId): Zone | 'gone' {
  return state.instances[iid]?.zone ?? 'gone';
}

let testCardSeq = 0;

/**
 * A Resource-typed card with no stats and no effects, so that playing it costs
 * no Action (B4) and nothing but the keyword under test can move it.
 */
function keywordDef(id: CardDefId, keywords: Keyword[]): CardDefinition {
  return {
    id,
    name: id,
    cost: { money: 2 },
    types: ['Resource'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords,
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

function endTurnBy(state: GameState): GameState {
  const action: GameAction = { type: 'endTurn', player: state.activePlayer };
  return reduce(state, action);
}

/** Play the card, then end the turn, so the GY-versus-trash question is settled. */
function playThenEndTurn(state: GameState, player: PlayerId, iid: InstanceId): GameState {
  const played = reduce(state, { type: 'play', player, iid });
  expect(P(played, player).hand).not.toContain(iid);
  return endTurnBy(played);
}

// --------------------------------------------------------------------------
// B10 - Flimsy
// --------------------------------------------------------------------------

describe('B10 - Flimsy is trashed when played', () => {
  test('B10: a Flimsy card played this turn ends up in the trash', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(state, keywordDef('test_flimsy_b10', ['Flimsy']), player);

    const next = playThenEndTurn(state, player, iid);

    expect(zoneOf(next, iid)).toBe('trash');
  });

  test('B10: a Flimsy card played this turn never reaches the GY, hand, library or play', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(state, keywordDef('test_flimsy_b10_absent', ['Flimsy']), player);

    const next = playThenEndTurn(state, player, iid);

    expect(P(next, player).gy).not.toContain(iid);
    expect(P(next, player).hand).not.toContain(iid);
    expect(P(next, player).library).not.toContain(iid);
    expect(P(next, player).play).not.toContain(iid);
  });

  test('B10: an otherwise identical card without Flimsy goes to the GY when played', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(state, keywordDef('test_plain_b10', []), player);

    const next = playThenEndTurn(state, player, iid);

    expect(zoneOf(next, iid)).toBe('gy');
    expect(P(next, player).gy).toContain(iid);
  });

  test('B10: trashing a played Flimsy card does not remove it from another player deck', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const opponent = state.playerOrder.find((p) => p !== player)!;
    const opponentDeck = [...P(state, opponent).library, ...P(state, opponent).hand].sort();
    const iid = mintInHand(state, keywordDef('test_flimsy_b10_isolated', ['Flimsy']), player);

    const next = playThenEndTurn(state, player, iid);

    expect([...P(next, opponent).library, ...P(next, opponent).hand].sort()).toEqual(opponentDeck);
  });
});

// --------------------------------------------------------------------------
// B11 - Temporary
// --------------------------------------------------------------------------

describe('B11 - Temporary is trashed when played and when discarded', () => {
  test('B11: a Temporary card played this turn ends up in the trash', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(state, keywordDef('test_temporary_b11_play', ['Temporary']), player);

    const next = playThenEndTurn(state, player, iid);

    expect(zoneOf(next, iid)).toBe('trash');
  });

  test('B11: a Temporary card played this turn never reaches the GY', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(state, keywordDef('test_temporary_b11_play_absent', ['Temporary']), player);

    const next = playThenEndTurn(state, player, iid);

    expect(P(next, player).gy).not.toContain(iid);
  });

  test('B11: a Temporary card discarded from hand at end of turn ends up in the trash', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(state, keywordDef('test_temporary_b11_discard', ['Temporary']), player);

    const next = endTurnBy(state);

    expect(zoneOf(next, iid)).toBe('trash');
  });

  test('B11: a Temporary card discarded at end of turn never reaches the GY or the new hand', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(
      state,
      keywordDef('test_temporary_b11_discard_absent', ['Temporary']),
      player,
    );

    const next = endTurnBy(state);

    expect(P(next, player).gy).not.toContain(iid);
    expect(P(next, player).hand).not.toContain(iid);
    expect(P(next, player).library).not.toContain(iid);
  });

  test('B11: an otherwise identical card without Temporary is discarded to the GY, not trashed', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(state, keywordDef('test_plain_b11_discard', []), player);

    const next = endTurnBy(state);

    expect(zoneOf(next, iid)).toBe('gy');
    expect(P(next, player).gy).toContain(iid);
  });
});

// --------------------------------------------------------------------------
// B12 - Indestructible beats every trash source
// --------------------------------------------------------------------------

describe('B12 - Indestructible beats every trash source', () => {
  test('B12: an Indestructible Flimsy card goes to the GY when played instead of being trashed', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(
      state,
      keywordDef('test_indestructible_flimsy_b12', ['Flimsy', 'Indestructible']),
      player,
    );

    const next = playThenEndTurn(state, player, iid);

    expect(zoneOf(next, iid)).toBe('gy');
    expect(P(next, player).gy).toContain(iid);
  });

  test('B12: an Indestructible Flimsy card is never in the trash after being played', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(
      state,
      keywordDef('test_indestructible_flimsy_b12_absent', ['Indestructible', 'Flimsy']),
      player,
    );

    const next = playThenEndTurn(state, player, iid);

    expect(zoneOf(next, iid)).not.toBe('trash');
  });

  test('B12: an Indestructible Temporary card played this turn goes to the GY', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(
      state,
      keywordDef('test_indestructible_temporary_b12_play', ['Temporary', 'Indestructible']),
      player,
    );

    const next = playThenEndTurn(state, player, iid);

    expect(zoneOf(next, iid)).toBe('gy');
    expect(P(next, player).gy).toContain(iid);
  });

  test('B12: an Indestructible Temporary card discarded at end of turn goes to the GY', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(
      state,
      keywordDef('test_indestructible_temporary_b12_discard', ['Temporary', 'Indestructible']),
      player,
    );

    const next = endTurnBy(state);

    expect(zoneOf(next, iid)).toBe('gy');
    expect(P(next, player).gy).toContain(iid);
  });

  test('B12: an Indestructible Temporary card discarded at end of turn is never trashed', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(
      state,
      keywordDef('test_indestructible_temporary_b12_absent', ['Temporary', 'Indestructible']),
      player,
    );

    const next = endTurnBy(state);

    expect(zoneOf(next, iid)).not.toBe('trash');
    expect(zoneOf(next, iid)).not.toBe('gone');
  });

  test('B12: Indestructible does not stop the card leaving the hand when it is played', () => {
    const state = newMatch();
    const player = state.activePlayer;
    const iid = mintInHand(
      state,
      keywordDef('test_indestructible_b12_leaves_hand', ['Indestructible']),
      player,
    );

    const next = reduce(state, { type: 'play', player, iid });

    expect(P(next, player).hand).not.toContain(iid);
    expect(zoneOf(next, iid)).not.toBe('hand');
  });
});
