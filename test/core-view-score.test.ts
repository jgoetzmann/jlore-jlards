/**
 * What the VP number on screen actually means.
 *
 * `player.vp` holds effect-granted VP only — printed VP is counted off the deck
 * by `scoreFor`, and `liveVp` (which is `scoreFor`) is the number the Crown,
 * Duel and Heavy is the Crown variants end the game on. The view used to ship
 * `player.vp`, so the table read "VP 0" while you held three Tix and those
 * variants would have ended on a number no player could see coming.
 *
 *   V1  your own VP is your live score, including printed VP on your deck
 *   V2  an opponent's VP is their live score too, so the race is legible
 *   V3  a secret value never reaches an opponent, not even folded into a total
 */

import { describe, expect, it } from 'vitest';
import { createMatch } from '@engine/index';
import { viewFor } from '@engine/view';
import { liveVp, publicVp, scoreFor } from '@engine/meta';
import type { GameState, MatchConfig } from '@engine/types';

function config(): MatchConfig {
  return {
    playerCount: 2,
    draftPileCount: 10,
    anomalyChance: 0,
    winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
    pileSizeScale: 1,
    effectNodeBudget: 2000,
    recursionDepth: 8,
    turnSeconds: 90,
    seedCodexWithCommons: true,
  };
}

function match(seed = 4242): GameState {
  return createMatch(
    config(),
    [
      { id: 'p1', name: 'A', codex: [] },
      { id: 'p2', name: 'B', codex: [] },
    ],
    seed,
  );
}

describe('view / VP is the live score', () => {
  it('V1: the opening hand of 7 Copper + 3 Tix is worth 3, and the view says so', () => {
    const state = match();
    // The starting deck is fixed by SB/§2.2, so this number is not seed-dependent.
    expect(scoreFor(state, 'p1')).toBe(3);
    expect(viewFor(state, 'p1').you.vp).toBe(3);
  });

  it('V1: the view agrees with the number the win conditions read', () => {
    const state = match();
    expect(viewFor(state, 'p1').you.vp).toBe(liveVp(state, 'p1'));
  });

  it('V1: effect-granted VP is still counted, on top of printed VP', () => {
    const state = match();
    state.players['p1']!.vp = 5;
    expect(viewFor(state, 'p1').you.vp).toBe(8);
  });

  it('V2: an opponent’s VP is their live score, so the race is visible', () => {
    const state = match();
    const seen = viewFor(state, 'p1').others.find((o) => o.id === 'p2');
    expect(seen?.vp).toBe(scoreFor(state, 'p2'));
    expect(seen?.vp).toBe(3);
  });

  it('V3: a secret value counts for its owner', () => {
    const state = match();
    const iid = state.players['p2']!.hand[0]!;
    state.instances[iid]!.secret = { vp: 40 };
    expect(viewFor(state, 'p2').you.vp).toBe(43);
  });

  it('V3: and never reaches an opponent, not even inside a total', () => {
    // Ascendant Spread banks its real value in `secret`. A total that folded it
    // in would leak the secret by arithmetic — the same leak as printing the
    // card, only harder to notice.
    const state = match();
    const iid = state.players['p2']!.hand[0]!;
    state.instances[iid]!.secret = { vp: 40 };

    const seen = viewFor(state, 'p1').others.find((o) => o.id === 'p2');
    expect(seen?.vp).toBe(3);
    expect(publicVp(state, 'p2')).toBe(3);
    expect(liveVp(state, 'p2')).toBe(43);
  });

  it('V3: a serialized opponent view never contains the secret number', () => {
    const state = match();
    const iid = state.players['p2']!.hand[0]!;
    state.instances[iid]!.secret = { vp: 9137 };
    const serialized = JSON.stringify(viewFor(state, 'p1'));
    expect(serialized).not.toContain('9137');
  });
});
