/**
 * Hand order is real and adjacency matters — Loaf of Bread, Brownie and Feel
 * so Clean all read their neighbours. So the hand is an ordered row, drag to
 * reorder, and every reorder emits a `reorderHand` action so the engine's copy
 * of the order matches what the player sees.
 */

import React from 'react';
import type { CardView, GameAction, InstanceId, PlayerId } from '@engine/types';
import { Card } from './Card';

export interface HandProps {
  hand: CardView[];
  playerId: PlayerId;
  yourTurn: boolean;
  actions: number;
  onAction: (action: GameAction) => void;
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

export function Hand({ hand, playerId, yourTurn, actions, onAction }: HandProps): JSX.Element {
  const [order, setOrder] = React.useState<CardView[]>(hand);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [overIndex, setOverIndex] = React.useState<number | null>(null);

  // The host is authoritative about hand contents; local order state only
  // survives while the same set of instance ids is in hand.
  const signature = hand.map((c) => c.iid).join('|');
  const localSignature = order.map((c) => c.iid).join('|');
  React.useEffect(() => {
    const sameSet =
      hand.length === order.length &&
      hand.every((c) => order.some((o) => o.iid === c.iid));
    if (!sameSet) setOrder(hand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const shown = order.length === hand.length && localSignature.length > 0 ? order : hand;

  function commit(next: CardView[]): void {
    setOrder(next);
    const iids: InstanceId[] = next.map((c) => c.iid);
    onAction({ type: 'reorderHand', player: playerId, hand: iids });
  }

  function play(card: CardView): void {
    onAction({ type: 'play', player: playerId, iid: card.iid });
  }

  function shift(index: number, delta: number): void {
    const next = moveInOrder(shown, index, index + delta);
    commit(next);
  }

  return (
    <div className="hand">
      <div className="hand-head">
        <h3>Hand</h3>
        <span className="hand-count">{shown.length} cards</span>
        <span className="hand-hint">drag to reorder — adjacency matters</span>
      </div>

      <div className="hand-row">
        {shown.length === 0 && <div className="hand-empty">no cards in hand</div>}
        {shown.map((card, i) => {
          const playable = yourTurn && card.playable !== false && actions >= 0;
          return (
            <div
              className={`hand-slot${overIndex === i ? ' hand-slot-over' : ''}${
                dragIndex === i ? ' hand-slot-dragging' : ''
              }`}
              key={card.iid}
            >
              <Card
                card={card}
                draggable
                disabled={!playable}
                onClick={playable ? play : undefined}
                onDragStart={(e) => {
                  setDragIndex(i);
                  e.dataTransfer.effectAllowed = 'move';
                  try {
                    e.dataTransfer.setData('text/plain', card.iid);
                  } catch {
                    /* some browsers refuse setData on synthetic drags */
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (overIndex !== i) setOverIndex(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverIndex(null);
                  if (dragIndex === null || dragIndex === i) return;
                  commit(moveInOrder(shown, dragIndex, i));
                  setDragIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                footer={
                  <span className="hand-nudge">
                    <button
                      type="button"
                      className="nudge"
                      disabled={i === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        shift(i, -1);
                      }}
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      className="nudge"
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
