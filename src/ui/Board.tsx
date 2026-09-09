/**
 * The four shops as pile columns. Each pile shows its top card, how many are
 * left, the current cost and whether it is locked.
 *
 * A pile is an ordered stack — the top card is what the next buyer gets, so it
 * is the card that gets rendered.
 */

import React from 'react';
import type { GameView, InstanceId, PileView, PileId } from '@engine/types';
import { Card, CardArt } from './Card';
import type { AnimPreset } from './motion';

export interface BoardProps {
  view: GameView;
  onBuy: (pileId: PileId) => void;
  yourTurn: boolean;
  /** Piles that lost a card in the last view. */
  drained?: ReadonlySet<PileId>;
  /** Piles that went to zero in the last view — four of these end the game. */
  emptied?: ReadonlySet<PileId>;
  cueFor?: (iid: InstanceId) => AnimPreset | 'enter' | null;
  /**
   * FLIP registration. The bought instance keeps its iid when it moves from the
   * pile to the graveyard, so registering the pile's top card here is the whole
   * reason a purchase animates: the same node is measured in both places.
   */
  flipRegister?: (key: string) => (el: HTMLElement | null) => void;
}

const SHOP_TITLES: { key: keyof GameView['shop']; label: string }[] = [
  { key: 'resource', label: 'Resource Shop' },
  { key: 'points', label: 'Points Shop' },
  { key: 'prophet', label: 'Prophet Shop' },
  { key: 'draft', label: 'Draft Shop' },
];

export function pileCostLabel(pile: PileView): string {
  if (pile.prophetCost) return `P${pile.prophetCost.threshold} / −${pile.prophetCost.drain}`;
  if (pile.cost === null || pile.cost === undefined) return '—';
  return `(${pile.cost})`;
}

export function canAfford(pile: PileView, money: number, prophet: number): boolean {
  if (pile.locked) return false;
  if (pile.prophetCost) return prophet >= pile.prophetCost.threshold;
  if (pile.cost === null || pile.cost === undefined) return false;
  return money >= pile.cost;
}

export function PileColumn({
  pile,
  money,
  prophet,
  buys,
  yourTurn,
  onBuy,
  drained,
  emptied,
  cueFor,
  flipRegister,
}: {
  pile: PileView;
  money: number;
  prophet: number;
  buys: number;
  yourTurn: boolean;
  onBuy: (pileId: PileId) => void;
  drained?: boolean;
  emptied?: boolean;
  cueFor?: (iid: InstanceId) => AnimPreset | 'enter' | null;
  flipRegister?: (key: string) => (el: HTMLElement | null) => void;
}): JSX.Element {
  const empty = pile.count <= 0 || pile.top === null;
  const affordable = canAfford(pile, money, prophet);
  const buyable =
    yourTurn && !empty && affordable && (pile.prophetCost ? true : buys > 0) && !pile.locked;

  const classes = ['pile'];
  if (pile.locked) classes.push('pile-locked');
  if (empty) classes.push('pile-empty');
  if (buyable) classes.push('pile-buyable');
  if (drained) classes.push('pile-drained');
  if (emptied) classes.push('pile-just-emptied');

  return (
    <div
      className={classes.join(' ')}
      data-testid="pile"
      data-pile-id={pile.id}
      data-pile-count={pile.count}
      data-buyable={buyable ? 'true' : 'false'}
    >
      <div className="pile-stack" data-count={pile.count}>
        {empty ? (
          <div className="pile-slot-empty">
            <CardArt name="Empty" />
            <span className="pile-empty-label">empty</span>
          </div>
        ) : (
          <Card
            card={pile.top as NonNullable<PileView['top']>}
            compact
            disabled={!buyable}
            cue={cueFor?.((pile.top as NonNullable<PileView['top']>).iid) ?? null}
            elementRef={flipRegister?.((pile.top as NonNullable<PileView['top']>).iid)}
            onClick={buyable ? () => onBuy(pile.id) : undefined}
          />
        )}
      </div>

      <div className="pile-meta">
        <span className="pile-cost">{pileCostLabel(pile)}</span>
        <span className="pile-count">×{pile.count}</span>
      </div>

      {pile.locked && (
        <div className="pile-lock">
          🔒 locked
          {pile.lockedUntil !== null && pile.lockedUntil !== undefined
            ? ` until T${pile.lockedUntil}`
            : ''}
        </div>
      )}

      <button
        type="button"
        className="pile-buy"
        data-testid="buy"
        disabled={!buyable}
        onClick={() => onBuy(pile.id)}
      >
        Buy
      </button>
    </div>
  );
}

export function Board({
  view,
  onBuy,
  yourTurn,
  drained,
  emptied,
  cueFor,
  flipRegister,
}: BoardProps): JSX.Element {
  const { money, prophet, buys } = view.you;
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
                <PileColumn
                  key={pile.id}
                  pile={pile}
                  money={money}
                  prophet={prophet}
                  buys={buys}
                  yourTurn={yourTurn}
                  onBuy={onBuy}
                  drained={drained?.has(pile.id) ?? false}
                  emptied={emptied?.has(pile.id) ?? false}
                  cueFor={cueFor}
                  flipRegister={flipRegister}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default Board;
