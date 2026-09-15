/**
 * Buy-path NextCardMod effects (card-text audit follow-up).
 *
 * `peekBuyMods`/`consumeBuyMods` used to read costDelta, costFloor and buyTo
 * alone, so three printed mechanics never happened: Frankenstein's refund and
 * fusion rider, Scripture of Kwzki's granted Play on Buy, and New Banner Day's
 * conditional pile gain. Every test below fails on that engine and passes once
 * the buy path runs `appendEffects` (sourced at the bought card), honors
 * `skip`, grants `grantKeyword`, and gates `filter` the way the play path does.
 */

import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { costOf } from '@engine/shop';
import { getCard } from '@engine/registry';
import { hasKeyword } from '@engine/systems';
import type {
  CardDefId,
  GameState,
  InstanceId,
  MatchConfig,
  NextCardMod,
  PileId,
  PlayerId,
} from '@engine/types';

function mkConfig(): MatchConfig {
  return {
    playerCount: 2,
    draftPileCount: 10,
    anomalyChance: 0,
    winCondition: { kind: 'standard', emptyPileFraction: 0.4, emptyPileAbsolute: 4, x: null },
    pileSizeScale: 1,
    effectNodeBudget: 500,
    recursionDepth: 8,
    turnSeconds: 90,
    seedCodexWithCommons: true,
  };
}

function mkMatch(seed: number): GameState {
  return createMatch(
    mkConfig(),
    [
      { id: 'p1', name: 'One', codex: [] },
      { id: 'p2', name: 'Two', codex: [] },
    ],
    seed,
    null,
  );
}

function mint(state: GameState, defId: string, owner: PlayerId): InstanceId {
  const iid = `i_test_${defId}_${Object.keys(state.instances).length}`;
  state.instances[iid] = {
    iid,
    defId,
    owner,
    zone: 'hand',
    addedKeywords: [],
    removedKeywords: [],
    counters: {},
    statDelta: {},
    extraEffects: [],
    playedOnTurn: null,
  };
  state.players[owner]!.hand.push(iid);
  return iid;
}

function topDefId(s: GameState, pileId: PileId): CardDefId {
  return s.instances[s.shop.piles[pileId]!.cards[0]!]!.defId;
}

function pileByTopName(s: GameState, shop: 'resource' | 'draft', name: string): PileId {
  const found = s.shop.order[shop].find((id) => getCard(topDefId(s, id)).name === name);
  if (!found) throw new Error('no ' + shop + ' pile printing ' + name);
  return found;
}

function pileByTopDef(s: GameState, defId: CardDefId): PileId {
  for (const id of Object.keys(s.shop.piles)) {
    const pile = s.shop.piles[id as PileId];
    if (pile && pile.cards.length > 0 && s.instances[pile.cards[0]!]!.defId === defId) {
      return id as PileId;
    }
  }
  throw new Error('no pile currently topped by ' + defId);
}

function printedCost(defId: CardDefId): number {
  return getCard(defId).cost.money ?? 0;
}

function gyDefIds(s: GameState, me: PlayerId): CardDefId[] {
  return s.players[me]!.gy.map((iid) => s.instances[iid]!.defId);
}

/** Play a minted card from hand with plenty of actions. */
function playMinted(s: GameState, me: PlayerId, defId: string): GameState {
  const t = structuredClone(s);
  t.players[me]!.actions = 5;
  const iid = mint(t, defId, me);
  return reduce(t, { type: 'play', player: me, iid });
}

describe('buy appendEffects run sourced at the bought card', () => {
  test("Frankenstein refunds 50% (round down) of the first purchase's cost", () => {
    const s0 = mkMatch(7101);
    const me = s0.activePlayer;
    const silver = pileByTopName(s0, 'resource', 'Silver');

    let s = playMinted(s0, me, 'frankenstein');
    // Frankenstein is Flimsy: arming the mods is all its play does.
    expect(s.pending).toBeNull();
    s = structuredClone(s);
    s.players[me]!.money = 20;
    s.players[me]!.buys = 2;

    const cost = costOf(s, silver, me);
    expect(cost).toBe(3);
    const after = reduce(s, { type: 'buy', player: me, pileId: silver });

    expect(gyDefIds(after, me).filter((d) => d === topDefId(s0, silver)).length).toBe(1);
    expect(after.players[me]!.money).toBe(20 - cost + Math.floor(cost / 2));
  });

  test('Frankenstein fuses the second purchase with the first', () => {
    const s0 = mkMatch(7102);
    const me = s0.activePlayer;
    const copper = pileByTopName(s0, 'resource', 'Copper');
    const silver = pileByTopName(s0, 'resource', 'Silver');
    const copperDef = topDefId(s0, copper);
    const silverDef = topDefId(s0, silver);

    let s = playMinted(s0, me, 'frankenstein');
    s = structuredClone(s);
    s.players[me]!.money = 30;
    s.players[me]!.buys = 3;

    const first = reduce(s, { type: 'buy', player: me, pileId: copper });
    // Copper costs 0: the refund is 0 and only the second purchase fuses.
    expect(first.players[me]!.money).toBe(30);
    const firstBought = first.players[me]!.gy[first.players[me]!.gy.length - 1]!;

    const second = reduce(first, { type: 'buy', player: me, pileId: silver });
    // Silver costs 3 and the refund window is spent: no second refund.
    expect(second.players[me]!.money).toBe(27);

    const fused = Object.values(second.instances).filter(
      (i) => i.owner === me && i.fusedFrom && i.fusedFrom.length === 2,
    );
    expect(fused.length).toBe(1);
    expect([...fused[0]!.fusedFrom!].sort()).toEqual([copperDef, silverDef].sort());
    // Both components are consumed: the second is trashed, the first is the host.
    expect(second.instances[firstBought]!.defId).not.toBe(copperDef);
  });
});

describe('buy grantKeyword reaches the bought card', () => {
  test('a granted Play on Buy is played free on purchase', () => {
    const s0 = mkMatch(7103);
    const me = s0.activePlayer;
    const copper = pileByTopName(s0, 'resource', 'Copper');

    const s = structuredClone(s0);
    s.players[me]!.money = 10;
    s.players[me]!.buys = 2;
    const mod: NextCardMod = { appliesTo: 'buy', grantKeyword: 'PlayOnBuy', uses: 9 };
    s.players[me]!.nextCardMods.push(mod);

    const after = reduce(s, { type: 'buy', player: me, pileId: copper });
    const boughtIid =
      after.players[me]!.playedThisTurn[after.players[me]!.playedThisTurn.length - 1]!;
    expect(after.instances[boughtIid]).toBeDefined();
    expect(hasKeyword(after, boughtIid, 'PlayOnBuy')).toBe(true);
    // The free play happened: the bought card resolved through play, not just GY.
    expect(after.players[me]!.playedThisTurn).toContain(boughtIid);
    // Nine uses minus this purchase.
    expect(
      after.players[me]!.nextCardMods.filter((m) => m.appliesTo === 'buy').length,
    ).toBe(1);
    expect(after.players[me]!.nextCardMods[0]!.uses).toBe(8);
  });
});

describe('buy skip defers a mod to a later purchase', () => {
  test('a skipped discount prices the first buy in full and the second reduced', () => {
    const s0 = mkMatch(7104);
    const me = s0.activePlayer;
    const silver = pileByTopName(s0, 'resource', 'Silver');
    expect(costOf(s0, silver, me)).toBe(3);

    const s = structuredClone(s0);
    s.players[me]!.money = 10;
    s.players[me]!.buys = 2;
    s.players[me]!.nextCardMods.push({ appliesTo: 'buy', costDelta: -2, skip: 1, uses: 1 });

    const first = reduce(s, { type: 'buy', player: me, pileId: silver });
    expect(first.players[me]!.money).toBe(7);
    // Skipped, not spent.
    expect(first.players[me]!.nextCardMods.length).toBe(1);
    expect(first.players[me]!.nextCardMods[0]!.skip).toBe(0);

    const second = reduce(first, { type: 'buy', player: me, pileId: silver });
    expect(second.players[me]!.money).toBe(6);
    expect(second.players[me]!.nextCardMods.length).toBe(0);
  });
});

describe('New Banner Day', () => {
  /**
   * Play Banner Day and resolve its discover, returning state + picked defId.
   * The shop-wide pool can offer Prophet-shop cards, which money cannot buy,
   * so the banner is the first money-cost option — deterministic per seed.
   */
  function armBanner(s0: GameState, me: PlayerId): { s: GameState; banner: CardDefId } {
    const played = playMinted(s0, me, 'new_banner_day');
    const pending = played.pending;
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('discover');
    const idx = pending!.options.findIndex(
      (o) => typeof getCard(o.defId!).cost.money === 'number',
    );
    if (idx < 0) throw new Error('seed offered no money-cost banner');
    const banner = pending!.options[idx]!.defId!;
    const s = reduce(played, {
      type: 'resolve',
      player: me,
      promptId: pending!.id,
      keys: [pending!.options[idx]!.key],
    });
    expect(s.pending).toBeNull();
    return { s, banner };
  }

  test('a later different buy at or above the banner cost gains from the banner pile', () => {
    const s0 = mkMatch(7105);
    const me = s0.activePlayer;
    const { s: armed, banner } = armBanner(s0, me);
    const bannerCost = armed.players[me]!.counters['turn:bannerCost'];
    expect(typeof bannerCost).toBe('number');

    // The most expensive pile printing anything else is the safest qualifier.
    const candidates = (Object.keys(armed.shop.piles) as PileId[])
      .filter((id) => {
        const pile = armed.shop.piles[id]!;
        if (pile.cards.length === 0) return false;
        return armed.instances[pile.cards[0]!]!.defId !== banner;
      })
      .sort((a, b) => printedCost(topDefId(armed, b)) - printedCost(topDefId(armed, a)));
    expect(candidates.length).toBeGreaterThan(0);
    const target = candidates[0]!;
    expect(printedCost(topDefId(armed, target))).toBeGreaterThanOrEqual(bannerCost!);

    const s = structuredClone(armed);
    s.players[me]!.money = 100;
    s.players[me]!.buys = 3;
    const after = reduce(s, { type: 'buy', player: me, pileId: target });

    expect(gyDefIds(after, me).filter((d) => d === banner).length).toBe(1);
  });

  test('buying the banner card itself neither fires nor spends the banner', () => {
    const s0 = mkMatch(7106);
    const me = s0.activePlayer;
    const { s: armed, banner } = armBanner(s0, me);

    const bannerPile = pileByTopDef(armed, banner);
    const s = structuredClone(armed);
    s.players[me]!.money = 100;
    s.players[me]!.buys = 3;
    const same = reduce(s, { type: 'buy', player: me, pileId: bannerPile });

    // Exactly the bought copy, no rider gain.
    expect(gyDefIds(same, me).filter((d) => d === banner).length).toBe(1);
    // A filtered-out card neither consumes nor receives: the mod is intact.
    const mods = same.players[me]!.nextCardMods.filter((m) => m.appliesTo === 'buy');
    expect(mods.length).toBe(1);
    expect(mods[0]!.uses).toBe(9);

    // And the banner still fires on a later qualifying buy.
    const candidates = (Object.keys(same.shop.piles) as PileId[]).filter((id) => {
      const pile = same.shop.piles[id]!;
      if (pile.cards.length === 0) return false;
      return same.instances[pile.cards[0]!]!.defId !== banner;
    });
    const bannerCost = same.players[me]!.counters['turn:bannerCost']!;
    const target = candidates.find((id) => printedCost(topDefId(same, id)) >= bannerCost)!;
    expect(target).toBeDefined();
    const t = structuredClone(same);
    t.players[me]!.money = 100;
    t.players[me]!.buys = 3;
    const fired = reduce(t, { type: 'buy', player: me, pileId: target });
    expect(gyDefIds(fired, me).filter((d) => d === banner).length).toBe(2);
  });

  test('a leaked banner from an earlier turn cannot fire', () => {
    const s0 = mkMatch(7107);
    const me = s0.activePlayer;
    const { s: armed, banner } = armBanner(s0, me);
    expect(armed.players[me]!.nextCardMods.length).toBe(1);

    // Simulate the turn rolling over with the mod still armed.
    const later = structuredClone(armed);
    later.turn += 1;
    later.players[me]!.money = 100;
    later.players[me]!.buys = 3;
    const candidates = (Object.keys(later.shop.piles) as PileId[]).filter((id) => {
      const pile = later.shop.piles[id]!;
      if (pile.cards.length === 0) return false;
      return later.instances[pile.cards[0]!]!.defId !== banner;
    });
    const target = candidates.sort(
      (a, b) => printedCost(topDefId(later, b)) - printedCost(topDefId(later, a)),
    )[0]!;
    const after = reduce(later, { type: 'buy', player: me, pileId: target });

    expect(gyDefIds(after, me).filter((d) => d === banner).length).toBe(0);
    // The turn fence held: the mod spent a use knocking on a closed turn.
    const mods = after.players[me]!.nextCardMods.filter((m) => m.appliesTo === 'buy');
    expect(mods.length).toBe(1);
    expect(mods[0]!.uses).toBe(8);
  });
});
