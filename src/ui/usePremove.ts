/**
 * Premoving in a room (SB-68): the React side of `src/net/premove.ts`.
 *
 * The queue and what its previews revealed live in a ref (a `PremoveTracker`);
 * React state only says "the queue changed" and "a rollback happened". Every
 * time the predicted state changes, the queue is refolded; a rollback is
 * committed from an effect. When the table reaches this seat's turn, the queue
 * goes out as one batch and premove mode switches off.
 *
 * The tracker is also written to localStorage on every change and read back
 * when this seat's match is known (PM-1). The seat comes back from its cookie
 * after a reload, so the queue and the reroll it owes come back with it.
 *
 * One tab per seat premoves (`holdPremoveLock`, a Web Lock per room, seat and
 * match). Another tab of the same seat follows the stored queue and cannot
 * change or send it; when the premoving tab closes, that tab takes the queue
 * over, reroll debt included, and sends it when the turn starts.
 *
 * In premove mode the table shows `premoveViewFor`: your next turn from the
 * branch, and the other seats as they are now, never as the branch left them.
 *
 * Networked only. Hotseat always shows the seat to move, so nobody is waiting.
 */

import React from 'react';
import type { GameAction, GameState, GameView, PlayerId } from '@engine/types';
import {
  EMPTY_TRACKER,
  addPremove,
  clearPremoves,
  committedCount,
  deserializeTracker,
  premoveCount,
  premoveStoreKey,
  premoveStorePrefix,
  premoveViewFor,
  serializeTracker,
  submitPremoves,
  syncPremoves,
  type PremoveInvalid,
  type PremoveStoreId,
  type PremoveTracker,
  type SyncResult,
} from '@net/premove';
import { discardPremoveStores, holdPremoveLock, readPremoveStore, writePremoveStore } from '@net/storage';

export interface PremoveSession {
  /** A room, someone else's turn, the game running, and a branch that builds. */
  available: boolean;
  /** Premove mode is on (the table shows your next turn when `view` is set). */
  active: boolean;
  /** Premoves queued. */
  count: number;
  /** Queued premoves Clear cannot remove, because their previews showed hidden information. */
  committed: number;
  /** Your next turn with the queue applied, or null when there is none to show. */
  view: GameView | null;
  /** Bumps on each rollback the table forced (not on Clear). */
  rolledBack: number;
  /** Bumps each time a premove was refused because it would show another player's hidden cards. */
  refused: number;
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
  /** Where this seat's premoves for this match persist. Null or absent keeps them in memory only. */
  store?: PremoveStoreId | null;
}

export function usePremove({ networked, state, me, submit, store = null }: UsePremoveOptions): PremoveSession {
  const trackerRef = React.useRef<PremoveTracker>(EMPTY_TRACKER);
  const [queueVersion, setQueueVersion] = React.useState(0);
  const [activeState, setActiveState] = React.useState(false);
  const [rolledBack, setRolledBack] = React.useState(0);
  const [refused, setRefused] = React.useState(0);

  const stateRef = React.useRef(state);
  stateRef.current = state;
  const meRef = React.useRef(me);
  meRef.current = me;
  const submitRef = React.useRef(submit);
  submitRef.current = submit;

  // PM-1: read the stored tracker as soon as the match is known, during render,
  // so the first fold and the turn-start submission below already see the debt.
  const storeKey = store ? premoveStoreKey(store) : null;
  const storePrefix = store ? premoveStorePrefix(store) : null;
  const keyRef = React.useRef<string | null>(null);
  const writtenRef = React.useRef<string | null>(null);
  if (keyRef.current !== storeKey) {
    keyRef.current = storeKey;
    const raw = storeKey ? readPremoveStore(storeKey) : null;
    trackerRef.current = storeKey ? deserializeTracker(raw, storeKey) : EMPTY_TRACKER;
    writtenRef.current = raw;
  }

  // One premoving tab per seat. With no store (no match known) this tab is alone.
  const [heldKey, setHeldKey] = React.useState<string | null>(null);
  const owner = storeKey === null || heldKey === storeKey;
  const ownerRef = React.useRef(owner);
  ownerRef.current = owner;

  /** Every tracker change goes through here, so storage always holds the latest. */
  const setTracker = React.useCallback((t: PremoveTracker) => {
    trackerRef.current = t;
    const key = keyRef.current;
    if (!key) return;
    const text = serializeTracker(t, key);
    if (text === writtenRef.current) return;
    writtenRef.current = text;
    writePremoveStore(key, text);
  }, []);

  /** Take what storage holds for `key` as the tracker, if it differs from what this tab last saw. */
  const adoptStored = React.useCallback((key: string, raw: string | null): void => {
    if (keyRef.current !== key || raw === writtenRef.current) return;
    trackerRef.current = deserializeTracker(raw, key);
    writtenRef.current = raw;
    setQueueVersion((v) => v + 1);
  }, []);

  React.useEffect(() => {
    // A different match in this room and seat (a rematch) left stale premoves.
    if (storeKey && storePrefix) discardPremoveStores(storePrefix, storeKey);
  }, [storeKey, storePrefix]);

  React.useEffect(() => {
    if (!storeKey) return undefined;
    return holdPremoveLock(storeKey, () => {
      // The tab that held the lock may have changed the queue since this one read it.
      adoptStored(storeKey, readPremoveStore(storeKey));
      setHeldKey(storeKey);
    });
  }, [storeKey, adoptStored]);

  React.useEffect(() => {
    // A tab that does not hold the lock follows what the premoving tab stores.
    if (!storeKey || owner || typeof window === 'undefined') return undefined;
    adoptStored(storeKey, readPremoveStore(storeKey));
    const onStorage = (e: StorageEvent): void => {
      if (e.key === storeKey) adoptStored(storeKey, e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storeKey, owner, adoptStored]);

  const running = networked && state !== null && me !== null && !state.ended;
  const theirTurn = running && state!.activePlayer !== me;
  const queued = trackerRef.current.queue.length > 0;
  // Folding costs an endTurn reduce per intervening seat, so skip it while
  // premoving is off and nothing is queued, and in a tab that is not premoving.
  const wantFold = owner && theirTurn && (activeState || queued);

  const synced = React.useMemo<{ base: PremoveTracker; result: SyncResult } | null>(() => {
    if (!wantFold || !state || !me) return null;
    const base = trackerRef.current;
    return { base, result: syncPremoves(base, state, me) };
    // queueVersion and storeKey: the tracker ref changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantFold, state, me, queueVersion, storeKey]);

  React.useEffect(() => {
    if (!synced || !ownerRef.current) return;
    // Only if nothing replaced the tracker since this fold was computed.
    if (trackerRef.current !== synced.base) return;
    setTracker(synced.result.tracker);
    if (synced.result.rolledBack) {
      setRolledBack((n) => n + 1);
      setQueueVersion((v) => v + 1);
    }
  }, [synced, setTracker]);

  // Your turn: send the queue as one batch, once there is no prompt in the way.
  React.useEffect(() => {
    if (!networked || !state || !me || !owner) return;
    if (state.ended) {
      if (trackerRef.current.queue.length > 0) {
        setTracker(EMPTY_TRACKER);
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
    setTracker(EMPTY_TRACKER);
    setQueueVersion((v) => v + 1);
    if (out.rolledBack) setRolledBack((n) => n + 1);
    if (out.actions.length > 0) submitRef.current(out.actions);
  }, [networked, state, me, storeKey, setTracker, owner]);

  const fold = synced ? synced.result.fold : null;
  const view = React.useMemo(
    () => (activeState && fold && me && state ? premoveViewFor(state, fold, me) : null),
    [activeState, fold, me, state],
  );

  const setActive = React.useCallback((on: boolean) => setActiveState(on), []);

  const addAll = React.useCallback((actions: GameAction[]) => {
    const st = stateRef.current;
    const pid = meRef.current;
    if (!networked || !ownerRef.current || !st || !pid || st.ended || st.activePlayer === pid) return;
    let t = trackerRef.current;
    let rolled = false;
    let refusal: PremoveInvalid | null = null;
    for (const action of actions) {
      const r = addPremove(t, st, pid, action);
      t = r.tracker;
      rolled = rolled || r.rolledBack;
      if (!r.added) {
        refusal = r.refusal;
        break;
      }
    }
    if (t !== trackerRef.current) {
      setTracker(t);
      setQueueVersion((v) => v + 1);
    }
    if (rolled) setRolledBack((n) => n + 1);
    if (refusal === 'opponent') setRefused((n) => n + 1);
  }, [networked, setTracker]);

  const add = React.useCallback((action: GameAction) => addAll([action]), [addAll]);

  const clear = React.useCallback(() => {
    if (!ownerRef.current) return;
    const next = clearPremoves(trackerRef.current);
    if (next === trackerRef.current) return;
    setTracker(next);
    setQueueVersion((v) => v + 1);
  }, [setTracker]);

  const available =
    owner && theirTurn && state!.pending === null && state!.draft == null && (synced === null || fold !== null);

  return {
    available,
    active: activeState && running,
    count: premoveCount(trackerRef.current),
    committed: committedCount(trackerRef.current),
    view,
    rolledBack,
    refused,
    setActive,
    add,
    addMany: addAll,
    clear,
  };
}
