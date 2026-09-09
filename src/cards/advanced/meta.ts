/**
 * A.28 — Draft Shop: time, meta and game-warping.
 *
 * SB-22: A Duel of Wits is a deck-statistics multiple choice, not a
 * logarithmic inequality. SB-39 removes account gates.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'chron_job',
    name: 'Chron Job',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, money: 2 },
    effects: [{ op: 'moveTo', target: { self: true }, zone: 'library', position: { index: 5 } }],
    triggers: [],
    text: '+1 Action, +2 Money. After playing, put this 6th from the top of your Library.',
    flavor: 'Runs on schedule. Always.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'chron_job', status: 'placeholder' },
  },
  {
    id: 'chron_break',
    name: 'Chron Break',
    cost: { money: 10 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'mythic',
    keywords: ['PlayOnDraw', 'Flimsy'],
    stats: {},
    effects: [
      { op: 'extraTurn', who: 'self' },
      { op: 'endTurn', who: 'self' },
    ],
    triggers: [],
    text: 'Cast on Draw, Flimsy. End your turn. Then take another one.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'chron_break', status: 'placeholder', anim: 'explode' },
  },
  {
    id: 'twenty_fifth_hour',
    name: '25th Hour',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    // `currentTurn` counts every seat's turn, so it is the wrong clock for
    // "your 25th turn" — and extra turns bump it without giving anyone a new
    // round. `roundNumber` is state.round, which starts at 1 and only advances
    // when the seat order wraps (core/turn.ts advanceTurn), so it IS the
    // number of the turn you are taking. floor(roundNumber / 25) is truthy
    // from your 25th turn on, at any player count.
    // The one-per-copy cap rides on 'uses', the only counter key `selfCounter`
    // reads on its own; seeding it at 0 makes the key exist so `selfCounter`
    // never falls back to summing `playCount` in.
    effects: [
      { op: 'addCounter', target: { self: true }, key: 'uses', amount: 0 },
      {
        op: 'conditional',
        if: {
          all: [
            { expr: 'floor(roundNumber / 25)' },
            { not: { expr: 'selfCounter' } },
          ],
        },
        then: [
          { op: 'addCounter', target: { self: true }, key: 'uses', amount: 1 },
          { op: 'extraTurn', who: 'self' },
        ],
      },
    ],
    triggers: [],
    // No `{...}` token prints state.round, and `{turn}` is the global seat
    // counter — at 4 players it would read 100 for a gate that wants round 25,
    // so the card prints no number rather than a misleading one.
    text: 'After your 25th turn, immediately take an extra turn. One extra turn per copy.',
    complexity: 'T4',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'twenty_fifth_hour', status: 'placeholder' },
  },
  {
    id: 'outsourcing_rd',
    name: 'Outsourcing R&D',
    cost: { money: 8 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'legendary',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: { expr: 'max(0, 1 - abs(selfPlayCount - 3))' },
        then: [{ op: 'manifestAura', tier: 'hypercelestial', auraId: 'lotus_solutions', who: 'self' }],
      },
    ],
    triggers: [],
    text: 'Flimsy. On the 3rd play of this card this game, manifest the Hypercelestial Aura Lotus Solutions. ({selfPlayCount}/3)',
    complexity: 'T4',
    subsystems: ['S-PERSIST', 'S-AURA'],
    shop: 'draft',
    art: { key: 'outsourcing_rd', status: 'placeholder' },
  },
  {
    id: 'conjure_aura',
    name: 'Conjure Aura',
    cost: { money: 12 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: {},
    // The doc row prints Manifest, not Discover — the adjacent Hero's Power row
    // is the one that offers a choice of three, so no `discover` flag here.
    effects: [{ op: 'manifestAura', tier: 'celestial', who: 'self' }],
    triggers: [],
    text: 'Flimsy. Manifest a random Celestial Aura.',
    complexity: 'T3',
    subsystems: ['S-AURA'],
    shop: 'draft',
    art: { key: 'conjure_aura', status: 'placeholder', anim: 'summon' },
  },
  {
    id: 'heros_power',
    name: "Hero's Power",
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: {},
    effects: [{ op: 'manifestAura', tier: 'heroic', discover: true, who: 'self' }],
    triggers: [],
    text: 'Flimsy. Discover a Heroic Aura for your Field.',
    complexity: 'T3',
    subsystems: ['S-AURA'],
    shop: 'draft',
    art: { key: 'heros_power', status: 'placeholder', anim: 'summon' },
  },
  {
    id: 'heros_recall',
    name: "Hero's Recall",
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'conditional',
        if: { expr: 'floor(moneyUnspent / 3)' },
        then: [
          { op: 'gain', stat: 'money', amount: -3 },
          { op: 'createCard', defId: 'heros_recall', to: 'gy' },
        ],
      },
      {
        op: 'conditional',
        if: { has: { target: { who: 'self', zone: 'hand', filter: { defId: 'heros_recall' } }, atLeast: 5 } },
        then: [
          { op: 'trash', target: { who: 'self', zone: 'hand', filter: { defId: 'heros_recall' }, count: 5 } },
          { op: 'manifestAura', tier: 'heroic', discover: true, who: 'self' },
        ],
      },
    ],
    triggers: [],
    text:
      'If you have (3)+ Money, spend 3 and add a Hero\'s Recall to your GY. With 5 in hand, trash them and Discover a Heroic Aura. +1 Action.',
    complexity: 'T3',
    subsystems: ['S-AURA'],
    shop: 'draft',
    art: { key: 'heros_recall', status: 'placeholder' },
  },
  {
    id: 'quest_accepted',
    name: 'Quest Accepted!',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['PlayOnBuy'],
    stats: {},
    effects: [
      { op: 'manifestAura', tier: 'celestial', auraId: 'in_too_deep', who: 'self' },
      { op: 'trash', target: { self: true } },
    ],
    triggers: [
      {
        on: 'onBuy',
        effects: [
          { op: 'manifestAura', tier: 'celestial', auraId: 'in_too_deep', who: 'self' },
          { op: 'trash', target: { self: true } },
        ],
      },
    ],
    text: 'On buy, manifest the Celestial Aura In Too Deep, then trash this.',
    flavor: "Rumor goes Paul Hagen's ghost lurks the caves.",
    complexity: 'T4',
    subsystems: ['S-QUEST', 'S-AURA'],
    shop: 'draft',
    art: { key: 'quest_accepted', status: 'placeholder' },
  },
  {
    id: 'a_duel_of_wits',
    name: 'A Duel of Wits',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'choose',
        options: [
          {
            label: "My deck's average cost is above (3)",
            effects: [{ op: 'conditional', if: { expr: 'floor(avgCostOfDeck / 3.0001)' }, then: [{ op: 'draw', amount: 4 }] }],
          },
          {
            label: "My deck's average cost is (3) or less",
            effects: [{ op: 'conditional', if: { not: { expr: 'floor(avgCostOfDeck / 3.0001)' } }, then: [{ op: 'draw', amount: 4 }] }],
          },
          {
            label: 'My deck holds more than 16 unique cards',
            effects: [{ op: 'conditional', if: { expr: 'floor(uniqueCardsInDeck / 17)' }, then: [{ op: 'draw', amount: 4 }] }],
          },
          {
            label: 'My deck holds 16 or fewer unique cards',
            effects: [{ op: 'conditional', if: { not: { expr: 'floor(uniqueCardsInDeck / 17)' } }, then: [{ op: 'draw', amount: 4 }] }],
          },
        ],
        who: 'self',
      },
    ],
    triggers: [],
    text: 'Answer one true statement about your own deck. Correct: +4 Cards. Wrong or timed out: nothing.',
    complexity: 'T4',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'a_duel_of_wits', status: 'placeholder' },
  },
  {
    id: 'paper_sculpture',
    name: 'Paper Sculpture',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { money: 2, buys: 2, actions: 2, cards: 2, vp: 2 },
    effects: [],
    triggers: [
      {
        on: 'onTrash',
        effects: [{ op: 'trash', target: { who: 'self', zone: ['library', 'hand', 'gy'], count: 10, pick: 'random' } }],
      },
    ],
    // No leave-deck or ownership-change event exists in the TriggerEvent union,
    // so the printed text is narrowed to the half that actually fires.
    text: '+2 to all five stats. If this is trashed, trash 10 random cards from your deck.',
    flavor: 'Handle with care. Really.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'paper_sculpture', status: 'placeholder', anim: 'trash' },
  },
  // A.28 lists Mercenary 280 and Doomsday Clock as cross-references — "(see
  // A.10)" and "(see A.11)" — not as second cards. Their definitions live in
  // `archetypes/victory.ts` and `archetypes/pvp.ts`.
];

export default cards;
