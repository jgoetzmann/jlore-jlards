/**
 * The Draft (`config.draftMode`, core/draft.ts): the Draft and Prophet shops
 * are filled by the players' picks before turn play.
 *
 * Covers: every dealt card distinct (2/3/4 players, 50 seeds each, and the
 * owner's worked example), slot division with leftovers in seating order, the
 * owner's small-pool rule (sets shrink, 1-card sets are auto-picked, slots past
 * the last card stay empty, round-robin spreads the shrinking), draftPick
 * validation and the table freeze, the shops built from the picks, turn play
 * afterwards, anomalies that touch the shops at setup, the view (B111), B118,
 * B119 replay, and lockstep between two browsers.
 */

import { describe, expect, test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch, legalActions, reduce } from '@engine/index';
import { viewFor } from '@engine/view';
import { getCard } from '@engine/registry';
import {
  VP_THRESHOLD_EXCLUDED_IDS,
  draftCandidates,
  draftPileSize,
  prophetCandidates,
  prophetPileSize,
} from '@engine/shop';
import { dealDraftSlots, divideSlots, draftSetSizes } from '@engine/core/draft';
import type {
  AnomalyId,
  CardDefId,
  DraftSlot,
  GameAction,
  GameState,
  MatchConfig,
  PlayerId,
} from '@engine/types';
import { makeLocalRelay, type LobbyPayload } from '@net/relay';
import { startLobbyHost } from '@net/host';
import { makeStart, startSession, stateChecksum, type LockstepSession } from '@net/lockstep';
import { TableLayout } from '@ui/App';
import { Lobby } from '@ui/Lobby';
import type { LobbyInfo } from '@ui/useGame';

const NAMES = ['Ada', 'Bru', 'Cyd', 'Dee'];

function cfg(playerCount: number, over: Partial<MatchConfig> = {}): MatchConfig {
  return {
    playerCount,
    draftPileCount: 10,
    prophetPileCount: 4,
    anomalyChance: 0,
    winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
    pileSizeScale: 1,
    effectNodeBudget: 200,
    recursionDepth: 8,
    turnSeconds: 90,
    seedCodexWithCommons: true,
    draftMode: true,
    ...over,
  };
}

function roster(n: number): { id: PlayerId; name: string; codex: CardDefId[] }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: NAMES[i]!, codex: [] }));
}

function deal(n: number, seed: number, over: Partial<MatchConfig> = {}, anomaly: AnomalyId | null = null): GameState {
  return createMatch(cfg(n, over), roster(n), seed, anomaly);
}

function slotsOf(s: GameState): DraftSlot[] {
  expect(s.draft, 'the match should be drafting').not.toBeNull();
  return s.draft!.slots;
}

function lastReject(s: GameState): string | null {
  const e = s.log[s.log.length - 1];
  return e && e.kind === 'reject' ? String(e.detail['reason']) : null;
}

/** Every open slot's pick, in the order given (default: seating order reversed, to prove order does not matter). */
function allPicks(s: GameState, choose: (slot: DraftSlot) => CardDefId = (slot) => slot.options[slot.options.length - 1]!): GameAction[] {
  const open = slotsOf(s).filter((slot) => slot.pick === null && slot.options.length > 0);
  return open
    .slice()
    .reverse()
    .map((slot): GameAction => ({ type: 'draftPick', player: slot.player, slot: slot.index, defId: choose(slot) }));
}

function run(s: GameState, actions: GameAction[]): GameState {
  let next = s;
  for (const a of actions) {
    const after = reduce(next, a);
    expect(lastReject(after), `${a.type} was refused`).toBeNull();
    next = after;
  }
  return next;
}

function pileDefs(s: GameState, shop: 'draft' | 'prophet'): CardDefId[] {
  return s.shop.order[shop].map((pid) => s.instances[s.shop.piles[pid]!.cards[0]!]!.defId);
}

// ---------------------------------------------------------------------------

describe('the deal: every card shown to every player is distinct', () => {
  for (const players of [2, 3, 4]) {
    test(`no card appears twice across every slot of every player — ${players} players, 50 seeds`, () => {
      for (let seed = 1; seed <= 50; seed++) {
        const s = deal(players, seed);
        const shown = slotsOf(s).flatMap((slot) => slot.options);
        expect(shown).toHaveLength(4 * 10 + 2 * 4);
        expect(new Set(shown).size, `seed ${seed} dealt a card twice`).toBe(shown.length);
        // The pools are disjoint and each slot draws from its own shop's pool.
        const draftIds = new Set(draftCandidates(s).map((d) => d.id));
        const prophetIds = new Set(prophetCandidates(s).map((d) => d.id));
        for (const slot of slotsOf(s)) {
          for (const id of slot.options) {
            expect((slot.kind === 'draft' ? draftIds : prophetIds).has(id)).toBe(true);
          }
        }
      }
    });
  }

  test("the owner's worked example: 2 players, Draft 10, Prophet 4 → 48 distinct cards", () => {
    const s = deal(2, 20260912);
    for (const pid of ['p1', 'p2']) {
      const mine = slotsOf(s).filter((slot) => slot.player === pid);
      const draft = mine.filter((slot) => slot.kind === 'draft');
      const prophet = mine.filter((slot) => slot.kind === 'prophet');
      expect(draft.map((slot) => slot.options.length)).toEqual([4, 4, 4, 4, 4]);
      expect(prophet.map((slot) => slot.options.length)).toEqual([2, 2]);
      expect(mine.every((slot) => slot.pick === null)).toBe(true);
    }
    const shown = slotsOf(s).flatMap((slot) => slot.options);
    expect(shown).toHaveLength(48);
    expect(new Set(shown).size).toBe(48);
    // The Draft and Prophet shops wait for the picks; the other two are dealt.
    expect(s.shop.order.draft).toHaveLength(0);
    expect(s.shop.order.prophet).toHaveLength(0);
    expect(s.shop.order.resource.length).toBeGreaterThan(0);
    expect(s.shop.order.points.length).toBeGreaterThan(0);
    // Opening hands as normal.
    expect(s.players['p1']!.hand).toHaveLength(5);
    expect(s.players['p2']!.hand).toHaveLength(5);
  });

  test('a match without draftMode is dealt exactly as before', () => {
    const plain = createMatch(cfg(2, { draftMode: undefined }), roster(2), 77, null);
    const off = createMatch(cfg(2, { draftMode: false }), roster(2), 77, null);
    expect(plain.draft).toBeNull();
    expect(plain.shop.order.draft).toHaveLength(10);
    expect(plain.shop.order.prophet).toHaveLength(4);
    expect('draftMode' in plain.config).toBe(false);
    expect(off).toEqual(plain);
  });
});

describe('slots: divided evenly, leftovers in seating order, contiguous per player', () => {
  test('divideSlots', () => {
    expect(divideSlots(10, 2)).toEqual([5, 5]);
    expect(divideSlots(10, 3)).toEqual([4, 3, 3]);
    expect(divideSlots(4, 3)).toEqual([2, 1, 1]);
    expect(divideSlots(10, 4)).toEqual([3, 3, 2, 2]);
    expect(divideSlots(4, 4)).toEqual([1, 1, 1, 1]);
    expect(divideSlots(10, 1)).toEqual([10]);
  });

  test('3 players: Draft 10 → 4, 3, 3 and Prophet 4 → 2, 1, 1, in seating order', () => {
    const s = deal(3, 9);
    const slots = slotsOf(s);
    expect(slots.map((slot) => slot.index)).toEqual(slots.map((_, i) => i));
    const layout = slots.map((slot) => `${slot.player}:${slot.kind}`);
    expect(layout).toEqual([
      ...Array(4).fill('p1:draft'),
      ...Array(2).fill('p1:prophet'),
      ...Array(3).fill('p2:draft'),
      'p2:prophet',
      ...Array(3).fill('p3:draft'),
      'p3:prophet',
    ]);
  });

  test('4 players: Draft 10 → 3, 3, 2, 2 and Prophet 4 → 1 each', () => {
    const slots = slotsOf(deal(4, 10));
    const count = (pid: string, kind: string): number =>
      slots.filter((slot) => slot.player === pid && slot.kind === kind).length;
    expect(['p1', 'p2', 'p3', 'p4'].map((p) => count(p, 'draft'))).toEqual([3, 3, 2, 2]);
    expect(['p1', 'p2', 'p3', 'p4'].map((p) => count(p, 'prophet'))).toEqual([1, 1, 1, 1]);
  });
});

describe('a small pool shrinks the choices instead of failing', () => {
  const ids = (n: number, prefix = 'c'): CardDefId[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  test("the owner's example: 18 cards over 10 slots of 4 → 4, 4, 3, then seven 1-card sets", () => {
    expect(draftSetSizes(18, 10, 4)).toEqual([4, 4, 3, 1, 1, 1, 1, 1, 1, 1]);

    const slots = dealDraftSlots(['p1'], { draft: 10, prophet: 0 }, { draft: ids(18), prophet: [] });
    expect(slots.map((slot) => slot.options.length)).toEqual([4, 4, 3, 1, 1, 1, 1, 1, 1, 1]);
    const used = slots.flatMap((slot) => slot.options);
    expect(used).toHaveLength(18);
    expect(new Set(used).size).toBe(18);
    // A 1-card set is not a choice: it is picked at deal time.
    for (const slot of slots) {
      if (slot.options.length === 1) expect(slot.pick).toBe(slot.options[0]);
      else expect(slot.pick).toBeNull();
    }
  });

  test('fewer cards than slots: the slots past the last card get none, and nothing throws', () => {
    expect(draftSetSizes(5, 8, 4)).toEqual([1, 1, 1, 1, 1, 0, 0, 0]);
    expect(draftSetSizes(0, 3, 2)).toEqual([0, 0, 0]);
    const slots = dealDraftSlots(['p1'], { draft: 8, prophet: 0 }, { draft: ids(5), prophet: [] });
    expect(slots.filter((slot) => slot.options.length === 0)).toHaveLength(3);
    expect(slots.filter((slot) => slot.options.length === 0).every((slot) => slot.pick === null)).toBe(true);
  });

  test('in a real match: 30 Prophet slots over the 23-card Prophet pool leave 7 empty slots and no piles for them', () => {
    let s: GameState | null = null;
    expect(() => {
      s = deal(2, 31, { prophetPileCount: 30 });
    }).not.toThrow();
    const st = s as unknown as GameState;
    const pool = prophetCandidates(st).length;
    expect(pool).toBe(23);
    const prophet = slotsOf(st).filter((slot) => slot.kind === 'prophet');
    expect(prophet).toHaveLength(30);
    expect(prophet.filter((slot) => slot.options.length === 1)).toHaveLength(23);
    expect(prophet.filter((slot) => slot.options.length === 0)).toHaveLength(7);
    // Only the Draft Shop slots are decisions now.
    expect(slotsOf(st).filter((slot) => slot.pick === null && slot.options.length > 0).every((slot) => slot.kind === 'draft')).toBe(true);

    const done = run(st, allPicks(st));
    expect(done.draft).toBeNull();
    expect(done.shop.order.prophet).toHaveLength(23);
    expect(done.shop.order.draft).toHaveLength(10);
    expect(new Set(pileDefs(done, 'prophet')).size).toBe(23);
  });

  test('round-robin sizing spreads the shrinking over every seat', () => {
    // 30 cards, 2 players with 5 slots each. Walked p1, p2, p1, p2, … the sizes
    // are 4,4,4,4,4,4,3,1,1,1; walked contiguously p2 would have been left
    // with nearly all the 1-card sets.
    const slots = dealDraftSlots(['p1', 'p2'], { draft: 10, prophet: 0 }, { draft: ids(30), prophet: [] });
    const sizes = (pid: string): number[] => slots.filter((slot) => slot.player === pid).map((slot) => slot.options.length);
    expect(sizes('p1')).toEqual([4, 4, 4, 3, 1]);
    expect(sizes('p2')).toEqual([4, 4, 4, 1, 1]);

    for (const players of [2, 3, 4]) {
      const order = ['p1', 'p2', 'p3', 'p4'].slice(0, players);
      for (let cards = 0; cards <= 48; cards++) {
        for (const [draft, prophet] of [
          [10, 4],
          [7, 5],
        ] as const) {
          const dealt = dealDraftSlots(order, { draft, prophet }, { draft: ids(cards, 'd'), prophet: ids(Math.floor(cards / 3), 'r') });
          const used = dealt.flatMap((slot) => slot.options);
          expect(new Set(used).size).toBe(used.length);
          expect(dealt.filter((s) => s.kind === 'draft').flatMap((s) => s.options)).toHaveLength(Math.min(cards, 4 * draft));
          for (const kind of ['draft', 'prophet'] as const) {
            const choices = order.map((pid) => dealt.filter((s) => s.player === pid && s.kind === kind && s.options.length > 1).length);
            const empty = order.map((pid) => dealt.filter((s) => s.player === pid && s.kind === kind && s.options.length === 0).length);
            expect(Math.max(...choices) - Math.min(...choices), `${players}p ${cards} cards ${kind} choices`).toBeLessThanOrEqual(1);
            expect(Math.max(...empty) - Math.min(...empty), `${players}p ${cards} cards ${kind} empties`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe('draftPick: validation, and nothing else while drafting', () => {
  test('wrong player, not an option, no such slot and picked twice are refused, state unchanged', () => {
    const s = deal(2, 11);
    const slots = slotsOf(s);
    const p1First = slots.find((slot) => slot.player === 'p1')!;
    const p2First = slots.find((slot) => slot.player === 'p2')!;

    const wrong = reduce(s, { type: 'draftPick', player: 'p2', slot: p1First.index, defId: p1First.options[0]! });
    expect(lastReject(wrong)).toBe('draftNotYourSlot');
    expect(wrong.draft).toEqual(s.draft);

    const notOption = reduce(s, { type: 'draftPick', player: 'p1', slot: p1First.index, defId: p2First.options[0]! });
    expect(lastReject(notOption)).toBe('draftNotAnOption');
    expect(notOption.draft).toEqual(s.draft);

    expect(lastReject(reduce(s, { type: 'draftPick', player: 'p1', slot: 999, defId: 'copper' }))).toBe('draftNoSuchSlot');
    expect(lastReject(reduce(s, { type: 'draftPick', player: 'p1', slot: 1.5, defId: 'copper' }))).toBe('draftNoSuchSlot');

    const once = reduce(s, { type: 'draftPick', player: 'p1', slot: p1First.index, defId: p1First.options[2]! });
    expect(lastReject(once)).toBeNull();
    expect(once.draft!.slots[p1First.index]!.pick).toBe(p1First.options[2]);
    const twice = reduce(once, { type: 'draftPick', player: 'p1', slot: p1First.index, defId: p1First.options[0]! });
    expect(lastReject(twice)).toBe('draftAlreadyPicked');
    expect(twice.draft).toEqual(once.draft);

    // B20 does not apply: the non-active player picks as freely as the active one.
    expect(s.activePlayer).toBe('p1');
    expect(lastReject(reduce(s, { type: 'draftPick', player: 'p2', slot: p2First.index, defId: p2First.options[1]! }))).toBeNull();
  });

  test('every other action is refused with `drafting` while the draft runs', () => {
    const s = deal(2, 12);
    const p1 = s.players['p1']!;
    const refused: GameAction[] = [
      { type: 'play', player: 'p1', iid: p1.hand[0]! },
      { type: 'buy', player: 'p1', pileId: s.shop.order.resource[0]! },
      { type: 'endTurn', player: 'p1' },
      { type: 'reorderHand', player: 'p1', hand: [...p1.hand].reverse() },
      { type: 'concede', player: 'p2' },
      { type: 'resolve', player: 'p1', promptId: 'x', keys: [] },
    ];
    for (const action of refused) {
      const next = reduce(s, action);
      expect(lastReject(next), action.type).toBe('drafting');
      expect(next.logSeq).toBe(s.logSeq + 1); // B118: the refusal is logged
      expect({ ...next, log: [], logSeq: 0 }).toEqual({ ...s, log: [], logSeq: 0 });
    }
  });

  test('legalActions offers only picks while drafting, and reduce accepts every one (B25)', () => {
    const s = deal(3, 13);
    for (const pid of s.playerOrder) {
      const legal = legalActions(s, pid);
      expect(legal.length).toBeGreaterThan(0);
      expect(legal.every((a) => a.type === 'draftPick')).toBe(true);
      for (const a of legal.slice(0, 6)) expect(lastReject(reduce(s, a))).toBeNull();
    }
  });

  test('a draftPick with no draft running is refused', () => {
    const s = createMatch(cfg(2, { draftMode: false }), roster(2), 14, null);
    expect(lastReject(reduce(s, { type: 'draftPick', player: 'p1', slot: 0, defId: 'copper' }))).toBe('noDraft');
  });
});

describe('finishing the draft builds the shared shops from the picks', () => {
  test('exactly the picked piles, in slot order, sized as buildShop sizes them; then normal turn play', () => {
    const s = deal(2, 15);
    const slots = slotsOf(s);
    const picks = allPicks(s, (slot) => slot.options[slot.index % slot.options.length]!);
    const beforeLast = run(s, picks.slice(0, -1));
    expect(beforeLast.draft).not.toBeNull();
    expect(beforeLast.shop.order.draft).toHaveLength(0);

    const done = run(beforeLast, picks.slice(-1));
    expect(done.draft).toBeNull();
    const expected = (kind: 'draft' | 'prophet'): CardDefId[] =>
      slots.filter((slot) => slot.kind === kind).map((slot) => slot.options[slot.index % slot.options.length]!);
    expect(pileDefs(done, 'draft')).toEqual(expected('draft'));
    expect(pileDefs(done, 'prophet')).toEqual(expected('prophet'));
    for (const pid of done.shop.order.draft) {
      const pile = done.shop.piles[pid]!;
      const def = getCard(done.instances[pile.cards[0]!]!.defId);
      expect(pile.cards).toHaveLength(draftPileSize(def.rarity, 2, 1));
      expect(pile.cards.every((iid) => done.instances[iid]!.defId === def.id)).toBe(true);
    }
    for (const pid of done.shop.order.prophet) {
      const pile = done.shop.piles[pid]!;
      const def = getCard(done.instances[pile.cards[0]!]!.defId);
      expect(pile.cards).toHaveLength(prophetPileSize(def.rarity, 2, 1));
    }
    // B92: what is in the match is in every codex.
    for (const id of [...expected('draft'), ...expected('prophet')]) {
      expect(done.players['p1']!.codex).toContain(id);
      expect(done.players['p2']!.codex).toContain(id);
      expect(done.defsInMatch).toContain(id);
    }
    const complete = done.log.filter((e) => e.kind === 'draftComplete');
    expect(complete).toHaveLength(1);

    // Normal turn play proceeds.
    let t = done;
    for (const a of legalActions(t, 'p1')) {
      if (a.type === 'play' && t.instances[a.iid]?.defId === 'copper') t = run(t, [a]);
    }
    const buy = legalActions(t, 'p1').find((a) => a.type === 'buy');
    expect(buy).toBeDefined();
    t = run(t, [buy!]);
    t = run(t, [{ type: 'endTurn', player: 'p1' }]);
    expect(t.activePlayer).toBe('p2');
    expect(t.turn).toBe(2);
  });
});

describe('anomalies that touch the shops at setup reach the drafted piles', () => {
  const finish = (s: GameState): GameState => run(s, allPicks(s));
  const drafted = (s: GameState): string[] => [...s.shop.order.draft, ...s.shop.order.prophet];

  test('Dynamic Pricing prices the drafted piles, and the basic piles only once', () => {
    const done = finish(deal(2, 21, {}, 'dynamic_pricing'));
    const plain = createMatch(cfg(2, { draftMode: false }), roster(2), 21, 'dynamic_pricing');
    for (const pid of drafted(done)) expect(done.shop.piles[pid]!.costOverride).toBeDefined();
    for (const pid of done.shop.order.resource) {
      expect(done.shop.piles[pid]!.costOverride).toBe(plain.shop.piles[pid]!.costOverride);
    }
  });

  test('Fading Blossom halves the drafted prices and makes every drafted card Flimsy', () => {
    const done = finish(deal(2, 22, {}, 'fading_blossom'));
    for (const pid of drafted(done)) {
      const pile = done.shop.piles[pid]!;
      expect(pile.costOverride).toBeDefined();
      for (const iid of pile.cards) expect(done.instances[iid]!.addedKeywords).toContain('Flimsy');
    }
  });

  test('Accelerated Game scales the drafted piles', () => {
    const done = finish(deal(2, 23, {}, 'accelerated_game'));
    expect(done.config.pileSizeScale).toBe(0.6);
    for (const pid of done.shop.order.draft) {
      const pile = done.shop.piles[pid]!;
      const def = getCard(done.instances[pile.cards[0]!]!.defId);
      expect(pile.cards).toHaveLength(draftPileSize(def.rarity, 2, 0.6));
    }
  });

  test('MEOW MEOW MEOW rewrites the drafted cards too', () => {
    const done = finish(deal(2, 24, {}, 'meow_meow_meow'));
    const texts = drafted(done).flatMap((pid) => done.shop.piles[pid]!.cards.map((iid) => done.instances[iid]!));
    expect(texts.some((inst) => typeof inst.displayTextOverride === 'string')).toBe(true);
  });

  test('SB-28: a VP-threshold match never offers the excluded cards', () => {
    let seenInStandard = false;
    for (let seed = 1; seed <= 30; seed++) {
      const moon = slotsOf(deal(2, seed, {}, 'aim_for_the_moon')).flatMap((slot) => slot.options);
      for (const id of VP_THRESHOLD_EXCLUDED_IDS) expect(moon).not.toContain(id);
      const std = slotsOf(deal(2, seed)).flatMap((slot) => slot.options);
      if (VP_THRESHOLD_EXCLUDED_IDS.some((id) => std.includes(id))) seenInStandard = true;
    }
    expect(seenInStandard, 'the control never dealt an excluded card, so the test proves nothing').toBe(true);
  });
});

describe('the view', () => {
  test('your slots only, as printed faces; everyone’s remaining count; no hidden ids (B111)', () => {
    const s = deal(2, 41);
    const v1 = viewFor(s, 'p1');
    expect(v1.draft).not.toBeNull();
    expect(v1.draft!.slots).toHaveLength(7);
    expect(v1.draft!.remaining).toEqual({ p1: 7, p2: 7 });
    const mine = slotsOf(s).filter((slot) => slot.player === 'p1');
    expect(v1.draft!.slots.map((slot) => slot.options.map((o) => o.defId))).toEqual(mine.map((slot) => slot.options));
    expect(v1.draft!.slots[0]!.options[0]!.name).toBe(getCard(mine[0]!.options[0]!).name);

    const json = JSON.stringify(v1);
    for (const slot of slotsOf(s).filter((x) => x.player === 'p2')) {
      for (const id of slot.options) expect(json, `p1 was shown p2's option ${id}`).not.toContain(`"${id}"`);
    }
    for (const pid of s.playerOrder) {
      for (const iid of s.players[pid]!.library) expect(json).not.toContain(`"${iid}"`);
      if (pid !== 'p1') for (const iid of s.players[pid]!.hand) expect(json).not.toContain(`"${iid}"`);
    }

    const done = run(s, allPicks(s));
    expect(viewFor(done, 'p1').draft).toBeNull();
  });

  test('the table shows the Draft panel, says Drafting, and runs no clock', () => {
    const s = deal(2, 42);
    const view = viewFor(s, 'p1');
    const html = renderToStaticMarkup(
      React.createElement(TableLayout, {
        view,
        mode: 'host',
        code: 'DRAFT1',
        seats: ['s1'],
        views: { s1: view },
        activeSeat: 's1',
        setActiveSeat: () => undefined,
        send: () => undefined,
        turnSeconds: 90,
      }),
    );
    expect(html).toContain('data-testid="draft-panel"');
    expect(html.match(/data-testid="draft-option"/g)).toHaveLength(4);
    expect(html).toContain('Draft Shop · slot 1 of 5 — pick one');
    expect(html).toContain('You: 7 left · Bru: 7 left');
    expect(html).toMatch(/data-testid="turn-owner"[^>]*>Drafting</);
    expect(html).not.toContain('data-testid="turn-timer"');
    expect(html).toContain('data-your-turn="false"');

    // All of mine picked: the panel waits on the others.
    const mineDone = run(s, allPicks(s).filter((a) => (a as { player: string }).player === 'p1'));
    const waitView = viewFor(mineDone, 'p1');
    const waiting = renderToStaticMarkup(
      React.createElement(TableLayout, {
        view: waitView,
        mode: 'host',
        code: 'DRAFT1',
        seats: ['s1'],
        views: { s1: waitView },
        activeSeat: 's1',
        setActiveSeat: () => undefined,
        send: () => undefined,
        turnSeconds: 90,
      }),
    );
    expect(waiting).toContain('Waiting for Bru to finish drafting');
    expect(waiting).not.toContain('data-testid="draft-option"');
  });
});

describe('determinism', () => {
  test('B119: replaying createMatch and the actions through a draft reproduces the state', () => {
    const s0 = deal(3, 51);
    const actions: GameAction[] = [...allPicks(s0)];
    let s = run(s0, actions);
    for (let i = 0; i < 6; i++) {
      const legal = legalActions(s, s.activePlayer);
      const buy = legal.find((a) => a.type === 'buy');
      const step: GameAction[] = buy ? [buy, { type: 'endTurn', player: s.activePlayer }] : [{ type: 'endTurn', player: s.activePlayer }];
      for (const a of step) {
        s = reduce(s, a);
        actions.push(a);
      }
    }
    let replayed = deal(3, 51);
    for (const a of actions) replayed = reduce(replayed, a);
    expect(replayed).toEqual(s);
    expect(stateChecksum(replayed)).toBe(stateChecksum(s));
  });

  test('the lockstep checksum covers the draft', () => {
    const s = deal(2, 52);
    const other = JSON.parse(JSON.stringify(s)) as GameState;
    const slot = other.draft!.slots[0]!;
    slot.pick = slot.options[0]!;
    expect(stateChecksum(other)).not.toBe(stateChecksum(s));
  });

  test('lockstep: two browsers pick at the same time and agree on the shops', async () => {
    const flush = async (): Promise<void> => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    };
    const relay = makeLocalRelay();
    const seats = ['seatA', 'seatB'];
    const start = makeStart({ seats, config: cfg(2), seed: 53, players: roster(2) });
    const a = startSession(relay, { localSeats: ['seatA'], start, onChange: () => undefined });
    const b = startSession(relay, { localSeats: ['seatB'], onChange: () => undefined });
    const sessions: LockstepSession[] = [a, b];
    try {
      await flush();
      const dealt = a.core.predicted()!;
      const bySeat = { p1: 'seatA', p2: 'seatB' } as Record<string, string>;
      const picks = slotsOf(dealt).filter((slot) => slot.pick === null && slot.options.length > 0);
      const p1 = picks.filter((slot) => slot.player === 'p1');
      const p2 = picks.filter((slot) => slot.player === 'p2');
      // Interleave the two browsers' picks, without waiting on each other.
      for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        for (const slot of [p2[i], p1[i]]) {
          if (!slot) continue;
          const session = bySeat[slot.player] === 'seatA' ? a : b;
          session.send(bySeat[slot.player]!, { type: 'draftPick', player: slot.player, slot: slot.index, defId: slot.options[1]! });
        }
        if (i % 2 === 1) await flush();
      }
      await flush();
      await flush();
      const states = sessions.map((s) => s.core.confirmedState()!);
      expect(states[0]!.draft).toBeNull();
      expect(states[1]!.draft).toBeNull();
      expect(stateChecksum(states[0]!)).toBe(stateChecksum(states[1]!));
      expect(pileDefs(states[0]!, 'draft')).toEqual(slotsOf(dealt).filter((s) => s.kind === 'draft').map((s) => s.options[1]));
      for (const s of sessions) expect(s.core.desynced()).toBe(false);
    } finally {
      for (const s of sessions) s.stop();
      relay.stop();
    }
  });
});

describe('the lobby', () => {
  const info = (patch: Partial<LobbyInfo> = {}): LobbyInfo => ({
    code: 'DRF123',
    members: [{ seat: 's1', name: 'Ada', isHost: true, isYou: true }],
    seatCap: 4,
    youAreHost: true,
    waiting: false,
    full: false,
    missed: false,
    knocking: 0,
    ...patch,
  });
  const noop = (): void => undefined;
  const render = (i: LobbyInfo): string =>
    renderToStaticMarkup(React.createElement(Lobby, { info: i, onStart: noop, onSeatCap: noop, onTimer: noop, onDraft: noop, onLeave: noop }));

  test('the host gets The Draft checkbox, a guest sees the choice read-only', () => {
    expect(render(info())).toMatch(/data-testid="lobby-draft" data-on="false"/);
    expect(render(info({ draft: true }))).toMatch(/data-testid="lobby-draft" data-on="true"/);
    const guest = render(info({ youAreHost: false, draft: true }));
    expect(guest).not.toContain('data-testid="lobby-draft"');
    expect(guest).toContain('data-testid="lobby-draft-state"');
    expect(guest).toContain('players pick the shops');
  });

  test('the choice rides the roster and is frozen into the handoff', () => {
    const relay = makeLocalRelay();
    let last: LobbyPayload | null = null;
    const host = startLobbyHost(relay, {
      code: 'DRF111',
      hostSeat: 's_host',
      hostName: 'Ada',
      seatCap: 2,
      onRoster: (r) => {
        last = r;
      },
    });
    try {
      expect((last as unknown as LobbyPayload).draft).toBe(false);
      host.setDraft(true);
      expect((last as unknown as LobbyPayload).draft).toBe(true);
      const handoff = host.start();
      expect(handoff.draft).toBe(true);
      host.setDraft(false);
      expect(host.roster().draft).toBe(true);
    } finally {
      host.stop();
      relay.stop();
    }
  });
});
