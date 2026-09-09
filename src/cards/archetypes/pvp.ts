/**
 * A.11 — Draft Shop: attacks, PvP and opponent interaction.
 *
 * Slice S7 (cards-archetypes).
 *
 * Notes on shapes used here:
 *  - "steal" that means "add a copy" is `copyCard`. A steal that really takes
 *    the card off its owner is `moveTo` with a `who`: `who` names the owner the
 *    card ENDS UP with, so `{op:'moveTo', target:{who:'eachOpponent', ...},
 *    zone:'gy', who:'self'}` moves a card across the table. Without a `who` the
 *    card keeps its owner and lands back in the zone of the player you took it
 *    from. Where the doc destroys the card rather than taking it, the shape
 *    stays `copyCard` + `trash`. The source doc is inconsistent card to card,
 *    so each one was read individually.
 *  - `count` on a `who:'eachOpponent'` / `who:'eachPlayer'` selector is a
 *    table-wide total over the merged candidate list, not a per-player count.
 *    `recruit` is the one op that loops the players itself, so "each opponent
 *    loses one card" is spelled with recruit and a staging pass through
 *    `aside`. Recruit shuffles its source zone afterwards (SB-2 / B42) — that
 *    is the rule for reaching into a hidden Library, not a rider these cards
 *    print.
 *  - `aside` is ONE staging pile per player, and a Hand Box parks its stored
 *    cards there across turns carrying the `boxed` counter. Every read of
 *    `aside` below is staging for the length of a single effect, so each one
 *    excludes stored cards with `filter:{not:{counter:{key:'boxed',gte:1}}}`.
 *    Without it War! antes somebody's stored card and Mother Witch turns one
 *    into a Cursed Pig.
 *  - A Discover `pool` ignores its own `who` (zoneDefIds walks every opponent),
 *    so an 'opponentLibrary' / 'opponentHand' pool offers cards from the whole
 *    table and whatever acts on the pick has to span the whole table too.
 *  - Hired Shrimp's `wordCount` is a frozen build-time constant. Its rules text
 *    length is never measured at runtime.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'siphon_squad',
    name: 'Siphon Squad',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'rare',
    keywords: [],
    stats: { money: 2 },
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { who: 'eachOpponent', zone: 'hand' }, atLeast: 4 } },
        then: [
          { op: 'discard', target: { who: 'eachOpponent', zone: 'hand', count: 2, pick: 'choose', chooser: 'owner' } },
        ],
        else: [
          {
            op: 'conditional',
            if: { has: { target: { who: 'eachOpponent', zone: 'hand' }, atLeast: 2 } },
            then: [
              { op: 'discard', target: { who: 'eachOpponent', zone: 'hand', count: 1, pick: 'choose', chooser: 'owner' } },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: '+2 Money. Each opponent discards by hand size: 4 or more discards 2, 2 or 3 discards 1, 0 or 1 discards nothing.',
    flavor: 'They take exactly as much as you can spare.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'siphon_squad', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'quiet_quorum',
    name: 'Quiet Quorum',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 2, cards: 2 },
    effects: [{ op: 'discardDownTo', amount: 4, who: 'eachOpponent' }],
    triggers: [],
    text: '+2 Actions, +2 Cards. Each opponent with 5 or more cards in hand discards down to 4.',
    flavor: 'Motion carried. Nobody spoke.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'quiet_quorum', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'midnight_raid',
    name: 'Midnight Raid',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, money: 1 },
    effects: [
      {
        op: 'forEach',
        over: { who: 'eachOpponent', zone: 'hand', filter: { type: 'Points' } },
        effects: [{ op: 'gain', stat: 'money', amount: 1 }],
      },
      { op: 'discard', target: { who: 'eachOpponent', zone: 'hand', filter: { type: 'Points' } } },
    ],
    triggers: [],
    text: '+1 Action, +1 Money. Each opponent discards every Points card in hand. +1 Money for each card discarded this way.',
    flavor: 'Quiet boots, loud pockets.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'midnight_raid', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'thought_steal',
    name: 'Thought Steal',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      { op: 'copyCard', target: { who: 'chosenOpponent', zone: 'library', count: 2, pick: 'random' }, to: 'hand', who: 'self' },
    ],
    triggers: [],
    text: 'Copy 2 random cards from an opponent’s Library into your hand.',
    flavor: 'They will not miss what they never drew.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'thought_steal', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'spyglass',
    name: 'Spyglass',
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
        pool: { scope: 'opponentLibrary', who: 'chosenOpponent' },
        count: 3,
        pick: 1,
        prompt: 'Discover a card in an opponent’s Library.',
        // '$discovered' is the card the player actually picked. A `{pool:...}`
        // here is re-sampled by resolveDefIdSpec, so the player could be shown
        // A/B/C and handed D. The copy is minted at the bottom of the Library
        // and then moved to the top, which is the only handle on it: `pick`
        // 'bottom' is the newest card of that name in the pile.
        then: [
          {
            op: 'copyCard',
            target: { who: 'eachOpponent', zone: 'library', filter: { defId: '$discovered' }, count: 1 },
            to: 'library',
            who: 'self',
          },
          { op: 'moveTo', target: { zone: 'library', filter: { defId: '$discovered' }, count: 1, pick: 'bottom' }, zone: 'library', position: 'top' },
        ],
      },
    ],
    triggers: [],
    text: 'Discover a card in an opponent’s Library and put a copy of it on top of your Library.',
    flavor: 'Look long enough and you own the view.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'spyglass', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'griftah',
    name: 'Griftah',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'legendary',
    keywords: [],
    stats: {},
    effects: [
      // The two Discovers are siblings, not nested: '$discovered' is
      // substituted across a whole `then` tree, so a Discover inside another
      // Discover's `then` would see the outer pick in both places.
      {
        op: 'discover',
        pool: { scope: 'library', who: 'self' },
        count: 3,
        pick: 1,
        prompt: 'Discover a card in your Library to trade away.',
        then: [
          {
            op: 'forEach',
            over: { zone: 'library', filter: { defId: '$discovered' }, count: 1 },
            effects: [{ op: 'moveTo', target: { self: true }, zone: 'aside' }],
          },
        ],
      },
      {
        op: 'discover',
        pool: { scope: 'opponentLibrary', who: 'chosenOpponent' },
        count: 3,
        pick: 1,
        prompt: 'Discover a card in an opponent’s Library to take.',
        // The pool ignores its `who` and offers cards out of every opponent's
        // Library, so the take spans every opponent too — bound to one seat it
        // matched nothing whenever the pick belonged to somebody else, and the
        // give-half fired anyway and posted your staged card away for free.
        // Both halves are `moveTo` with a destination `who`, so the swap moves
        // the real cards, and the give sits inside the take: nothing leaves
        // your deck unless a card came back for it.
        then: [
          {
            op: 'forEach',
            over: { who: 'eachOpponent', zone: 'library', filter: { defId: '$discovered' }, count: 1 },
            effects: [
              { op: 'moveTo', target: { self: true }, zone: 'library', who: 'self' },
              {
                op: 'moveTo',
                target: { who: 'self', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
                zone: 'library',
                who: 'chosenOpponent',
              },
              { op: 'shuffle', zone: 'library' },
              { op: 'shuffle', zone: 'library', who: 'chosenOpponent' },
            ],
          },
          // The card was gone by the time this resolved. Put yours back at an
          // unknown depth rather than stranding it in `aside` for the match.
          {
            op: 'moveTo',
            target: { who: 'self', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
            zone: 'library',
            position: 'random',
          },
        ],
      },
    ],
    triggers: [],
    text: 'Discover a card from your Library and one from an opponent’s Library, then swap them.',
    flavor: 'Everybody wins. Nobody checks.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'griftah', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'shuffle' },
  },
  {
    id: 'antics',
    name: 'Antics',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      // opRecruit moves a card inside its own owner's zones, so recruiting from
      // an opponent's Library only tutors it into *their* hand. The borrow is a
      // Temporary copy in your hand while the original goes to their GY, which
      // is where the printed card leaves it anyway.
      {
        op: 'forEach',
        over: { who: 'chosenOpponent', zone: 'library', filter: { type: 'Action' }, count: 1 },
        effects: [
          { op: 'copyCard', target: { self: true }, to: 'hand', who: 'self', keywords: ['Temporary'] },
          { op: 'moveTo', target: { self: true }, zone: 'gy' },
        ],
      },
      // B42 / SB-34: a tutor out of a hidden library shuffles it afterwards.
      { op: 'shuffle', zone: 'library', who: 'chosenOpponent' },
    ],
    triggers: [],
    text: 'Take a Temporary copy of an Action from an opponent’s Library into your hand. The original goes to their GY.',
    flavor: 'Borrowed, loudly.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'antics', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'corpo_espionage',
    name: 'Corpo Espionage',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      // recruit stages one top card per opponent (a `count` on the merged
      // selector would reveal one card in total). Staging is also what keeps
      // the choice to the revealed cards: SB-34 keeps the rest of a Library
      // hidden, and choosing straight out of `zone:'library'` would list it.
      { op: 'recruit', zone: 'library', count: 1, who: 'eachOpponent', to: 'aside' },
      { op: 'reveal', target: { who: 'eachOpponent', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } } },
      {
        op: 'selectCards',
        from: { who: 'eachOpponent', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
        min: 1,
        max: 1,
        then: [{ op: 'copyCard', target: { self: true }, to: 'hand', who: 'self', keywords: ['Temporary'] }],
      },
      {
        op: 'moveTo',
        target: { who: 'eachOpponent', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
        zone: 'library',
        position: 'top',
      },
    ],
    triggers: [],
    text: '+1 Action. Reveal the top card of each opponent’s Library, then add a Temporary copy of one of them to your hand.',
    flavor: 'The memo leaves the building.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'corpo_espionage', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'ambush_bid',
    name: 'Ambush Bid',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      // Both tops are staged in `aside` so one selector can weigh them against
      // each other, and so the random opponent is rolled once rather than once
      // per node.
      { op: 'moveTo', target: { zone: 'library', count: 1, pick: 'top' }, zone: 'aside' },
      { op: 'moveTo', target: { who: 'randomOpponent', zone: 'library', count: 1, pick: 'top' }, zone: 'aside' },
      { op: 'reveal', target: { who: 'eachPlayer', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } } },
      // No expression reads a revealed card's cost, so the comparison is made
      // by discarding the cheaper of the two: whoever still has a card staged
      // revealed the dearer one. Equal costs fall to seat order.
      {
        op: 'forEach',
        over: { who: 'eachPlayer', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } }, count: 1, pick: 'cheapest' },
        effects: [{ op: 'discard', target: { self: true } }],
      },
      {
        op: 'conditional',
        if: {
          has: {
            target: { who: 'self', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
            atLeast: 1,
          },
        },
        then: [
          { op: 'gain', stat: 'money', amount: 2 },
          {
            op: 'moveTo',
            target: { who: 'self', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
            zone: 'hand',
          },
        ],
        else: [
          {
            op: 'discard',
            target: { who: 'eachOpponent', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
          },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action. Reveal your top card and a random opponent’s and discard the cheaper. If yours cost more, take it into your hand and +2 Money. Otherwise both are discarded.',
    flavor: 'Bid blind, win loud.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'ambush_bid', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'the_curator',
    name: 'The Curator',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'reveal', target: { zone: 'hand' } },
      {
        op: 'choose',
        who: 'eachOpponent',
        options: [
          {
            label: 'Give a Draft Shop card costing at least the Curator’s cheapest revealed card',
            effects: [{ op: 'gainCard', from: { shop: 'draft', pick: 'choose', excludeJlore: true }, to: 'gy', who: 'self', free: true }],
          },
          {
            label: 'Give a card from your hand',
            effects: [{ op: 'moveTo', target: { zone: 'hand', count: 1, pick: 'choose', chooser: 'owner' }, zone: 'gy' }],
          },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action. Reveal your hand and note its cheapest card. Each opponent gives you a card costing at least that much, from the Draft Shop or from their hand.',
    flavor: 'The collection grows either way.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'the_curator', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'bribe',
    name: 'Bribe',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'discover',
        pool: { scope: 'opponentHand', who: 'chosenOpponent' },
        count: 3,
        pick: 1,
        prompt: 'Discover a card in an opponent’s hand to take.',
        // The pick is bound through '$discovered'; without it the steal raised
        // a second prompt over the whole hand. The pool spans every opponent's
        // hand, so the steal does too, and the card really changes hands: a
        // `moveTo` with `who:'self'`. The Diamond is paid from inside the take
        // rather than beside it, so a pick that is no longer there when this
        // resolves no longer buys an opponent a free Diamond.
        then: [
          {
            op: 'forEach',
            over: { who: 'eachOpponent', zone: 'hand', filter: { defId: '$discovered' }, count: 1 },
            effects: [
              { op: 'moveTo', target: { self: true }, zone: 'gy', who: 'self' },
              { op: 'createCard', defId: 'diamond', to: 'gy', who: 'chosenOpponent' },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Flimsy. Discover a card in an opponent’s hand and take it into your GY. Give an opponent a Diamond.',
    flavor: 'Everyone left satisfied. One of them was wrong.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'bribe', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'corruption_scandal',
    name: 'Corruption Scandal',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      // moveTo would have emptied the hand into that opponent's own GY. The
      // hand really changes hands: copy it into yours, then trash theirs.
      { op: 'copyCard', target: { who: 'chosenOpponent', zone: 'hand' }, to: 'gy', who: 'self' },
      { op: 'trash', target: { who: 'chosenOpponent', zone: 'hand' } },
      { op: 'createCard', defId: 'diamond', to: 'gy', who: 'chosenOpponent', count: 5 },
    ],
    triggers: [],
    text: 'Flimsy. Take an opponent’s entire hand into your GY. Give that opponent 5 Diamonds.',
    flavor: 'A settlement, technically.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'corruption_scandal', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'firing_squad',
    name: 'Firing Squad',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'discover',
        pool: { scope: 'opponentHand', who: 'chosenOpponent' },
        count: 3,
        pick: 1,
        prompt: 'Discover a card in an opponent’s hand to trash.',
        // Bound to the pick: an unbound `pick:'choose'` re-prompted over the
        // opponent's entire hand, which is strictly more than the card prints.
        then: [{ op: 'trash', target: { who: 'eachOpponent', zone: 'hand', filter: { defId: '$discovered' }, count: 1 } }],
      },
    ],
    triggers: [],
    text: 'Flimsy. Discover a card in an opponent’s hand and trash it.',
    flavor: 'One volley, one vacancy.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'firing_squad', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'polymorph',
    name: 'Polymorph',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      { op: 'transform', target: { who: 'chosenOpponent', zone: 'hand', count: 1, pick: 'random' }, into: 'copper' },
    ],
    triggers: [],
    text: 'Transform a random card in an opponent’s hand into a Copper.',
    flavor: 'It was a masterpiece. Now it is change.',
    complexity: 'T2',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'polymorph', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'counter_spell',
    name: 'Counter Spell',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'nextCardModifier', mod: { who: 'eachOpponent', appliesTo: 'play', buyTo: 'gy', uses: 1 } },
    ],
    triggers: [],
    text: '+1 Action. The next Action each opponent plays is discarded instead of resolving. They do not lose the Action.',
    flavor: 'Denied, politely.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'counter_spell', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'aggressive_taxation',
    name: 'Aggressive Taxation',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'nextCardModifier',
        mod: {
          who: 'eachOpponent',
          appliesTo: 'play',
          uses: 1,
          appendEffects: [
            { op: 'delayed', when: 'startOfNextTurn', effects: [{ op: 'gain', stat: 'money', amount: { expr: 'selfCost' } }] },
          ],
        },
      },
    ],
    triggers: [],
    text: 'The Money from the next Resource each opponent plays is paid to you at the start of your next turn instead.',
    flavor: 'Compliance is not optional and never was.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'aggressive_taxation', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'meta_shift',
    name: 'Meta Shift',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 2 },
    effects: [
      { op: 'moveTo', target: { who: 'eachPlayer', zone: 'hand', count: 1, pick: 'choose', chooser: 'owner' }, zone: 'hand' },
    ],
    triggers: [],
    text: '+2 Cards. Each player passes a card from their hand to the next player.',
    flavor: 'The tier list rotates.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'meta_shift', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'shuffle' },
  },
  {
    id: 'clipped_wings',
    name: 'Clipped Wings',
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
        mod: {
          who: 'eachOpponent',
          appliesTo: 'buy',
          uses: 99,
          appendEffects: [
            {
              op: 'conditional',
              if: { expr: 'max(0, selfCost - 5)' },
              then: [{ op: 'createCard', defId: 'cursed_pig', to: 'gy' }],
            },
          ],
        },
      },
    ],
    triggers: [],
    text: '+1 Action. Until your next turn, an opponent who gains a card costing (6) or more also gains a Cursed Pig.',
    flavor: 'Fly lower. It is safer down here.',
    complexity: 'T3',
    subsystems: ['S-PVP', 'S-TOKEN'],
    shop: 'draft',
    art: { key: 'clipped_wings', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'baby_witch',
    name: 'Baby Witch',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [{ op: 'createCard', defId: 'cursed_pig', to: 'gy', who: 'eachOpponent' }],
    triggers: [],
    text: 'Add a Cursed Pig to each opponent’s GY.',
    flavor: 'She is learning. You are the homework.',
    complexity: 'T2',
    subsystems: ['S-PVP', 'S-TOKEN'],
    shop: 'draft',
    art: { key: 'baby_witch', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'mother_witch',
    name: 'Mother Witch',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      // A Discover pool ignores `who` and its prompt always goes to the player
      // resolving the card, so the printed Discover offered *your* hand to
      // *you*. recruit is the one op that loops the players itself, so each
      // opponent loses a card of their own rather than one between them. Its
      // shuffle-after (SB-2) lands on a hand here, whose order zones.ts calls
      // meaningful (B13) — no other op takes one card per player, so that is
      // the price of the loop until one exists.
      { op: 'recruit', zone: 'hand', count: 1, who: 'eachOpponent', to: 'aside' },
      {
        op: 'transform',
        target: { who: 'eachOpponent', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
        into: 'cursed_pig',
      },
      {
        op: 'moveTo',
        target: { who: 'eachOpponent', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
        zone: 'hand',
      },
    ],
    triggers: [],
    text: 'Each opponent turns a card in their hand into a Cursed Pig.',
    flavor: 'She taught the baby everything.',
    complexity: 'T3',
    subsystems: ['S-PVP', 'S-TOKEN'],
    shop: 'draft',
    art: { key: 'mother_witch', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'weasel_turner',
    name: 'Weasel Turner',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      { op: 'createCard', defId: 'weasel_turner', to: 'library', who: 'eachOpponent', count: 3, position: 'random' },
      { op: 'shuffle', zone: 'library', who: 'eachOpponent' },
    ],
    triggers: [],
    text: 'Shuffle 3 copies of Weasel Turner into each opponent’s deck.',
    flavor: 'It multiplies in other people’s pockets.',
    complexity: 'T2',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'weasel_turner', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'shuffle' },
  },
  {
    id: 'ancient_curse',
    name: 'Ancient Curse',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'epic',
    keywords: [],
    stats: { vp: -7 },
    effects: [
      { op: 'createCard', defId: 'ancient_curse_echo', to: 'library', who: 'chosenOpponent', position: 'random' },
      { op: 'shuffle', zone: 'library', who: 'chosenOpponent' },
    ],
    triggers: [],
    text: '-7 VP. Shuffle a copy of this curse into an opponent’s deck. That copy does not spread further.',
    flavor: 'It only needed one host to start.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'ancient_curse', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'ancient_curse_echo',
    name: 'Ancient Curse Echo',
    cost: { money: 7 },
    types: ['Action', 'Token'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'token',
    keywords: [],
    stats: { vp: -7 },
    effects: [],
    triggers: [],
    text: '-7 VP.',
    flavor: 'The curse, without the ambition.',
    complexity: 'T1',
    subsystems: ['S-PVP', 'S-TOKEN'],
    notPurchasable: true,
    art: { key: 'ancient_curse_echo', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'profe_yates_unleashed',
    name: 'Profe Yates Unleashed',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'legendary',
    keywords: [],
    stats: {},
    effects: [
      { op: 'trash', target: { who: 'eachOpponent', zone: 'hand', filter: { name: '/[moseMOSE]/' } } },
    ],
    triggers: [],
    text: 'Trash every card in every opponent’s hand whose name contains any letter of M, O, O, S, E.',
    flavor: 'He has been waiting for this lecture.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'profe_yates_unleashed', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'hired_shrimp',
    name: 'Hired Shrimp',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'legendary',
    keywords: [],
    stats: {},
    effects: [
      { op: 'trash', target: { who: 'eachOpponent', zone: 'hand', filter: { name: 'wordsFewerThan:16' } } },
    ],
    triggers: [],
    text: 'Trash every card in each opponent’s hand that has fewer words in its text than this.',
    flavor: 'Sixteen. Count them.',
    complexity: 'T4',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'hired_shrimp', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
    wordCount: 16,
  },
  {
    id: 'pickle',
    name: 'Pickle',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'delayed',
        when: 'startOfNextTurn',
        who: 'eachOpponent',
        effects: [
          {
            op: 'choose',
            options: [
              { label: '-2 Money', effects: [{ op: 'gain', stat: 'money', amount: -2 }] },
              { label: 'Discard a random card', effects: [{ op: 'discard', target: { zone: 'hand', count: 1, pick: 'random' } }] },
              { label: 'Give the Pickle player a Gold', effects: [{ op: 'createCard', defId: 'gold', to: 'gy', who: 'chosenOpponent' }] },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action. At the start of their next turn each opponent chooses: -2 Money, discard a random card, or give you a Gold.',
    flavor: 'A brine-based ultimatum.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'pickle', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'ebon_hand',
    name: 'Ebon Hand',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      // One opponent's graveyard, not every graveyard merged into one pile.
      { op: 'reveal', target: { who: 'chosenOpponent', zone: 'gy', count: 1, pick: 'mostExpensive' } },
      { op: 'copyCard', target: { who: 'chosenOpponent', zone: 'gy', count: 1, pick: 'mostExpensive' }, to: 'gy', who: 'self' },
    ],
    triggers: [],
    text: 'Add a copy of the last card an opponent discarded to your GY. If several, take the most expensive. You see it first.',
    flavor: 'It reaches into the pile and keeps what it finds.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'ebon_hand', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'rebellion',
    name: 'Rebellion',
    cost: { money: 13 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [{ op: 'discard', target: { who: 'eachOpponent', zone: 'hand' } }],
    triggers: [],
    text: 'Each opponent discards their entire hand.',
    flavor: 'Everything on the table, into the fire.',
    complexity: 'T2',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'rebellion', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
  {
    id: 'coronation',
    name: 'Coronation',
    cost: { money: 8 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { vp: 4, actions: 4, buys: 4, cards: 4, money: 4 },
    effects: [
      { op: 'createCard', defId: 'rebellion', to: 'library', who: 'chosenOpponent', position: 'random' },
      { op: 'shuffle', zone: 'library', who: 'chosenOpponent' },
    ],
    triggers: [],
    text: '+4 VP, +4 Actions, +4 Buys, +4 Cards, +4 Money. Shuffle a Rebellion into an opponent’s deck.',
    flavor: 'Every crown ships with its own uprising.',
    complexity: 'T2',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'coronation', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'loot_attack',
    name: 'Loot Attack',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      { op: 'createCard', defId: 'grubbing_goblin', to: 'gy', count: 2 },
      {
        op: 'forEach',
        over: { zone: ['library', 'hand', 'gy', 'play'], filter: { defId: 'grubbing_goblin' } },
        effects: [
          // The inner forEach picks the Gold once and binds it, so the copy and
          // the trash are the same card. A plain moveTo would have shuffled the
          // Gold between the victim's own zones and never reached your GY.
          {
            op: 'forEach',
            over: { who: 'randomOpponent', zone: ['hand', 'gy'], filter: { defId: 'gold' }, count: 1, pick: 'random' },
            effects: [
              { op: 'copyCard', target: { self: true }, to: 'gy', who: 'self' },
              { op: 'trash', target: { self: true } },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Flimsy. Add 2 Grubbing Goblins to your GY. For each Grubbing Goblin in your deck, steal a Gold from a random opponent into your GY.',
    flavor: 'They work for shares.',
    complexity: 'T3',
    subsystems: ['S-PVP', 'S-TOKEN'],
    shop: 'draft',
    art: { key: 'loot_attack', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'war',
    name: 'War!',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      // The ante is dealt by recruit, the one op that takes `count` from each
      // player: a `who:'eachPlayer'` selector with `count:1` moves one card in
      // total, which is what left every other player's bet out of the pot.
      { op: 'recruit', zone: 'library', count: 1, who: 'eachPlayer', to: 'aside' },
      { op: 'reveal', target: { who: 'eachPlayer', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } } },
      {
        op: 'conditional',
        if: {
          has: {
            target: { who: 'self', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
            atLeast: 1,
          },
        },
        then: [
          // Nothing reads a revealed card's cost, so the dearest bet is sent to
          // its owner's GY and the pot is awarded by who is left holding one:
          // an empty aside pile of your own means yours was the dearest.
          {
            op: 'forEach',
            over: {
              who: 'eachPlayer',
              zone: 'aside',
              filter: { not: { counter: { key: 'boxed', gte: 1 } } },
              count: 1,
              pick: 'mostExpensive',
            },
            effects: [{ op: 'moveTo', target: { self: true }, zone: 'gy' }],
          },
          {
            op: 'conditional',
            if: {
              not: {
                has: {
                  target: { who: 'self', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
                  atLeast: 1,
                },
              },
            },
            // You won the pot, so it really changes hands: `who:'self'` on the
            // moveTo is the owner the bets end up with.
            then: [
              {
                op: 'moveTo',
                target: { who: 'eachOpponent', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
                zone: 'gy',
                who: 'self',
              },
            ],
            // Somebody else won it. Every bet goes home rather than sitting in
            // `aside` for the rest of the match.
            else: [
              {
                op: 'moveTo',
                target: { who: 'eachPlayer', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
                zone: 'gy',
              },
            ],
          },
        ],
        else: [
          {
            op: 'moveTo',
            target: { who: 'eachPlayer', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
            zone: 'gy',
          },
        ],
      },
    ],
    triggers: [],
    text: 'Every player antes the top card of their Library. The dearest card wins: if it is yours, the whole pot joins your GY. Otherwise every card goes to its owner’s GY.',
    flavor: 'War. War never changes the shuffle.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'war', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
  {
    id: 'edge_of_tomorrow',
    name: 'Edge of Tomorrow',
    cost: { money: 12 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'legendary',
    keywords: ['Flimsy'],
    stats: {},
    effects: [{ op: 'manifestAura', tier: 'celestial', auraId: 'aspect_of_ares' }],
    triggers: [],
    text: 'Flimsy. Manifest the Celestial Aura Aspect of Ares: only War! may be played, and you gain a War! every turn.',
    flavor: 'Live. Die. Reshuffle.',
    complexity: 'T4',
    subsystems: ['S-AURA', 'S-PVP'],
    shop: 'draft',
    art: { key: 'edge_of_tomorrow', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'doomsday_clock',
    name: 'Doomsday Clock',
    cost: { money: 9 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'mythic',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    effects: [
      // The row prints a three-turn fuse and nothing about the shared Doomsday
      // Counter; Project: Doomsday and Doomsday Button are the cards that move
      // it. Advancing it 3 here was 30% of an unrelated instant end.
      { op: 'delayed', when: { inTurns: 3 }, effects: [{ op: 'endGame', reason: 'doomsdayClock' }] },
    ],
    triggers: [],
    text: 'Play on Buy. Flimsy. The game ends 3 turns from now. Any player who plays another Doomsday Clock resets the timer to 3.',
    flavor: 'It is always three turns to midnight.',
    complexity: 'T3',
    subsystems: ['S-ENDGAME', 'S-PVP'],
    shop: 'draft',
    art: { key: 'doomsday_clock', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
];

export default cards;
