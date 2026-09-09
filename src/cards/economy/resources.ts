/**
 * A.6 Draft Shop — Resource manipulation and refining.
 *
 * SB-6: the (5) Resource is `blood_diamond` / "Blood Diamond"; the (10) Action
 * is `blood_diamond_cutter` / "Blood Diamond Cutter". Two ids, two names.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'fools_gold',
    name: "Fool's Gold",
    cost: { money: 0 },
    types: ['Resource'],
    subtypes: ['Gold'],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { money: 3 },
    effects: [],
    triggers: [],
    text: 'Flimsy. +3 Money.',
    flavor: 'It glitters exactly once.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'fools_gold', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'gleamstone',
    name: 'Gleamstone',
    cost: { money: 8 },
    types: ['Resource'],
    subtypes: ['Diamond'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { money: 4, buys: 1 },
    effects: [],
    triggers: [],
    text: '+4 Money, +1 Buy.',
    flavor: 'Cut for spending, not for wearing.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'gleamstone', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'blood_diamond',
    name: 'Blood Diamond',
    cost: { money: 5 },
    types: ['Resource'],
    subtypes: ['Diamond'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { money: 5, vp: -5 },
    effects: [],
    triggers: [],
    text: '+5 Money, -5 VP.',
    flavor: 'Somebody paid for this. Not you.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'blood_diamond', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'blood_diamond_cutter',
    name: 'Blood Diamond Cutter',
    cost: { money: 10 },
    types: ['Action'],
    subtypes: ['Diamond'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1, money: 5 },
    effects: [],
    triggers: [
      // A shop pile never receives startOfTurn, so the discount has to be paid
      // back at the moment of purchase instead of shaved off the price: buy()
      // debits the price first (core/buy.ts) and only then fires onBuy, so no
      // trigger on this card can reach the price it was bought at. The refund
      // is the same arithmetic one step later — the doc row's "reduce cost by
      // (2) each" now reads "refund (2) each", and nothing here touches a cost
      // modifier any more, so this card is no longer an S-COSTMOD card.
      {
        on: 'onBuy',
        effects: [
          {
            op: 'selectCards',
            from: { who: 'self', zone: 'hand', filter: { type: 'Action', cost: { lte: 1 } } },
            min: 0,
            max: 99,
            then: [
              { op: 'trash', target: { self: true } },
              { op: 'gain', stat: 'money', amount: 2 },
            ],
          },
        ],
      },
    ],
    text: 'When you buy this you may trash any number of Actions costing (1) or less from your hand; each one refunds (2) Money. +1 Action, +5 Money.',
    flavor: 'A steady hand and a cheap conscience.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'blood_diamond_cutter', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'magnet',
    name: 'Magnet',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      // gainCard takes one card per matching pile, and there is exactly one
      // Copper pile — so visit it three times rather than asking for three.
      {
        op: 'repeat',
        times: 3,
        effects: [
          {
            op: 'gainCard',
            from: { shop: 'resource', filter: { defId: 'copper' } },
            to: 'hand',
            count: 1,
            free: true,
          },
        ],
      },
    ],
    triggers: [],
    text: 'Add up to 3 Copper from the Resource Shop to your hand. +1 Action.',
    flavor: 'Attracts only the cheap stuff.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'magnet', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'simple_refining',
    name: 'Simple Refining',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'transform',
        target: { who: 'self', zone: 'hand', filter: { defId: 'copper' }, count: 1, pick: 'choose' },
        // `upgrade` resolves as "a random card costing one more", which can
        // never be a Silver. Name the rung.
        into: 'silver',
      },
    ],
    triggers: [],
    text: 'Trash a Copper in your hand and add a Silver to your hand.',
    flavor: 'Heat, pressure, paperwork.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'simple_refining', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'advanced_refining',
    name: 'Advanced Refining',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      // The ladder is spelled out rung by rung: `into:'upgrade'` resolves as a
      // random card costing one more, which leaves the ladder entirely.
      //
      // opChoose builds its prompt from every option unconditionally — it never
      // hides a rung the player cannot take — and auto-resolve (defaultKeys
      // ['0']) and the sim bot both take option 0. So option 0 is the one that
      // always lands: it upgrades the best rung actually in hand. The three
      // named rungs stay for a player who wants a particular one.
      {
        op: 'choose',
        options: [
          {
            label: 'Upgrade the best rung you hold',
            effects: [
              {
                op: 'conditional',
                if: { has: { target: { who: 'self', zone: 'hand', filter: { defId: 'gold' } }, atLeast: 1 } },
                then: [
                  {
                    op: 'transform',
                    target: { who: 'self', zone: 'hand', filter: { defId: 'gold' }, count: 1, pick: 'choose' },
                    into: 'diamond',
                  },
                ],
                else: [
                  {
                    op: 'conditional',
                    if: {
                      has: { target: { who: 'self', zone: 'hand', filter: { defId: 'silver' } }, atLeast: 1 },
                    },
                    then: [
                      {
                        op: 'transform',
                        target: { who: 'self', zone: 'hand', filter: { defId: 'silver' }, count: 1, pick: 'choose' },
                        into: 'gold',
                      },
                    ],
                    // No Gold and no Silver: the Copper rung, which is a no-op
                    // of its own if the hand holds none of those either.
                    else: [
                      {
                        op: 'transform',
                        target: { who: 'self', zone: 'hand', filter: { defId: 'copper' }, count: 1, pick: 'choose' },
                        into: 'silver',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            label: 'Copper → Silver',
            effects: [
              {
                op: 'transform',
                target: { who: 'self', zone: 'hand', filter: { defId: 'copper' }, count: 1, pick: 'choose' },
                into: 'silver',
              },
            ],
          },
          {
            label: 'Silver → Gold',
            effects: [
              {
                op: 'transform',
                target: { who: 'self', zone: 'hand', filter: { defId: 'silver' }, count: 1, pick: 'choose' },
                into: 'gold',
              },
            ],
          },
          {
            label: 'Gold → Diamond',
            effects: [
              {
                op: 'transform',
                target: { who: 'self', zone: 'hand', filter: { defId: 'gold' }, count: 1, pick: 'choose' },
                into: 'diamond',
              },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Trash a Copper, Silver or Gold in your hand and add its upgrade to your hand. Name the rung, or let it take the best one you hold.',
    flavor: 'Copper to Silver to Gold to Diamond. No further.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'advanced_refining', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'pennymelting',
    name: 'Pennymelting',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      // Each rung is named outright — `into:'downgrade'` picks a random card
      // costing one less — and the second copy is bound to the card that was
      // just melted rather than re-picked out of the hand.
      //
      // As on Advanced Refining, opChoose offers every rung whether or not the
      // hand holds it and auto-resolve takes option 0, so option 0 walks down
      // to the best rung actually present instead of dudding out.
      {
        op: 'choose',
        options: [
          {
            label: 'Melt the best rung you hold',
            effects: [
              {
                op: 'conditional',
                if: { has: { target: { who: 'self', zone: 'hand', filter: { defId: 'diamond' } }, atLeast: 1 } },
                then: [
                  {
                    op: 'selectCards',
                    from: { who: 'self', zone: 'hand', filter: { defId: 'diamond' } },
                    min: 1,
                    max: 1,
                    then: [
                      { op: 'transform', target: { self: true }, into: 'gold' },
                      { op: 'copyCard', target: { self: true }, to: 'hand' },
                    ],
                  },
                ],
                else: [
                  {
                    op: 'conditional',
                    if: { has: { target: { who: 'self', zone: 'hand', filter: { defId: 'gold' } }, atLeast: 1 } },
                    then: [
                      {
                        op: 'selectCards',
                        from: { who: 'self', zone: 'hand', filter: { defId: 'gold' } },
                        min: 1,
                        max: 1,
                        then: [
                          { op: 'transform', target: { self: true }, into: 'silver' },
                          { op: 'copyCard', target: { self: true }, to: 'hand' },
                        ],
                      },
                    ],
                    else: [
                      {
                        op: 'conditional',
                        if: {
                          has: { target: { who: 'self', zone: 'hand', filter: { defId: 'silver' } }, atLeast: 1 },
                        },
                        then: [
                          {
                            op: 'selectCards',
                            from: { who: 'self', zone: 'hand', filter: { defId: 'silver' } },
                            min: 1,
                            max: 1,
                            then: [
                              { op: 'transform', target: { self: true }, into: 'copper' },
                              { op: 'copyCard', target: { self: true }, to: 'hand' },
                            ],
                          },
                        ],
                        // Bottom of the ladder, and a silent no-op when the
                        // hand holds no Resource at all.
                        else: [
                          {
                            op: 'selectCards',
                            from: { who: 'self', zone: 'hand', filter: { defId: 'copper' } },
                            min: 1,
                            max: 1,
                            then: [{ op: 'copyCard', target: { self: true }, to: 'hand' }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            label: 'Copper → 2 Copper',
            effects: [
              {
                op: 'selectCards',
                from: { who: 'self', zone: 'hand', filter: { defId: 'copper' } },
                min: 1,
                max: 1,
                // A Copper is the bottom rung and stays a Copper, so it only
                // gains its second copy.
                then: [{ op: 'copyCard', target: { self: true }, to: 'hand' }],
              },
            ],
          },
          {
            label: 'Silver → 2 Copper',
            effects: [
              {
                op: 'selectCards',
                from: { who: 'self', zone: 'hand', filter: { defId: 'silver' } },
                min: 1,
                max: 1,
                then: [
                  { op: 'transform', target: { self: true }, into: 'copper' },
                  { op: 'copyCard', target: { self: true }, to: 'hand' },
                ],
              },
            ],
          },
          {
            label: 'Gold → 2 Silver',
            effects: [
              {
                op: 'selectCards',
                from: { who: 'self', zone: 'hand', filter: { defId: 'gold' } },
                min: 1,
                max: 1,
                then: [
                  { op: 'transform', target: { self: true }, into: 'silver' },
                  { op: 'copyCard', target: { self: true }, to: 'hand' },
                ],
              },
            ],
          },
          {
            label: 'Diamond → 2 Gold',
            effects: [
              {
                op: 'selectCards',
                from: { who: 'self', zone: 'hand', filter: { defId: 'diamond' } },
                min: 1,
                max: 1,
                then: [
                  { op: 'transform', target: { self: true }, into: 'gold' },
                  { op: 'copyCard', target: { self: true }, to: 'hand' },
                ],
              },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Trash a Resource in your hand and add 2 copies of its downgrade to your hand. Name the rung, or let it take the best one you hold. +1 Action.',
    flavor: 'Two worse things beat one better thing. Sometimes.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'pennymelting', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'currency_cremator',
    name: 'Currency Cremator',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'trash',
        target: { who: 'self', zone: 'hand', filter: { type: 'Resource' }, count: 1, pick: 'choose' },
      },
      { op: 'gain', stat: 'money', amount: 3 },
    ],
    triggers: [],
    text: 'Trash a Resource card from your hand for +3 Money.',
    flavor: 'Ashes, but liquid.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'currency_cremator', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'goldoron',
    name: 'Goldoron',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: ['Flimsy'],
    stats: {},
    effects: [{ op: 'createCard', defId: 'gold', to: 'gy' }],
    triggers: [],
    text: 'Flimsy. Add a Gold to your GY.',
    flavor: 'One gold, one goodbye.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'goldoron', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'diamondozen',
    name: 'Diamondozen',
    cost: { money: 8 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [{ op: 'createCard', defId: 'diamond', to: 'hand' }],
    triggers: [],
    text: 'Flimsy. Add a Diamond to your hand.',
    flavor: 'Not a dozen. Just the one.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'diamondozen', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'shine_bright',
    name: 'Shine Bright',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'transform',
        target: { who: 'self', zone: 'hand', filter: { defId: 'gold' } },
        into: 'diamond',
      },
      {
        op: 'transform',
        target: { who: 'self', zone: 'gy', filter: { defId: 'gold' } },
        into: 'diamond',
      },
    ],
    triggers: [],
    text: 'Turn every Gold in your hand into a Diamond, then do the same for your GY. +1 Action.',
    flavor: 'Like a diamond in the sky.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'shine_bright', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'put_a_ring_on_it',
    name: 'Put a Ring on It',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      // Each transformed card walks itself to the GY, so Points cards the
      // player was already holding stay in hand.
      {
        op: 'forEach',
        over: { who: 'self', zone: 'hand', filter: { defId: 'silver' } },
        effects: [
          { op: 'transform', target: { self: true }, into: 'tix' },
          { op: 'moveTo', target: { self: true }, zone: 'gy' },
        ],
      },
      {
        op: 'forEach',
        over: { who: 'self', zone: 'hand', filter: { defId: 'gold' } },
        effects: [
          { op: 'transform', target: { self: true }, into: 'robux' },
          { op: 'moveTo', target: { self: true }, zone: 'gy' },
        ],
      },
      {
        op: 'forEach',
        over: { who: 'self', zone: 'hand', filter: { defId: 'diamond' } },
        effects: [
          { op: 'transform', target: { self: true }, into: 'jlore' },
          { op: 'moveTo', target: { self: true }, zone: 'gy' },
        ],
      },
    ],
    triggers: [],
    text: 'Turn each Silver into a Tix, each Gold into a Robux and each Diamond into a Jlore, then move them from your hand to your GY.',
    flavor: 'If you liked it.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'put_a_ring_on_it', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'shining_kit',
    name: 'Shining Kit',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { money: 2 },
    effects: [{ op: 'buff', scope: 'nextPlayed', stat: 'money', amount: 1, times: 1 }],
    triggers: [],
    text: 'The next Resource you play permanently gains +1 Money. +2 Money.',
    flavor: 'A cloth, a polish, a permanent improvement.',
    complexity: 'T3',
    subsystems: ['S-BUFF'],
    shop: 'draft',
    art: { key: 'shining_kit', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'midas_touch',
    name: 'Midas Touch',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['PlayOnDraw'],
    stats: {},
    effects: [
      {
        op: 'transform',
        target: { who: 'self', zone: 'hand', count: 1, pick: 'random' },
        into: 'gold',
      },
    ],
    triggers: [],
    text: 'Play on Draw. Turn a random card in your hand into a Gold.',
    flavor: 'He never asked which card.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'midas_touch', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'depot_draw',
    name: 'Depot Draw',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      // Stage the four cards aside first: a filtered library selector matches
      // before it counts, so it would tutor Resources off the bottom and then
      // discard four cards nobody ever saw.
      { op: 'reveal', target: { who: 'self', zone: 'library', count: 4, pick: 'top' } },
      {
        op: 'moveTo',
        target: { who: 'self', zone: 'library', count: 4, pick: 'top' },
        zone: 'aside',
      },
      // `aside` is ONE shared staging pile per player and nothing empties it at
      // end of turn, so a Hand Box's stored hand — parked there by Save for
      // Later / Repackage and tagged with the `boxed` counter — is sitting in
      // it too. Both sweeps skip anything boxed, or this card would empty the
      // box into hand and GY on its way past.
      {
        op: 'moveTo',
        target: {
          who: 'self',
          zone: 'aside',
          filter: { type: 'Resource', not: { counter: { key: 'boxed', gte: 1 } } },
        },
        zone: 'hand',
      },
      {
        op: 'moveTo',
        target: { who: 'self', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
        zone: 'gy',
      },
    ],
    triggers: [],
    text: 'Reveal the top 4 cards of your Library. Put the Resources in your hand and discard the rest. +1 Action.',
    flavor: 'Loading bay, not showroom.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'depot_draw', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'sticky_fungers',
    name: 'Sticky Fungers',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { cards: 1 },
    effects: [
      {
        op: 'moveTo',
        target: { who: 'self', zone: 'library', filter: { type: 'Resource' } },
        zone: 'library',
        position: 'top',
      },
    ],
    triggers: [],
    text: 'Move every Resource in your Library to the top of it. +1 Card.',
    flavor: 'They cling to money specifically.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'sticky_fungers', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'villa_d_moneybags',
    name: 'Villa D. Moneybags',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'legendary',
    keywords: [],
    stats: {},
    effects: [
      { op: 'createCard', defId: 'gold', to: 'hand' },
      { op: 'createCard', defId: 'gold', to: 'gy', who: 'eachOpponent' },
    ],
    triggers: [],
    text: 'Add a Gold to your hand and a Gold to each opponent’s GY.',
    flavor: 'Generous, in a way that costs him nothing.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'villa_d_moneybags', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'intellectual_property_theft',
    name: 'Intellectual Property Theft',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'discover',
        pool: { scope: 'opponentGy', who: 'chosenOpponent', filter: { type: 'Resource' } },
        count: 3,
        pick: 1,
        prompt: 'Take what is theirs',
        // An empty `then` is the default "the discovered card enters your
        // hand". A `then` cannot say it: {self:true} there is this card.
        then: [],
      },
    ],
    triggers: [],
    text: 'Discover a Resource in an opponent’s GY and add a copy of it to your hand.',
    flavor: 'It was in a public discard pile, technically.',
    complexity: 'T3',
    subsystems: ['S-STEAL', 'S-DISCOVER'],
    shop: 'draft',
    art: { key: 'intellectual_property_theft', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'second_degree_forgery',
    name: 'Second-Degree Forgery',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'copyCard',
        // Their play area is emptied into the GY at the end of their turn, so
        // by the time this resolves the card they last played is sitting there.
        target: {
          who: 'chosenOpponent',
          zone: 'gy',
          filter: { type: 'Resource' },
          count: 1,
          pick: 'lastPlayed',
        },
        to: 'hand',
        who: 'self',
      },
      {
        op: 'conditional',
        if: { combo: 3 },
        then: [{ op: 'setKeyword', target: { self: true }, keyword: 'Flimsy', on: false }],
      },
    ],
    triggers: [],
    text: 'Flimsy. Copy the last Resource an opponent played into your hand. Combo 3: this loses Flimsy.',
    flavor: 'The first degree was the idea.',
    complexity: 'T3',
    subsystems: ['S-STEAL', 'S-COMBO'],
    shop: 'draft',
    art: { key: 'second_degree_forgery', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'petty_theft',
    name: 'Petty Theft',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: {
          has: {
            target: { who: 'chosenOpponent', zone: 'hand', filter: { type: 'Resource' } },
            atLeast: 1,
          },
        },
        then: [
          // moveTo cannot change an owner, so a plain move just shuffles the
          // card inside their own hand. Copy it to yours, then trash theirs.
          {
            op: 'forEach',
            over: {
              who: 'chosenOpponent',
              zone: 'hand',
              filter: { type: 'Resource' },
              count: 1,
              pick: 'random',
            },
            effects: [
              { op: 'copyCard', target: { self: true }, to: 'hand', who: 'self' },
              { op: 'trash', target: { self: true } },
            ],
          },
        ],
        else: [{ op: 'createCard', defId: 'silver', to: 'gy' }],
      },
      {
        op: 'conditional',
        if: { combo: 3 },
        then: [{ op: 'setKeyword', target: { self: true }, keyword: 'Flimsy', on: false }],
      },
    ],
    triggers: [],
    text: 'Flimsy. Steal a Resource from an opponent’s hand. If they have none, add a Silver to your GY instead. Combo 3: this loses Flimsy.',
    flavor: 'Small crime, small sentence, small silver.',
    complexity: 'T3',
    subsystems: ['S-STEAL', 'S-COMBO'],
    shop: 'draft',
    art: { key: 'petty_theft', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'gold_ship',
    name: 'Gold Ship',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Gold'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { money: 3, actions: 1 },
    effects: [
      { op: 'lockPile', target: { shop: 'all', excludeJlore: true }, duration: 'turn' },
      // Without a count the "choose" branch returns every pile and never
      // prompts, which would unlock everything it just locked.
      { op: 'unlockPile', target: { shop: 'all', pick: 'choose', count: 1, excludeJlore: true } },
    ],
    triggers: [],
    text: '+3 Money, +1 Action. Lock every pile but one of your choice until end of turn.',
    flavor: 'The harbour closes when the gold sails.',
    complexity: 'T3',
    subsystems: ['S-LOCK'],
    shop: 'draft',
    art: { key: 'gold_ship', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
];

export default cards;
