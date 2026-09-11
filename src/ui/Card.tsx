/**
 * One card face.
 *
 * `CardView.text` arrives already rendered per viewer by the host. It is never
 * re-templated here — the whole point of Call to Chaos 12-15 and Ascendant
 * Spread is that the string the client shows can differ from the real effect.
 *
 * Variants (SB-63 layout):
 *   - `full`    the whole face; prompt panels.
 *   - `dock`    a hand card in the dock: ~120px, 3-line clamped text, nothing
 *               the hover preview can say for it (typeline, keywords, rarity).
 *   - `mini`    a shop pile tile: art with the pile's chips over it, 2-line name.
 *   - `chip`    one line in the in-play strip or the graveyard list.
 *   - `preview` the hover layer's big face (12px text, big art).
 * Every variant keeps `data-testid="card"` (unless `testId` overrides it), the
 * `<img>` art and `elementRef`, which the browser suite and FLIP rely on.
 */

import React from 'react';
import type { CardView, Rarity, StatKey } from '@engine/types';
import type { AnimPreset } from './motion';
import { hidePreview, showPreview } from './preview';

export type CardVariant = 'full' | 'dock' | 'mini' | 'chip' | 'preview';

export interface CardProps {
  card: CardView;
  onClick?: (card: CardView) => void;
  selected?: boolean;
  disabled?: boolean;
  /** The old small face: no rules text. Kept for callers that still use it. */
  compact?: boolean;
  variant?: CardVariant;
  /** Overrides `data-testid="card"`; the preview layer uses this so it is never counted as a card on the table. */
  testId?: string;
  /** Drawn over the art (mini tiles: the pile's cost chip and count). */
  artOverlay?: React.ReactNode;
  /** Don't drive the hover preview from this card. */
  noPreview?: boolean;
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
  return `(${card.cost})`;
}

/**
 * How far the pointer may travel between press and release and still count as a
 * click, in CSS pixels.
 *
 * Without this the hand had a real misfire: HTML5 drag-and-drop only *starts* a
 * drag once the browser decides the gesture was a drag, and a short, slow tug
 * on a card never crosses that line. The browser then delivers a plain click —
 * so the card you were trying to slide one place left gets played instead, and
 * in this game that is an irreversible action on a card whose neighbours matter.
 * Six pixels is comfortably under every browser's own drag threshold, so a real
 * click still registers and a nudged card no longer fires.
 */
export const DRAG_SLOP_PX = 6;

/** True when a press/release pair moved far enough to have meant a drag. */
export function travelledTooFar(
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
  slop: number = DRAG_SLOP_PX,
): boolean {
  if (!from) return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx * dx + dy * dy > slop * slop;
}

export function Card(props: CardProps): JSX.Element {
  const { card, onClick, selected, disabled, compact, badge, footer } = props;
  const variant: CardVariant = props.variant ?? 'full';
  const counters = Object.entries(card.counters ?? {}).filter(([, v]) => v !== 0);
  const stats = statLine(card);
  const clickable = Boolean(onClick) && !disabled;
  const previewable = !props.noPreview && variant !== 'preview';

  // Where the pointer went down, and whether this gesture became a drag. Refs,
  // not state: both are read inside the click handler for the *same* gesture,
  // so a re-render would be a frame too late.
  const pressedAt = React.useRef<{ x: number; y: number } | null>(null);
  const wasDragged = React.useRef(false);

  // A played card unmounts under the pointer and never sees pointerleave; its
  // preview must not outlive it.
  const iid = card.iid;
  React.useEffect(
    () => () => {
      if (previewable) hidePreview(iid);
    },
    [iid, previewable],
  );

  // The slop guard exists because a drag that never crossed the browser's own
  // threshold arrives as a click. That only happens on a card you can drag, and
  // a shop pile is not one: applying it there would mean a buy that silently
  // did nothing because the pointer drifted seven pixels, with no gesture to
  // gain from it. So it is scoped to draggable cards -- today, the hand.
  const guardsDrag = props.draggable === true;

  const classes = ['card', `card-${variant}`, rarityClass(card.rarity)];
  if (compact) classes.push('card-compact');
  if (selected) classes.push('card-selected');
  if (disabled) classes.push('card-disabled');
  if (clickable) classes.push('card-clickable');
  if (card.playable) classes.push('card-playable');
  if (card.affordable) classes.push('card-affordable');
  if (props.cursor) classes.push('card-cursor');
  if (props.committed) classes.push('card-committed');
  if (props.cue) classes.push('card-cue', `card-cue-${props.cue}`);

  const showText = !compact && (variant === 'full' || variant === 'dock' || variant === 'preview');
  const art = <CardArt artKey={card.art?.key} name={card.name} />;

  let body: React.ReactNode;
  if (variant === 'chip') {
    body = (
      <>
        {art}
        <span className="card-name">{card.name}</span>
      </>
    );
  } else if (variant === 'mini') {
    body = (
      <>
        <div className="card-art-wrap">
          {art}
          {props.artOverlay}
        </div>
        <span className="card-name">{card.name}</span>
      </>
    );
  } else if (variant === 'dock') {
    body = (
      <>
        <div className="card-head">
          <span className="card-cost">{costLabel(card)}</span>
          <span className="card-name">{card.name}</span>
        </div>
        {art}
        {stats.length > 0 && <div className="card-stats">{stats.join('  ')}</div>}
        {showText && card.text && <div className="card-text">{card.text}</div>}
        {counters.length > 0 && (
          <div className="card-counters">
            {counters.map(([k, v]) => (
              <span key={k} className="counter-chip" title={k}>
                {k} {v}
              </span>
            ))}
          </div>
        )}
      </>
    );
  } else {
    body = (
      <>
        <div className="card-head">
          <span className="card-cost">{costLabel(card)}</span>
          <span className="card-name">{card.name}</span>
        </div>
        {art}
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
        {showText && card.text && <div className="card-text">{card.text}</div>}
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
      </>
    );
  }

  // No `key` on this element. The old `key={cue}` remounted the node to restart
  // an entrance, which also threw away the FLIP registration mid-flight (MOT-3).
  return (
    <div
      ref={props.elementRef}
      className={classes.join(' ')}
      style={
        props.index === undefined
          ? undefined
          : ({ ['--i']: String(props.index) } as React.CSSProperties)
      }
      data-testid={props.testId ?? 'card'}
      data-card-id={card.defId}
      data-card-name={card.name}
      data-iid={card.iid}
      data-clickable={clickable ? 'true' : 'false'}
      data-cue={props.cue ?? undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      draggable={props.draggable}
      onPointerEnter={previewable ? (e) => showPreview(card, e.currentTarget) : undefined}
      onPointerLeave={previewable ? () => hidePreview(card.iid) : undefined}
      onPointerDown={(e) => {
        pressedAt.current = { x: e.clientX, y: e.clientY };
        wasDragged.current = false;
      }}
      onDragStart={(e) => {
        wasDragged.current = true;
        if (previewable) hidePreview(card.iid);
        props.onDragStart?.(e);
      }}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={(e) => {
        // A drag that ends outside the row fires no click, so without this the
        // flag would still be set when the *next* real click arrives and would
        // eat it -- the same one-click-lost misfire, pointing the other way.
        wasDragged.current = false;
        pressedAt.current = null;
        props.onDragEnd?.(e);
      }}
      onClick={(e) => {
        // `detail` is 0 for a click synthesised by script or by assistive tech,
        // which carries no meaningful coordinates -- those are always honoured,
        // unconditionally, so `.click()` still plays a card.
        const scripted = e.detail === 0;
        const dragged =
          !scripted &&
          guardsDrag &&
          (wasDragged.current ||
            travelledTooFar(pressedAt.current, { x: e.clientX, y: e.clientY }));
        pressedAt.current = null;
        wasDragged.current = false;
        if (dragged) return;
        if (clickable && onClick) onClick(card);
      }}
      onKeyDown={(e) => {
        if (!clickable || !onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(card);
        }
      }}
      // The hover preview replaces the native tooltip; a card that opts out of
      // the preview keeps the tooltip so its text is still reachable.
      title={previewable ? undefined : card.text}
    >
      {body}

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
