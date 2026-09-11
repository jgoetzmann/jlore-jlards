/**
 * Prompt selection arithmetic, kept out of the component.
 *
 * The mouse and the keyboard both drive the same prompt, and a Discover that
 * accepts a click but refuses the equivalent keystroke is worse than one with
 * no keyboard at all. Putting the rules in one pure place means there is only
 * one thing to get right, and it can be tested without a DOM.
 */

import type { Prompt } from '@engine/types';

/** Prompt types where the player is ordering every option, not choosing among them. */
export const ORDERING_TYPES: ReadonlySet<Prompt['type']> = new Set<Prompt['type']>(['order']);

export interface PromptBounds {
  ordering: boolean;
  min: number;
  max: number;
  /** How many picks Confirm needs before it lights up. */
  required: number;
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
 * The rule worth naming: a single-pick prompt **swaps** rather than refusing
 * the second click. Refusing is what makes a Discover feel stuck, because the
 * player's second click is nearly always "no, that one instead".
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
