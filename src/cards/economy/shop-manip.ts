/**
 * A.9 Draft Shop — shop manipulation: locks, cost mods, pile surgery.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'window_shopping',
    name: 'Window Shopping',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { buys: 1 },
    effects: [
      {
        op: 'gainCard',
        from: { shop: 'all', filter: { cost: { lte: 2 } }, pick: 'choose', count: 1 },
        to: 'gy',
        free: true,
      },
    ],
    triggers: [],
    text: 'Add a shop card costing (2) or less to your GY. +1 Buy.',
    flavor: 'Looking is free. This one is too.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'window_shopping', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'spotter',
    name: 'Spotter',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'gainCard',
        from: { shop: 'all', filter: { cost: { eq: 4 } }, pick: 'choose', count: 1 },
        to: 'hand',
        free: true,
      },
    ],
    triggers: [],
    text: 'Add a (4)-cost card from the Shop to your hand.',
    flavor: 'He knows a four when he sees one.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'spotter', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'elite_spotter',
    name: 'Elite Spotter',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'gainCard',
        from: { shop: 'all', filter: { cost: { eq: 8 } }, pick: 'choose', count: 1 },
        to: 'hand',
        free: true,
      },
    ],
    triggers: [],
    text: 'Add an (8)-cost card from the Shop to your hand.',
    flavor: 'Promoted for spotting bigger numbers.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'elite_spotter', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'blubber_baron',
    name: 'Blubber Baron',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'gainCard',
        from: { shop: 'all', filter: { cost: { lte: 2 } }, pick: 'choose' },
        to: 'gy',
        count: 2,
        free: true,
      },
    ],
    triggers: [],
    text: 'Add up to 2 shop cards costing (2) or less to your GY.',
    flavor: 'Bulk is a strategy.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'blubber_baron', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'shadow_moves',
    name: 'Shadow Moves',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'gainCard', from: { shop: 'all', pick: 'random', count: 1 }, to: 'hand', free: true },
    ],
    triggers: [],
    text: 'Steal a random card from the Shop into your hand. +1 Action.',
    flavor: 'Nobody saw the shelf empty.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'shadow_moves', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'firesale',
    name: 'Firesale',
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
        pool: { scope: 'shop', filter: { cost: { lte: 2 } } },
        count: 3,
        pick: 1,
        prompt: 'Everything must go',
        then: [
          {
            op: 'gainCard',
            from: { shop: 'all', filter: { defId: '$discovered' } },
            to: 'hand',
            free: true,
          },
          {
            // The stolen card lands at the back of hand, so `bottom` is the one
            // just taken — and the defId filter means nothing is played when the
            // steal was not an Action.
            op: 'playCard',
            target: { who: 'self', zone: 'hand', filter: { defId: '$discovered', type: 'Action' }, count: 1, pick: 'bottom' },
          },
        ],
      },
    ],
    triggers: [],
    text: 'Discover 3 shop cards costing (2) or less and steal one into your hand. If it is an Action, play it.',
    flavor: 'Everything must go, quickly.',
    complexity: 'T3',
    subsystems: ['S-CORE', 'S-DISCOVER'],
    shop: 'draft',
    art: { key: 'firesale', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'cult_leader',
    name: 'Cult Leader',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        // The pick is threaded through both clauses, so the steal is about the
        // card that was actually taken.
        op: 'discover',
        // Draft Shop piles only — not the basics, not the Prophet Shop, which
        // is gated on banked Prophet rather than on money.
        //
        // "A card you can currently afford" is a constraint on what is OFFERED,
        // and it can finally sit here: `poolCandidates` resolves a filter's
        // expression bounds before it starts matching, so a `cost.lte` of
        // `moneyUnspent` gates the three cards on the table instead of voiding
        // the pick afterwards.
        pool: {
          scope: 'shop',
          filter: {
            rarity: ['common', 'rare', 'epic', 'legendary', 'mythic'],
            not: { subtype: 'Prophet' },
            cost: { lte: { expr: 'moneyUnspent' } },
          },
        },
        count: 3,
        pick: 1,
        prompt: 'Take the last one',
        then: [
          {
            // The offer was gated at the PRINTED price — a pool matches
            // definitions, and a definition has no pile to carry a cost mod.
            // The add is gated again here, on the pile-selector path, where
            // `instanceCost` reads the live cost-mod stack and answers with the
            // price the table would actually charge.
            op: 'gainCard',
            from: { shop: 'all', filter: { defId: '$discovered', cost: { lte: { expr: 'moneyUnspent' } } } },
            to: 'gy',
            free: true,
          },
          {
            // "If that emptied the pile" — no copy of it is left in any Shop.
            op: 'conditional',
            if: { not: { has: { target: { zone: 'shop', filter: { defId: '$discovered' } }, atLeast: 1 } } },
            then: [
              {
                op: 'moveTo',
                target: { who: 'eachOpponent', zone: ['library', 'hand', 'gy'], filter: { defId: '$discovered' } },
                zone: 'gy',
                who: 'self',
              },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Discover 3 Draft Shop cards you can currently afford and add one to your GY. If that emptied its pile, steal every copy of it from your opponents.',
    flavor: 'He takes the last one, then all the others.',
    complexity: 'T3',
    subsystems: ['S-STEAL', 'S-DISCOVER'],
    shop: 'draft',
    art: { key: 'cult_leader', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'cult_recruiter',
    name: 'Cult Recruiter',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { buys: 2, money: 2 },
    effects: [
      // `duration:'turn'` is the whole of this turn: a lock's `expiresOnTurn`
      // names the first turn it is already gone (`expiryTurnFor` -> turn + 1,
      // `lockIsActive` tests `turn < expiresOnTurn`).
      { op: 'lockPile', target: { shop: 'all', excludeJlore: false }, duration: 'turn' },
      { op: 'unlockPile', target: { shop: 'all', pick: 'choose', count: 1 } },
    ],
    triggers: [],
    text: 'You may buy from only one pile this turn. +2 Buys, +2 Money.',
    flavor: 'One vendor. One truth.',
    complexity: 'T3',
    subsystems: ['S-LOCK'],
    shop: 'draft',
    art: { key: 'cult_recruiter', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'glorious_propaganda',
    name: 'Glorious Propaganda',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      { op: 'gainCard', from: { shop: 'draft', pick: 'random', count: 1 }, to: 'gy', free: true },
      { op: 'gainCard', from: { shop: 'resource', pick: 'random', count: 1 }, to: 'gy', free: true },
      { op: 'gainCard', from: { shop: 'points', pick: 'random', count: 1 }, to: 'gy', free: true },
    ],
    triggers: [],
    text: 'Add 1 random card from each of the Draft, Resource and Points shops to your GY.',
    flavor: 'The posters worked.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'glorious_propaganda', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'mediator',
    name: 'Mediator',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'discover',
        pool: { scope: 'shop' },
        count: 3,
        pick: 1,
        prompt: 'A gift for everyone',
        // `{self:true}` in a discover `then` is Mediator itself, not the pick —
        // the chosen card is only reachable through the '$discovered' sentinel.
        then: [{ op: 'createCard', defId: '$discovered', to: 'hand', who: 'eachPlayer' }],
      },
    ],
    triggers: [],
    text: 'Discover a shop card and add it to every player’s hand. +1 Action.',
    flavor: 'Fair is fair, unfortunately.',
    complexity: 'T3',
    subsystems: ['S-DISCOVER'],
    shop: 'draft',
    art: { key: 'mediator', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'welfare',
    name: 'Welfare',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'discover',
        pool: { scope: 'shop' },
        count: 3,
        pick: 1,
        prompt: 'Distribute to the table',
        then: [{ op: 'createCard', defId: '$discovered', to: 'gy', who: 'eachPlayer' }],
      },
    ],
    triggers: [],
    text: 'Choose a shop card and add it to every player’s GY in turn order, starting with you. +1 Action.',
    flavor: 'You first, then the rest.',
    complexity: 'T3',
    subsystems: ['S-DISCOVER'],
    shop: 'draft',
    art: { key: 'welfare', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'lockdown',
    name: 'Lockdown',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'common',
    keywords: [],
    stats: { cards: 1 },
    effects: [
      {
        op: 'lockPile',
        target: { shop: 'draft', pick: 'choose', count: 1 },
        duration: 'untilEndOfYourNextTurn',
      },
    ],
    triggers: [],
    text: 'Lock a Draft Shop pile until the end of your next turn. +1 Card.',
    flavor: 'Closed for the duration.',
    complexity: 'T2',
    subsystems: ['S-LOCK'],
    shop: 'draft',
    art: { key: 'lockdown', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'blackout',
    name: 'Blackout',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    effects: [
      {
        op: 'lockPile',
        target: { shop: 'draft', pick: 'choose', count: 1 },
        duration: 'untilEndOfYourNextTurn',
      },
    ],
    triggers: [],
    text: 'Lock a Draft Shop pile until the end of your next turn. +1 Action, +1 Card.',
    flavor: 'The lights go out over one aisle.',
    complexity: 'T2',
    subsystems: ['S-LOCK'],
    shop: 'draft',
    art: { key: 'blackout', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'back_to_basics',
    name: 'Back to Basics',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [
      {
        op: 'lockPile',
        target: { shop: 'all', filter: { cost: { gte: 6 } } },
        duration: 'untilEndOfYourNextTurn',
      },
    ],
    triggers: [],
    text: 'Flimsy. Lock every pile costing (6) or more until the end of your next turn. +1 Action.',
    flavor: 'Nobody needs the expensive things.',
    complexity: 'T3',
    subsystems: ['S-LOCK'],
    shop: 'draft',
    art: { key: 'back_to_basics', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'go_fish',
    name: 'Go Fish',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        // One pile, threaded through both clauses: the discard and the Lock
        // have to be about the same pile, which only the sentinel can do.
        op: 'discover',
        pool: { scope: 'shop', filter: { not: { defId: 'copper' } } },
        count: 3,
        pick: 1,
        prompt: 'Do you have any...',
        then: [
          {
            op: 'discard',
            target: { who: 'eachOpponent', zone: 'hand', filter: { defId: '$discovered' } },
          },
          {
            op: 'lockPile',
            target: { shop: 'all', filter: { defId: '$discovered' }, excludeJlore: false },
            duration: 'untilEndOfYourNextTurn',
          },
        ],
      },
    ],
    triggers: [],
    text: 'Discover 3 non-Copper shop cards and name one. Opponents discard every copy of it from their hands. Then Lock its pile until the end of your next turn.',
    flavor: 'Do you have any Silvers? Go fish.',
    complexity: 'T3',
    subsystems: ['S-LOCK', 'S-STEAL', 'S-DISCOVER'],
    shop: 'draft',
    art: { key: 'go_fish', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'freeze_tag',
    name: 'Freeze Tag',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    // The third clause needs two piles to still have names several nodes after
    // they were picked — a `pick:'choose'` or `pick:'random'` PileSelector hands
    // out nothing, and a second one rolls a fresh pile. Two things give a pile a
    // durable name: a Discover's `$discovered` (pile ids are one-per-definition,
    // so a defId IS a pile), and a counter stamped on a card sitting in it,
    // which a PileSelector's filter reads off the pile's top card. The frozen
    // pile takes the first, the thawed pile the second, and its price crosses
    // the gap as a `turn:` player counter — the same accumulator idiom Fusion
    // Summon uses for "costing their sum".
    effects: [
      // Seeded so the read at the bottom always has a variable to find; a bad
      // expression is worth 0, and 0 is a real cost here.
      { op: 'addCounter', scope: 'player', key: 'turn:freezeTagCost', amount: 0 },
      {
        op: 'discover',
        // Draft Shop piles only — not the basics, not the Prophet Shop. `count`
        // is larger than any Draft Shop, so the offer is every Draft pile: the
        // printed line is "Lock one Draft pile", not "one of three".
        pool: {
          scope: 'shop',
          filter: { rarity: ['common', 'rare', 'epic', 'legendary', 'mythic'], not: { subtype: 'Prophet' } },
        },
        count: 40,
        pick: 1,
        prompt: 'Freeze a pile',
        then: [
          {
            op: 'lockPile',
            target: { shop: 'draft', filter: { defId: '$discovered' } },
            duration: 'untilEndOfYourNextTurn',
          },
          // Park the frozen pile's live price on the player. `forEach` rebinds
          // `self` to the first card of that pile — its top — so `selfCost` is
          // the price actually charged, cost mods included, and a `turn:`
          // counter reads back by name minus the prefix. It is subtracted away
          // at the end, and the prefix clears it next turn if a suspended
          // resolution never reaches that line.
          {
            op: 'forEach',
            over: { zone: 'shop', filter: { defId: '$discovered' }, count: 1 },
            effects: [
              { op: 'addCounter', scope: 'player', key: 'turn:freezeTagCost', amount: { expr: 'selfCost' } },
            ],
          },
          // Mark the frozen pile so the thaw rolls over the OTHERS...
          { op: 'addCounter', target: { zone: 'shop', filter: { defId: '$discovered' } }, key: 'freezeTagFrozen', amount: 1 },
          {
            // ...guarded, because an empty target list makes `addCounter` fall
            // back to the card that asked and Freeze Tag would stamp itself.
            op: 'conditional',
            if: {
              has: {
                target: {
                  zone: 'shop',
                  filter: {
                    rarity: ['common', 'rare', 'epic', 'legendary', 'mythic'],
                    not: { subtype: 'Prophet' },
                    counter: { key: 'freezeTagFrozen', lt: 1 },
                  },
                },
                atLeast: 1,
              },
            },
            then: [
              {
                // Roll the thaw ONCE and mark what it hit. The roll is over the
                // cards in those piles rather than over the piles themselves —
                // the only random pick that leaves a mark behind — so a taller
                // pile is likelier. Everything downstream then reads the mark
                // instead of rolling again.
                op: 'addCounter',
                target: {
                  zone: 'shop',
                  filter: {
                    rarity: ['common', 'rare', 'epic', 'legendary', 'mythic'],
                    not: { subtype: 'Prophet' },
                    counter: { key: 'freezeTagFrozen', lt: 1 },
                  },
                  count: 1,
                  pick: 'random',
                },
                key: 'freezeTagThawed',
                amount: 1,
              },
            ],
          },
          { op: 'addCounter', target: { zone: 'shop', filter: { counter: { key: 'freezeTagFrozen', gte: 1 } } }, key: 'freezeTagFrozen', amount: -1 },
        ],
      },
      {
        // One Shop card carries the thaw mark, so this resolves without a
        // prompt and binds `$selected` to its defId — the name of the pile the
        // roll landed on. It has to sit OUTSIDE the Discover: a nested sentinel
        // is substituted by the outer pick before it is ever read.
        op: 'selectCards',
        from: { zone: 'shop', filter: { counter: { key: 'freezeTagThawed', gte: 1 } } },
        min: 1,
        max: 1,
        then: [
          { op: 'unlockPile', target: { shop: 'draft', filter: { defId: '$selected' } } },
          {
            // "If they cost the same." An expression bound resolves on the
            // pile-selector path now, so this matches only while the thawed
            // pile's top card is charged exactly what the frozen pile is
            // charged — and a mismatch gains nothing rather than gaining the
            // wrong pile.
            op: 'gainCard',
            from: { shop: 'draft', filter: { defId: '$selected', cost: { eq: { expr: 'freezeTagCost' } } } },
            to: 'gy',
            free: true,
          },
          // Counters survive zone changes, so clear the mark on the instance
          // itself — it may be the card that just moved to the GY.
          { op: 'addCounter', target: { self: true }, key: 'freezeTagThawed', amount: -1 },
        ],
      },
      { op: 'addCounter', scope: 'player', key: 'turn:freezeTagCost', amount: { expr: '0 - freezeTagCost' } },
    ],
    triggers: [],
    text: 'Lock one Draft pile and unlock a random other one. If they cost the same, add the unlocked pile’s top card to your GY. +1 Action.',
    flavor: 'Frozen. Unfrozen. Confused.',
    complexity: 'T3',
    subsystems: ['S-LOCK', 'S-DISCOVER'],
    shop: 'draft',
    art: { key: 'freeze_tag', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'arm_of_the_jempire',
    name: 'Arm of the Jempire',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'lockPile',
        target: { shop: 'draft', pick: 'random', count: 3 },
        duration: 'untilYourNextTurn',
      },
      // "for each you could have afforded" is a count of PILES, and only the
      // three the line above locked. A filter bound can read the wallet now
      // (`cost: {lte: {expr:'moneyUnspent'}}`), but it selects cards, not piles,
      // and `pick:'random'` cannot be re-derived by a second node — so the three
      // locked piles are unnameable once the lock op returns. The draw stays an
      // expression over unspent Money, capped at the three piles.
      { op: 'draw', amount: { expr: 'min(3, moneyUnspent)' } },
    ],
    triggers: [],
    text: 'Lock 3 random Draft piles until your next turn. Draw 1 Card per unspent Money, up to 3. +1 Action.',
    flavor: 'The arm reaches three shelves.',
    complexity: 'T3',
    subsystems: ['S-LOCK'],
    shop: 'draft',
    art: { key: 'arm_of_the_jempire', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'archwarden_of_jlore',
    name: 'Archwarden of Jlore',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: { actions: 1, cards: 1 },
    effects: [
      {
        op: 'lockPile',
        target: { shop: 'points', filter: { defId: 'jlore' } },
        duration: { untilDiscarded: 8 },
      },
    ],
    triggers: [],
    text: 'Flimsy. Lock the Jlore pile until (8) worth of cards have been discarded. +1 Action, +1 Card.',
    flavor: 'The vault opens when the tribute is paid.',
    complexity: 'T3',
    subsystems: ['S-LOCK'],
    shop: 'draft',
    art: { key: 'archwarden_of_jlore', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'cloud_nine',
    name: 'Cloud Nine',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, buys: 1, cards: 1 },
    effects: [
      // A modifyCost carrying neither `delta` nor `setTo` is the clear: it
      // empties every pile's costMods, drops every costOverride and empties
      // shop.globalCostMods. A delta-0 modifier could only ever add another
      // entry to the stack it is meant to empty, which is why this half of the
      // card could not ship before.
      { op: 'modifyCost', scope: 'allShops', duration: 'permanent' },
      { op: 'unlockPile', target: { shop: 'all' } },
    ],
    triggers: [],
    text: 'Remove all cost changes and Locks from the Shop. +1 Action, +1 Buy, +1 Card.',
    flavor: 'Everything back to list price.',
    complexity: 'T2',
    subsystems: ['S-LOCK'],
    shop: 'draft',
    art: { key: 'cloud_nine', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'the_jlore_must_flow',
    name: 'The Jlore Must Flow',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { buys: 1 },
    effects: [
      { op: 'modifyCost', scope: 'allShops', delta: -1, floor: 1, duration: 'turn' },
    ],
    triggers: [],
    text: 'Every shop card costs (1) less this turn, to a minimum of (1). +1 Buy.',
    flavor: 'He who controls the discount.',
    complexity: 'T2',
    subsystems: ['S-COSTMOD'],
    shop: 'draft',
    art: { key: 'the_jlore_must_flow', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'cup_runneth_over',
    name: 'Cup Runneth Over',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      // One pile for both halves, named the same way twice rather than chosen
      // twice: two `pick:'choose'` prompts can name different piles, and the
      // Discover this used to run could never name an EMPTY one — a
      // `pool:{scope:'shop'}` samples defIds off instances sitting in a pile,
      // and `selectPilesWith` drops zero-card piles inside its `filter` branch.
      // An empty pile is the case the card exists for, and `replenishPile` now
      // reaches one (it resolves the id through `pileDefId`), so the pile is
      // picked by depletion instead.
      //
      // The discount is ordered first because it does not change pile heights:
      // `shortest` therefore re-derives the identical pile for the replenish.
      {
        op: 'modifyCost',
        scope: 'pile',
        target: { shop: 'draft', pick: 'shortest', count: 1 },
        delta: -1,
        floor: 1,
        duration: 'permanent',
      },
      { op: 'replenishPile', target: { shop: 'draft', pick: 'shortest', count: 1 } },
    ],
    triggers: [],
    text: 'Flimsy. Fully replenish the most depleted Draft pile. Its cards now cost (1) less, to a minimum of (1).',
    flavor: 'And then some.',
    complexity: 'T3',
    subsystems: ['S-COSTMOD'],
    shop: 'draft',
    art: { key: 'cup_runneth_over', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'throttle_markets',
    name: 'Throttle Markets',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: [],
    stats: { buys: 1, money: 1 },
    effects: [
      {
        op: 'choose',
        options: [
          {
            label: 'Draft piles cost (1) more',
            effects: [
              {
                op: 'modifyCost',
                scope: 'draftShop',
                delta: 1,
                floor: 0,
                duration: 'untilYourNextTurn',
              },
            ],
          },
          {
            label: 'Resource and Points piles cost (1) more',
            effects: [
              {
                op: 'modifyCost',
                scope: 'resourceShop',
                delta: 1,
                floor: 0,
                duration: 'untilYourNextTurn',
              },
              {
                op: 'modifyCost',
                scope: 'pointsShop',
                delta: 1,
                floor: 0,
                duration: 'untilYourNextTurn',
              },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Until your next turn, either Draft piles cost (1) more, or Resource and Points piles cost (1) more. +1 Buy, +1 Money.',
    flavor: 'Someone has a hand on the valve.',
    complexity: 'T3',
    subsystems: ['S-COSTMOD'],
    shop: 'draft',
    art: { key: 'throttle_markets', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'price_fixing',
    name: 'Price Fixing',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'modifyCost',
        scope: 'pile',
        target: { shop: 'draft', pick: 'choose', count: 1 },
        // `avgDraftPileCost` is the mean top-card cost across the Draft Shop,
        // which is the number the card names.
        setTo: { expr: 'floor(avgDraftPileCost)' },
        floor: 0,
        duration: 'untilEndOfYourNextTurn',
      },
    ],
    triggers: [],
    text: 'Set a Draft pile’s cost to the average Draft pile cost, rounded down, until the end of your next turn. +1 Action.',
    flavor: 'Perfectly legal in this jurisdiction.',
    complexity: 'T3',
    subsystems: ['S-COSTMOD'],
    shop: 'draft',
    art: { key: 'price_fixing', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'missed_vintage',
    name: 'Missed Vintage',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { buys: 1 },
    effects: [
      {
        op: 'modifyCost',
        scope: 'pile',
        target: { shop: 'draft', pick: 'tallest', count: 2 },
        delta: -2,
        floor: 0,
        duration: 'turn',
      },
    ],
    triggers: [],
    text: 'Reduce the top card cost of the two tallest Draft piles by (2). +1 Buy.',
    flavor: 'Nobody wanted the 2019.',
    complexity: 'T3',
    subsystems: ['S-COSTMOD'],
    shop: 'draft',
    art: { key: 'missed_vintage', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'vexxed',
    name: 'Vexxed',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [{ op: 'swapPileCosts', target: { shop: 'all', pick: 'random', count: 2 } }],
    triggers: [],
    text: 'Swap the costs of two random piles.',
    flavor: 'The tags got mixed up. Nobody is fixing it.',
    complexity: 'T2',
    subsystems: ['S-COSTMOD'],
    shop: 'draft',
    art: { key: 'vexxed', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'discount_coupon',
    name: 'Discount Coupon',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        // `selfPlayCount - 5` is non-zero — and therefore true — on plays 1-4,
        // so the two branches were the wrong way round. And `scope:'nextBuy'`
        // never reads `setTo`, so "free" has to be a delta deep enough to land
        // on the floor. The play counter itself is kept by the engine on every
        // play, so the card must not add its own on top.
        op: 'conditional',
        if: { expr: 'selfPlayCount >= 5' },
        then: [{ op: 'modifyCost', scope: 'nextBuy', delta: -999, floor: 0, duration: 'turn' }],
        else: [{ op: 'modifyCost', scope: 'nextBuy', delta: -1, floor: 0, duration: 'turn' }],
      },
    ],
    triggers: [],
    text: 'The next card you buy this turn costs (1) less — from its 5th play on, (0) instead. (Played {playCount} times.)',
    flavor: 'Terms and conditions accumulate.',
    complexity: 'T4',
    subsystems: ['S-PERSIST', 'S-COSTMOD', 'S-TEXTGEN'],
    shop: 'draft',
    art: { key: 'discount_coupon', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'miracle_prep',
    name: 'Miracle Prep',
    cost: { money: 0 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      { op: 'modifyCost', scope: 'nextBuy', delta: -2, floor: 0, duration: 'turn' },
    ],
    triggers: [],
    text: 'The next card you buy costs (2) less.',
    flavor: 'Lay the groundwork for something unlikely.',
    complexity: 'T2',
    subsystems: ['S-COSTMOD'],
    shop: 'draft',
    art: { key: 'miracle_prep', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'nickel_and_dime',
    name: 'Nickel and Dime',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      // `scope:'nextBuyOpponent'` has no selector — opModifyCost pushes the mod
      // onto every opponent — while the Silver below is a one-shot. At a 4-player
      // table three opponents each eat the +1 and only the first to buy pays out.
      // Deliberate: the tax is what the engine can express and the payout is what
      // the doc row prints, so the text names both arities rather than implying
      // a Silver per opponent.
      {
        op: 'modifyCost',
        scope: 'nextBuyOpponent',
        delta: 1,
        floor: 0,
        duration: 'untilYourNextTurn',
      },
    ],
    triggers: [
      {
        // Flimsy puts this card in the trash the moment it is played, and
        // `fireOwnedTriggers` sweeps trashed instances only for triggers that
        // name the trash — without the declaration the payout could never fire.
        // The trash is forever, so `maxPerTurn` alone would pay out once a turn
        // for the rest of the game; the counter makes it the one-shot the card
        // prints.
        on: 'onOpponentBuy',
        zones: ['trash'],
        maxPerTurn: 1,
        condition: { expr: 'selfCounter < 1' },
        effects: [
          { op: 'createCard', defId: 'silver', to: 'gy' },
          { op: 'addCounter', target: { self: true }, key: 'counter', amount: 1 },
        ],
      },
    ],
    text: 'Flimsy. The next card each opponent buys costs (1) more. The first one to buy it gives you a Silver.',
    flavor: 'A toll booth on their turn.',
    complexity: 'T3',
    subsystems: ['S-COSTMOD', 'S-STEAL'],
    shop: 'draft',
    art: { key: 'nickel_and_dime', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'pocket_wormhole',
    name: 'Pocket Wormhole',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        // The Discover names the pile, which is the only way to scope the
        // transform to one pile — a Selector has no pile axis. The Lock has to
        // run first, while the pile's top card still matches the pick.
        //
        // The doc's second pick — one Discovered Known Universe card replacing
        // every copy — needs a nested prompt carrying its own defId, and
        // `substituteDefId` swaps '$discovered' and '$selected' for the SAME id,
        // so the inner pick is overwritten by the outer one before it is asked.
        // Until each sentinel belongs to its own prompt, the replacement is
        // rolled per card instead.
        op: 'discover',
        // Draft Shop piles only — not the basics, not the Prophet Shop, which
        // is gated on banked Prophet rather than on money.
        pool: {
          scope: 'shop',
          filter: { rarity: ['common', 'rare', 'epic', 'legendary', 'mythic'], not: { subtype: 'Prophet' } },
        },
        count: 3,
        pick: 1,
        prompt: 'Which shelf slips universe?',
        then: [
          {
            op: 'lockPile',
            target: { shop: 'all', filter: { defId: '$discovered' } },
            duration: 'untilYourNextTurn',
          },
          {
            op: 'transform',
            target: { zone: 'shop', filter: { defId: '$discovered' } },
            into: { pool: { scope: 'knownUniverse' } },
          },
        ],
      },
    ],
    triggers: [],
    text: 'Discover 3 Draft Shop cards. Lock the pile of the one you pick until your next turn, and every card in it becomes a random Known Universe card.',
    flavor: 'Same shelf. Different universe.',
    complexity: 'T3',
    subsystems: ['S-DISCOVER', 'S-LOCK', 'S-CODEX'],
    shop: 'draft',
    art: { key: 'pocket_wormhole', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'chron_cache',
    name: 'Chron Caché',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        // `costOverride` reprices the whole pile, permanently, not the card
        // being inserted — there is no per-instance price, so the Diamond goes
        // in at its printed cost rather than the printed (0). The doc's "replace
        // the 2nd card" also needs an insert-at-index affordance addToPileTop
        // does not have; the top is the closest reachable slot.
        op: 'addToPileTop',
        target: { shop: 'draft', pick: 'random', count: 1 },
        defId: 'diamond',
        count: 1,
      },
    ],
    triggers: [],
    text: 'Add a Diamond to the top of a random Draft pile. +1 Action.',
    flavor: 'Buried one layer down.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'chron_cache', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'supernova',
    name: 'Supernova',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { buys: 1 },
    effects: [
      {
        // The node count is per pile, so 10 piles x 10 was 100 cards. And
        // `costOverride` prices the whole pile forever, not the cards added, so
        // it would have made ten entire piles cost (1) for the rest of the match.
        op: 'addToPileTop',
        target: { shop: 'all', pick: 'random', count: 10 },
        defId: { pool: { scope: 'entireUniverse' } },
        count: 1,
      },
    ],
    triggers: [],
    text: 'Add 1 random card from the Entire Universe to the top of each of 10 random shop piles. +1 Buy.',
    flavor: 'Everything in the sky lands in the shop.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'supernova', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
  {
    id: 'i_ship_it',
    name: 'I Ship It',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: { buys: 1 },
    effects: [{ op: 'mergePiles', target: { shop: 'draft', pick: 'choose', count: 2 } }],
    triggers: [],
    text: 'Flimsy. Shuffle two piles together and split them evenly between the two slots. +1 Buy.',
    flavor: 'They belong together.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'i_ship_it', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'shuffle' },
  },
  {
    id: 'the_big_backening',
    name: 'The Big Backening',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { buys: 1, money: 1 },
    // The printed mechanic is "2 copies of the FIRST CARD YOU BUY THIS TURN, on
    // top of THAT pile", and the bought card is unreachable from card data.
    // `zones:['play']` does turn an onBuy trigger into a rider on your own
    // purchases (firePlayTriggers), but the rider runs under
    // `makeContext(player, riderIid)` — the source instance is this card, not
    // the purchase — the event carries no payload, and nothing binds a bought
    // card's defId to the '$discovered'/'$selected' sentinel: only `discover`
    // and `selectCards` substitute, and both ask the player a question rather
    // than naming the purchase. `addToPileTop` is the only op that writes into
    // a pile and its `defId` is a literal or a pool, never a context card.
    //
    // The stand-in that shipped here — Discover 3 arbitrary shop cards, 2
    // copies of the pick onto its pile — was a different card and an unsafe
    // one: an unfiltered `pool:{scope:'shop'}` reaches the basics and the
    // Points Shop, so it routinely stuffed the Jlore pile (the end-game clock)
    // or a Copper pile, and the pile target carried no `count`, so
    // `selectPilesWith` returned `want = ids.length` and fed every pile whose
    // top card matched. Faithful text, no body, until a purchase-scoped
    // binding exists.
    effects: [],
    triggers: [],
    text: 'Add 2 copies of the first card you buy this turn to the top of that pile. +1 Buy, +1 Money.',
    flavor: 'It comes back bigger.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'the_big_backening', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'new_banner_day',
    name: 'New Banner Day!',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { money: 1 },
    effects: [
      {
        op: 'discover',
        pool: { scope: 'shop' },
        count: 3,
        pick: 1,
        prompt: 'Set the banner',
        then: [
          // The printed rider needs three things at once: the discovered pile
          // remembered past this node, that pile's cost remembered as a number,
          // and a later buy compared against it. A player counter can carry a
          // number but the Discover's `then` cannot read the pick's cost
          // (`selfCost` is this card), a pile-selector filter does not resolve
          // expression bounds, and a buy-side `appendEffects` is never read
          // (`peekBuyMods` takes costDelta, costFloor and buyTo only). This mod
          // is inert — `gy` is already the buy destination — and is kept only
          // so the node the rider will hang from stays in place.
          {
            op: 'nextCardModifier',
            mod: { appliesTo: 'buy', buyTo: 'gy', uses: 1 },
          },
        ],
      },
    ],
    triggers: [],
    text: 'Discover a card from a non-empty pile. If you later buy a different card costing at least as much this turn, also gain from that pile. +1 Money.',
    flavor: 'New banner, same shop.',
    complexity: 'T3',
    subsystems: ['S-DISCOVER'],
    shop: 'draft',
    art: { key: 'new_banner_day', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'shopkeep',
    name: 'Shopkeep',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, buys: 1, cards: 1, money: 1 },
    effects: [
      {
        op: 'discard',
        target: { who: 'self', zone: 'hand', count: { expr: 'emptyOrLockedPiles' }, pick: 'choose' },
      },
    ],
    triggers: [],
    text: 'Discard a card for each empty or Locked pile. +1 Action, +1 Buy, +1 Card, +1 Money.',
    flavor: 'He charges rent on absence.',
    complexity: 'T2',
    subsystems: ['S-LOCK'],
    shop: 'draft',
    art: { key: 'shopkeep', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'five_year_plan',
    name: 'Five Year Plan',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: ['CN'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        // A Selector has no pile axis, so the pick is what names the pile:
        // without it `zone:'shop'` is every card in every shop.
        op: 'discover',
        // Draft Shop piles only — not the basics, not the Prophet Shop, which
        // is gated on banked Prophet rather than on money.
        pool: {
          scope: 'shop',
          filter: { rarity: ['common', 'rare', 'epic', 'legendary', 'mythic'], not: { subtype: 'Prophet' } },
        },
        count: 3,
        pick: 1,
        prompt: 'Nationalise a shelf',
        then: [
          {
            op: 'transform',
            target: { zone: 'shop', filter: { defId: '$discovered' } },
            into: { pool: { scope: 'entireUniverse', filter: { subtype: 'CN' } } },
          },
        ],
      },
    ],
    triggers: [],
    text: 'Discover 3 Draft Shop cards. Every card in the pile of the one you pick becomes a CN card. +1 Action.',
    flavor: 'Production quotas, met on paper.',
    complexity: 'T3',
    subsystems: ['S-CORE', 'S-DISCOVER'],
    shop: 'draft',
    art: { key: 'five_year_plan', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'bad_omen',
    name: 'Bad Omen',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'addToPileTop',
        target: { shop: 'draft', pick: 'choose', count: 1 },
        defId: 'cursed_pig',
        count: 1,
      },
    ],
    triggers: [],
    // A pile is an ordered stack and the Pig goes on top, so the next buyer
    // gets the Pig rather than the card under it. "Also gives" would need a
    // pile-scoped purchase rider, which the DSL does not have.
    text: 'Flimsy. Choose a Draft pile: the next card bought from it is a Cursed Pig.',
    flavor: 'Something is wrong with that shelf.',
    complexity: 'T3',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'bad_omen', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'water_into_swine',
    name: 'Water Into Swine',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      // Was "add a Cursed Pig to the top of every non-empty Draft pile", which
      // B62/B48 forbid (a notPurchasable card never sits in a shop pile) and
      // which bricked the match: `canBuyPile` refuses a pile whose top is a
      // token, nothing removes the token, so one play closed the whole Draft
      // Shop permanently — and with it the empty-draft-piles end condition.
      // Recorded as SB-66. The Pig now goes where tokens are allowed and where
      // every other Cursed Pig card puts it: the opponents' graveyards.
      { op: 'createCard', defId: 'cursed_pig', to: 'gy', who: 'eachOpponent' },
    ],
    triggers: [],
    text: 'Add a Cursed Pig to each opponent’s GY.',
    flavor: 'A lesser miracle.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'water_into_swine', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'glubby_gloob_the_auctioneer',
    name: 'Glubby Gloob the Auctioneer',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'legendary',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'delayed',
        when: 'startOfNextTurn',
        effects: [
          {
            op: 'discover',
            pool: { scope: 'shop' },
            count: 3,
            pick: 1,
            prompt: 'The gavel falls',
            // `{self:true}` here is Glubby Gloob, which Flimsy already put in
            // the trash — the winner has to be paid with the sentinel.
            then: [{ op: 'createCard', defId: '$discovered', to: 'gy' }],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Flimsy. Blind auction for 3 random shop cards. You get 6 chips, each opponent 5. It resolves at the start of your next turn.',
    flavor: 'Going once. Going twice. Glubb.',
    complexity: 'T4',
    subsystems: ['S-AUCTION', 'S-DELAYED'],
    shop: 'draft',
    art: { key: 'glubby_gloob_the_auctioneer', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'jlore_accelerator',
    name: 'Jlore Accelerator',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'gainCard',
        from: { shop: 'points', filter: { defId: 'jlore' } },
        to: 'hand',
        who: 'eachPlayer',
        free: true,
      },
    ],
    triggers: [],
    text: 'Add a Jlore from the pile to every player’s hand.',
    flavor: 'Ends the game faster, for everyone.',
    complexity: 'T2',
    subsystems: ['S-ENDGAME'],
    shop: 'draft',
    art: { key: 'jlore_accelerator', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'biology_project',
    name: 'Biology Project',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'gainCard',
        from: { shop: 'resource', filter: { defId: 'diamond' } },
        to: 'hand',
        who: 'eachPlayer',
        free: true,
      },
    ],
    triggers: [],
    text: 'Add a Diamond from the pile to every player’s hand.',
    flavor: 'Group project. Everyone gets the grade.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'biology_project', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
];

export default cards;
