/**
 * UI-2's interaction rules, all pure:
 *
 *   K1  a keystroke never fires while the player is typing, or with a modifier
 *   K2  an open prompt owns the keyboard, so a digit means one thing at a time
 *   K3  a focused button keeps Space and Enter, so one press is one action
 *   K4  keys that need a turn are inert on someone else's turn
 *   K5  Space never ends the turn (MOT-12); E does; M plays money
 *   K6  the help sheet lists exactly what the map implements
 *   P1  a single-pick prompt swaps rather than refusing the second click
 *   P2  ordering prompts need every option before Confirm lights up
 *   P3  one-of-N Discover/choose submits on the click; everything else confirms (TURN-7)
 *   $1  Play money plays plain Resources only, biggest first (TURN-2)
 *   $2  Play money stands down around cards and rules that make order matter
 *   I1  a play that only adds combo is not advertised as playable (TURN-9)
 *   D1  "nothing left to do" (TURN-10)
 *   V1  stabilizeView keeps unchanged cards, piles and seats by identity (RENDER-1)
 *   L1  the log collapses runs of the same line
 *   A1  small faces use the WebP thumbnail, big ones the jpg (ART-1)
 */

import { describe, expect, it } from 'vitest';
import type { CardView, GameView, OpponentView, PileView, Prompt, SelfView } from '@engine/types';
import { reduce } from '@engine/index';
import { viewFor } from '@engine/view';
import { KEY_HELP, digitIndex, digitLabel, keyIntent, type KeyContext } from '@ui/keys';
import { allPiles, promptBounds, promptReady, togglePick } from '@ui/prompt';
import {
  addBuyFlight,
  endTurnBlocked,
  inFlightPiles,
  isInertPlay,
  isPlainResource,
  isRepeatPress,
  isUsefulPlay,
  playMoneyPlan,
  submitsOnPick,
  turnDone,
  BUY_REPEAT_MS,
  END_TURN_GRACE_MS,
} from '@ui/turnflow';
import { isNewlyArrived } from '@ui/Hand';
import { endReasonText } from '@ui/logtext';
import { cardSignature, stabilizeView } from '@ui/viewcache';
import { collapseLines } from '@ui/Log';
import { artKeysIn, artThumbUrl, artUrl } from '@ui/art';
import { seedMatch } from '@ui/useGame';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '@ui/Board';
import { ensureRegistry } from '@net/bootstrap';

ensureRegistry();

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function ctx(patch: Partial<KeyContext> = {}): KeyContext {
  return {
    yourTurn: true,
    ended: false,
    handSize: 5,
    promptOpen: false,
    promptOptionCount: 0,
    promptReady: false,
    promptCanSkip: false,
    promptHasDefault: false,
    editing: false,
    focusedTag: null,
    ...patch,
  };
}

describe('keys', () => {
  it('K1: every key is inert while the player is typing', () => {
    for (const key of ['1', 'e', 'm', ' ', 'Enter', '?', '[', 'ArrowLeft']) {
      expect(keyIntent({ key }, ctx({ editing: true }))).toBeNull();
    }
  });

  it('K1: a modifier means the keystroke belongs to the browser', () => {
    expect(keyIntent({ key: '1', ctrlKey: true }, ctx())).toBeNull();
    expect(keyIntent({ key: 'm', metaKey: true }, ctx())).toBeNull();
    expect(keyIntent({ key: 'e', altKey: true }, ctx())).toBeNull();
  });

  it('plays the nth card in hand, and reaches a tenth with 0', () => {
    expect(keyIntent({ key: '1' }, ctx())).toEqual({ kind: 'playHand', index: 0 });
    expect(keyIntent({ key: '5' }, ctx())).toEqual({ kind: 'playHand', index: 4 });
    expect(keyIntent({ key: '6' }, ctx({ handSize: 5 }))).toBeNull();
    expect(digitIndex('0')).toBe(9);
    expect(keyIntent({ key: '0' }, ctx({ handSize: 10 }))).toEqual({ kind: 'playHand', index: 9 });
  });

  it('digit badges and digit keys agree', () => {
    for (let i = 0; i < 10; i += 1) expect(digitIndex(digitLabel(i) ?? '')).toBe(i);
    expect(digitLabel(10)).toBeNull();
  });

  it('K2: an open prompt takes the digits away from the hand, and everything else too', () => {
    const p = ctx({ promptOpen: true, promptOptionCount: 3 });
    expect(keyIntent({ key: '1' }, p)).toEqual({ kind: 'pickOption', index: 0 });
    expect(keyIntent({ key: '4' }, p)).toBeNull();
    for (const key of ['e', 'm', '[', 'ArrowLeft']) expect(keyIntent({ key }, p)).toBeNull();
  });

  it('K2: Enter confirms only once satisfied; S and D only when offered', () => {
    expect(keyIntent({ key: 'Enter' }, ctx({ promptOpen: true, promptOptionCount: 3 }))).toBeNull();
    expect(keyIntent({ key: 'Enter' }, ctx({ promptOpen: true, promptReady: true }))).toEqual({ kind: 'confirmPrompt' });
    const bare = ctx({ promptOpen: true, promptOptionCount: 2 });
    expect(keyIntent({ key: 's' }, bare)).toBeNull();
    expect(keyIntent({ key: 'd' }, bare)).toBeNull();
    expect(keyIntent({ key: 's' }, { ...bare, promptCanSkip: true })).toEqual({ kind: 'skipPrompt' });
    expect(keyIntent({ key: 'd' }, { ...bare, promptHasDefault: true })).toEqual({ kind: 'takeDefault' });
  });

  it('K3: a focused button keeps Space and Enter for itself', () => {
    expect(keyIntent({ key: ' ' }, ctx({ focusedTag: 'button' }))).toBeNull();
    expect(keyIntent({ key: 'Enter' }, ctx({ focusedTag: 'button', promptOpen: true, promptReady: true }))).toBeNull();
    expect(keyIntent({ key: '2' }, ctx({ focusedTag: 'button' }))).toEqual({ kind: 'playHand', index: 1 });
  });

  it('K4: playing, ending, money and reordering need it to be your turn', () => {
    const theirs = ctx({ yourTurn: false });
    for (const key of ['1', 'e', 'm', '[', ']']) expect(keyIntent({ key }, theirs)).toBeNull();
    expect(keyIntent({ key: 'ArrowRight' }, theirs)).toEqual({ kind: 'moveFocus', delta: 1 });
    expect(keyIntent({ key: 'l' }, theirs)).toEqual({ kind: 'toggleLog' });
    expect(keyIntent({ key: '?' }, theirs)).toEqual({ kind: 'toggleHelp' });
  });

  it('K4: a finished game accepts help and log but no play', () => {
    const over = ctx({ ended: true });
    expect(keyIntent({ key: '1' }, over)).toBeNull();
    expect(keyIntent({ key: 'e' }, over)).toBeNull();
    expect(keyIntent({ key: '?' }, over)).toEqual({ kind: 'toggleHelp' });
  });

  it('K5: E ends the turn and Space does not (MOT-12)', () => {
    expect(keyIntent({ key: 'e' }, ctx())).toEqual({ kind: 'endTurn' });
    expect(keyIntent({ key: 'E' }, ctx())).toEqual({ kind: 'endTurn' });
    expect(keyIntent({ key: ' ' }, ctx())).toBeNull();
    expect(keyIntent({ key: 'Spacebar' }, ctx())).toBeNull();
  });

  it('K5: M plays money; brackets nudge', () => {
    expect(keyIntent({ key: 'm' }, ctx())).toEqual({ kind: 'playMoney' });
    expect(keyIntent({ key: 'M' }, ctx())).toEqual({ kind: 'playMoney' });
    expect(keyIntent({ key: '[' }, ctx())).toEqual({ kind: 'nudgeHand', delta: -1 });
    expect(keyIntent({ key: ']' }, ctx())).toEqual({ kind: 'nudgeHand', delta: 1 });
  });

  it('K6: the help sheet lists the bindings the map implements, and no Space', () => {
    const text = KEY_HELP.map((r) => `${r.keys} ${r.what}`).join(' ').toLowerCase();
    for (const needle of ['play', 'end your turn', 'confirm', 'reorder', 'play money']) expect(text).toContain(needle);
    expect(text).not.toContain('space');
    // Every advertised key actually does something in some context.
    const probes: [string, Partial<KeyContext>][] = [
      ['1', {}],
      ['0', { handSize: 10 }],
      ['m', {}],
      ['e', {}],
      ['ArrowLeft', {}],
      ['[', {}],
      ['Enter', { promptOpen: true, promptReady: true }],
      ['s', { promptOpen: true, promptCanSkip: true }],
      ['d', { promptOpen: true, promptHasDefault: true }],
      ['Escape', { promptOpen: true }],
      ['l', {}],
      ['?', {}],
    ];
    for (const [key, patch] of probes) expect(keyIntent({ key }, ctx(patch)), key).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function prompt(patch: Partial<Prompt> = {}): Prompt {
  return {
    id: 'q1',
    type: 'discover',
    player: 'p1',
    prompt: 'Discover',
    options: [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
      { key: 'c', label: 'C' },
    ],
    min: 1,
    max: 1,
    then: [],
    ctx: {},
    defaultKeys: [],
    ...patch,
  };
}

describe('prompt selection', () => {
  it('P1: a single-pick prompt swaps rather than refusing the second pick', () => {
    expect(togglePick(['a'], 'b', { ordering: false, max: 1 })).toEqual(['b']);
    expect(togglePick(['a'], 'a', { ordering: false, max: 1 })).toEqual([]);
  });

  it('P2: an ordering prompt needs every option before it is ready', () => {
    const p = prompt({ type: 'order', min: 3, max: 3 });
    expect(promptBounds(p).required).toBe(3);
    expect(promptReady(p, ['a', 'b'])).toBe(false);
    expect(promptReady(p, ['c', 'a', 'b'])).toBe(true);
  });

  it('P3: one-of-N Discover and choose submit on the click (TURN-7)', () => {
    expect(submitsOnPick(prompt())).toBe(true);
    expect(submitsOnPick(prompt({ type: 'choose' }))).toBe(true);
  });

  it('P3: multi-picks, orderings and card selections keep Confirm', () => {
    expect(submitsOnPick(prompt({ max: 2 }))).toBe(false);
    expect(submitsOnPick(prompt({ min: 0 }))).toBe(false);
    expect(submitsOnPick(prompt({ type: 'order', min: 3, max: 3 }))).toBe(false);
    // A trash or discard from your hand is a selectCards: a misclick costs a card.
    expect(submitsOnPick(prompt({ type: 'selectCards' }))).toBe(false);
    expect(submitsOnPick(prompt({ type: 'selectPile' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Play money, inert plays, turn done
// ---------------------------------------------------------------------------

function card(iid: string, defId: string, patch: Partial<CardView> = {}): CardView {
  return {
    iid,
    defId,
    name: defId,
    cost: 0,
    prophetCost: null,
    types: ['Resource'],
    subtypes: [],
    rarity: 'basic',
    keywords: [],
    stats: { money: 1 },
    text: '',
    counters: {},
    playable: true,
    ...patch,
  };
}

const copper = (iid: string): CardView => card(iid, 'copper', { stats: { money: 1 } });
const silver = (iid: string): CardView => card(iid, 'silver', { stats: { money: 2 } });
const gold = (iid: string): CardView => card(iid, 'gold', { stats: { money: 3 } });
const tix = (iid: string): CardView => card(iid, 'tix', { types: ['Points'], stats: { vp: 1 } });

function self(patch: Partial<SelfView> = {}): SelfView {
  return {
    id: 'p1',
    name: 'A',
    hand: [],
    play: [],
    gy: [],
    field: [],
    libraryCount: 10,
    money: 0,
    buys: 1,
    actions: 1,
    prophet: 0,
    vp: 0,
    combo: 0,
    delayedCount: 0,
    quest: null,
    ...patch,
  };
}

function opp(patch: Partial<OpponentView> = {}): OpponentView {
  return { id: 'p2', name: 'B', handCount: 5, libraryCount: 10, gy: [], play: [], field: [], vp: 0, prophet: 0, eliminated: false, ...patch };
}

function pile(id: string, cost: number, count = 5): PileView {
  return {
    id,
    shop: 'draft',
    top: count > 0 ? card(`${id}_top`, 'silver', { cost }) : null,
    count,
    cost,
    prophetCost: null,
    locked: false,
    lockedUntil: null,
  };
}

function gview(patch: Partial<GameView> = {}): GameView {
  return {
    you: self(),
    others: [opp()],
    shop: { resource: [], points: [], prophet: [], draft: [] },
    turn: 1,
    round: 1,
    activePlayer: 'p1',
    anomaly: null,
    pending: null,
    ended: false,
    winners: null,
    endReason: null,
    log: [],
    doomsdayCounter: 0,
    hardEndTurn: null,
    ...patch,
  };
}

describe('play money (TURN-2)', () => {
  it('$1: plain Resources only, highest Money first, ties in hand order', () => {
    const hand = [copper('c1'), tix('t1'), gold('g1'), copper('c2'), silver('s1')];
    const plan = playMoneyPlan(gview({ you: self({ hand }) }));
    expect(plan.blocked).toBeNull();
    expect(plan.iids).toEqual(['g1', 's1', 'c1', 'c2']);
    expect(plan.total).toBe(7);
  });

  it('$1: a Resource with an effect, a keyword or no Money is not plain', () => {
    expect(isPlainResource(copper('c'))).toBe(true);
    // Gleamstone is plain money (no effects, no keywords); Fool's Gold is Flimsy.
    expect(isPlainResource(card('x', 'gleamstone', { stats: { money: 4 } }))).toBe(true);
    expect(isPlainResource(card('x', 'fools_gold', { keywords: ['Flimsy'] as CardView['keywords'] }))).toBe(false);
    // The definition is what decides: a face whose card has effects is never plain.
    expect(isPlainResource(card('x', 'magnet'))).toBe(false);
    expect(isPlainResource(card('x', 'copper', { keywords: ['Flimsy'] as CardView['keywords'] }))).toBe(false);
    expect(isPlainResource(card('x', 'copper', { stats: { money: 0 } }))).toBe(false);
    expect(isPlainResource(tix('t'))).toBe(false);
  });

  it('$1: a card the engine says is unplayable is left out', () => {
    const plan = playMoneyPlan(gview({ you: self({ hand: [copper('c1'), { ...silver('s1'), playable: false }] }) }));
    expect(plan.iids).toEqual(['c1']);
  });

  it('$2: an Action that consumes Resources from hand blocks it', () => {
    for (const id of ['simple_refining', 'advanced_refining', 'pennymelting', 'currency_cremator']) {
      const hand = [copper('c1'), card('a1', id, { types: ['Action'], stats: {} })];
      const plan = playMoneyPlan(gview({ you: self({ hand }) }));
      expect(plan.blocked, id).not.toBeNull();
      expect(plan.iids).toEqual([]);
    }
  });

  it('$2: Symphony of 3 and the five-elements anomaly block it', () => {
    const hand = [copper('c1')];
    const aura = { auraId: 'symphony_of_3', name: 'Symphony of 3', tier: 'celestial' as const, text: '', usedThisTurn: false };
    expect(playMoneyPlan(gview({ you: self({ hand, field: [aura] }) })).blocked).not.toBeNull();
    const anomaly = { id: 'dongfang_youxi_sheji', name: 'Dongfang Youxi Sheji', text: '' } as GameView['anomaly'];
    expect(playMoneyPlan(gview({ you: self({ hand }), anomaly })).blocked).not.toBeNull();
  });

  it('$2: off turn, mid-prompt, or with no money it is disabled with a reason', () => {
    const hand = [copper('c1')];
    expect(playMoneyPlan(gview({ you: self({ hand }), activePlayer: 'p2' })).blocked).toBe('Not your turn');
    const pending = { waitingOn: 'p2' } as GameView['pending'];
    expect(playMoneyPlan(gview({ you: self({ hand }), pending })).blocked).not.toBeNull();
    expect(playMoneyPlan(gview({ you: self({ hand: [tix('t')] }) })).blocked).toBe('No plain money in hand');
  });

  it('$1: on a real opening hand it plays exactly the Coppers', () => {
    const s = seedMatch(2, 11);
    const v = viewFor(s, s.activePlayer);
    const plan = playMoneyPlan(v);
    const coppers = v.you.hand.filter((c) => c.defId === 'copper').map((c) => c.iid);
    if (v.anomaly && v.anomaly.id === 'dongfang_youxi_sheji') {
      expect(plan.blocked).not.toBeNull();
      return;
    }
    expect(plan.iids.slice().sort()).toEqual(coppers.slice().sort());
    // Playing them through the engine in that order raises Money by the total.
    let st = s;
    for (const iid of plan.iids) st = reduce(st, { type: 'play', player: s.activePlayer, iid });
    expect(viewFor(st, s.activePlayer).you.money - v.you.money).toBe(plan.total);
  });
});

describe('inert plays (TURN-9)', () => {
  it('I1: Tix only adds combo, so it is not advertised as playable', () => {
    expect(isInertPlay(tix('t'))).toBe(true);
    expect(isUsefulPlay(tix('t'), true)).toBe(false);
  });

  it('I1: money, Actions and cards with effects are useful plays', () => {
    expect(isInertPlay(copper('c'))).toBe(false);
    expect(isInertPlay(card('a', 'village', { types: ['Action'], stats: { actions: 2 } }))).toBe(false);
    expect(isUsefulPlay(copper('c'), true)).toBe(true);
    expect(isUsefulPlay(copper('c'), false)).toBe(false);
    expect(isUsefulPlay({ ...copper('c'), playable: false }, true)).toBe(false);
  });
});

describe('turn done (TURN-10)', () => {
  it('D1: done when nothing useful is in hand and nothing is affordable', () => {
    const v = gview({ you: self({ hand: [tix('t')], money: 1, buys: 1 }), shop: { resource: [], points: [], prophet: [], draft: [pile('x', 3)] } });
    expect(turnDone(v)).toBe(true);
  });

  /**
   * H2. A pile the engine refuses is not "something left to do". Water Into
   * Swine put a Cursed Pig on every Draft pile: the price still read 0, so the
   * turn never reported itself done and the Buy stayed lit over nothing.
   */
  it('D1: a pile the engine refuses does not count as something left to do', () => {
    const refused: PileView = {
      ...pile('x', 0),
      top: { ...card('x_top', 'cursed_pig', { cost: 0 }), affordable: false },
    };
    const v = gview({
      you: self({ hand: [tix('t')], money: 5, buys: 1 }),
      shop: { resource: [], points: [], prophet: [], draft: [refused] },
    });
    expect(turnDone(v)).toBe(true);
  });

  it('D1: not done with money in hand, an affordable pile, or a live prompt', () => {
    const shop = { resource: [], points: [], prophet: [], draft: [pile('x', 3)] };
    expect(turnDone(gview({ you: self({ hand: [copper('c')] }), shop }))).toBe(false);
    expect(turnDone(gview({ you: self({ money: 3 }), shop }))).toBe(false);
    expect(turnDone(gview({ you: self({ money: 3, buys: 0 }), shop }))).toBe(true);
    expect(turnDone(gview({ pending: { waitingOn: 'p2' } as GameView['pending'] }))).toBe(false);
    expect(turnDone(gview({ activePlayer: 'p2' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Render cost
// ---------------------------------------------------------------------------

describe('stabilizeView (RENDER-1)', () => {
  it('V1: an unchanged card, pile and seat keep their identity across views', () => {
    const s = seedMatch(2, 5);
    const me = s.activePlayer;
    const a = viewFor(s, me);
    const b = viewFor(s, me);
    expect(a).not.toBe(b);
    const st = stabilizeView(a, b);
    expect(st.you.hand).toBe(a.you.hand);
    expect(st.shop.draft).toBe(a.shop.draft);
    expect(st.others[0]).toBe(a.others[0]);
    expect(st.log).toBe(a.log);
  });

  it('V1: a card that changed is replaced, and only it', () => {
    const s = seedMatch(2, 5);
    const me = s.activePlayer;
    const a = viewFor(s, me);
    const copperIid = a.you.hand.find((c) => c.defId === 'copper')?.iid;
    if (!copperIid) return;
    const next = viewFor(reduce(s, { type: 'play', player: me, iid: copperIid }), me);
    const st = stabilizeView(a, next);
    expect(st.you.hand).not.toBe(a.you.hand);
    // Cards still in hand whose face didn't change are the same objects.
    for (const c of st.you.hand) {
      const old = a.you.hand.find((o) => o.iid === c.iid);
      if (old && cardSignature(old) === cardSignature(c)) expect(c).toBe(old);
    }
    expect(st.you.play.map((c) => c.iid)).toContain(copperIid);
  });

  it('V1: the first view and a missing prev pass through', () => {
    const s = seedMatch(2, 5);
    const a = viewFor(s, s.activePlayer);
    expect(stabilizeView(null, a)).toBe(a);
  });
});

describe('log (RENDER-1)', () => {
  it('L1: runs of the same line in the same turn collapse, keeping the first seq', () => {
    const line = (seq: number, text: string, turn = 1, who: string | null = 'A') => ({ seq, turn, who, text, tone: 'system' });
    const out = collapseLines([line(9, 'draws a card'), line(8, 'draws a card'), line(7, 'draws a card'), line(6, 'plays Copper'), line(5, 'draws a card', 0)]);
    expect(out.map((l) => [l.seq, l.text, l.times])).toEqual([
      [9, 'draws a card', 3],
      [6, 'plays Copper', 1],
      [5, 'draws a card', 1],
    ]);
  });
});

describe('the board tells the truth about what can be bought (H2)', () => {
  it('B1: a pile the engine refuses renders unbuyable, and says why', () => {
    const refused: PileView = {
      ...pile('draft:coal', 0),
      top: { ...card('coal_top', 'cursed_pig', { cost: 0, name: 'Cursed Pig' }), affordable: false },
    };
    const v = gview({
      you: self({ money: 5, buys: 1 }),
      shop: { resource: [], points: [], prophet: [], draft: [refused] },
    });
    const html = renderToStaticMarkup(
      React.createElement(Board, { view: v, onBuy: () => undefined, yourTurn: true }),
    );
    // Affordable by price, refused by the engine: the button must be off.
    expect(html).toContain('data-buyable="false"');
    expect(html).toContain('can’t be bought');
  });

  it('B1: an ordinary affordable pile is still buyable', () => {
    const ok: PileView = { ...pile('draft:spotter', 3), top: { ...card('s_top', 'spotter', { cost: 3 }), affordable: true } };
    const v = gview({
      you: self({ money: 5, buys: 1 }),
      shop: { resource: [], points: [], prophet: [], draft: [ok] },
    });
    const html = renderToStaticMarkup(
      React.createElement(Board, { view: v, onBuy: () => undefined, yourTurn: true }),
    );
    expect(html).toContain('data-buyable="true"');
  });
});

describe('game over reads as a sentence (L1)', () => {
  it('B1: an engine end reason is rendered in English, never as its identifier', () => {
    expect(endReasonText('jlorePileEmpty')).toBe('the Jlore pile ran out');
    expect(endReasonText('emptyPiles')).toBe('enough Draft piles were emptied');
    expect(endReasonText(null)).toBe('the game ended');
    // An end reason nobody has written a sentence for still reads as words.
    expect(endReasonText('someNewReason')).toBe('some new reason');
  });
});

describe('art (ART-1)', () => {
  it('A1: thumbnails are WebP under /art/thumb, full art is the jpg', () => {
    expect(artThumbUrl('copper')).toBe('/art/thumb/copper.webp');
    expect(artUrl('copper')).toBe('/art/copper.jpg');
  });

  it('A1: the preload list covers the hand and every pile top, once each', () => {
    const s = seedMatch(2, 21);
    const v = viewFor(s, s.activePlayer);
    const keys = artKeysIn(v);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of v.you.hand) if (c.art?.key) expect(keys).toContain(c.art.key);
    for (const p of v.shop.draft) if (p.top?.art?.key) expect(keys).toContain(p.top.art.key);
  });
});

describe('buys in flight (TURN-8, UI-R2)', () => {
  it('B1: every pile bought under one view stays guarded, not just the last', () => {
    let f = addBuyFlight(null, 'a', 7);
    f = addBuyFlight(f, 'b', 7);
    // Clicking A again before the table has answered must still find A in flight.
    expect(inFlightPiles(f, 7, 1).has('a')).toBe(true);
    expect(inFlightPiles(f, 7, 1).has('b')).toBe(true);
    expect(addBuyFlight(f, 'a', 7)).toBe(f);
  });

  it('B1: a newer view clears the guard, and a buy under it starts afresh', () => {
    const f = addBuyFlight(addBuyFlight(null, 'a', 7), 'b', 7);
    expect(inFlightPiles(f, 8, 1).size).toBe(0);
    expect(addBuyFlight(f, 'c', 8)).toEqual({ ids: ['c'], revision: 8 });
    expect(inFlightPiles(null, 8, 1).size).toBe(0);
  });

  /**
   * SEAM-2. Under optimistic apply (SB-65) the press is reduced locally and the
   * log grows before the post leaves, so the view's revision has already moved
   * on by the next render — the revision-keyed guard cleared itself and a
   * double-click could buy twice whenever the engine still allowed a second buy
   * (2+ Buys, or a Prophet pile, which consumes none).
   */
  it('B1: nothing shows busy once this browser has no unconfirmed intent', () => {
    const f = addBuyFlight(null, 'a', 7);
    expect(inFlightPiles(f, 7, 1).has('a')).toBe(true);
    // The relay echoed it: the pile's own state now says what happened.
    expect(inFlightPiles(f, 7, 0).size).toBe(0);
  });

  it('B1: a repeat press on the same pile inside the window is one gesture', () => {
    const first = { key: 'draft:coal', atMs: 1_000 };
    expect(isRepeatPress(first, 'draft:coal', 1_000 + BUY_REPEAT_MS - 1)).toBe(true);
    // Far enough apart to be two deliberate buys, which is legal with 2 Buys.
    expect(isRepeatPress(first, 'draft:coal', 1_000 + BUY_REPEAT_MS + 1)).toBe(false);
    // A different pile is always a different gesture.
    expect(isRepeatPress(first, 'draft:spotter', 1_000 + 10)).toBe(false);
    expect(isRepeatPress(null, 'draft:coal', 1_000)).toBe(false);
  });

  /**
   * SEAM-1. In hotseat the screen follows whoever must act, so ending your turn
   * puts the NEXT player's End turn button under the pointer in the same frame.
   * A quick E,E then ended two turns (1 -> 3).
   */
  it('B1: End turn ignores the keyboard for a moment after the turn changes', () => {
    const changed = 5_000;
    expect(endTurnBlocked(changed, changed + END_TURN_GRACE_MS - 1)).toBe(true);
    expect(endTurnBlocked(changed, changed + END_TURN_GRACE_MS + 1)).toBe(false);
    // Nothing has changed yet: the first End turn of a match is never blocked.
    expect(endTurnBlocked(null, 5_000)).toBe(false);
  });

  /**
   * MP-1. A card that puts cards into your hand refills the slot the pointer is
   * still on, and the arrival was never "launched", so the second click of a
   * double-click played it — a card the player never chose.
   */
  it('B1: a card that arrived after the play is not clickable while the hand settles', () => {
    const settle = { known: new Set(['magnet']), untilMs: 1_000 };
    expect(isNewlyArrived(settle, 'copper_new', 999)).toBe(true);
    // The card that was there all along stays clickable.
    expect(isNewlyArrived(settle, 'magnet', 999)).toBe(false);
    // Once the hand has settled the new card is a normal, clickable card.
    expect(isNewlyArrived(settle, 'copper_new', 1_001)).toBe(false);
    expect(isNewlyArrived(null, 'copper_new', 0)).toBe(false);
  });

  it('B1: the board turns off the Buy of every pile in flight', () => {
    const s = seedMatch(2, 21);
    const v = viewFor(s, s.activePlayer);
    const withTop = allPiles(v).filter((p) => p.top !== null && p.count > 0);
    expect(withTop.length).toBeGreaterThanOrEqual(2);
    const ids = new Set([withTop[0]!.id, withTop[1]!.id]);
    const html = renderToStaticMarkup(
      React.createElement(Board, { view: v, onBuy: () => undefined, yourTurn: true, inFlightPiles: ids }),
    );
    expect(html.match(/title="Buying…"/g)?.length).toBe(2);
  });
});
