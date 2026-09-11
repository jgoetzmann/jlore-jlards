/**
 * The four shops, as sections of compact pile tiles (SB-63, LAY-3).
 *
 * Each tile is the top card in the `mini` variant — art with the cost chip and
 * the pile count drawn over it, and a two-line name — plus a small Buy button.
 * The tile and the button both buy. Rules text lives in the hover preview.
 *
 * The board lays out as wrapping flex rows at every level. Each shop asks for
 * all its piles on one line (a wrapping flex container's max-content is every
 * item in a row) and wraps only when the board is narrower than that. A grid
 * with `repeat(auto-fill, ...)` looks equivalent and isn't: it has no definite
 * width during intrinsic sizing, so each shop collapses to one tile wide.
 *
 * Render cost (RENDER-1): the tile is memoised, and `stabilizeView` hands back
 * the same PileView for a pile that didn't change, so a Copper play re-renders
 * the tiles whose affordability moved, not the whole board.
 *
 * Motion: the top card sits in a wrapper keyed and FLIP-registered by its
 * instance id. A bought card keeps its iid on the way to the graveyard, so the
 * flight from the tile to the discard falls out of that registration.
 */

import React from 'react';
import type { GameView, PileView, PileId } from '@engine/types';
import { Card } from './Card';
import { useFlipRef } from './useFlip';
import { useOneShot, usePulse } from './useMotion';

/** A pile prompt: which piles answer it, and what is picked so far. */
export interface PilePick {
  keyFor: ReadonlyMap<PileId, string>;
  picked: readonly string[];
  onToggle: (key: string) => void;
}

export interface BoardProps {
  view: GameView;
  onBuy: (pileId: PileId) => void;
  yourTurn: boolean;
  /** Set while your own prompt asks you to pick piles. */
  pilePick?: PilePick | null;
  /** A buy sent for this pile that no view has answered yet (TURN-8). */
  inFlightPile?: PileId | null;
}

const SHOP_TITLES: { key: keyof GameView['shop']; label: string }[] = [
  { key: 'resource', label: 'Resource' },
  { key: 'points', label: 'Points' },
  { key: 'prophet', label: 'Prophet' },
  { key: 'draft', label: 'Draft' },
];

export function pileCostLabel(pile: PileView): string {
  if (pile.prophetCost) return `P${pile.prophetCost.threshold} / −${pile.prophetCost.drain}`;
  if (pile.cost === null || pile.cost === undefined) return '—';
  return `(${pile.cost})`;
}

/** The short form drawn on the tile's art. */
export function pileChipLabel(pile: PileView): string {
  if (pile.prophetCost) return `P${pile.prophetCost.threshold} −${pile.prophetCost.drain}`;
  if (pile.cost === null || pile.cost === undefined) return '—';
  return String(pile.cost);
}

export function canAfford(pile: PileView, money: number, prophet: number): boolean {
  if (pile.locked) return false;
  if (pile.prophetCost) return prophet >= pile.prophetCost.threshold;
  if (pile.cost === null || pile.cost === undefined) return false;
  return money >= pile.cost;
}

/** Why a pile can't be bought right now, for the disabled Buy's tooltip (TURN-8). */
export function whyNot(
  pile: PileView,
  opts: { yourTurn: boolean; blocked: boolean; buys: number; money: number; prophet: number; inFlight?: boolean },
): string {
  if (opts.inFlight) return 'Buying…';
  if (pile.count <= 0 || pile.top === null) return 'This pile is empty';
  if (pile.locked) {
    return pile.lockedUntil !== null && pile.lockedUntil !== undefined
      ? `Locked until turn ${pile.lockedUntil}`
      : 'This pile is locked';
  }
  if (!opts.yourTurn) return 'Not your turn';
  if (opts.blocked) return 'Answer the open prompt first';
  if (pile.prophetCost) {
    return opts.prophet >= pile.prophetCost.threshold
      ? 'Buy'
      : `Needs ${pile.prophetCost.threshold} Prophet, you have ${opts.prophet}`;
  }
  if (opts.buys <= 0) return 'No Buys left';
  if (pile.cost !== null && pile.cost !== undefined && opts.money < pile.cost) {
    return `Needs ${pile.cost} Money, you have ${opts.money}`;
  }
  return 'Buy';
}

interface PileTileProps {
  pile: PileView;
  money: number;
  prophet: number;
  buys: number;
  yourTurn: boolean;
  /** A prompt is open, so the engine would reject a buy. */
  blocked: boolean;
  onBuy: (pileId: PileId) => void;
  pilePick?: PilePick | null;
  inFlight?: boolean;
}

function PileTileImpl({
  pile,
  money,
  prophet,
  buys,
  yourTurn,
  blocked,
  onBuy,
  pilePick,
  inFlight = false,
}: PileTileProps): JSX.Element {
  const empty = pile.count <= 0 || pile.top === null;
  const affordable = canAfford(pile, money, prophet);
  const buyable =
    yourTurn &&
    !blocked &&
    !inFlight &&
    !empty &&
    affordable &&
    (pile.prophetCost ? true : buys > 0) &&
    !pile.locked;

  const pickKey = pilePick?.keyFor.get(pile.id) ?? null;
  const pickIndex = pickKey !== null && pilePick ? pilePick.picked.indexOf(pickKey) : -1;

  const classes = ['pile'];
  if (pile.locked) classes.push('pile-locked');
  if (empty) classes.push('pile-empty');
  if (buyable) classes.push('pile-buyable');
  if (inFlight) classes.push('pile-inflight');
  if (pickKey !== null) classes.push('pile-prompt-target');
  if (pickIndex >= 0) classes.push('pile-prompt-picked');

  const pileId = pile.id;
  const onTileClick = React.useMemo(() => {
    if (pickKey !== null && pilePick) return () => pilePick.onToggle(pickKey);
    if (buyable) return () => onBuy(pileId);
    return undefined;
  }, [pickKey, pilePick, buyable, onBuy, pileId]);

  // The count knocks down when a card leaves; an emptied pile flashes once.
  const countRef = React.useRef<HTMLSpanElement>(null);
  const tileRef = React.useRef<HTMLDivElement>(null);
  usePulse(pile.count, countRef, pile.id, { only: 'down' });
  useOneShot(
    empty,
    tileRef,
    [{ boxShadow: '0 0 0 3px rgb(224 112 112 / 90%)' }, { boxShadow: '0 0 0 0 rgb(224 112 112 / 0%)' }],
    { duration: 600, easing: 'ease-out' },
    (v) => v === true,
  );

  const top = pile.top;
  const topRef = useFlipRef(empty || !top ? null : top.iid);

  const overlay = (
    <>
      <span className="pile-cost-chip">{pileChipLabel(pile)}</span>
      <span className="pile-count-badge" ref={countRef}>
        ×{pile.count}
      </span>
    </>
  );

  return (
    <div
      ref={tileRef}
      className={classes.join(' ')}
      data-testid="pile"
      data-pile-id={pile.id}
      data-pile-count={pile.count}
      data-buyable={buyable ? 'true' : 'false'}
    >
      {empty || !top ? (
        <div className="pile-slot-empty">
          <span className="pile-empty-label">empty</span>
          <span className="pile-empty-id">{pile.id.slice(pile.id.indexOf(':') + 1).replace(/_/g, ' ')}</span>
        </div>
      ) : (
        // Keyed by the top card: a new top is a new node, so the old one can
        // fly to the discard while this one fades in.
        <div className="pile-top" key={top.iid} ref={topRef}>
          <Card
            card={top}
            variant="mini"
            disabled={onTileClick === undefined}
            selected={pickIndex >= 0}
            artOverlay={overlay}
            onClick={onTileClick}
          />
        </div>
      )}

      <div className="pile-foot">
        {pile.locked && (
          <span className="pile-lock" title="Locked">
            🔒{pile.lockedUntil !== null && pile.lockedUntil !== undefined ? ` T${pile.lockedUntil}` : ''}
          </span>
        )}
        <button
          type="button"
          className="pile-buy"
          data-testid="buy"
          disabled={!buyable}
          aria-busy={inFlight}
          title={
            buyable
              ? `Buy for ${pileCostLabel(pile)}`
              : whyNot(pile, { yourTurn, blocked, buys, money, prophet, inFlight })
          }
          onClick={() => onBuy(pile.id)}
        >
          {inFlight ? '…' : 'Buy'}
        </button>
      </div>
    </div>
  );
}

export const PileTile = React.memo(PileTileImpl);

/** Kept under its old name for anything that imported it. */
export const PileColumn = PileTile;

function BoardImpl({ view, onBuy, yourTurn, pilePick, inFlightPile = null }: BoardProps): JSX.Element {
  const { money, prophet, buys } = view.you;
  const blocked = view.pending !== null && view.pending !== undefined;
  return (
    <div className="board" data-testid="board">
      {SHOP_TITLES.map(({ key, label }) => {
        const piles = view.shop[key] ?? [];
        return (
          <section className={`shop shop-${key}`} data-testid={`shop-${key}`} key={key}>
            <h3 className="shop-title">
              {label}
              <span className="shop-count">{piles.length}</span>
            </h3>
            <div className="shop-piles">
              {piles.length === 0 && <div className="shop-none">no piles</div>}
              {piles.map((pile) => (
                <PileTile
                  key={pile.id}
                  pile={pile}
                  money={money}
                  prophet={prophet}
                  buys={buys}
                  yourTurn={yourTurn}
                  blocked={blocked}
                  onBuy={onBuy}
                  pilePick={pilePick}
                  inFlight={inFlightPile === pile.id}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export const Board = React.memo(BoardImpl);

export default Board;
