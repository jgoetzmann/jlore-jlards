/**
 * Linked-card highlighting.
 *
 * When a card is hovered (or tapped / long-pressed on touch), every card face
 * on the table that it *references* lights up too: Silver Stash lights the
 * Silver pile, Astrologist lights any Lunar Fragment.
 *
 * ## What counts as a reference
 *
 * A string value anywhere in a definition's typed effect trees — `effects` and
 * every trigger's `effects` (and conditions) — that is the id of a card in the
 * registry, other than the card itself. That is the most direct thing the card
 * data supports: effects name the cards they create, gain, transform into or
 * filter on by `defId`, and nothing else in a definition is node-shaped. Plain
 * fields like `subtypes` are left out on purpose, because a subtype such as
 * "Truss" would otherwise read as a reference to the Truss card.
 *
 * References are **outgoing only**: hovering Silver Stash lights Silver, but
 * hovering Silver does not light Silver Stash. The reverse index would light a
 * Copper for half the catalog.
 *
 * ## Render cost
 *
 * The index is built lazily, one definition at a time, and memoised forever —
 * definitions never change during a session. The active link set lives in a
 * tiny external store (the same shape as `preview.ts`), and each face reads it
 * through `useLinked(defId)`, whose snapshot is a boolean. So hovering a card
 * re-renders only the faces whose highlighted state actually flips.
 *
 * The engine never imports this module; it only reads the registry.
 */

import React from 'react';
import type { CardDefId } from '@engine/types';
import { getCard, hasCard } from '@engine/registry';

const EMPTY: ReadonlySet<CardDefId> = new Set<CardDefId>();

const index = new Map<CardDefId, ReadonlySet<CardDefId>>();

function collect(value: unknown, self: CardDefId, out: Set<CardDefId>, seen: Set<object>): void {
  if (typeof value === 'string') {
    if (value !== self && hasCard(value)) out.add(value);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const v of value) collect(v, self, out, seen);
    return;
  }
  for (const v of Object.values(value as Record<string, unknown>)) collect(v, self, out, seen);
}

/**
 * The card ids `defId`'s effect trees reference, excluding itself. Memoised:
 * the same set object comes back on every call. Unknown ids get an empty set.
 */
export function linkedDefIds(defId: CardDefId): ReadonlySet<CardDefId> {
  const hit = index.get(defId);
  if (hit) return hit;
  if (!defId || !hasCard(defId)) return EMPTY;
  const def = getCard(defId);
  const out = new Set<CardDefId>();
  const seen = new Set<object>();
  collect(def.effects, defId, out, seen);
  collect(def.triggers, defId, out, seen);
  const result: ReadonlySet<CardDefId> = out.size === 0 ? EMPTY : out;
  index.set(defId, result);
  return result;
}

/** Display names of the linked cards, in the order the effects name them. */
export function linkedNames(defId: CardDefId): string[] {
  return Array.from(linkedDefIds(defId), (id) => getCard(id).name);
}

// ---------------------------------------------------------------------------
// The active link set: a tiny external store
// ---------------------------------------------------------------------------

interface LinkSource {
  defId: CardDefId;
  /** Who set it (an instance id), so only that card's pointer-leave clears it. */
  owner: string;
  set: ReadonlySet<CardDefId>;
}

let source: LinkSource | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function subscribeLinks(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The card whose references are lit, or null. */
export function getLinkSource(): { defId: CardDefId; owner: string } | null {
  return source ? { defId: source.defId, owner: source.owner } : null;
}

/** The ids currently lit. */
export function getLinkedSet(): ReadonlySet<CardDefId> {
  return source ? source.set : EMPTY;
}

export function isLinked(defId: CardDefId): boolean {
  return source !== null && source.set.has(defId);
}

/** Light up everything `defId` references. `owner` is the face that asked. */
export function setLinkSource(defId: CardDefId, owner: string): void {
  if (source !== null && source.defId === defId && source.owner === owner) return;
  const prev = source ? source.set : EMPTY;
  const set = linkedDefIds(defId);
  source = { defId, owner, set };
  installTapAway();
  if (set !== prev) emit();
}

/** Clear the highlight. With an owner, only if that face is the one that set it. */
export function clearLinkSource(owner?: string): void {
  if (source === null) return;
  if (owner !== undefined && source.owner !== owner) return;
  const had = source.set;
  source = null;
  if (had !== EMPTY) emit();
}

/** True while `defId` is referenced by the hovered or tapped card. */
export function useLinked(defId: CardDefId): boolean {
  return React.useSyncExternalStore(
    subscribeLinks,
    () => isLinked(defId),
    () => false,
  );
}

/**
 * Touch has no pointer-leave worth trusting (it fires on every lift), so a
 * tapped card's highlight holds until a tap lands somewhere that is not a card
 * face. A mouse clears on leave instead and is ignored here.
 */
let tapAwayInstalled = false;

function installTapAway(): void {
  if (tapAwayInstalled || typeof document === 'undefined') return;
  tapAwayInstalled = true;
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse') return;
      const t = e.target;
      if (t instanceof Element && t.closest('[data-card-id]')) return;
      clearLinkSource();
    },
    true,
  );
}
