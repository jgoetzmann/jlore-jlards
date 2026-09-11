/**
 * Wires relay + host/client + view state into one hook.
 *
 * Three modes, one code path:
 *   hotseat — a local relay, a host, and one client per seat. No network.
 *   host    — an HTTP relay, a lobby, then a host and a client for this seat.
 *   join    — an HTTP relay and a client. No engine in this browser at all.
 *
 * Networked rooms have two phases. In `lobby` nothing has been dealt: the host
 * is holding the room open and the roster is whoever has said hello. In
 * `playing` a match exists, dealt for the people who were actually present, and
 * every one of them was seated before the first view went out.
 *
 * The phase boundary is the fix for the bug this replaced. `seedMatch` used to
 * run the moment a room was created, for a player count guessed on the start
 * screen, so seats existed before people did: the second joiner waited out a
 * retry cycle for one, and the third never had one at all.
 *
 * The hook only ever holds `GameView`s. `GameState` lives behind the
 * `HostHandle` and is never copied into React state.
 */

import React from 'react';
import { createMatch } from '@engine/index';
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
import { startHost, startLobbyHost, type HostHandle, type LobbyHostHandle } from '@net/host';
import { startClient, type ClientHandle } from '@net/client';
import { ensureRegistry } from '@net/bootstrap';
import { getCodex, getSettings, setRoomCode } from '@net/storage';

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
  /** The view being rendered: the active seat in hotseat, yours otherwise. */
  view: GameView | null;
  views: Record<string, GameView>;
  seats: string[];
  activeSeat: string | null;
  setActiveSeat: (seat: string) => void;
  send: (action: GameAction) => void;
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
): { id: PlayerId; name: string; codex: CardDefId[] }[] {
  const out: { id: PlayerId; name: string; codex: CardDefId[] }[] = [];
  for (let i = 0; i < playerCount; i++) {
    const given = names && typeof names[i] === 'string' ? names[i]!.trim() : '';
    out.push({
      id: `p${i + 1}`,
      name: given || (i === 0 ? myName : `Player ${i + 1}`),
      codex: codex.slice(),
    });
  }
  return out;
}

/**
 * Deals a fresh match. The only place the client side calls the engine.
 *
 * `names` comes from the lobby roster, so the table is labelled with the names
 * people actually typed rather than "Player 2".
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

export function useGame(opts: UseGameOptions): GameSession {
  const { mode, seatId, playerCount = 2, seed, config, resumeState } = opts;
  const roomCode = opts.roomCode ?? null;

  // A networked room that is not resuming a saved match opens as a lobby.
  const wantsLobby = mode !== 'hotseat' && !resumeState;

  const [views, setViews] = React.useState<Record<string, GameView>>({});
  const [activeSeat, setActiveSeat] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [turnSeconds, setTurnSeconds] = React.useState(DEFAULT_TURN_SECONDS);
  const [phase, setPhase] = React.useState<GamePhase>(wantsLobby ? 'lobby' : 'playing');
  const [roster, setRoster] = React.useState<LobbyPayload | null>(null);

  const relayRef = React.useRef<Relay | null>(null);
  const hostRef = React.useRef<HostHandle | null>(null);
  const lobbyHostRef = React.useRef<LobbyHostHandle | null>(null);
  const clientsRef = React.useRef<Map<string, ClientHandle>>(new Map());
  const followActiveRef = React.useRef(mode === 'hotseat');
  const configRef = React.useRef(config);
  configRef.current = config;

  const seedRef = React.useRef<number>(seed ?? Math.floor(Math.random() * 2 ** 31));
  const myName = React.useMemo(() => getSettings().playerName, []);

  /** A view arriving is, by itself, proof the match has begun. */
  const receive = React.useCallback(
    (seat: string) =>
      (v: GameView): void => {
        setViews((prev) => ({ ...prev, [seat]: v }));
        setPhase('playing');
      },
    [],
  );

  React.useEffect(() => {
    setViews({});
    setActiveSeat(null);
    setError(null);
    setRoster(null);
    setPhase(wantsLobby ? 'lobby' : 'playing');
    followActiveRef.current = mode === 'hotseat';

    const clients = new Map<string, ClientHandle>();
    clientsRef.current = clients;

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

    // ---- host of a networked room: hold a lobby open, deal nothing yet ----
    if (mode === 'host' && wantsLobby) {
      lobbyHostRef.current = startLobbyHost(relay, {
        code: roomCode as string,
        hostSeat: seatId,
        hostName: myName,
        seatCap: playerCount,
        onRoster: setRoster,
      });
      setActiveSeat(seatId);
      return () => {
        if (lobbyHostRef.current) lobbyHostRef.current.stop();
        lobbyHostRef.current = null;
        for (const c of clients.values()) c.stop();
        clients.clear();
        if (hostRef.current) hostRef.current.stop();
        hostRef.current = null;
        relay.stop();
        relayRef.current = null;
      };
    }

    // ---- hotseat, or a host resuming a snapshot: deal immediately ----
    if (mode === 'hotseat' || mode === 'host') {
      let state: GameState;
      try {
        if (resumeState) {
          ensureRegistry();
          state = resumeState;
        } else {
          state = seedMatch(playerCount, seedRef.current, config);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
      setTurnSeconds(state.config?.turnSeconds ?? DEFAULT_TURN_SECONDS);
      hostRef.current = startHost(relay, state);
    }

    if (mode === 'hotseat') {
      // One client per seat, all in this browser, each getting only its own
      // filtered view. Hotseat gets the hidden-information property for free.
      const count = resumeState ? resumeState.playerOrder.length : playerCount;
      for (let i = 0; i < count; i++) {
        const seat = hotseatSeatId(i);
        clients.set(seat, startClient(relay, seat, receive(seat)));
      }
      setActiveSeat(hotseatSeatId(0));
    } else {
      // Joining, or resuming as host. One client; it reads the lobby roster
      // while there is one and the match view once there is one.
      clients.set(seatId, startClient(relay, seatId, receive(seatId), { onLobby: setRoster }));
      setActiveSeat(seatId);
    }

    return () => {
      for (const c of clients.values()) c.stop();
      clients.clear();
      if (hostRef.current) hostRef.current.stop();
      hostRef.current = null;
      relay.stop();
      relayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, roomCode, seatId, playerCount, resumeState, wantsLobby, myName, receive]);

  /**
   * Deal for the people who are here.
   *
   * The lobby freezes its roster and hands back the seating order; the match is
   * created for exactly that many players and the host is told the plan before
   * it reads a single message, so the opening publish is already addressed to
   * every real browser in the room.
   */
  const startMatch = React.useCallback(() => {
    const lobbyHost = lobbyHostRef.current;
    const relay = relayRef.current;
    if (!lobbyHost || !relay) return;

    const handoff = lobbyHost.start();
    lobbyHostRef.current = null;

    const names = disambiguate(handoff.names);
    let state: GameState;
    try {
      state = seedMatch(handoff.seats.length, seedRef.current, configRef.current, names);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setTurnSeconds(state.config?.turnSeconds ?? DEFAULT_TURN_SECONDS);

    // The client goes up first, from the lobby's cursor, so the host's opening
    // publish cannot land in the gap between the two.
    const clients = clientsRef.current;
    if (!clients.has(seatId)) {
      clients.set(
        seatId,
        startClient(relay, seatId, receive(seatId), { since: handoff.since }),
      );
    }
    hostRef.current = startHost(relay, state, {
      seats: handoff.seats,
      since: handoff.since,
    });

    setActiveSeat(seatId);
    setPhase('playing');
  }, [receive, seatId]);

  const setSeatCap = React.useCallback((cap: number) => {
    if (lobbyHostRef.current) lobbyHostRef.current.setSeatCap(clampSeatCap(cap));
  }, []);

  // In hotseat the screen follows whoever is to move.
  const seats = React.useMemo(() => Object.keys(views).sort(), [views]);
  const currentView = activeSeat ? (views[activeSeat] ?? null) : null;

  React.useEffect(() => {
    if (!followActiveRef.current) return;
    for (const [seat, v] of Object.entries(views)) {
      if (v.you.id === v.activePlayer) {
        setActiveSeat((prev) => (prev === seat ? prev : seat));
        return;
      }
    }
  }, [views]);

  const send = React.useCallback(
    (action: GameAction) => {
      const seat = activeSeat ?? seatId;
      const client = clientsRef.current.get(seat);
      if (client) {
        client.send(action);
        return;
      }
      // No client for this seat (host-only browser): go straight to the engine.
      if (hostRef.current) hostRef.current.submit(action);
    },
    [activeSeat, seatId],
  );

  const lobby: LobbyInfo | null = React.useMemo(() => {
    if (phase !== 'lobby') return null;
    const youAreHost = mode === 'host';
    if (!roster) {
      // The host is member one of its own room from the first frame; a guest
      // has nothing to show until the host answers.
      return {
        code: roomCode ?? '',
        members: youAreHost
          ? [{ seat: seatId, name: myName, isHost: true, isYou: true }]
          : [],
        seatCap: clampSeatCap(playerCount),
        youAreHost,
        waiting: !youAreHost,
        full: false,
        missed: false,
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
      missed: roster.started && !roster.seats.includes(seatId),
      knocking: typeof roster.knocking === 'number' ? roster.knocking : 0,
    };
  }, [phase, roster, mode, seatId, roomCode, playerCount, myName]);

  const status: GameSession['status'] = error
    ? 'error'
    : currentView
      ? 'playing'
      : 'connecting';

  return {
    view: currentView,
    views,
    seats,
    activeSeat,
    setActiveSeat: (seat: string) => {
      followActiveRef.current = false;
      setActiveSeat(seat);
    },
    send,
    isHost: mode !== 'join',
    roomCode,
    turnSeconds,
    status,
    error,
    phase,
    lobby,
    startMatch,
    setSeatCap,
  };
}

export default useGame;
