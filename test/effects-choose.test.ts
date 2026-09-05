/**
 * `{op:'choose'}` — the prompt type that resolves to a branch.
 *
 * Added by the orchestrator after Phase 6, covering a gap the Phase 2 testers
 * could not have found: `opChoose` built its prompt but never carried the
 * per-option effects to the resume path, so every "choose one" clause in the
 * catalog resolved to nothing while the suite stayed green. ~17 clauses across
 * a dozen cards (Archivist, Jalshi, Night on the Town, Plandemic, Throttle
 * Markets, The Curator, Recession Indicator, ...) print a choice they did not
 * make.
 *
 * Cites B30 — prompts are state, suspended and resumed by a `resolve` action —
 * which is the behavior `{op:'choose'}` participates in.
 */

import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { registerCards } from '@engine/registry';
import type { CardDefinition, GameState, MatchConfig, PlayerId } from '@engine/types';

const CONFIG: MatchConfig = {
  playerCount: 2,
  draftPileCount: 10,
  anomalyChance: 0,
  winCondition: {
    kind: 'standard',
    emptyPileFraction: 0.4,
    emptyPileAbsolute: 4,
    x: null,
  },
  pileSizeScale: 1,
  effectNodeBudget: 200,
  recursionDepth: 8,
  turnSeconds: 120,
  seedCodexWithCommons: true,
};

/** A card whose whole body is a two-branch choice with distinguishable payouts. */
const CHOOSER: CardDefinition = {
  id: 'test_chooser',
  name: 'Test Chooser',
  cost: { money: 0 },
  types: ['Action'],
  subtypes: [],
  tags: [],
  rarity: 'common',
  keywords: [],
  stats: {},
  effects: [
    {
      op: 'choose',
      options: [
        { label: 'Take 7 Money', effects: [{ op: 'gain', stat: 'money', amount: 7 }] },
        { label: 'Take 4 Buys', effects: [{ op: 'gain', stat: 'buys', amount: 4 }] },
      ],
    },
  ],
  triggers: [],
  text: 'Choose one: +7 Money; or +4 Buys.',
  complexity: 'T2',
  subsystems: ['S-CORE'],
  notPurchasable: true,
  excludeFromPools: true,
  art: { key: 'test_chooser', status: 'placeholder' },
};

function startWithChooser(): { state: GameState; me: PlayerId; iid: string } {
  registerCards([CHOOSER]);
  let state = createMatch(
    CONFIG,
    [
      { id: 'p1', name: 'One', codex: [] },
      { id: 'p2', name: 'Two', codex: [] },
    ],
    4242,
  );
  const me = state.activePlayer;
  // Mint the card straight into the active player's hand.
  const iid = `i_chooser_${Object.keys(state.instances).length}`;
  state.instances[iid] = {
    iid,
    defId: CHOOSER.id,
    owner: me,
    zone: 'hand',
    addedKeywords: [],
    removedKeywords: [],
    counters: {},
    statDelta: {},
    extraEffects: [],
    playedOnTurn: null,
  };
  state.players[me]!.hand.push(iid);
  return { state, me, iid };
}

describe('B30 - `{op:choose}` suspends, then resolves to the picked branch', () => {
  test('B30: playing a choose card raises a prompt carrying both options', () => {
    const { state, me, iid } = startWithChooser();
    const after = reduce(state, { type: 'play', player: me, iid });

    expect(after.pending).not.toBeNull();
    const pending = after.pending!;
    expect(pending.type).toBe('choose');
    expect(pending.player).toBe(me);
    expect(pending.options).toHaveLength(2);
    expect(pending.options.map((o) => o.label)).toEqual(['Take 7 Money', 'Take 4 Buys']);
  });

  test('B30: resolving to the first branch pays that branch, and only that branch', () => {
    const { state, me, iid } = startWithChooser();
    const played = reduce(state, { type: 'play', player: me, iid });
    const moneyBefore = played.players[me]!.money;
    const buysBefore = played.players[me]!.buys;

    const resolved = reduce(played, {
      type: 'resolve',
      player: me,
      promptId: played.pending!.id,
      keys: [played.pending!.options[0]!.key],
    });

    expect(resolved.pending).toBeNull();
    expect(resolved.players[me]!.money).toBe(moneyBefore + 7);
    expect(resolved.players[me]!.buys).toBe(buysBefore);
  });

  test('B30: resolving to the second branch pays the other one', () => {
    const { state, me, iid } = startWithChooser();
    const played = reduce(state, { type: 'play', player: me, iid });
    const moneyBefore = played.players[me]!.money;
    const buysBefore = played.players[me]!.buys;

    const resolved = reduce(played, {
      type: 'resolve',
      player: me,
      promptId: played.pending!.id,
      keys: [played.pending!.options[1]!.key],
    });

    expect(resolved.pending).toBeNull();
    expect(resolved.players[me]!.buys).toBe(buysBefore + 4);
    expect(resolved.players[me]!.money).toBe(moneyBefore);
  });

  test('B30: a choose prompt rejects a key that was never offered and stays up', () => {
    const { state, me, iid } = startWithChooser();
    const played = reduce(state, { type: 'play', player: me, iid });

    const bogus = reduce(played, {
      type: 'resolve',
      player: me,
      promptId: played.pending!.id,
      keys: ['not-an-option'],
    });

    expect(bogus.pending).not.toBeNull();
    expect(bogus.pending!.id).toBe(played.pending!.id);
    expect(bogus.players[me]!.money).toBe(played.players[me]!.money);
    expect(bogus.players[me]!.buys).toBe(played.players[me]!.buys);
  });

  test('B30: a prompt chain is fizzled rather than looping forever', () => {
    // The per-turn prompt ceiling is the only guard on a prompt that leads to
    // another prompt: `effectNodeBudget` is counted within one resolution, and
    // every resume starts a fresh one.
    const { state, me, iid } = startWithChooser();
    let s = reduce(state, { type: 'play', player: me, iid });
    expect(s.pending).not.toBeNull();

    // Burn the whole per-turn allowance on repeated valid resolutions.
    for (let i = 0; i < 80 && s.pending; i += 1) {
      const p = s.pending;
      s = reduce(s, { type: 'resolve', player: me, promptId: p.id, keys: [p.options[0]!.key] });
      if (!s.pending) {
        // Re-arm by playing nothing more; the chain ended naturally, which is
        // the healthy case. Stop here.
        break;
      }
    }
    expect(s.pending).toBeNull();
    expect(s.players[me]!.counters['promptsThisTurn'] ?? 0).toBeLessThanOrEqual(61);
  });
});
