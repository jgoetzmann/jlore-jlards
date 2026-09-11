/**
 * Wires relay + lobby + lockstep session + view state into one hook.
 *
 * Three modes, one code path:
 *   hotseat — a local relay and one lockstep session that acts for every seat.
 *   host    — an HTTP relay and a lobby; Start posts the deal and this browser
 *             becomes an ordinary lockstep client of its own room.
 *   join    — an HTTP relay and a lockstep session. It reads the lobby roster
 *             while there is one and the match once it is dealt.
 *
 * Every browser runs the engine (SB-65). A press is applied to this browser's
 * predicted state and rendered before it is posted; nothing waits on a round
 * trip. What React is handed is still a `GameView` from `viewFor`, so the
 * table never renders another player's hand even though the state that could
 * is in memory: hidden information is waived for playtesting, not the UI.
 *
 * Networked rooms have two phases. In `lobby` nothing has been dealt. In
 * `playing` a match exists, dealt for the people who were actually present.
 * A reload during a match is a rejoin: the room is replayed from its first
 * message, and the seat cookie binds you back to your seat — the host too.
 */

import React from 'react';
import { createMatch } from '@engine/index';
import { viewFor } from '@engine/view';
import type {
  CardDefId,
  GameAction,
  GameState,
  GameView,
  MatchConfig,
  PlayerId,
} from '@engine/types';
import {
  clampSeatCap,
  makeLocalRelay,
  makeRelay,
  type LobbyPayload,
  type Relay,
} from '@net/relay';
import { startLobbyHost, type LobbyHostHandle } from '@net/host';
import { makeStart, startSession, type LockstepSession } from '@net/lockstep';
import { ensureRegistry } from '@net/bootstrap';
import { getCodex, getSettings, noteSeenCards, saveSnapshot, setRoomCode } from '@net/storage';

export type GameMode = 'hotseat' | 'host' | 'join';
export type GamePhase = 'lobby' | 'playing';

export interface UseGameOptions {
  mode: GameMode;
  roomCode?: string | null;
  seatId: string;
  /** Hotseat: how many seats to deal. Networked: the room's seat cap. */
  playerCount?: number;
  seed?: number;
  config?: Partial<MatchConfig>;
  /** Resume hosting from a stored snapshot instead of opening a lobby. */
  resumeState?: GameState | null;
}

export interface LobbyMemberInfo {
  seat: string;
  name: string;
  isHost: boolean;
  isYou: boolean;
}

export interface LobbyInfo {
  code: string;
  members: LobbyMemberInfo[];
  seatCap: number;
  youAreHost: boolean;
  /** Joined, said hello, and the host has not answered yet. */
  waiting: boolean;
  /** Every seat is taken and none of them is ours. */
  full: boolean;
  /** The match was dealt, and we are not in it. */
  missed: boolean;
  /** People asking for a seat the room has no room for. */
  knocking: number;
}

export interface GameSession {
  /** The view being rendered: the seat that must act in hotseat, yours otherwise. */
  view: GameView | null;
  views: Record<string, GameView>;
  seats: string[];
  activeSeat: string | null;
  setActiveSeat: (seat: string) => void;
  /** Act as the seat on screen. Applied locally before it returns. Stable identity. */
  send: (action: GameAction) => void;
  /**
   * Several actions as one intent, unrolled in order by every client and
   * stopped at the first refusal or prompt (e.g. "play all money"). Stable.
   */
  sendMany: (actions: GameAction[]) => void;
  isHost: boolean;
  roomCode: string | null;
  turnSeconds: number;
  status: 'connecting' | 'playing' | 'error';
  error: string | null;
  /** `lobby` until a match exists. Hotseat is never in a lobby. */
  phase: GamePhase;
  lobby: LobbyInfo | null;
  /** Host only: deal for the people in the room and send everyone to the table. */
  startMatch: () => void;
  /** Host only: change how many seats the room holds. */
  setSeatCap: (cap: number) => void;
  /** Hotseat: the seat that has to act now (a prompt's owner, else the active player). */
  seatToMove: string | null;
  /** This browser's state disagreed with the host's and is being repaired. */
  desynced: boolean;
  /**
   * How many of this browser's own intents the relay has not echoed back yet.
   *
   * Under optimistic apply the local state has already moved on, so this is the
   * only thing that still says "the table has not agreed to my press". The Buy
   * guard reads it: in hotseat it is back to zero within the task, in a room it
   * stays up for the round trip. Zero when there is no session.
   */
  pendingIntents: number;
}

export const DEFAULT_TURN_SECONDS = 90;

export function defaultConfig(playerCount: number, patch?: Partial<MatchConfig>): MatchConfig {
  const base: MatchConfig = {
    playerCount,
    draftPileCount: 10,
    // Gameplay doc 8.1: 30%. Was 0.15, so real games rolled anomalies at half
    // the rate the sim measured balance at.
    anomalyChance: 0.3,
    winCondition: {
      kind: 'standard',
      emptyPileFraction: 0.4,
      emptyPileAbsolute: 4,
      x: null,
    },
    pileSizeScale: 1,
    // Gameplay doc 12.2: 200. Was 2000, so the shipped game ran a cap ten times
    // looser than the one the docs and the sim describe.
    effectNodeBudget: 200,
    recursionDepth: 8,
    turnSeconds: DEFAULT_TURN_SECONDS,
    seedCodexWithCommons: true,
  };
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    winCondition: { ...base.winCondition, ...(patch.winCondition ?? {}) },
  };
}

/**
 * Two friends who never changed the default both arrive as "Player 1", and a
 * table with two Player 1s on it is unreadable. Suffix the repeats rather than
 * renaming anyone, so the first person to claim a name keeps it.
 */
/** A name nobody chose: the shipped default, which every fresh browser sends. */
const UNSET_NAME = /^Player \d+$/;

export function disambiguate(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map((raw, index) => {
    const name = (raw ?? '').trim() || 'Navigator';
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen === 0) return name;
    // Two people who both typed "Sam" want "Sam" and "Sam (2)" — the suffix
    // says "another Sam". Three people who never opened the name box are a
    // different case: they all arrive as the shipped default, and "Player 1
    // (2)" reads like Player 1's second device rather than a second player.
    // Number them by seat instead, which is what the default was reaching for.
    if (UNSET_NAME.test(name)) return `Player ${index + 1}`;
    return `${name} (${seen + 1})`;
  });
}

export function makePlayers(
  playerCount: number,
  codex: CardDefId[],
  myName: string,
  names?: string[],
  codexes?: CardDefId[][],
): { id: PlayerId; name: string; codex: CardDefId[] }[] {
  const out: { id: PlayerId; name: string; codex: CardDefId[] }[] = [];
  for (let i = 0; i < playerCount; i++) {
    const given = names && typeof names[i] === 'string' ? names[i]!.trim() : '';
    const own = codexes && Array.isArray(codexes[i]) ? codexes[i]! : codex;
    out.push({
      id: `p${i + 1}`,
      name: given || (i === 0 ? myName : `Player ${i + 1}`),
      codex: own.slice(),
    });
  }
  return out;
}

/**
 * Deals a fresh match locally. The lockstep start does the same deal through
 * `makeStart`; this is kept for callers that just want a state.
 */
export function seedMatch(
  playerCount: number,
  seed: number,
  patch?: Partial<MatchConfig>,
  names?: string[],
): GameState {
  ensureRegistry();
  const config = defaultConfig(playerCount, patch);
  const players = makePlayers(playerCount, getCodex(), getSettings().playerName, names);
  return createMatch(config, players, seed);
}

export function hotseatSeatId(index: number): string {
  return `hs_p${index + 1}`;
}

/**
 * Views are derived from the one state on demand and cached per state, so a
 * seat nobody looks at costs nothing.
 */
function lazyViews(state: GameState, seats: [string, PlayerId][]): Record<string, GameView> {
  const out: Record<string, GameView> = {};
  for (const [seat, pid] of seats) {
    let cached: GameView | null = null;
    Object.defineProperty(out, seat, {
      enumerable: true,
      configurable: false,
      get() {
        if (cached === null) cached = viewFor(state, pid);
        return cached;
      },
    });
  }
  return out;
}

/** Every card id a view shows is, by definition, one this device has seen. */
function harvestCodex(view: GameView): void {
  const ids: CardDefId[] = [];
  for (const c of view.you.hand) ids.push(c.defId);
  for (const c of view.you.play) ids.push(c.defId);
  for (const c of view.you.gy) ids.push(c.defId);
  for (const other of view.others) {
    for (const c of other.gy) ids.push(c.defId);
    for (const c of other.play) ids.push(c.defId);
  }
  for (const group of [view.shop.resource, view.shop.points, view.shop.prophet, view.shop.draft]) {
    for (const pile of group) if (pile.top) ids.push(pile.top.defId);
  }
  if (ids.length > 0) noteSeenCards(ids);
}

/** Work that must not sit on the click path. */
function whenIdle(fn: () => void): void {
  const w = typeof window !== 'undefined' ? (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }) : null;
  if (w && typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 0);
}

/** Largest resumed state the start message may carry (the relay caps at 256KB). */
const MAX_START_CHARS = 240 * 1024;

interface ManualSeat {
  seat: string;
  turn: number;
  pendingId: string | null;
}

export function useGame(opts: UseGameOptions): GameSession {
  const { mode, seatId, playerCount = 2, seed, config, resumeState } = opts;
  const roomCode = opts.roomCode ?? null;

  // A networked room that is not resuming a saved match opens as a lobby.
  const wantsLobby = mode !== 'hotseat' && !resumeState;

  const [, setVersion] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [roster, setRoster] = React.useState<LobbyPayload | null>(null);
  const [lobbyOpen, setLobbyOpen] = React.useState(mode === 'host' && wantsLobby);
  const [manual, setManual] = React.useState<ManualSeat | null>(null);

  const relayRef = React.useRef<Relay | null>(null);
  const sessionRef = React.useRef<LockstepSession | null>(null);
  const lobbyHostRef = React.useRef<LobbyHostHandle | null>(null);
  const configRef = React.useRef(config);
  configRef.current = config;

  const seedRef = React.useRef<number>(seed ?? Math.floor(Math.random() * 2 ** 31));
  const myName = React.useMemo(() => getSettings().playerName, []);

  const savedTurnRef = React.useRef(-1);
  const onChange = React.useCallback(() => {
    setVersion((v) => v + 1);
    // A per-turn local save for the start screen's resume, off the click path
    // and never in hotseat (HS-6). Nothing is posted: a rejoin replays the room.
    const s = sessionRef.current;
    if (!s || mode === 'hotseat') return;
    const conf = s.core.confirmedState();
    if (!conf || conf.turn === savedTurnRef.current) return;
    savedTurnRef.current = conf.turn;
    const code = roomCode ?? '';
    whenIdle(() => {
      try {
        saveSnapshot(code, 0, conf);
      } catch {
        /* storage is a convenience */
      }
    });
  }, [mode, roomCode]);

  function begin(relay: Relay, session: LockstepSession): void {
    relayRef.current = relay;
    sessionRef.current = session;
    setVersion((v) => v + 1);
  }

  React.useEffect(() => {
    setError(null);
    setRoster(null);
    setManual(null);
    setLobbyOpen(mode === 'host' && wantsLobby);
    savedTurnRef.current = -1;
    sessionRef.current = null;

    let relay: Relay;
    try {
      if (mode === 'hotseat') {
        relay = makeLocalRelay();
      } else {
        if (!roomCode) {
          setError('missing room code');
          return;
        }
        setRoomCode(roomCode);
        relay = makeRelay(roomCode, seatId);
      }
    } catch (err) {
      setError(String(err));
      return;
    }
    relayRef.current = relay;

    const teardown = (): void => {
      if (lobbyHostRef.current) lobbyHostRef.current.stop();
      lobbyHostRef.current = null;
      if (sessionRef.current) sessionRef.current.stop();
      sessionRef.current = null;
      relay.stop();
      relayRef.current = null;
    };

    try {
      if (mode === 'host' && wantsLobby) {
        // ---- host of a networked room: hold a lobby open, deal nothing yet ----
        lobbyHostRef.current = startLobbyHost(relay, {
          code: roomCode as string,
          hostSeat: seatId,
          hostName: myName,
          hostCodex: getCodex(),
          seatCap: playerCount,
          onRoster: setRoster,
        });
      } else if (mode === 'hotseat') {
        // ---- hotseat: every seat is local, one state, no network ----
        ensureRegistry();
        const count = resumeState ? resumeState.playerOrder.length : playerCount;
        const seats = Array.from({ length: count }, (_, i) => hotseatSeatId(i));
        const start = resumeState
          ? makeStart({ seats, state: resumeState })
          : makeStart({
              seats,
              config: defaultConfig(count, configRef.current),
              seed: seedRef.current,
              players: makePlayers(count, getCodex(), myName),
            });
        begin(relay, startSession(relay, { localSeats: seats, start, onChange }));
      } else if (mode === 'host' && resumeState) {
        // ---- a host resuming a saved match: deal it at once, seats open ----
        ensureRegistry();
        const start = makeStart({ seats: [seatId], state: resumeState });
        if (JSON.stringify(start.payload).length > MAX_START_CHARS) {
          throw new Error('this saved match is too large to share over the relay');
        }
        begin(relay, startSession(relay, { localSeats: [seatId], start, onChange }));
      } else {
        // ---- joining (or rejoining): read the room from its first message ----
        ensureRegistry();
        begin(
          relay,
          startSession(relay, {
            localSeats: [seatId],
            onChange,
            onLobby: setRoster,
            hello: { name: myName, codex: getCodex() },
          }),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    return teardown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, roomCode, seatId, playerCount, resumeState, wantsLobby, myName, onChange]);

  /**
   * Deal for the people who are here.
   *
   * The lobby freezes its roster and hands back the seating order, names and
   * each person's codex; the deal goes out as one start message every browser
   * builds the identical match from. This browser applies it at once, so the
   * host's table appears without waiting for its own post to come back.
   */
  const startMatch = React.useCallback(() => {
    const lobbyHost = lobbyHostRef.current;
    const relay = relayRef.current;
    if (!lobbyHost || !relay) return;

    const handoff = lobbyHost.start();
    lobbyHostRef.current = null;

    try {
      ensureRegistry();
      const n = handoff.seats.length;
      const names = disambiguate(handoff.names);
      const start = makeStart({
        seats: handoff.seats,
        config: defaultConfig(n, configRef.current),
        seed: seedRef.current,
        players: makePlayers(n, getCodex(), myName, names, handoff.codexes),
      });
      sessionRef.current = startSession(relay, {
        localSeats: [seatId],
        since: handoff.since,
        start,
        onChange,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setLobbyOpen(false);
    setVersion((v) => v + 1);
  }, [seatId, myName, onChange]);

  const setSeatCap = React.useCallback((cap: number) => {
    if (lobbyHostRef.current) lobbyHostRef.current.setSeatCap(clampSeatCap(cap));
  }, []);

  // ---- derive everything from the session's predicted state ----
  const session = sessionRef.current;
  const core = session ? session.core : null;
  const state = core ? core.predicted() : null;
  const myPid = core ? core.playerOf(seatId) : null;

  const seatPairs: [string, PlayerId][] = [];
  if (state && core) {
    if (mode === 'hotseat') {
      state.playerOrder.forEach((pid) => {
        const seat = core.seatOf(pid);
        if (seat) seatPairs.push([seat, pid]);
      });
    } else if (myPid) {
      seatPairs.push([seatId, myPid]);
    }
  }
  const pairKey = seatPairs.map((p) => p.join('=')).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const views = React.useMemo(() => (state ? lazyViews(state, seatPairs) : {}), [state, pairKey]);
  const seats = React.useMemo(() => Object.keys(views).sort(), [views]);

  // In hotseat the screen follows whoever has to act: a prompt's owner first,
  // then the active player. A seat clicked by hand holds only until the turn
  // or the prompt changes (HS-2/TURN-4), so a card that hands a choice to an
  // opponent can never strand the table behind a "waiting" screen.
  let seatToMove: string | null = null;
  if (state && core && mode === 'hotseat') {
    const who = state.pending ? state.pending.player : state.activePlayer;
    seatToMove = core.seatOf(who);
  }
  const pendingId = state?.pending ? state.pending.id : null;
  let activeSeat: string | null;
  if (mode === 'hotseat') {
    const manualValid =
      manual !== null && state !== null && manual.turn === state.turn && manual.pendingId === pendingId;
    activeSeat = manualValid ? manual.seat : (seatToMove ?? seats[0] ?? null);
  } else {
    activeSeat = seatId;
  }
  const currentView = activeSeat ? (views[activeSeat] ?? null) : null;

  const actingSeatRef = React.useRef<string>(seatId);
  actingSeatRef.current = activeSeat ?? seatId;
  const stateRef = React.useRef<GameState | null>(null);
  stateRef.current = state;

  const send = React.useCallback((action: GameAction) => {
    const s = sessionRef.current;
    if (s) s.send(actingSeatRef.current, action);
  }, []);

  const sendMany = React.useCallback((actions: GameAction[]) => {
    const s = sessionRef.current;
    if (s && actions.length > 0) s.sendMany(actingSeatRef.current, actions);
  }, []);

  const setActiveSeat = React.useCallback((seat: string) => {
    const st = stateRef.current;
    setManual({ seat, turn: st ? st.turn : -1, pendingId: st?.pending ? st.pending.id : null });
  }, []);

  // The codex grows from what this device is shown, collected off the click
  // path and written to storage on a debounce (STORE-1).
  React.useEffect(() => {
    if (!currentView) return;
    whenIdle(() => harvestCodex(currentView));
  }, [currentView]);

  const started = core ? core.started() : false;
  const bound = mode === 'hotseat' ? started : myPid !== null;
  const phase: GamePhase = mode === 'hotseat' ? 'playing' : lobbyOpen || !bound ? 'lobby' : 'playing';

  const missedByDeal = started && !bound && core !== null && !core.hasOpenSeat();

  const lobby: LobbyInfo | null = React.useMemo(() => {
    if (phase !== 'lobby') return null;
    const youAreHost = mode === 'host';
    if (!roster) {
      // The host is member one of its own room from the first frame; a guest
      // has nothing to show until the host answers.
      return {
        code: roomCode ?? '',
        members: youAreHost ? [{ seat: seatId, name: myName, isHost: true, isYou: true }] : [],
        seatCap: clampSeatCap(playerCount),
        youAreHost,
        waiting: !youAreHost && !missedByDeal,
        full: false,
        missed: missedByDeal,
        knocking: 0,
      };
    }
    const display = disambiguate(roster.members.map((m) => m.name));
    const members: LobbyMemberInfo[] = roster.members.map((m, i) => ({
      seat: m.seat,
      name: display[i] ?? m.name,
      isHost: m.host,
      isYou: m.seat === seatId,
    }));
    const seated = members.some((m) => m.isYou);
    return {
      code: roster.code || (roomCode ?? ''),
      members,
      seatCap: roster.seatCap,
      youAreHost,
      waiting: false,
      full: !seated && members.length >= roster.seatCap,
      missed: (roster.started && !roster.seats.includes(seatId)) || missedByDeal,
      knocking: typeof roster.knocking === 'number' ? roster.knocking : 0,
    };
  }, [phase, roster, mode, seatId, roomCode, playerCount, myName, missedByDeal]);

  const status: GameSession['status'] = error ? 'error' : currentView ? 'playing' : 'connecting';

  return {
    view: currentView,
    views,
    seats,
    activeSeat,
    setActiveSeat,
    send,
    sendMany,
    isHost: mode !== 'join' || (core !== null && core.isAuthority()),
    roomCode,
    turnSeconds: state?.config?.turnSeconds ?? DEFAULT_TURN_SECONDS,
    status,
    error,
    phase,
    lobby,
    startMatch,
    setSeatCap,
    seatToMove,
    desynced: core ? core.desynced() : false,
    pendingIntents: core ? core.pendingCount() : 0,
  };
}

export default useGame;
