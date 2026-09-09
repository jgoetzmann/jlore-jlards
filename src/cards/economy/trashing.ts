/**
 * A.8 Draft Shop — trashing, upcycling and deck sculpting.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'pawn_shop',
    name: 'Pawn Shop',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      // The Flimsy rider is about the card you actually trash, so the pick has
      // to be bound before it is tested — a `has` over the whole hand paid out
      // whenever you merely held a Flimsy non-Copper. `$selected` is the picked
      // card's defId, substituted into this body by the resume path.
      {
        op: 'selectCards',
        from: { who: 'self', zone: 'hand', filter: { not: { defId: 'copper' } } },
        min: 1,
        max: 1,
        then: [
          {
            op: 'conditional',
            if: {
              has: {
                target: {
                  who: 'self',
                  zone: 'hand',
                  filter: { defId: '$selected', keyword: 'Flimsy' },
                },
                atLeast: 1,
              },
            },
            then: [{ op: 'gain', stat: 'actions', amount: 1 }],
          },
          { op: 'trash', target: { self: true } },
          { op: 'gain', stat: 'money', amount: 2 },
          { op: 'draw', amount: 1 },
        ],
      },
    ],
    triggers: [],
    text: 'Trash a non-Copper card from your hand: +2 Money, +1 Card. If it was Flimsy, also +1 Action.',
    flavor: 'Everything has a price, briefly.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'pawn_shop', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'daylight_salesman',
    name: 'Daylight Salesman',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      { op: 'trash', target: { who: 'self', zone: 'hand', count: 1, pick: 'choose' } },
      { op: 'gain', stat: 'money', amount: 3 },
    ],
    triggers: [],
    text: 'Trash a card from your hand for +3 Money.',
    flavor: 'Robbery, but well-lit.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'daylight_salesman', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'moonlight_salesman',
    name: 'Moonlight Salesman',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      { op: 'trash', target: { who: 'self', zone: 'hand', count: 1, pick: 'choose' } },
      { op: 'draw', amount: 3 },
    ],
    triggers: [],
    text: 'Trash a card from your hand for +3 Cards.',
    flavor: 'Second job, same product.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'moonlight_salesman', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'upcycle',
    name: 'Upcycle',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      // The upgrade has to key off the card you gave up, so the pick is bound
      // first: no filter can say "costs the picked card's cost + 2", because a
      // NumericFilter takes plain numbers. So the gain is a COPY of the pick,
      // made into your GY and re-priced there by costDelta, and the pick itself
      // is really trashed. Transforming the card in hand and moving it, as this
      // did, meant the printed trash never happened — nothing that watches for
      // one (Safety Net, The Fall Guy, Garlic) ever saw it.
      {
        op: 'selectCards',
        // An Indestructible card cannot be trashed (B12), so it cannot pay for
        // this either; leaving it selectable handed out the upgrade for free.
        from: { who: 'self', zone: 'hand', filter: { not: { keyword: 'Indestructible' } } },
        min: 1,
        max: 1,
        then: [
          { op: 'copyCard', target: { self: true }, to: 'gy', who: 'self' },
          {
            // The copy is the newest card in your GY — createInstance appends
            // and 'bottom' reads the end of the zone — and it still carries the
            // picked card's defId, so the two together name it exactly.
            op: 'transform',
            target: { who: 'self', zone: 'gy', filter: { defId: '$selected' }, count: 1, pick: 'bottom' },
            into: { costDelta: 2 },
          },
          { op: 'trash', target: { self: true } },
        ],
      },
    ],
    triggers: [],
    text: 'Trash a card in your hand to gain a card costing exactly (2) more in your GY. If nothing costs that, you gain a copy of it instead.',
    flavor: 'Same material, better job.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'upcycle', status: 'placeholder' },
  },
  {
    id: 'upcycled_upcycle',
    name: 'Upcycled Upcycle',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      // Same shape as Upcycle — real trash, copy re-priced in the GY — one
      // step steeper.
      {
        op: 'selectCards',
        from: { who: 'self', zone: 'hand', filter: { not: { keyword: 'Indestructible' } } },
        min: 1,
        max: 1,
        then: [
          { op: 'copyCard', target: { self: true }, to: 'gy', who: 'self' },
          {
            op: 'transform',
            target: { who: 'self', zone: 'gy', filter: { defId: '$selected' }, count: 1, pick: 'bottom' },
            into: { costDelta: 3 },
          },
          { op: 'trash', target: { self: true } },
        ],
      },
    ],
    triggers: [],
    text: 'Trash a card in your hand to gain a card costing exactly (3) more in your GY. If nothing costs that, you gain a copy of it instead.',
    flavor: 'It upcycles itself, obviously.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'upcycled_upcycle', status: 'placeholder' },
  },
  {
    id: 'trash_for_treasure',
    name: 'Trash for Treasure',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      { op: 'trash', target: { who: 'self', zone: 'hand', count: 1, pick: 'choose' } },
      {
        op: 'discover',
        pool: { scope: 'shop', filter: { cost: { lte: 3 } } },
        count: 3,
        pick: 1,
        prompt: 'Pick your treasure',
        // Empty `then` is the default Discover semantic: the card you picked
        // enters your hand. Writing a body with {self:true} in it moved *this*
        // card instead, since a discovered card has no instance to bind to.
        then: [],
      },
    ],
    triggers: [],
    text: 'Trash a card in your hand, then Discover a Draft Shop card costing (3) or less and add it to your hand.',
    flavor: 'One man’s.',
    complexity: 'T3',
    subsystems: ['S-DISCOVER'],
    shop: 'draft',
    art: { key: 'trash_for_treasure', status: 'placeholder' },
  },
  {
    id: 'recession_indicator',
    name: 'Recession Indicator',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'epic',
    keywords: [],
    stats: { cards: 1 },
    effects: [
      { op: 'trash', target: { who: 'self', zone: 'hand', filter: { cost: { eq: 0 } } } },
      {
        op: 'choose',
        options: [
          {
            label: 'Also trash every non-Copper (0)-cost card in opponents’ hands',
            effects: [
              {
                op: 'trash',
                target: {
                  who: 'eachOpponent',
                  zone: 'hand',
                  filter: { cost: { eq: 0 }, not: { defId: 'copper' } },
                },
              },
            ],
          },
          { label: 'Leave opponents alone', effects: [{ op: 'noop' }] },
        ],
      },
    ],
    triggers: [],
    text: 'Trash all (0)-cost cards in your hand. You may also trash all non-Copper (0)-cost cards in opponents’ hands. +1 Card.',
    flavor: 'Two consecutive quarters of bad draws.',
    complexity: 'T3',
    subsystems: ['S-STEAL'],
    shop: 'draft',
    art: { key: 'recession_indicator', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'pauper_no_longer',
    name: 'Pauper No Longer',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      // The trash lives inside the loop: `over` is resolved once, up front, so
      // each counted Common is the one that dies and a Common drawn off this
      // card's own +1 Card is never swept up by a second, live re-selection.
      {
        op: 'forEach',
        over: { who: 'self', zone: 'hand', filter: { rarity: 'common' } },
        effects: [
          { op: 'trash', target: { self: true } },
          { op: 'draw', amount: 1 },
          { op: 'gain', stat: 'money', amount: 1 },
        ],
      },
    ],
    triggers: [],
    text: 'Trash all Common cards in your hand. +1 Card and +1 Money for each.',
    flavor: 'Moving up, one Common at a time.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'pauper_no_longer', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'scorched_earth',
    name: 'Scorched Earth',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 3, buys: 2, cards: 4, money: 5 },
    effects: [
      // The stat line resolves before this body, so the printed +4 Cards is
      // already in hand by now and an unbounded trash burned all four of them.
      // Drawn cards land at the bottom of the hand and a selector with no
      // `pick` keeps zone order, so the first handSize-4 are the hand this card
      // was played out of — the "other cards" the row means.
      { op: 'trash', target: { who: 'self', zone: 'hand', count: { expr: 'handSize - 4' } } },
    ],
    triggers: [],
    text: 'Trash all other cards in your hand. +3 Actions, +2 Buys, +4 Cards, +5 Money.',
    flavor: 'Leave nothing for the next turn.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'scorched_earth', status: 'placeholder', anim: 'explode' },
  },
  {
    id: 'restart_mission',
    name: 'Restart Mission',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      { op: 'trash', target: { who: 'self', zone: ['library', 'hand', 'gy'] } },
      {
        op: 'gainCard',
        from: { shop: 'all', filter: { cost: { lte: 7 } }, pick: 'choose' },
        to: 'gy',
        count: 7,
        free: true,
      },
    ],
    triggers: [],
    text: 'Flimsy. Trash your entire deck, then add 7 shop cards costing (7) or less to it.',
    flavor: 'Load last save. There is no last save.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'restart_mission', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'the_ultimate_sacrifice',
    name: 'The Ultimate Sacrifice',
    cost: { money: 8 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      // "Identical" is the whole card, so it names one defId and works from
      // that: pick a card, check you are holding the pair, then walk every copy
      // in the deck. `over` is resolved once before the loop body runs, so the
      // Jlore minted per copy can never be swept up by the trash beside it —
      // the old form counted the entire deck and then trashed all of it.
      {
        op: 'selectCards',
        from: { who: 'self', zone: 'hand', filter: { not: { type: 'Resource' } } },
        min: 1,
        max: 1,
        then: [
          {
            op: 'conditional',
            if: {
              has: {
                target: { who: 'self', zone: 'hand', filter: { defId: '$selected' } },
                atLeast: 2,
              },
            },
            then: [
              {
                op: 'forEach',
                over: { who: 'self', zone: ['library', 'hand', 'gy'], filter: { defId: '$selected' } },
                effects: [
                  { op: 'trash', target: { self: true } },
                  { op: 'createCard', defId: 'jlore', to: 'gy' },
                ],
              },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Name a non-Resource card you hold two copies of: trash every copy of it in your hand, Library and GY, and add that many Jlore to your GY.',
    flavor: 'They went together.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'the_ultimate_sacrifice', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'glitch_in_the_system',
    name: 'Glitch in the System',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'trash',
        target: {
          who: 'eachPlayer',
          zone: ['library', 'hand', 'gy'],
          // (0)–(3) is a closed range: without the floor this also ate every
          // negative-cost card (the Series funding line, Chopped Chuzz).
          filter: { cost: { gte: 0, lte: 3 }, not: { defId: 'copper' } },
        },
      },
    ],
    triggers: [],
    text: 'Trash every card costing (0) to (3) in every deck, except Copper.',
    flavor: 'The economy stutters, then resumes.',
    complexity: 'T3',
    subsystems: ['S-STEAL'],
    shop: 'draft',
    art: { key: 'glitch_in_the_system', status: 'placeholder', anim: 'explode' },
  },
  {
    id: 'twisting_nether',
    name: 'Twisting Nether',
    cost: { money: 9 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'legendary',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      { op: 'trashPile', target: { shop: 'all', pick: 'choose', excludeJlore: true } },
    ],
    triggers: [],
    text: 'Flimsy. Choose a shop pile other than Jlore and trash it entirely.',
    flavor: 'It was there. Now it is not.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'twisting_nether', status: 'placeholder', anim: 'explode' },
  },
  {
    id: 'safety_net',
    name: 'Safety Net',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [],
    // STILL BLOCKED — a trash REDIRECT has no hook. `onTrash` is in SELF_EVENTS
    // (effects/triggers.ts), so fireEvent only ever offers it to the card that
    // was trashed, and trashWithTrigger calls trashInstance BEFORE fireEvent, so
    // by the time any listener runs the subject is already in the trash and its
    // zone no longer matches `zones` — this trigger is inert in every path, and
    // inert is the right failure. It needs a table-wide pre-move event carrying
    // the subject iid so a listener can divert it, plus an owner axis on trash
    // selection: `zone:'trash'` ignores `who` (select.ts scans the whole pile),
    // so an end-of-turn approximation would rescue an OPPONENT'S card into the
    // opponent's GY, which is worse than doing nothing. When the hook lands, the
    // condition and target below both need rewriting, not just re-pointing.
    triggers: [
      {
        on: 'onTrash',
        zones: ['play'],
        maxPerTurn: 1,
        condition: {
          not: {
            has: {
              target: { who: 'self', zone: 'trash', filter: { keyword: 'Temporary' } },
              atLeast: 1,
            },
          },
        },
        effects: [
          { op: 'moveTo', target: { who: 'self', zone: 'trash', count: 1, pick: 'lastPlayed' }, zone: 'gy' },
          { op: 'draw', amount: 1 },
        ],
      },
    ],
    text: 'The next non-Temporary card of yours that would be trashed this turn goes to your GY instead. If that happens, +1 Card. +1 Action.',
    flavor: 'Caught. Bruised, but caught.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'safety_net', status: 'placeholder' },
  },
  {
    id: 'the_fall_guy',
    name: 'The Fall Guy',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { cards: 1 },
    effects: [],
    // STILL BLOCKED, same hook as Safety Net. A bystander sitting in the Library
    // can never see another card's trash: `onTrash` is a SELF_EVENT, so fireEvent
    // pushes only the subject as a candidate, and the zone test runs after the
    // move. Substituting one card for another additionally needs the pre-move
    // event to carry the subject iid, and the printed 'non-Flimsy effect' guard
    // needs the trash SOURCE in the trigger vars — neither exists. Left inert
    // rather than approximated; the +1 Card stat line is all this does today.
    triggers: [
      {
        on: 'onTrash',
        zones: ['library', 'hand', 'gy'],
        effects: [
          { op: 'moveTo', target: { who: 'self', zone: 'trash', count: 1, pick: 'lastPlayed' }, zone: 'gy' },
          { op: 'trash', target: { self: true } },
        ],
      },
    ],
    text: 'Whenever one of your cards would be trashed by a non-Flimsy effect, this leaps out of your deck and is trashed instead. +1 Card.',
    flavor: 'Somebody has to.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'the_fall_guy', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'card_sleeve',
    name: 'Card Sleeve',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: { actions: 1, cards: 1 },
    effects: [
      // Your deck, not the play area: the Sleeve is sitting in 'play' while
      // this resolves, and stripping Flimsy there stripped its own printed
      // keyword before the cleanup step could read it. It protects everything
      // but itself.
      {
        op: 'setKeyword',
        target: { who: 'self', zone: ['library', 'hand', 'gy'] },
        keyword: 'Flimsy',
        on: false,
      },
      {
        op: 'setKeyword',
        target: { who: 'self', zone: ['library', 'hand', 'gy'] },
        keyword: 'Temporary',
        on: false,
      },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action, +1 Card. Remove Flimsy and Temporary from every card in your deck.',
    flavor: 'Protects everything but itself.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'card_sleeve', status: 'placeholder' },
  },
  {
    id: 'cookie_gruzzler',
    name: 'Cookie Gruzzler',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      // A selector's `count` is a TOTAL across everyone `who` reached, so a bare
      // 'eachPlayer' moveTo ate one card at the whole table — always the
      // caster's own. `perPlayer` runs the count-and-pick once per resolved
      // player, which is exactly this row, and it costs none of the collateral
      // `recruit` charged for the same fan-out: recruit reshuffles every Library
      // it draws from (B42) and nothing on this card prints a shuffle.
      //
      // No `who` on the move, so each card keeps its owner and lands in ITS
      // player's aside, which is what the nodes below read.
      {
        op: 'moveTo',
        target: { who: 'eachPlayer', zone: 'library', count: 1, pick: 'top', perPlayer: true },
        zone: 'aside',
      },
      // `aside` is one shared staging pile per player (SB-51), so the tops are
      // marked and every node below reads the mark rather than "whatever is in
      // aside": a Hand Box's stored hand sits in the same pile under `boxed`
      // and is not food. The staging lasts the length of this body only.
      {
        op: 'addCounter',
        target: {
          who: 'eachPlayer',
          zone: 'aside',
          filter: { not: { counter: { key: 'boxed', gte: 1 } } },
        },
        key: 'gruzzled',
        amount: 1,
      },
      // The row says trash, and the trash is where they wait: the tag survives
      // the move (B63), so the trigger can find exactly these instances in a
      // pile that holds everything anyone ever trashed.
      {
        op: 'trash',
        target: { who: 'eachPlayer', zone: 'aside', filter: { counter: { key: 'gruzzled', gte: 1 } } },
      },
      // Indestructible beats every trash (B12) and the survivor would otherwise
      // sit in `aside` for the rest of the game, where a Hand Box or Corpo
      // Espionage would find it. It goes back on top of the Library it came
      // from; it can never reach the trash, so the tag it keeps is inert.
      {
        op: 'moveTo',
        target: { who: 'eachPlayer', zone: 'aside', filter: { counter: { key: 'gruzzled', gte: 1 } } },
        zone: 'library',
        position: 'top',
      },
      // Keyed 'counter' because that is the only name `selfCounter` reads; any
      // other key falls back to the sum of every counter, playCount included.
      // It caps the payout at this Gruzzler's own meal, so a second one at the
      // table cannot hand over what it ate, and a Gruzzler trashed out of hand
      // without ever being played pays nothing.
      { op: 'addCounter', target: { self: true }, key: 'counter', amount: { expr: 'playerCount' } },
    ],
    triggers: [
      {
        on: 'onTrash',
        effects: [
          // Found by the tag, not by a count off the trash pile, and `who`
          // names the destination owner: without it a moved card keeps its
          // owner and an opponent's card goes home to the opponent's GY.
          {
            op: 'moveTo',
            target: {
              zone: 'trash',
              filter: { counter: { key: 'gruzzled', gte: 1 } },
              count: { expr: 'selfCounter' },
            },
            zone: 'gy',
            who: 'self',
          },
        ],
      },
    ],
    text: 'Trash the top card of each player’s Library. When this card is trashed, add them all to your GY.',
    flavor: 'It keeps them somewhere.',
    complexity: 'T3',
    subsystems: ['S-PERSIST', 'S-STEAL'],
    shop: 'draft',
    art: { key: 'cookie_gruzzler', status: 'placeholder' },
  },
  {
    id: 'corrosion',
    name: 'Corrosion',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    effects: [
      {
        op: 'setKeyword',
        target: {
          who: 'eachOpponent',
          zone: ['library', 'hand', 'gy'],
          count: 3,
          pick: 'random',
        },
        keyword: 'Flimsy',
        on: true,
      },
    ],
    triggers: [],
    text: '+1 Action, +1 Card. Give Flimsy to 3 cards in opponents’ decks.',
    flavor: 'It spreads where it is wettest.',
    complexity: 'T3',
    subsystems: ['S-STEAL'],
    shop: 'draft',
    art: { key: 'corrosion', status: 'placeholder' },
  },
  {
    id: 'zzlurper',
    name: 'Zzlurper',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'trash', target: { zone: 'shop', count: 1, pick: 'choose' } },
    ],
    triggers: [],
    text: 'Trash a card in the Shop. +1 Action.',
    flavor: 'Zzlurp.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'zzlurper', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'coal',
    name: 'Coal',
    cost: { money: 0 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { money: -1 },
    // No hand-rolled play counter: `playCard` already stamps one on the
    // instance, and a second increment made the printed tally read double.
    effects: [],
    triggers: [
      {
        on: 'onPlay',
        // A bare `selfPlayCount - 2` is truthy on every play except the second,
        // so Coal cashed out immediately on play one. Conditions run through
        // the comparison-aware evaluator, so say what the row says.
        condition: { expr: 'selfPlayCount == 3' },
        effects: [
          { op: 'trash', target: { self: true } },
          { op: 'createCard', defId: 'diamond', to: 'hand' },
        ],
      },
    ],
    text: '-1 Money. On the 3rd play, trash this and add a Diamond to your hand. ({selfPlayCount} of 3 played!)',
    flavor: 'Pressure, time, and two bad turns.',
    complexity: 'T4',
    subsystems: ['S-PERSIST', 'S-TEXTGEN'],
    shop: 'draft',
    art: { key: 'coal', status: 'placeholder' },
  },
];

export default cards;
