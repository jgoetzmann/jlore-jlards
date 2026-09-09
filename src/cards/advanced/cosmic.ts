/**
 * A.27 — Draft Shop: Lunar and cosmic.
 *
 * Owns the `lunar_fragment` token.
 * SB-23: Arc of the Universe is a flat weighted VP roll, not a 3-D sim.
 * SB-39: Eastern Metaphysics ships with the Vainglorious gate removed.
 *
 * Per-game play counters read `player.playCounts` through the `selfPlayCount`
 * expression variable; `{playCount}` in `text` prints the live value.
 * `floor(n/k) - floor((n-1)/k)` is 1 exactly on every kth play;
 * `max(0, 1 - abs(n - k))` is 1 exactly on the kth play.
 */
import type { CardDefinition, Condition } from '@engine/types';

function onExactPlay(n: number): Condition {
  return { expr: `max(0, 1 - abs(selfPlayCount - ${n}))` };
}

function onEveryNthPlay(n: number): Condition {
  return { expr: `floor(selfPlayCount / ${n}) - floor((selfPlayCount - 1) / ${n})` };
}

export const cards: CardDefinition[] = [
  {
    id: 'lunar_fragment',
    name: 'Lunar Fragment',
    cost: { money: 6 },
    types: ['Action', 'Token'],
    subtypes: ['Lunar Fragment'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { money: 3, buys: 3, actions: 3, cards: 3, vp: 3, prophet: 3 },
    effects: [],
    triggers: [],
    text: 'Flimsy. +3 to all six stats.',
    flavor: 'A chip off the old rock.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'lunar_fragment', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'journey_to_the_moon',
    name: 'Journey to the Moon',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    effects: [
      {
        op: 'conditional',
        if: onEveryNthPlay(25),
        then: [
          { op: 'createCard', defId: 'lunar_fragment', to: 'library', count: 10, position: 'random' },
          { op: 'shuffle', zone: 'library', who: 'self' },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action, +1 Card. On the 25th play of this card this game, shuffle 10 Lunar Fragments into your deck. ({playCount}/25)',
    complexity: 'T4',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'journey_to_the_moon', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'shuffle' },
  },
  {
    id: 'astrologist',
    name: 'Astrologist',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [],
    triggers: [
      {
        on: 'onTrash',
        effects: [
          { op: 'addCounter', target: { self: true }, key: 'astrologistsTrashed', amount: 1 },
          {
            op: 'conditional',
            if: { not: { expr: 'selfCounter % 2' } },
            then: [{ op: 'createCard', defId: 'lunar_fragment', to: 'hand' }],
          },
        ],
      },
    ],
    text: 'Flimsy. +1 Action. On every even-numbered Astrologist trashed this game, add a Lunar Fragment to your hand. ({astrologistsTrashed} trashed.)',
    complexity: 'T4',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'astrologist', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'moon_dance',
    name: 'Moon Dance',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'delayed',
        when: { inTurns: 3 },
        effects: [{ op: 'createCard', defId: 'lunar_fragment', to: 'hand' }],
        who: 'self',
      },
    ],
    triggers: [],
    text: 'Flimsy. At the start of your 3rd turn from now, add a Lunar Fragment to your hand.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'moon_dance', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'space_race',
    name: 'Space Race',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: ['Lunar Fragment'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { money: 3, buys: 3, actions: 3, cards: 3, vp: 3, prophet: 3 },
    effects: [{ op: 'createCard', defId: 'lunar_fragment', to: 'gy', who: 'chosenOpponent' }],
    triggers: [],
    text: '+3 to all six stats. An opponent of your choice also gets a Lunar Fragment.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'space_race', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'wish_upon_the_stars',
    name: 'Wish Upon the Stars',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    effects: [
      {
        op: 'conditional',
        if: onEveryNthPlay(100),
        then: [{ op: 'manifestAura', tier: 'hypercelestial', auraId: 'shooting_star', who: 'self' }],
      },
    ],
    triggers: [],
    text: '+1 Action, +1 Card. On the 100th play of this card this game, summon the Hypercelestial Aura Shooting Star. ({playCount}/100)',
    complexity: 'T4',
    subsystems: ['S-PERSIST', 'S-AURA'],
    shop: 'draft',
    art: { key: 'wish_upon_the_stars', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'runebinder_of_jlore',
    name: 'Runebinder of Jlore',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'conditional',
        if: {
          any: [
            onExactPlay(7),
            onExactPlay(9),
            onExactPlay(13),
            onExactPlay(14),
            onExactPlay(18),
            onExactPlay(21),
            onExactPlay(26),
            onExactPlay(27),
            onExactPlay(28),
          ],
        },
        then: [{ op: 'createCard', defId: 'jlore', to: 'gy' }],
      },
      { op: 'moveTo', target: { self: true }, zone: 'library', position: 'top' },
    ],
    triggers: [],
    text:
      '+1 Action. Put this on top of your Library after playing it. Add a Jlore to your GY on the 7th, 9th, 13th, ' +
      '14th, 18th, 21st, 26th, 27th and 28th play of this card this game. ({playCount} plays.)',
    complexity: 'T4',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'runebinder_of_jlore', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'arc_of_the_universe',
    name: 'Arc of the Universe',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'mythic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'random',
        branches: [
          { weight: 1, effects: [{ op: 'gain', stat: 'vp', amount: 999 }], displayAs: 'The Center of the Universe. +999 VP.' },
          { weight: 9, effects: [{ op: 'gain', stat: 'vp', amount: 25 }], displayAs: 'Near alignment. +25 VP.' },
          { weight: 90, effects: [{ op: 'gain', stat: 'vp', amount: 3 }], displayAs: 'The arc drifts. +3 VP.' },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action. Align with the Center of the Universe: 90% +3 VP, 9% +25 VP, 1% +999 VP.',
    flavor: 'Someone, somewhere, hits it.',
    complexity: 'T4',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'arc_of_the_universe', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
  {
    id: 'eastern_metaphysics',
    name: 'Eastern Metaphysics',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      { op: 'addCounter', target: { self: true }, key: 'auraCharges', amount: 1 },
      {
        op: 'conditional',
        if: { expr: 'floor(selfCounter / 3)' },
        then: [
          { op: 'addCounter', target: { self: true }, key: 'auraCharges', amount: -3 },
          {
            op: 'choose',
            options: [
              { label: 'Positive: +3 Actions, +3 Cards', effects: [{ op: 'gain', stat: 'actions', amount: 3 }, { op: 'draw', amount: 3 }] },
              { label: 'Positive: +6 Money', effects: [{ op: 'gain', stat: 'money', amount: 6 }] },
              { label: 'Negative: each opponent discards 2', effects: [{ op: 'discardDownTo', amount: 3, who: 'eachOpponent' }] },
              {
                label: 'Negative: trash a card from an opponent\'s GY and take a Lunar Fragment',
                effects: [
                  { op: 'trash', target: { who: 'chosenOpponent', zone: 'gy', count: 1, pick: 'mostExpensive' } },
                  { op: 'createCard', defId: 'lunar_fragment', to: 'hand' },
                ],
              },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text:
      'Track the last 3 Auras from Actions you play; each owned Action is assigned a Positive or Negative Aura. ' +
      'Consume 3 Auras for one of four payoffs. ({auraCharges}/3 Auras.)',
    complexity: 'T4',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'eastern_metaphysics', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'constellation',
    name: 'Constellation',
    cost: { money: 10 },
    types: ['Points'],
    subtypes: [],
    tags: ['EndOfGame'],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [],
    triggers: [
      {
        on: 'gameEnd',
        effects: [
          {
            op: 'scoreOnCard',
            target: { self: true },
            amount: { expr: 'floor(uniqueCardsInDeck / 2)' },
          },
        ],
      },
    ],
    text: 'End of Game: +1 VP for every 2 unique cards in your deck. ({uniqueCardsInDeck} unique.)',
    complexity: 'T4',
    subsystems: ['S-ENDGAME'],
    shop: 'draft',
    art: { key: 'constellation', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'star_aligner',
    name: 'Star Aligner',
    cost: { money: 7 },
    types: ['Points'],
    subtypes: [],
    tags: ['EndOfGame'],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [],
    triggers: [
      {
        on: 'gameEnd',
        effects: [
          {
            op: 'scoreOnCard',
            target: { self: true },
            amount: { expr: 'min(15, count(lunarFragment) * 3)' },
          },
        ],
      },
    ],
    text: 'End of Game: +3 VP for each Lunar Fragment in your deck, up to 15.',
    complexity: 'T3',
    subsystems: ['S-ENDGAME'],
    shop: 'draft',
    art: { key: 'star_aligner', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
];

export default cards;
