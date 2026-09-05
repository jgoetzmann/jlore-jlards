/**
 * The host runs the engine. It is the only place a full `GameState` exists.
 *
 * Loop: poll for `intent` messages, run `reduce`, then compute `viewFor` for
 * every seat and post one `view` message each (B109). A `hello` claims a seat,
 * records that seat's codex into match state, and gets a fresh view back
 * (B110). A `snapshot` goes out each turn so another client could take over.
 */

import { reduce, legalActions } from '@engine/index';
import { viewFor } from '@engine/view';
import type {
  CardDefId,
  GameAction,
  GameState,
  GameView,
  PlayerId,
  RelayMessage,
} from '@engine/types';
import { startPolling, type PollLoop, type Relay } from './relay';
import { saveSnapshot } from './storage';

export interface HostHandle {
  stop(): void;
  getState(): GameState;
  submit(action: GameAction): void;
}

export const HOST_FROM = 'host';

interface HelloPayload {
  codex?: CardDefId[];
  name?: string;
  seat?: string;
}

function isHello(payload: unknown): payload is HelloPayload {
  return payload === null || payload === undefined || typeof payload === 'object';
}

function isAction(payload: unknown): payload is GameAction {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    typeof (payload as { type?: unknown }).type === 'string'
  );
}

/** Two actions are the same move if their type and every scalar field match. */
function sameAction(a: GameAction, b: GameAction): boolean {
  if (a.type !== b.type) return false;
  const ao = a as unknown as Record<string, unknown>;
  const bo = b as unknown as Record<string, unknown>;
  for (const key of ['player', 'iid', 'pileId', 'auraId', 'promptId']) {
    if (ao[key] !== bo[key]) return false;
  }
  return true;
}

export function startHost(relay: Relay, state: GameState): HostHandle {
  let current = state;
  let stopped = false;
  let lastSnapshotTurn = -1;
  let lastPublishedSignature = '';

  /** seatId -> PlayerId. The only thing the host knows about who is who. */
  const seats = new Map<string, PlayerId>();
  const claimed = new Set<PlayerId>();

  function nextFreeSeat(): PlayerId | null {
    for (const pid of current.playerOrder) {
      if (!claimed.has(pid)) return pid;
    }
    return null;
  }

  function assignSeat(seatId: string): PlayerId | null {
    const existing = seats.get(seatId);
    if (existing) return existing;
    // A seat id that is already a player id in this match claims itself, so a
    // hotseat client (and the tests) address seats by the name the match uses.
    const pid =
      current.playerOrder.includes(seatId) && !claimed.has(seatId)
        ? (seatId as PlayerId)
        : nextFreeSeat();
    if (!pid) return null;
    seats.set(seatId, pid);
    claimed.add(pid);
    return pid;
  }

  /**
   * Where a seat's view is posted. A player that no client has claimed yet is
   * addressed by its own player id, so the opening position is on the wire
   * before anybody says hello (B109).
   */
  function addressOf(pid: PlayerId): string {
    for (const [seatId, seated] of seats) {
      if (seated === pid) return seatId;
    }
    return pid;
  }

  function recordCodex(pid: PlayerId, codex: CardDefId[] | undefined): void {
    if (!Array.isArray(codex) || codex.length === 0) return;
    const player = current.players[pid];
    if (!player) return;
    const merged = player.codex.slice();
    const seen = new Set(merged);
    let changed = false;
    for (const id of codex) {
      if (typeof id !== 'string' || seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
      changed = true;
    }
    if (!changed) return;
    current = {
      ...current,
      players: { ...current.players, [pid]: { ...player, codex: merged } },
    };
  }

  function recordName(pid: PlayerId, name: string | undefined): void {
    if (typeof name !== 'string' || name.length === 0) return;
    const player = current.players[pid];
    if (!player || player.name === name) return;
    current = {
      ...current,
      players: { ...current.players, [pid]: { ...player, name } },
    };
  }

  function publishTo(seatId: string, pid: PlayerId): void {
    const view: GameView = viewFor(current, pid);
    void relay
      .post({ from: HOST_FROM, to: seatId, kind: 'view', payload: view })
      .catch(() => undefined);
  }

  /**
   * One filtered view per seat in the match, after every state change (B109).
   * The roster is `playerOrder`, never the set of clients that have said hello
   * -- a seat nobody has claimed still gets its view, addressed to its player
   * id, and no seat outside the match is ever addressed.
   */
  function publishAll(): void {
    if (stopped) return;
    for (const pid of current.playerOrder) publishTo(addressOf(pid), pid);
    lastPublishedSignature = signature();
    maybeSnapshot();
  }

  function signature(): string {
    return `${current.turn}:${current.logSeq}:${current.activePlayer}:${
      current.pending ? current.pending.id : '-'
    }:${current.ended ? 1 : 0}`;
  }

  /** §8: a snapshot each turn, so another client could take over. */
  function maybeSnapshot(): void {
    if (current.turn === lastSnapshotTurn) return;
    lastSnapshotTurn = current.turn;
    void relay
      .post({ from: HOST_FROM, kind: 'snapshot', payload: current })
      .catch(() => undefined);
    try {
      saveSnapshot(String(current.seed), loopRef ? loopRef.cursor() : 0, current);
    } catch {
      /* storage is a convenience for the host only */
    }
  }

  function applyAction(action: GameAction, actor: PlayerId | null): boolean {
    if (current.ended) return false;
    const bound: GameAction = actor
      ? ({ ...(action as unknown as Record<string, unknown>), player: actor } as GameAction)
      : action;

    // B25: legalActions never offers something reduce would reject, so an
    // intent that is not in the list is a stale click. Skip it rather than
    // republishing an identical view to every seat.
    if (actor && bound.type !== 'resolve') {
      const legal = legalActions(current, actor);
      if (legal.length > 0 && !legal.some((a) => sameAction(a, bound))) return false;
    }

    const next = reduce(current, bound);
    if (next === current) return false;
    current = next;
    return true;
  }

  function handle(msgs: RelayMessage[]): void {
    if (stopped) return;
    let dirty = false;

    for (const msg of msgs) {
      if (!msg || msg.from === HOST_FROM) continue;

      if (msg.kind === 'hello') {
        const pid = assignSeat(msg.from);
        if (!pid) continue;
        if (isHello(msg.payload) && msg.payload) {
          recordCodex(pid, msg.payload.codex);
          recordName(pid, msg.payload.name);
        }
        // B110: a fresh view addressed to the seat that said hello.
        publishTo(msg.from, pid);
        dirty = true;
        continue;
      }

      if (msg.kind === 'intent') {
        const pid = seats.get(msg.from) ?? assignSeat(msg.from);
        if (!pid) continue;
        if (!isAction(msg.payload)) continue;
        if (applyAction(msg.payload, pid)) dirty = true;
      }
    }

    if (dirty || signature() !== lastPublishedSignature) publishAll();
  }

  let loopRef: PollLoop | null = null;
  loopRef = startPolling(relay, 0, handle);
  const loop: PollLoop = loopRef;

  // Announce the opening position to whoever is already listening.
  publishAll();

  return {
    stop() {
      stopped = true;
      loop.stop();
    },
    getState() {
      return current;
    },
    submit(action: GameAction) {
      if (stopped) return;
      const actor =
        (action as { player?: PlayerId }).player ?? current.activePlayer ?? null;
      if (applyAction(action, actor)) {
        loop.bump();
        publishAll();
      }
    },
  };
}
