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
 *
 * The row lives in the dock (SB-63). Cards use the `dock` variant and the row
 * is a size container, so `--n` cards share its width before it scrolls.
 * Reordering is offered only on your own turn: B20 makes an off-turn
 * `reorderHand` illegal, and a gesture the engine will refuse is worse than no
 * gesture. Off turn the cards stay at full opacity (LAY-5), just not clickable.
 *
 * The keyboard reaches the hand through `HandHandle` (MOT-12): digits play by
 * the order this row *shows*, which is the optimistic order after a drag, not
 * the host's. The cursor lives here too, so hovering a card re-renders this
 * row, not the table (MOT-6).
 *
 * Each slot is a memoised `HandSlot` with stable handlers (RENDER-1), and its
 * wrapper is the transform-free element FLIP measures and moves (MOT-4); the
 * hover lift is on the card inside it.
 */

import React from 'react';
import type { CardView, GameAction, InstanceId, PlayerId } from '@engine/types';
import { Card } from './Card';
import { digitLabel } from './keys';
import { planReorder } from './motion';
import { isInertPlay } from './turnflow';
import { FlipContext, FlipScope, prefersReducedMotion, useFlipRef } from './useFlip';
import './hand.css';

/** A hand prompt: the hand's own cards are the options. */
export interface HandPick {
  keyFor: ReadonlyMap<InstanceId, string>;
  picked: readonly string[];
  onToggle: (key: string) => void;
}

export interface HandProps {
  hand: CardView[];
  playerId: PlayerId;
  yourTurn: boolean;
  actions: number;
  onAction: (action: GameAction) => void;
  /** Set while your own prompt asks you to choose cards from this hand. */
  pick?: HandPick | null;
  /**
   * Changes whenever a view arrives (the last log seq). A launched card that is
   * still in hand once a newer view lands was refused, so it is given back.
   */
  revision?: number;
  /**
   * The turn on screen. The settle window below is scoped to it: a new turn
   * deals a whole new hand, and every card in it is an "arrival" that has
   * nothing to do with the play that set the window.
   */
  turn?: number;
}

/** What the table's keyboard can ask of the hand. Every index is a shown index. */
export interface HandHandle {
  /** Play the card at this position as shown. False if it can't be played. */
  playAt(index: number): boolean;
  /** Nudge the cursor's card left or right (your turn only). */
  nudge(delta: -1 | 1): void;
  moveCursor(delta: -1 | 1): void;
  /** Mark cards as in flight (Play money), like a click does. */
  markLaunched(iids: readonly InstanceId[]): void;
}

/**
 * How long an optimistic hand order survives without the host confirming it.
 *
 * Long enough to cover two 1s poll intervals plus the host's own turnaround,
 * short enough that a *rejected* reorder cannot leave the row lying about
 * adjacency for the rest of the turn.
 */
export const ORDER_ACK_TIMEOUT_MS = 2500;

/**
 * A fallback only: a launched card normally clears on the next view (HS-9).
 * This covers an intent the host dropped without publishing anything.
 */
export const LAUNCH_TIMEOUT_MS = 2500;

/**
 * How long a card that ARRIVED in the hand stays unclickable after a play.
 *
 * Marking the played card launched is not enough. A card whose effect adds
 * cards to your hand — Magnet, or any plain "+2 Cards" — refills the slot the
 * pointer is still sitting on, and the new card was never launched, so the
 * second click of a double-click plays it. That is a wrong-action bug: every
 * browser agrees on the result, it just is not the action the player took.
 *
 * Only arrivals are guarded, deliberately. The neighbour that *slides* into the
 * freed slot was already in the hand and on screen, and clicking one spot over
 * and over is how a player dumps Coppers. Guarding the vacated slot as well was
 * tried and reverted: it ate the second Copper of every rapid burst and failed
 * three specs that play the hand exactly that way (hotseat B5 and both SB-63
 * layout cases). A double-click there plays two cards, and that is the gesture.
 */
export const HAND_SETTLE_MS = 300;

/** Cards the hand held when the last play was sent, and how long that binds. */
export interface HandSettle {
  known: ReadonlySet<InstanceId>;
  untilMs: number;
}

/**
 * True for a card that was not in the hand when the last play was sent and is
 * still inside the settle window — i.e. it slid into the slot under the
 * pointer. Those clicks belong to the card that was there before, so they are
 * dropped rather than applied to whatever replaced it.
 */
export function isNewlyArrived(settle: HandSettle | null, iid: InstanceId, nowMs: number): boolean {
  if (settle === null) return false;
  if (nowMs >= settle.untilMs) return false;
  return !settle.known.has(iid);
}

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

/** The one-line status the dock prints above the hand. */
export function handStatus(opts: {
  yourTurn: boolean;
  picking: boolean;
  playable: number;
  actions: number;
}): string {
  if (opts.picking) return 'choose from your hand';
  if (!opts.yourTurn) return 'not your turn';
  const actionLabel = `${opts.actions} action${opts.actions === 1 ? '' : 's'}`;
  return opts.playable === 0 ? `nothing playable · ${actionLabel}` : `${opts.playable} playable · ${actionLabel}`;
}

// ---------------------------------------------------------------------------
// One slot
// ---------------------------------------------------------------------------

interface HandSlotProps {
  card: CardView;
  index: number;
  count: number;
  canReorder: boolean;
  clickable: boolean;
  inert: boolean;
  inFlight: boolean;
  picking: boolean;
  option: boolean;
  pickIndex: number;
  dragging: boolean;
  caretBefore: boolean;
  caretAfter: boolean;
  cursor: boolean;
  hint: string | null;
  onCardClick: (card: CardView) => void;
  onDragStartAt: (index: number, e: React.DragEvent, card: CardView) => void;
  onDragEnd: () => void;
  onShift: (index: number, delta: -1 | 1) => void;
  onHover: (index: number) => void;
}

const HandSlot = React.memo(function HandSlot({
  card,
  index,
  count,
  canReorder,
  clickable,
  inert,
  inFlight,
  picking,
  option,
  pickIndex,
  dragging,
  caretBefore,
  caretAfter,
  cursor,
  hint,
  onCardClick,
  onDragStartAt,
  onDragEnd,
  onShift,
  onHover,
}: HandSlotProps): JSX.Element {
  // The FLIP registration: this wrapper carries no transform of its own, so a
  // measurement never includes a hover lift.
  const flipRef = useFlipRef(card.iid);

  const classes = ['hand-slot'];
  if (caretBefore) classes.push('hand-slot-drop-before', 'hand-slot-over');
  if (caretAfter) classes.push('hand-slot-drop-after', 'hand-slot-over');
  if (dragging) classes.push('hand-slot-dragging');
  if (cursor) classes.push('hand-slot-cursor');
  if (inFlight) classes.push('hand-slot-launched');
  if (option) classes.push('hand-slot-option');

  return (
    <div
      ref={flipRef}
      className={classes.join(' ')}
      data-hand-index={index}
      onMouseEnter={() => onHover(index)}
      onFocus={() => onHover(index)}
    >
      <Card
        card={card}
        variant="dock"
        draggable={canReorder}
        index={index}
        cursor={cursor}
        committed={inFlight && !picking}
        inert={inert && !picking}
        disabled={!clickable}
        selected={pickIndex >= 0}
        badge={pickIndex >= 0 ? String(pickIndex + 1) : null}
        hint={hint}
        onClick={clickable ? onCardClick : undefined}
        onDragStart={(e) => onDragStartAt(index, e, card)}
        onDragEnd={onDragEnd}
        footer={
          canReorder ? (
            <span className="hand-nudge">
              <button
                type="button"
                className="nudge"
                title="Move this card left"
                aria-label={`Move ${card.name} left`}
                disabled={index === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onShift(index, -1);
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
                disabled={index === count - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  onShift(index, 1);
                }}
              >
                ▶
              </button>
            </span>
          ) : null
        }
      />
    </div>
  );
});

/** A callback whose identity never changes but always runs the latest closure. */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = React.useRef(fn);
  ref.current = fn;
  return React.useCallback((...args: A) => ref.current(...args), []);
}

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

const HandImpl = React.forwardRef<HandHandle, HandProps>(function Hand(
  { hand, playerId, yourTurn, onAction, pick, revision = 0, turn = 0 },
  ref,
) {
  const [localOrder, setLocalOrder] = React.useState<CardView[] | null>(null);
  const [pendingSig, setPendingSig] = React.useState<string | null>(null);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [dropPos, setDropPos] = React.useState<number | null>(null);
  // The card [ ] would nudge. Hover moves it quietly; only the arrow keys make
  // it visible, so a mouse player never sees a second highlight.
  const [cursor, setCursor] = React.useState<{ index: number; shown: boolean }>({ index: -1, shown: false });
  // Launched cards remember the view they were launched against: once a newer
  // view is showing and the card is still here, the play was refused.
  const [launch, setLaunch] = React.useState<{ iids: readonly InstanceId[]; revision: number } | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const registry = React.useContext(FlipContext);
  // Which cards the hand held when the last play was sent (MP-1). State, not a
  // ref: `clickable` is computed during render, so the window has to END with a
  // render of its own. As a ref it never got one, and a hand rendered inside
  // the window stayed unclickable until the next action — which froze the table
  // for a whole turn when the window happened to span an end of turn.
  const [settle, setSettle] = React.useState<HandSettle | null>(null);

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
  const picking = pick !== null && pick !== undefined;
  // B20: reorderHand is legal only on your own turn, and never mid-prompt.
  const canReorder = yourTurn && !picking;

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

  // The fallback for an intent that no view ever answered.
  React.useEffect(() => {
    if (launch === null) return;
    const timer = setTimeout(() => setLaunch(null), LAUNCH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [launch]);

  // The settle window closes on its own, with a render, so nothing it made
  // unclickable stays that way.
  React.useEffect(() => {
    if (settle === null) return;
    const timer = setTimeout(() => setSettle(null), HAND_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settle]);

  // A new turn deals a new hand. Every card in it is an arrival, and none of
  // them has anything to do with the play that opened the window.
  React.useEffect(() => {
    setSettle(null);
  }, [turn]);

  // The cursor follows the hand: a card played out from under it would
  // otherwise leave the highlight pointing at whatever slid into that slot.
  React.useEffect(() => {
    setCursor((c) => (c.index >= shown.length ? { ...c, index: shown.length - 1 } : c));
  }, [shown.length]);

  const launchedSet = React.useMemo(
    () => new Set(launch !== null && launch.revision === revision ? launch.iids : []),
    [launch, revision],
  );
  const isPlayable = (card: CardView): boolean =>
    yourTurn &&
    card.playable !== false &&
    !launchedSet.has(card.iid) &&
    !isNewlyArrived(settle, card.iid, Date.now());

  function commit(next: CardView[]): void {
    const sig = orderSignature(next);
    // A drop in place is not a reorder. Sending it anyway costs a relay message
    // and a log line for a gesture the player abandoned.
    if (sig === orderSignature(shown)) return;
    setLocalOrder(next);
    setPendingSig(sig);
    onAction({ type: 'reorderHand', player: playerId, hand: next.map((c) => c.iid) });
  }

  function launchCards(iids: readonly InstanceId[]): void {
    setLaunch((prev) => ({
      iids: prev !== null && prev.revision === revision ? [...prev.iids, ...iids] : [...iids],
      revision,
    }));
  }

  function play(card: CardView): void {
    // Mark it launched *before* sending. The view that takes this card out of
    // the hand may be a relay round-trip away and the click needs an answer now —
    // and the card has to stop being clickable, so an impatient second click
    // cannot land on whatever slides into its place.
    launchCards([card.iid]);
    // Freeze the slot as well as the card: anything that is not in the hand
    // right now arrived because of THIS play, and a click landing on it inside
    // the settle window was aimed at the card that just left.
    setSettle({
      known: new Set(shown.map((c) => c.iid)),
      untilMs: Date.now() + HAND_SETTLE_MS,
    });
    onAction({ type: 'play', player: playerId, iid: card.iid });
  }

  function endDrag(): void {
    dragFromRef.current = null;
    dragHandRef.current = null;
    setDragIndex(null);
    setDropPos(null);
  }

  const onCardClick = useStable((card: CardView) => {
    if (picking && pick) {
      const key = pick.keyFor.get(card.iid);
      if (key !== undefined) pick.onToggle(key);
      return;
    }
    if (isPlayable(card)) play(card);
  });

  const onDragStartAt = useStable((index: number, e: React.DragEvent, card: CardView) => {
    if (!canReorder) return;
    dragFromRef.current = index;
    dragHandRef.current = contentSignature(hand);
    setDragIndex(index);
    setDropPos(index);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', card.iid);
    } catch {
      /* some browsers refuse setData on synthetic drags */
    }
  });

  const onDragEndStable = useStable(() => endDrag());

  const onShift = useStable((index: number, delta: -1 | 1) => {
    if (!canReorder) return;
    commit(moveInOrder(shown, index, index + delta));
  });

  const onHover = useStable((index: number) => {
    setCursor((c) => (c.index === index && !c.shown ? c : { index, shown: false }));
  });

  React.useImperativeHandle(
    ref,
    () => ({
      playAt: (index: number) => latest.current.playAt(index),
      nudge: (delta: -1 | 1) => latest.current.nudge(delta),
      moveCursor: (delta: -1 | 1) => latest.current.moveCursor(delta),
      markLaunched: (iids: readonly InstanceId[]) => latest.current.launchCards(iids),
    }),
    [],
  );

  const latest = React.useRef({
    playAt: (_i: number): boolean => false,
    nudge: (_d: -1 | 1): void => undefined,
    moveCursor: (_d: -1 | 1): void => undefined,
    launchCards: (_iids: readonly InstanceId[]): void => undefined,
  });
  latest.current = {
    playAt(index) {
      const card = shown[index];
      if (!card || picking || !isPlayable(card)) return false;
      setCursor({ index, shown: false });
      play(card);
      return true;
    },
    nudge(delta) {
      if (!canReorder || cursor.index < 0) return;
      const to = cursor.index + delta;
      if (to < 0 || to >= shown.length) return;
      commit(moveInOrder(shown, cursor.index, to));
      setCursor({ index: to, shown: true });
    },
    moveCursor(delta) {
      const n = shown.length;
      if (n === 0) return;
      setCursor((c) => ({
        index: c.index < 0 ? (delta > 0 ? 0 : n - 1) : (((c.index + delta) % n) + n) % n,
        shown: true,
      }));
    },
    launchCards,
  };

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

  // Only draw the caret where the drop would actually change something.
  const caret =
    dropPos !== null && dragIndex !== null && !isNoopDrop(dragIndex, dropPos) ? dropPos : null;

  const handClasses = ['hand'];
  if (!yourTurn) handClasses.push('hand-offturn');
  if (picking) handClasses.push('hand-picking');

  const showHints = yourTurn && !picking;

  // A local reorder (drag, nudge, keyboard, or the revert when the host never
  // confirms) re-renders only this row, so it gets its own FLIP scope. A change
  // that came with a new view is the table's scope's business, not this one's.
  const orderToken = React.useMemo(() => ({ hand, shown }), [hand, shown]);

  const row = (
    <div
      className={`hand-row${dragging ? ' hand-row-dragging' : ''}`}
      data-testid="hand"
      ref={rowRef}
      style={{ ['--n']: String(Math.max(1, shown.length)) } as React.CSSProperties}
      onDragOver={canReorder ? onRowDragOver : undefined}
      onDragLeave={canReorder ? onRowDragLeave : undefined}
      onDrop={canReorder ? onRowDrop : undefined}
    >
      {shown.length === 0 && <div className="hand-empty">no cards in hand</div>}
      {shown.map((card, i) => {
        const optKey = picking ? (pick.keyFor.get(card.iid) ?? null) : null;
        const pickIndex = optKey !== null && pick ? pick.picked.indexOf(optKey) : -1;
        const inFlight = launchedSet.has(card.iid);
        const clickable = picking ? optKey !== null : isPlayable(card);
        return (
          <HandSlot
            key={card.iid}
            card={card}
            index={i}
            count={shown.length}
            canReorder={canReorder}
            clickable={clickable}
            inert={isInertPlay(card)}
            inFlight={inFlight}
            picking={picking}
            option={optKey !== null}
            pickIndex={pickIndex}
            dragging={dragIndex === i}
            caretBefore={caret === i}
            caretAfter={caret === shown.length && i === shown.length - 1}
            cursor={cursor.shown && cursor.index === i}
            hint={showHints ? digitLabel(i) : null}
            onCardClick={onCardClick}
            onDragStartAt={onDragStartAt}
            onDragEnd={onDragEndStable}
            onShift={onShift}
            onHover={onHover}
          />
        );
      })}
    </div>
  );

  return (
    <div className={handClasses.join(' ')}>
      {registry ? (
        <FlipScope
          registry={registry}
          token={orderToken}
          enabled={!prefersReducedMotion()}
          plan={(a, b) =>
            a.hand !== b.hand ? null : planReorder(a.shown.map((c) => c.iid), b.shown.map((c) => c.iid))
          }
        >
          {row}
        </FlipScope>
      ) : (
        row
      )}
    </div>
  );
});

export const Hand = React.memo(HandImpl);

export default Hand;
