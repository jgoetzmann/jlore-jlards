/**
 * Routes on the URL hash.
 *
 *   (no hash)  start screen — create a room and seed a match, or go hotseat
 *   #hotseat   a local match on `makeLocalRelay`, no network at all
 *   #CODE      join that room (host if this browser is the one that made it)
 */

import React from 'react';
import type { CardView, GameAction, GameState, GameView, PlayerId } from '@engine/types';
import { makeRoomCode } from '@net/relay';
import { getSeatId, getSettings, setSettings, loadSnapshot, clearSnapshot } from '@net/storage';
import { useGame, type GameMode } from './useGame';
import { Board } from './Board';
import { Hand } from './Hand';
import { Field } from './Field';
import { Log } from './Log';
import { TurnBar } from './TurnBar';
import { PromptOverlay } from './PromptOverlay';
import { Card } from './Card';

type Route =
  | { kind: 'start' }
  | { kind: 'hotseat'; players: number }
  | { kind: 'room'; code: string };

export function parseHash(hash: string): Route {
  const raw = (hash || '').replace(/^#/, '').trim();
  if (raw === '') return { kind: 'start' };
  const hot = /^hotseat(?::(\d))?$/i.exec(raw);
  if (hot) {
    const n = hot[1] ? Number(hot[1]) : 2;
    return { kind: 'hotseat', players: n >= 2 && n <= 4 ? n : 2 };
  }
  return { kind: 'room', code: raw.toUpperCase() };
}

function useHashRoute(): Route {
  const [route, setRoute] = React.useState<Route>(() =>
    parseHash(typeof window === 'undefined' ? '' : window.location.hash),
  );
  React.useEffect(() => {
    const onHash = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

// ---------------------------------------------------------------------------
// Start screen
// ---------------------------------------------------------------------------

function StartScreen({
  onHost,
  onResume,
}: {
  onHost: (code: string, playerCount: number) => void;
  onResume: (state: GameState) => void;
}): JSX.Element {
  const [name, setName] = React.useState(() => getSettings().playerName);
  const [players, setPlayers] = React.useState(2);
  const [joinCode, setJoinCode] = React.useState('');
  const snapshot = React.useMemo(() => loadSnapshot(), []);

  function saveName(v: string): void {
    setName(v);
    setSettings({ playerName: v });
  }

  return (
    <div className="start">
      <h1 className="start-title">Jlore Jlards</h1>
      <p className="start-sub">
        A deck-builder with a persistent Prophet currency, match-warping Anomalies and Field
        auras. One browser runs the game; everyone else renders what they are told.
      </p>

      <label className="start-field">
        <span>Your name</span>
        <input value={name} onChange={(e) => saveName(e.target.value)} maxLength={24} />
      </label>

      <label className="start-field">
        <span>Players</span>
        <select value={players} onChange={(e) => setPlayers(Number(e.target.value))}>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </label>

      <div className="start-actions">
        <button
          type="button"
          className="primary"
          data-testid="create-room"
          onClick={() => onHost(makeRoomCode(), players)}
        >
          Create a room
        </button>

        <button
          type="button"
          className="secondary"
          data-testid="hotseat"
          onClick={() => {
            window.location.hash = `#hotseat:${players}`;
          }}
        >
          Hotseat
        </button>
      </div>

      <div className="start-join">
        <input
          placeholder="ROOM CODE"
          data-testid="join-code"
          value={joinCode}
          maxLength={12}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
        />
        <button
          type="button"
          data-testid="join"
          disabled={joinCode.trim().length < 3}
          onClick={() => {
            window.location.hash = `#${joinCode.trim().toUpperCase()}`;
          }}
        >
          Join
        </button>
      </div>

      {snapshot && (
        <div className="start-resume">
          <span>
            Snapshot from turn {snapshot.savedTurn} found on this device.
          </span>
          <button type="button" onClick={() => onResume(snapshot.state)}>
            Resume as host
          </button>
          <button type="button" className="ghost" onClick={() => clearSnapshot()}>
            Discard
          </button>
        </div>
      )}

      <p className="start-note">
        Hotseat needs no relay: it plays entirely in this tab, with every seat getting its own
        filtered view.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function Opponents({ view }: { view: GameView }): JSX.Element {
  return (
    <div className="opponents" data-testid="opponents">
      {view.others.map((o) => (
        <div
          className={`opponent${o.eliminated ? ' opponent-out' : ''}`}
          data-testid="opponent"
          data-opponent-id={o.id}
          data-hand-count={o.handCount}
          data-library-count={o.libraryCount}
          key={o.id}
        >
          <div className="opponent-head">
            <span className="opponent-name">{o.name}</span>
            {view.activePlayer === o.id && <span className="opponent-turn">to move</span>}
            {o.eliminated && <span className="opponent-elim">eliminated</span>}
          </div>
          <div className="opponent-stats">
            <span title="cards in hand">✋ {o.handCount}</span>
            <span title="cards in library">📚 {o.libraryCount}</span>
            <span title="victory points">★ {o.vp}</span>
            <span title="banked prophet">◈ {o.prophet}</span>
          </div>
          {o.field.length > 0 && (
            <div className="opponent-auras">
              {o.field.map((a) => (
                <span className={`aura-chip aura-${a.tier}`} key={a.auraId} title={a.text}>
                  {a.name}
                </span>
              ))}
            </div>
          )}
          {o.play.length > 0 && (
            <div className="opponent-play">
              {o.play.map((c) => (
                <Card key={c.iid} card={c} compact />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PlayArea({ cards, label }: { cards: CardView[]; label: string }): JSX.Element {
  return (
    <div className="playarea">
      <h3>
        {label} <span className="playarea-count">{cards.length}</span>
      </h3>
      <div className="playarea-row">
        {cards.length === 0 && <div className="playarea-empty">nothing</div>}
        {cards.map((c) => (
          <Card key={c.iid} card={c} compact />
        ))}
      </div>
    </div>
  );
}

function Table({
  mode,
  code,
  seatId,
  playerCount,
  resumeState,
}: {
  mode: GameMode;
  code: string | null;
  seatId: string;
  playerCount: number;
  resumeState: GameState | null;
}): JSX.Element {
  const session = useGame({ mode, roomCode: code, seatId, playerCount, resumeState });
  const view = session.view;

  const names = React.useMemo(() => {
    const out: Record<PlayerId, string> = {};
    if (!view) return out;
    out[view.you.id] = view.you.name;
    for (const o of view.others) out[o.id] = o.name;
    return out;
  }, [view]);

  const send = React.useCallback(
    (action: GameAction) => session.send(action),
    [session],
  );

  if (session.status === 'error') {
    return (
      <div className="fatal" data-testid="fatal">
        <h2>Could not start</h2>
        <p>{session.error}</p>
        <button
          type="button"
          onClick={() => {
            window.location.hash = '';
          }}
        >
          Back
        </button>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="connecting" data-testid="connecting">
        <div className="prompt-spinner" aria-hidden="true" />
        <h2>{mode === 'join' ? 'Joining' : 'Dealing'}…</h2>
        {code && <p className="room-code">Room {code}</p>}
      </div>
    );
  }

  const yourTurn = view.activePlayer === view.you.id && !view.ended;

  return (
    <div className="table" data-testid="table">
      <header className="table-head">
        <span className="brand">Jlore Jlards</span>
        {code && (
          <button
            type="button"
            className="room-chip"
            title="Copy the invite link"
            onClick={() => {
              try {
                void navigator.clipboard.writeText(window.location.href);
              } catch {
                /* clipboard is a nicety */
              }
            }}
          >
            Room {code}
          </button>
        )}
        {mode === 'hotseat' && (
          <div className="seat-switch">
            {session.seats.map((s) => {
              const v = session.views[s];
              return (
                <button
                  type="button"
                  key={s}
                  className={`seat-btn${session.activeSeat === s ? ' seat-btn-on' : ''}${
                    v && v.you.id === v.activePlayer ? ' seat-btn-active' : ''
                  }`}
                  data-testid="seat-btn"
                  data-seat={s}
                  data-seat-on={session.activeSeat === s ? 'true' : 'false'}
                  data-seat-to-move={v && v.you.id === v.activePlayer ? 'true' : 'false'}
                  onClick={() => session.setActiveSeat(s)}
                >
                  {v ? v.you.name : s}
                </button>
              );
            })}
          </div>
        )}
        <span className="who" data-testid="you-are" data-you-id={view.you.id}>
          You are <strong>{view.you.name}</strong>
        </span>
      </header>

      <TurnBar
        view={view}
        playerId={view.you.id}
        yourTurn={yourTurn}
        turnSeconds={session.turnSeconds}
        onAction={send}
      />

      {view.ended && (
        <div className="game-over" data-testid="game-over">
          <h2>Game over</h2>
          <p>{view.endReason ?? 'the game ended'}</p>
          <p className="winners">
            {(view.winners ?? []).map((w) => names[w] ?? w).join(', ') || 'nobody'} wins
          </p>
        </div>
      )}

      <div className="table-body">
        <div className="table-main">
          <Board view={view} onBuy={(pileId) => send({ type: 'buy', player: view.you.id, pileId })} yourTurn={yourTurn} />
          <PlayArea cards={view.you.play} label="In play" />
          <Hand
            hand={view.you.hand}
            playerId={view.you.id}
            yourTurn={yourTurn}
            actions={view.you.actions}
            onAction={send}
          />
        </div>

        <aside className="table-side">
          <Opponents view={view} />
          <Field
            field={view.you.field}
            playerId={view.you.id}
            money={view.you.money}
            yourTurn={yourTurn}
            onAction={send}
          />
          <PlayArea cards={view.you.gy} label="Graveyard" />
          <div className="library-count">
            Library <strong>{view.you.libraryCount}</strong> cards — contents are never sent to
            any browser, including yours.
          </div>
          <Log log={view.log} names={names} />
        </aside>
      </div>

      <PromptOverlay
        pending={view.pending}
        playerId={view.you.id}
        names={names}
        onAction={send}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function App(): JSX.Element {
  const route = useHashRoute();
  const seatId = React.useMemo(() => getSeatId(), []);
  const [hostedRooms, setHostedRooms] = React.useState<Record<string, number>>({});
  const [resumeState, setResumeState] = React.useState<GameState | null>(null);

  function host(code: string, playerCount: number): void {
    setHostedRooms((prev) => ({ ...prev, [code]: playerCount }));
    window.location.hash = `#${code}`;
  }

  function resume(state: GameState): void {
    const code = makeRoomCode();
    setResumeState(state);
    setHostedRooms((prev) => ({ ...prev, [code]: state.playerOrder.length }));
    window.location.hash = `#${code}`;
  }

  if (route.kind === 'start') {
    return <StartScreen onHost={host} onResume={resume} />;
  }

  if (route.kind === 'hotseat') {
    return (
      <Table
        mode="hotseat"
        code={null}
        seatId={seatId}
        playerCount={route.players}
        resumeState={null}
      />
    );
  }

  const hosted = Object.prototype.hasOwnProperty.call(hostedRooms, route.code);
  return (
    <Table
      mode={hosted ? 'host' : 'join'}
      code={route.code}
      seatId={seatId}
      playerCount={hosted ? hostedRooms[route.code] : 2}
      resumeState={hosted ? resumeState : null}
    />
  );
}

export default App;
