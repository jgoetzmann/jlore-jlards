/**
 * Keyboard, prompt selection, the log's English, and the poll cadence.
 *
 * All four are the "fluid" half of this pass rather than the animated half, and
 * all four are pure enough to test without a DOM:
 *
 *   K1  a keystroke never fires while the player is typing
 *   K2  an open prompt owns the keyboard, so a digit means one thing at a time
 *   K3  a focused button keeps Space and Enter, so one press is one action
 *   K4  keys that need a turn are inert on someone else's turn
 *   P1  a single-pick prompt swaps rather than refusing the second click
 *   P2  ordering prompts need every option before Confirm lights up
 *   L1  the log reads as sentences, and never invents a card it was not told
 *   T1  the clock is read from a deadline, not accumulated
 *   N1  acting makes the loop poll fast, and it settles back on its own
 */

import { describe, expect, it } from 'vitest';
import type { LogEntry, Prompt } from '@engine/types';
import { KEY_HELP, digitIndex, keyIntent, type KeyContext } from '@ui/keys';
import { promptBounds, promptReady, togglePick } from '@ui/prompt';
import { describeEntry, describeLog, HIDDEN_CARD, type LogNaming } from '@ui/logtext';
import { remainingSeconds, effectiveTurnSeconds, formatClock } from '@ui/TurnBar';
import {
  POLL_HOT_INTERVAL_MS,
  POLL_HOT_WINDOW_MS,
  POLL_INTERVAL_MS,
  POLL_HIDDEN_INTERVAL_MS,
  pollIntervalFor,
} from '@net/relay';

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function ctx(patch: Partial<KeyContext> = {}): KeyContext {
  return {
    yourTurn: true,
    ended: false,
    handSize: 5,
    promptOpen: false,
    promptOptionCount: 0,
    promptReady: false,
    promptCanSkip: false,
    promptHasDefault: false,
    editing: false,
    focusedTag: null,
    ...patch,
  };
}

describe('keys', () => {
  it('K1: every key is inert while the player is typing', () => {
    for (const key of ['1', 'e', ' ', 'Enter', '?', '[', 'ArrowLeft']) {
      expect(keyIntent({ key }, ctx({ editing: true }))).toBeNull();
    }
  });

  it('K1: a modifier means the keystroke belongs to the browser', () => {
    expect(keyIntent({ key: '1', ctrlKey: true }, ctx())).toBeNull();
    expect(keyIntent({ key: '1', metaKey: true }, ctx())).toBeNull();
    expect(keyIntent({ key: 'e', altKey: true }, ctx())).toBeNull();
  });

  it('plays the nth card in hand', () => {
    expect(keyIntent({ key: '1' }, ctx())).toEqual({ kind: 'playHand', index: 0 });
    expect(keyIntent({ key: '5' }, ctx())).toEqual({ kind: 'playHand', index: 4 });
  });

  it('does not play a slot the hand does not have', () => {
    expect(keyIntent({ key: '6' }, ctx({ handSize: 5 }))).toBeNull();
    expect(keyIntent({ key: '1' }, ctx({ handSize: 0 }))).toBeNull();
  });

  it('reaches a tenth card with 0, since a hand can exceed five', () => {
    // "at the start of your next turn, add X to your hand" lands in an already
    // drawn hand, so hands above five are normal here rather than exotic.
    expect(digitIndex('0')).toBe(9);
    expect(keyIntent({ key: '0' }, ctx({ handSize: 10 }))).toEqual({ kind: 'playHand', index: 9 });
  });

  it('K2: an open prompt takes the digits away from the hand', () => {
    const p = ctx({ promptOpen: true, promptOptionCount: 3 });
    expect(keyIntent({ key: '1' }, p)).toEqual({ kind: 'pickOption', index: 0 });
    expect(keyIntent({ key: '3' }, p)).toEqual({ kind: 'pickOption', index: 2 });
    expect(keyIntent({ key: '4' }, p)).toBeNull();
  });

  it('K2: nothing else reaches the table while a prompt is up', () => {
    const p = ctx({ promptOpen: true, promptOptionCount: 3 });
    expect(keyIntent({ key: 'e' }, p)).toBeNull();
    expect(keyIntent({ key: '[' }, p)).toBeNull();
    expect(keyIntent({ key: 'ArrowLeft' }, p)).toBeNull();
  });

  it('K2: Enter only confirms once the prompt is satisfied', () => {
    expect(
      keyIntent({ key: 'Enter' }, ctx({ promptOpen: true, promptOptionCount: 3, promptReady: false })),
    ).toBeNull();
    expect(
      keyIntent({ key: 'Enter' }, ctx({ promptOpen: true, promptOptionCount: 3, promptReady: true })),
    ).toEqual({ kind: 'confirmPrompt' });
  });

  it('K2: skip and default are offered only when the prompt allows them', () => {
    const bare = ctx({ promptOpen: true, promptOptionCount: 2 });
    expect(keyIntent({ key: 's' }, bare)).toBeNull();
    expect(keyIntent({ key: 'd' }, bare)).toBeNull();
    expect(keyIntent({ key: 's' }, { ...bare, promptCanSkip: true })).toEqual({ kind: 'skipPrompt' });
    expect(keyIntent({ key: 'd' }, { ...bare, promptHasDefault: true })).toEqual({ kind: 'takeDefault' });
  });

  it('K3: a focused button keeps Space and Enter for itself', () => {
    expect(keyIntent({ key: ' ' }, ctx({ focusedTag: 'button' }))).toBeNull();
    expect(
      keyIntent({ key: 'Enter' }, ctx({ focusedTag: 'button', promptOpen: true, promptReady: true })),
    ).toBeNull();
    // but a digit is not something a button answers
    expect(keyIntent({ key: '2' }, ctx({ focusedTag: 'button' }))).toEqual({
      kind: 'playHand',
      index: 1,
    });
  });

  it('K4: playing and ending need it to be your turn', () => {
    const theirs = ctx({ yourTurn: false });
    expect(keyIntent({ key: '1' }, theirs)).toBeNull();
    expect(keyIntent({ key: 'e' }, theirs)).toBeNull();
    expect(keyIntent({ key: ' ' }, theirs)).toBeNull();
  });

  it('K4: looking around still works on someone else’s turn', () => {
    const theirs = ctx({ yourTurn: false });
    expect(keyIntent({ key: 'ArrowRight' }, theirs)).toEqual({ kind: 'moveFocus', delta: 1 });
    expect(keyIntent({ key: 'l' }, theirs)).toEqual({ kind: 'toggleLog' });
    expect(keyIntent({ key: '?' }, theirs)).toEqual({ kind: 'toggleHelp' });
  });

  it('K4: a finished game accepts help and log but no play', () => {
    const over = ctx({ ended: true });
    expect(keyIntent({ key: '1' }, over)).toBeNull();
    expect(keyIntent({ key: 'e' }, over)).toBeNull();
    expect(keyIntent({ key: '?' }, over)).toEqual({ kind: 'toggleHelp' });
  });

  it('ends the turn on E or Space', () => {
    expect(keyIntent({ key: 'e' }, ctx())).toEqual({ kind: 'endTurn' });
    expect(keyIntent({ key: 'E' }, ctx())).toEqual({ kind: 'endTurn' });
    expect(keyIntent({ key: ' ' }, ctx())).toEqual({ kind: 'endTurn' });
  });

  it('nudges hand order with brackets, because adjacency is load-bearing', () => {
    expect(keyIntent({ key: '[' }, ctx())).toEqual({ kind: 'nudgeHand', delta: -1 });
    expect(keyIntent({ key: ']' }, ctx())).toEqual({ kind: 'nudgeHand', delta: 1 });
  });

  it('the help sheet lists every binding the map actually implements', () => {
    expect(KEY_HELP.length).toBeGreaterThan(5);
    const text = KEY_HELP.map((r) => `${r.keys} ${r.what}`).join(' ').toLowerCase();
    for (const needle of ['play', 'end your turn', 'confirm', 'reorder']) {
      expect(text).toContain(needle);
    }
  });
});

// ---------------------------------------------------------------------------
// Prompt selection
// ---------------------------------------------------------------------------

function prompt(patch: Partial<Prompt> = {}): Prompt {
  return {
    id: 'q1',
    type: 'discover',
    player: 'p1',
    prompt: 'Discover',
    options: [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
      { key: 'c', label: 'C' },
    ],
    min: 1,
    max: 1,
    then: [],
    ctx: {},
    defaultKeys: [],
    ...patch,
  };
}

describe('prompt selection', () => {
  it('P1: a single-pick prompt swaps rather than refusing the second pick', () => {
    const first = togglePick([], 'a', { ordering: false, max: 1 });
    expect(first).toEqual(['a']);
    expect(togglePick(first, 'b', { ordering: false, max: 1 })).toEqual(['b']);
  });

  it('P1: picking the same option again clears it', () => {
    expect(togglePick(['a'], 'a', { ordering: false, max: 1 })).toEqual([]);
  });

  it('P1: a multi-pick prompt refuses past its max instead of swapping', () => {
    const two = togglePick(togglePick([], 'a', { ordering: false, max: 2 }), 'b', {
      ordering: false,
      max: 2,
    });
    expect(two).toEqual(['a', 'b']);
    expect(togglePick(two, 'c', { ordering: false, max: 2 })).toEqual(['a', 'b']);
  });

  it('P1: an ordering prompt keeps adding, because order is the answer', () => {
    let picked: string[] = [];
    for (const key of ['c', 'a', 'b']) picked = togglePick(picked, key, { ordering: true, max: 1 });
    expect(picked).toEqual(['c', 'a', 'b']);
  });

  it('P2: an ordering prompt is ready only once every option is placed', () => {
    const p = prompt({ type: 'order' });
    expect(promptBounds(p).required).toBe(3);
    expect(promptReady(p, ['a'])).toBe(false);
    expect(promptReady(p, ['a', 'b'])).toBe(false);
    expect(promptReady(p, ['a', 'b', 'c'])).toBe(true);
  });

  it('P2: a pick-one prompt is ready at one and not at two', () => {
    const p = prompt();
    expect(promptReady(p, [])).toBe(false);
    expect(promptReady(p, ['a'])).toBe(true);
    expect(promptReady(p, ['a', 'b'])).toBe(false);
  });

  it('P2: a prompt with min 0 is ready with nothing picked, so Skip is honest', () => {
    const p = prompt({ min: 0, max: 2 });
    expect(promptReady(p, [])).toBe(true);
    expect(promptBounds(p).min).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

const naming: LogNaming = {
  player: (id) => (id === 'p1' ? 'Jack' : id),
  card: (defId) => (defId === 'temple_marketplace' ? 'Temple Marketplace' : defId),
};

function entry(kind: string, detail: Record<string, unknown>, player: string | null = 'p1'): LogEntry {
  return { seq: 1, turn: 3, player, kind, detail };
}

describe('log text', () => {
  it('L1: a buy reads as a sentence with the card name and the price', () => {
    const line = describeEntry(
      entry('buy', { iid: 'i1', defId: 'temple_marketplace', pileId: 'tm', cost: 6 }),
      naming,
    );
    expect(line.who).toBe('Jack');
    expect(line.text).toBe('buys Temple Marketplace for 6');
    expect(line.tone).toBe('buy');
  });

  it('L1: a play names the card', () => {
    expect(describeEntry(entry('play', { defId: 'temple_marketplace' }), naming).text).toBe(
      'plays Temple Marketplace',
    );
  });

  it('L1: a card the view scrubbed is never invented back into a name', () => {
    // viewFor rewrites defId to "hidden" for anything in a library or another
    // player's hand (B111). The log must not launder that back into a card.
    const line = describeEntry(entry('trash', { iid: 'i9', defId: 'hidden' }), naming);
    expect(line.text).toBe(`trashes ${HIDDEN_CARD}`);
    expect(line.text).not.toContain('temple');
  });

  it('L1: singular and plural both read correctly', () => {
    expect(describeEntry(entry('draw', { drawn: 1 }), naming).text).toBe('draws 1 card');
    expect(describeEntry(entry('draw', { drawn: 3 }), naming).text).toBe('draws 3 cards');
  });

  it('L1: a Temporary discard explains why it was trashed', () => {
    const line = describeEntry(
      entry('discard', { defId: 'temple_marketplace', then: 'trashedTemporary' }),
      naming,
    );
    expect(line.text).toContain('Temporary');
    expect(line.tone).toBe('loss');
  });

  it('L1: the end trigger explains the lap of honour rather than just firing', () => {
    const line = describeEntry(entry('endTriggered', {}), naming);
    expect(line.text).toContain('one more turn');
  });

  it('L1: an unknown kind still prints something rather than vanishing', () => {
    const line = describeEntry(entry('someFutureOp', { a: 1, b: 'x' }), naming);
    expect(line.text).toContain('someFutureOp');
    expect(line.text).toContain('a=1');
  });

  it('L1: table-level entries have no actor', () => {
    expect(describeEntry(entry('matchStart', {}, null), naming).who).toBeNull();
  });

  it('shows the newest entry first and honours the limit', () => {
    const log: LogEntry[] = [1, 2, 3, 4, 5].map((n) => ({
      seq: n,
      turn: 1,
      player: 'p1',
      kind: 'play',
      detail: { defId: 'temple_marketplace' },
    }));
    const lines = describeLog(log, naming, 3);
    expect(lines.map((l) => l.seq)).toEqual([5, 4, 3]);
  });
});

// ---------------------------------------------------------------------------
// Turn clock
// ---------------------------------------------------------------------------

describe('turn clock', () => {
  it('T1: seconds are read off a deadline, so a stalled tab cannot gain time', () => {
    const deadline = 100_000;
    expect(remainingSeconds(deadline, 100_000 - 90_000)).toBe(90);
    // Five seconds of frames dropped entirely: the clock still knows.
    expect(remainingSeconds(deadline, 100_000 - 85_000)).toBe(85);
  });

  it('T1: the clock floors at zero rather than counting negative', () => {
    expect(remainingSeconds(100, 5_000)).toBe(0);
  });

  it('Time Flail divides the limit and nothing else', () => {
    const flail = { id: 'time_flail', name: 'Time Flail', text: '' };
    expect(effectiveTurnSeconds(90, null)).toBe(90);
    expect(effectiveTurnSeconds(90, flail)).toBe(36);
    expect(effectiveTurnSeconds(90, { id: 'extra_buy', name: 'Extra Buy!', text: '' })).toBe(90);
  });

  it('formats as a clock', () => {
    expect(formatClock(90)).toBe('1:30');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(-3)).toBe('0:00');
  });
});

// ---------------------------------------------------------------------------
// Poll cadence
// ---------------------------------------------------------------------------

describe('poll cadence', () => {
  it('N1: at rest the loop keeps the one-second cadence ARCHITECTURE chose', () => {
    expect(pollIntervalFor({ hidden: false, hotUntilMs: 0, nowMs: 10_000 })).toBe(POLL_INTERVAL_MS);
  });

  it('N1: just after acting it polls fast, so your own click comes back quickly', () => {
    const now = 10_000;
    expect(pollIntervalFor({ hidden: false, hotUntilMs: now + POLL_HOT_WINDOW_MS, nowMs: now })).toBe(
      POLL_HOT_INTERVAL_MS,
    );
  });

  it('N1: the fast window expires on its own, so idle cost is unchanged', () => {
    const hotUntil = 10_000;
    expect(pollIntervalFor({ hidden: false, hotUntilMs: hotUntil, nowMs: hotUntil })).toBe(
      POLL_INTERVAL_MS,
    );
    expect(pollIntervalFor({ hidden: false, hotUntilMs: hotUntil, nowMs: hotUntil + 1 })).toBe(
      POLL_INTERVAL_MS,
    );
  });

  it('N1: a hidden tab backs off even mid-exchange', () => {
    const now = 10_000;
    expect(pollIntervalFor({ hidden: true, hotUntilMs: now + POLL_HOT_WINDOW_MS, nowMs: now })).toBe(
      POLL_HIDDEN_INTERVAL_MS,
    );
  });

  it('N1: fast is genuinely faster than resting, and resting than hidden', () => {
    expect(POLL_HOT_INTERVAL_MS).toBeLessThan(POLL_INTERVAL_MS);
    expect(POLL_INTERVAL_MS).toBeLessThan(POLL_HIDDEN_INTERVAL_MS);
  });
});
