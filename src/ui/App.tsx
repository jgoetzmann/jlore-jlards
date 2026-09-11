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
import type { GameAction, GameState, GameView, InstanceId, PileId, PlayerId } from '@engine/types';
import { makeRoomCode } from '@net/relay';
import { getSeatId, getSettings, setSettings, loadSnapshot, clearSnapshot } from '@net/storage';
import { useGame, type GameMode } from './useGame';
import { Lobby } from './Lobby';
import { Board, type PilePick } from './Board';
import { Hand, handStatus, type HandHandle, type HandPick } from './Hand';
import { Field } from './Field';
import { Log } from './Log';
import { AnomalyChip, StatCluster, TurnClock } from './TurnBar';
import { PromptOverlay } from './PromptOverlay';
import { Card, CardArt } from './Card';
import { CardPreview } from './CardPreview';
import { Opponents, hueOf } from './Opponents';
import { ownPrompt, promptBounds, promptPlacement, promptReady, togglePick, waitingOnOther } from './prompt';
import { KEY_HELP, type KeyIntent } from './keys';
import { useKeyboard } from './useKeyboard';
import { ANCHOR_DISCARD, ANCHOR_LIBRARY, MOTION_MS, planFlip } from './motion';
import { FlipContext, FlipScope, createFlipRegistry, type FlipRegistry } from './useFlip';
import { useOneShot, usePrefersReducedMotion } from './useMotion';
import { isUsefulPlay, playMoneyPlan, submitsOnPick, turnDone } from './turnflow';
import { stabilizeView } from './viewcache';
import { preloadArt } from './art';

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
          // the flaw the lobby exists to remove. The lobby's own cap control
          // narrows it, which is the right place for that choice.
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
 * cards are dealt.
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
// Table layout (SB-63)
// ---------------------------------------------------------------------------

/** At or above this viewport width the log drawer starts open. */
export const DRAWER_OPEN_MIN_WIDTH = 1600;

/** A buy nobody answered is given back after this long (TURN-8 fallback). */
export const BUY_INFLIGHT_TIMEOUT_MS = 4000;

const NO_PICKS: readonly string[] = [];

/** Changes whenever a view carries anything new: every action logs (B118). */
export function viewRevision(view: GameView): number {
  const last = view.log[view.log.length - 1];
  return last ? last.seq : 0;
}

export interface TableLayoutProps {
  view: GameView;
  mode: GameMode;
  code: string | null;
  seats: string[];
  views: Record<string, GameView>;
  activeSeat: string | null;
  setActiveSeat: (seat: string) => void;
  send: (action: GameAction) => void;
  /**
   * Several actions as one ordered intent (the NET track's `session.sendMany`).
   * Absent, "Play money" falls back to one `send` per card, in order.
   */
  sendMany?: (actions: GameAction[]) => void;
  turnSeconds: number;
}

/**
 * The one moment worth a beat: a turn change replaces the whole board at once.
 * Always in the DOM, invisible, `pointer-events: none`; a turn change runs one
 * 600ms sweep on it. Nothing waits on it.
 */
function TurnBanner({
  view,
  names,
  mode,
}: {
  view: GameView;
  names: Record<PlayerId, string>;
  mode: GameMode;
}): JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);
  const yours = view.activePlayer === view.you.id;
  const who = names[view.activePlayer] ?? view.activePlayer;
  // In hotseat every seat is "you"; the name is what tells the table whose go it is.
  const label = view.ended ? 'Game over' : yours && mode !== 'hotseat' ? 'Your turn' : `${who}’s turn`;
  useOneShot(
    `${view.turn}:${view.activePlayer}:${view.ended ? 1 : 0}`,
    ref,
    [
      { opacity: 0, transform: 'translateY(10px) scale(0.96)' },
      { opacity: 1, transform: 'none', offset: 0.2 },
      { opacity: 1, transform: 'none', offset: 0.7 },
      { opacity: 0, transform: 'translateY(-8px)' },
    ],
    { duration: MOTION_MS.turn, easing: 'ease-out' },
  );
  return (
    <div ref={ref} className={`turn-banner${yours ? ' turn-banner-yours' : ''}`} data-testid="turn-banner" aria-hidden="true">
      <div className="turn-banner-inner">
        {label}
        <span className="turn-banner-turn"> · turn {view.turn}</span>
      </div>
    </div>
  );
}

/** The keyboard sheet, generated from the same table the handler dispatches on. */
function KeyHelp({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div className="prompt-panel-host key-help-host">
      <div className="key-help" data-testid="key-help" role="dialog" aria-label="Keyboard shortcuts">
        <h3>Keyboard</h3>
        <dl className="key-help-list">
          {KEY_HELP.map((row) => (
            <React.Fragment key={row.keys}>
              <dt>
                {row.keys.split(/\s+/).map((k, i) => (
                  <kbd key={`${k}-${i}`}>{k}</kbd>
                ))}
              </dt>
              <dd>{row.what}</dd>
            </React.Fragment>
          ))}
        </dl>
        <div className="prompt-actions">
          <button type="button" className="prompt-confirm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The table, as one viewport-bound grid (SB-63):
 *
 *   topbar  (auto)          brand, seats, whose turn, clock, anomaly, drawer toggle
 *   seats   (auto)          the opponents strip; a seat expands in flow
 *   board   (minmax(0,1fr)) the shops — the ONLY scroll container for piles
 *   dock    (auto)          deck/discard | in-play strip + hand | stats + End turn
 *   drawer  (right column)  graveyard and log; closed by default below 1600px
 *
 * The page itself never scrolls. Nothing is sticky, fixed or absolute over
 * anything clickable — the hover preview, the turn banner and the card-flight
 * ghosts are all `pointer-events: none`, and a prompt panel covers the board
 * region only — so every pile's Buy stays hit-testable once the board region is
 * scrolled to it. `e2e/layout.spec.ts` holds all of that.
 *
 * Interaction (UI-2): the keyboard (keys.ts), Play money, one-click single
 * picks, the per-pile buy guard and the "nothing left" cue on End turn. Motion:
 * one FlipScope over the whole table plans card flights from the view diff
 * (motion.ts `planFlip`) and runs them before paint (useFlip.ts).
 *
 * Pure: everything comes in through props, so the unit suite renders the whole
 * table without a session.
 */
export function TableLayout({
  view,
  mode,
  code,
  seats,
  views,
  activeSeat,
  setActiveSeat,
  send,
  sendMany,
  turnSeconds,
}: TableLayoutProps): JSX.Element {
  const viewRef = React.useRef(view);
  viewRef.current = view;

  // Names change only when someone renames, not on every view; keying the memo
  // on the text keeps the log and prompt from re-rendering for nothing.
  const namesKey = [`${view.you.id}=${view.you.name}`, ...view.others.map((o) => `${o.id}=${o.name}`)].join('|');
  const names = React.useMemo(() => {
    const out: Record<PlayerId, string> = {};
    for (const pair of namesKey.split('|')) {
      const at = pair.indexOf('=');
      out[pair.slice(0, at)] = pair.slice(at + 1);
    }
    return out;
  }, [namesKey]);

  const me = view.you.id;
  const yourTurn = view.activePlayer === me && !view.ended;
  const revision = viewRevision(view);

  // --- motion ---------------------------------------------------------------
  const reduced = usePrefersReducedMotion();
  const registryRef = React.useRef<FlipRegistry | null>(null);
  if (registryRef.current === null) registryRef.current = createFlipRegistry();
  const registry = registryRef.current;

  // Warm the art for everything this view shows, after paint (ART-1).
  React.useEffect(() => {
    preloadArt(view);
  }, [view]);

  // --- drawer ---------------------------------------------------------------
  const [drawerOpen, setDrawerOpen] = React.useState(
    () => typeof window !== 'undefined' && window.innerWidth >= DRAWER_OPEN_MIN_WIDTH,
  );
  const gyRef = React.useRef<HTMLElement | null>(null);
  const [gyWanted, setGyWanted] = React.useState(false);
  React.useEffect(() => {
    if (!drawerOpen || !gyWanted) return;
    gyRef.current?.scrollIntoView({ block: 'start' });
    setGyWanted(false);
  }, [drawerOpen, gyWanted]);
  const [helpOpen, setHelpOpen] = React.useState(false);

  // --- your prompt ------------------------------------------------------------
  const prompt = ownPrompt(view.pending, me);
  const placement = prompt ? promptPlacement(prompt, view) : null;
  const promptId = prompt ? prompt.id : null;
  const [pick, setPick] = React.useState<{ id: string | null; keys: string[] }>({ id: null, keys: [] });
  const picked = promptId !== null && pick.id === promptId ? pick.keys : NO_PICKS;

  const setPicked = React.useCallback(
    (next: string[]) => setPick({ id: promptId, keys: next }),
    [promptId],
  );
  const bounds = prompt ? promptBounds(prompt) : null;
  const onToggle = React.useCallback(
    (key: string) => {
      if (promptId === null || bounds === null) return;
      setPick((prev) => ({
        id: promptId,
        keys: togglePick(prev.id === promptId ? prev.keys : [], key, bounds),
      }));
    },
    // `bounds` is derived from the prompt, which `promptId` identifies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [promptId, bounds?.max, bounds?.ordering],
  );

  const handPick = React.useMemo<HandPick | null>(() => {
    if (!prompt || placement !== 'hand') return null;
    const keyFor = new Map<InstanceId, string>();
    for (const o of prompt.options) if (o.iid) keyFor.set(o.iid, o.key);
    return { keyFor, picked, onToggle };
  }, [prompt, placement, picked, onToggle]);
  const pilePick = React.useMemo<PilePick | null>(() => {
    if (!prompt || placement !== 'board') return null;
    const keyFor = new Map<PileId, string>();
    for (const o of prompt.options) if (o.pileId) keyFor.set(o.pileId, o.key);
    return { keyFor, picked, onToggle };
  }, [prompt, placement, picked, onToggle]);

  const resolve = React.useCallback(
    (keys: readonly string[]) => {
      const v = viewRef.current;
      const p = ownPrompt(v.pending, v.you.id);
      if (!p) return;
      send({ type: 'resolve', player: v.you.id, promptId: p.id, keys: [...keys] });
    },
    [send],
  );

  // --- somebody else's prompt -------------------------------------------------
  const waitingOn = waitingOnOther(view.pending, me);
  let onPass: (() => void) | null = null;
  if (mode === 'hotseat' && waitingOn !== null) {
    const seat = seats.find((s) => views[s]?.you.id === waitingOn);
    if (seat && seat !== activeSeat) onPass = () => setActiveSeat(seat);
  }

  // --- whose turn --------------------------------------------------------------
  const ownerName = names[view.activePlayer] ?? view.activePlayer;
  const ownerLabel = view.ended ? 'Game over' : yourTurn ? 'Your turn' : `${ownerName}’s turn`;

  // --- buying (TURN-8) ----------------------------------------------------------
  // A buy is in flight until a newer view lands (then the pile's own state says
  // what happened) or the fallback timeout passes. While it is, that pile's Buy
  // is off, so a double-click cannot buy twice.
  const [buyFlight, setBuyFlight] = React.useState<{ pileId: PileId; revision: number } | null>(null);
  const inFlightPile = buyFlight !== null && buyFlight.revision === revision ? buyFlight.pileId : null;
  React.useEffect(() => {
    if (buyFlight === null) return;
    const t = setTimeout(() => setBuyFlight(null), BUY_INFLIGHT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [buyFlight]);

  const onBuy = React.useCallback(
    (pileId: PileId) => {
      const v = viewRef.current;
      setBuyFlight({ pileId, revision: viewRevision(v) });
      send({ type: 'buy', player: v.you.id, pileId });
    },
    [send],
  );

  // --- Play money (TURN-2) ---------------------------------------------------------
  const handRef = React.useRef<HandHandle>(null);
  const money = React.useMemo(() => playMoneyPlan(view), [view]);
  const onPlayMoney = React.useCallback(() => {
    const v = viewRef.current;
    const p = playMoneyPlan(v);
    if (p.blocked !== null || p.iids.length === 0) return;
    const actions: GameAction[] = p.iids.map((iid) => ({ type: 'play', player: v.you.id, iid }));
    handRef.current?.markLaunched(p.iids);
    // One ordered batch when the session has one; otherwise the same actions
    // one at a time, in the same order.
    if (sendMany) sendMany(actions);
    else for (const a of actions) send(a);
  }, [send, sendMany]);

  const done = React.useMemo(() => turnDone(view), [view]);
  const canEnd = yourTurn && view.pending === null;

  // --- keyboard ---------------------------------------------------------------------
  const promptReadyNow = prompt ? promptReady(prompt, picked) : false;
  useKeyboard(
    {
      yourTurn,
      ended: view.ended,
      handSize: view.you.hand.length,
      promptOpen: prompt !== null,
      promptOptionCount: prompt ? prompt.options.length : 0,
      promptReady: promptReadyNow,
      promptCanSkip: prompt ? promptBounds(prompt).min === 0 : false,
      promptHasDefault: prompt ? prompt.defaultKeys.length > 0 : false,
    },
    (intent: KeyIntent) => {
      switch (intent.kind) {
        case 'toggleHelp':
          setHelpOpen((v) => !v);
          return;
        case 'toggleLog':
          setDrawerOpen((v) => !v);
          return;
        case 'moveFocus':
          handRef.current?.moveCursor(intent.delta);
          return;
        case 'nudgeHand':
          handRef.current?.nudge(intent.delta);
          return;
        case 'playHand':
          handRef.current?.playAt(intent.index);
          return;
        case 'playMoney':
          onPlayMoney();
          return;
        case 'endTurn':
          if (canEnd) send({ type: 'endTurn', player: me });
          return;
        case 'pickOption': {
          const option = prompt?.options[intent.index];
          if (!prompt || !option) return;
          if (submitsOnPick(prompt)) resolve([option.key]);
          else onToggle(option.key);
          return;
        }
        case 'confirmPrompt':
          if (prompt && promptReady(prompt, picked)) resolve(picked);
          return;
        case 'skipPrompt':
          resolve([]);
          return;
        case 'takeDefault':
          if (prompt) resolve(prompt.defaultKeys);
          return;
        case 'clearSelection':
          setPicked([]);
          return;
        default:
          return;
      }
    },
  );

  const playable = view.you.hand.filter((c) => isUsefulPlay(c, yourTurn)).length;
  const gy = view.you.gy;
  const topGy = gy.length > 0 ? gy[gy.length - 1] : null;
  const barPrompt = placement === 'hand' || placement === 'board';

  return (
    <FlipContext.Provider value={registry}>
      <FlipScope registry={registry} token={view} plan={planFlip} enabled={!reduced}>
        <div
          className="table"
          data-testid="table"
          data-your-turn={yourTurn ? 'true' : 'false'}
          data-drawer={drawerOpen ? 'open' : 'closed'}
        >
          <header className="topbar" data-testid="topbar">
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
                {seats.map((s) => {
                  const v = views[s];
                  const toMove = Boolean(v && v.you.id === v.activePlayer);
                  return (
                    <button
                      type="button"
                      key={s}
                      className={`seat-btn${activeSeat === s ? ' seat-btn-on' : ''}${toMove ? ' seat-btn-active' : ''}`}
                      data-testid="seat-btn"
                      data-seat={s}
                      data-seat-on={activeSeat === s ? 'true' : 'false'}
                      data-seat-to-move={toMove ? 'true' : 'false'}
                      onClick={() => setActiveSeat(s)}
                    >
                      {v ? v.you.name : s}
                    </button>
                  );
                })}
              </div>
            )}
            <span
              className="turn-owner"
              data-testid="turn-owner"
              data-your-turn={yourTurn ? 'true' : 'false'}
              style={{ ['--owner-hue']: String(hueOf(ownerName || view.activePlayer)) } as React.CSSProperties}
            >
              {ownerLabel}
            </span>
            <TurnClock view={view} turnSeconds={turnSeconds} />
            {waitingOn !== null && (
              <PromptOverlay pending={view.pending} playerId={me} names={names} onAction={send} onPass={onPass} />
            )}
            <AnomalyChip anomaly={view.anomaly} />
            <span className="topbar-spacer" />
            <span className="who" data-testid="you-are" data-you-id={me}>
              You are <strong>{view.you.name}</strong>
            </span>
            <button
              type="button"
              className="help-btn"
              data-testid="key-help-toggle"
              title="Keyboard shortcuts (?)"
              aria-pressed={helpOpen}
              onClick={() => setHelpOpen((v) => !v)}
            >
              ?
            </button>
            <button
              type="button"
              className="drawer-toggle"
              data-testid="drawer-toggle"
              aria-pressed={drawerOpen}
              title="Show or hide the log (L)"
              onClick={() => setDrawerOpen((v) => !v)}
            >
              {drawerOpen ? 'Hide log' : 'Log'}
            </button>
          </header>

          <Opponents view={view} />

          <main className="board-region" data-testid="board-region">
            {view.ended && (
              <div className="game-over" data-testid="game-over">
                <h2>Game over</h2>
                <p>{view.endReason ?? 'the game ended'}</p>
                <p className="winners">
                  {(view.winners ?? []).map((w) => names[w] ?? w).join(', ') || 'nobody'} wins
                </p>
              </div>
            )}
            <Board view={view} onBuy={onBuy} yourTurn={yourTurn} pilePick={pilePick} inFlightPile={inFlightPile} />
          </main>

          {placement === 'panel' && (
            <div className="prompt-panel-host">
              <PromptOverlay
                pending={view.pending}
                playerId={me}
                names={names}
                onAction={send}
                picked={picked}
                onPickedChange={setPicked}
                placement="panel"
              />
            </div>
          )}

          {helpOpen && <KeyHelp onClose={() => setHelpOpen(false)} />}

          <aside className="drawer table-side" data-testid="drawer" hidden={!drawerOpen}>
            {drawerOpen && (
              <>
                <section className="drawer-section drawer-gy" ref={gyRef}>
                  <h3>
                    Graveyard <span className="drawer-count">{gy.length}</span>
                  </h3>
                  {gy.length === 0 ? (
                    <div className="drawer-empty">empty</div>
                  ) : (
                    <div className="drawer-gy-list">
                      {gy
                        .slice()
                        .reverse()
                        .map((c) => (
                          <Card key={c.iid} card={c} variant="chip" />
                        ))}
                    </div>
                  )}
                  <div className="library-count">
                    Library <strong>{view.you.libraryCount}</strong> cards
                  </div>
                </section>
                <Log log={view.log} names={names} />
              </>
            )}
          </aside>

          <section className="dock" data-testid="dock">
            <div className="dock-piles">
              <div className="dock-deck" title="Cards left in your library" ref={registry.register(ANCHOR_LIBRARY)}>
                <span className="dock-deck-back" aria-hidden="true" />
                <span className="dock-pile-label">
                  <b>{view.you.libraryCount}</b> deck
                </span>
              </div>
              <button
                type="button"
                className="dock-discard"
                data-testid="discard-pile"
                title="Show your graveyard"
                ref={registry.register(ANCHOR_DISCARD)}
                onClick={() => {
                  setDrawerOpen(true);
                  setGyWanted(true);
                }}
              >
                {topGy ? (
                  // Keyed and registered by the top card, so a card that lands
                  // on the discard flies here from wherever it was.
                  <span className="dock-discard-top" key={topGy.iid} ref={registry.register(topGy.iid)}>
                    <CardArt artKey={topGy.art?.key} name={topGy.name} />
                  </span>
                ) : (
                  <span className="dock-discard-empty" aria-hidden="true" />
                )}
                <span className="dock-pile-label">
                  <b>{gy.length}</b> discard
                </span>
              </button>
            </div>

            <div className="dock-strip">
              {barPrompt ? (
                <PromptOverlay
                  pending={view.pending}
                  playerId={me}
                  names={names}
                  onAction={send}
                  picked={picked}
                  onPickedChange={setPicked}
                  placement={placement ?? 'hand'}
                  handOrder={view.you.hand.map((c) => c.iid)}
                />
              ) : (
                <>
                  <Field
                    variant="strip"
                    field={view.you.field}
                    playerId={me}
                    money={view.you.money}
                    yourTurn={yourTurn}
                    onAction={send}
                  />
                  <span className="strip-label">
                    In play <b>{view.you.play.length}</b>
                  </span>
                  <div className="strip-cards" data-testid="in-play">
                    {view.you.play.map((c) => (
                      <Card key={c.iid} card={c} variant="chip" elementRef={registry.register(c.iid)} />
                    ))}
                  </div>
                  <span
                    className={`hand-status${yourTurn ? ' hand-status-yours' : ''}`}
                    data-testid="hand-status"
                    data-playable-count={playable}
                  >
                    {handStatus({ yourTurn, picking: false, playable, actions: view.you.actions })}
                  </span>
                </>
              )}
            </div>

            <div className="dock-hand">
              <Hand
                ref={handRef}
                hand={view.you.hand}
                playerId={me}
                yourTurn={yourTurn}
                actions={view.you.actions}
                onAction={send}
                pick={handPick}
                revision={revision}
              />
            </div>

            <div className="dock-cluster">
              <StatCluster
                view={view}
                playerId={me}
                yourTurn={yourTurn}
                onAction={send}
                onPlayMoney={onPlayMoney}
                playMoneyTotal={money.total}
                playMoneyBlocked={money.blocked}
                done={done}
              />
            </div>
          </section>

          <CardPreview />
          <TurnBanner view={view} names={names} mode={mode} />
        </div>
      </FlipScope>
    </FlipContext.Provider>
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

  // Fires once, when this room stops being a lobby and becomes a match.
  const phase = session.phase;
  const dealtRef = React.useRef(false);
  React.useEffect(() => {
    if (phase !== 'playing' || dealtRef.current) return;
    dealtRef.current = true;
    if (onDealt) onDealt();
  }, [phase, onDealt]);

  // Stable handlers (RENDER-1). The session object is new on every render, so
  // anything that closed over it would defeat every memoised component below.
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const send = React.useCallback((action: GameAction) => sessionRef.current.send(action), []);
  const sendMany = React.useCallback((actions: GameAction[]) => {
    // Feature-detected: the NET track adds `sendMany` (one ordered batch
    // intent). Without it, the same actions go one at a time, in order.
    const s = sessionRef.current as unknown as {
      send: (a: GameAction) => void;
      sendMany?: (a: GameAction[]) => void;
    };
    if (typeof s.sendMany === 'function') s.sendMany(actions);
    else for (const a of actions) s.send(a);
  }, []);
  const setActiveSeat = React.useCallback((seat: string) => sessionRef.current.setActiveSeat(seat), []);

  // Structural sharing between consecutive views, so unchanged cards, piles and
  // seats keep their identity and their memoised components skip.
  const stableRef = React.useRef<{ raw: GameView | null; stable: GameView | null }>({ raw: null, stable: null });
  const raw = session.view;
  let view: GameView | null = null;
  if (raw) {
    if (stableRef.current.raw === raw && stableRef.current.stable) view = stableRef.current.stable;
    else {
      view = stabilizeView(stableRef.current.stable, raw);
      stableRef.current = { raw, stable: view };
    }
  }

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

  return (
    <TableLayout
      view={view}
      mode={mode}
      code={code}
      seats={session.seats}
      views={session.views}
      activeSeat={session.activeSeat}
      setActiveSeat={setActiveSeat}
      send={send}
      sendMany={sendMany}
      turnSeconds={session.turnSeconds}
    />
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
