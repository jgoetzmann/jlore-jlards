/**
 * A.13 — Draft Shop: the Felinor (cat) archetype.
 *
 * Slice S7 (cards-archetypes). The Felinor token itself (`felinor`) is owned by
 * the tribes slice and is only referenced here, as are `warhero_token`,
 * `robux`, and the `food` sub-catalog.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'recurring_felinor',
    name: 'Recurring Felinor',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: ['Felinor'],
    tags: ['Legacy'],
    rarity: 'epic',
    keywords: [],
    stats: { cards: 2 },
    effects: [],
    triggers: [{ on: 'onTrash', effects: [{ op: 'moveTo', target: { self: true }, zone: 'gy' }] }],
    text: '+2 Cards. When this is trashed, it goes to the current player’s GY instead.',
    flavor: 'It keeps coming back and it keeps not being yours.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'recurring_felinor', status: 'placeholder' },
  },
  {
    id: 'felinor_feelings',
    name: 'Felinor Feelings',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      { op: 'createCard', defId: 'felinor', to: 'hand' },
      { op: 'createCard', defId: 'felinor', to: 'gy', who: 'eachOpponent' },
    ],
    triggers: [],
    text: 'Add a Felinor to your hand and a Felinor to each opponent’s GY.',
    flavor: 'Shared custody, unshared affection.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'felinor_feelings', status: 'placeholder', anim: 'summon' },
  },
  {
    id: 'two_mans',
    name: 'Two Mans',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { zone: 'hand', filter: { subtype: 'Felinor' } }, atLeast: 1 } },
        then: [
          { op: 'trash', target: { zone: 'hand', filter: { subtype: 'Felinor' }, count: 1, pick: 'choose' } },
          { op: 'moveTo', target: { zone: 'library', count: 1, pick: 'mostExpensive' }, zone: 'hand' },
        ],
        else: [
          { op: 'trash', target: { zone: 'hand', count: 1, pick: 'choose' } },
          { op: 'createCard', defId: 'felinor', to: 'hand' },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action. Trash another card in your hand. If it was a Felinor, draw your most expensive card. Otherwise add a Felinor to your hand.',
    flavor: 'Two of them. Always exactly two.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'two_mans', status: 'placeholder' },
  },
  {
    id: 'all_night_baby',
    name: 'All Night Baby',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { zone: 'hand', filter: { subtype: 'Felinor' } }, atLeast: 1 } },
        then: [
          { op: 'trash', target: { zone: 'hand', filter: { subtype: 'Felinor' }, count: 1, pick: 'choose' } },
          { op: 'gain', stat: 'actions', amount: 3 },
        ],
        else: [
          { op: 'trash', target: { zone: 'hand', count: 1, pick: 'choose' } },
          { op: 'gain', stat: 'actions', amount: 1 },
        ],
      },
    ],
    triggers: [],
    text: 'Trash a card in your hand for +1 Action. If it was a Felinor, +3 Actions instead.',
    flavor: 'Three in the morning and it wants to play.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'all_night_baby', status: 'placeholder' },
  },
  {
    id: 'lord_of_the_cave',
    name: 'Lord of the Cave',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      { op: 'createCard', defId: 'felinor', to: 'gy' },
      {
        op: 'conditional',
        if: { has: { target: { zone: 'hand', filter: { subtype: 'Felinor' } }, atLeast: 1 } },
        then: [
          {
            op: 'choose',
            options: [
              {
                label: 'Trash a Felinor for a Robux',
                effects: [
                  { op: 'trash', target: { zone: 'hand', filter: { subtype: 'Felinor' }, count: 1, pick: 'choose' } },
                  { op: 'createCard', defId: 'robux', to: 'gy' },
                ],
              },
              { label: 'Keep your Felinors', effects: [{ op: 'noop' }] },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Add a Felinor to your GY. You may trash a Felinor in your hand to add a Robux to your GY.',
    flavor: 'The cave is his. You are a guest with snacks.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'lord_of_the_cave', status: 'placeholder', anim: 'summon' },
  },
  {
    id: 'mewing',
    name: 'Mewing',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'discover',
        pool: { scope: 'knownUniverse', filter: { type: 'Action' } },
        count: 3,
        pick: 1,
        prompt: 'Discover an Action to send to your GY with a Felinor.',
        then: [
          // '$discovered' resolves to the defId the player actually picked.
          // The old `then` re-rolled the pool and dropped a second, unrelated
          // Action into the GY, so the pick did nothing. The printed rider — a
          // Felinor that plays that Action when trashed — needs a trigger on an
          // instance, which only a definition can carry, so the two cards go to
          // the GY side by side instead.
          { op: 'createCard', defId: 'felinor', to: 'gy' },
          { op: 'createCard', defId: '$discovered', to: 'gy' },
        ],
      },
    ],
    triggers: [],
    text: 'Discover an Action from your Known Universe and add it to your GY, along with a Felinor.',
    flavor: 'Jaw sharp, plan sharper.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-CODEX'],
    shop: 'draft',
    art: { key: 'mewing', status: 'placeholder', anim: 'summon' },
  },
  {
    id: 'nine_lives_loan',
    name: 'Nine Lives Loan',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { zone: 'hand', filter: { subtype: 'Felinor' } }, atLeast: 1 } },
        then: [
          { op: 'trash', target: { zone: 'hand', filter: { subtype: 'Felinor' }, count: 1, pick: 'choose' } },
          { op: 'gain', stat: 'money', amount: 3 },
        ],
      },
      { op: 'createCard', defId: 'felinor', to: 'library', position: 'top' },
    ],
    triggers: [],
    text: '+1 Action. Trash a Felinor from your hand for +3 Money, then put a Felinor on top of your Library.',
    flavor: 'The terms are nine lives. The interest is eight.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'nine_lives_loan', status: 'placeholder', anim: 'coin' },
  },
  {
    id: 'night_on_the_town',
    name: 'Night on the Town',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'choose',
        options: [
          {
            label: 'Turn every Felinor in your hand into a Robux',
            effects: [{ op: 'transform', target: { zone: 'hand', filter: { subtype: 'Felinor' } }, into: 'robux' }],
          },
          {
            label: 'Turn every Robux in your hand into a Felinor',
            effects: [{ op: 'transform', target: { zone: 'hand', filter: { defId: 'robux' } }, into: 'felinor' }],
          },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action. Choose one: turn all Felinors in your hand into Robux, or turn all Robux in your hand into Felinors.',
    flavor: 'Cash out or cat out.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'night_on_the_town', status: 'placeholder', anim: 'summon' },
  },
  {
    id: 'felinor_factory',
    name: 'Felinor Factory',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'createCard', defId: 'felinor', to: 'hand' },
      {
        op: 'conditional',
        if: { has: { target: { zone: 'trash', filter: { subtype: 'Felinor' } }, atLeast: 1 } },
        then: [
          { op: 'gain', stat: 'money', amount: 2 },
          { op: 'draw', amount: 1 },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action. Add a Felinor to your hand. If you trashed a Felinor this turn, +2 Money and +1 Card.',
    flavor: 'Output measured in purrs per hour.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'felinor_factory', status: 'placeholder', anim: 'summon' },
  },
  {
    id: 'box_of_kitties',
    name: 'Box of Kitties',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'createCard', defId: 'felinor', to: 'hand', count: 2 },
      {
        op: 'conditional',
        if: { has: { target: { zone: 'trash', filter: { subtype: 'Felinor' } }, atLeast: 1 } },
        then: [{ op: 'gain', stat: 'buys', amount: 1 }],
      },
    ],
    triggers: [],
    text: '+1 Action. Add 2 Felinors to your hand. If you trash a Felinor this turn, +1 Buy.',
    flavor: 'Free to a good home. Any home. Please.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'box_of_kitties', status: 'placeholder', anim: 'summon' },
  },
  {
    id: 'maid_dress',
    name: 'Maid Dress',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { zone: 'hand', filter: { subtype: 'Felinor' } }, atLeast: 1 } },
        then: [
          // Printed as "trash ... and replace it", so it trashes for real: a
          // Recurring Felinor spent here still gets its onTrash return and the
          // archetype's trash payoffs see it. `transform` fires neither.
          { op: 'trash', target: { zone: 'hand', filter: { subtype: 'Felinor' }, count: 1, pick: 'choose' } },
          { op: 'createCard', defId: 'ssr_plus_catboy_maid', to: 'hand' },
        ],
      },
    ],
    triggers: [{ on: 'onBuy', effects: [{ op: 'createCard', defId: 'felinor', to: 'gy' }] }],
    text: 'When you buy this, add a Felinor to your GY. When you play it, trash a Felinor in your hand and replace it with an SSR+ Catboy Maid.',
    flavor: 'The fit is the whole strategy.',
    complexity: 'T3',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'maid_dress', status: 'placeholder', anim: 'summon' },
  },
  {
    id: 'ssr_plus_catboy_maid',
    name: 'SSR+ Catboy Maid',
    cost: { money: 5 },
    types: ['Action', 'Points'],
    subtypes: ['Felinor'],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: { cards: 2, vp: 2 },
    effects: [],
    triggers: [],
    text: 'Flimsy. +2 Cards, +2 VP.',
    flavor: 'Pulled at a 0.6% rate. Worth every pity counter.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'ssr_plus_catboy_maid', status: 'placeholder' },
  },
  {
    id: 'chonker',
    name: 'Chonker',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Felinor'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 4 },
    effects: [],
    triggers: [
      { on: 'onTrash', effects: [{ op: 'createCard', defId: { pool: { catalog: 'food' } }, to: 'hand' }] },
    ],
    text: 'Big Action 2. +4 Cards. When this is trashed, add a Food to your hand.',
    flavor: 'He is not fat. He is load-bearing.',
    complexity: 'T3',
    subsystems: ['S-BIGACTION', 'S-TOKEN'],
    shop: 'draft',
    art: { key: 'chonker', status: 'placeholder' },
    bigAction: 2,
  },
  {
    id: 'took_him_to_the_jo',
    name: "Took Him to the J'O",
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    // The raid is the escort’s onTrash, not an end-of-turn timer, so it needs
    // a definition of its own to hang the trigger on (`jo_felinor`, below).
    effects: [{ op: 'createCard', defId: 'jo_felinor', to: 'gy' }],
    triggers: [],
    text: 'Add a Felinor to your GY. When that Felinor is trashed, trash the top 2 cards of each opponent’s Library and steal any of them costing (6) or more.',
    flavor: 'He went in a passenger. He came out a partner.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-PVP'],
    shop: 'draft',
    art: { key: 'took_him_to_the_jo', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'grinder_veteran',
    name: 'Grinder Veteran',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      // Park the recruit in `aside` so the payoff reads the card that was just
      // recruited and not a Felinor that was already sitting in hand. `recruit`
      // moves with an explicit owner, so the parked card stays selectable, and
      // the last node hands it over either way. `aside` is ONE shared staging
      // pile per player, so both reads below skip anything a Hand Box has
      // stored there (the `boxed` counter) — otherwise a boxed Felinor pays out
      // the tokens and the hand-off empties the box.
      { op: 'recruit', zone: 'library', filter: { keyword: 'Flimsy' }, count: 1, to: 'aside' },
      {
        op: 'conditional',
        if: {
          has: {
            target: {
              zone: 'aside',
              filter: { subtype: 'Felinor', not: { counter: { key: 'boxed', gte: 1 } } },
            },
            atLeast: 1,
          },
        },
        then: [{ op: 'createCard', defId: 'warhero_token', to: 'hand', count: 2 }],
      },
      {
        op: 'moveTo',
        target: {
          zone: 'aside',
          filter: { keyword: 'Flimsy', not: { counter: { key: 'boxed', gte: 1 } } },
        },
        zone: 'hand',
      },
    ],
    triggers: [],
    text: 'Recruit a Flimsy card from your Library. If it was a Felinor, add 2 Warhero Tokens to your hand.',
    flavor: 'Twenty thousand hours and no rank to show for it.',
    complexity: 'T3',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'grinder_veteran', status: 'placeholder' },
  },
  {
    id: 'the_menagerie',
    name: 'The Menagerie',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 2, money: 2 },
    effects: [
      { op: 'createCard', defId: 'felinor', to: 'gy' },
      { op: 'createCard', defId: 'cursed_pig', to: 'gy' },
    ],
    triggers: [],
    text: '+2 Actions, +2 Money. Add a Felinor and a Cursed Pig to your GY.',
    flavor: 'Every collection has one exhibit you regret.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'the_menagerie', status: 'placeholder', anim: 'summon' },
  },
  {
    id: 'spider_eb',
    name: 'Spider E.B.',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, cards: 2 },
    effects: [
      { op: 'createCard', defId: 'felinor', to: 'gy', count: 2, counters: { plague: 1 } },
    ],
    triggers: [],
    text: '+1 Action, +2 Cards. Add 2 Felinors to your GY, each carrying 1 Plague Token.',
    flavor: 'Eight legs, nine lives, one very bad idea.',
    complexity: 'T3',
    subsystems: ['S-PLAGUE', 'S-TOKEN'],
    shop: 'draft',
    art: { key: 'spider_eb', status: 'placeholder', anim: 'summon' },
  },
  {
    id: 'cn_auspicious_kitty',
    name: 'CN Auspicious Kitty',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['CN'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'choose',
        options: [
          { label: 'A Felinor with +2 Money', effects: [{ op: 'createCard', defId: 'felinor', to: 'hand', statDelta: { money: 2 } }] },
          { label: 'A Felinor with +2 VP', effects: [{ op: 'createCard', defId: 'felinor', to: 'hand', statDelta: { vp: 2 } }] },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action. Add a Felinor to your hand with either +2 Money or +2 VP.',
    flavor: 'The paw waves. The fortune follows.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'cn_auspicious_kitty', status: 'placeholder', anim: 'summon' },
  },
  {
    // The Felinor Took Him to the J'O adds to your GY. A trigger can only be
    // read off a definition, never off an instance, so the escort is its own
    // token: a Flimsy Felinor whose onTrash is the raid. The top 2 of each
    // Library are staged in `aside` first so the (6)+ filter reads those two
    // cards rather than the whole Library. Notes on the three nodes:
    //   - `recruit` and not a moveTo selector: a Selector's `count` is a total
    //     across every matched player, so {who:'eachOpponent', count:2} would
    //     mill 2 cards off ONE opponent and never touch the rest. `recruit`
    //     applies `count` per resolved player, which is what “each opponent”
    //     means. Its trailing library shuffle is the price of that.
    //   - `moveTo ... who:'self'` is the steal: `who` names the owner the card
    //     ends up with, so the (6)+ cards land in the raider's GY instead of
    //     going home. They leave `aside` before the trash node, so they survive.
    //   - `aside` is ONE shared staging pile per player, so both reads exclude
    //     anything a Hand Box has stored there (the `boxed` counter); without
    //     that the trash node would destroy an opponent's stored cards.
    id: 'jo_felinor',
    name: "J'O Felinor",
    cost: { money: 0 },
    types: ['Action', 'Token'],
    subtypes: ['Felinor'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { cards: 2 },
    effects: [],
    triggers: [
      {
        on: 'onTrash',
        effects: [
          { op: 'recruit', who: 'eachOpponent', zone: 'library', count: 2, to: 'aside' },
          {
            op: 'moveTo',
            target: {
              who: 'eachOpponent',
              zone: 'aside',
              filter: { cost: { gte: 6 }, not: { counter: { key: 'boxed', gte: 1 } } },
            },
            zone: 'gy',
            who: 'self',
          },
          {
            op: 'trash',
            target: {
              who: 'eachOpponent',
              zone: 'aside',
              filter: { not: { counter: { key: 'boxed', gte: 1 } } },
            },
          },
        ],
      },
    ],
    text: 'Flimsy. +2 Cards. When this is trashed, trash the top 2 cards of each opponent’s Library and steal any of them costing (6) or more.',
    flavor: 'He went along for the ride. He came back with luggage.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-PVP'],
    notPurchasable: true,
    art: { key: 'jo_felinor', status: 'placeholder', anim: 'trash' },
  },
];

export default cards;
