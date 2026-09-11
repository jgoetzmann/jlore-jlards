/**
 * FLIP, measured the way React allows it to be measured correctly.
 *
 * Every animated card registers its element under its instance id (MOT-15):
 * the hand slot, the in-play chip, the pile's top card, the discard's top.
 * A `FlipScope` wraps whatever renders them. When its `token` changes (a new
 * view, or the hand's local order) React calls `getSnapshotBeforeUpdate` —
 * *before* any DOM is mutated — and the scope reads where each card in the
 * plan is drawn right now, running flights included. `componentDidUpdate`
 * runs after the new DOM is in place and before paint, and animates from there.
 *
 * That ordering is what the earlier hook got wrong:
 *   - it measured "before" positions at the previous commit and stored them,
 *     so anything that moved in between (a drawer, a scrolled board, a
 *     reordered hand) made a phantom slide; and
 *   - on an interrupted flight it stored the transformed box as layout, so the
 *     restarted flight began mirrored and slid backwards (the skeptic's
 *     MOT-15 finding). Here "before" is always the drawn box, so a restart
 *     continues from where the card visibly is.
 *
 * Moves between containers fly as ghosts: a `pointer-events: none` clone in a
 * fixed layer above the table, so no scrolling or clipped container can crop
 * the flight and nothing can ever take a click. The real element is already in
 * its final slot — the next click is handled at once. Nothing here gates input.
 *
 * Reads and writes are batched (MOT-5): cancel everything in the plan, read
 * every box, then start every animation. Nothing runs when the player asked for
 * reduced motion.
 */

import React from 'react';
import { EASE_OUT, fitTransform, slideOffset, type FlipPlan, type FlipStep, type Rect } from './motion';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

interface Live {
  anims: Animation[];
  ghost: HTMLElement | null;
}

export interface FlipRegistry {
  /** A stable ref callback per key: `ref={registry.register(card.iid)}`. */
  register: (key: string) => (el: HTMLElement | null) => void;
  get: (key: string) => HTMLElement | null;
  /** Flights still running, by key. */
  live: Map<string, Live>;
}

export function createFlipRegistry(): FlipRegistry {
  const elements = new Map<string, HTMLElement>();
  const callbacks = new Map<string, (el: HTMLElement | null) => void>();
  return {
    register(key) {
      const existing = callbacks.get(key);
      if (existing) return existing;
      // One callback per key, cached, so React never detaches and reattaches a
      // card's ref just because a parent re-rendered. A card that remounts in a
      // new zone detaches its old node (null) before the new one attaches, and
      // a detach only clears the entry if it still points at that node.
      let last: HTMLElement | null = null;
      const fn = (el: HTMLElement | null): void => {
        if (el) {
          last = el;
          elements.set(key, el);
        } else if (last !== null && elements.get(key) === last) {
          elements.delete(key);
          last = null;
        }
      };
      callbacks.set(key, fn);
      return fn;
    },
    get(key) {
      return elements.get(key) ?? null;
    },
    live: new Map(),
  };
}

export const FlipContext = React.createContext<FlipRegistry | null>(null);

/** The ref callback for `key`, or undefined outside a table (unit renders). */
export function useFlipRef(key: string | null | undefined): ((el: HTMLElement | null) => void) | undefined {
  const registry = React.useContext(FlipContext);
  return registry && key ? registry.register(key) : undefined;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function rectOf(el: Element): Rect | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

let layer: HTMLElement | null = null;

/** One fixed, click-through layer for every ghost, created on first use. */
function motionLayer(): HTMLElement {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'motion-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

const STRIP_ATTRS = ['data-testid', 'data-iid', 'data-card-id', 'data-card-name', 'data-clickable', 'data-hand-index', 'id', 'tabindex', 'role', 'draggable'];

/**
 * A copy of a card face for a ghost. Every attribute a test or the app finds
 * cards by is removed, so a ghost is never counted, clicked or queried as a card.
 */
function makeGhost(src: HTMLElement, box: Rect): HTMLElement {
  const g = src.cloneNode(true) as HTMLElement;
  for (const el of [g, ...Array.from(g.querySelectorAll('*'))]) {
    for (const a of STRIP_ATTRS) el.removeAttribute(a);
  }
  g.classList.add('motion-ghost');
  const s = g.style;
  s.position = 'fixed';
  s.left = `${box.x}px`;
  s.top = `${box.y}px`;
  s.width = `${box.w}px`;
  s.height = `${box.h}px`;
  s.margin = '0';
  s.transformOrigin = '0 0';
  s.pointerEvents = 'none';
  return g;
}

function stop(registry: FlipRegistry, key: string): void {
  const live = registry.live.get(key);
  if (!live) return;
  for (const a of live.anims) {
    try {
      a.cancel();
    } catch {
      /* an already-finished animation refuses cancel in some browsers */
    }
  }
  live.ghost?.remove();
  registry.live.delete(key);
}

/** Cancel every flight and remove every ghost: the cards on screen are no longer the ones flying. */
export function stopAll(registry: FlipRegistry): void {
  for (const key of Array.from(registry.live.keys())) stop(registry, key);
}

function track(registry: FlipRegistry, key: string, anims: Animation[], ghost: HTMLElement | null): void {
  const live: Live = { anims, ghost };
  registry.live.set(key, live);
  const last = anims[anims.length - 1];
  if (!last) return;
  last.addEventListener('finish', () => {
    ghost?.remove();
    if (registry.live.get(key) === live) registry.live.delete(key);
  });
}

// ---------------------------------------------------------------------------
// Measure, then animate
// ---------------------------------------------------------------------------

interface Before {
  rect: Rect;
  /** The node to clone for a fly: the old face, or the ghost still flying. */
  node: HTMLElement;
}

export type FlipSnapshot = { plan: FlipPlan; before: Map<string, Before> } | null;

/** Read-only. Runs before React mutates the DOM. */
export function measureBefore(registry: FlipRegistry, plan: FlipPlan): Map<string, Before> {
  const out = new Map<string, Before>();
  for (const step of plan.steps) {
    if (step.kind !== 'slide' && step.kind !== 'fly') continue;
    const ghost = registry.live.get(step.key)?.ghost ?? null;
    const node = ghost && ghost.isConnected ? ghost : registry.get(step.key);
    if (!node || !node.isConnected) continue;
    const rect = rectOf(node);
    if (rect) out.set(step.key, { rect, node });
  }
  return out;
}

/** Runs after the new DOM is in place, before paint. */
export function runFlip(registry: FlipRegistry, plan: FlipPlan, before: Map<string, Before>): void {
  if (typeof document === 'undefined') return;

  // 1. Write: cancel whatever is still running for these cards.
  for (const step of plan.steps) stop(registry, step.key);

  // 2. Read: every box the plan needs, in one pass.
  const reads = plan.steps.map((step: FlipStep) => {
    const el = registry.get(step.key);
    const self = el && el.isConnected ? rectOf(el) : null;
    const targetKey = step.kind === 'fly' && step.target && step.target !== 'self' ? step.target : null;
    const targetEl = targetKey ? registry.get(targetKey) : null;
    const target = targetKey ? (targetEl && targetEl.isConnected ? rectOf(targetEl) : null) : self;
    const sourceEl = step.source ? registry.get(step.source) : null;
    const source = sourceEl && sourceEl.isConnected ? rectOf(sourceEl) : null;
    return { step, el, self, target, source };
  });

  // 3. Write: start every animation.
  for (const { step, el, self, target, source } of reads) {
    const timing = { duration: step.ms, delay: step.delay, easing: EASE_OUT, fill: 'backwards' as const };

    if (step.kind === 'slide') {
      const b = before.get(step.key);
      if (!b || !el || !self || typeof el.animate !== 'function') continue;
      const off = slideOffset(b.rect, self);
      if (!off) continue;
      const a = el.animate(
        [{ transform: `translate(${off.dx}px, ${off.dy}px)` }, { transform: 'none' }],
        timing,
      );
      track(registry, step.key, [a], null);
      continue;
    }

    if (step.kind === 'fly') {
      const b = before.get(step.key);
      if (!b || !target) continue;
      const ghost = makeGhost(b.node, b.rect);
      motionLayer().appendChild(ghost);
      const t = fitTransform(b.rect, target);
      const toSelf = step.target === 'self';
      const anims: Animation[] = [];
      if (toSelf && el && typeof el.animate === 'function') {
        // The real card is already in its slot; it shows as the ghost lands.
        anims.push(el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.85 }, { opacity: 1 }], timing));
      }
      anims.push(
        ghost.animate(
          [
            { transform: 'none', opacity: 1 },
            { opacity: 1, offset: 0.7 },
            { transform: `translate(${t.dx}px, ${t.dy}px) scale(${t.s})`, opacity: toSelf ? 1 : 0.15 },
          ],
          { ...timing, fill: 'both' },
        ),
      );
      track(registry, step.key, anims, ghost);
      continue;
    }

    if (step.kind === 'deal') {
      if (!el || !self || typeof el.animate !== 'function') continue;
      if (!source) {
        track(registry, step.key, [el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], timing)], null);
        continue;
      }
      const ghost = makeGhost(el, self);
      motionLayer().appendChild(ghost);
      const t = fitTransform(self, source);
      const hide = el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.9 }, { opacity: 1 }], {
        duration: step.ms + step.delay,
        easing: 'linear',
      });
      const fly = ghost.animate(
        [
          { transform: `translate(${t.dx}px, ${t.dy}px) scale(${t.s})`, opacity: 0.4 },
          { transform: 'none', opacity: 1 },
        ],
        { ...timing, fill: 'both' },
      );
      track(registry, step.key, [hide, fly], ghost);
      continue;
    }

    // fade
    if (!el || typeof el.animate !== 'function') continue;
    track(
      registry,
      step.key,
      [el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], timing)],
      null,
    );
  }
}

// ---------------------------------------------------------------------------
// The scope
// ---------------------------------------------------------------------------

export interface FlipScopeProps<T> {
  registry: FlipRegistry;
  /** Motion is planned only when this changes identity. */
  token: T;
  plan: (prev: T, next: T) => FlipPlan | null;
  enabled: boolean;
  /**
   * Whose table this is. When it changes (a hotseat seat swap) every flight in
   * progress belonged to the other seat's cards and is dropped at once, rather
   * than finishing over the new seat's hand.
   */
  resetKey?: string;
  children?: React.ReactNode;
}

export class FlipScope<T> extends React.Component<FlipScopeProps<T>> {
  override getSnapshotBeforeUpdate(prev: Readonly<FlipScopeProps<T>>): FlipSnapshot {
    const { token, plan, registry, enabled } = this.props;
    if (!enabled || prev.token === token || typeof document === 'undefined') return null;
    const p = plan(prev.token, token);
    if (!p || p.steps.length === 0) return null;
    return { plan: p, before: measureBefore(registry, p) };
  }

  override componentDidUpdate(prev: Readonly<FlipScopeProps<T>>, _state: unknown, snap: FlipSnapshot): void {
    if (prev.resetKey !== this.props.resetKey) stopAll(this.props.registry);
    if (snap) runFlip(this.props.registry, snap.plan, snap.before);
  }

  override render(): React.ReactNode {
    return this.props.children;
  }
}

export default FlipScope;
