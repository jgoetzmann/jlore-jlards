/**
 * A.15 — Draft Shop: Relics.
 *
 * Slice S7 (cards-archetypes). Relics permanently upgrade themselves through
 * `upgradeRelic`, which writes to the instance's own `statDelta` and bumps its
 * `counters.upgrades`. Monumental Works (A.10) reads that same counter.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'relic_of_fortune',
    name: 'Relic of Fortune',
    cost: { money: 1 },
    types: ['Action', 'Relic'],
    subtypes: ['Relic'],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { money: 1 },
    effects: [{ op: 'upgradeRelic', target: { self: true }, stat: 'money', amount: 1 }],
    triggers: [],
    text: '+1 Money. Then permanently upgrade this card’s Money by 1. ({upgrades} upgrades.)',
    flavor: 'It grows heavier every time you spend it.',
    complexity: 'T3',
    subsystems: ['S-BUFF', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'relic_of_fortune', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'relic_of_vigor',
    name: 'Relic of Vigor',
    cost: { money: 1 },
    types: ['Action', 'Relic'],
    subtypes: ['Relic'],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { actions: 1 },
    effects: [{ op: 'upgradeRelic', target: { self: true }, stat: 'actions', amount: 1 }],
    triggers: [],
    text: '+1 Action. Then permanently upgrade this card’s Actions by 1. ({upgrades} upgrades.)',
    flavor: 'Use it and it wants to be used again.',
    complexity: 'T3',
    subsystems: ['S-BUFF', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'relic_of_vigor', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'relic_of_insight',
    name: 'Relic of Insight',
    cost: { money: 1 },
    types: ['Action', 'Relic'],
    subtypes: ['Relic'],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { cards: 1 },
    effects: [{ op: 'upgradeRelic', target: { self: true }, stat: 'cards', amount: 1 }],
    triggers: [],
    text: '+1 Card. Then permanently upgrade this card’s Cards by 1. ({upgrades} upgrades.)',
    flavor: 'Every reading teaches it one more page.',
    complexity: 'T3',
    subsystems: ['S-BUFF', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'relic_of_insight', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'relic_of_desire',
    name: 'Relic of Desire',
    cost: { money: 1 },
    types: ['Action', 'Relic'],
    subtypes: ['Relic'],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { buys: 1 },
    effects: [{ op: 'upgradeRelic', target: { self: true }, stat: 'buys', amount: 1 }],
    triggers: [],
    text: '+1 Buy. Then permanently upgrade this card’s Buys by 1. ({upgrades} upgrades.)',
    flavor: 'It has never once been satisfied.',
    complexity: 'T3',
    subsystems: ['S-BUFF', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'relic_of_desire', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'relic_of_glory',
    name: 'Relic of Glory',
    cost: { money: 3 },
    types: ['Action', 'Points', 'Relic'],
    subtypes: ['Relic'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { vp: 1 },
    effects: [{ op: 'upgradeRelic', target: { self: true }, stat: 'vp', amount: 1 }],
    triggers: [],
    text: '+1 VP. Then permanently upgrade this card’s VP by 1. ({upgrades} upgrades.)',
    flavor: 'Polished by everyone who ever held it up.',
    complexity: 'T3',
    subsystems: ['S-BUFF', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'relic_of_glory', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'relic_of_furitiveness',
    name: 'Relic of Furitiveness',
    cost: { money: 1 },
    types: ['Action', 'Relic'],
    subtypes: ['Relic'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 1, money: 1 },
    effects: [],
    triggers: [
      // 'onTrash' is a SELF event (effects/triggers.ts): it reaches only the
      // card that was trashed, so a rider listening for someone else's Felinor
      // never ran. There is no table-wide trash event, so the Relic polls
      // instead: 'counter' remembers how many Felinors were in the trash the
      // last time it paid out, and each start of turn it settles the
      // difference. 'counter' is the reserved key buildVars reports as
      // selfCounter, which keeps the engine-written playCount out of the sum;
      // seeding it at buy time makes the very first Felinor count.
      { on: 'onBuy', effects: [{ op: 'addCounter', target: { self: true }, key: 'counter', amount: 0 }] },
      {
        on: 'startOfTurn',
        condition: { expr: 'countIn(trash, felinor) > selfCounter' },
        effects: [
          {
            op: 'repeat',
            times: { expr: 'countIn(trash, felinor) - selfCounter' },
            effects: [
              { op: 'upgradeRelic', target: { self: true }, stat: 'random', amount: 1 },
              { op: 'addCounter', target: { self: true }, key: 'counter', amount: 1 },
            ],
          },
        ],
      },
    ],
    text: '+1 Card, +1 Money. This permanently upgrades once for each Felinor that has been trashed. ({upgrades} upgrades.)',
    flavor: 'It feeds on missing cats.',
    complexity: 'T3',
    subsystems: ['S-BUFF', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'relic_of_furitiveness', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'relic_of_finesse',
    name: 'Relic of Finesse',
    cost: { money: 1 },
    types: ['Action', 'Relic'],
    subtypes: ['Relic'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, buys: 1 },
    effects: [],
    triggers: [
      { on: 'onUnlock', effects: [{ op: 'upgradeRelic', target: { self: true }, stat: 'random', amount: 1 }] },
    ],
    text: '+1 Action, +1 Buy. This permanently upgrades whenever a pile is unlocked. ({upgrades} upgrades.)',
    flavor: 'Every opened door sharpens it.',
    complexity: 'T3',
    subsystems: ['S-BUFF', 'S-LOCK', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'relic_of_finesse', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'relic_of_dominion',
    name: 'Relic of Dominion',
    cost: { money: 5 },
    types: ['Action', 'Relic'],
    subtypes: ['Relic'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { money: 1, actions: 1, cards: 1 },
    // stat:'random' rolls over all five BUFFABLE_STATS, so two rolls in five
    // upgraded Buys or VP — stats this card does not grant. The row names the
    // three, so the roll is written out explicitly. No branch carries a
    // displayAs: opRandom would stamp it on the instance as a permanent text
    // override.
    effects: [
      {
        op: 'random',
        branches: [
          { weight: 1, effects: [{ op: 'upgradeRelic', target: { self: true }, stat: 'money', amount: 1 }] },
          { weight: 1, effects: [{ op: 'upgradeRelic', target: { self: true }, stat: 'actions', amount: 1 }] },
          { weight: 1, effects: [{ op: 'upgradeRelic', target: { self: true }, stat: 'cards', amount: 1 }] },
        ],
      },
    ],
    triggers: [],
    text: '+1 Money, +1 Action, +1 Card. Then permanently upgrade one of the three at random. ({upgrades} upgrades.)',
    flavor: 'It decides which part of you to make stronger.',
    complexity: 'T3',
    subsystems: ['S-BUFF', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'relic_of_dominion', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'relic_of_totality',
    name: 'Relic of Totality',
    cost: { money: 5 },
    types: ['Action', 'Relic'],
    subtypes: ['Relic'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    // X lives in one place: the reserved 'counter' key, which buildVars reports
    // as selfCounter in preference to the sum of every counter (the sum picked
    // up the engine-written playCount and doubled X). The upgrade used to be an
    // {op:'upgradeRelic', stat:'all'}, which writes a permanent per-instance
    // statDelta that playCard pays out on top of the gain block — X twice, once
    // of it unprinted, and the statDelta VP scored in a second ledger. Bumping
    // the counter instead keeps the whole payout in the gain block.
    //
    // Combo X and Big Action X are both X-driven: a literal { combo: 1 } is
    // always true (the card is on playedThisTurn before its body runs), and the
    // static bigAction never moves, so the counters.bigAction override tracks X
    // and the combo gate is an expression.
    effects: [
      {
        op: 'conditional',
        if: { expr: 'comboCount >= selfCounter' },
        then: [
          { op: 'gain', stat: 'actions', amount: { expr: 'max(1, selfCounter)' } },
          { op: 'gain', stat: 'buys', amount: { expr: 'max(1, selfCounter)' } },
          { op: 'gain', stat: 'money', amount: { expr: 'max(1, selfCounter)' } },
          { op: 'gain', stat: 'cards', amount: { expr: 'max(1, selfCounter)' } },
          { op: 'gain', stat: 'vp', amount: { expr: 'max(1, selfCounter)' } },
        ],
      },
      { op: 'addCounter', target: { self: true }, key: 'counter', amount: 1 },
      { op: 'addCounter', target: { self: true }, key: 'bigAction', amount: 1 },
    ],
    triggers: [
      {
        on: 'onBuy',
        effects: [
          { op: 'addCounter', target: { self: true }, key: 'counter', amount: 1 },
          { op: 'addCounter', target: { self: true }, key: 'bigAction', amount: 1 },
        ],
      },
    ],
    text: 'Big Action X, Combo X. +X Actions, +X Buys, +X Money, +X Cards, +X VP. X is 1 when you buy this and permanently rises by 1 each time you play it. (X = {counter}.)',
    flavor: 'All of it, all at once, forever.',
    complexity: 'T4',
    subsystems: ['S-BIGACTION', 'S-COMBO', 'S-BUFF', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'relic_of_totality', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
    bigAction: 1,
  },
  {
    id: 'evercrown',
    name: 'Evercrown',
    cost: { money: 8 },
    types: ['Action', 'Points'],
    subtypes: ['Relic'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { money: 1, buys: 1, actions: 1, cards: 1, vp: 1 },
    effects: [{ op: 'upgradeRelic', target: { self: true }, stat: 'all', amount: 1 }],
    triggers: [],
    text: '+1 Money, +1 Buy, +1 Action, +1 Card, +1 VP. Then permanently upgrade all five. ({upgrades} upgrades.)',
    flavor: 'The crown outlasts every head it sits on.',
    complexity: 'T3',
    subsystems: ['S-BUFF', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'evercrown', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'bag_of_relics',
    name: 'Bag of Relics',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: ['Relic'],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [{ op: 'createCard', defId: { pool: { catalog: 'relic' } }, to: 'hand', count: 3 }],
    triggers: [],
    text: 'Flimsy. +1 Action. Add 3 Relics to your hand.',
    flavor: 'Rummage. Something in there is already powerful.',
    complexity: 'T2',
    subsystems: ['S-TOKEN', 'S-BUFF'],
    shop: 'draft',
    art: { key: 'bag_of_relics', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
];

export default cards;
