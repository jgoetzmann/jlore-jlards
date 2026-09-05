/**
 * T2 - Effect DSL: transform, trash, multiplyNext, recruit.
 * Behaviors B39, B40, B41, B42.
 *
 * Fixtures are written inline on purpose (spec-tester rule 8).
 */
import { describe, test, expect } from 'vitest';

import { resolveEffects } from '@engine/effects';
import type { EffectContext } from '@engine/effects';
import { createMatch, reduce } from '@engine/index';
import { allCards } from '@engine/registry';
import type {
  CardDefId,
  GameState,
  InstanceId,
  MatchConfig,
  PlayerId,
} from '@engine/types';

// --- inline fixtures -------------------------------------------------------

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
    effectNodeBudget: 5000,
    recursionDepth: 8,
    turnSeconds: 90,
    seedCodexWithCommons: true,
    ...over,
  };
}

function freshMatch(seed = 24601, over: Partial<MatchConfig> = {}): GameState {
  return createMatch(
    makeConfig(over),
    [
      { id: 'p1', name: 'Alice', codex: [] },
      { id: 'p2', name: 'Bob', codex: [] },
    ],
    seed,
    null,
  );
}

function ctxFor(state: GameState, over: Partial<EffectContext> = {}): EffectContext {
  return {
    player: state.activePlayer,
    sourceIid: null,
    depth: 0,
    multiplier: 1,
    vars: {},
    ...over,
  };
}

function idOfCardNamed(name: string): CardDefId {
  const def = allCards().find((c) => c.name === name);
  expect(def, 'card named ' + name + ' must exist in the registry').toBeDefined();
  return def!.id;
}

function trashCount(s: GameState): number {
  return Object.values(s.instances).filter((i) => i.zone === 'trash').length;
}

function defIdsOf(s: GameState, iids: readonly InstanceId[]): CardDefId[] {
  return iids.map((iid) => s.instances[iid].defId);
}

type DeckZone = 'library' | 'hand' | 'gy' | 'play';

function moveCards(
  s: GameState,
  player: PlayerId,
  from: DeckZone,
  to: DeckZone,
  n: number,
): void {
  const p = s.players[player];
  for (let i = 0; i < n; i++) {
    const iid = p[from].shift();
    if (iid === undefined) return;
    p[to].push(iid);
    s.instances[iid].zone = to;
  }
}

/** Hand instances whose play raises the player's Money, found by observation only. */
function moneyMakersInHand(s: GameState): InstanceId[] {
  const p = s.activePlayer;
  const out: InstanceId[] = [];
  for (const iid of s.players[p].hand) {
    const after = reduce(s, { type: 'play', player: p, iid });
    if (after.players[p].money > s.players[p].money) out.push(iid);
  }
  return out;
}

// --- B39 -------------------------------------------------------------------

describe('B39 - transform replaces in place and fires no triggers', () => {
  test('B39: transform swaps the card definition at the same hand position', () => {
    const copperId = idOfCardNamed('Copper');
    const goldId = idOfCardNamed('Gold');

    const s = freshMatch();
    const p = s.activePlayer;
    const idx = s.players[p].hand.findIndex((iid) => s.instances[iid].defId === copperId);
    expect(idx).toBeGreaterThanOrEqual(0);

    const next = resolveEffects(
      s,
      [
        {
          op: 'transform',
          target: { who: 'self', zone: 'hand', filter: { defId: copperId }, count: 1, pick: 'top' },
          into: goldId,
        },
      ],
      ctxFor(s),
    );

    expect(next.players[p].hand).toHaveLength(5);
    const swapped = next.players[p].hand[idx];
    expect(next.instances[swapped].defId).toBe(goldId);
    expect(next.instances[swapped].zone).toBe('hand');
  });

  test('B39: transform leaves the other cards in the zone at their positions', () => {
    const copperId = idOfCardNamed('Copper');
    const goldId = idOfCardNamed('Gold');

    const s = freshMatch(2);
    const p = s.activePlayer;
    const beforeDefIds = defIdsOf(s, s.players[p].hand);
    const idx = s.players[p].hand.findIndex((iid) => s.instances[iid].defId === copperId);
    expect(idx).toBeGreaterThanOrEqual(0);

    const next = resolveEffects(
      s,
      [
        {
          op: 'transform',
          target: { who: 'self', zone: 'hand', filter: { defId: copperId }, count: 1, pick: 'top' },
          into: goldId,
        },
      ],
      ctxFor(s),
    );

    const afterDefIds = defIdsOf(next, next.players[p].hand);
    expect(afterDefIds).toHaveLength(beforeDefIds.length);
    for (let i = 0; i < beforeDefIds.length; i++) {
      if (i === idx) continue;
      expect(afterDefIds[i]).toBe(beforeDefIds[i]);
    }
  });

  test('B39: transform sends nothing to the trash', () => {
    const copperId = idOfCardNamed('Copper');
    const goldId = idOfCardNamed('Gold');

    const s = freshMatch(3);
    const p = s.activePlayer;
    const before = trashCount(s);

    const next = resolveEffects(
      s,
      [
        {
          op: 'transform',
          target: { who: 'self', zone: 'hand', filter: { defId: copperId }, count: 1, pick: 'top' },
          into: goldId,
        },
      ],
      ctxFor(s),
    );

    expect(trashCount(next)).toBe(before);
    expect(next.players[p].gy).toHaveLength(0);
  });

  test('B39: transform does not count as a gain', () => {
    const copperId = idOfCardNamed('Copper');
    const goldId = idOfCardNamed('Gold');

    const s = freshMatch(4);
    const p = s.activePlayer;
    const before = s.players[p].cardsGainedThisTurn;

    const next = resolveEffects(
      s,
      [
        {
          op: 'transform',
          target: { who: 'self', zone: 'hand', filter: { defId: copperId }, count: 1, pick: 'top' },
          into: goldId,
        },
      ],
      ctxFor(s),
    );

    expect(next.players[p].cardsGainedThisTurn).toBe(before);
  });

  test('B39: transform pointed at an empty zone changes nothing', () => {
    const goldId = idOfCardNamed('Gold');

    const s = freshMatch(6);
    const p = s.activePlayer;
    expect(s.players[p].gy).toHaveLength(0);
    const beforeHand = defIdsOf(s, s.players[p].hand);

    const next = resolveEffects(
      s,
      [
        {
          op: 'transform',
          target: { who: 'self', zone: 'gy', count: 1 },
          into: goldId,
        },
      ],
      ctxFor(s),
    );

    expect(next.players[p].gy).toHaveLength(0);
    expect(defIdsOf(next, next.players[p].hand)).toEqual(beforeHand);
  });

  test('B39: transform whose target matches nothing changes no zone', () => {
    const goldId = idOfCardNamed('Gold');

    const s = freshMatch(5);
    const p = s.activePlayer;
    const beforeDefIds = defIdsOf(s, s.players[p].hand);
    const beforeTrash = trashCount(s);

    const next = resolveEffects(
      s,
      [
        {
          op: 'transform',
          target: {
            who: 'self',
            zone: 'hand',
            filter: { name: '__no_such_card_name__' },
            count: 1,
          },
          into: goldId,
        },
      ],
      ctxFor(s),
    );

    expect(defIdsOf(next, next.players[p].hand)).toEqual(beforeDefIds);
    expect(trashCount(next)).toBe(beforeTrash);
  });
});

// --- B40 -------------------------------------------------------------------

describe('B40 - trash and Indestructible', () => {
  test('B40: trash removes ordinary hand cards, so the test below can fail', () => {
    const s = freshMatch(10);
    const p = s.activePlayer;
    const beforeTrash = trashCount(s);

    const next = resolveEffects(
      s,
      [{ op: 'trash', target: { who: 'self', zone: 'hand' } }],
      ctxFor(s),
    );

    expect(next.players[p].hand).toHaveLength(0);
    expect(trashCount(next)).toBe(beforeTrash + 5);
  });

  test('B40: {op:"trash"} leaves an Indestructible instance in place', () => {
    const s0 = freshMatch(11);
    const p = s0.activePlayer;
    const s = structuredClone(s0);
    for (const iid of s.players[p].hand) {
      s.instances[iid].addedKeywords.push('Indestructible');
    }
    const beforeHand = [...s.players[p].hand];
    const beforeTrash = trashCount(s);

    const next = resolveEffects(
      s,
      [{ op: 'trash', target: { who: 'self', zone: 'hand' } }],
      ctxFor(s),
    );

    expect(next.players[p].hand).toEqual(beforeHand);
    expect(trashCount(next)).toBe(beforeTrash);
    for (const iid of beforeHand) {
      expect(next.instances[iid].zone).toBe('hand');
    }
  });

  test('B40: trash removes only the destructible half of a mixed hand', () => {
    const s0 = freshMatch(12);
    const p = s0.activePlayer;
    const s = structuredClone(s0);
    const protectedIids = s.players[p].hand.slice(0, 2);
    const doomedIids = s.players[p].hand.slice(2);
    for (const iid of protectedIids) {
      s.instances[iid].addedKeywords.push('Indestructible');
    }
    const beforeTrash = trashCount(s);

    const next = resolveEffects(
      s,
      [{ op: 'trash', target: { who: 'self', zone: 'hand' } }],
      ctxFor(s),
    );

    expect(next.players[p].hand).toEqual(protectedIids);
    expect(trashCount(next)).toBe(beforeTrash + doomedIids.length);
    for (const iid of doomedIids) {
      expect(next.instances[iid].zone).toBe('trash');
    }
  });

  test('B40: a card that prints Indestructible survives trash without any runtime keyword', () => {
    const printed = allCards().find((c) => c.keywords.includes('Indestructible'));
    expect(printed, 'the catalog must contain a printed Indestructible card').toBeDefined();
    const defId = printed!.id;

    const s0 = freshMatch(13);
    const p = s0.activePlayer;

    const withCard = resolveEffects(
      s0,
      [{ op: 'createCard', defId, to: 'hand' }],
      ctxFor(s0),
    );
    expect(withCard.players[p].hand).toHaveLength(6);
    const createdIid = withCard.players[p].hand.find(
      (iid) => withCard.instances[iid].defId === defId,
    );
    expect(createdIid).toBeDefined();

    const next = resolveEffects(
      withCard,
      [{ op: 'trash', target: { who: 'self', zone: 'hand' } }],
      ctxFor(withCard),
    );

    expect(next.players[p].hand).toContain(createdIid!);
    expect(next.instances[createdIid!].zone).toBe('hand');
  });

  test('B40: trashing an Indestructible instance twice still leaves it in place', () => {
    const s0 = freshMatch(14);
    const p = s0.activePlayer;
    const s = structuredClone(s0);
    for (const iid of s.players[p].hand) {
      s.instances[iid].addedKeywords.push('Indestructible');
    }
    const beforeHand = [...s.players[p].hand];

    const once = resolveEffects(
      s,
      [{ op: 'trash', target: { who: 'self', zone: 'hand' } }],
      ctxFor(s),
    );
    const twice = resolveEffects(
      once,
      [{ op: 'trash', target: { who: 'self', zone: 'hand' } }],
      ctxFor(once),
    );

    expect(twice.players[p].hand).toEqual(beforeHand);
  });

  test('B40: an Indestructible instance in the GY is left in place too', () => {
    const s0 = freshMatch(16);
    const p = s0.activePlayer;
    const s = structuredClone(s0);
    moveCards(s, p, 'hand', 'gy', 3);
    for (const iid of s.players[p].gy) {
      s.instances[iid].addedKeywords.push('Indestructible');
    }
    const beforeGy = [...s.players[p].gy];
    const beforeTrash = trashCount(s);

    const next = resolveEffects(
      s,
      [{ op: 'trash', target: { who: 'self', zone: 'gy' } }],
      ctxFor(s),
    );

    expect(next.players[p].gy).toEqual(beforeGy);
    expect(trashCount(next)).toBe(beforeTrash);
  });

  test('B40: a trash whose target matches nothing removes nothing', () => {
    const s = freshMatch(15);
    const p = s.activePlayer;
    const beforeHand = [...s.players[p].hand];
    const beforeTrash = trashCount(s);

    const next = resolveEffects(
      s,
      [
        {
          op: 'trash',
          target: { who: 'self', zone: 'hand', filter: { name: '__no_such_card_name__' } },
        },
      ],
      ctxFor(s),
    );

    expect(next.players[p].hand).toEqual(beforeHand);
    expect(trashCount(next)).toBe(beforeTrash);
  });
});

// --- B41 -------------------------------------------------------------------

describe('B41 - multiplyNext doubles the next card played, once', () => {
  test('B41: {op:"multiplyNext", factor:2} doubles the next card stat output', () => {
    const s0 = freshMatch(20);
    const p = s0.activePlayer;
    const makers = moneyMakersInHand(s0);
    expect(makers.length).toBeGreaterThanOrEqual(1);
    const a = makers[0];

    const plain = reduce(s0, { type: 'play', player: p, iid: a });
    const plainGain = plain.players[p].money - s0.players[p].money;
    expect(plainGain).toBeGreaterThan(0);

    const withMod = resolveEffects(s0, [{ op: 'multiplyNext', factor: 2 }], ctxFor(s0));
    const doubled = reduce(withMod, { type: 'play', player: p, iid: a });
    const doubledGain = doubled.players[p].money - withMod.players[p].money;

    expect(doubledGain).toBe(plainGain * 2);
  });

  test('B41: multiplyNext by itself grants nothing before a card is played', () => {
    const s0 = freshMatch(21);
    const p = s0.activePlayer;

    const withMod = resolveEffects(s0, [{ op: 'multiplyNext', factor: 2 }], ctxFor(s0));

    expect(withMod.players[p].money).toBe(s0.players[p].money);
    expect(withMod.players[p].hand).toHaveLength(5);
  });

  test('B41: the multiplier applies once, so the second card played is not doubled', () => {
    const s0 = freshMatch(22);
    const p = s0.activePlayer;
    const makers = moneyMakersInHand(s0);
    expect(makers.length).toBeGreaterThanOrEqual(2);
    const [a, b] = makers;

    const plain1 = reduce(s0, { type: 'play', player: p, iid: a });
    const plain2 = reduce(plain1, { type: 'play', player: p, iid: b });
    const plainSecondGain = plain2.players[p].money - plain1.players[p].money;
    expect(plainSecondGain).toBeGreaterThan(0);

    const withMod = resolveEffects(s0, [{ op: 'multiplyNext', factor: 2 }], ctxFor(s0));
    const mult1 = reduce(withMod, { type: 'play', player: p, iid: a });
    const mult2 = reduce(mult1, { type: 'play', player: p, iid: b });
    const multSecondGain = mult2.players[p].money - mult1.players[p].money;

    expect(multSecondGain).toBe(plainSecondGain);
  });

  test('B41: {op:"multiplyNext", factor:1} leaves the next card output unchanged', () => {
    const s0 = freshMatch(23);
    const p = s0.activePlayer;
    const makers = moneyMakersInHand(s0);
    expect(makers.length).toBeGreaterThanOrEqual(1);
    const a = makers[0];

    const plain = reduce(s0, { type: 'play', player: p, iid: a });
    const plainGain = plain.players[p].money - s0.players[p].money;

    const withMod = resolveEffects(s0, [{ op: 'multiplyNext', factor: 1 }], ctxFor(s0));
    const same = reduce(withMod, { type: 'play', player: p, iid: a });

    expect(same.players[p].money - withMod.players[p].money).toBe(plainGain);
  });

  test('B41: multiplyNext does not retroactively double an already-played card', () => {
    const s0 = freshMatch(24);
    const p = s0.activePlayer;
    const makers = moneyMakersInHand(s0);
    expect(makers.length).toBeGreaterThanOrEqual(1);
    const a = makers[0];

    const played = reduce(s0, { type: 'play', player: p, iid: a });
    const moneyAfterPlay = played.players[p].money;

    const withMod = resolveEffects(played, [{ op: 'multiplyNext', factor: 2 }], ctxFor(played));

    expect(withMod.players[p].money).toBe(moneyAfterPlay);
  });
});

// --- B42 -------------------------------------------------------------------

describe('B42 - recruit moves matching cards to hand and shuffles the source zone', () => {
  test('B42: recruit defaults to the Library and moves cards into hand', () => {
    const s = freshMatch(30);
    const p = s.activePlayer;

    const next = resolveEffects(s, [{ op: 'recruit', count: 2 }], ctxFor(s));

    expect(next.players[p].hand).toHaveLength(7);
    expect(next.players[p].library).toHaveLength(3);
  });

  test('B42: recruit shuffles the source zone, advancing the rng cursor', () => {
    const s = freshMatch(31);

    const next = resolveEffects(s, [{ op: 'recruit', zone: 'library', count: 2 }], ctxFor(s));

    expect(next.rngCursor).toBeGreaterThan(s.rngCursor);
  });

  test('B42: recruit honours its filter and brings back only matching cards', () => {
    const copperId = idOfCardNamed('Copper');

    const s = freshMatch(32);
    const p = s.activePlayer;
    const beforeHand = new Set(s.players[p].hand);
    expect(
      s.players[p].library.filter((iid) => s.instances[iid].defId === copperId).length,
    ).toBeGreaterThan(0);

    const next = resolveEffects(
      s,
      [{ op: 'recruit', zone: 'library', filter: { name: 'Copper' }, count: 1 }],
      ctxFor(s),
    );

    expect(next.players[p].hand).toHaveLength(6);
    const added = next.players[p].hand.filter((iid) => !beforeHand.has(iid));
    expect(added).toHaveLength(1);
    expect(next.instances[added[0]].defId).toBe(copperId);
    expect(next.instances[added[0]].zone).toBe('hand');
  });

  test('B42: recruit takes what it can when count exceeds the zone size', () => {
    const s = freshMatch(33);
    const p = s.activePlayer;

    const next = resolveEffects(s, [{ op: 'recruit', zone: 'library', count: 99 }], ctxFor(s));

    expect(next.players[p].library).toHaveLength(0);
    expect(next.players[p].hand).toHaveLength(10);
  });

  test('B42: recruit with count 0 moves nothing', () => {
    const s = freshMatch(34);
    const p = s.activePlayer;
    const beforeHand = [...s.players[p].hand];

    const next = resolveEffects(s, [{ op: 'recruit', zone: 'library', count: 0 }], ctxFor(s));

    expect(next.players[p].hand).toEqual(beforeHand);
    expect(next.players[p].library).toHaveLength(5);
  });

  test('B42: recruit whose filter matches nothing moves nothing', () => {
    const s = freshMatch(35);
    const p = s.activePlayer;
    const beforeHand = [...s.players[p].hand];

    const next = resolveEffects(
      s,
      [
        {
          op: 'recruit',
          zone: 'library',
          filter: { name: '__no_such_card_name__' },
          count: 3,
        },
      ],
      ctxFor(s),
    );

    expect(next.players[p].hand).toEqual(beforeHand);
    expect(next.players[p].library).toHaveLength(5);
  });

  test('B42: recruit from an empty zone moves nothing and does not throw', () => {
    const s = freshMatch(36);
    const p = s.activePlayer;

    let next: GameState | undefined;
    expect(() => {
      next = resolveEffects(s, [{ op: 'recruit', zone: 'trash', count: 2 }], ctxFor(s));
    }).not.toThrow();

    const out = next as GameState;
    expect(out.players[p].hand).toHaveLength(5);
  });

  test('B42: recruit from a named zone pulls out of that zone, not the Library', () => {
    const s0 = freshMatch(37);
    const p = s0.activePlayer;
    const s = structuredClone(s0);
    moveCards(s, p, 'library', 'gy', 4);
    expect(s.players[p].gy).toHaveLength(4);
    expect(s.players[p].library).toHaveLength(1);

    const next = resolveEffects(s, [{ op: 'recruit', zone: 'gy', count: 2 }], ctxFor(s));

    expect(next.players[p].hand).toHaveLength(7);
    expect(next.players[p].gy).toHaveLength(2);
    expect(next.players[p].library).toHaveLength(1);
  });

  test('B42: recruit creates no cards - the deck total is conserved', () => {
    const s = freshMatch(38);
    const p = s.activePlayer;
    const total = (g: GameState): number =>
      g.players[p].library.length +
      g.players[p].hand.length +
      g.players[p].gy.length +
      g.players[p].play.length;

    const next = resolveEffects(s, [{ op: 'recruit', zone: 'library', count: 3 }], ctxFor(s));

    expect(total(next)).toBe(total(s));
  });
});
