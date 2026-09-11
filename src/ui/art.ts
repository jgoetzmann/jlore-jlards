/**
 * Where card art comes from (ART-1). The one place that builds an art URL.
 *
 *   - `/art/thumb/<key>.webp` — 256px, ~4 KB. Everything drawn small: hand,
 *     shop tiles, the in-play strip, the discard, opponents' tableaux.
 *   - `/art/<key>.jpg`        — 512px, ~52 KB. The hover preview and prompt
 *     faces, where the art is drawn large.
 *
 * `tools/bootstrap.ts` ART_EXT ('jpg') names the full-size files the art tools
 * write; `npm run art:thumbs` derives the WebP thumbnails from them.
 *
 * `preloadArt` warms the browser's image cache for every card the first view
 * shows (and any card a later view shows for the first time), so a card's art
 * is decoded before its face is on screen. GameView carries no list of the
 * match's cards, so this works from the CardViews and pile tops a view holds.
 */

import type { CardView, GameView } from '@engine/types';

/** The full-size art. Kept named `artUrl` for the callers and specs that know it. */
export function artUrl(key: string): string {
  return `/art/${encodeURIComponent(key)}.jpg`;
}

export function artThumbUrl(key: string): string {
  return `/art/thumb/${encodeURIComponent(key)}.webp`;
}

/** Deterministic hue from a name, so the placeholder is stable per card. */
export function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** The gradient a card's art box shows while (or instead of) its image. */
export function artPlaceholder(name: string): string {
  const hue = nameHue(name);
  return `linear-gradient(150deg, hsl(${hue} 45% 26%), hsl(${(hue + 48) % 360} 40% 15%))`;
}

/** Every distinct art key a view shows, in the order the table draws them. */
export function artKeysIn(view: GameView): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (cards: readonly (CardView | null)[]): void => {
    for (const c of cards) {
      const key = c?.art?.key;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  };
  add(view.you.hand);
  add(view.you.play);
  add(view.you.gy);
  for (const group of [view.shop.resource, view.shop.points, view.shop.prophet, view.shop.draft]) {
    add(group.map((p) => p.top));
  }
  for (const o of view.others) {
    add(o.play);
    add(o.gy);
  }
  return out;
}

const requested = new Set<string>();

function warm(url: string): void {
  if (requested.has(url)) return;
  requested.add(url);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  if (typeof img.decode === 'function') img.decode().catch(() => undefined);
}

/**
 * Warm the thumbnails now and the full-size art when the browser is idle.
 * Each URL is requested once per page load.
 */
export function preloadArt(view: GameView): void {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return;
  const keys = artKeysIn(view);
  for (const key of keys) warm(artThumbUrl(key));
  const idle = (fn: () => void): void => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    if (typeof ric === 'function') ric(fn);
    else setTimeout(fn, 200);
  };
  idle(() => {
    for (const key of keys) warm(artUrl(key));
  });
}
