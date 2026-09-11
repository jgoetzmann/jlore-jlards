/**
 * SB-63 layout, the parts that are pure: where a prompt is answered, that the
 * table renders every region once with the stats and End turn in the dock,
 * that somebody else's decision is a chip and never an overlay (MOT-11), and
 * where the hover preview goes (LAY-6).
 *
 * The geometry itself — no page scroll, the hand and End turn on screen, every
 * Buy hit-testable — needs a browser and lives in `e2e/layout.spec.ts`.
 */

import { describe, expect, test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { viewFor } from '@engine/view';
import type { GameView, PlayerId, Prompt } from '@engine/types';
import { TableLayout } from '@ui/App';
import { handStatus } from '@ui/Hand';
import { placePreview } from '@ui/preview';
import { ownPrompt, promptPlacement, waitingOnOther } from '@ui/prompt';
import { seedMatch } from '@ui/useGame';

const noop = (): void => undefined;

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

function table(view: GameView, opts: { mode?: 'hotseat' | 'host' | 'join'; views?: Record<string, GameView> } = {}): string {
  const views = opts.views ?? { s1: view };
  return renderToStaticMarkup(
    React.createElement(TableLayout, {
      view,
      mode: opts.mode ?? 'hotseat',
      code: null,
      seats: Object.keys(views),
      views,
      activeSeat: Object.keys(views)[0] ?? null,
      setActiveSeat: noop,
      send: noop,
      turnSeconds: 90,
    }),
  );
}

function basePrompt(player: PlayerId, patch: Partial<Prompt> = {}): Prompt {
  return {
    id: 'pr1',
    type: 'selectCards',
    player,
    prompt: 'Pick',
    options: [],
    min: 1,
    max: 1,
    then: [],
    ctx: {},
    defaultKeys: [],
    ...patch,
  };
}

describe('SB-63: prompt placement (LAY-4)', () => {
  const s = seedMatch(2, 77);
  const me = s.playerOrder[0]!;
  const view = viewFor(s, me);

  test('options that are all your hand cards are answered in the hand', () => {
    const options = view.you.hand.slice(0, 2).map((c, i) => ({ key: `k${i}`, label: c.name, iid: c.iid, defId: c.defId }));
    expect(promptPlacement(basePrompt(me, { options }), view)).toBe('hand');
  });

  test('options that are all piles are answered on the board', () => {
    const options = view.shop.resource.map((p, i) => ({ key: `p${i}`, label: p.id, pileId: p.id }));
    expect(promptPlacement(basePrompt(me, { type: 'selectPile', options }), view)).toBe('board');
  });

  test('a Discover, an ordering, or an empty prompt gets the panel', () => {
    expect(
      promptPlacement(basePrompt(me, { type: 'discover', options: [{ key: 'a', label: 'Gold', defId: 'gold' }] }), view),
    ).toBe('panel');
    const options = view.you.hand.slice(0, 2).map((c, i) => ({ key: `k${i}`, label: c.name, iid: c.iid }));
    expect(promptPlacement(basePrompt(me, { type: 'order', options }), view)).toBe('panel');
    expect(promptPlacement(basePrompt(me), view)).toBe('panel');
  });

  test('a mix of hand cards and something else is not a hand prompt', () => {
    const c = view.you.hand[0]!;
    const options = [
      { key: 'a', label: c.name, iid: c.iid },
      { key: 'b', label: 'Gold', defId: 'gold' },
    ];
    expect(promptPlacement(basePrompt(me, { options }), view)).toBe('panel');
  });

  test('whose prompt it is', () => {
    const other = s.playerOrder[1]!;
    expect(ownPrompt(basePrompt(me), me)).not.toBeNull();
    expect(ownPrompt(basePrompt(other), me)).toBeNull();
    expect(waitingOnOther(basePrompt(other), me)).toBe(other);
    expect(waitingOnOther({ waitingOn: other }, me)).toBe(other);
    expect(waitingOnOther(basePrompt(me), me)).toBeNull();
    expect(waitingOnOther(null, me)).toBeNull();
  });
});

describe('SB-63: the table renders as one grid', () => {
  for (const players of [2, 3, 4]) {
    test(`${players} players: every region once, stats and End turn in the dock`, () => {
      const s = seedMatch(players, 500 + players);
      const me = s.playerOrder[0]!;
      const html = table(viewFor(s, me));

      for (const id of ['table', 'topbar', 'opponents', 'board-region', 'board', 'dock', 'hand', 'end-turn', 'turn-number']) {
        expect(count(html, `data-testid="${id}"`), `data-testid="${id}"`).toBe(1);
      }
      // Each stat exactly once: two copies would make `.first()` in the specs
      // read whichever the layout happened to put first.
      for (const stat of ['money', 'buys', 'actions', 'prophet', 'vp', 'combo']) {
        expect(count(html, `data-testid="stat-${stat}-value"`), `stat-${stat}-value`).toBe(1);
      }

      const dock = html.indexOf('data-testid="dock"');
      expect(dock).toBeGreaterThan(html.indexOf('data-testid="board-region"'));
      for (const id of ['hand', 'end-turn', 'stat-money-value', 'stat-buys-value', 'stat-actions-value']) {
        expect(html.indexOf(`data-testid="${id}"`), `${id} sits in the dock`).toBeGreaterThan(dock);
      }

      // Every pile carries exactly one Buy.
      expect(count(html, 'data-testid="pile"')).toBe(count(html, 'data-testid="buy"'));
      // The old full-screen overlay is gone for good.
      expect(html).not.toContain('prompt-overlay');
    });
  }

  test('the drawer starts closed without a window, and keeps the .table-side hook', () => {
    const s = seedMatch(2, 9);
    const html = table(viewFor(s, s.playerOrder[0]!));
    expect(html).toMatch(/class="drawer table-side"[^>]*hidden/);
  });

  test('off turn, your hand is not clickable and is marked off-turn (not dimmed)', () => {
    const s = seedMatch(2, 11);
    const waiting = s.playerOrder.find((p) => p !== s.activePlayer)!;
    const html = table(viewFor(s, waiting));
    expect(html).toContain('hand hand-offturn');
    expect(html).toContain('data-your-turn="false"');
    const handStart = html.indexOf('data-testid="hand"');
    expect(html.slice(handStart)).not.toMatch(/data-clickable="true"/);
  });

  test('the turn owner is named', () => {
    const s = seedMatch(2, 12);
    const active = s.activePlayer;
    const other = s.playerOrder.find((p) => p !== active)!;
    expect(table(viewFor(s, active))).toContain('>Your turn<');
    expect(table(viewFor(s, other))).toContain(`${s.players[active]!.name}’s turn`);
  });
});

describe('MOT-11: somebody else’s decision never blocks the screen', () => {
  const s = seedMatch(2, 21);
  const [a, b] = s.playerOrder as [PlayerId, PlayerId];
  const viewA = { ...viewFor(s, a), pending: { waitingOn: b } } as GameView;
  const viewB = viewFor(s, b);

  test('networked: a waiting chip, no pass button', () => {
    const html = table(viewA, { mode: 'host' });
    expect(html).toContain('data-testid="prompt-waiting"');
    expect(html).toContain('Waiting on');
    expect(html).not.toContain('data-testid="prompt-pass"');
    expect(html).not.toContain('data-testid="prompt"');
  });

  test('hotseat: "Pass to" with a button that switches to the chooser', () => {
    const html = table(viewA, { mode: 'hotseat', views: { s1: viewA, s2: viewB } });
    expect(html).toContain('Pass to');
    expect(html).toContain('data-testid="prompt-pass"');
  });
});

describe('small pure pieces', () => {
  test('the preview sits on the half of the screen away from the hovered card', () => {
    expect(placePreview({ left: 100, width: 100 }, 1366, 120).side).toBe('right');
    expect(placePreview({ left: 1100, width: 100 }, 1366, 120).side).toBe('left');
    expect(placePreview(null, 1366, 120).top).toBe(128);
  });

  test('hand status says what is true', () => {
    expect(handStatus({ yourTurn: false, picking: false, playable: 3, actions: 1 })).toBe('not your turn');
    expect(handStatus({ yourTurn: true, picking: false, playable: 2, actions: 1 })).toBe('2 playable · 1 action');
    expect(handStatus({ yourTurn: true, picking: false, playable: 0, actions: 2 })).toBe('nothing playable · 2 actions');
    expect(handStatus({ yourTurn: true, picking: true, playable: 0, actions: 0 })).toBe('choose from your hand');
  });
});
