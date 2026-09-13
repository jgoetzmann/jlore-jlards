/**
 * Premoving in a room (SB-68): the React side of `src/net/premove.ts`.
 *
 * The queue and what its previews revealed live in a ref (a `PremoveTracker`);
 * React state only says "the queue changed" and "a rollback happened". Every
 * time the predicted state changes, the queue is refolded; a rollback is
 * committed from an effect. When the table reaches this seat's turn, the queue
 * goes out as one batch and premove mode switches off.
 *
 * Networked only. Hotseat always shows the seat to move, so nobody is waiting.
 */

import React from 'react';
import { viewFor } from '@engine/view';
import type { GameAction, GameState, GameView, PlayerId } from '@engine/types';
import {
  EMPTY_TRACKER,
  addPremove,
  clearPremoves,
  premoveCount,
  submitPremoves,
  syncPremoves,
  type PremoveTracker,
  type SyncResult,
} from '@net/premove';

export interface PremoveSession {
  /** A room, someone else's turn, the game running, and a branch that builds. */
  available: boolean;
  /** Premove mode is on (the table shows your next turn when `view` is set). */
  active: boolean;
  /** Premoves queued. */
  count: number;
  /** Your next turn with the queue applied, or null when there is none to show. */
  view: GameView | null;
  /** Bumps on each rollback the table forced (not on Clear). */
  rolledBack: number;
  setActive: (on: boolean) => void;
  add: (action: GameAction) => void;
  addMany: (actions: GameAction[]) => void;
  clear: () => void;
}

export interface UsePremoveOptions {
  networked: boolean;
  state: GameState | null;
  me: PlayerId | null;
  /** Send one batch as this seat. */
  submit: (actions: GameAction[]) => void;
}

function drafting(state: GameState): boolean {
  const d = (state as unknown as { draft?: unknown }).draft;
  return d !== undefined && d !== null;
}

export function usePremove({ networked, state, me, submit }: UsePremoveOptions): PremoveSession {
  const trackerRef = React.useRef<PremoveTracker>(EMPTY_TRACKER);
  const [queueVersion, setQueueVersion] = React.useState(0);
  const [activeState, setActiveState] = React.useState(false);
  const [rolledBack, setRolledBack] = React.useState(0);

  const stateRef = React.useRef(state);
  stateRef.current = state;
  const meRef = React.useRef(me);
  meRef.current = me;
  const submitRef = React.useRef(submit);
  submitRef.current = submit;

  const running = networked && state !== null && me !== null && !state.ended;
  const theirTurn = running && state!.activePlayer !== me;
  const queued = trackerRef.current.queue.length > 0;
  // Folding costs an endTurn reduce per intervening seat, so skip it while
  // premoving is off and nothing is queued.
  const wantFold = theirTurn && (activeState || queued);

  const synced = React.useMemo<{ base: PremoveTracker; result: SyncResult } | null>(() => {
    if (!wantFold || !state || !me) return null;
    const base = trackerRef.current;
    return { base, result: syncPremoves(base, state, me) };
    // queueVersion: the tracker ref changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantFold, state, me, queueVersion]);

  React.useEffect(() => {
    if (!synced) return;
    // Only if nothing replaced the tracker since this fold was computed.
    if (trackerRef.current !== synced.base) return;
    trackerRef.current = synced.result.tracker;
    if (synced.result.rolledBack) {
      setRolledBack((n) => n + 1);
      setQueueVersion((v) => v + 1);
    }
  }, [synced]);

  // Your turn: send the queue as one batch, once there is no prompt in the way.
  React.useEffect(() => {
    if (!networked || !state || !me) return;
    if (state.ended) {
      if (trackerRef.current.queue.length > 0) {
        trackerRef.current = EMPTY_TRACKER;
        setQueueVersion((v) => v + 1);
      }
      setActiveState(false);
      return;
    }
    if (state.activePlayer !== me) return;
    setActiveState(false);
    if (state.pending !== null || trackerRef.current.queue.length === 0) return;
    const out = submitPremoves(trackerRef.current, state, me);
    if (!out) return;
    trackerRef.current = EMPTY_TRACKER;
    setQueueVersion((v) => v + 1);
    if (out.rolledBack) setRolledBack((n) => n + 1);
    if (out.actions.length > 0) submitRef.current(out.actions);
  }, [networked, state, me]);

  const fold = synced ? synced.result.fold : null;
  const view = React.useMemo(
    () => (activeState && fold && me ? viewFor(fold.branch, me) : null),
    [activeState, fold, me],
  );

  const setActive = React.useCallback((on: boolean) => setActiveState(on), []);

  const addAll = React.useCallback((actions: GameAction[]) => {
    const st = stateRef.current;
    const pid = meRef.current;
    if (!networked || !st || !pid || st.ended || st.activePlayer === pid) return;
    let t = trackerRef.current;
    let rolled = false;
    for (const action of actions) {
      const r = addPremove(t, st, pid, action);
      t = r.tracker;
      rolled = rolled || r.rolledBack;
      if (!r.added) break;
    }
    if (t !== trackerRef.current) {
      trackerRef.current = t;
      setQueueVersion((v) => v + 1);
    }
    if (rolled) setRolledBack((n) => n + 1);
  }, [networked]);

  const add = React.useCallback((action: GameAction) => addAll([action]), [addAll]);

  const clear = React.useCallback(() => {
    if (trackerRef.current.queue.length === 0) return;
    trackerRef.current = clearPremoves(trackerRef.current);
    setQueueVersion((v) => v + 1);
  }, []);

  const available =
    theirTurn && state!.pending === null && !drafting(state!) && (synced === null || fold !== null);

  return {
    available,
    active: activeState && running,
    count: premoveCount(trackerRef.current),
    view,
    rolledBack,
    setActive,
    add,
    addMany: addAll,
    clear,
  };
}
