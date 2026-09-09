/**
 * The keyboard map, as a pure function.
 *
 * A turn in this game is "play four cards, buy one, end" and every one of those
 * was a mouse trip to a different corner of the table. The map exists so a turn
 * can be typed: digits play, digits pick, Enter confirms, E ends.
 *
 * It is a pure function of (key, context) so the whole map is testable in the
 * `node` environment without a DOM, and so the help sheet in the UI is
 * generated from the same table the handler dispatches on rather than a second
 * copy of it that drifts.
 */

export type KeyIntent =
  | { kind: 'playHand'; index: number }
  | { kind: 'pickOption'; index: number }
  | { kind: 'confirmPrompt' }
  | { kind: 'skipPrompt' }
  | { kind: 'takeDefault' }
  | { kind: 'clearSelection' }
  | { kind: 'endTurn' }
  | { kind: 'nudgeHand'; delta: -1 | 1 }
  | { kind: 'moveFocus'; delta: -1 | 1 }
  | { kind: 'toggleHelp' }
  | { kind: 'toggleLog' };

export interface KeyContext {
  yourTurn: boolean;
  ended: boolean;
  handSize: number;
  /** True only when the pending prompt is *this* player's. */
  promptOpen: boolean;
  promptOptionCount: number;
  /** Enough options are selected to submit. */
  promptReady: boolean;
  promptCanSkip: boolean;
  promptHasDefault: boolean;
  /** Focus is inside a text field, so every key belongs to it. */
  editing: boolean;
  /** Lowercased tag of the focused element, so Space/Enter stay with a button. */
  focusedTag: string | null;
}

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** 1-9 then 0, so ten hand slots are reachable without a modifier. */
export function digitIndex(key: string): number | null {
  if (key.length !== 1) return null;
  if (key === '0') return 9;
  if (key >= '1' && key <= '9') return key.charCodeAt(0) - '1'.charCodeAt(0);
  return null;
}

/**
 * What this keystroke means right now, or null for "not ours — let it through".
 *
 * Order matters: an open prompt owns the keyboard completely, because a prompt
 * blocks the table anyway and a digit meaning two things at once is how you
 * discard the wrong card.
 */
export function keyIntent(e: KeyEventLike, ctx: KeyContext): KeyIntent | null {
  if (ctx.editing) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;

  const key = e.key;

  // A focused button already answers Space and Enter. Stealing them would fire
  // the button and the shortcut from one press.
  const onButton = ctx.focusedTag === 'button';
  if (onButton && (key === ' ' || key === 'Enter' || key === 'Spacebar')) return null;

  if (key === '?') return { kind: 'toggleHelp' };

  if (ctx.promptOpen) {
    const digit = digitIndex(key);
    if (digit !== null && digit < ctx.promptOptionCount) {
      return { kind: 'pickOption', index: digit };
    }
    if (key === 'Enter') return ctx.promptReady ? { kind: 'confirmPrompt' } : null;
    if (key === 'Escape' || key === 'Backspace') return { kind: 'clearSelection' };
    if (key === 's' || key === 'S') return ctx.promptCanSkip ? { kind: 'skipPrompt' } : null;
    if (key === 'd' || key === 'D') return ctx.promptHasDefault ? { kind: 'takeDefault' } : null;
    // Nothing else reaches the table while a prompt is up.
    return null;
  }

  if (key === 'l' || key === 'L') return { kind: 'toggleLog' };

  if (ctx.ended) return null;

  if (key === 'ArrowLeft') return { kind: 'moveFocus', delta: -1 };
  if (key === 'ArrowRight') return { kind: 'moveFocus', delta: 1 };
  if (key === '[') return { kind: 'nudgeHand', delta: -1 };
  if (key === ']') return { kind: 'nudgeHand', delta: 1 };

  if (!ctx.yourTurn) return null;

  const digit = digitIndex(key);
  if (digit !== null && digit < ctx.handSize) return { kind: 'playHand', index: digit };

  if (key === 'e' || key === 'E' || key === ' ' || key === 'Spacebar') {
    return { kind: 'endTurn' };
  }

  return null;
}

/** The help sheet, generated from the same map the handler uses. */
export const KEY_HELP: { keys: string; what: string }[] = [
  { keys: '1 – 9, 0', what: 'play that card in hand — or pick that option in a prompt' },
  { keys: '← →', what: 'move between cards in hand' },
  { keys: '[ ]', what: 'nudge the focused card left or right — adjacency matters' },
  { keys: 'E or Space', what: 'end your turn' },
  { keys: 'Enter', what: 'confirm a prompt' },
  { keys: 'S / D', what: 'skip a prompt / take its default' },
  { keys: 'Esc', what: 'clear the current selection' },
  { keys: 'L', what: 'show or hide the log' },
  { keys: '?', what: 'this list' },
];
