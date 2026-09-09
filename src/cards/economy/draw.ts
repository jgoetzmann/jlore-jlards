/**
 * A.7 Draft Shop — draw and hand sculpting.
 */
import type { CardDefinition, CardFilter } from '@engine/types';

/**
 * `aside` is ONE staging pile per player, and a Hand Box keeps the cards it
 * stored there for as long as it holds them — src/cards/advanced/tokens.ts
 * picks them out by the `boxed` counter. Half the sifters below use that same
 * pile as scratch space for the length of a single effect, so every selector
 * that reaches into `aside` has to say "not a stored card" or it walks off
 * with somebody's saved hand.
 *
 * Read out, this excludes anything carrying `boxed` that is not a Token. The
 * Token clause is deliberate: a Hand Box token carries `boxed` itself for its
 * "({boxed} stored.)" line and is shuffled into the Library, so one of these
 * cards can quite normally stage the box. Skipping it there would leave it in
 * `aside` for good and take the stored hand with it.
 */
const NOT_STORED: CardFilter = {
  not: { counter: { key: 'boxed', gte: 1 }, not: { type: 'Token' } },
};

export const cards: CardDefinition[] = [
  {
    id: 'rapid_draw',
    name: 'Rapid Draw',
    cost: { money: 0 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { cards: 4 },
    effects: [{ op: 'discard', target: { who: 'self', zone: 'hand', count: 4, pick: 'choose' } }],
    triggers: [],
    text: '+4 Cards, then discard 4 cards.',
    flavor: 'Churn is a strategy.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'rapid_draw', status: 'placeholder' },
  },
  {
    id: 'balanced_rapid_draw',
    name: 'Balanced Rapid Draw',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'common',
    keywords: [],
    stats: { cards: 4, actions: 1 },
    effects: [{ op: 'discard', target: { who: 'self', zone: 'hand', count: 4, pick: 'choose' } }],
    triggers: [],
    text: '+4 Cards, then discard 4 cards. +1 Action.',
    flavor: 'The errata version.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'balanced_rapid_draw', status: 'placeholder' },
  },
  {
    id: 'overclocked_rapid_draw',
    name: 'Overclocked Rapid Draw',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 8 },
    effects: [{ op: 'discard', target: { who: 'self', zone: 'hand', count: 8, pick: 'choose' } }],
    triggers: [],
    text: '+8 Cards, then discard 8 cards.',
    flavor: 'Runs hot. Runs anyway.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'overclocked_rapid_draw', status: 'placeholder' },
  },
  {
    id: 'prime_rapid_draw',
    name: 'Prime Rapid Draw',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 5, actions: 1 },
    effects: [{ op: 'discard', target: { who: 'self', zone: 'hand', count: 4, pick: 'choose' } }],
    triggers: [],
    text: '+5 Cards, then discard 4 cards. +1 Action.',
    flavor: 'One card ahead.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'prime_rapid_draw', status: 'placeholder' },
  },
  {
    id: 'card_destruction',
    name: 'Card Destruction',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'selectCards',
        from: { who: 'self', zone: 'hand' },
        min: 0,
        max: { expr: 'handSize' },
        then: [
          { op: 'discard', target: { self: true } },
          { op: 'draw', amount: 1 },
        ],
      },
    ],
    triggers: [],
    text: 'Discard up to X cards, then draw X cards. +1 Action.',
    flavor: 'Out with the old, in with the same.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'card_destruction', status: 'placeholder' },
  },
  {
    id: 'profe_yates',
    name: 'Profe Yates',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { cards: 3 },
    effects: [],
    triggers: [],
    text: '+3 Cards.',
    flavor: 'Assigns reading.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'profe_yates', status: 'placeholder' },
  },
  {
    id: 'sack_of_cards',
    name: 'Sack of Cards',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { actions: 1, cards: 4 },
    effects: [],
    triggers: [],
    text: '+1 Action, +4 Cards.',
    flavor: 'Just a sack. Just cards.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'sack_of_cards', status: 'placeholder' },
  },
  {
    id: 'keyhole',
    name: 'Keyhole',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { actions: 1 },
    // SB-34: a Library is hidden even from its owner, so the choice cannot be
    // made against the Library itself — `pick:'choose'` there enumerates the
    // whole deck. The three cards are set aside first and both picks are made
    // over exactly those three; the survivor goes back on top.
    effects: [
      { op: 'moveTo', target: { who: 'self', zone: 'library', count: 3, pick: 'top' }, zone: 'aside' },
      {
        op: 'selectCards',
        from: { who: 'self', zone: 'aside', filter: NOT_STORED },
        min: 1,
        max: 1,
        then: [{ op: 'moveTo', target: { self: true }, zone: 'hand' }],
      },
      {
        op: 'selectCards',
        from: { who: 'self', zone: 'aside', filter: NOT_STORED },
        min: 1,
        max: 1,
        then: [{ op: 'discard', target: { self: true } }],
      },
      { op: 'moveTo', target: { who: 'self', zone: 'aside', filter: NOT_STORED }, zone: 'library', position: 'top' },
    ],
    triggers: [],
    text: 'Look at the top 3 cards of your Library: put one in your hand, discard one, leave one on top. +1 Action.',
    flavor: 'You only need one eye.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'keyhole', status: 'placeholder' },
  },
  {
    id: 'harbinger',
    name: 'Harbinger',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'moveTo',
        target: { who: 'self', zone: 'gy', count: 1, pick: 'choose' },
        zone: 'library',
        position: 'top',
      },
    ],
    triggers: [],
    text: 'Put a card from your GY on top of your Library. +1 Action.',
    flavor: 'It comes back around.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'harbinger', status: 'placeholder' },
  },
  {
    id: 'star_compass',
    name: 'Star Compass',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 2 },
    // A draw appends to the end of the hand, so the two cards just drawn are the
    // last two in it. They are set aside to be compared: inside `selectCards`
    // the `then` runs once per pick with '$selected' swapped for that pick's
    // defId, so a name filter over the pair is a real same-name test, and the
    // `x == 0` guard makes the pair fire it once rather than once per card.
    // The doc's "repeat" is not implemented — re-testing the next pair needs a
    // loop that can break, which the DSL has no way to express.
    effects: [
      { op: 'moveTo', target: { who: 'self', zone: 'hand', count: 2, pick: 'bottom' }, zone: 'aside' },
      {
        op: 'selectCards',
        from: { who: 'self', zone: 'aside', filter: NOT_STORED },
        min: 2,
        max: 2,
        then: [
          {
            op: 'conditional',
            if: {
              all: [
                { expr: 'x == 0' },
                {
                  has: {
                    target: { who: 'self', zone: 'aside', filter: { defId: '$selected', ...NOT_STORED } },
                    atLeast: 2,
                  },
                },
              ],
            },
            then: [{ op: 'draw', amount: 2 }],
          },
          { op: 'moveTo', target: { self: true }, zone: 'hand' },
        ],
      },
    ],
    triggers: [],
    text: '+2 Cards. If the two cards drawn share a name, +2 Cards.',
    flavor: 'North, north, north again.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'star_compass', status: 'placeholder' },
  },
  {
    id: 'snowball',
    name: 'Snowball',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 1 },
    // Snowball is itself a (1)-cost card and is already in play while this
    // resolves, so its own copy comes off the count. "Consecutive" is dropped:
    // `countIn` sees the play area as a set, not the order it was played in.
    effects: [
      {
        op: 'repeat',
        times: {
          expr: 'min(3, max(0, countIn(play, oneCost) - 1))',
        },
        effects: [{ op: 'draw', amount: 1 }],
      },
    ],
    triggers: [],
    text: '+1 Card, and another for each (1)-cost card played before this, up to 3 more.',
    flavor: 'It gets bigger. That is the whole thing.',
    complexity: 'T3',
    subsystems: ['S-COMBO'],
    shop: 'draft',
    art: { key: 'snowball', status: 'placeholder' },
  },
  {
    id: 'small_time_racketeer',
    name: 'Small Time Racketeer',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 1 },
    // The loop has to read the card just drawn, not the hand. A filter inside a
    // selector is applied before `pick`, so "the last card in hand, if it costs
    // (2)+" is not one selector — `forEach` binds the last card in hand, which
    // is the one most recently drawn, and `selfCost` reads that card's cost.
    // Once a (2)+ card arrives every later pass is a no-op, which is the stop.
    effects: [
      {
        op: 'repeat',
        times: 5,
        effects: [
          {
            op: 'forEach',
            over: { who: 'self', zone: 'hand', count: 1, pick: 'bottom' },
            effects: [
              { op: 'conditional', if: { expr: 'selfCost < 2' }, then: [{ op: 'draw', amount: 1 }] },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: '+1 Card. Repeat until you draw a card costing (2) or more, up to 5 more times.',
    flavor: 'Nickels, mostly.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'small_time_racketeer', status: 'placeholder' },
  },
  {
    id: 'big_time_racketeer',
    name: 'Big Time Racketeer',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 1 },
    // Mirror of Small Time Racketeer: the test is on the card just drawn — the
    // last card in hand — not on whether the hand holds a cheap card anywhere.
    effects: [
      {
        op: 'repeat',
        times: 5,
        effects: [
          {
            op: 'forEach',
            over: { who: 'self', zone: 'hand', count: 1, pick: 'bottom' },
            effects: [
              { op: 'conditional', if: { expr: 'selfCost > 2' }, then: [{ op: 'draw', amount: 1 }] },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: '+1 Card. Repeat until you draw a card costing (2) or less, up to 5 more times.',
    flavor: 'He only wants the good stuff.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'big_time_racketeer', status: 'placeholder' },
  },
  {
    id: 'essential_oils',
    name: 'Essential Oils',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    // "Until you have drawn (4) of combined cost" needs a running total of what
    // was actually drawn, and no expression reads the cost of one drawn card.
    // `sumOfDeckCosts` counts Library + hand + GY + play, so a card parked in
    // `aside` leaves that total: snapshot the sum on this card first, draw one
    // at a time and set each drawn card aside, and `snapshot - sumOfDeckCosts`
    // is exactly the cost drawn so far. Everything set aside comes back to hand
    // at the end and the snapshot counter is zeroed for the next play.
    effects: [
      { op: 'addCounter', target: { self: true }, key: 'counter', amount: { expr: 'sumOfDeckCosts' } },
      {
        op: 'repeat',
        times: 6,
        effects: [
          {
            op: 'conditional',
            if: { expr: 'selfCounter - sumOfDeckCosts < 4' },
            then: [
              { op: 'draw', amount: 1 },
              { op: 'moveTo', target: { who: 'self', zone: 'hand', count: 1, pick: 'bottom' }, zone: 'aside' },
            ],
          },
        ],
      },
      { op: 'moveTo', target: { who: 'self', zone: 'aside', filter: NOT_STORED }, zone: 'hand' },
      { op: 'addCounter', target: { self: true }, key: 'counter', amount: { expr: '0 - selfCounter' } },
    ],
    triggers: [],
    text: 'Draw cards until the combined cost of the cards drawn reaches (4), up to 6 cards.',
    flavor: 'Cures whatever the deck has.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'essential_oils', status: 'placeholder' },
  },
  {
    id: 'one_more_track',
    name: 'One More Track',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: { not: { has: { target: { who: 'self', zone: 'hand' }, atLeast: 1 } } },
        then: [{ op: 'draw', amount: 5 }],
        else: [{ op: 'draw', amount: 1 }],
      },
    ],
    triggers: [],
    text: '+1 Card. If this was the last card in your hand, +5 Cards instead.',
    flavor: 'Just one more. Then bed.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'one_more_track', status: 'placeholder' },
  },
  {
    id: 'around_the_world',
    name: 'Around the World',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      { op: 'conditional', if: { combo: 5 }, then: [{ op: 'draw', amount: 5 }] },
    ],
    triggers: [],
    text: 'Combo 5: +5 Cards.',
    flavor: 'Eighty days, five cards.',
    complexity: 'T3',
    subsystems: ['S-COMBO'],
    shop: 'draft',
    art: { key: 'around_the_world', status: 'placeholder' },
  },
  {
    id: 'power_of_4',
    name: 'Power of 4',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { actions: 4 },
    effects: [{ op: 'discard', target: { who: 'self', zone: 'hand', count: 4, pick: 'choose' } }],
    triggers: [],
    text: 'Discard 4 cards. +4 Actions.',
    flavor: 'Four for four. Fair.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'power_of_4', status: 'placeholder' },
  },
  {
    id: 'false_dichotomy',
    name: 'False Dichotomy',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { actions: 2 },
    effects: [{ op: 'discardDownTo', amount: 2 }],
    triggers: [],
    text: 'Discard down to 2 cards in hand. +2 Actions.',
    flavor: 'There were always more than two options.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'false_dichotomy', status: 'placeholder' },
  },
  {
    id: 'buffer_overflow',
    name: 'Buffer Overflow',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 4 },
    // The Money is for the Resources actually discarded, so the two cards are
    // rolled once, set aside, paid for and then discarded together. Two separate
    // `pick:'random'` selections are two independent rolls, which paid for
    // Resources the discard never touched.
    effects: [
      { op: 'moveTo', target: { who: 'self', zone: 'hand', count: 2, pick: 'random' }, zone: 'aside' },
      {
        op: 'forEach',
        over: { who: 'self', zone: 'aside', filter: { type: 'Resource', ...NOT_STORED } },
        effects: [{ op: 'gain', stat: 'money', amount: 1 }],
      },
      { op: 'discard', target: { who: 'self', zone: 'aside', filter: NOT_STORED } },
    ],
    triggers: [],
    text: '+4 Cards, then discard 2 at random. +1 Money for each Resource discarded this way.',
    flavor: 'Segmentation fault (cards dumped).',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'buffer_overflow', status: 'placeholder' },
  },
  {
    id: 'quantum_cut',
    name: 'Quantum Cut',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    // "They cost the same" is a comparison between two cards, which no single
    // condition expresses: a cost filter matches a fixed number, and a filter is
    // applied before `pick`, so it can never mean "the top two, both costing N".
    // The pair is set aside and asked, cost by cost, whether both of them sit in
    // one bucket. Costs run 0-9 here; a pair costing (10)+ falls to the Money
    // branch. The pair goes back on top before either branch pays out, so a
    // +3 Cards draws the two cards it just revealed.
    effects: [
      { op: 'reveal', target: { who: 'self', zone: 'library', count: 2, pick: 'top' } },
      { op: 'moveTo', target: { who: 'self', zone: 'library', count: 2, pick: 'top' }, zone: 'aside' },
      {
        op: 'conditional',
        if: {
          any: [
            { has: { target: { who: 'self', zone: 'aside', filter: { cost: { eq: 0 }, ...NOT_STORED } }, atLeast: 2 } },
            { has: { target: { who: 'self', zone: 'aside', filter: { cost: { eq: 1 }, ...NOT_STORED } }, atLeast: 2 } },
            { has: { target: { who: 'self', zone: 'aside', filter: { cost: { eq: 2 }, ...NOT_STORED } }, atLeast: 2 } },
            { has: { target: { who: 'self', zone: 'aside', filter: { cost: { eq: 3 }, ...NOT_STORED } }, atLeast: 2 } },
            { has: { target: { who: 'self', zone: 'aside', filter: { cost: { eq: 4 }, ...NOT_STORED } }, atLeast: 2 } },
            { has: { target: { who: 'self', zone: 'aside', filter: { cost: { eq: 5 }, ...NOT_STORED } }, atLeast: 2 } },
            { has: { target: { who: 'self', zone: 'aside', filter: { cost: { eq: 6 }, ...NOT_STORED } }, atLeast: 2 } },
            { has: { target: { who: 'self', zone: 'aside', filter: { cost: { eq: 7 }, ...NOT_STORED } }, atLeast: 2 } },
            { has: { target: { who: 'self', zone: 'aside', filter: { cost: { eq: 8 }, ...NOT_STORED } }, atLeast: 2 } },
            { has: { target: { who: 'self', zone: 'aside', filter: { cost: { eq: 9 }, ...NOT_STORED } }, atLeast: 2 } },
          ],
        },
        then: [
          { op: 'moveTo', target: { who: 'self', zone: 'aside', filter: NOT_STORED }, zone: 'library', position: 'top' },
          { op: 'draw', amount: 3 },
        ],
        else: [
          { op: 'moveTo', target: { who: 'self', zone: 'aside', filter: NOT_STORED }, zone: 'library', position: 'top' },
          { op: 'gain', stat: 'money', amount: 2 },
        ],
      },
    ],
    triggers: [],
    text: 'Reveal the top 2 cards of your Library. If they cost the same, +3 Cards; otherwise +2 Money. +1 Action.',
    flavor: 'Both, until you look.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'quantum_cut', status: 'placeholder' },
  },
  {
    id: 'fast_life',
    name: 'Fast Life',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { money: 2 },
    effects: [{ op: 'mill', amount: 6 }],
    triggers: [],
    text: 'Mill 6. +2 Money.',
    flavor: 'Burn the deck, spend the ashes.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'fast_life', status: 'placeholder' },
  },
  {
    id: 'pocket_pouch',
    name: 'Pocket Pouch',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    // The card that comes back must be the card that went away. `selectCards`
    // binds the pick as the source for its `then`, and `delayed` carries that
    // binding into next turn, so {self:true} still names the discarded card —
    // reaching into the GY next turn finds the oldest discard instead, since the
    // whole hand has landed on top of it at cleanup.
    effects: [
      {
        op: 'selectCards',
        from: { who: 'self', zone: 'hand' },
        min: 1,
        max: 1,
        then: [
          { op: 'discard', target: { self: true } },
          {
            op: 'delayed',
            when: 'startOfNextTurn',
            effects: [{ op: 'moveTo', target: { self: true }, zone: 'hand' }],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Discard a card. It returns to your hand at the start of your next turn. +1 Action, +1 Card.',
    flavor: 'Pocketed, not lost.',
    complexity: 'T2',
    subsystems: ['S-DELAYED'],
    shop: 'draft',
    art: { key: 'pocket_pouch', status: 'placeholder' },
  },
  {
    id: 'stowaway',
    name: 'Stowaway',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 3, actions: 1 },
    effects: [
      {
        op: 'setKeyword',
        target: { who: 'self', zone: 'hand', count: 1, pick: 'random' },
        keyword: 'Temporary',
        on: true,
      },
    ],
    triggers: [],
    text: 'A random card in your hand becomes Temporary. +3 Cards, +1 Action.',
    flavor: 'Somebody got on board who should not have.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'stowaway', status: 'placeholder' },
  },
  {
    id: 'sleepy_joe_bider',
    name: 'Sleepy Joe Bider',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 2 },
    // `endTurn` zeroes Actions and Buys and writes counters.endTurnRequested,
    // which nothing in the turn machinery reads: the turn does not advance by
    // itself and cleanup still discards the hand. "Without discarding" needs a
    // skip-discard flag core/turn.ts honours, so it comes off the text rather
    // than staying printed as a promise the card cannot keep.
    effects: [{ op: 'endTurn' }],
    triggers: [],
    text: '+2 Cards. Take no more Actions or Buys this turn.',
    flavor: 'That is enough for today.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'sleepy_joe_bider', status: 'placeholder' },
  },
  {
    id: 'tanyays_unstable_element',
    name: "Tanyay's Unstable Element",
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'legendary',
    keywords: ['Flimsy'],
    stats: {},
    // A.7 also prints "you can't draw more this turn", which a next-card
    // modifier cannot express. The multiply:0 mod that stood here did nothing on
    // the normal play path (consumePlayMods skips a zero multiplier while still
    // spending a use), and on the effect-driven path it zeroed the whole stat
    // line — Money, Buys, Actions, VP — of the next 99 cards played and was
    // never cleared at turn end. It is removed rather than left doing damage:
    // the rider needs a per-turn no-draw flag the engine does not have, so it is
    // off the card text until it does.
    effects: [{ op: 'draw', amount: { expr: 'libraryHeight' } }],
    triggers: [],
    text: 'Flimsy. Draw your entire Library.',
    flavor: 'It goes off all at once or not at all.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'tanyays_unstable_element', status: 'placeholder', anim: 'explode' },
  },
  {
    // A.7 prices this at (4) and rates it Rare; A.29's grouped row lumps it in
    // with the 0-3 Food tokens. A.7 wins — it is the specific row, (4) is
    // outside A.29's band, and no Food generator mints a Milkshake, so as a
    // token it would be unobtainable. The doc's "Token" in the A.7 types column
    // is the same looseness it shows on Jmart Banana Bunch, which is also a
    // purchasable Rare. Dropped, so the card is buyable as printed.
    id: 'milkshake',
    name: 'Milkshake',
    cost: { money: 4 },
    types: ['Action', 'Food'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { cards: 4, actions: 1 },
    // A negative {op:'gain', stat:'cards'} is silently dropped — opGain only
    // draws on a positive delta — and an end-of-turn delayed effect fires before
    // the cleanup draw anyway, so the drawback never landed. The cleanup draw
    // reads a turn modifier no card node can write, so the two cards are taken
    // off the far side of it instead: the hand that turn is 5, and 2 of them go
    // at the start of the next turn, which is the same two cards short.
    effects: [
      {
        op: 'delayed',
        when: 'startOfNextTurn',
        effects: [{ op: 'discard', target: { who: 'self', zone: 'hand', count: 2, pick: 'random' } }],
      },
    ],
    triggers: [],
    text: 'Flimsy. +4 Cards, +1 Action. Discard 2 random cards at the start of your next turn.',
    flavor: 'Brings all the boys to the discard pile.',
    complexity: 'T2',
    subsystems: ['S-DELAYED'],
    shop: 'draft',
    art: { key: 'milkshake', status: 'placeholder' },
  },
  {
    id: 'merge_sort',
    name: 'Merge Sort',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      { op: 'moveTo', target: { who: 'self', zone: 'gy' }, zone: 'library' },
      { op: 'shuffle', zone: 'library' },
      { op: 'sortLibraryByCost' },
    ],
    triggers: [],
    text: 'Shuffle your GY into your Library, then sort your Library by ascending cost.',
    flavor: 'O(n log n) and worth it.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'merge_sort', status: 'placeholder', anim: 'shuffle' },
  },
  {
    id: 'save_for_later',
    name: 'Save for Later',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { buys: 1, money: 1 },
    // A Hand Box reads its contents out of its owner's `aside` zone, so the hand
    // has to be put there — nothing here wrote it anywhere, and the box came
    // back empty while the hand was trashed outright. `moveTo` keeps the owner
    // on an un-owned zone; a copy into `aside` would be ownerless and the box's
    // {who:'self'} read would never see it. The stored cards are therefore the
    // originals, and the box handing them back is what "trash your hand" buys.
    // The box is made on top so the count can find it, then shuffled in. The
    // box picks its contents out of `aside` by the `boxed` counter — that pile
    // is shared with every card here that stages cards for one effect — so each
    // stored card is tagged with it on the way out of the hand.
    effects: [
      { op: 'createCard', defId: 'permanent_hand_box', to: 'library', position: 'top' },
      {
        op: 'addCounter',
        target: { who: 'self', zone: 'library', count: 1, pick: 'top' },
        key: 'boxed',
        amount: { expr: 'handSize' },
      },
      { op: 'addCounter', target: { who: 'self', zone: 'hand' }, key: 'boxed', amount: 1 },
      { op: 'moveTo', target: { who: 'self', zone: 'hand' }, zone: 'aside' },
      { op: 'shuffle', zone: 'library' },
    ],
    triggers: [],
    text: '+1 Buy, +1 Money. Store your hand in a Permanent: Hand Box and shuffle it into your Library.',
    flavor: 'You will want that later. Probably.',
    complexity: 'T4',
    subsystems: ['S-TOKEN', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'save_for_later', status: 'placeholder' },
  },
  {
    id: 'repackage',
    name: 'Repackage',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    // A.7 puts the copies in the box and leaves you holding your hand, and it
    // has to be that way round: counters do not survive `copyCard`, and VP put
    // on a card by {op:'scoreOnCard'} is a counter, so storing the originals and
    // handing back copies quietly ate that VP — `aside` scores nothing either.
    // A copy cannot be made straight into `aside`: opCopyCard owns an instance
    // only in library/hand/gy/play, so an `aside` copy is ownerless and the
    // box's {who:'self'} read never finds it. Each copy is therefore made in the
    // hand, where it is owned, tagged `boxed` — which is how the box picks its
    // contents out of the shared pile — and then moved across, which preserves
    // the owner. `forEach` binds the hand before any of this runs, so the copies
    // it makes are not themselves copied, and each fresh copy is the last card
    // in hand, which is what `pick:'bottom'` names.
    effects: [
      { op: 'createCard', defId: 'temporary_hand_box', to: 'library', position: 'top' },
      {
        op: 'addCounter',
        target: { who: 'self', zone: 'library', count: 1, pick: 'top' },
        key: 'boxed',
        amount: { expr: 'handSize' },
      },
      {
        op: 'forEach',
        over: { who: 'self', zone: 'hand' },
        effects: [
          { op: 'copyCard', target: { self: true }, to: 'hand' },
          {
            op: 'addCounter',
            target: { who: 'self', zone: 'hand', count: 1, pick: 'bottom' },
            key: 'boxed',
            amount: 1,
          },
          { op: 'moveTo', target: { who: 'self', zone: 'hand', count: 1, pick: 'bottom' }, zone: 'aside' },
        ],
      },
      { op: 'shuffle', zone: 'library' },
    ],
    triggers: [],
    text: '+1 Action. Copy your hand into a Temporary: Hand Box and shuffle it into your Library.',
    flavor: 'Same contents, new box.',
    complexity: 'T4',
    subsystems: ['S-TOKEN', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'repackage', status: 'placeholder' },
  },
  {
    id: 'echo_forge',
    name: 'Echo Forge',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'copyCard',
        target: { who: 'self', zone: 'play', filter: { type: 'Action' }, count: 1, pick: 'choose' },
        to: 'library',
        keywords: ['Temporary'],
      },
      // The copy lands at the end of the Library — its bottom, since the top is
      // index 0 — so the card that goes on top has to be picked from the bottom.
      // `lastPlayed` ranks every Library card at -1, which left the order alone
      // and put the already-top card back on top, stranding the copy.
      {
        op: 'moveTo',
        target: { who: 'self', zone: 'library', count: 1, pick: 'bottom' },
        zone: 'library',
        position: 'top',
      },
    ],
    triggers: [],
    text: 'Put a Temporary copy of an Action you played this turn on top of your Library.',
    flavor: 'It rings once more, then never again.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'echo_forge', status: 'placeholder' },
  },
  {
    id: 'sketch_artist',
    name: 'Sketch Artist',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'recruit',
        zone: 'library',
        filter: { type: 'Action' },
        count: 1,
        to: 'hand',
      },
      // Recruit appends to the end of the hand, so the recruited card is the
      // last Action in it and `pick:'bottom'` copies that one. `lastPlayed`
      // ranked every hand Action at -1 and copied the first Action in hand
      // order, which was the recruited card only when it was the only one.
      // A.7 also asks for an Action "that grants no +Actions"; a CardFilter has
      // no predicate over a card's stat line, so the clause is off the text
      // until the filter grammar can express it.
      {
        op: 'copyCard',
        target: { who: 'self', zone: 'hand', filter: { type: 'Action' }, count: 1, pick: 'bottom' },
        to: 'hand',
        keywords: ['Temporary'],
      },
    ],
    triggers: [],
    text: 'Draw an Action from your Library and add a Temporary copy of it to your hand.',
    flavor: 'A likeness, good enough for one use.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'sketch_artist', status: 'placeholder' },
  },
  {
    id: 'shadiris_visions',
    name: 'Shadiris Visions',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: ['Shadiris'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'discover',
        pool: { scope: 'deck', who: 'self' },
        count: 3,
        pick: 1,
        prompt: 'A vision of your deck',
        // {self:true} inside a discover's `then` is the card that asked, not the
        // card that was picked — a discovered card has no instance yet — so this
        // handed back a Temporary copy of Shadiris Visions itself. '$discovered'
        // is swapped for the chosen defId when the pick comes back.
        then: [{ op: 'createCard', defId: '$discovered', to: 'hand', keywords: ['Temporary'] }],
      },
    ],
    triggers: [],
    text: 'Discover a card in your deck and add a Temporary copy of it to your hand. +1 Action.',
    flavor: 'It fades by morning.',
    complexity: 'T3',
    subsystems: ['S-DISCOVER'],
    shop: 'draft',
    art: { key: 'shadiris_visions', status: 'placeholder' },
  },
  {
    id: 'shadiris_manifestation',
    name: 'Shadiris Manifestation',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Shadiris'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'discover',
        pool: { scope: 'deck', who: 'self' },
        count: 3,
        pick: 1,
        prompt: 'Manifest from your deck',
        // Same self-copy bug as Shadiris Visions, and here the default Discover
        // semantic — an empty `then` puts the chosen card in your hand — is
        // exactly the printed effect, so there is nothing to write.
        then: [],
      },
    ],
    triggers: [],
    text: 'Discover a card in your deck and add a copy of it to your hand. +1 Action.',
    flavor: 'The vision, but it stays.',
    complexity: 'T3',
    subsystems: ['S-DISCOVER'],
    shop: 'draft',
    art: { key: 'shadiris_manifestation', status: 'placeholder' },
  },
  {
    id: 'duplication',
    name: 'Duplication',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'copyCard',
        target: { who: 'self', zone: 'hand', count: 2, pick: 'random' },
        to: 'hand',
      },
    ],
    triggers: [],
    text: 'Add copies of two random cards in your hand to your hand.',
    flavor: 'Ctrl-C, Ctrl-V, Ctrl-V.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'duplication', status: 'placeholder' },
  },
  {
    id: 'model_citizen',
    name: 'Model Citizen',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'discover',
        pool: { scope: 'deck', who: 'self' },
        count: 3,
        pick: 1,
        prompt: 'Choose the model',
        // `into` a pool rolls once per target, so the two victims each became a
        // different random card and the pick was never read. '$discovered' is
        // the chosen defId. The two cards that change are rolled from the deck:
        // the options not taken are definitions the prompt offered, not
        // instances any selector can name.
        then: [
          {
            op: 'transform',
            target: { who: 'self', zone: ['library', 'hand', 'gy'], count: 2, pick: 'random' },
            into: '$discovered',
          },
        ],
      },
    ],
    triggers: [],
    text: 'Discover 3 cards from your deck. Two random cards in your deck become the one you picked.',
    flavor: 'Conformity, delivered.',
    complexity: 'T3',
    subsystems: ['S-DISCOVER'],
    shop: 'draft',
    art: { key: 'model_citizen', status: 'placeholder' },
  },
  {
    id: 'training_regiment',
    name: 'Training Regiment',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'nextCardModifier',
        mod: { appliesTo: 'play', grantKeyword: 'PlayOnDraw', uses: 1 },
      },
    ],
    triggers: [],
    text: 'The next Action you play this turn gains Play on Draw. +1 Action.',
    flavor: 'Drilled until reflexive.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'training_regiment', status: 'placeholder' },
  },
  {
    id: 'the_divined_cosmos',
    name: 'The Divined Cosmos',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'selectCards',
        from: { who: 'self', zone: 'hand' },
        min: 0,
        max: { expr: 'handSize' },
        // "Place" has to actually move them: left in hand the picks stayed
        // playable this turn. The pile they wait in is the GY, not `aside` —
        // these sit placed across a whole turn, and `aside` is the one staging
        // pile every sifter in this file borrows for the length of an effect,
        // so a Keyhole or a Counting Cards played later the same turn would
        // scoop them up. A placed card is out of hand, still counts for score
        // (deckOf reads the GY), and the delayed node keeps the same binding,
        // so {self:true} still names the card that was placed.
        then: [
          { op: 'moveTo', target: { self: true }, zone: 'gy' },
          {
            op: 'delayed',
            when: 'startOfNextTurn',
            effects: [{ op: 'playCard', target: { self: true } }],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Place any number of cards from your hand in an order. They activate in that order at the start of your next turn.',
    flavor: 'Tomorrow, in sequence.',
    complexity: 'T3',
    subsystems: ['S-DELAYED'],
    shop: 'draft',
    art: { key: 'the_divined_cosmos', status: 'placeholder' },
  },
  {
    id: 'counting_cards',
    name: 'Counting Cards',
    cost: { money: 9 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    // SB-21, scripted: turn cards off the top one at a time adding their cost,
    // stand at 17 or more, play them all at 21 or under, discard them all on a
    // bust. The running total is read the only way the DSL allows —
    // `sumOfDeckCosts` covers Library, hand, GY and play, so a card set aside
    // drops out of it and `snapshot - sumOfDeckCosts` is exactly what has been
    // turned over. The old test compared 21 against the whole deck's cost sum,
    // which is far above it, so the hand never busted and nothing accumulated.
    // The 12-card ceiling keeps an all-(0) deck terminating. The ace rule has no
    // expression to stand on and is off the text until it does.
    effects: [
      { op: 'addCounter', target: { self: true }, key: 'counter', amount: { expr: 'sumOfDeckCosts' } },
      {
        op: 'repeat',
        times: 12,
        effects: [
          {
            op: 'conditional',
            if: { expr: 'selfCounter - sumOfDeckCosts < 17' },
            then: [
              { op: 'moveTo', target: { who: 'self', zone: 'library', count: 1, pick: 'top' }, zone: 'aside' },
            ],
          },
        ],
      },
      {
        op: 'conditional',
        if: { expr: 'selfCounter - sumOfDeckCosts <= 21' },
        then: [{ op: 'playCard', target: { who: 'self', zone: 'aside', filter: NOT_STORED } }],
        else: [{ op: 'moveTo', target: { who: 'self', zone: 'aside', filter: NOT_STORED }, zone: 'gy' }],
      },
      { op: 'addCounter', target: { self: true }, key: 'counter', amount: { expr: '0 - selfCounter' } },
    ],
    triggers: [],
    text: 'Turn cards off the top of your Library one at a time, adding their costs, until the total reaches 17 or more. At 21 or under, play them all; if you bust, discard them all.',
    flavor: 'The house is your own Library.',
    complexity: 'T4',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'counting_cards', status: 'placeholder' },
  },
  {
    id: 'map_to_the_golden_monkey',
    name: 'Map to the Golden Monkey',
    cost: { money: 8 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      { op: 'copyCard', target: { who: 'self', zone: 'hand' }, to: 'hand' },
    ],
    triggers: [],
    text: 'Flimsy. Duplicate your hand.',
    flavor: 'X marks everything.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'map_to_the_golden_monkey', status: 'placeholder' },
  },
  {
    id: 'one_with_nothing',
    name: 'One With Nothing',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'selectCards',
        from: { who: 'self', zone: 'hand' },
        min: 0,
        max: { expr: 'handSize' },
        then: [{ op: 'trash', target: { self: true } }],
      },
    ],
    triggers: [],
    text: 'Trash any number of cards in your hand. +1 Action.',
    flavor: 'Enlightenment, or an empty hand.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'one_with_nothing', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'controlled_burn',
    name: 'Controlled Burn',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { cards: 2, actions: 1 },
    effects: [{ op: 'trash', target: { who: 'self', zone: 'gy' } }],
    triggers: [],
    text: 'Trash your GY. +2 Cards, +1 Action.',
    flavor: 'On purpose. Mostly.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'controlled_burn', status: 'placeholder', anim: 'trash' },
  },
];

export default cards;
