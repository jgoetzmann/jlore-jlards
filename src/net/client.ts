/**
 * A dumb terminal. It renders whatever view it is told and sends intents back.
 *
 * It never runs the engine and never holds a `GameState`. `snapshot` messages
 * are ignored on purpose: the client has no business parsing full state, and
 * refusing to read it is what keeps B111 true no matter what rides the queue.
 */

import type { CardDefId, GameAction, GameView, RelayMessage } from '@engine/types';
import { startPolling, type PollLoop, type Relay } from './relay';
import { addToCodex, getCodex, getSettings } from './storage';

export interface ClientHandle {
  stop(): void;
  send(action: GameAction): void;
}

/** How long to wait for the first view before saying hello again. */
export const HELLO_RETRY_MS = 4000;

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
): ClientHandle {
  let stopped = false;
  let gotView = false;
  let helloTimer: ReturnType<typeof setInterval> | null = null;

  function sayHello(): void {
    if (stopped) return;
    void relay
      .post({
        from: seatId,
        kind: 'hello',
        payload: { codex: getCodex(), name: getSettings().playerName, seat: seatId },
      })
      .catch(() => undefined);
  }

  function handle(msgs: RelayMessage[]): void {
    if (stopped) return;
    for (const msg of msgs) {
      if (!msg || msg.kind !== 'view') continue;
      if (msg.to !== undefined && msg.to !== seatId) continue;
      if (!isView(msg.payload)) continue;
      gotView = true;
      const view = msg.payload;
      harvestCodex(view);
      onView(view);
    }
  }

  const loop: PollLoop = startPolling(relay, 0, handle);

  sayHello();
  helloTimer = setInterval(() => {
    if (stopped || gotView) {
      if (helloTimer) clearInterval(helloTimer);
      helloTimer = null;
      return;
    }
    sayHello();
  }, HELLO_RETRY_MS);

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
        // Poll the moment the intent is on the queue rather than waiting out
        // the next scheduled tick. The host still has its own interval to
        // notice it, so this halves the round trip rather than removing it.
        .then(() => loop.kick())
        .catch(() => undefined);
    },
  };
}
