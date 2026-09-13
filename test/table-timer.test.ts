/**
 * SB-67 and the table around it, the pure parts:
 *
 *   T  the turn timer passes the turn, from the browser that controls the seat
 *   F  Time Flail is shown as the engine set it, never divided a second time
 *   L  a room's lobby chooses whether the match has a timer, and every guest sees it
 *   S  every player sits in the strip, you included, with VP on every tile
 *   A  the anomaly's whole rule opens in a panel instead of being truncated
 *
 * A real clock running out, in a real browser, is `e2e/timer.spec.ts`.
 */

import { describe, expect, test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reduce } from '@engine/index';
import { viewFor } from '@engine/view';
import type { GameState, GameView, Prompt } from '@engine/types';
import { AnomalyPanel, TableLayout, parseHash } from '@ui/App';
import { Lobby } from '@ui/Lobby';
import { seedMatch, type LobbyInfo } from '@ui/useGame';
import { timeoutMove, timerLimitSeconds, turnKey } from '@ui/turntimer';
import { makeLocalRelay, type LobbyPayload } from '@net/relay';
import { startLobbyHost } from '@net/host';

const noop = (): void => undefined;

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

function table(view: GameView, turnSeconds = 90): string {
  const views = { s1: view };
  return renderToStaticMarkup(
    React.createElement(TableLayout, {
      view,
      mode: 'hotseat',
      code: null,
      seats: ['s1'],
      views,
      activeSeat: 's1',
      setActiveSeat: noop,
      send: noop,
      turnSeconds,
    }),
  );
}

/** A dealt match with no anomaly, so nothing is pending on turn one. */
function plain(players: number, seed: number): GameState {
  return seedMatch(players, seed, { anomalyChance: 0 });
}

describe('T: the turn timer passes the turn (SB-67)', () => {
  test('T1: 0, negatives and non-numbers all mean no timer', () => {
    expect(timerLimitSeconds(90)).toBe(90);
    expect(timerLimitSeconds(36)).toBe(36);
    expect(timerLimitSeconds(0)).toBe(0);
    expect(timerLimitSeconds(-5)).toBe(0);
    expect(timerLimitSeconds(Number.NaN)).toBe(0);
    expect(timerLimitSeconds(undefined)).toBe(0);
  });

  test('T2: with nothing pending, the active seat ends its turn and no other browser does', () => {
    const s = plain(2, 301);
    const active = s.activePlayer;
    const other = s.playerOrder.find((p) => p !== active)!;
    const mine = timeoutMove(s, (pid) => pid === active);
    expect(mine).toEqual({
      key: `end:${turnKey(s)}`,
      player: active,
      action: { type: 'endTurn', player: active },
    });
    // Every browser's clock runs out. One that does not control the active seat
    // must send nothing: the engine would refuse it as notActivePlayer anyway.
    expect(timeoutMove(s, (pid) => pid === other)).toBeNull();
    // Sent once, never again for that turn.
    expect(timeoutMove(s, () => true, new Set([mine!.key]))).toBeNull();
  });

  test('T3: the End turn it sends is one the engine accepts', () => {
    const s = plain(2, 302);
    const move = timeoutMove(s, () => true)!;
    const next = reduce(s, move.action);
    expect(next.activePlayer).not.toBe(s.activePlayer);
    expect(next.turn).toBeGreaterThan(s.turn);
  });

  test('T4: an open prompt is answered first, with its own default, by whoever owns it', () => {
    const s = plain(2, 303);
    const owner = s.playerOrder[1]!;
    const prompt: Prompt = {
      id: 'pr9',
      type: 'choose',
      player: owner,
      prompt: 'Pick one',
      options: [{ key: 'a', label: 'A' }],
      min: 1,
      max: 1,
      then: [],
      ctx: {},
      defaultKeys: ['a'],
    };
    const st: GameState = { ...s, pending: prompt };
    expect(timeoutMove(st, () => true)).toEqual({
      key: 'resolve:pr9',
      player: owner,
      action: { type: 'resolve', player: owner, promptId: 'pr9', keys: ['a'] },
    });
    // Only the owner's browser answers; the active seat waits for that answer.
    expect(timeoutMove(st, (pid) => pid !== owner)).toBeNull();
  });

  test('T5: a finished game never times out', () => {
    const s = plain(2, 304);
    expect(timeoutMove({ ...s, ended: true }, () => true)).toBeNull();
  });

  test('T6: a table without a timer shows no countdown at all', () => {
    const s = plain(2, 306);
    const html = table(viewFor(s, s.activePlayer), 0);
    expect(html).not.toContain('data-testid="turn-timer"');
    expect(count(html, 'data-testid="turn-number"')).toBe(1);
  });

  test('T7: the hotseat hash can carry a timer, and the plain route is unchanged', () => {
    expect(parseHash('#hotseat:3')).toEqual({ kind: 'hotseat', players: 3 });
    expect(parseHash('#hotseat:2:t0')).toEqual({ kind: 'hotseat', players: 2, turnSeconds: 0 });
    expect(parseHash('#hotseat:4:t45')).toEqual({ kind: 'hotseat', players: 4, turnSeconds: 45 });
  });
});

describe('F: Time Flail', () => {
  test('F1: the clock shows the seconds the engine set, not a second division', () => {
    // The engine stamps 90 / 2.5 = 36 into the config at setup (SB-36). The
    // clock used to divide that again and showed 14s.
    const s = plain(2, 305);
    const view = {
      ...viewFor(s, s.activePlayer),
      anomaly: { id: 'time_flail', name: 'Time Flail', text: 'Turns are 2.5x as fast.' },
    } as GameView;
    const html = table(view, 36);
    expect(html).toContain('36s per turn');
    expect(html).toContain('0:36');
  });
});

function lobbyInfo(patch: Partial<LobbyInfo> = {}): LobbyInfo {
  return {
    code: 'ABC123',
    members: [{ seat: 's1', name: 'Ada', isHost: true, isYou: true }],
    seatCap: 4,
    youAreHost: true,
    waiting: false,
    full: false,
    missed: false,
    knocking: 0,
    ...patch,
  };
}

function lobby(info: LobbyInfo): string {
  return renderToStaticMarkup(
    React.createElement(Lobby, { info, onStart: noop, onSeatCap: noop, onTimer: noop, onLeave: noop }),
  );
}

describe('L: the lobby chooses whether to deal with a timer', () => {
  test('L1: the host gets an On/Off control, pressed on the current choice', () => {
    const on = lobby(lobbyInfo());
    expect(count(on, 'data-testid="lobby-timer"')).toBe(2);
    expect(on).toMatch(/data-testid="lobby-timer" data-on="true" aria-pressed="true"/);
    const off = lobby(lobbyInfo({ timerOn: false }));
    expect(off).toMatch(/data-testid="lobby-timer" data-on="false" aria-pressed="true"/);
  });

  test('L2: a guest sees the choice before the deal but cannot change it', () => {
    const guest = lobby(lobbyInfo({ youAreHost: false, timerOn: false }));
    expect(guest).not.toContain('data-testid="lobby-timer"');
    expect(guest).toContain('data-testid="lobby-timer-state"');
    expect(guest).toContain('no time limit');
  });

  test('L3: the choice rides the roster and is frozen into the deal', () => {
    const relay = makeLocalRelay();
    let roster: LobbyPayload | null = null;
    const host = startLobbyHost(relay, {
      code: 'TIM111',
      hostSeat: 's_host',
      hostName: 'Ada',
      seatCap: 2,
      onRoster: (r) => {
        roster = r;
      },
    });
    try {
      expect((roster as unknown as LobbyPayload).timerOn).toBe(true);
      host.setTimerOn(false);
      expect((roster as unknown as LobbyPayload).timerOn).toBe(false);
      const handoff = host.start();
      expect(handoff.timerOn).toBe(false);
      // Once dealt, the choice cannot move.
      host.setTimerOn(true);
      expect(host.roster().timerOn).toBe(false);
    } finally {
      host.stop();
    }
  });
});

describe('S: every player sits in the strip', () => {
  for (const players of [2, 3, 4]) {
    test(`S1: ${players} players, one tile each, yours marked and opponents counted as before`, () => {
      const s = plain(players, 700 + players);
      const me = s.playerOrder[0]!;
      const html = table(viewFor(s, me));
      expect(count(html, 'data-testid="seat-self"')).toBe(1);
      // The specs count opponents by this id; your tile must not add to it.
      expect(count(html, 'data-testid="opponent"')).toBe(players - 1);
      // VP on every tile, yours too.
      expect(count(html, 'seat-score-vp')).toBe(players);
    });
  }

  test('S2: your tile never carries the class the specs use to find the active opponent', () => {
    const s = plain(2, 710);
    const html = table(viewFor(s, s.activePlayer));
    expect(html).not.toContain('opponent-turn');
    expect(html).toContain('seat-turn-self');
  });
});

const LONG =
  'Every pile costs 1 more for each copy bought this round and 1 less for each round nobody buys it.';

describe('A: the anomaly opens in a readable panel', () => {
  test('A1: the chip keeps its full text in the title and says it can be opened', () => {
    const s = plain(2, 720);
    const view = {
      ...viewFor(s, s.activePlayer),
      anomaly: { id: 'dynamic_pricing', name: 'Dynamic Pricing', text: LONG },
    } as GameView;
    const html = table(view);
    expect(html).toContain(`title="Dynamic Pricing: ${LONG}"`);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('data-testid="anomaly-panel"');
  });

  test('A2: the panel shows the whole rule, over the board region', () => {
    const html = renderToStaticMarkup(
      React.createElement(AnomalyPanel, {
        anomaly: { id: 'dynamic_pricing', name: 'Dynamic Pricing', text: LONG },
        onClose: noop,
      }),
    );
    expect(html).toContain('data-testid="anomaly-panel"');
    expect(html).toContain(LONG);
    expect(html).toContain('prompt-panel-host');
  });
});
