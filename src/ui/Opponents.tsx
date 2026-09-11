/**
 * The other seats at the table.
 *
 * This used to be a scoreboard row — name, then four glyphs. You could read an
 * opponent's numbers off it and still have no idea what they had just done. The
 * point of this panel is the opposite: it should read like looking across a
 * table. Their played cards are face up in front of them, their discard shows
 * its top card, their deck is a stack you can judge the thickness of, and their
 * hand is a fan of backs you can count but not read.
 *
 * ## Hidden information
 *
 * Everything here comes out of `GameView.others`, which `viewFor` has already
 * stripped: `handCount` and `libraryCount` are numbers, and `play` / `gy` are
 * public zones that legitimately carry full `CardView`s. The hand fan is drawn
 * from the *count* — they are decorative backs with no identity behind them, not
 * hidden card faces. Nothing in this file can reach a card the view did not
 * already ship.
 *
 * The activity ticker reads `GameView.log`, which is scrubbed by the same
 * filter: any instance id belonging to somebody else's hand or library is
 * rewritten to `'hidden'`, and a log line naming one has its `defId` blanked
 * too (B111). So a `defId` that survives into the log is public by construction,
 * and naming it here leaks nothing.
 *
 * ## Why this file renders its own card faces
 *
 * It deliberately does not use `<Card>`. A full card face is 132px wide and
 * does not belong in a 320px column, but the real reason is the test contract:
 * the browser suite asserts that an opponent panel contains zero
 * `[data-testid="card"]` elements, which is how it proves no opponent hand is
 * being rendered. Rendering real `<Card>`s for their *play* zone technically
 * satisfied B22 while sitting one played Copper away from failing that
 * assertion. The miniatures below carry `data-testid="seat-card"` instead, so
 * the zero-cards invariant is structural rather than lucky.
 */

import React from 'react';
import type { CardView, GameView, LogEntry, OpponentView } from '@engine/types';
import './opponents.css';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Deterministic hue from a name, so a seat's colour is stable all match. */
function hueOf(name: string): number {
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
 * The activity ticker gets defIds out of the log but no names, and the naming
 * has to come from somewhere the client already has. Rather than pulling the
 * 533-card catalog into this component, harvest the names off the `CardView`s
 * the view shipped anyway: the shop covers anything that can be bought, and the
 * play and discard zones cover anything that can be played or gained, and the
 * Field zones cover aura ids. A miss falls back to the prettified id, which is
 * public regardless.
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

/**
 * The log kinds a person sitting opposite would actually notice. The effect
 * interpreter writes far more than this; a ticker that showed all of it would
 * be the log panel again, which already exists two boxes down.
 */
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
 * line was written. So a Gold bought on turn 3 and shuffled into the deck by
 * turn 9 has its old `buy` line blanked, even though the whole table watched it
 * happen. A buy carries its `pileId` too, and a pile id is not an instance id,
 * so it survives the scrub: `resource:gold` names the card the shop lost.
 *
 * This recovers no hidden information. The pile it names is face up on the
 * board in front of everybody.
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
 * "plays Copper ×4", not four lines that push everything else out of the box.
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
  return (
    <div
      className={`seat-card rarity-${card.rarity}${latest ? ' seat-card-top' : ''}`}
      data-testid="seat-card"
      data-card-id={card.defId}
      data-card-name={card.name}
      title={cardTitle(card)}
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
 *
 * Drawn purely from `handCount`. There is no card identity behind any of these
 * elements, and deliberately no `data-iid` to be tempted into adding one.
 */
function HandFan({ count }: { count: number }): JSX.Element {
  const shown = Math.max(0, Math.min(count, 7));
  const backs: JSX.Element[] = [];
  for (let i = 0; i < shown; i++) {
    // Splayed symmetrically about the middle of however many are shown, so a
    // three-card hand does not lean off to one side.
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
// One seat
// ---------------------------------------------------------------------------

function Seat({
  o,
  active,
  deciding,
  won,
  names,
  log,
}: {
  o: OpponentView;
  active: boolean;
  /** They owe the table an answer to a prompt. You cannot see the options. */
  deciding: boolean;
  won: boolean;
  names: Map<string, string>;
  log: readonly LogEntry[];
}): JSX.Element {
  const beats = beatsFor(log, o.id, names);
  const topDiscard = o.gy.length > 0 ? o.gy[o.gy.length - 1] : null;
  const hue = hueOf(o.name || o.id);

  const classes = ['opponent', 'seat'];
  if (active) classes.push('seat-active');
  if (deciding) classes.push('seat-deciding');
  if (won) classes.push('seat-won');
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
    >
      <div className="opponent-head seat-head">
        <span className="seat-avatar" aria-hidden="true">
          {initialsOf(o.name || o.id)}
        </span>
        <span className="seat-who">
          <span className="opponent-name seat-name">{o.name}</span>
          <span className="seat-sub">
            {active && (
              <span className="opponent-turn seat-badge">
                <span className="seat-pip" aria-hidden="true" />
                to move
              </span>
            )}
            {deciding && (
              <span className="seat-badge seat-badge-deciding" title="they have a prompt open — its options were never sent to you">
                deciding…
              </span>
            )}
            {won && <span className="seat-badge seat-badge-won">winner</span>}
            {o.eliminated && <span className="opponent-elim seat-badge seat-badge-out">eliminated</span>}
            {!active && !deciding && !won && !o.eliminated && <span className="seat-waiting">waiting</span>}
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
      </div>

      {o.play.length > 0 && (
        <div className="opponent-play seat-tableau" data-testid="seat-tableau">
          <span className="seat-tableau-head">in play</span>
          <div className="seat-tableau-row">
            {o.play.map((c, i) => (
              <SeatCard key={c.iid} card={c} latest={i === o.play.length - 1} />
            ))}
          </div>
        </div>
      )}

      {beats.length > 0 && (
        <ul className="seat-beats" data-testid="seat-beats">
          {beats.map((b) => (
            <li className={`seat-beat seat-beat-${b.tone}`} key={b.seq}>
              <span className="seat-beat-verb">{b.verb}</span>
              {b.subject && <span className="seat-beat-subject">{b.subject}</span>}
              {b.times > 1 && <span className="seat-beat-times">×{b.times}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="seat-stacks">
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
        <div
          className="seat-stack seat-stack-discard"
          title={
            topDiscard
              ? `${o.gy.length} in the discard — ${topDiscard.name} on top`
              : 'their discard pile is empty'
          }
        >
          {topDiscard ? <SeatCard card={topDiscard} /> : <span className="seat-discard-empty" aria-hidden="true" />}
          <span className="seat-stack-label">
            <b>{o.gy.length}</b> discard
          </span>
        </div>
      </div>

      {o.field.length > 0 && (
        <div className="opponent-auras seat-auras">
          {o.field.map((a) => (
            <span className={`aura-chip seat-aura aura-${a.tier}`} key={a.auraId} title={`${a.name} — ${a.text}`}>
              {a.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export function Opponents({ view }: { view: GameView }): JSX.Element {
  const names = React.useMemo(() => nameIndex(view), [view]);

  // B23 hands the observer exactly one fact about somebody else's prompt: whose
  // it is. That is the right amount — at a table you can see a person is
  // thinking without seeing their cards — so it gets a badge rather than being
  // thrown away.
  const waitingOn =
    view.pending && 'waitingOn' in view.pending ? view.pending.waitingOn : null;
  const winners = view.winners ?? [];

  return (
    <div className="opponents" data-testid="opponents">
      <div className="opponents-head">
        <h3>Across the table</h3>
        <span className="opponents-count">
          {view.others.length === 1 ? '1 other' : `${view.others.length} others`}
        </span>
      </div>
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
        />
      ))}
    </div>
  );
}

export default Opponents;
