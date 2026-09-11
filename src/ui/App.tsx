/**
 * Routes on the URL hash.
 *
 *   (no hash)  start screen — open a room and wait for people, or go hotseat
 *   #hotseat   a local match on `makeLocalRelay`, no network at all
 *   #CODE      that room: its lobby first, then the table
 *
 * A networked room is a lobby before it is a match. Cards are dealt when the
 * host presses Start, for the people who are in the room at that moment —
 * never for a number picked on the start screen before anyone had arrived.
 */

import React from 'react';
import type { CardView, GameAction, GameState, GameView, PlayerId } from '@engine/types';
import { makeRoomCode } from '@net/relay';
import { getSeatId, getSettings, setSettings, loadSnapshot, clearSnapshot } from '@net/storage';
import { useGame, type GameMode } from './useGame';
import { Lobby } from './Lobby';
import { Board } from './Board';
import { Hand } from './Hand';
import { Field } from './Field';
import { Log } from './Log';
import { TurnBar } from './TurnBar';
import { PromptOverlay } from './PromptOverlay';
import { Card } from './Card';
import { Opponents } from './Opponents';

/** A room opens at the full table; the lobby narrows it if the host wants. */
const MAX_ROOM_SEATS = 4;

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
        <span>Hotseat seats</span>
        <select value={players} onChange={(e) => setPlayers(Number(e.target.value))}>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </label>
      <p className="start-hint">
        How many seats Hotseat deals — everyone on this one screen, taking turns.
        A room opens with all four seats instead, so anyone you send the link to
        can walk in; narrow it from the lobby if you want a smaller table.
        Nothing is dealt until the host starts it.
      </p>

      <div className="start-actions">
        <button
          type="button"
          className="primary"
          data-testid="create-room"
          // A room opens at the full table. Seeding it from the Seats control
          // meant the host had to predict the turnout before anyone arrived —
          // the flaw the lobby exists to remove. Three friends following a link
          // would find the third knocking at a two-seat room. The lobby's own
          // cap control narrows it, which is the right place for that choice.
          onClick={() => onHost(makeRoomCode(), MAX_ROOM_SEATS)}
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
        Creating a room opens a lobby — you get a code to paste into the call, and you
        deal once everyone is actually in it. Hotseat needs no relay at all: it plays
        entirely in this tab, with every seat getting its own filtered view.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Which rooms this tab is hosting
// ---------------------------------------------------------------------------

/**
 * A lobby is a place people linger, and lingering means refreshing. Hosting
 * lives in React state, so without this a host who reloads while waiting comes
 * back as a guest of their own room and everybody in it waits forever.
 *
 * `sessionStorage`, not the cookie or `localStorage` in `@net/storage`: this is
 * a per-tab fact about a room that has not started, it must never ride a relay
 * request, and it must not outlive the tab. The entry is dropped the moment
 * cards are dealt — from then on the honest answer to a host reload is the
 * snapshot resume on the start screen, not a second lobby over a live match.
 */
const OPEN_LOBBIES_KEY = 'jlore_open_lobbies';

function readOpenLobbies(): Record<string, number> {
  try {
    if (typeof sessionStorage === 'undefined') return {};
    const raw = sessionStorage.getItem(OPEN_LOBBIES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [code, n] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isFinite(n)) out[code] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function writeOpenLobbies(value: Record<string, number>): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(OPEN_LOBBIES_KEY, JSON.stringify(value));
  } catch {
    /* private mode; a host who reloads simply loses the room, as before */
  }
}

function rememberOpenLobby(code: string, seatCap: number): void {
  writeOpenLobbies({ ...readOpenLobbies(), [code]: seatCap });
}

function forgetOpenLobby(code: string): void {
  const all = readOpenLobbies();
  if (!(code in all)) return;
  delete all[code];
  writeOpenLobbies(all);
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

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
  onDealt,
}: {
  mode: GameMode;
  code: string | null;
  seatId: string;
  playerCount: number;
  resumeState: GameState | null;
  onDealt?: () => void;
}): JSX.Element {
  const session = useGame({ mode, roomCode: code, seatId, playerCount, resumeState });
  const view = session.view;

  // Fires once, when this room stops being a lobby and becomes a match.
  const phase = session.phase;
  const dealtRef = React.useRef(false);
  React.useEffect(() => {
    if (phase !== 'playing' || dealtRef.current) return;
    dealtRef.current = true;
    if (onDealt) onDealt();
  }, [phase, onDealt]);

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

  // No match yet: this is a room with people arriving in it.
  if (session.phase === 'lobby' && session.lobby) {
    return (
      <Lobby
        info={session.lobby}
        onStart={session.startMatch}
        onSeatCap={session.setSeatCap}
        onLeave={() => {
          window.location.hash = '';
        }}
      />
    );
  }

  if (!view) {
    return (
      <div className="connecting" data-testid="connecting">
        <div className="prompt-spinner" aria-hidden="true" />
        <h2>{mode === 'join' ? 'Taking your seat' : 'Dealing'}…</h2>
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
  const [hostedRooms, setHostedRooms] = React.useState<Record<string, number>>(() =>
    readOpenLobbies(),
  );
  const [resumeState, setResumeState] = React.useState<GameState | null>(null);

  function host(code: string, playerCount: number): void {
    setHostedRooms((prev) => ({ ...prev, [code]: playerCount }));
    rememberOpenLobby(code, playerCount);
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
  const code = route.code;
  return (
    <Table
      mode={hosted ? 'host' : 'join'}
      code={code}
      seatId={seatId}
      playerCount={hosted ? hostedRooms[code] : 2}
      resumeState={hosted ? resumeState : null}
      onDealt={() => forgetOpenLobby(code)}
    />
  );
}

export default App;
