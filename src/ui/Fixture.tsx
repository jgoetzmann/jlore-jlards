/**
 * Dev-only fixture tables, at `#fixture:<name>`.
 *
 * Some table states are rare in a random hotseat deal: a prompt whose options
 * are piles, somebody else's prompt while you look at your own seat, a card
 * trashed out of your hand while an opponent plays. Unit tests render them as
 * markup, which proves the props are right but not that they look right or
 * can be clicked. These fixtures mount the real `TableLayout` in a real
 * browser with a crafted state, so `e2e/fixtures.spec.ts` can click them and
 * the screenshots can show them.
 *
 * The state comes from a real `seedMatch`; only the prompt (or the second
 * view) is crafted. Every action the table sends is recorded on
 * `window.__fixtureSent`, and a `resolve` clears the prompt, so a spec can
 * check what was sent. App.tsx only loads this module when
 * `import.meta.env.DEV` is true, so a production build never contains it.
 */

import React from 'react';
import type { CardView, GameAction, GameState, GameView, PlayerId, Prompt } from '@engine/types';
import { viewFor } from '@engine/view';
import { seedMatch } from './useGame';
import { TableLayout } from './App';
import { allPiles } from './prompt';

declare global {
  interface Window {
    __fixtureSent?: GameAction[];
  }
}

const SEED = 21;
const noop = (): void => undefined;

function record(action: GameAction): void {
  if (typeof window === 'undefined') return;
  (window.__fixtureSent ??= []).push(action);
}

function craftPrompt(player: PlayerId, patch: Partial<Prompt> & Pick<Prompt, 'id' | 'type' | 'options'>): Prompt {
  return { player, prompt: 'Choose', min: 1, max: 1, then: [], ctx: {}, defaultKeys: [], ...patch };
}

/** Send that records, and answers a `resolve` by closing the prompt. */
function useFixtureSend(setState: React.Dispatch<React.SetStateAction<GameState>>): (a: GameAction) => void {
  return React.useCallback(
    (a: GameAction) => {
      record(a);
      if (a.type === 'resolve') setState((s) => ({ ...s, pending: null }));
    },
    [setState],
  );
}

/** Your own prompt whose options are three piles: the dock bar and lit piles. */
function PilePickFixture(): JSX.Element {
  const [state, setState] = React.useState<GameState>(() => {
    const s = seedMatch(2, SEED);
    const me = s.activePlayer;
    const piles = allPiles(viewFor(s, me))
      .filter((p) => p.top !== null && p.count > 0)
      .slice(0, 3);
    s.pending = craftPrompt(me, {
      id: 'fx-pile',
      type: 'selectPile',
      prompt: 'Gain a card from one of the lit piles',
      // Keys are opaque; the pile id keeps the spec's bookkeeping trivial.
      options: piles.map((p) => ({ key: p.id, label: p.top?.name ?? p.id, pileId: p.id })),
    });
    return s;
  });
  const send = useFixtureSend(setState);
  const me = state.activePlayer;
  const view = React.useMemo(() => viewFor(state, me), [state, me]);
  return (
    <TableLayout
      view={view}
      mode="hotseat"
      code={null}
      seats={['s1']}
      views={{ s1: view }}
      activeSeat="s1"
      setActiveSeat={noop}
      send={send}
      turnSeconds={90}
    />
  );
}

/** Hotseat, looking at the seat to move, while the other seat owes a choice. */
function PassFixture(): JSX.Element {
  const [state, setState] = React.useState<GameState>(() => {
    const s = seedMatch(2, SEED);
    const other = s.playerOrder.find((p) => p !== s.activePlayer) ?? s.activePlayer;
    s.pending = craftPrompt(other, {
      id: 'fx-pass',
      type: 'choose',
      prompt: 'Choose one',
      options: [
        { key: 'draw', label: 'Draw a card' },
        { key: 'money', label: '+1 Money' },
      ],
    });
    return s;
  });
  const send = useFixtureSend(setState);
  // s1 is the seat to move, s2 the one who must choose.
  const order = React.useMemo(() => {
    const other = state.playerOrder.find((p) => p !== state.activePlayer) ?? state.activePlayer;
    return [state.activePlayer, other];
  }, [state.activePlayer, state.playerOrder]);
  const views = React.useMemo(() => {
    const out: Record<string, GameView> = {};
    order.forEach((p, i) => {
      out[`s${i + 1}`] = viewFor(state, p);
    });
    return out;
  }, [state, order]);
  const [active, setActive] = React.useState('s1');
  const view = views[active] ?? views['s1']!;
  return (
    <TableLayout
      view={view}
      mode="hotseat"
      code={null}
      seats={Object.keys(views)}
      views={views}
      activeSeat={active}
      setActiveSeat={setActive}
      send={send}
      turnSeconds={90}
    />
  );
}

/**
 * Two views a step apart: your first hand card is trashed (it leaves every
 * drawn zone and the library does not grow) and the opponent plays a card.
 * The step button flips between them.
 */
function MotionFixture(): JSX.Element {
  const base = React.useMemo(() => {
    const s = seedMatch(2, SEED);
    return viewFor(s, s.activePlayer);
  }, []);
  const next = React.useMemo<GameView>(() => {
    const top = allPiles(base).find((p) => p.top !== null)?.top ?? base.you.hand[0]!;
    const played: CardView = { ...top, iid: 'fx_opp_play' };
    return {
      ...base,
      you: { ...base.you, hand: base.you.hand.slice(1) },
      others: base.others.map((o, i) =>
        i === 0 ? { ...o, handCount: Math.max(0, o.handCount - 1), play: [...o.play, played] } : o,
      ),
    };
  }, [base]);
  const [stepped, setStepped] = React.useState(false);
  const view = stepped ? next : base;
  return (
    <>
      <TableLayout
        view={view}
        mode="hotseat"
        code={null}
        seats={['s1']}
        views={{ s1: view }}
        activeSeat="s1"
        setActiveSeat={noop}
        send={record}
        turnSeconds={90}
      />
      <button
        type="button"
        data-testid="fixture-step"
        style={{ position: 'fixed', left: 8, bottom: 8, zIndex: 50 }}
        onClick={() => setStepped((v) => !v)}
      >
        {stepped ? 'Undo step' : 'Step: trash + opponent play'}
      </button>
    </>
  );
}

export const FIXTURES: Record<string, () => JSX.Element> = {
  'pile-pick': PilePickFixture,
  pass: PassFixture,
  motion: MotionFixture,
};

export function Fixture({ name }: { name: string }): JSX.Element {
  const Component = FIXTURES[name];
  if (!Component) {
    return (
      <div className="fatal" data-testid="fatal">
        <h2>No fixture called “{name}”</h2>
        <p>Try one of: {Object.keys(FIXTURES).join(', ')}</p>
      </div>
    );
  }
  return <Component />;
}

export default Fixture;
