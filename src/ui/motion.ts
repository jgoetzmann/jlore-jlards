/**
 * Motion is *derived*, never dispatched.
 *
 * A non-host browser holds nothing but a stream of `GameView`s, so there is no
 * event feed to animate against — the client is told what is true now, not what
 * changed. Every animation in this build therefore comes from diffing the last
 * view against the next one, which has the useful property that host and guest
 * animate identically from identical information, and that a dropped poll
 * degrades into a bigger jump rather than a desynchronised animation.
 *
 * This module is pure and React-free on purpose: it is the only part of the
 * motion layer that can be tested in the `node` environment the suite runs in.
 *
 * The five presets are not invented here. `ArtSlot.anim` already names them on
 * 174 catalog cards (`summon` 54, `coin` 40, `trash` 39, `explode` 24,
 * `shuffle` 17) and nothing consumed them until now.
 */

import type { AuraTier, CardView, GameView, InstanceId, PlayerId, Prompt } from '@engine/types';

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type AnimPreset = 'summon' | 'coin' | 'trash' | 'explode' | 'shuffle';

export const ANIM_PRESETS: readonly AnimPreset[] = [
  'summon',
  'coin',
  'trash',
  'explode',
  'shuffle',
];

/** The card's authored preset, or null when it names one we do not implement. */
export function animPresetOf(card: Pick<CardView, 'art'>): AnimPreset | null {
  const raw = card.art?.anim;
  if (!raw) return null;
  return (ANIM_PRESETS as readonly string[]).includes(raw) ? (raw as AnimPreset) : null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Zones the client can actually see, and therefore the only ones it can animate. */
export type MotionZone = 'hand' | 'play' | 'gy' | 'opponentPlay' | 'opponentGy';

/** Stats that tick rather than snap. */
export type TickStat = 'money' | 'buys' | 'actions' | 'prophet' | 'vp' | 'combo';

export const TICK_STATS: readonly TickStat[] = [
  'money',
  'buys',
  'actions',
  'prophet',
  'vp',
  'combo',
];

export type MotionEvent =
  /** First view of a match: deal the opening hand, animate nothing else. */
  | { kind: 'matchStart' }
  /** Hotseat swapped which seat is on screen. Everything differs; animate none of it. */
  | { kind: 'seatChange'; from: PlayerId; to: PlayerId }
  | {
      kind: 'cardEnter';
      zone: MotionZone;
      iid: InstanceId;
      defId: string;
      name: string;
      anim: AnimPreset | null;
      owner: PlayerId;
    }
  | { kind: 'cardExit'; zone: MotionZone; iid: InstanceId; defId: string; name: string; owner: PlayerId }
  | { kind: 'statChange'; stat: TickStat; from: number; to: number; delta: number }
  | { kind: 'pileDrained'; pileId: string; from: number; to: number; emptied: boolean }
  | { kind: 'turnChange'; from: PlayerId | null; to: PlayerId; turn: number; yours: boolean }
  | { kind: 'promptOpen'; promptId: string; promptType: Prompt['type'] }
  | { kind: 'auraGained'; auraId: string; name: string; tier: AuraTier }
  | { kind: 'gameEnd'; winners: PlayerId[] };

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function byIid(cards: readonly CardView[]): Map<InstanceId, CardView> {
  const out = new Map<InstanceId, CardView>();
  for (const c of cards) out.set(c.iid, c);
  return out;
}

function isPrompt(p: GameView['pending']): p is Prompt {
  return p !== null && typeof p === 'object' && 'id' in p && 'options' in p;
}

function diffZone(
  out: MotionEvent[],
  zone: MotionZone,
  owner: PlayerId,
  before: readonly CardView[],
  after: readonly CardView[],
): void {
  const prev = byIid(before);
  const next = byIid(after);
  for (const card of after) {
    if (prev.has(card.iid)) continue;
    out.push({
      kind: 'cardEnter',
      zone,
      iid: card.iid,
      defId: card.defId,
      name: card.name,
      anim: animPresetOf(card),
      owner,
    });
  }
  for (const card of before) {
    if (next.has(card.iid)) continue;
    out.push({
      kind: 'cardExit',
      zone,
      iid: card.iid,
      defId: card.defId,
      name: card.name,
      owner,
    });
  }
}

/**
 * Everything that changed between two consecutive views, as animatable events.
 *
 * Two cases deliberately return a single event and nothing else, because in
 * both of them *every* card looks new and animating that would be a blizzard:
 * the first view of a match, and a hotseat seat swap.
 */
export function diffViews(prev: GameView | null, next: GameView): MotionEvent[] {
  if (!prev) return [{ kind: 'matchStart' }];
  if (prev.you.id !== next.you.id) {
    return [{ kind: 'seatChange', from: prev.you.id, to: next.you.id }];
  }

  const out: MotionEvent[] = [];

  diffZone(out, 'hand', next.you.id, prev.you.hand, next.you.hand);
  diffZone(out, 'play', next.you.id, prev.you.play, next.you.play);
  diffZone(out, 'gy', next.you.id, prev.you.gy, next.you.gy);

  const prevOthers = new Map(prev.others.map((o) => [o.id, o]));
  for (const o of next.others) {
    const before = prevOthers.get(o.id);
    if (!before) continue;
    diffZone(out, 'opponentPlay', o.id, before.play, o.play);
    diffZone(out, 'opponentGy', o.id, before.gy, o.gy);
  }

  for (const stat of TICK_STATS) {
    const from = prev.you[stat];
    const to = next.you[stat];
    if (typeof from !== 'number' || typeof to !== 'number' || from === to) continue;
    out.push({ kind: 'statChange', stat, from, to, delta: to - from });
  }

  const prevPiles = new Map<string, number>();
  for (const group of Object.values(prev.shop)) {
    for (const pile of group) prevPiles.set(pile.id, pile.count);
  }
  for (const group of Object.values(next.shop)) {
    for (const pile of group) {
      const before = prevPiles.get(pile.id);
      if (before === undefined || before <= pile.count) continue;
      out.push({
        kind: 'pileDrained',
        pileId: pile.id,
        from: before,
        to: pile.count,
        emptied: pile.count === 0,
      });
    }
  }

  const prevAuras = new Set(prev.you.field.map((a) => a.auraId));
  for (const aura of next.you.field) {
    if (prevAuras.has(aura.auraId)) continue;
    out.push({ kind: 'auraGained', auraId: aura.auraId, name: aura.name, tier: aura.tier });
  }

  if (prev.activePlayer !== next.activePlayer || prev.turn !== next.turn) {
    out.push({
      kind: 'turnChange',
      from: prev.activePlayer,
      to: next.activePlayer,
      turn: next.turn,
      yours: next.activePlayer === next.you.id,
    });
  }

  const prevPromptId = isPrompt(prev.pending) ? prev.pending.id : null;
  if (isPrompt(next.pending) && next.pending.id !== prevPromptId) {
    out.push({ kind: 'promptOpen', promptId: next.pending.id, promptType: next.pending.type });
  }

  if (!prev.ended && next.ended) {
    out.push({ kind: 'gameEnd', winners: next.winners ?? [] });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Folding events into what a component actually renders
// ---------------------------------------------------------------------------

/** A short-lived class applied to one card. */
export interface CardCue {
  iid: InstanceId;
  /** Which keyframe to run. `enter` is the generic fallback. */
  anim: AnimPreset | 'enter';
  zone: MotionZone;
}

/**
 * Cards that just arrived somewhere, with the keyframe to run on each.
 *
 * A card that arrives *and* leaves in the same diff (played and immediately
 * trashed — every Flimsy card in the pool does this) keeps its entrance: the
 * exit is the more obvious of the two on screen because the card is simply not
 * there any more.
 */
export function cardCues(events: readonly MotionEvent[]): CardCue[] {
  const out: CardCue[] = [];
  const seen = new Set<InstanceId>();
  for (const e of events) {
    if (e.kind !== 'cardEnter') continue;
    if (seen.has(e.iid)) continue;
    seen.add(e.iid);
    out.push({ iid: e.iid, anim: e.anim ?? 'enter', zone: e.zone });
  }
  return out;
}

/** Piles that lost at least one card in this batch. */
export function drainedPiles(events: readonly MotionEvent[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.kind === 'pileDrained') out.add(e.pileId);
  }
  return out;
}

/**
 * Piles that hit zero in this batch.
 *
 * Worth its own cue rather than folding into `drainedPiles`: four empty piles
 * end the game, so the pile that just ran out is the single most consequential
 * thing that can happen on the board.
 */
export function emptiedPiles(events: readonly MotionEvent[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.kind === 'pileDrained' && e.emptied) out.add(e.pileId);
  }
  return out;
}

/** Signed stat deltas, for the flash on the turn bar. */
export function statPulses(events: readonly MotionEvent[]): Partial<Record<TickStat, number>> {
  const out: Partial<Record<TickStat, number>> = {};
  for (const e of events) {
    if (e.kind !== 'statChange') continue;
    out[e.stat] = (out[e.stat] ?? 0) + e.delta;
  }
  return out;
}

/**
 * How long the table should be held still after a batch of events, in ms.
 *
 * A turn change is the one moment worth pausing on — it is the only time the
 * whole board is replaced at once — so it gets a longer beat than a card
 * landing. Returns 0 when nothing worth waiting for happened.
 */
export function settleMs(events: readonly MotionEvent[]): number {
  let ms = 0;
  for (const e of events) {
    if (e.kind === 'turnChange') ms = Math.max(ms, 900);
    else if (e.kind === 'gameEnd') ms = Math.max(ms, 1200);
    else if (e.kind === 'cardEnter') ms = Math.max(ms, 420);
    else if (e.kind === 'statChange') ms = Math.max(ms, 320);
  }
  return ms;
}
