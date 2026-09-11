/**
 * Regressions found by playtesting the merged `feat/smooth-play` tracks.
 *
 * Each of these was a stuck table, a wrong number or an action nobody took, and
 * each passed the whole suite before its fix. They cite the behaviors they
 * belong to: B14/B15 (the end of the game), B19/B54/B55 (what a buy costs),
 * B30 (prompts are state), B48/B62 (tokens are never purchasable).
 */

import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { canBuyPile, priceFor } from '@engine/core/buy';
import { registerAuras, registerCards } from '@engine/registry';
import { allAuraDefinitions, allCardDefinitions } from '@cards/index';
import { viewFor } from '@engine/view';
import type {
  CardDefId,
  CardDefinition,
  GameState,
  MatchConfig,
  PileId,
  PlayerId,
} from '@engine/types';

registerCards(allCardDefinitions());
registerAuras(allAuraDefinitions());

const CFG = (playerCount: number): MatchConfig => ({
  playerCount,
  draftPileCount: 10,
  anomalyChance: 0,
  winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
  pileSizeScale: 1,
  effectNodeBudget: 500,
  recursionDepth: 8,
  turnSeconds: 90,
  seedCodexWithCommons: true,
});

const SEATS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, codex: [] as CardDefId[] }));

function match(seed: number, players = 2): GameState {
  return createMatch(CFG(players), SEATS(players), seed, null);
}

/** Put `defId` into the active player's hand and return its instance id. */
function planted(s: GameState, defId: CardDefId): string {
  const pid = s.activePlayer;
  const iid = s.players[pid]!.hand[0]!;
  s.instances[iid]!.defId = defId;
  if (!s.defsInMatch.includes(defId)) s.defsInMatch.push(defId);
  const p = s.players[pid]!;
  p.actions = Math.max(p.actions, 1);
  return iid;
}

function play(s: GameState, iid: string): GameState {
  return reduce(s, { type: 'play', player: s.activePlayer, iid });
}

function testCard(id: string, effects: CardDefinition['effects']): CardDefinition {
  return {
    id,
    name: id,
    cost: { money: 0 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects,
    triggers: [],
    text: 'A test card.',
    complexity: 'T1',
    subsystems: ['test'],
    notPurchasable: true,
    excludeFromPools: true,
  };
}

function draftTops(s: GameState): CardDefId[] {
  const out: CardDefId[] = [];
  for (const id of s.shop.order.draft) {
    const top = s.shop.piles[id]!.cards[0];
    if (top) out.push(s.instances[top]!.defId);
  }
  return out;
}

// ---------------------------------------------------------------------------
// H1 — a pile emptied by a card effect ended the game, with no score
// ---------------------------------------------------------------------------

describe('B14/B15 — only the right pile ends the game', () => {
  /**
   * Jlore carried `onPileEmpty -> endGame`, but `fireEvent` sweeps every
   * instance for a non-self event and the event names no pile, so every Jlore
   * sitting in the shop fired on ANY pile emptying. One card effect that
   * emptied a (2) Draft pile ended the match on the spot.
   */
  test('B14: emptying one Draft pile through a card effect does not end the game', () => {
    const s0 = match(7);
    const victim = s0.shop.order.draft[0]!;
    registerCards([
      testCard('test_pile_emptier', [
        { op: 'trashPile', target: { shop: 'draft', filter: { defId: s0.instances[s0.shop.piles[victim]!.cards[0]!]!.defId } } },
      ]),
    ]);
    const iid = planted(s0, 'test_pile_emptier');

    const after = play(s0, iid);

    expect(after.shop.piles[victim]!.cards).toHaveLength(0);
    expect(after.ended).toBe(false);
    expect(after.endReason).toBeNull();
    // The Jlore pile is untouched, which is the pile that ends the game.
    const jlore = after.shop.order.points.find((id) => id.includes('jlore'))!;
    expect(after.shop.piles[jlore]!.cards.length).toBeGreaterThan(0);
  });

  test('B14: the Jlore card no longer carries a pile-emptied trigger', () => {
    const jlore = allCardDefinitions().find((c) => c.id === 'jlore')!;
    expect(jlore.triggers.some((t) => t.on === 'onPileEmpty')).toBe(false);
  });

  /**
   * `{op:'endGame'}` sets `ended` from inside the interpreter, which cannot
   * score. The table read "Game over / nobody wins" and refused every action.
   */
  test('B15/B16: a card that ends the game still names its winners', () => {
    const s0 = match(11);
    registerCards([testCard('test_ends_the_game', [{ op: 'endGame', reason: 'cardEffect' }])]);
    const iid = planted(s0, 'test_ends_the_game');

    const after = play(s0, iid);

    expect(after.ended).toBe(true);
    expect(after.winners).not.toBeNull();
    expect(after.winners!.length).toBeGreaterThan(0);
    expect(after.log.some((e) => e.kind === 'gameEnd')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H2 — a token on a pile closed the shop for the rest of the match
// ---------------------------------------------------------------------------

describe('B48/B62 — a token never sits on a shop pile', () => {
  test('B62: addToPileTop refuses a notPurchasable card', () => {
    const s0 = match(3);
    registerCards([
      testCard('test_pig_stacker', [
        { op: 'addToPileTop', target: { shop: 'draft', filter: {} }, defId: 'cursed_pig', count: 1 },
      ]),
    ]);
    const iid = planted(s0, 'test_pig_stacker');

    const after = play(s0, iid);

    expect(draftTops(after)).not.toContain('cursed_pig');
    expect(after.log.some((e) => e.kind === 'addToPileTopRefused')).toBe(true);
  });

  /**
   * Water Into Swine used to do exactly that to all ten Draft piles at once:
   * `canBuyPile` refuses a pile whose top is notPurchasable, nothing ever
   * removed the Pig, and the whole Draft Shop was dead for the rest of the game
   * — along with the empty-draft-piles end condition. SB-66.
   */
  test('B48: Water Into Swine leaves every Draft pile buyable', () => {
    const s0 = match(1, 2);
    const pid = s0.activePlayer;
    const iid = planted(s0, 'water_into_swine');

    const after = play(s0, iid);
    after.players[pid]!.money = 20;

    expect(draftTops(after)).not.toContain('cursed_pig');
    const nonEmpty = after.shop.order.draft.filter((id) => after.shop.piles[id]!.cards.length > 0);
    expect(nonEmpty.length).toBeGreaterThan(0);
    for (const id of nonEmpty) {
      expect(canBuyPile(after, pid, id), id).toBe(true);
    }
    // It is still an attack: the Pig lands where tokens are allowed.
    for (const other of after.playerOrder.filter((o) => o !== pid)) {
      const gy = after.players[other]!.gy.map((i) => after.instances[i]!.defId);
      expect(gy).toContain('cursed_pig');
    }
  });
});

// ---------------------------------------------------------------------------
// H3 — a "choose" gain that never asked
// ---------------------------------------------------------------------------

describe('B30 — a gain that says "choose" asks', () => {
  /**
   * The count sits on the NODE, not on `from`, so the pile resolver saw no
   * count, defaulted to "every matching pile", and short-circuited — Blubber
   * Baron silently took the first two piles in shop order.
   */
  test('B30: Blubber Baron prompts instead of taking the first two piles', () => {
    const s0 = match(2, 2);
    const pid = s0.activePlayer;
    const iid = planted(s0, 'blubber_baron');

    const after = play(s0, iid);

    expect(after.pending).not.toBeNull();
    expect(after.pending!.type).toBe('selectPile');
    expect(after.pending!.player).toBe(pid);
    // "Add UP TO 2": at most two, and the player may decline.
    expect(after.pending!.max).toBe(2);
    expect(after.pending!.min).toBe(0);
    expect(after.pending!.options.length).toBeGreaterThan(2);
    // Nothing is gained until the choice is made.
    expect(after.players[pid]!.gy.length).toBe(s0.players[pid]!.gy.length);
  });

  test('B30: answering it gains exactly the piles that were chosen', () => {
    const s0 = match(2, 2);
    const pid = s0.activePlayer;
    const iid = planted(s0, 'blubber_baron');
    const asked = play(s0, iid);
    const pick = asked.pending!.options[1]!;
    const gyBefore = asked.players[pid]!.gy.length;

    const done = reduce(asked, {
      type: 'resolve',
      player: pid,
      promptId: asked.pending!.id,
      keys: [pick.key],
    });

    expect(done.pending).toBeNull();
    expect(done.players[pid]!.gy.length).toBe(gyBefore + 1);
    const gained = done.instances[done.players[pid]!.gy[done.players[pid]!.gy.length - 1]!]!;
    expect(gained.defId).toBe(pick.defId);
  });
});

// ---------------------------------------------------------------------------
// MP-2 / MP-3 — a discount the shop gate did not know about
// ---------------------------------------------------------------------------

describe('B19/B54 — a discounted buy is allowed, and charges the discount', () => {
  /** Miracle Prep: "your next buy costs 2 less". */
  function withDiscount(seed: number): { s: GameState; pid: PlayerId; silver: PileId } {
    const s0 = match(seed, 2);
    const pid = s0.activePlayer;
    const iid = planted(s0, 'miracle_prep');
    const s = play(s0, iid);
    const silver = s.shop.order.resource.find(
      (id) => s.instances[s.shop.piles[id]!.cards[0]!]!.defId === 'silver',
    )!;
    return { s, pid, silver };
  }

  test('B19: the shop gate prices with the discount, so the lit Buy is honoured', () => {
    const { s, pid, silver } = withDiscount(21);
    s.players[pid]!.money = 1; // Silver is (3), discounted to (1).

    expect(priceFor(s, pid === s.activePlayer ? silver : silver, pid)).toBe(1);
    expect(canBuyPile(s, pid, silver)).toBe(true);
    // What the table shows is what the engine will accept.
    const pileView = viewFor(s, pid).shop.resource.find((p) => p.id === silver)!;
    expect(pileView.cost).toBe(1);
    expect(pileView.top!.affordable).toBe(true);

    const after = reduce(s, { type: 'buy', player: pid, pileId: silver });
    expect(after.log.some((e) => e.kind === 'reject')).toBe(false);
    expect(after.shop.piles[silver]!.cards.length).toBe(s.shop.piles[silver]!.cards.length - 1);
  });

  test('B54: the buy charges the price the table showed, not the printed cost', () => {
    const { s, pid, silver } = withDiscount(21);
    s.players[pid]!.money = 3;
    const shown = viewFor(s, pid).shop.resource.find((p) => p.id === silver)!.cost;
    expect(shown).toBe(1);

    const after = reduce(s, { type: 'buy', player: pid, pileId: silver });

    const bought = [...after.log].reverse().find((e) => e.kind === 'buy')!;
    expect(bought.detail.paid).toBe(shown);
    expect(after.players[pid]!.money).toBe(3 - 1);
  });
});
