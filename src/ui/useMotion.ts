/**
 * Turns the view stream into transient animation state.
 *
 * The rule the whole layer is built on: **a cue expires.** Nothing here is a
 * lasting flag, because the view that arrives next is authoritative about what
 * is true and this hook is only ever authoritative about what just *changed*.
 * A stuck cue would be a card permanently mid-entrance.
 *
 * See `motion.ts` for the diff itself, which is pure and tested.
 */

import React from 'react';
import type { GameView, InstanceId } from '@engine/types';
import {
  cardCues,
  diffViews,
  settleMs,
  statPulses,
  type AnimPreset,
  type MotionEvent,
  type TickStat,
} from './motion';

export interface TurnFlash {
  to: string;
  turn: number;
  yours: boolean;
}

export interface MotionState {
  events: MotionEvent[];
  /** The keyframe to run on this card right now, or null. */
  cueFor: (iid: InstanceId) => AnimPreset | 'enter' | null;
  pulses: Partial<Record<TickStat, number>>;
  turnFlash: TurnFlash | null;
  /** Changes exactly when the arrangement might have moved. Drives the FLIP group. */
  signature: string;
  reduced: boolean;
}

const EMPTY: MotionEvent[] = [];

/** Respects the OS setting, and keeps respecting it if the player changes it mid-match. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(query.matches);
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    return undefined;
  }, []);

  return reduced;
}

/**
 * A string that changes when the layout might have, and only then.
 *
 * Zone membership and order, plus the turn. Deliberately *not* money or the
 * log, so a stat tick does not make the FLIP group re-measure mid-flight.
 */
export function arrangementSignature(view: GameView | null): string {
  if (!view) return 'none';
  const zone = (cards: { iid: string }[]): string => cards.map((c) => c.iid).join(',');
  const shop = Object.values(view.shop)
    .flat()
    .map((p) => `${p.id}:${p.top?.iid ?? '-'}`)
    .join(',');
  return [
    view.you.id,
    view.turn,
    zone(view.you.hand),
    zone(view.you.play),
    zone(view.you.gy),
    view.others.map((o) => `${o.id}#${zone(o.play)}`).join(';'),
    shop,
  ].join('|');
}

export function useMotion(view: GameView | null): MotionState {
  const reduced = usePrefersReducedMotion();
  const previous = React.useRef<GameView | null>(null);
  const [events, setEvents] = React.useState<MotionEvent[]>(EMPTY);

  React.useEffect(() => {
    if (!view) return undefined;
    const next = diffViews(previous.current, view);
    previous.current = view;
    if (next.length === 0) return undefined;

    setEvents(next);
    const hold = settleMs(next);
    if (hold <= 0) {
      setEvents(EMPTY);
      return undefined;
    }
    const timer = setTimeout(() => setEvents(EMPTY), hold);
    return () => clearTimeout(timer);
  }, [view]);

  const cues = React.useMemo(() => {
    if (reduced) return new Map<InstanceId, AnimPreset | 'enter'>();
    const map = new Map<InstanceId, AnimPreset | 'enter'>();
    for (const cue of cardCues(events)) map.set(cue.iid, cue.anim);
    return map;
  }, [events, reduced]);

  const pulses = React.useMemo(
    () => (reduced ? {} : statPulses(events)),
    [events, reduced],
  );

  const turnFlash = React.useMemo<TurnFlash | null>(() => {
    for (const e of events) {
      if (e.kind === 'turnChange') return { to: e.to, turn: e.turn, yours: e.yours };
    }
    return null;
  }, [events]);

  const signature = React.useMemo(() => arrangementSignature(view), [view]);

  const cueFor = React.useCallback(
    (iid: InstanceId) => cues.get(iid) ?? null,
    [cues],
  );

  return { events, cueFor, pulses, turnFlash, signature, reduced };
}

export default useMotion;
