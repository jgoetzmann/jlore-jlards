/**
 * Prompt selection arithmetic and placement, kept out of the components.
 *
 * The prompt bar, the hand (whose cards become toggles for a hand prompt) and
 * the board (whose piles light up for a pile prompt) all drive one selection.
 * Putting the rules in one pure place means there is only one thing to get
 * right, and it can be tested without a DOM.
 */

import type { GameView, PileView, PlayerId, Prompt } from '@engine/types';

/** Prompt types where the player is ordering every option, not choosing among them. */
export const ORDERING_TYPES: ReadonlySet<Prompt['type']> = new Set<Prompt['type']>(['order']);

export interface PromptBounds {
  ordering: boolean;
  min: number;
  max: number;
  /** How many picks Confirm needs before it lights up. */
  required: number;
}

export function isPrompt(p: GameView['pending']): p is Prompt {
  return p !== null && typeof p === 'object' && 'id' in p && 'options' in p;
}

export function isWaiting(p: GameView['pending']): p is { waitingOn: PlayerId } {
  return p !== null && typeof p === 'object' && 'waitingOn' in p;
}

/**
 * Who the table is waiting on, from this seat's point of view. Null when
 * nothing is pending or when the prompt is this seat's own.
 */
export function waitingOnOther(pending: GameView['pending'], me: PlayerId): PlayerId | null {
  if (pending === null || pending === undefined) return null;
  if (isWaiting(pending)) return pending.waitingOn === me ? null : pending.waitingOn;
  if (isPrompt(pending)) return pending.player === me ? null : pending.player;
  return null;
}

/** The prompt this seat has to answer, or null. */
export function ownPrompt(pending: GameView['pending'], me: PlayerId): Prompt | null {
  return isPrompt(pending) && pending.player === me ? pending : null;
}

export function promptBounds(prompt: Prompt): PromptBounds {
  const ordering = ORDERING_TYPES.has(prompt.type);
  const min = typeof prompt.min === 'number' ? prompt.min : 1;
  const max = typeof prompt.max === 'number' ? prompt.max : Math.max(min, 1);
  const required = ordering ? prompt.options.length : min;
  return { ordering, min, max, required };
}

export function promptReady(prompt: Prompt, picked: readonly string[]): boolean {
  const { max, required } = promptBounds(prompt);
  return picked.length >= required && picked.length <= Math.max(max, required);
}

/**
 * Toggle one option.
 *
 * A single-pick prompt **swaps** rather than refusing the second click.
 * Refusing is what makes a Discover feel stuck, because the player's second
 * click is nearly always "no, that one instead".
 */
export function togglePick(
  picked: readonly string[],
  key: string,
  opts: { ordering: boolean; max: number },
): string[] {
  if (picked.includes(key)) return picked.filter((k) => k !== key);
  if (!opts.ordering && opts.max > 0 && picked.length >= opts.max) {
    return opts.max === 1 ? [key] : [...picked];
  }
  return [...picked, key];
}

/**
 * Where a prompt is answered (LAY-4).
 *
 *  - `hand`:  every option is a card in your hand. The hand cards themselves
 *             become the toggles and a slim bar in the dock holds the controls,
 *             so you choose while looking at the cards and their order.
 *  - `board`: every option is a pile. The piles light up and toggle.
 *  - `panel`: anything else (Discover, choose-one, order, players). A panel
 *             over the board region only, never over the hand or the topbar.
 */
export type PromptPlacement = 'hand' | 'board' | 'panel';

export function allPiles(view: Pick<GameView, 'shop'>): PileView[] {
  const s = view.shop;
  return [...(s.resource ?? []), ...(s.points ?? []), ...(s.prophet ?? []), ...(s.draft ?? [])];
}

export function promptPlacement(prompt: Prompt, view: Pick<GameView, 'you' | 'shop'>): PromptPlacement {
  if (ORDERING_TYPES.has(prompt.type)) return 'panel';
  const opts = prompt.options;
  if (opts.length === 0) return 'panel';
  const hand = new Set(view.you.hand.map((c) => c.iid));
  if (opts.every((o) => typeof o.iid === 'string' && hand.has(o.iid))) return 'hand';
  const piles = new Set(allPiles(view).map((p) => p.id));
  if (opts.every((o) => typeof o.pileId === 'string' && piles.has(o.pileId))) return 'board';
  return 'panel';
}
