/**
 * A.20 — Grubbing Goblins.
 *
 * The `grubbing_goblin` token is `PlayOnDraw` + `Flimsy` with `stats.money = 2`,
 * so every Goblin in the deck is two Money that costs no hand slot and no
 * Action. The archetype is about getting as many of them into the GY as it can.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'grubbing_goblin',
    name: 'Grubbing Goblin',
    cost: { money: 0 },
    types: ['Action', 'Token'],
    subtypes: ['Goblin'],
    tags: [],
    rarity: 'token',
    keywords: ['PlayOnDraw', 'Flimsy'],
    stats: { money: 2 },
    effects: [],
    triggers: [],
    text: 'Play on Draw. Flimsy. +2 Money.',
    flavor: 'It grubs.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'grubbing_goblin', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'goblin_gang_boss',
    name: 'Goblin Gang Boss',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: ['Goblin'],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { money: 2 },
    effects: [{ op: 'createCard', defId: 'grubbing_goblin', to: 'gy', count: 1 }],
    triggers: [],
    text: '+2 Money. Add a Grubbing Goblin to your GY.',
    flavor: 'Somebody has to organise them.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'goblin_gang_boss', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'nether_portal',
    name: 'Nether Portal',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: ['Goblin'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [],
    triggers: [
      {
        on: 'onDiscard',
        effects: [{ op: 'createCard', defId: 'grubbing_goblin', to: 'gy', count: 2 }],
      },
    ],
    text: 'When discarded, add 2 Grubbing Goblins to your GY.',
    flavor: 'It only opens when nobody is holding it.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'nether_portal', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'jakkari_sacrifice',
    name: 'Jakkari Sacrifice',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: ['Goblin'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [],
    triggers: [
      {
        on: 'onDiscard',
        effects: [{ op: 'createCard', defId: 'nether_portal', to: 'gy', count: 1 }],
      },
    ],
    text: 'When discarded, add a Nether Portal to your GY.',
    flavor: 'Give something up, get somewhere new.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'jakkari_sacrifice', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'war_bonds',
    name: 'War Bonds',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Goblin'],
    tags: [],
    rarity: 'rare',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: { buys: 1 },
    effects: [{ op: 'createCard', defId: 'grubbing_goblin', to: 'gy', count: 3 }],
    triggers: [],
    text: 'Play on Buy. Flimsy. +1 Buy. Add 3 Grubbing Goblins to your GY.',
    flavor: 'Sold door to door, mostly to goblins.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'war_bonds', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'cn_backed_war_bonds',
    name: 'CN Backed War Bonds',
    cost: { money: 8 },
    types: ['Action'],
    subtypes: ['CN', 'Goblin'],
    tags: [],
    rarity: 'epic',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: { buys: 1 },
    effects: [
      { op: 'createCard', defId: 'grubbing_goblin', to: 'gy', count: 5 },
      { op: 'createCard', defId: 'war', to: 'gy', count: 1 },
    ],
    triggers: [],
    text: 'Play on Buy. Flimsy. +1 Buy. Add 5 Grubbing Goblins and a War! to your GY.',
    flavor: 'Backed by something, definitely.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'cn_backed_war_bonds', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'the_mob',
    name: 'The Mob',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Goblin'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    // A buy-scoped `nextCardModifier` was a complete no-op: the buy path reads
    // only costDelta / costFloor / buyTo off a mod, and the sole reader of
    // appendEffects skips anything whose appliesTo is not a play. It also never
    // expired — nextCardMods survive end of turn, so `uses:99` outlived "this
    // turn" as well. A rider sitting in play is the shape that works: `buyCard`
    // fires onBuy across the buyer's own play area for triggers that declare
    // where they watch from, and the play area empties at end-of-turn cleanup,
    // which bounds this to exactly one turn with nothing to unwind.
    //
    // A rider only watches from the moment it lands in play, so the buys already
    // made this turn are behind it — the printed "every card you buy this turn"
    // covers those too, and the play pays them off up front. `buysUsedThisTurn`
    // counts the purchases that spent a Buy, which is what the line means; a
    // Prophet purchase spends banked Prophet and no Buy, and is the one thing
    // this catch-up cannot see. Two copies never double-pay one purchase: a buy
    // is caught either by the riders already in play or by the catch-up on a
    // copy played later, never by both, so N copies pay N Goblins per buy.
    effects: [
      { op: 'createCard', defId: 'grubbing_goblin', to: 'gy', count: { expr: 'buysUsedThisTurn' } },
    ],
    triggers: [
      {
        on: 'onBuy',
        zones: ['play'],
        effects: [{ op: 'createCard', defId: 'grubbing_goblin', to: 'gy', count: 1 }],
      },
    ],
    text: 'Every card you buy this turn also adds a Grubbing Goblin to your GY.',
    flavor: 'They follow the money.',
    complexity: 'T2',
    subsystems: ['S-TOKEN', 'S-SHOP'],
    shop: 'draft',
    art: { key: 'the_mob', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'uncle_musabi',
    name: 'Uncle Musabi',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Goblin'],
    tags: [],
    rarity: 'legendary',
    keywords: ['Flimsy'],
    stats: { cards: 1 },
    effects: [
      {
        op: 'transform',
        target: { zone: 'library', filter: { cost: { lte: 2 } } },
        into: 'grubbing_goblin',
      },
    ],
    triggers: [],
    text: 'Flimsy. +1 Card. Transform every card costing (2) or less in your Library into a Grubbing Goblin.',
    flavor: 'He knows what they were. He does not care.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-EFFECTS'],
    shop: 'draft',
    art: { key: 'uncle_musabi', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'skull_of_juldan',
    name: "Skull of Jul'dan",
    cost: { money: 5 },
    types: ['Action'],
    subtypes: ['Goblin'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 3 },
    effects: [
      // Nothing stamps the three cards the printed stat line just drew, so the
      // loop can only approximate "drawn": take the 3 most recently added (0)-cost
      // cards in hand, which is the doc's own ceiling — an unbounded `over` paid
      // +3 Money for every Egg already being held. `{self:true}` trashes the card
      // the iteration is bound to; the old random re-pick could trash another one.
      //
      // `text` states the approximation rather than the doc's "each drawn card":
      // when the three drawn cards are not all (0)-cost the loop reaches past them
      // to (0)-cost cards that were already in hand, so "for each drawn card" would
      // be a lie. Naming the newest-first order keeps the printed line honest until
      // an engine-side stamp on freshly drawn instances makes "drawn" expressible.
      {
        op: 'forEach',
        over: { zone: 'hand', filter: { cost: { eq: 0 } }, count: 3, pick: 'bottom' },
        effects: [
          { op: 'gain', stat: 'money', amount: 3 },
          { op: 'trash', target: { self: true } },
        ],
      },
    ],
    triggers: [],
    text: '+3 Cards. Then trash up to 3 cards costing (0) from your hand, newest first, for +3 Money each.',
    flavor: 'Still shouting.',
    complexity: 'T2',
    subsystems: ['S-EFFECTS'],
    shop: 'draft',
    art: { key: 'skull_of_juldan', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
];

export default cards;
