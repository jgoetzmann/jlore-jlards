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
 */

import React from 'react';
import type { GameView, InstanceId, PileView, PileId } from '@engine/types';
import { Card } from './Card';
import type { AnimPreset } from './motion';

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
  /** Set while your own prompt asks you to pick piles. */
  pilePick?: PilePick | null;
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

/** Why a pile can't be bought right now, for the disabled Buy's tooltip. */
function whyNot(pile: PileView, opts: { yourTurn: boolean; blocked: boolean; buys: number; affordable: boolean }): string {
  if (pile.count <= 0 || pile.top === null) return 'This pile is empty';
  if (pile.locked) return 'This pile is locked';
  if (!opts.yourTurn) return 'Not your turn';
  if (opts.blocked) return 'Answer the open prompt first';
  if (!pile.prophetCost && opts.buys <= 0) return 'No Buys left';
  if (!opts.affordable) return pile.prophetCost ? 'Not enough Prophet' : 'Not enough Money';
  return 'Buy';
}

export function PileTile({
  pile,
  money,
  prophet,
  buys,
  yourTurn,
  blocked,
  onBuy,
  drained,
  emptied,
  cueFor,
  flipRegister,
  pilePick,
}: {
  pile: PileView;
  money: number;
  prophet: number;
  buys: number;
  yourTurn: boolean;
  /** A prompt is open, so the engine would reject a buy. */
  blocked: boolean;
  onBuy: (pileId: PileId) => void;
  drained?: boolean;
  emptied?: boolean;
  cueFor?: (iid: InstanceId) => AnimPreset | 'enter' | null;
  flipRegister?: (key: string) => (el: HTMLElement | null) => void;
  pilePick?: PilePick | null;
}): JSX.Element {
  const empty = pile.count <= 0 || pile.top === null;
  const affordable = canAfford(pile, money, prophet);
  const buyable =
    yourTurn &&
    !blocked &&
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
  if (drained) classes.push('pile-drained');
  if (emptied) classes.push('pile-just-emptied');
  if (pickKey !== null) classes.push('pile-prompt-target');
  if (pickIndex >= 0) classes.push('pile-prompt-picked');

  const onTileClick =
    pickKey !== null && pilePick
      ? () => pilePick.onToggle(pickKey)
      : buyable
        ? () => onBuy(pile.id)
        : undefined;

  const overlay = (
    <>
      <span className="pile-cost-chip">{pileChipLabel(pile)}</span>
      <span className="pile-count-badge">×{pile.count}</span>
    </>
  );

  return (
    <div
      className={classes.join(' ')}
      data-testid="pile"
      data-pile-id={pile.id}
      data-pile-count={pile.count}
      data-buyable={buyable ? 'true' : 'false'}
    >
      {empty ? (
        <div className="pile-slot-empty">
          <span className="pile-empty-label">empty</span>
          <span className="pile-empty-id">{pile.id.slice(pile.id.indexOf(':') + 1).replace(/_/g, ' ')}</span>
        </div>
      ) : (
        <Card
          card={pile.top as NonNullable<PileView['top']>}
          variant="mini"
          disabled={onTileClick === undefined}
          selected={pickIndex >= 0}
          artOverlay={overlay}
          cue={cueFor?.((pile.top as NonNullable<PileView['top']>).iid) ?? null}
          elementRef={flipRegister?.((pile.top as NonNullable<PileView['top']>).iid)}
          onClick={onTileClick}
        />
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
          title={buyable ? `Buy for ${pileCostLabel(pile)}` : whyNot(pile, { yourTurn, blocked, buys, affordable })}
          onClick={() => onBuy(pile.id)}
        >
          Buy
        </button>
      </div>
    </div>
  );
}

/** Kept under its old name for anything that imported it. */
export const PileColumn = PileTile;

export function Board({
  view,
  onBuy,
  yourTurn,
  drained,
  emptied,
  cueFor,
  flipRegister,
  pilePick,
}: BoardProps): JSX.Element {
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
                  drained={drained?.has(pile.id) ?? false}
                  emptied={emptied?.has(pile.id) ?? false}
                  cueFor={cueFor}
                  flipRegister={flipRegister}
                  pilePick={pilePick}
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
