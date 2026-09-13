/**
 * `title` tooltips, reachable by touch.
 *
 * Much of the table explains itself only in a native tooltip: why a Buy, Play
 * money, End turn or aura Activate is disabled, what the clock and Doomsday
 * counters are, an aura's rules text, a seat's counts. A finger never hovers,
 * so none of that was reachable on a phone.
 *
 * One document-level listener covers all of them, including the ones other
 * tracks add later: a touch tap on an element carrying a `title` shows that
 * title in a small bubble when the element is disabled, or when nothing on the
 * way up answers the tap itself (so a tap on the drawer toggle still just
 * toggles the drawer). It listens to `pointerup`, not `click`: a disabled
 * button gets no click, but Chromium and WebKit still deliver its pointer
 * events.
 *
 * The bubble is `pointer-events: none` and gone after TIP_MS or the next tap.
 */

import React from 'react';

export const TIP_MS = 2600;

const TAP_ACTION_SELECTOR = 'button, a[href], input, select, textarea, label, [role="button"]';

/** What a tap on `target` should explain, or null. */
export function tipTextFor(target: Element | null): string | null {
  const el = target?.closest('[title]') ?? null;
  if (!el) return null;
  const text = el.getAttribute('title');
  if (!text) return null;
  const disabled =
    (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
  if (disabled) return text;
  if (el.closest(TAP_ACTION_SELECTOR)) return null;
  return text;
}

/**
 * Where the bubble's centre goes: over the tap, pulled in so a bubble up to
 * `maxWidth` px wide (the CSS max-width) stays inside the viewport. Above the
 * finger unless the tap is too near the top.
 */
export function placeTip(
  x: number,
  y: number,
  viewportWidth: number,
  maxWidth = 240,
): { left: number; top: number; above: boolean } {
  const half = maxWidth / 2 + 8;
  const left = viewportWidth <= half * 2 ? viewportWidth / 2 : Math.max(half, Math.min(x, viewportWidth - half));
  const above = y > 96;
  return { left, top: above ? y - 18 : y + 28, above };
}

export function TapTipBubble({ text, x, y, viewportWidth }: { text: string; x: number; y: number; viewportWidth: number }): JSX.Element {
  const place = placeTip(x, y, viewportWidth);
  return (
    <div
      className={`tap-tip${place.above ? ' tap-tip-above' : ''}`}
      data-testid="tap-tip"
      role="status"
      style={{ left: place.left, top: place.top }}
    >
      {text}
    </div>
  );
}

export function TapTip(): JSX.Element | null {
  const [tip, setTip] = React.useState<{ text: string; x: number; y: number; n: number } | null>(null);

  React.useEffect(() => {
    let down: { x: number; y: number } | null = null;
    let n = 0;
    const onDown = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse') return;
      down = { x: e.clientX, y: e.clientY };
      setTip((t) => (t === null ? t : null));
    };
    const onUp = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse' || down === null) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      down = null;
      if (dx * dx + dy * dy > 100) return;
      const text = tipTextFor(e.target instanceof Element ? e.target : null);
      if (text) setTip({ text, x: e.clientX, y: e.clientY, n: ++n });
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
    };
  }, []);

  React.useEffect(() => {
    if (tip === null) return;
    const t = setTimeout(() => setTip(null), TIP_MS);
    return () => clearTimeout(t);
  }, [tip]);

  if (tip === null) return null;
  return <TapTipBubble text={tip.text} x={tip.x} y={tip.y} viewportWidth={window.innerWidth} />;
}

export default TapTip;
