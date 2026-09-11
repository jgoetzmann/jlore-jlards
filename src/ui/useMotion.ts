/**
 * The small, per-element half of the motion layer.
 *
 * Card flights live in useFlip.ts and are planned from the view diff in
 * motion.ts. What is here is the motion that belongs to one element and needs
 * no plan: a stat ticking, a pile's count knocking down, the turn banner. Each
 * is an `el.animate()` from a layout effect on the element that changed — no
 * React state, no class toggling, no second render (MOT-3), and no expiry
 * timer re-rendering the table half a second later.
 */

import React from 'react';
import type { GameView } from '@engine/types';
import { EASE_OUT, MOTION_MS } from './motion';
import { prefersReducedMotion } from './useFlip';

/** Respects the OS setting, and keeps respecting it if the player changes it mid-match. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(() => prefersReducedMotion());

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
 * A string that changes when the layout might have, and only then. Zone
 * membership and order, plus the turn; deliberately not money or the log.
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

/**
 * useLayoutEffect in the browser (it must run before paint), useEffect where
 * there is no DOM, so the unit suite's server render stays quiet.
 */
export const useIsoLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

const UP = '#7fd4a0';
const DOWN = '#e07070';

/**
 * Pulse `ref` when `value` changes: a 100-200ms scale tick, green up, red down.
 * `scope` is whose number this is; when it changes (a hotseat seat swap) the
 * new value is simply adopted, since nothing ticked.
 */
export function usePulse(
  value: number,
  ref: React.RefObject<HTMLElement>,
  scope: string,
  opts: { only?: 'up' | 'down' } = {},
): void {
  const last = React.useRef<{ value: number; scope: string } | null>(null);
  const only = opts.only;
  useIsoLayoutEffect(() => {
    const prev = last.current;
    last.current = { value, scope };
    if (!prev || prev.scope !== scope || prev.value === value) return;
    const up = value > prev.value;
    if ((only === 'up' && !up) || (only === 'down' && up)) return;
    const el = ref.current;
    if (!el || typeof el.animate !== 'function' || prefersReducedMotion()) return;
    el.animate([{ transform: 'scale(1.3)', color: up ? UP : DOWN }, { transform: 'none' }], {
      duration: MOTION_MS.beat,
      easing: EASE_OUT,
    });
  }, [value, scope, ref, only]);
}

/**
 * Run `keyframes` on `ref` whenever `trigger` changes after the first render.
 * The turn banner and the End-turn "done" cue use it.
 */
export function useOneShot(
  trigger: string | number | boolean | null,
  ref: React.RefObject<HTMLElement>,
  keyframes: Keyframe[],
  timing: KeyframeAnimationOptions,
  when: (value: typeof trigger) => boolean = () => true,
): void {
  const last = React.useRef<typeof trigger | undefined>(undefined);
  useIsoLayoutEffect(() => {
    const prev = last.current;
    last.current = trigger;
    if (prev === undefined || prev === trigger || !when(trigger)) return;
    const el = ref.current;
    if (!el || typeof el.animate !== 'function' || prefersReducedMotion()) return;
    el.animate(keyframes, timing);
    // keyframes/timing/when are literals at the call site; the trigger is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
}
