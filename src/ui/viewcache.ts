/**
 * Structural sharing between consecutive views (RENDER-1).
 *
 * Every view is a fresh object tree — `viewFor` builds one per action — so a
 * memoised component that compares props by identity would re-render anyway.
 * `stabilizeView(prev, next)` returns `next` with every CardView, PileView,
 * OpponentView and zone array that has not actually changed replaced by the
 * object from `prev`. React.memo on Card, the pile tile and the seat then skips
 * everything that stood still: a Copper play re-renders the hand, the strip and
 * the stats, not 21 shop tiles and a log.
 *
 * The comparison is a cheap per-object signature, not a deep equal.
 */

import type { CardView, GameView, LogEntry, OpponentView, PileView } from '@engine/types';

function statsSig(s: CardView['stats']): string {
  let out = '';
  for (const k of Object.keys(s).sort()) out += `${k}${(s as Record<string, unknown>)[k]},`;
  return out;
}

function countersSig(c: Record<string, number>): string {
  let out = '';
  for (const k of Object.keys(c).sort()) out += `${k}${c[k]},`;
  return out;
}

/** Everything a card face can show. Two cards with the same signature render the same. */
export function cardSignature(c: CardView): string {
  return [
    c.iid,
    c.defId,
    c.name,
    c.cost,
    c.prophetCost ? `${c.prophetCost.threshold}/${c.prophetCost.drain}` : '',
    c.types.join('.'),
    c.subtypes.join('.'),
    c.rarity,
    c.keywords.join('.'),
    statsSig(c.stats),
    c.text,
    countersSig(c.counters ?? {}),
    c.art ? `${c.art.key}/${c.art.anim ?? ''}` : '',
    c.playable === undefined ? '?' : c.playable ? 1 : 0,
    c.affordable === undefined ? '?' : c.affordable ? 1 : 0,
  ].join('|');
}

type CardIndex = Map<string, { sig: string; card: CardView }>;

function indexCards(index: CardIndex, cards: readonly CardView[] | undefined): void {
  for (const c of cards ?? []) index.set(c.iid, { sig: cardSignature(c), card: c });
}

function reuseCard(index: CardIndex, c: CardView): CardView {
  const hit = index.get(c.iid);
  return hit && hit.sig === cardSignature(c) ? hit.card : c;
}

/** Reuse each card, and the whole array when every element and the length match. */
function reuseZone(index: CardIndex, prev: readonly CardView[] | undefined, next: CardView[]): CardView[] {
  const out = next.map((c) => reuseCard(index, c));
  if (prev && prev.length === out.length && out.every((c, i) => c === prev[i])) return prev as CardView[];
  return out;
}

function pileSig(p: PileView): string {
  return [
    p.id,
    p.count,
    p.cost,
    p.prophetCost ? `${p.prophetCost.threshold}/${p.prophetCost.drain}` : '',
    p.locked ? 1 : 0,
    p.lockedUntil,
  ].join('|');
}

function reusePiles(index: CardIndex, prev: readonly PileView[] | undefined, next: PileView[]): PileView[] {
  const byId = new Map((prev ?? []).map((p) => [p.id, p]));
  const out = next.map((p) => {
    const top = p.top ? reuseCard(index, p.top) : null;
    const old = byId.get(p.id);
    if (old && old.top === top && pileSig(old) === pileSig(p)) return old;
    return top === p.top ? p : { ...p, top };
  });
  if (prev && prev.length === out.length && out.every((p, i) => p === prev[i])) return prev as PileView[];
  return out;
}

function opponentSig(o: OpponentView): string {
  return [
    o.id,
    o.name,
    o.handCount,
    o.libraryCount,
    o.vp,
    o.prophet,
    o.eliminated ? 1 : 0,
    o.field.map((a) => a.auraId).join('.'),
  ].join('|');
}

function reuseOpponents(index: CardIndex, prev: readonly OpponentView[] | undefined, next: OpponentView[]): OpponentView[] {
  const byId = new Map((prev ?? []).map((o) => [o.id, o]));
  const out = next.map((o) => {
    const old = byId.get(o.id);
    const play = reuseZone(index, old?.play, o.play);
    const gy = reuseZone(index, old?.gy, o.gy);
    if (old && old.play === play && old.gy === gy && opponentSig(old) === opponentSig(o)) return old;
    return { ...o, play, gy };
  });
  if (prev && prev.length === out.length && out.every((o, i) => o === prev[i])) return prev as OpponentView[];
  return out;
}

/** The log only ever appends, so equal length and equal end seqs mean equal content. */
function reuseLog(prev: readonly LogEntry[] | undefined, next: LogEntry[]): LogEntry[] {
  if (!prev || prev.length !== next.length) return next;
  if (next.length === 0) return prev as LogEntry[];
  if (prev[0]?.seq !== next[0]?.seq) return next;
  if (prev[prev.length - 1]?.seq !== next[next.length - 1]?.seq) return next;
  return prev as LogEntry[];
}

export function stabilizeView(prev: GameView | null, next: GameView): GameView {
  if (!prev || prev === next) return next;
  const index: CardIndex = new Map();
  indexCards(index, prev.you.hand);
  indexCards(index, prev.you.play);
  indexCards(index, prev.you.gy);
  for (const o of prev.others) {
    indexCards(index, o.play);
    indexCards(index, o.gy);
  }
  for (const group of Object.values(prev.shop)) {
    for (const p of group) if (p.top) indexCards(index, [p.top]);
  }

  const you = {
    ...next.you,
    hand: reuseZone(index, prev.you.hand, next.you.hand),
    play: reuseZone(index, prev.you.play, next.you.play),
    gy: reuseZone(index, prev.you.gy, next.you.gy),
  };
  const shop = {
    resource: reusePiles(index, prev.shop.resource, next.shop.resource),
    points: reusePiles(index, prev.shop.points, next.shop.points),
    prophet: reusePiles(index, prev.shop.prophet, next.shop.prophet),
    draft: reusePiles(index, prev.shop.draft, next.shop.draft),
  };
  return {
    ...next,
    you,
    shop,
    others: reuseOpponents(index, prev.others, next.others),
    log: reuseLog(prev.log, next.log),
  };
}
