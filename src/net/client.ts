/**
 * A dumb terminal. It renders whatever view it is told and sends intents back.
 *
 * It never runs the engine and never holds a `GameState`. `snapshot` messages
 * are ignored on purpose: the client has no business parsing full state, and
 * refusing to read it is what keeps B111 true no matter what rides the queue.
 *
 * The same client covers the lobby. `hello` is both "seat me" and "I am still
 * here", and a broadcast `view` carrying a lobby payload is the roster. One
 * connection therefore spans waiting-for-friends and playing, with no cursor
 * reset and no window where a message can fall between two loops.
 */

import type { CardDefId, GameAction, GameView, RelayMessage } from '@engine/types';
import {
  isLobbyPayload,
  startPolling,
  LOBBY_HEARTBEAT_MS,
  type LobbyPayload,
  type PollLoop,
  type Relay,
} from './relay';
import { addToCodex, getCodex, getSettings } from './storage';

export interface ClientHandle {
  stop(): void;
  send(action: GameAction): void;
}

export interface ClientOptions {
  /** Called with every lobby roster this seat sees. */
  onLobby?: (roster: LobbyPayload) => void;
  /** Relay cursor to start from. Defaults to the beginning of the room. */
  since?: number;
  /** How often to re-announce presence while no view has arrived. */
  heartbeatMs?: number;
}

/**
 * How long to wait before saying hello again. Doubles as the lobby presence
 * heartbeat: until a view arrives, this seat keeps telling the room it exists.
 */
export const HELLO_RETRY_MS = LOBBY_HEARTBEAT_MS;

function isView(payload: unknown): payload is GameView {
  if (payload === null || typeof payload !== 'object') return false;
  const v = payload as Partial<GameView>;
  return (
    typeof v.turn === 'number' &&
    typeof v.activePlayer === 'string' &&
    v.you !== undefined &&
    v.you !== null &&
    Array.isArray(v.others) &&
    v.shop !== undefined
  );
}

/**
 * Everything the viewer is now allowed to know about is, by definition, a card
 * they have seen. Fold it into the local codex.
 */
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
    for (const pile of group) {
      if (pile.top) ids.push(pile.top.defId);
    }
  }
  if (ids.length > 0) addToCodex(ids);
}

export function startClient(
  relay: Relay,
  seatId: string,
  onView: (v: GameView) => void,
  options: ClientOptions = {},
): ClientHandle {
  let stopped = false;
  let gotView = false;
  let lobby: LobbyPayload | null = null;
  let helloTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * `withCodex` is off for the heartbeat. The codex is every card id this
   * device has ever seen — several hundred strings — and a lobby repeats this
   * message every few seconds to a room whose whole history each new arrival
   * downloads. It is worth sending when it can be read (claiming a seat) and
   * not worth sending twenty more times while people file in.
   */
  function sayHello(withCodex: boolean): void {
    if (stopped) return;
    // Keeps this seat's own poll loop clear of the idle stop as well: a lobby
    // that nobody has spoken in for ten minutes is still a lobby you are in.
    loop.bump();
    const payload: { name: string; seat: string; codex?: CardDefId[] } = {
      name: getSettings().playerName,
      seat: seatId,
    };
    if (withCodex) payload.codex = getCodex();
    void relay
      .post({ from: seatId, kind: 'hello', payload })
      .catch(() => undefined);
  }

  /**
   * Stop announcing once there is a view to render, and stop announcing once
   * the room says a match was dealt without this seat in it -- nobody is
   * listening for us any more, and repeating the request will not change that.
   */
  function keepAnnouncing(): boolean {
    if (stopped || gotView) return false;
    if (lobby && lobby.started && !lobby.seats.includes(seatId)) return false;
    return true;
  }

  function handle(msgs: RelayMessage[]): void {
    if (stopped) return;
    for (const msg of msgs) {
      if (!msg || msg.kind !== 'view') continue;
      if (msg.to !== undefined && msg.to !== seatId) continue;
      // A lobby roster is broadcast, so it has no `to` and reaches everyone.
      // The two payload guards are mutually exclusive.
      if (isLobbyPayload(msg.payload)) {
        const wasStarted = lobby !== null && lobby.started;
        lobby = msg.payload;
        if (options.onLobby) options.onLobby(msg.payload);
        // The moment the lobby hands over, claim the seat it reserved for us:
        // it carries this device's codex, which the lobby had no use for and
        // the match does, and it is a second chance at a seat if the first
        // publish went astray.
        if (!wasStarted && lobby.started && !gotView && lobby.seats.includes(seatId)) {
          sayHello(true);
        }
        continue;
      }
      if (!isView(msg.payload)) continue;
      gotView = true;
      const view = msg.payload;
      harvestCodex(view);
      onView(view);
    }
  }

  const loop: PollLoop = startPolling(relay, options.since ?? 0, handle);

  sayHello(true);
  helloTimer = setInterval(() => {
    if (!keepAnnouncing()) {
      if (helloTimer) clearInterval(helloTimer);
      helloTimer = null;
      return;
    }
    sayHello(false);
  }, options.heartbeatMs ?? HELLO_RETRY_MS);

  return {
    stop() {
      stopped = true;
      loop.stop();
      if (helloTimer) clearInterval(helloTimer);
      helloTimer = null;
    },
    send(action: GameAction) {
      if (stopped) return;
      loop.bump();
      void relay
        .post({ from: seatId, kind: 'intent', payload: action })
        .catch(() => undefined);
    },
  };
}
