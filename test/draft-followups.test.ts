/**
 * The Draft, review round 3 follow-ups (SB-69).
 *
 *   DRAFT-2   MEOW MEOW MEOW meowifies the option faces
 *   DRAFT-3   under Dynamic Pricing / Fading Blossom the faces show the drafted pile's price
 *   DRAFT-4   the idle deadline's decisions (turntimer.ts), and concede during a draft (MERGE-1)
 *   MERGE-3/4 the turn banner's trigger: premove exit and the draft ending
 *   MERGE-5   the host's resume snapshot is replaced when the draft completes
 *   badges    "drafting" / "done" on the seat strip instead of "to move"
 *   MOB-5     the lobby's Draft heading and its control are one group
 *   MOB-M1    "Pick one"
 *   shrink    a real match through the small-pool path deals every card once
 */

import { describe, expect, test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch, legalActions, reduce } from '@engine/index';
import { viewFor } from '@engine/view';
import { getCard } from '@engine/registry';
import { meowify, scaleShopCost, shopPriceScale } from '@engine/meta';
import { draftCandidates, prophetCandidates } from '@engine/shop';
import { dynamicPriceFor } from '@engine/shop/dynamic';
import { divideSlots, draftSetSizes, isOpenSlot } from '@engine/core/draft';
import type {
  AnomalyId,
  CardDefId,
  DraftSlot,
  GameAction,
  GameState,
  GameView,
  MatchConfig,
  PlayerId,
} from '@engine/types';
import { TableLayout, turnBannerKey, turnBannerTrigger } from '@ui/App';
import { Lobby } from '@ui/Lobby';
import { Opponents } from '@ui/Opponents';
import { PromptOverlay } from '@ui/PromptOverlay';
import { draftIdleKey, draftTimeoutMove } from '@ui/turntimer';
import { snapshotKey, type LobbyInfo } from '@ui/useGame';

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

const playerOf = (a: GameAction): string => (a as { player: string }).player;

/** Every open slot's pick, its last option, in reverse slot order. */
function allPicks(s: GameState): GameAction[] {
  return slotsOf(s)
    .filter(isOpenSlot)
    .reverse()
    .map((slot): GameAction => ({ type: 'draftPick', player: slot.player, slot: slot.index, defId: slot.options[slot.options.length - 1]! }));
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

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

// ---------------------------------------------------------------------------

describe('DRAFT-2: MEOW MEOW MEOW reaches the option faces', () => {
  test('every option face is meowified, like every other card face', () => {
    const s = deal(2, 24, {}, 'meow_meow_meow');
    const faces = s.playerOrder.flatMap((pid) => viewFor(s, pid).draft!.slots.flatMap((slot) => slot.options));
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      const printed = getCard(face.defId).text;
      expect(face.text, face.defId).toBe(printed === '' ? '' : meowify(printed));
    }
    expect(faces.some((face) => face.text !== getCard(face.defId).text)).toBe(true);
  });

  test('without the anomaly the faces keep the printed text', () => {
    const s = deal(2, 24);
    for (const face of viewFor(s, 'p1').draft!.slots.flatMap((slot) => slot.options)) {
      expect(face.text).toBe(getCard(face.defId).text);
    }
  });
});

describe('DRAFT-3: the faces show the price the drafted pile will have', () => {
  for (const [anomaly, seed] of [
    ['dynamic_pricing', 21],
    ['fading_blossom', 22],
  ] as const) {
    test(anomaly, () => {
      const s = deal(2, seed, {}, anomaly);
      const scale = shopPriceScale(anomaly)!;
      const shown = new Map<CardDefId, number | null>();
      for (const pid of s.playerOrder) {
        for (const slot of viewFor(s, pid).draft!.slots) {
          for (const face of slot.options) {
            const printed = getCard(face.defId).cost.money;
            const live = dynamicPriceFor(s, face.defId, s.playerOrder[0]!);
            const base = printed === undefined ? null : (live ?? printed) + (s.variants[face.defId]?.costDelta ?? 0);
            expect(face.cost, face.defId).toBe(base === null ? null : scaleShopCost(base, scale));
            shown.set(face.defId, face.cost);
          }
        }
      }
      expect([...shown].some(([defId, cost]) => cost !== (getCard(defId).cost.money ?? null))).toBe(true);

      // And the pile each pick became is priced exactly as its face said.
      const done = run(s, allPicks(s));
      const piles = viewFor(done, 'p1').shop.draft.filter((pile) => pile.top !== null);
      expect(piles.length).toBe(10);
      for (const pile of piles) expect(pile.cost, pile.id).toBe(shown.get(pile.top!.defId));
    });
  }
});

describe('DRAFT-4: the idle deadline picks for a seat that stopped picking (turntimer.ts)', () => {
  const only =
    (id: PlayerId) =>
    (pid: PlayerId): boolean =>
      pid === id;
  const firstOpen = (s: GameState, pid: PlayerId): DraftSlot => slotsOf(s).find((slot) => slot.player === pid && isOpenSlot(slot))!;

  test('the deadline waits on the next open slot of the seats this browser controls', () => {
    const s = deal(2, 51);
    const key = draftIdleKey(s, only('p1'));
    expect(key).toBe(`p1:${firstOpen(s, 'p1').index}`);
    expect(draftIdleKey(s, () => true)).toBe(`p1:${firstOpen(s, 'p1').index},p2:${firstOpen(s, 'p2').index}`);
    expect(draftIdleKey(s, () => false)).toBeNull();

    // Somebody else's pick does not restart your deadline; your own does.
    const theirs = allPicks(s).find((a) => playerOf(a) === 'p2')!;
    expect(draftIdleKey(reduce(s, theirs), only('p1'))).toBe(key);

    const slot = firstOpen(s, 'p1');
    const move = draftTimeoutMove(s, only('p1'))!;
    expect(move.player).toBe('p1');
    expect(move.action).toEqual({ type: 'draftPick', player: 'p1', slot: slot.index, defId: slot.options[0] });
    const after = reduce(s, move.action);
    expect(lastReject(after)).toBeNull();
    expect(draftIdleKey(after, only('p1'))).not.toBe(key);
  });

  test('once per slot, never for a seat this browser does not control, nothing outside a draft', () => {
    const s = deal(2, 52);
    const move = draftTimeoutMove(s, only('p1'))!;
    expect(draftTimeoutMove(s, only('p1'), new Set([move.key]))).toBeNull();
    expect(draftTimeoutMove(s, () => false)).toBeNull();
    const done = run(s, allPicks(s));
    expect(draftIdleKey(done, () => true)).toBeNull();
    expect(draftTimeoutMove(done, () => true)).toBeNull();
    const ended = { ...s, ended: true };
    expect(draftIdleKey(ended, () => true)).toBeNull();
    expect(draftTimeoutMove(ended, () => true)).toBeNull();
  });

  test('deadlines alone finish the draft, and turn play starts', () => {
    let st = deal(3, 53);
    const sent = new Set<string>();
    for (let i = 0; i < 100 && st.draft; i++) {
      const move = draftTimeoutMove(st, () => true, sent);
      expect(move).not.toBeNull();
      sent.add(move!.key);
      st = run(st, [move!.action]);
    }
    expect(st.draft).toBeNull();
    expect(st.shop.order.draft).toHaveLength(10);
    expect(legalActions(st, st.activePlayer).some((a) => a.type === 'endTurn')).toBe(true);
  });
});

describe('DRAFT-4 / MERGE-1: concede during a draft', () => {
  test("concede gets past the drafting gate and picks the conceder's open slots with options[0]", () => {
    const s = deal(3, 61);
    const open = slotsOf(s).filter((slot) => slot.player === 'p2' && isOpenSlot(slot));
    expect(open.length).toBeGreaterThan(0);

    const after = reduce(s, { type: 'concede', player: 'p2' });
    expect(lastReject(after)).toBeNull();
    expect(after.players['p2']!.eliminated).toBe(true);
    for (const slot of open) expect(after.draft!.slots[slot.index]!.pick).toBe(slot.options[0]);
    expect(after.draft!.slots.filter((slot) => slot.player !== 'p2').some(isOpenSlot)).toBe(true);
    expect(after.activePlayer).toBe('p1');
    expect(after.ended).toBe(false);
    const kinds = after.log.slice(s.log.length).map((e) => e.kind);
    expect(kinds[0]).toBe('concede');
    expect(kinds.filter((k) => k === 'draftPick')).toHaveLength(open.length);

    const done = run(after, allPicks(after));
    expect(done.draft).toBeNull();
    for (const slot of open) expect(pileDefs(done, slot.kind)).toContain(slot.options[0]);
  });

  test('a concession that leaves nothing to pick builds the shops as usual', () => {
    const s = deal(3, 62);
    const others = run(s, allPicks(s).filter((a) => playerOf(a) !== 'p2'));
    expect(others.draft).not.toBeNull();
    const after = reduce(others, { type: 'concede', player: 'p2' });
    expect(after.draft).toBeNull();
    expect(after.shop.order.draft).toHaveLength(10);
    expect(after.shop.order.prophet).toHaveLength(4);
    expect(after.log.some((e) => e.kind === 'draftComplete')).toBe(true);
  });

  test('the active player conceding during a draft passes the turn', () => {
    const s = deal(3, 63);
    expect(s.activePlayer).toBe('p1');
    const after = reduce(s, { type: 'concede', player: 'p1' });
    expect(lastReject(after)).toBeNull();
    expect(after.activePlayer).toBe('p2');
    const done = run(after, allPicks(after));
    expect(done.draft).toBeNull();
    expect(lastReject(reduce(done, { type: 'endTurn', player: 'p2' }))).toBeNull();
  });

  test('a concession that ends the game closes the draft for everyone', () => {
    const s = deal(2, 64);
    const after = reduce(s, { type: 'concede', player: 'p2' });
    expect(after.ended).toBe(true);
    expect(after.winners).toEqual(['p1']);
    expect(after.draft).toBeNull();
    expect(after.shop.order.draft).toHaveLength(10);
  });

  test('conceding twice is refused (B118), and a replay reproduces the state (B119)', () => {
    const actions: GameAction[] = [
      { type: 'concede', player: 'p3' },
      { type: 'concede', player: 'p3' },
    ];
    const st = actions.reduce((acc, a) => reduce(acc, a), deal(3, 65));
    expect(lastReject(st)).toBe('eliminated');
    const again = actions.reduce((acc, a) => reduce(acc, a), deal(3, 65));
    expect(JSON.stringify(again)).toBe(JSON.stringify(st));
  });
});

describe('MERGE-3 / MERGE-4: the turn banner', () => {
  type BannerView = Pick<GameView, 'turn' | 'activePlayer' | 'ended' | 'draft'>;
  const at = (turn: number, activePlayer: PlayerId, drafting = false): BannerView => ({
    turn,
    activePlayer,
    ended: false,
    draft: drafting ? { slots: [], remaining: {} } : null,
  });

  /** TurnBanner's trigger through useOneShot's rule: a sweep when a non-null trigger differs from the last. */
  function sweeps(frames: [BannerView, boolean][]): boolean[] {
    let lastReal: string | null = null;
    let prev: string | null | undefined;
    return frames.map(([view, suppress]) => {
      const real = turnBannerKey(view);
      const trigger = turnBannerTrigger(real, suppress, lastReal);
      if (!suppress) lastReal = real;
      const sweep = prev !== undefined && prev !== trigger && trigger !== null;
      prev = trigger;
      return sweep;
    });
  }

  test('MERGE-3: leaving premove mode on the same turn does not sweep', () => {
    expect(
      sweeps([
        [at(3, 'p1'), false],
        [at(4, 'p2'), true],
        [at(4, 'p2'), true],
        [at(3, 'p1'), false],
      ]),
    ).toEqual([false, false, false, false]);
  });

  test('leaving premove after the real turn moved sweeps once', () => {
    expect(
      sweeps([
        [at(3, 'p1'), false],
        [at(5, 'p2'), true],
        [at(4, 'p2'), false],
        [at(4, 'p2'), false],
      ]),
    ).toEqual([false, false, true, false]);
  });

  test('MERGE-4: the draft ending sweeps once, though the turn and the seat are unchanged', () => {
    expect(
      sweeps([
        [at(1, 'p1', true), false],
        [at(1, 'p1', true), false],
        [at(1, 'p1'), false],
        [at(1, 'p1'), false],
        [at(2, 'p2'), false],
      ]),
    ).toEqual([false, false, true, false, true]);
  });
});

describe('MERGE-5: the host snapshot', () => {
  test('is replaced when the draft completes on the same turn, not on every pick', () => {
    const s = deal(2, 81);
    const onePick = run(s, allPicks(s).slice(0, 1));
    expect(snapshotKey(onePick)).toBe(snapshotKey(s));
    const done = run(s, allPicks(s));
    expect(done.turn).toBe(s.turn);
    expect(snapshotKey(done)).not.toBe(snapshotKey(s));
    const next = run(done, [{ type: 'endTurn', player: done.activePlayer }]);
    expect(snapshotKey(next)).not.toBe(snapshotKey(done));
  });
});

describe('seat badges while drafting', () => {
  const strip = (view: GameView): string => renderToStaticMarkup(React.createElement(Opponents, { view }));
  const badgeOf = (html: string, pid: string): string | null => {
    const seat = html.split('data-player-id="').find((part) => part.startsWith(`${pid}"`)) ?? '';
    return /data-draft="(\w+)"/.exec(seat)?.[1] ?? null;
  };

  test('"drafting" and "done" replace "to move"; turn play brings the normal badges back', () => {
    const s = deal(2, 71);
    const html = strip(viewFor(s, 'p1'));
    expect(count(html, 'data-draft="drafting"')).toBe(2);
    expect(html).not.toContain('to move');
    expect(html).not.toContain('opponent-turn');
    expect(html).not.toContain('seat-turn-self');
    expect(html).not.toContain('data-active="true"');

    const mine = run(s, allPicks(s).filter((a) => playerOf(a) === 'p1'));
    const half = strip(viewFor(mine, 'p2'));
    expect(badgeOf(half, 'p1')).toBe('done');
    expect(badgeOf(half, 'p2')).toBe('drafting');

    const done = run(mine, allPicks(mine));
    const play = strip(viewFor(done, 'p2'));
    expect(play).not.toContain('data-draft=');
    expect(play).toContain('to move');
    expect(play).toContain('opponent-turn');
  });
});

describe('copy and the phone lobby', () => {
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
  const lobby = (i: LobbyInfo): string =>
    renderToStaticMarkup(React.createElement(Lobby, { info: i, onStart: noop, onSeatCap: noop, onTimer: noop, onDraft: noop, onLeave: noop }));

  test('MOB-5: the Draft heading and its control are one group, for the host and for a guest', () => {
    expect(lobby(info())).toMatch(
      /<span class="lobby-draft-group"[^>]*><span class="lobby-caps-label lobby-draft-label">The Draft<\/span><label class="lobby-draft">/,
    );
    expect(lobby(info({ youAreHost: false }))).toMatch(
      /<span class="lobby-draft-group"[^>]*><span class="lobby-caps-label lobby-draft-label">The Draft<\/span><span class="lobby-timer-state" data-testid="lobby-draft-state">/,
    );
  });

  test('MOB-M1: the Draft panel says "Pick one"', () => {
    const view = viewFor(deal(2, 42), 'p1');
    const html = renderToStaticMarkup(
      React.createElement(TableLayout, {
        view,
        mode: 'host',
        code: 'DRAFT1',
        seats: ['s1'],
        views: { s1: view },
        activeSeat: 's1',
        setActiveSeat: noop,
        send: noop,
        turnSeconds: 90,
      }),
    );
    expect(html).toContain('Pick one · it joins the shop everyone buys from');
    expect(html).not.toContain('Click one');
  });

  test('MOB-M1: a one-pick prompt says "Pick one"', () => {
    const pending = {
      id: 'pr1',
      type: 'choose',
      player: 'p1',
      prompt: 'Choose one',
      options: [
        { key: 'a', label: 'Gain 2 Money' },
        { key: 'b', label: 'Draw 2 cards' },
      ],
      min: 1,
      max: 1,
      then: [],
      ctx: {},
      defaultKeys: [],
    } as unknown as GameView['pending'];
    const html = renderToStaticMarkup(
      React.createElement(PromptOverlay, { pending, playerId: 'p1', names: {}, onAction: noop }),
    );
    expect(html).toContain('Pick one');
    expect(html).not.toContain('Click one');
  });
});

describe('the small-pool shrink path, in a real match, deals every card once', () => {
  for (const players of [2, 3, 4]) {
    test(`${players} players: 15 Prophet slots over the 23-card Prophet pool`, () => {
      const sizes = draftSetSizes(23, 15, 2);
      expect(sizes).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1]);
      for (const seed of [1, 2, 3]) {
        const s = deal(players, seed, { prophetPileCount: 15 });
        const slots = slotsOf(s);
        const shown = slots.flatMap((slot) => slot.options);
        expect(new Set(shown).size, `seed ${seed}: a card was dealt twice`).toBe(shown.length);

        // The shrink sizes, walked round-robin by seat the way the dealer walks them.
        const prophet = slots.filter((slot) => slot.kind === 'prophet');
        expect(prophetCandidates(s)).toHaveLength(23);
        const bySeat = s.playerOrder.map((pid) => prophet.filter((slot) => slot.player === pid));
        expect(bySeat.map((own) => own.length)).toEqual(divideSlots(15, players));
        const walk: DraftSlot[] = [];
        for (let r = 0; r < Math.max(...bySeat.map((own) => own.length)); r++) {
          for (const own of bySeat) if (own[r]) walk.push(own[r]!);
        }
        expect(walk.map((slot) => slot.options.length)).toEqual(sizes);

        // Every Prophet candidate dealt exactly once; a 1-card set is picked at the deal.
        expect(new Set(prophet.flatMap((slot) => slot.options))).toEqual(new Set(prophetCandidates(s).map((d) => d.id)));
        for (const slot of prophet) expect(slot.pick).toBe(slot.options.length === 1 ? slot.options[0] : null);

        const done = run(s, allPicks(s));
        const prophetPiles = pileDefs(done, 'prophet');
        const draftPiles = pileDefs(done, 'draft');
        expect(prophetPiles).toHaveLength(15);
        expect(draftPiles).toHaveLength(10);
        expect(new Set([...prophetPiles, ...draftPiles]).size).toBe(25);
      }
    });
  }

  test('the Draft pool shrinks too: 115 Draft slots over the whole pool', () => {
    const s = deal(2, 7, { draftPileCount: 115 });
    const pool = draftCandidates(s).length;
    expect(pool).toBeLessThan(4 * 115);
    const draftSlots = slotsOf(s).filter((slot) => slot.kind === 'draft');
    const shown = draftSlots.flatMap((slot) => slot.options);
    expect(shown).toHaveLength(pool);
    expect(new Set(shown).size).toBe(pool);
    const desc = (xs: number[]): number[] => [...xs].sort((a, b) => b - a);
    expect(desc(draftSlots.map((slot) => slot.options.length))).toEqual(desc(draftSetSizes(pool, 115, 4)));
  });
});
