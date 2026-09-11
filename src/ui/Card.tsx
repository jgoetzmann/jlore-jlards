/**
 * One card face.
 *
 * `CardView.text` arrives already rendered per viewer by the host. It is never
 * re-templated here — the whole point of Call to Chaos 12-15 and Ascendant
 * Spread is that the string the client shows can differ from the real effect.
 */

import React from 'react';
import type { CardView, Rarity, StatKey } from '@engine/types';
import type { AnimPreset } from './motion';

export interface CardProps {
  card: CardView;
  onClick?: (card: CardView) => void;
  selected?: boolean;
  disabled?: boolean;
  compact?: boolean;
  badge?: string | null;
  footer?: React.ReactNode;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  /** One-shot entrance keyframe from `useMotion`. Expires on its own. */
  cue?: AnimPreset | 'enter' | null;
  /** The card the keyboard is currently on. Independent of hover. */
  cursor?: boolean;
  /** An intent for this card is in flight and the view has not caught up yet. */
  committed?: boolean;
  /** FLIP registration — `flip.register(card.iid)`. */
  elementRef?: (el: HTMLElement | null) => void;
  /** Position in its row, for staggered entrances. */
  index?: number;
  /** Keyboard hint shown in the corner, e.g. "3". */
  hint?: string | null;
}

/**
 * JPEG, not PNG: the card frame is drawn by the client so the art never needs
 * alpha, and at 533 cards the format choice is the difference between roughly
 * 14 MB and 250 MB of committed assets.
 */
export function artUrl(key: string): string {
  return `/art/${encodeURIComponent(key)}.jpg`;
}

/** Deterministic hue from a name, so the placeholder is stable per card. */
export function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function initialsOf(name: string): string {
  const words = name.split(/[\s·]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Art slot with a generated placeholder fallback carrying the card name. */
export function CardArt({ artKey, name }: { artKey?: string; name: string }): JSX.Element {
  const [failed, setFailed] = React.useState(false);
  const hue = nameHue(name);
  if (!artKey || failed) {
    return (
      <div
        className="card-art card-art-placeholder"
        style={{
          background: `linear-gradient(150deg, hsl(${hue} 45% 26%), hsl(${(hue + 48) % 360} 40% 15%))`,
        }}
        aria-label={name}
      >
        <span className="card-art-initials">{initialsOf(name)}</span>
        <span className="card-art-name">{name}</span>
      </div>
    );
  }
  return (
    <img
      className="card-art"
      src={artUrl(artKey)}
      alt={name}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

const STAT_ORDER: StatKey[] = ['money', 'buys', 'actions', 'cards', 'vp', 'prophet'];
const STAT_LABEL: Record<StatKey, string> = {
  money: 'Money',
  buys: 'Buy',
  actions: 'Action',
  cards: 'Card',
  vp: 'VP',
  prophet: 'Prophet',
};

export function statLine(card: CardView): string[] {
  const out: string[] = [];
  for (const key of STAT_ORDER) {
    const v = card.stats[key];
    if (typeof v !== 'number' || v === 0) continue;
    const sign = v > 0 ? '+' : '';
    const label = STAT_LABEL[key];
    const plural = Math.abs(v) === 1 || key === 'money' || key === 'vp' || key === 'prophet' ? '' : 's';
    out.push(`${sign}${v} ${label}${plural}`);
  }
  return out;
}

export function rarityClass(rarity: Rarity): string {
  return `rarity-${rarity}`;
}

export function costLabel(card: CardView): string {
  if (card.prophetCost) return `P${card.prophetCost.threshold}`;
  if (card.cost === null || card.cost === undefined) return '—';
  return card.cost < 0 ? `(${card.cost})` : `(${card.cost})`;
}

export function Card(props: CardProps): JSX.Element {
  const { card, onClick, selected, disabled, compact, badge, footer } = props;
  const counters = Object.entries(card.counters ?? {}).filter(([, v]) => v !== 0);
  const stats = statLine(card);
  const clickable = Boolean(onClick) && !disabled;

  const classes = ['card', rarityClass(card.rarity)];
  if (compact) classes.push('card-compact');
  if (selected) classes.push('card-selected');
  if (disabled) classes.push('card-disabled');
  if (clickable) classes.push('card-clickable');
  if (card.playable) classes.push('card-playable');
  if (card.affordable) classes.push('card-affordable');
  if (props.cursor) classes.push('card-cursor');
  if (props.committed) classes.push('card-committed');
  if (props.cue) classes.push('card-cue', `card-cue-${props.cue}`);

  // No `key` on this element. Keying it on the cue would restart the keyframe,
  // but it would also remount the node every time a cue expired — which drops
  // the art and flickers, to fix a case that barely happens: a card that
  // arrives somewhere is a freshly mounted node already, so its entrance
  // animation runs on mount without any help.
  return (
    <div
      ref={props.elementRef}
      className={classes.join(' ')}
      style={
        props.index === undefined
          ? undefined
          : ({ ['--i']: String(props.index) } as React.CSSProperties)
      }
      data-testid="card"
      data-card-id={card.defId}
      data-card-name={card.name}
      data-iid={card.iid}
      data-clickable={clickable ? 'true' : 'false'}
      data-cue={props.cue ?? undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      draggable={props.draggable}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      onClick={() => {
        if (clickable && onClick) onClick(card);
      }}
      onKeyDown={(e) => {
        if (!clickable || !onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(card);
        }
      }}
      title={card.text}
    >
      <div className="card-head">
        <span className="card-cost">{costLabel(card)}</span>
        <span className="card-name">{card.name}</span>
      </div>

      <CardArt artKey={card.art?.key} name={card.name} />

      <div className="card-typeline">
        <span className="card-types">{card.types.join(' · ')}</span>
        {card.subtypes.length > 0 && (
          <span className="card-subtypes"> — {card.subtypes.join(' ')}</span>
        )}
        <span className={`card-rarity ${rarityClass(card.rarity)}`}>{card.rarity}</span>
      </div>

      {card.keywords.length > 0 && (
        <div className="card-keywords">
          {card.keywords.map((k) => (
            <span key={k} className="keyword-chip">
              {k}
            </span>
          ))}
        </div>
      )}

      {stats.length > 0 && <div className="card-stats">{stats.join('  ')}</div>}

      {!compact && card.text && <div className="card-text">{card.text}</div>}

      {counters.length > 0 && (
        <div className="card-counters">
          {counters.map(([k, v]) => (
            <span key={k} className="counter-chip" title={k}>
              {k} {v}
            </span>
          ))}
        </div>
      )}

      {card.prophetCost && (
        <div className="card-prophet">
          Prophet {card.prophetCost.threshold} · drain {card.prophetCost.drain}
        </div>
      )}

      {props.hint && (
        <div className="card-hint" aria-hidden="true">
          {props.hint}
        </div>
      )}

      {badge && <div className="card-badge">{badge}</div>}
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  );
}

export default Card;
