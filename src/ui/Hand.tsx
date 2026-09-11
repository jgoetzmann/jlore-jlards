/**
 * Hand order is real and adjacency matters — Loaf of Bread, Brownie and Feel
 * so Clean all read their neighbours. So the hand is an ordered row, drag to
 * reorder, and every reorder emits a `reorderHand` action so the engine's copy
 * of the order matches what the player sees.
 *
 * Two gestures share this row and they must never be mistaken for each other:
 * a click plays a card (irreversible), a drag moves it (free). Most of what is
 * below — the slop guard in `Card`, the acknowledgement window, the launched
 * set — exists to keep that line sharp across a relay that can take a second
 * to answer.
 */

import React from 'react';
import type { CardView, GameAction, InstanceId, PlayerId } from '@engine/types';
import { Card } from './Card';
import type { AnimPreset } from './motion';
import './hand.css';

export interface HandProps {
  hand: CardView[];
  playerId: PlayerId;
  yourTurn: boolean;
  actions: number;
  onAction: (action: GameAction) => void;
  /** Index the keyboard is on, or -1. Owned by the table so one key map drives everything. */
  cursorIndex?: number;
  onCursorChange?: (index: number) => void;
  cueFor?: (iid: InstanceId) => AnimPreset | 'enter' | null;
  /** FLIP registration, shared with the rest of the table. */
  flipRegister?: (key: string) => (el: HTMLElement | null) => void;
  /** Cards whose intent is in flight and not yet reflected in a view. */
  committed?: ReadonlySet<InstanceId>;
}

/**
 * How long an optimistic hand order survives without the host confirming it.
 *
 * Long enough to cover two 1s poll intervals plus the host's own turnaround,
 * short enough that a *rejected* reorder cannot leave the row lying about
 * adjacency for the rest of the turn.
 */
export const ORDER_ACK_TIMEOUT_MS = 2500;

/** How long a played card stays visibly launched before the row gives up on it. */
export const LAUNCH_TIMEOUT_MS = 2500;

/** Move the item at `from` to index `to`, keeping everything else in order. */
export function moveInOrder<T>(items: readonly T[], from: number, to: number): T[] {
  const out = items.slice();
  if (from < 0 || from >= out.length) return out;
  const clampedTo = Math.max(0, Math.min(out.length - 1, to));
  const [moved] = out.splice(from, 1);
  out.splice(clampedTo, 0, moved);
  return out;
}

/** Order-sensitive identity of a hand. Same signature, same row. */
export function orderSignature(cards: readonly CardView[]): string {
  return cards.map((c) => c.iid).join('|');
}

/** Order-*insensitive* identity: which cards are held, ignoring arrangement. */
export function contentSignature(cards: readonly CardView[]): string {
  return cards
    .map((c) => c.iid)
    .slice()
    .sort()
    .join('|');
}

/**
 * Which gap the pointer is in, given the horizontal midpoint of every slot.
 *
 * Returns an *insertion* index in `0..mids.length`: 0 is before the first card,
 * `mids.length` is past the last one. Working in gaps rather than "the card I
 * am hovering over" is what makes both ends of the row reachable and what makes
 * a drop land exactly where the caret was drawn.
 */
export function insertionIndexFromX(x: number, mids: readonly number[]): number {
  let pos = 0;
  while (pos < mids.length && x > mids[pos]) pos += 1;
  return pos;
}

/**
 * The `moveInOrder` destination for dropping the card at `from` into gap `pos`.
 *
 * Lifting the dragged card out first shifts every gap to its right down by one.
 */
export function targetIndexFor(from: number, pos: number): number {
  return pos > from ? pos - 1 : pos;
}

/** A drop that would put the card back exactly where it already is. */
export function isNoopDrop(from: number, pos: number): boolean {
  return pos === from || pos === from + 1;
}

export interface ReconciledOrder {
  /** The optimistic order to keep rendering, or null to render the host's. */
  order: CardView[] | null;
  /** The signature still waiting on the host, or null. */
  pending: string | null;
}

/**
 * Decide whether the locally reordered row still stands.
 *
 * The host is authoritative about hand *order*, not just hand contents, and a
 * row that merely *looks* reordered is a wrong-card bug — Loaf of Bread would
 * play the wrong two neighbours. But snapping back to the host's order the
 * instant the gesture ends is just as wrong: the `reorderHand` action has not
 * reached the host yet, so the card jumps home and then jumps back a poll
 * interval later. That reads as "the drag failed" and invites a second drag.
 *
 * So the optimistic order is held until one of three things settles it:
 *   - the host echoes exactly the order we asked for  → accepted, drop it;
 *   - the hand's *contents* change (a draw, a play)   → stale, drop it;
 *   - nothing happens for ORDER_ACK_TIMEOUT_MS        → assume rejected (caller).
 */
export function reconcileOrder(
  incoming: readonly CardView[],
  local: CardView[] | null,
  pending: string | null,
): ReconciledOrder {
  if (!local) return { order: null, pending: null };
  if (contentSignature(incoming) !== contentSignature(local)) return { order: null, pending: null };
  if (pending !== null && orderSignature(incoming) === pending) return { order: null, pending: null };
  return { order: local, pending };
}

/** Horizontal midpoint of every hand slot, in client coordinates. */
function slotMidpoints(row: HTMLElement | null): number[] {
  if (!row) return [];
  const out: number[] = [];
  for (const el of Array.from(row.querySelectorAll<HTMLElement>('[data-hand-index]'))) {
    const r = el.getBoundingClientRect();
    out.push(r.left + r.width / 2);
  }
  return out;
}

export function Hand({
  hand,
  playerId,
  yourTurn,
  actions,
  onAction,
  cursorIndex = -1,
  onCursorChange,
  cueFor,
  flipRegister,
  committed,
}: HandProps): JSX.Element {
  const [localOrder, setLocalOrder] = React.useState<CardView[] | null>(null);
  const [pendingSig, setPendingSig] = React.useState<string | null>(null);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [dropPos, setDropPos] = React.useState<number | null>(null);
  const [launched, setLaunched] = React.useState<readonly InstanceId[]>([]);
  const rowRef = React.useRef<HTMLDivElement | null>(null);

  // `dragstart` sets state, but the first `dragover` can arrive before React
  // has re-rendered with it, and a dragover that does not `preventDefault` is a
  // gap where the browser refuses the drop. The row's handlers read the ref, so
  // the very first event of a drag is already handled.
  const dragFromRef = React.useRef<number | null>(null);

  // Which cards were in the hand when the drag started. A drag lasts about a
  // second and the host can change the hand inside it — an opponent's discard
  // attack, a turn ending on the timer — after which the index being dragged
  // names a different card. The drop is refused rather than guessed at.
  const dragHandRef = React.useRef<string | null>(null);

  const dragging = dragIndex !== null;
  const handSig = orderSignature(hand);

  // While a drag is in flight the row must not rearrange under the pointer: the
  // geometry the caret is computed from would stop describing what is on screen.
  const reconciled = dragging
    ? { order: localOrder, pending: pendingSig }
    : reconcileOrder(hand, localOrder, pendingSig);
  const shown = reconciled.order ?? hand;
  const settled = reconciled.order === null && localOrder !== null;

  React.useEffect(() => {
    if (!settled) return;
    setLocalOrder(null);
    setPendingSig(null);
  }, [settled]);

  // The host never answered. Whatever it thinks the order is, is the order.
  React.useEffect(() => {
    if (pendingSig === null) return;
    const timer = setTimeout(() => {
      setLocalOrder(null);
      setPendingSig(null);
    }, ORDER_ACK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingSig]);

  // A launched card that left the hand was played; stop tracking it.
  React.useEffect(() => {
    setLaunched((prev) => {
      const next = prev.filter((iid) => hand.some((c) => c.iid === iid));
      return next.length === prev.length ? prev : next;
    });
  }, [handSig, hand]);

  // If the hand changes mid-drag the card being dragged may have been unmounted
  // with it, and an unmounted source never delivers its `dragend` — which would
  // leave the row believing a drag was still in progress. End it here instead;
  // the drop it was heading for would have been refused anyway.
  React.useEffect(() => {
    if (dragHandRef.current === null) return;
    if (dragHandRef.current === contentSignature(hand)) return;
    endDrag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handSig, hand]);

  // ...and one that never left was refused, so give it back to the player.
  React.useEffect(() => {
    if (launched.length === 0) return;
    const timer = setTimeout(() => setLaunched([]), LAUNCH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [launched]);

  function commit(next: CardView[]): void {
    const sig = orderSignature(next);
    // A drop in place is not a reorder. Sending it anyway costs a relay message
    // and a log line for a gesture the player abandoned.
    if (sig === orderSignature(shown)) return;
    setLocalOrder(next);
    setPendingSig(sig);
    onAction({ type: 'reorderHand', player: playerId, hand: next.map((c) => c.iid) });
  }

  function play(card: CardView): void {
    // Mark it launched *before* sending. The view that takes this card out of
    // the hand is a relay round-trip away and the click needs an answer now —
    // and the card has to stop being clickable, so an impatient second click
    // cannot land on whatever slides into its place.
    setLaunched((prev) => (prev.includes(card.iid) ? prev : [...prev, card.iid]));
    onAction({ type: 'play', player: playerId, iid: card.iid });
  }

  function shift(index: number, delta: number): void {
    commit(moveInOrder(shown, index, index + delta));
  }

  function endDrag(): void {
    dragFromRef.current = null;
    dragHandRef.current = null;
    setDragIndex(null);
    setDropPos(null);
  }

  function onRowDragOver(e: React.DragEvent): void {
    // Not our drag — a file, a link, a selection from another app. Leaving it
    // un-prevented is what makes the browser refuse it instead of dropping
    // something meaningless into the hand.
    if (dragFromRef.current === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const pos = insertionIndexFromX(e.clientX, slotMidpoints(rowRef.current));
    setDropPos((prev) => (prev === pos ? prev : pos));
  }

  function onRowDragLeave(e: React.DragEvent): void {
    // dragleave also fires crossing between children of the row. Only leaving
    // the row itself clears the caret.
    const to = e.relatedTarget as Node | null;
    if (to && e.currentTarget.contains(to)) return;
    setDropPos(null);
  }

  function onRowDrop(e: React.DragEvent): void {
    const from = dragFromRef.current;
    const startedOn = dragHandRef.current;
    if (from === null) return;
    e.preventDefault();
    const pos = insertionIndexFromX(e.clientX, slotMidpoints(rowRef.current));
    endDrag();
    if (isNoopDrop(from, pos)) return;
    if (startedOn !== null && startedOn !== contentSignature(hand)) return;
    commit(moveInOrder(shown, from, targetIndexFor(from, pos)));
  }

  const launchedSet = new Set(launched);
  const isPlayable = (card: CardView): boolean =>
    yourTurn && card.playable !== false && !launchedSet.has(card.iid);
  const playableCount = shown.filter(isPlayable).length;
  const actionLabel = `${actions} action${actions === 1 ? '' : 's'}`;

  // Only draw the caret where the drop would actually change something.
  const caret =
    dropPos !== null && dragIndex !== null && !isNoopDrop(dragIndex, dropPos) ? dropPos : null;

  return (
    <div className="hand">
      <div className="hand-head">
        <h3>Hand</h3>
        <span className="hand-count">{shown.length} cards</span>
        <span
          className={`hand-status${yourTurn ? ' hand-status-yours' : ''}`}
          data-testid="hand-status"
          data-playable-count={playableCount}
        >
          {!yourTurn
            ? 'not your turn — you can still reorder'
            : playableCount === 0
              ? `nothing playable · ${actionLabel}`
              : `${playableCount} playable · ${actionLabel}`}
        </span>
        <span className="hand-hint">
          press <kbd>1</kbd>–<kbd>9</kbd> to play · <kbd>[</kbd> <kbd>]</kbd> to reorder —
          adjacency matters
        </span>
      </div>

      <div
        className={`hand-row${dragging ? ' hand-row-dragging' : ''}`}
        data-testid="hand"
        ref={rowRef}
        onDragOver={onRowDragOver}
        onDragLeave={onRowDragLeave}
        onDrop={onRowDrop}
      >
        {shown.length === 0 && <div className="hand-empty">no cards in hand</div>}
        {shown.map((card, i) => {
          const playable = isPlayable(card);
          const inFlight = launchedSet.has(card.iid) || (committed?.has(card.iid) ?? false);
          const classes = ['hand-slot'];
          if (caret === i) classes.push('hand-slot-drop-before', 'hand-slot-over');
          if (caret === shown.length && i === shown.length - 1) {
            classes.push('hand-slot-drop-after', 'hand-slot-over');
          }
          if (dragIndex === i) classes.push('hand-slot-dragging');
          if (cursorIndex === i) classes.push('hand-slot-cursor');
          if (inFlight) classes.push('hand-slot-launched');
          return (
            <div
              className={classes.join(' ')}
              data-hand-index={i}
              key={card.iid}
              onMouseEnter={() => onCursorChange?.(i)}
              onFocus={() => onCursorChange?.(i)}
            >
              <Card
                card={card}
                draggable
                index={i}
                hint={i < 9 ? String(i + 1) : i === 9 ? '0' : null}
                cursor={cursorIndex === i}
                cue={cueFor?.(card.iid) ?? null}
                committed={inFlight}
                elementRef={flipRegister?.(card.iid)}
                disabled={!playable}
                onClick={playable ? play : undefined}
                onDragStart={(e) => {
                  dragFromRef.current = i;
                  dragHandRef.current = contentSignature(hand);
                  setDragIndex(i);
                  setDropPos(i);
                  e.dataTransfer.effectAllowed = 'move';
                  try {
                    e.dataTransfer.setData('text/plain', card.iid);
                  } catch {
                    /* some browsers refuse setData on synthetic drags */
                  }
                }}
                onDragEnd={endDrag}
                footer={
                  <span className="hand-nudge">
                    <button
                      type="button"
                      className="nudge"
                      title="Move this card left"
                      aria-label={`Move ${card.name} left`}
                      disabled={i === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        shift(i, -1);
                      }}
                    >
                      ◀
                    </button>
                    <span className="hand-grip" aria-hidden="true" title="Drag to reorder">
                      ⠿
                    </span>
                    <button
                      type="button"
                      className="nudge"
                      title="Move this card right"
                      aria-label={`Move ${card.name} right`}
                      disabled={i === shown.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        shift(i, 1);
                      }}
                    >
                      ▶
                    </button>
                  </span>
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Hand;
