/**
 * The browser suite addresses the UI entirely through `data-testid`, and those
 * ids are a contract no unit test was holding. Four parallel rewrites of
 * `App.tsx`, `Hand.tsx`, `Opponents.tsx` and the new `Lobby.tsx` could each have
 * dropped one and the whole unit suite would still have been green — the break
 * would only surface in Playwright, minutes later, as a timeout on a selector.
 *
 * So: render every screen against a real match and assert the ids are there. It
 * doubles as an integration check that each component's props still match what
 * `App.tsx` passes it, which is the other thing parallel slices break.
 *
 * `renderToStaticMarkup` needs no DOM, so this runs in the normal node
 * environment. `useEffect` does not fire under it, which is fine: every id here
 * is rendered from props, not from an effect.
 *
 * Four ids cannot be reached this way and stay browser-only, because they need a
 * live session that has actually received a view: `table`, `connecting`,
 * `you-are` and `seat-btn` — plus `anomaly-banner`, which needs a match that
 * rolled one. `e2e/hotseat.spec.ts` covers all of them in its first two lines.
 */

import { describe, expect, test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reduce } from '@engine/index';
import { viewFor } from '@engine/view';
import type { GameState, GameView, PlayerId, Prompt } from '@engine/types';
import { botAction } from '@sim/bot';
import { App } from '@ui/App';
import { Board } from '@ui/Board';
import { Field } from '@ui/Field';
import { Hand } from '@ui/Hand';
import { Lobby } from '@ui/Lobby';
import { Log } from '@ui/Log';
import { Opponents } from '@ui/Opponents';
import { PromptOverlay } from '@ui/PromptOverlay';
import { TurnBar } from '@ui/TurnBar';
import { seedMatch, type LobbyInfo } from '@ui/useGame';

const noop = (): void => undefined;

function testIdsIn(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/data-testid="([^"]+)"/g)) out.add(m[1]!);
  return out;
}

/** Everything the table renders for one seat, as one string of markup. */
function renderTable(view: GameView, me: PlayerId): string {
  return [
    React.createElement(TurnBar, {
      view,
      playerId: me,
      yourTurn: true,
      turnSeconds: 90,
      onAction: noop,
    }),
    React.createElement(Board, { view, onBuy: noop, yourTurn: true }),
    React.createElement(Hand, {
      hand: view.you.hand,
      playerId: me,
      yourTurn: true,
      actions: view.you.actions,
      onAction: noop,
    }),
    React.createElement(Opponents, { view }),
    React.createElement(Field, {
      field: view.you.field,
      playerId: me,
      money: view.you.money,
      yourTurn: true,
      onAction: noop,
    }),
    React.createElement(PromptOverlay, {
      pending: view.pending,
      playerId: me,
      names: {},
      onAction: noop,
    }),
    React.createElement(Log, { log: view.log, names: {} }),
  ]
    .map((el) => renderToStaticMarkup(el))
    .join('');
}

const LOBBY_BASE: LobbyInfo = {
  code: 'ABC123',
  members: [
    { seat: 's1', name: 'One', isHost: true, isYou: true },
    { seat: 's2', name: 'Two', isHost: false, isYou: false },
  ],
  seatCap: 3,
  youAreHost: true,
  waiting: false,
  full: false,
  missed: false,
  knocking: 1,
};

function renderLobby(patch: Partial<LobbyInfo>): string {
  return renderToStaticMarkup(
    React.createElement(Lobby, {
      info: { ...LOBBY_BASE, ...patch },
      onStart: noop,
      onSeatCap: noop,
      onLeave: noop,
    }),
  );
}

// ---------------------------------------------------------------------------

describe('the data-testid contract the browser suite reads', () => {
  test('the start screen carries every id the specs open on', () => {
    // There is no `window` in this environment, so `parseHash` sees no hash and
    // `App` routes to the start screen — which is the screen under test.
    const ids = testIdsIn(renderToStaticMarkup(React.createElement(App)));
    for (const id of ['create-room', 'hotseat', 'join', 'join-code']) {
      expect(ids, `the start screen lost data-testid="${id}"`).toContain(id);
    }
  });

  test('the table carries every id the specs click', () => {
    for (const playerCount of [2, 3, 4]) {
      const s = seedMatch(playerCount, 4242 + playerCount);
      const me = s.playerOrder[0]!;
      const ids = testIdsIn(renderTable(viewFor(s, me), me));
      for (const id of [
        'board',
        'shop-resource',
        'shop-points',
        'shop-prophet',
        'shop-draft',
        'pile',
        'buy',
        'hand',
        'card',
        'opponents',
        'opponent',
        'end-turn',
        'turn-number',
        'stat-money-value',
        'stat-buys-value',
        'stat-actions-value',
        'stat-prophet-value',
      ]) {
        expect(ids, `a ${playerCount}-player table lost data-testid="${id}"`).toContain(id);
      }
    }
  });

  test('the lobby carries every id the specs wait on, in every state it has', () => {
    const open = testIdsIn(renderLobby({}));
    for (const id of [
      'lobby',
      'lobby-code',
      'lobby-player',
      'lobby-start',
      'lobby-count',
      'lobby-copy',
      'lobby-seat-cap',
      'lobby-knocking',
    ]) {
      expect(open, `the open lobby lost data-testid="${id}"`).toContain(id);
    }

    // A guest gets the waiting line where the host gets the Start button.
    const guest = testIdsIn(renderLobby({ youAreHost: false }));
    expect(guest).toContain('lobby-waiting');
    expect(guest).not.toContain('lobby-start');

    // Both dead ends still render a lobby, and say which one they are. The
    // whole point of them is that nobody is left reading a spinner.
    expect(renderLobby({ missed: true, youAreHost: false })).toContain(
      'data-lobby-state="missed"',
    );
    expect(renderLobby({ full: true, youAreHost: false })).toContain('data-lobby-state="full"');
  });

  test('every prompt id the specs answer with renders', () => {
    // Built by hand rather than played into. A prompt's controls are a pure
    // function of `min` and `defaultKeys`, and reaching an optional prompt
    // (`min: 0`, the one that draws Skip) by simulating real play took twenty
    // seeds and nine seconds — a slow test that pins the bot's luck instead of
    // the markup. `test/effects-choose.test.ts` owns which effects raise which.
    const base: Prompt = {
      id: 'pr1',
      type: 'selectCards',
      player: 'p1',
      prompt: 'Pick a card',
      options: [
        { key: 'a', label: 'Copper' },
        { key: 'b', label: 'Silver' },
      ],
      min: 1,
      max: 1,
      then: [],
      ctx: {},
      defaultKeys: [],
    };

    const render = (pending: GameView['pending'], me: PlayerId): Set<string> =>
      testIdsIn(
        renderToStaticMarkup(
          React.createElement(PromptOverlay, {
            pending,
            playerId: me,
            names: {},
            onAction: noop,
          }),
        ),
      );

    // A required choice: the options and the confirm.
    const required = render(base, 'p1');
    expect(required).toContain('prompt');
    expect(required).toContain('prompt-option');
    expect(required).toContain('prompt-confirm');

    // An optional one can be declined, and one with a timeout answer offers it.
    expect(render({ ...base, min: 0 }, 'p1')).toContain('prompt-skip');
    expect(render({ ...base, defaultKeys: ['a'] }, 'p1')).toContain('prompt-default');

    // Two ways to be the person who is only watching: the prompt belongs to
    // somebody else, or the view never shipped it (B23) and says only whose.
    expect(render(base, 'p2')).toContain('prompt-waiting');
    expect(render({ waitingOn: 'p1' }, 'p2')).toContain('prompt-waiting');
    // ...and the watcher is never handed the options.
    expect(render(base, 'p2')).not.toContain('prompt-option');
  });

  test('a prompt raised by real play still renders as one', () => {
    // The synthetic prompts above pin the controls; this pins that a `pending`
    // the engine actually produces is a shape `PromptOverlay` recognises.
    let s: GameState = seedMatch(2, 6);
    for (let step = 0; step < 600 && !s.pending; step += 1) {
      const next = reduce(s, botAction(s, s.activePlayer));
      // `botAction` always returns something legal, so a state that does not
      // move means the match has stalled rather than that the bot gave up.
      if (next === s) break;
      s = next;
    }
    expect(s.pending, 'seed 6 should reach a prompt within 600 bot actions').not.toBeNull();

    const owner = s.pending!.player;
    const mine = viewFor(s, owner);
    expect(testIdsIn(renderTable(mine, owner))).toContain('prompt');
  });

  test('no seat is rendered another seat’s hand or library', () => {
    // The property `e2e/multiplayer.spec.ts` asserts across two browsers, held
    // here against the markup of every seat in a four-player match. The
    // opponent panel draws a fan of card backs off `handCount`, so this is the
    // check that the fan stayed decorative.
    const s = seedMatch(4, 909);
    for (const me of s.playerOrder) {
      const html = renderTable(viewFor(s, me), me);
      for (const other of s.playerOrder) {
        if (other === me) continue;
        for (const iid of s.players[other]!.hand) {
          expect(html, `${me}'s screen leaked ${other}'s hand instance ${iid}`).not.toContain(iid);
        }
        for (const iid of s.players[other]!.library) {
          expect(html, `${me}'s screen leaked ${other}'s library instance ${iid}`).not.toContain(
            iid,
          );
        }
      }
    }
  });
});
