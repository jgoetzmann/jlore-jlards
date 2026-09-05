import { describe, expect, test } from 'vitest';
import { createMatch, reduce } from '@engine/index';
import { plagueTokensOn } from '@engine/systems';
import { renderCardText } from '@engine/view';
import { allCards, getCard } from '@engine/registry';
import type {
  CardDefId,
  GameState,
  InstanceId,
  MatchConfig,
  PileId,
  PlayerId,
  Zone,
} from '@engine/types';

// --- inline fixtures -------------------------------------------------------

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function mkConfig(over: Partial<MatchConfig> = {}): MatchConfig {
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
    ...over,
  };
}

function mkMatch(seed: number, over: Partial<MatchConfig> = {}): GameState {
  return createMatch(
    mkConfig(over),
    [
      { id: 'p1', name: 'One', codex: [] },
      { id: 'p2', name: 'Two', codex: [] },
    ],
    seed,
    null,
  );
}

function topDefId(s: GameState, pileId: PileId): CardDefId {
  return s.instances[s.shop.piles[pileId]!.cards[0]!]!.defId;
}

function pileByName(s: GameState, shop: 'resource' | 'points', name: string): PileId {
  const found = s.shop.order[shop].find((id) => getCard(topDefId(s, id)).name === name);
  if (!found) throw new Error('no ' + shop + ' pile printing ' + name);
  return found;
}

function addInstance(
  s: GameState,
  defId: CardDefId,
  iid: InstanceId,
  owner: PlayerId,
  zone: 'hand' | 'gy' | 'library' | 'play',
): GameState {
  const n = clone(s);
  n.instances[iid] = {
    iid,
    defId,
    owner,
    zone,
    addedKeywords: [],
    removedKeywords: [],
    counters: {},
    statDelta: {},
    extraEffects: [],
    playedOnTurn: null,
  };
  n.players[owner]![zone].push(iid);
  return n;
}

/** Clear any prompt the previous card raised so the next step is isolated. */
function ready(s: GameState, player: PlayerId): GameState {
  const n = clone(s);
  n.pending = null;
  n.queue = [];
  n.players[player]!.actions = 5;
  n.players[player]!.money = 10;
  return n;
}

function cardNamed(name: string) {
  return allCards().find((c) => c.name === name);
}

const SEEDS = [1, 2, 3, 17, 99];

// --- B62 -------------------------------------------------------------------

describe('B62 - token cards are never purchasable', () => {
  test('B62: every card with rarity token is flagged notPurchasable', () => {
    const tokens = allCards().filter((c) => c.rarity === 'token');
    expect(tokens.length).toBeGreaterThan(0);
    for (const c of tokens) {
      expect(c.notPurchasable).toBe(true);
    }
  });

  test('B62: every Token-typed card is flagged notPurchasable', () => {
    const tokens = allCards().filter((c) => c.types.includes('Token'));
    expect(tokens.length).toBeGreaterThan(0);
    for (const c of tokens) {
      expect(c.notPurchasable).toBe(true);
    }
  });

  test('B62: no notPurchasable card ever sits in any shop pile', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = mkMatch(seed);
      for (const pileId of Object.keys(s.shop.piles)) {
        for (const iid of s.shop.piles[pileId]!.cards) {
          expect(getCard(s.instances[iid]!.defId).notPurchasable ?? false).toBe(false);
        }
      }
    }
  });

  test('B62: no notPurchasable card is ever dealt into a starting deck', () => {
    for (const seed of SEEDS) {
      const s = mkMatch(seed);
      for (const pid of s.playerOrder) {
        const owned = [
          ...s.players[pid]!.library,
          ...s.players[pid]!.hand,
          ...s.players[pid]!.gy,
          ...s.players[pid]!.play,
        ];
        for (const iid of owned) {
          expect(getCard(s.instances[iid]!.defId).notPurchasable ?? false).toBe(false);
        }
      }
    }
  });
});

// --- B63 -------------------------------------------------------------------

describe('B63 - instance counters survive zone changes', () => {
  test('B63: counters survive the end-of-turn discard into the GY', () => {
    const s0 = mkMatch(82);
    const me = s0.activePlayer;
    const iid = s0.players[me]!.hand[0]!;

    const s = clone(s0);
    s.instances[iid]!.counters = { plague: 2, upgrades: 1 };

    const after = reduce(s, { type: 'endTurn', player: me });
    expect(after.instances[iid]!.zone).toBe('gy');
    expect(after.instances[iid]!.counters).toEqual({ plague: 2, upgrades: 1 });
  });

  test('B63: counters survive a reshuffle of the GY back into the Library', () => {
    const s0 = mkMatch(83);
    const me = s0.activePlayer;
    const iid = s0.players[me]!.hand[0]!;

    const s = clone(s0);
    s.instances[iid]!.counters = { plague: 2, upgrades: 1 };
    // Force the reshuffle: everything but the hand starts in the GY.
    for (const l of s.players[me]!.library) s.instances[l]!.zone = 'gy';
    s.players[me]!.gy.push(...s.players[me]!.library);
    s.players[me]!.library = [];

    const after = reduce(s, { type: 'endTurn', player: me });
    const zone: Zone = after.instances[iid]!.zone;
    expect(['library', 'hand']).toContain(zone);
    expect(after.instances[iid]!.counters).toEqual({ plague: 2, upgrades: 1 });
  });

  test('B63: counters are unchanged after several full turn cycles', () => {
    const s0 = mkMatch(84);
    const me = s0.activePlayer;
    const iid = s0.players[me]!.hand[0]!;

    let cur = clone(s0);
    cur.instances[iid]!.counters = { plague: 3 };
    for (let i = 0; i < 6; i++) {
      cur = reduce(ready(cur, cur.activePlayer), { type: 'endTurn', player: cur.activePlayer });
      expect(cur.instances[iid]!.counters).toEqual({ plague: 3 });
    }
    expect(cur.instances[iid]!.counters.plague).toBe(3);
  });

  test('B63: a counter on one instance never appears on another instance', () => {
    const s0 = mkMatch(85);
    const me = s0.activePlayer;
    const a = s0.players[me]!.hand[0]!;
    const b = s0.players[me]!.hand[1]!;

    const s = clone(s0);
    s.instances[a]!.counters = { plague: 4 };

    const after = reduce(s, { type: 'endTurn', player: me });
    expect(after.instances[a]!.counters.plague).toBe(4);
    expect(after.instances[b]!.counters.plague ?? 0).toBe(0);
  });
});

// --- B64 -------------------------------------------------------------------

describe('B64 - self-counting cards keep a per-player per-defId play count', () => {
  test('B64: the five named self-counting cards all exist in the registry', () => {
    for (const name of [
      'Lection',
      'Journey to the Moon',
      'Wish Upon the Stars',
      'Coal',
      'Runebinder',
    ]) {
      expect(cardNamed(name), name).toBeDefined();
    }
  });

  test('B64: playing a self-counting card increments that player play count for its defId', () => {
    const coal = cardNamed('Coal');
    expect(coal).toBeDefined();
    const defId = coal!.id;

    const s0 = mkMatch(86);
    const me = s0.activePlayer;
    const s = addInstance(ready(s0, s0.activePlayer), defId, 'test_coal_1', me, 'hand');

    const after = reduce(s, { type: 'play', player: me, iid: 'test_coal_1' });
    expect(after.players[me]!.playCounts[defId]).toBe(1);
  });

  test('B64: the play count keeps rising across turns and never resets', () => {
    const coal = cardNamed('Coal');
    expect(coal).toBeDefined();
    const defId = coal!.id;

    const s0 = mkMatch(87);
    const me = s0.activePlayer;
    let cur = addInstance(ready(s0, s0.activePlayer), defId, 'test_coal_1', me, 'hand');
    cur = reduce(cur, { type: 'play', player: me, iid: 'test_coal_1' });
    expect(cur.players[me]!.playCounts[defId]).toBe(1);

    cur = reduce(ready(cur, me), { type: 'endTurn', player: me });
    cur = reduce(ready(cur, cur.activePlayer), { type: 'endTurn', player: cur.activePlayer });
    expect(cur.activePlayer).toBe(me);
    expect(cur.players[me]!.playCounts[defId]).toBe(1);

    cur = addInstance(ready(cur, me), defId, 'test_coal_2', me, 'hand');
    cur = reduce(cur, { type: 'play', player: me, iid: 'test_coal_2' });
    expect(cur.players[me]!.playCounts[defId]).toBe(2);
  });

  test('B64: one player playing the card leaves the other player count at 0', () => {
    const coal = cardNamed('Coal');
    expect(coal).toBeDefined();
    const defId = coal!.id;

    const s0 = mkMatch(88);
    const me = s0.activePlayer;
    const other = s0.playerOrder.find((p) => p !== me)!;
    const s = addInstance(ready(s0, s0.activePlayer), defId, 'test_coal_1', me, 'hand');

    const after = reduce(s, { type: 'play', player: me, iid: 'test_coal_1' });
    expect(after.players[other]!.playCounts[defId] ?? 0).toBe(0);
  });
});

// --- B65 -------------------------------------------------------------------

describe('B65 - plague tokens live on one instance and travel with it', () => {
  test('B65: plagueTokensOn reads a plague counter on an instance sitting in a shop pile', () => {
    const s0 = mkMatch(89);
    const copper = pileByName(s0, 'resource', 'Copper');

    const s = clone(s0);
    const top = s.shop.piles[copper]!.cards[0]!;
    s.instances[top]!.counters.plague = 2;

    expect(s.instances[top]!.zone).toBe('shop');
    expect(plagueTokensOn(s, top)).toBe(2);
  });

  test('B65: plague tokens persist when the instance is bought out of the pile', () => {
    const s0 = mkMatch(90);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');

    const s = clone(s0);
    const top = s.shop.piles[copper]!.cards[0]!;
    s.instances[top]!.counters.plague = 2;
    s.players[me]!.money = 5;
    s.players[me]!.buys = 1;

    const after = reduce(s, { type: 'buy', player: me, pileId: copper });
    expect(after.players[me]!.gy).toContain(top);
    expect(plagueTokensOn(after, top)).toBe(2);
  });

  test('B65: plagueTokensOn returns 0 for an instance carrying no plague counter', () => {
    const s = mkMatch(91);
    const me = s.activePlayer;
    const iid = s.players[me]!.hand[0]!;
    expect(plagueTokensOn(s, iid)).toBe(0);
  });

  test('B65: plague on one card in a pile does not spread to the next card in that pile', () => {
    const s0 = mkMatch(92);
    const me = s0.activePlayer;
    const copper = pileByName(s0, 'resource', 'Copper');

    const s = clone(s0);
    const top = s.shop.piles[copper]!.cards[0]!;
    const second = s.shop.piles[copper]!.cards[1]!;
    s.instances[top]!.counters.plague = 3;
    s.players[me]!.money = 5;
    s.players[me]!.buys = 2;

    expect(plagueTokensOn(s, second)).toBe(0);
    const after = reduce(s, { type: 'buy', player: me, pileId: copper });
    expect(plagueTokensOn(after, top)).toBe(3);
    expect(plagueTokensOn(after, second)).toBe(0);
  });
});

// --- B66 -------------------------------------------------------------------

describe('B66 - renderCardText substitutes live counter values', () => {
  const templated = allCards().find((c) => /\{[A-Za-z][A-Za-z0-9_]*\}/.test(c.text));
  const tokenNames = (text: string): string[] =>
    (text.match(/\{[A-Za-z][A-Za-z0-9_]*\}/g) ?? []).map((t) => t.slice(1, -1));

  test('B66: renderCardText leaves no unresolved {token} in the rendered text', () => {
    expect(templated).toBeDefined();
    const s0 = mkMatch(93);
    const me = s0.activePlayer;
    const s = addInstance(s0, templated!.id, 'test_tmpl_1', me, 'hand');

    const out = renderCardText(s, 'test_tmpl_1', me);
    expect(out).not.toMatch(/\{[A-Za-z][A-Za-z0-9_]*\}/);
  });

  test('B66: two instances with different counters render different text', () => {
    expect(templated).toBeDefined();
    const s0 = mkMatch(94);
    const me = s0.activePlayer;
    let s = addInstance(s0, templated!.id, 'test_tmpl_a', me, 'hand');
    s = addInstance(s, templated!.id, 'test_tmpl_b', me, 'hand');

    const names = tokenNames(templated!.text);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) s.instances['test_tmpl_b']!.counters[n] = 9;

    const plain = renderCardText(s, 'test_tmpl_a', me);
    const loaded = renderCardText(s, 'test_tmpl_b', me);
    expect(loaded).not.toBe(plain);
    expect(loaded).toContain('9');
  });

  test('B66: a card whose text has no template token renders verbatim', () => {
    const flat = allCards().find((c) => c.text.length > 0 && !c.text.includes('{'));
    expect(flat).toBeDefined();
    const s0 = mkMatch(95);
    const me = s0.activePlayer;
    const s = addInstance(s0, flat!.id, 'test_flat_1', me, 'hand');

    expect(renderCardText(s, 'test_flat_1', me)).toBe(flat!.text);
  });
});
