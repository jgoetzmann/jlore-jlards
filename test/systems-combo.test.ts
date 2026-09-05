import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { bigActionCost, comboCount } from '@engine/systems';
import { resolveEffects } from '@engine/effects';
import type { EffectContext } from '@engine/effects';
import { allCards } from '@engine/registry';
import type {
  AnomalyId,
  CardDefId,
  CardDefinition,
  EffectNode,
  Element,
  GameState,
  InstanceId,
  MatchConfig,
  PlayerId,
} from '@engine/types';

// --- inline fixtures -------------------------------------------------------

/** Snake_case of the printed name, the id convention this catalog uses. */
const DONGFANG: AnomalyId = 'dongfang_youxi_sheji';

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

function named(name: string): CardDefinition {
  const c = allCards().find((x) => x.name === name);
  if (!c) throw new Error('no card named ' + name);
  return c;
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

function setElement(s: GameState, defId: CardDefId, element: Element): GameState {
  const n = clone(s);
  const prev = n.variants[defId];
  n.variants[defId] = {
    defId,
    statDelta: prev?.statDelta ?? {},
    costDelta: prev?.costDelta ?? 0,
    element,
  };
  return n;
}

function ctxFor(player: PlayerId): EffectContext {
  return { player, sourceIid: null, depth: 0, multiplier: 1, vars: {} };
}

const bigActionCard = (): CardDefinition => {
  const c = allCards().find(
    (x) => (x.bigAction ?? 1) >= 2 && x.types.includes('Action') && x.notPurchasable !== true,
  );
  if (!c) throw new Error('no Big Action card in the registry');
  return c;
};

const plainActionCard = (): CardDefinition => {
  const c = allCards().find(
    (x) => x.bigAction === undefined && x.types.includes('Action') && x.notPurchasable !== true,
  );
  if (!c) throw new Error('no plain Action card in the registry');
  return c;
};

// --- B71 -------------------------------------------------------------------

describe('B71 - the combo counter', () => {
  test('B71: comboCount counts the cards played this turn', () => {
    const s0 = mkMatch(121);
    const me = s0.activePlayer;
    let s = addToHand(s0, named('Copper').id, 'test_cu_a', me);
    s = addToHand(s, named('Copper').id, 'test_cu_b', me);

    expect(comboCount(s, me)).toBe(0);
    const one = reduce(s, { type: 'play', player: me, iid: 'test_cu_a' });
    expect(comboCount(one, me)).toBe(1);
    const two = reduce(one, { type: 'play', player: me, iid: 'test_cu_b' });
    expect(comboCount(two, me)).toBe(2);
  });

  test('B71: comboCount is back to 0 when the turn comes round again', () => {
    const s0 = mkMatch(122);
    const me = s0.activePlayer;
    const s = addToHand(s0, named('Copper').id, 'test_cu_a', me);

    const played = reduce(s, { type: 'play', player: me, iid: 'test_cu_a' });
    expect(comboCount(played, me)).toBe(1);

    let cur = reduce(played, { type: 'endTurn', player: me });
    cur = reduce(cur, { type: 'endTurn', player: cur.activePlayer });
    expect(cur.activePlayer).toBe(me);
    expect(comboCount(cur, me)).toBe(0);
  });

  test('B71: resetCombo zeroes the counter mid-turn', () => {
    const s0 = mkMatch(123);
    const me = s0.activePlayer;
    let s = addToHand(s0, named('Copper').id, 'test_cu_a', me);
    s = addToHand(s, named('Copper').id, 'test_cu_b', me);

    let cur = reduce(s, { type: 'play', player: me, iid: 'test_cu_a' });
    cur = reduce(cur, { type: 'play', player: me, iid: 'test_cu_b' });
    expect(comboCount(cur, me)).toBe(2);

    const nodes: EffectNode[] = [{ op: 'resetCombo' }];
    const reset = resolveEffects(cur, nodes, ctxFor(me));
    expect(comboCount(reset, me)).toBe(0);
  });

  test('B71: an opponent combo count stays 0 while the active player plays cards', () => {
    const s0 = mkMatch(124);
    const me = s0.activePlayer;
    const other = s0.playerOrder.find((p) => p !== me)!;
    const s = addToHand(s0, named('Copper').id, 'test_cu_a', me);

    const after = reduce(s, { type: 'play', player: me, iid: 'test_cu_a' });
    expect(comboCount(after, me)).toBe(1);
    expect(comboCount(after, other)).toBe(0);
  });
});

// --- B72 -------------------------------------------------------------------

describe('B72 - bigActionCost', () => {
  test('B72: bigActionCost returns the definition bigAction value', () => {
    const def = bigActionCard();
    const s0 = mkMatch(125);
    const me = s0.activePlayer;
    const s = addToHand(s0, def.id, 'test_big', me);
    expect(bigActionCost(s, 'test_big')).toBe(def.bigAction);
  });

  test('B72: bigActionCost defaults to 1 for a card with no bigAction', () => {
    const def = plainActionCard();
    const s0 = mkMatch(126);
    const me = s0.activePlayer;
    const s = addToHand(s0, def.id, 'test_plain', me);
    expect(def.bigAction).toBeUndefined();
    expect(bigActionCost(s, 'test_plain')).toBe(1);
  });

  test('B72: a Big Action N card can be played with exactly N Actions', () => {
    const def = bigActionCard();
    const n = def.bigAction!;
    const s0 = mkMatch(127);
    const me = s0.activePlayer;
    const s = addToHand(s0, def.id, 'test_big', me);
    s.players[me]!.actions = n;
    s.players[me]!.money = 20;

    const after = reduce(s, { type: 'play', player: me, iid: 'test_big' });
    expect(after.players[me]!.hand).not.toContain('test_big');
  });
});

// --- B73 -------------------------------------------------------------------

describe('B73 - a Big Action N card needs N Actions', () => {
  test('B73: a Big Action N card cannot be played with N-1 Actions', () => {
    const def = bigActionCard();
    const n = def.bigAction!;
    expect(n).toBeGreaterThanOrEqual(2);

    const s0 = mkMatch(128);
    const me = s0.activePlayer;
    const s = addToHand(s0, def.id, 'test_big', me);
    s.players[me]!.actions = n - 1;
    s.players[me]!.money = 20;

    const playBefore = [...s.players[me]!.play];
    const after = reduce(s, { type: 'play', player: me, iid: 'test_big' });

    expect(after.players[me]!.hand).toContain('test_big');
    expect(after.players[me]!.play).toEqual(playBefore);
    expect(after.players[me]!.actions).toBe(n - 1);
    expect(after.instances['test_big']!.zone).toBe('hand');
  });

  test('B73: a Big Action N card cannot be played with 0 Actions', () => {
    const def = bigActionCard();
    const s0 = mkMatch(129);
    const me = s0.activePlayer;
    const s = addToHand(s0, def.id, 'test_big', me);
    s.players[me]!.actions = 0;

    const after = reduce(s, { type: 'play', player: me, iid: 'test_big' });
    expect(after.players[me]!.hand).toContain('test_big');
    expect(after.players[me]!.actions).toBe(0);
  });

  test('B73: a rejected Big Action play leaves the combo counter untouched', () => {
    const def = bigActionCard();
    const n = def.bigAction!;
    const s0 = mkMatch(130);
    const me = s0.activePlayer;
    const s = addToHand(s0, def.id, 'test_big', me);
    s.players[me]!.actions = n - 1;

    const after = reduce(s, { type: 'play', player: me, iid: 'test_big' });
    expect(comboCount(after, me)).toBe(0);
  });
});

// --- B74 and B75 -----------------------------------------------------------

interface Scene {
  s: GameState;
  me: PlayerId;
}

function elementScene(
  seed: number,
  anomaly: AnomalyId | null,
  silverEl: Element | null,
  copperEl: Element | null,
): Scene {
  const base = mkMatch(seed);
  const me = base.activePlayer;
  const copper = named('Copper').id;
  const silver = named('Silver').id;
  let s = addToHand(base, copper, 'test_cu', me);
  s = addToHand(s, silver, 'test_ag', me);
  if (copperEl) s = setElement(s, copper, copperEl);
  if (silverEl) s = setElement(s, silver, silverEl);
  const n = clone(s);
  n.anomaly = anomaly;
  n.players[me]!.money = 0;
  return { s: n, me };
}

/** Play Silver (setting the previous element), then measure what Copper pays. */
function copperGainAfterSilver(scene: Scene): number {
  const { s, me } = scene;
  const afterSilver = reduce(s, { type: 'play', player: me, iid: 'test_ag' });
  const before = afterSilver.players[me]!.money;
  const afterCopper = reduce(afterSilver, { type: 'play', player: me, iid: 'test_cu' });
  return afterCopper.players[me]!.money - before;
}

describe('B74 / B75 - multipliers and the five elements', () => {
  test('B74: multiplyNext factor 3 triples the next card money output', () => {
    const baseGain = copperGainAfterSilver(elementScene(131, null, null, null));
    expect(baseGain).toBeGreaterThan(0);

    const { s, me } = elementScene(131, null, null, null);
    const afterSilver = reduce(s, { type: 'play', player: me, iid: 'test_ag' });
    const nodes: EffectNode[] = [{ op: 'multiplyNext', factor: 3 }];
    const primed = resolveEffects(afterSilver, nodes, ctxFor(me));
    const before = primed.players[me]!.money;
    const after = reduce(primed, { type: 'play', player: me, iid: 'test_cu' });

    expect(after.players[me]!.money - before).toBe(baseGain * 3);
  });

  test('B74: the generative element rule and multiplyNext factor 3 produce the same number', () => {
    const baseGain = copperGainAfterSilver(elementScene(132, null, null, null));
    expect(baseGain).toBeGreaterThan(0);

    const { s, me } = elementScene(132, null, null, null);
    const afterSilver = reduce(s, { type: 'play', player: me, iid: 'test_ag' });
    const primed = resolveEffects(
      afterSilver,
      [{ op: 'multiplyNext', factor: 3 }] as EffectNode[],
      ctxFor(me),
    );
    const before = primed.players[me]!.money;
    const viaMultiplyNext =
      reduce(primed, { type: 'play', player: me, iid: 'test_cu' }).players[me]!.money - before;

    // Wood generates Fire, so Copper played after Silver triples.
    const viaElements = copperGainAfterSilver(elementScene(132, DONGFANG, 'fire', 'wood'));

    expect(viaMultiplyNext).toBe(baseGain * 3);
    expect(viaElements).toBe(viaMultiplyNext);
  });

  test('B75: under Dongfang Youxi Sheji an element that generates the previous one triples the effect', () => {
    const baseGain = copperGainAfterSilver(elementScene(133, null, null, null));
    expect(baseGain).toBeGreaterThan(0);

    const scene = elementScene(133, DONGFANG, 'fire', 'wood');
    const afterSilver = reduce(scene.s, { type: 'play', player: scene.me, iid: 'test_ag' });
    expect(afterSilver.players[scene.me]!.lastElement).toBe('fire');

    expect(copperGainAfterSilver(scene)).toBe(baseGain * 3);
  });

  test('B75: under Dongfang Youxi Sheji a destructive element negates the effect entirely', () => {
    const baseGain = copperGainAfterSilver(elementScene(134, null, null, null));
    expect(baseGain).toBeGreaterThan(0);

    // Water destroys Fire.
    expect(copperGainAfterSilver(elementScene(134, DONGFANG, 'fire', 'water'))).toBe(0);
  });

  test('B75: a neutral element pairing under the anomaly leaves the effect alone', () => {
    const baseGain = copperGainAfterSilver(elementScene(135, null, null, null));
    // Fire neither generates nor destroys Fire.
    expect(copperGainAfterSilver(elementScene(135, DONGFANG, 'fire', 'fire'))).toBe(baseGain);
  });

  test('B75: without the anomaly the same element pairing changes nothing', () => {
    const baseGain = copperGainAfterSilver(elementScene(136, null, null, null));
    expect(copperGainAfterSilver(elementScene(136, null, 'fire', 'wood'))).toBe(baseGain);
    expect(copperGainAfterSilver(elementScene(136, null, 'fire', 'water'))).toBe(baseGain);
  });
});
