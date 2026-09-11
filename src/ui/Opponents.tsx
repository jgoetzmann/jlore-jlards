/**
 * The other seats at the table, as a strip across the top of the board (SB-63,
 * LAY-8).
 *
 * Each seat is one compact row, about 52px tall: avatar, name, a turn or
 * deciding badge, VP and Prophet, hand / deck / discard counts, and the last
 * thing they did on one line. Clicking a seat opens its tableau *in flow*
 * below the strip — the strip's grid row grows and pushes the board down.
 * Nothing overlays anything, so no click is ever lost to this panel.
 *
 * ## Hidden information
 *
 * Everything here comes out of `GameView.others`, which `viewFor` has already
 * stripped: `handCount` and `libraryCount` are numbers, and `play` / `gy` are
 * public zones that legitimately carry full `CardView`s. The hand fan is drawn
 * from the *count* — they are decorative backs with no identity behind them.
 *
 * The activity line reads `GameView.log`, which is scrubbed by the same filter:
 * any instance id belonging to somebody else's hand or library is rewritten to
 * `'hidden'`, and a log line naming one has its `defId` blanked too (B111).
 *
 * ## Why this file renders its own card faces
 *
 * It deliberately does not use `<Card>`: the browser suite asserts that an
 * opponent panel contains zero `[data-testid="card"]` elements, which is how it
 * proves no opponent hand is being rendered. The miniatures below carry
 * `data-testid="seat-card"` instead, so the zero-cards invariant is structural.
 * They still drive the hover preview, which lives outside this panel.
 */

import React from 'react';
import type { CardView, GameView, LogEntry, OpponentView } from '@engine/types';
import { hidePreview, showPreview } from './preview';
import './opponents.css';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Deterministic hue from a name, so a seat's colour is stable all match. */
export function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function initialsOf(name: string): string {
  const words = name.split(/[\s·_-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'the', 'to']);

/** `chain_of_being` -> `Chain of Being`, for an id we have no `CardView` of. */
function prettyDefId(defId: string): string {
  return defId
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w, i) =>
      i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
}

/** Same path Card.tsx uses. JPEG, no alpha — see the note there. */
function artUrl(key: string): string {
  return `/art/${encodeURIComponent(key)}.jpg`;
}

function costLabel(card: CardView): string | null {
  if (card.prophetCost) return `P${card.prophetCost.threshold}`;
  if (card.cost === null || card.cost === undefined) return null;
  return `(${card.cost})`;
}

function cardTitle(card: CardView): string {
  const head = [card.name, costLabel(card)].filter(Boolean).join(' ');
  const line = card.types.join(' · ');
  return [head, line, card.text].filter(Boolean).join('\n');
}

/**
 * Every card name the view already contains, keyed by defId.
 *
 * The activity line gets defIds out of the log but no names, and the naming
 * has to come from somewhere the client already has. Harvest the names off the
 * `CardView`s the view shipped anyway. A miss falls back to the prettified id,
 * which is public regardless.
 */
function nameIndex(view: GameView): Map<string, string> {
  const out = new Map<string, string>();
  const add = (cards: readonly CardView[] | undefined): void => {
    for (const c of cards ?? []) if (!out.has(c.defId)) out.set(c.defId, c.name);
  };
  const addAuras = (field: readonly { auraId: string; name: string }[]): void => {
    for (const a of field) if (!out.has(a.auraId)) out.set(a.auraId, a.name);
  };
  add(view.you.hand);
  add(view.you.play);
  add(view.you.gy);
  addAuras(view.you.field);
  for (const o of view.others) {
    add(o.play);
    add(o.gy);
    addAuras(o.field);
  }
  for (const row of [view.shop.resource, view.shop.points, view.shop.prophet, view.shop.draft]) {
    for (const pile of row) if (pile.top) add([pile.top]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The activity ticker
// ---------------------------------------------------------------------------

type BeatTone = 'play' | 'buy' | 'gain' | 'loss' | 'turn' | 'aura';

interface BeatKind {
  verb: string;
  tone: BeatTone;
  /** False for events with no card attached, like ending a turn. */
  card: boolean;
}

/** The log kinds a person sitting opposite would actually notice. */
const BEAT_KINDS: Record<string, BeatKind> = {
  play: { verb: 'plays', tone: 'play', card: true },
  playCard: { verb: 'replays', tone: 'play', card: true },
  playOnDraw: { verb: 'flips', tone: 'play', card: true },
  buy: { verb: 'buys', tone: 'buy', card: true },
  gainCard: { verb: 'gains', tone: 'gain', card: true },
  createCard: { verb: 'conjures', tone: 'gain', card: true },
  discoverGain: { verb: 'discovers', tone: 'gain', card: true },
  trash: { verb: 'trashes', tone: 'loss', card: true },
  activateAura: { verb: 'activates', tone: 'aura', card: false },
  startTurn: { verb: 'takes a turn', tone: 'turn', card: false },
  endTurn: { verb: 'ends the turn', tone: 'turn', card: false },
  extraTurn: { verb: 'takes an extra turn', tone: 'turn', card: false },
  concede: { verb: 'concedes', tone: 'loss', card: false },
};

export interface Beat {
  /** Log seq of the oldest entry in the run, which makes a stable React key. */
  seq: number;
  tone: BeatTone;
  verb: string;
  /** The card or aura acted on, already named. Null for turn events. */
  subject: string | null;
  /** Repeats of the same move collapse into one line. */
  times: number;
}

/** What the view filter leaves behind where a card you may not know used to be. */
const UNKNOWN_CARD = 'a card';

/**
 * B111 scrubs the log against where a card is *now*, not where it was when the
 * line was written. A buy carries its `pileId` too, and a pile id is not an
 * instance id, so it survives the scrub: `resource:gold` names the card the
 * shop lost. The pile it names is face up on the board in front of everybody.
 */
function pileSubject(entry: LogEntry, names: Map<string, string>): string | null {
  const pileId = entry.detail?.['pileId'];
  if (typeof pileId !== 'string') return null;
  const defId = pileId.includes(':') ? pileId.slice(pileId.indexOf(':') + 1) : pileId;
  if (!defId) return null;
  return names.get(defId) ?? prettyDefId(defId);
}

function subjectOf(entry: LogEntry, kind: BeatKind, names: Map<string, string>): string | null {
  if (!kind.card) {
    const auraId = entry.detail?.['auraId'];
    if (typeof auraId !== 'string') return null;
    return names.get(auraId) ?? prettyDefId(auraId);
  }
  const defId = entry.detail?.['defId'];
  if (typeof defId === 'string' && defId !== 'hidden') return names.get(defId) ?? prettyDefId(defId);
  return pileSubject(entry, names) ?? UNKNOWN_CARD;
}

/**
 * The last few things this player did, oldest first.
 *
 * Walks the log backwards so a long match costs the same as a short one, and
 * collapses consecutive repeats — four Coppers in a row is one line reading
 * "plays Copper ×4".
 */
export function beatsFor(
  log: readonly LogEntry[],
  playerId: string,
  names: Map<string, string>,
  limit = 3,
): Beat[] {
  const out: Beat[] = [];
  for (let i = log.length - 1; i >= 0 && out.length < limit; i--) {
    const entry = log[i];
    if (!entry || entry.player !== playerId) continue;
    const kind = BEAT_KINDS[entry.kind];
    if (!kind) continue;
    const subject = subjectOf(entry, kind, names);
    const prev = out[out.length - 1];
    if (prev && prev.verb === kind.verb && prev.subject === subject) {
      prev.times += 1;
      prev.seq = entry.seq;
      continue;
    }
    out.push({
      seq: entry.seq,
      tone: kind.tone,
      verb: kind.verb,
      subject,
      times: 1,
    });
  }
  return out.reverse();
}

function beatText(b: Beat): string {
  return [b.verb, b.subject, b.times > 1 ? `×${b.times}` : null].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Pieces of the seat
// ---------------------------------------------------------------------------

/**
 * A miniature card face. Not a `<Card>` — see the header note on why the
 * opponent panel must contain no `[data-testid="card"]` element.
 */
function SeatCard({ card, latest }: { card: CardView; latest?: boolean }): JSX.Element {
  const [failed, setFailed] = React.useState(false);
  const key = card.art?.key;
  const hue = hueOf(card.name);
  const iid = card.iid;
  React.useEffect(() => () => hidePreview(iid), [iid]);
  return (
    <div
      className={`seat-card rarity-${card.rarity}${latest ? ' seat-card-top' : ''}`}
      data-testid="seat-card"
      data-card-id={card.defId}
      data-card-name={card.name}
      aria-label={cardTitle(card)}
      onPointerEnter={(e) => showPreview(card, e.currentTarget)}
      onPointerLeave={() => hidePreview(card.iid)}
    >
      {key && !failed ? (
        <img
          className="seat-card-art"
          src={artUrl(key)}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="seat-card-art seat-card-art-blank"
          style={{
            background: `linear-gradient(150deg, hsl(${hue} 45% 28%), hsl(${(hue + 48) % 360} 40% 16%))`,
          }}
          aria-hidden="true"
        >
          {initialsOf(card.name)}
        </span>
      )}
      <span className="seat-card-name">{card.name}</span>
    </div>
  );
}

/**
 * Their hand, as it looks from across the table: a fan of backs you can count.
 * Drawn purely from `handCount`; deliberately no `data-iid` on anything.
 */
function HandFan({ count }: { count: number }): JSX.Element {
  const shown = Math.max(0, Math.min(count, 7));
  const backs: JSX.Element[] = [];
  for (let i = 0; i < shown; i++) {
    const rot = `${((i - (shown - 1) / 2) * 4).toFixed(1)}deg`;
    backs.push(<span className="seat-back" key={i} style={{ ['--rot']: rot } as React.CSSProperties} />);
  }
  return (
    <span className="seat-fan" aria-hidden="true">
      {backs}
      {count > shown && <span className="seat-fan-more">+{count - shown}</span>}
      {count === 0 && <span className="seat-fan-empty" />}
    </span>
  );
}

/** Their deck, as a stack whose thickness tracks the count. */
function DeckStack({ count }: { count: number }): JSX.Element {
  const layers = count === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(count / 6)));
  return (
    <span className="seat-deck" aria-hidden="true">
      {layers === 0 ? (
        <span className="seat-deck-empty" />
      ) : (
        Array.from({ length: layers }, (_, i) => (
          <span className="seat-deck-layer" key={i} style={{ ['--i']: String(i) } as React.CSSProperties} />
        ))
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// One seat: the compact strip row
// ---------------------------------------------------------------------------

function Seat({
  o,
  active,
  deciding,
  won,
  names,
  log,
  expanded,
  onToggle,
}: {
  o: OpponentView;
  active: boolean;
  /** They owe the table an answer to a prompt. */
  deciding: boolean;
  won: boolean;
  names: Map<string, string>;
  log: readonly LogEntry[];
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const last = beatsFor(log, o.id, names, 1)[0] ?? null;
  const hue = hueOf(o.name || o.id);

  const classes = ['opponent', 'seat', 'seat-strip'];
  if (active) classes.push('seat-active');
  if (deciding) classes.push('seat-deciding');
  if (won) classes.push('seat-won');
  if (expanded) classes.push('seat-expanded');
  if (o.eliminated) classes.push('opponent-out', 'seat-out');

  return (
    <div
      className={classes.join(' ')}
      data-testid="opponent"
      data-opponent-id={o.id}
      data-hand-count={o.handCount}
      data-library-count={o.libraryCount}
      data-discard-count={o.gy.length}
      data-play-count={o.play.length}
      data-active={active ? 'true' : 'false'}
      data-deciding={deciding ? 'true' : 'false'}
      data-eliminated={o.eliminated ? 'true' : 'false'}
      style={{ ['--seat-hue']: String(hue) } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      title={expanded ? 'Hide their table' : 'Show their table'}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span className="seat-avatar" aria-hidden="true">
        {initialsOf(o.name || o.id)}
      </span>
      <span className="seat-who">
        <span className="seat-line1">
          <span className="opponent-name seat-name">{o.name}</span>
          {active && (
            <span className="opponent-turn seat-badge">
              <span className="seat-pip" aria-hidden="true" />
              to move
            </span>
          )}
          {deciding && <span className="seat-badge seat-badge-deciding">deciding…</span>}
          {won && <span className="seat-badge seat-badge-won">winner</span>}
          {o.eliminated && <span className="opponent-elim seat-badge seat-badge-out">eliminated</span>}
        </span>
        <span className={`seat-last${last ? ` seat-beat-${last.tone}` : ''}`} data-testid="seat-last">
          {last ? beatText(last) : 'no moves yet'}
          {o.play.length > 0 && <span className="seat-last-play"> · {o.play.length} in play</span>}
        </span>
      </span>
      <span className="seat-score opponent-stats">
        <span className="seat-score-item seat-score-vp" title="victory points">
          <b>{o.vp}</b> VP
        </span>
        <span className="seat-score-item seat-score-prophet" title="banked Prophet">
          <b>{o.prophet}</b> ◈
        </span>
      </span>
      <span
        className="seat-counts"
        title={`${o.handCount} in hand · ${o.libraryCount} in deck · ${o.gy.length} in discard`}
      >
        <span>
          <b>{o.handCount}</b> hand
        </span>
        <span>
          <b>{o.libraryCount}</b> deck
        </span>
        <span>
          <b>{o.gy.length}</b> disc
        </span>
      </span>
    </div>
  );
}

/** A seat opened up: their tableau, discard, auras and recent moves. In flow. */
function SeatDetail({
  o,
  names,
  log,
}: {
  o: OpponentView;
  names: Map<string, string>;
  log: readonly LogEntry[];
}): JSX.Element {
  const beats = beatsFor(log, o.id, names);
  const topDiscard = o.gy.length > 0 ? o.gy[o.gy.length - 1] : null;
  const hue = hueOf(o.name || o.id);
  return (
    <div
      className="seat-detail"
      data-testid="seat-detail"
      data-opponent-id={o.id}
      style={{ ['--seat-hue']: String(hue) } as React.CSSProperties}
    >
      <div className="seat-detail-block seat-tableau" data-testid="seat-tableau">
        <span className="seat-tableau-head">{o.name} · in play</span>
        <div className="seat-tableau-row">
          {o.play.length === 0 && <span className="seat-detail-empty">nothing in play</span>}
          {o.play.map((c, i) => (
            <SeatCard key={c.iid} card={c} latest={i === o.play.length - 1} />
          ))}
        </div>
      </div>

      <div className="seat-detail-block seat-stacks">
        <div className="seat-stack" title={`${o.handCount} cards in hand — face down to you`}>
          <HandFan count={o.handCount} />
          <span className="seat-stack-label">
            <b>{o.handCount}</b> hand
          </span>
        </div>
        <div className="seat-stack" title={`${o.libraryCount} cards left in their deck`}>
          <DeckStack count={o.libraryCount} />
          <span className="seat-stack-label">
            <b>{o.libraryCount}</b> deck
          </span>
        </div>
        <div className="seat-stack seat-stack-discard">
          {topDiscard ? <SeatCard card={topDiscard} /> : <span className="seat-discard-empty" aria-hidden="true" />}
          <span className="seat-stack-label">
            <b>{o.gy.length}</b> discard
          </span>
        </div>
      </div>

      {o.field.length > 0 && (
        <div className="seat-detail-block seat-auras">
          {o.field.map((a) => (
            <span className={`aura-chip seat-aura aura-${a.tier}`} key={a.auraId} title={`${a.name} — ${a.text}`}>
              {a.name}
            </span>
          ))}
        </div>
      )}

      {beats.length > 0 && (
        <ul className="seat-detail-block seat-beats" data-testid="seat-beats">
          {beats.map((b) => (
            <li className={`seat-beat seat-beat-${b.tone}`} key={b.seq}>
              <span className="seat-beat-verb">{b.verb}</span>
              {b.subject && <span className="seat-beat-subject">{b.subject}</span>}
              {b.times > 1 && <span className="seat-beat-times">×{b.times}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The strip
// ---------------------------------------------------------------------------

export function Opponents({ view }: { view: GameView }): JSX.Element {
  const names = React.useMemo(() => nameIndex(view), [view]);
  const [openId, setOpenId] = React.useState<string | null>(null);

  // B23 hands the observer exactly one fact about somebody else's prompt: whose
  // it is. That gets a badge rather than being thrown away.
  const pending = view.pending;
  const waitingOn =
    pending && 'waitingOn' in pending
      ? pending.waitingOn
      : pending && 'player' in pending && pending.player !== view.you.id
        ? pending.player
        : null;
  const winners = view.winners ?? [];
  const open = openId !== null ? (view.others.find((o) => o.id === openId) ?? null) : null;

  return (
    <div className="opponents" data-testid="opponents">
      <div className="opponents-row">
        {view.others.length === 0 && <div className="seat-none">nobody else is seated</div>}
        {view.others.map((o) => (
          <Seat
            key={o.id}
            o={o}
            active={view.activePlayer === o.id}
            deciding={waitingOn === o.id}
            won={view.ended && winners.includes(o.id)}
            names={names}
            log={view.log}
            expanded={openId === o.id}
            onToggle={() => setOpenId((prev) => (prev === o.id ? null : o.id))}
          />
        ))}
      </div>
      {open && <SeatDetail o={open} names={names} log={view.log} />}
    </div>
  );
}

export default Opponents;
