/**
 * Wires relay + host/client + view state into one hook.
 *
 * Three modes, one code path:
 *   hotseat — a local relay, a host, and one client per seat. No network.
 *   host    — an HTTP relay, a host, and a client for this browser's seat.
 *   join    — an HTTP relay and a client. No engine in this browser at all.
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
import { makeLocalRelay, makeRelay, type Relay } from '@net/relay';
import { startHost, type HostHandle } from '@net/host';
import { startClient, type ClientHandle } from '@net/client';
import { ensureRegistry } from '@net/bootstrap';
import { getCodex, getSettings, setRoomCode } from '@net/storage';

export type GameMode = 'hotseat' | 'host' | 'join';

export interface UseGameOptions {
  mode: GameMode;
  roomCode?: string | null;
  seatId: string;
  playerCount?: number;
  seed?: number;
  config?: Partial<MatchConfig>;
  /** Resume hosting from a stored snapshot instead of dealing a new match. */
  resumeState?: GameState | null;
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

export function makePlayers(
  playerCount: number,
  codex: CardDefId[],
  myName: string,
): { id: PlayerId; name: string; codex: CardDefId[] }[] {
  const out: { id: PlayerId; name: string; codex: CardDefId[] }[] = [];
  for (let i = 0; i < playerCount; i++) {
    out.push({
      id: `p${i + 1}`,
      name: i === 0 ? myName : `Player ${i + 1}`,
      codex: codex.slice(),
    });
  }
  return out;
}

/** Deals a fresh match. The only place the client side calls the engine. */
export function seedMatch(
  playerCount: number,
  seed: number,
  patch?: Partial<MatchConfig>,
): GameState {
  ensureRegistry();
  const config = defaultConfig(playerCount, patch);
  const players = makePlayers(playerCount, getCodex(), getSettings().playerName);
  return createMatch(config, players, seed);
}

export function hotseatSeatId(index: number): string {
  return `hs_p${index + 1}`;
}

export function useGame(opts: UseGameOptions): GameSession {
  const { mode, seatId, playerCount = 2, seed, config, resumeState } = opts;
  const roomCode = opts.roomCode ?? null;

  const [views, setViews] = React.useState<Record<string, GameView>>({});
  const [activeSeat, setActiveSeat] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [turnSeconds, setTurnSeconds] = React.useState(DEFAULT_TURN_SECONDS);

  const relayRef = React.useRef<Relay | null>(null);
  const hostRef = React.useRef<HostHandle | null>(null);
  const clientsRef = React.useRef<Map<string, ClientHandle>>(new Map());
  const followActiveRef = React.useRef(mode === 'hotseat');

  const seedRef = React.useRef<number>(seed ?? Math.floor(Math.random() * 2 ** 31));

  React.useEffect(() => {
    setViews({});
    setActiveSeat(null);
    setError(null);
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

    function receive(seat: string): (v: GameView) => void {
      return (v: GameView) => {
        setViews((prev) => ({ ...prev, [seat]: v }));
      };
    }

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
      clients.set(seatId, startClient(relay, seatId, receive(seatId)));
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
  }, [mode, roomCode, seatId, playerCount, resumeState]);

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
  };
}

export default useGame;
