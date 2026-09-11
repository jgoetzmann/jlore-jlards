/**
 * The log, in English.
 *
 * The engine writes `{kind:'buy', detail:{iid, defId, pileId, cost}}` because
 * that is what a replay needs. The table needs "Jack bought Temple Marketplace
 * for 6", and the gap between those two was the log being unreadable at speed —
 * which matters here because the log is the *only* record of what an opponent
 * did on a turn you were not watching.
 *
 * Card names come from a resolver the caller injects rather than the registry,
 * so this module stays pure and node-testable and does not pull the 533-card
 * catalog into a test that only wants a sentence.
 *
 * On hidden information: `viewFor` already rewrites `defId` to the string
 * `'hidden'` for any card in a library or another player's hand (B111), so
 * naming a defId here cannot leak anything the view did not already ship.
 */

import type { LogEntry } from '@engine/types';

export type LogTone = 'play' | 'buy' | 'gain' | 'loss' | 'turn' | 'system' | 'reject';

export interface LogLine {
  seq: number;
  turn: number;
  tone: LogTone;
  /** Who acted, already resolved to a display name. Null for table-level events. */
  who: string | null;
  text: string;
}

export interface LogNaming {
  player(id: string): string;
  card(defId: string): string;
}

export const HIDDEN_CARD = 'a hidden card';

/**
 * Why the game ended, as a sentence.
 *
 * `state.endReason` is an engine identifier (`jlorePileEmpty`), and the
 * game-over panel printed it verbatim. Unknown reasons fall back to the raw id
 * spaced out, so a new end condition reads badly rather than not at all.
 */
export function endReasonText(reason: string | null | undefined): string {
  switch (reason) {
    case 'jlorePileEmpty':
    case 'jloreEmpty':
      return 'the Jlore pile ran out';
    case 'emptyPiles':
    case 'pilesEmpty':
      return 'enough Draft piles were emptied';
    case 'hardEndTurn':
      return 'the turn limit was reached';
    case 'countdown':
      return 'the countdown ran out';
    case 'duel':
      return 'someone pulled far enough ahead';
    case 'crown':
      return 'someone reached the target score';
    case 'deathsDoor':
      return 'Death’s Door closed';
    case 'doomsday':
    case 'doomsdayClock':
      return 'the Doomsday counter ran out';
    case 'battleRoyale':
    case 'lastPlayerStanding':
      return 'only one player was left standing';
    case 'aimForTheMoon':
      return 'someone reached 20 VP';
    case 'heavyIsTheCrown':
      return 'someone led by 10 VP';
    case 'concession':
      return 'everyone else conceded';
    case 'cardEffect':
      return 'a card ended it';
    default:
      if (!reason) return 'the game ended';
      return reason.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  }
}

function str(detail: Record<string, unknown>, key: string): string | null {
  const v = detail?.[key];
  return typeof v === 'string' ? v : null;
}

function num(detail: Record<string, unknown>, key: string): number | null {
  const v = detail?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function cardName(detail: Record<string, unknown>, naming: LogNaming, key = 'defId'): string {
  const defId = str(detail, key);
  if (!defId) return 'a card';
  if (defId === 'hidden') return HIDDEN_CARD;
  return naming.card(defId);
}

function count(n: number | null, one: string, many = `${one}s`): string {
  if (n === null) return `some ${many}`;
  return `${n} ${Math.abs(n) === 1 ? one : many}`;
}

/** Falls back to the raw shape rather than dropping an entry we do not know. */
function fallback(entry: LogEntry): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(entry.detail ?? {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      parts.push(`${key}=${Array.isArray(value) ? `[${value.length}]` : '{…}'}`);
      continue;
    }
    parts.push(`${key}=${String(value)}`);
  }
  return parts.length ? `${entry.kind} — ${parts.join(' ')}` : entry.kind;
}

const TONES: Record<string, LogTone> = {
  play: 'play',
  playCard: 'play',
  playOnDraw: 'play',
  buy: 'buy',
  gainCard: 'gain',
  createCard: 'gain',
  discoverGain: 'gain',
  discoverPicked: 'gain',
  draw: 'gain',
  trash: 'loss',
  trashPile: 'loss',
  discard: 'loss',
  discardDownTo: 'loss',
  mill: 'loss',
  startTurn: 'turn',
  endTurn: 'turn',
  extraTurn: 'turn',
  reject: 'reject',
  engineError: 'reject',
  effectError: 'reject',
  shopError: 'reject',
  anomalyError: 'reject',
  fizzle: 'reject',
  promptFizzle: 'reject',
  replayCycleBlocked: 'reject',
  trashBlocked: 'reject',
};

/**
 * One log entry as a sentence.
 *
 * Unknown kinds are not an error — the effect interpreter logs ~60 op names and
 * this covers the ones a player would look for. Anything else prints its raw
 * shape, which is still better than nothing and keeps replays debuggable.
 */
export function describeEntry(entry: LogEntry, naming: LogNaming): LogLine {
  const d = (entry.detail ?? {}) as Record<string, unknown>;
  const who = entry.player ? naming.player(entry.player) : null;
  const tone: LogTone = TONES[entry.kind] ?? 'system';

  const line = (text: string): LogLine => ({
    seq: entry.seq,
    turn: entry.turn,
    tone,
    who,
    text,
  });

  switch (entry.kind) {
    case 'matchStart':
      return line('the match begins');
    case 'anomaly':
      return line(`anomaly: ${str(d, 'anomalyId') ?? 'unknown'}`);
    case 'shopBuilt':
      return line(`the shop is dealt — ${count(num(d, 'piles'), 'pile')}`);

    case 'startTurn': {
      const t = num(d, 'turn');
      return line(t === null ? 'starts a turn' : `starts turn ${t}`);
    }
    case 'endTurn':
      return line('ends the turn');
    case 'extraTurn':
      return line('takes an extra turn');

    case 'play':
      return line(`plays ${cardName(d, naming)}`);
    case 'playCard':
      return line(`replays ${cardName(d, naming)}`);
    case 'playOnDraw':
      return line(`${cardName(d, naming)} resolves as it is drawn`);
    case 'playCleanup':
      return line('clears the play area');

    case 'buy': {
      const cost = num(d, 'cost');
      const name = cardName(d, naming);
      return line(cost === null ? `buys ${name}` : `buys ${name} for ${cost}`);
    }
    case 'gainCard':
    case 'createCard':
      return line(`gains ${cardName(d, naming)}`);
    case 'discoverOffered':
      return line(`is offered ${count(num(d, 'count'), 'card')} to Discover`);
    case 'discoverPicked':
    case 'discoverGain':
      return line(`Discovers ${cardName(d, naming)}`);

    case 'draw':
      return line(`draws ${count(num(d, 'drawn') ?? num(d, 'amount'), 'card')}`);
    case 'mill':
      return line(`mills ${count(num(d, 'milled') ?? num(d, 'amount'), 'card')}`);
    case 'discard':
      return line(
        str(d, 'then') === 'trashedTemporary'
          ? `discards ${cardName(d, naming)} — Temporary, so it is trashed`
          : `discards ${cardName(d, naming)}`,
      );
    case 'trash':
      return line(`trashes ${cardName(d, naming)}`);
    case 'trashBlocked':
      return line(`cannot trash ${cardName(d, naming)} — Indestructible`);

    case 'shuffle':
      return line(
        `shuffles ${count(num(d, 'shuffled'), 'card')} back${
          num(d, 'heldAside') ? `, holding ${num(d, 'heldAside')} played this turn aside` : ''
        }`,
      );

    case 'gain': {
      const stat = str(d, 'stat') ?? 'something';
      const amount = num(d, 'amount');
      if (amount === null) return line(`gains ${stat}`);
      return line(`${amount < 0 ? '' : '+'}${amount} ${stat}`);
    }

    case 'activateAura':
      return line(`activates ${str(d, 'auraId') ?? 'an aura'}`);
    case 'auraExpired':
      return line(`${str(d, 'auraId') ?? 'an aura'} expires`);
    case 'manifestAura':
      return line(`manifests ${str(d, 'auraId') ?? 'an aura'}`);

    case 'lockPile':
      return line(`locks ${str(d, 'pileId') ?? 'a pile'}`);
    case 'unlock':
    case 'unlockPile':
      return line(`unlocks ${str(d, 'pileId') ?? 'a pile'}`);
    case 'pileEmpty':
      return line(`${str(d, 'pileId') ?? 'a pile'} is empty`);
    case 'pileReplenished':
      return line(`${str(d, 'pileId') ?? 'a pile'} is replenished`);

    case 'plague':
      return line(`adds ${count(num(d, 'amount'), 'Plague token')}`);
    case 'incDoomsday':
      return line(`the Doomsday counter is now ${num(d, 'counter') ?? num(d, 'amount') ?? '?'}`);

    case 'chosen':
      return line(`chooses ${str(d, 'label') ?? str(d, 'key') ?? 'an option'}`);
    case 'resolve':
      return line(`answers the ${str(d, 'type') ?? ''} prompt`.replace('  ', ' '));

    case 'endTriggered':
      return line('empties the pile that ends the game — everyone gets one more turn');
    case 'gameEnd':
      return line(`the game ends — ${endReasonText(str(d, 'reason'))}`);

    case 'buff':
    case 'nerf': {
      const stat = str(d, 'stat') ?? 'a stat';
      const delta = num(d, 'delta');
      const n = num(d, 'affected');
      const who = n === null || n === 1 ? 'a card' : `${n} cards`;
      const sign = delta === null ? '' : delta < 0 ? `${delta}` : `+${delta}`;
      return line(
        entry.kind === 'buff'
          ? `buffs ${who}: ${sign} ${stat}`
          : `nerfs ${who}: ${sign} ${stat}`,
      );
    }
    case 'concede':
      return line('concedes');

    case 'reject':
      return line(`refused: ${str(d, 'reason') ?? 'illegal action'}`);
    case 'fizzle':
    case 'promptFizzle':
      return line(`an effect fizzled — ${str(d, 'reason') ?? 'budget or depth reached'}`);
    case 'replayCycleBlocked':
      return line('a replay loop was cut short');

    default:
      return line(fallback(entry));
  }
}

/** Newest first, because the interesting entry is always the one that just happened. */
export function describeLog(
  log: readonly LogEntry[],
  naming: LogNaming,
  limit = 120,
): LogLine[] {
  return log
    .slice(-limit)
    .map((e) => describeEntry(e, naming))
    .reverse();
}
