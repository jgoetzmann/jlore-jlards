/**
 * FLIP, over one shared group.
 *
 * Every card face on the table registers into the same group by instance id, so
 * a card does not animate "out of the hand" and separately "into play" — it is
 * the same DOM node moving, and the transition falls out of measuring where it
 * was and where it now is. That is also why buying animates for free: the
 * engine moves the bought instance from the shop pile to the graveyard keeping
 * its iid (`moveInstance(s, iid, …)` in core/buy.ts), so the same node is in
 * both places across the two renders and the card flies down to the discard.
 *
 * Positions are measured relative to the group's root rather than the viewport,
 * so scrolling the table between two views cannot manufacture a phantom slide.
 *
 * Nothing here runs when the player asked for reduced motion.
 */

import React from 'react';

export interface FlipOptions {
  durationMs?: number;
  easing?: string;
  /** Ignore sub-pixel jitter and anything implausibly far (a remount, not a move). */
  minDeltaPx?: number;
  maxDeltaPx?: number;
  enabled?: boolean;
}

export interface FlipGroup {
  /** Put this on the element every measurement is taken relative to. */
  rootRef: React.RefObject<HTMLDivElement>;
  /** `ref={flip.register(card.iid)}` on each animated element. */
  register: (key: string) => (el: HTMLElement | null) => void;
}

interface Point {
  x: number;
  y: number;
}

const DEFAULTS: Required<Omit<FlipOptions, 'enabled'>> = {
  durationMs: 320,
  easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  minDeltaPx: 3,
  maxDeltaPx: 2400,
};

/**
 * @param signature changes exactly when the rendered arrangement might have
 *   moved — pass a view signature, never a value that ticks on its own, or the
 *   group re-measures during animations it is already running.
 */
export function useFlipGroup(signature: string, opts: FlipOptions = {}): FlipGroup {
  const cfg = { ...DEFAULTS, ...opts };
  const enabled = opts.enabled !== false;

  const rootRef = React.useRef<HTMLDivElement>(null);
  const elements = React.useRef(new Map<string, HTMLElement>());
  const positions = React.useRef(new Map<string, Point>());
  const running = React.useRef(new Map<string, Animation>());

  // One callback per key, cached. A fresh closure each render would make React
  // detach and reattach every card's ref on every render — which for a table
  // that re-renders on each clock tick is a lot of churn for no gain.
  const callbacks = React.useRef(new Map<string, (el: HTMLElement | null) => void>());

  const register = React.useCallback((key: string) => {
    const existing = callbacks.current.get(key);
    if (existing) return existing;
    const fn = (el: HTMLElement | null): void => {
      if (el) elements.current.set(key, el);
      else elements.current.delete(key);
    };
    callbacks.current.set(key, fn);
    return fn;
  }, []);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const origin = root.getBoundingClientRect();
    const next = new Map<string, Point>();

    for (const [key, el] of elements.current) {
      if (!el.isConnected) continue;
      const box = el.getBoundingClientRect();
      const point: Point = { x: box.left - origin.left, y: box.top - origin.top };
      next.set(key, point);

      if (!enabled) continue;
      const before = positions.current.get(key);
      if (!before) continue; // new arrival — the entrance keyframe owns it

      const dx = before.x - point.x;
      const dy = before.y - point.y;
      const distance = Math.hypot(dx, dy);
      if (distance < cfg.minDeltaPx || distance > cfg.maxDeltaPx) continue;

      // A card that is already flying must not stack a second transform on top.
      const inFlight = running.current.get(key);
      if (inFlight) {
        try {
          inFlight.cancel();
        } catch {
          /* an already-finished animation refuses cancel in some browsers */
        }
      }

      if (typeof el.animate !== 'function') continue;
      const animation = el.animate(
        [{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: 'translate3d(0,0,0)' }],
        { duration: cfg.durationMs, easing: cfg.easing, composite: 'replace' },
      );
      running.current.set(key, animation);
      animation.addEventListener('finish', () => {
        if (running.current.get(key) === animation) running.current.delete(key);
      });
    }

    positions.current = next;
    // cfg is rebuilt every render; the signature is the only real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled]);

  React.useEffect(() => {
    const live = running.current;
    return () => {
      for (const animation of live.values()) {
        try {
          animation.cancel();
        } catch {
          /* unmounting mid-flight */
        }
      }
      live.clear();
    };
  }, []);

  return { rootRef, register };
}

export default useFlipGroup;
