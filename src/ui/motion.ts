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
 * Piles that hit zero in this batch. Worth its own cue: four empty piles end
 * the game, so the pile that just ran out is the most consequential thing that
 * can happen on the board.
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

// ---------------------------------------------------------------------------
// Timing (MOT-9)
// ---------------------------------------------------------------------------

/**
 * Every duration the motion layer uses, in ms. motion.css declares the same
 * numbers as `--t-*` tokens; JS reads them from here, so the two agree.
 * Snappy, not cinematic: a card move is under a fifth of a second, and nothing
 * the player waits on is longer than the turn banner, which never blocks.
 */
export const MOTION_MS = {
  instant: 60,
  tick: 100,
  quick: 120,
  move: 180,
  beat: 200,
  turn: 600,
  /** hand → in play */
  play: 160,
  /** pile top → discard */
  buy: 200,
  /** library → hand, per card */
  draw: 140,
  /** hand / in play → discard */
  discard: 180,
  /** a card sliding along its own row */
  reorder: 120,
  /** a card that left for the trash: a fade and shrink where it stood */
  trash: 140,
  /** the gap between dealt cards, and its cap */
  stagger: 25,
  staggerCap: 125,
  /** after a cleanup, the new hand starts arriving this much later */
  drawAfterCleanup: 60,
} as const;

/** The easing every flight uses. Matches `--e-out`. */
export const EASE_OUT = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

/**
 * How long the table should be held still after a batch of events, in ms.
 *
 * A turn change is the one moment worth pausing on — it is the only time the
 * whole board is replaced at once — so it gets a longer beat than a card
 * landing. Returns 0 when nothing worth waiting for happened. Nothing gates
 * input on this; it sizes cues.
 */
export function settleMs(events: readonly MotionEvent[]): number {
  let ms = 0;
  for (const e of events) {
    if (e.kind === 'turnChange') ms = Math.max(ms, MOTION_MS.turn);
    else if (e.kind === 'gameEnd') ms = Math.max(ms, MOTION_MS.turn * 2);
    else if (e.kind === 'cardEnter') ms = Math.max(ms, MOTION_MS.beat);
    else if (e.kind === 'statChange') ms = Math.max(ms, MOTION_MS.tick);
  }
  return ms;
}

// ---------------------------------------------------------------------------
// FLIP planning (MOT-3, MOT-4, MOT-5, MOT-15)
// ---------------------------------------------------------------------------

/**
 * Anchors: elements that stand in for zones the table doesn't draw card by
 * card. A dealt card flies out of the library; a card discarded underneath the
 * top of the graveyard flies into the discard pile.
 */
export const ANCHOR_LIBRARY = 'anchor:library';
export const ANCHOR_DISCARD = 'anchor:discard';

/** An opponent's hand fan: their plays fly out of it into their tableau. */
export function anchorFan(player: string): string {
  return `anchor:fan:${player}`;
}

/**
 *   slide  the same card, still in its row, moved: translate in place.
 *   fly    the card changed zones: a ghost of its old face flies from where it
 *          was to `target` ('self' — its new element — or an anchor).
 *   deal   the card arrived from a hidden zone: a ghost of its new face flies
 *          in from the `source` anchor.
 *   fade   the card arrived with nowhere to fly from: a short fade in place.
 *   exit   the card left for a zone the table never draws (the trash, set
 *          aside): a ghost of its old face fades and shrinks where it stood.
 */
export type FlipKind = 'slide' | 'fly' | 'deal' | 'fade' | 'exit';

export interface FlipStep {
  key: string;
  kind: FlipKind;
  ms: number;
  delay: number;
  target?: string;
  source?: string;
}

export interface FlipPlan {
  steps: FlipStep[];
}

/** Where each iid the table draws is, for one view. */
type Zone = 'hand' | 'play' | 'discard' | `pile:${string}`;

function zonesOf(view: GameView): Map<string, Zone> {
  const out = new Map<string, Zone>();
  for (const c of view.you.hand) out.set(c.iid, 'hand');
  for (const c of view.you.play) out.set(c.iid, 'play');
  const top = view.you.gy[view.you.gy.length - 1];
  if (top) out.set(top.iid, 'discard');
  for (const group of Object.values(view.shop)) {
    for (const p of group) if (p.top) out.set(p.top.iid, `pile:${p.id}`);
  }
  return out;
}

function order(cards: readonly CardView[]): string {
  return cards.map((c) => c.iid).join('|');
}

function flightMs(from: Zone, to: Zone | typeof ANCHOR_DISCARD): number {
  if (from.startsWith('pile:')) return MOTION_MS.buy;
  if (from === 'hand' && to === 'play') return MOTION_MS.play;
  if (to === 'discard' || to === ANCHOR_DISCARD) return MOTION_MS.discard;
  return MOTION_MS.move;
}

/**
 * What should move between two consecutive views of the same seat, keyed by
 * instance id. Pure: the DOM work lives in useFlip.ts.
 *
 * Only cards in the diff are touched (MOT-5): a zone whose order is unchanged
 * contributes no slides, an unchanged pile top nothing at all. The first view
 * and a hotseat seat swap plan nothing — every card would look new.
 */
export function planFlip(prev: GameView | null, next: GameView): FlipPlan | null {
  if (!prev || prev === next) return null;
  if (prev.you.id !== next.you.id) return null;

  const before = zonesOf(prev);
  const after = zonesOf(next);
  const handSame = order(prev.you.hand) === order(next.you.hand);
  const playSame = order(prev.you.play) === order(next.you.play);
  const turnChanged = prev.turn !== next.turn || prev.activePlayer !== next.activePlayer;
  const steps: FlipStep[] = [];

  let dealt = 0;
  for (const [key, to] of after) {
    const from = before.get(key);
    if (from === to) {
      // Still in its row. It can only have moved if the row changed.
      if ((to === 'hand' && !handSame) || (to === 'play' && !playSame)) {
        steps.push({ key, kind: 'slide', ms: to === 'hand' ? MOTION_MS.reorder : MOTION_MS.quick, delay: 0 });
      }
      continue;
    }
    if (from !== undefined) {
      steps.push({ key, kind: 'fly', ms: flightMs(from, to), delay: 0, target: 'self' });
      continue;
    }
    if (to === 'hand') {
      const delay = Math.min(dealt * MOTION_MS.stagger, MOTION_MS.staggerCap) + (turnChanged ? MOTION_MS.drawAfterCleanup : 0);
      dealt += 1;
      steps.push({ key, kind: 'deal', ms: MOTION_MS.draw, delay, source: ANCHOR_LIBRARY });
      continue;
    }
    steps.push({ key, kind: 'fade', ms: to.startsWith('pile:') ? MOTION_MS.tick : MOTION_MS.quick, delay: 0 });
  }

  // Cards that went into the graveyard underneath its new top card: they fly
  // to the discard pile and are gone.
  const gyNow = new Set(next.you.gy.map((c) => c.iid));
  for (const [key, from] of before) {
    if (after.has(key) || !gyNow.has(key)) continue;
    steps.push({ key, kind: 'fly', ms: flightMs(from, ANCHOR_DISCARD), delay: 0, target: ANCHOR_DISCARD });
  }

  // Your cards that left your hand or play for somewhere the table never draws.
  // The view has no trash zone, so the library count tells the two apart: if it
  // grew, the card went back on the deck and flies there; otherwise it was
  // trashed or set aside and fades out where it stood (MOT-15). Pile tops that
  // leave without landing here (an opponent's buy) just leave; the new top
  // fades in.
  const libraryGrew = next.you.libraryCount > prev.you.libraryCount;
  for (const [key, from] of before) {
    if (after.has(key) || gyNow.has(key)) continue;
    if (from !== 'hand' && from !== 'play') continue;
    if (libraryGrew) steps.push({ key, kind: 'fly', ms: MOTION_MS.move, delay: 0, target: ANCHOR_LIBRARY });
    else steps.push({ key, kind: 'exit', ms: MOTION_MS.trash, delay: 0 });
  }

  // An opponent's new plays fly out of their hand fan into their tableau
  // (MOT-15). Both ends exist only while their seat is expanded; otherwise the
  // step finds no element and does nothing, and the seat's last-move line cues
  // the play instead (Opponents.tsx).
  const prevOthers = new Map(prev.others.map((o) => [o.id, o]));
  for (const o of next.others) {
    const was = prevOthers.get(o.id);
    if (!was) continue;
    const had = new Set(was.play.map((c) => c.iid));
    for (const c of o.play) {
      if (had.has(c.iid)) continue;
      steps.push({ key: c.iid, kind: 'deal', ms: MOTION_MS.play, delay: 0, source: anchorFan(o.id) });
    }
  }

  return steps.length > 0 ? { steps } : null;
}

/** A row the player reordered locally: every card that moved slides. */
export function planReorder(prev: readonly string[], next: readonly string[]): FlipPlan | null {
  if (prev.join('|') === next.join('|')) return null;
  const had = new Set(prev);
  const steps: FlipStep[] = next
    .filter((k) => had.has(k))
    .map((key) => ({ key, kind: 'slide' as const, ms: MOTION_MS.reorder, delay: 0 }));
  return steps.length > 0 ? { steps } : null;
}

// ---------------------------------------------------------------------------
// Geometry (pure, so the interruption math is testable)
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Below this, a move is layout jitter and not worth a frame of motion. */
export const MIN_MOVE_PX = 2;

/**
 * The offset a slide starts from. `before` is where the card was *drawn* just
 * before the commit — including any flight still running — and `after` is its
 * new layout box, so an interrupted slide continues from where it visibly was
 * rather than jumping (the MOT-15 reversal bug came from storing the transformed
 * position as layout).
 */
export function slideOffset(before: Rect, after: Rect, minPx: number = MIN_MOVE_PX): { dx: number; dy: number } | null {
  const dx = before.x - after.x;
  const dy = before.y - after.y;
  if (Math.hypot(dx, dy) < minPx) return null;
  return { dx, dy };
}

/**
 * The transform that takes a box laid out at `from` onto `to`: a uniform scale
 * that fits it inside `to`, centred there. Used with transform-origin 0 0.
 * Uniform so a card shrinking into a chip stays card-shaped.
 */
export function fitTransform(from: Rect, to: Rect): { dx: number; dy: number; s: number } {
  const s = from.w > 0 && from.h > 0 ? Math.min(to.w / from.w, to.h / from.h) : 1;
  const dx = to.x + (to.w - from.w * s) / 2 - from.x;
  const dy = to.y + (to.h - from.h * s) / 2 - from.y;
  return { dx, dy, s };
}
