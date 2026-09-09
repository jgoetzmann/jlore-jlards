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
 *    `perPlayer: true` runs the whole count-and-pick once per resolved player,
 *    which is the fix wherever the quota is per seat.
 *  - A per-seat EFFECT FRAME is a different thing again, and card data has
 *    exactly one: `forEach` over a `perPlayer` selector that takes one card
 *    from each player, whose body is then bound to that card, so `who:'owner'`
 *    inside it names the seat it belongs to. That is how Siphon Squad reads a
 *    hand-size ladder per opponent and how Mother Witch asks each opponent
 *    about their own hand. `recruit` also loops the players, but it shuffles
 *    its source zone afterwards (SB-2 / B42) — the rule for reaching into a
 *    hidden Library, and wrong for a hand (B13) — so it is kept for Library
 *    reads only.
 *  - `aside` is ONE staging pile per player, and a Hand Box parks its stored
 *    cards there across turns carrying the `boxed` counter. Every read of
 *    `aside` below is staging for the length of a single effect, so each one
 *    excludes stored cards with `filter:{not:{counter:{key:'boxed',gte:1}}}`.
 *    Without it War! antes somebody's stored card and Corpo Espionage reveals
 *    one.
 *  - A Discover `pool` ignores its own `who` (zoneDefIds walks every opponent),
 *    so an 'opponentLibrary' / 'opponentHand' pool offers cards from the whole
 *    table and whatever acts on the pick has to span the whole table too.
 *  - Hired Shrimp's `wordCount` is a frozen build-time constant (SB-30). The
 *    `wordCountLt` filter reads that field off the cards it is matching against
 *    and falls back to counting the tokens of their text; nothing ever measures
 *    Hired Shrimp's own rendered length at runtime, which is what keeps a card
 *    whose rules text describes its own length from moving under itself.
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
      // The ladder is read once per opponent. A `who:'eachOpponent'` condition
      // counts every hand merged into one pile, so three opponents holding 2
      // cards each all scored as "4 or more" and then discarded 2 BETWEEN them.
      // `forEach` over one card per opponent (`perPlayer`) is the per-seat effect
      // frame: `who:'owner'` inside the body names the seat that card belongs to,
      // and an opponent with an empty hand contributes no pass at all — which is
      // the 0-or-1 rung.
      {
        op: 'forEach',
        over: { who: 'eachOpponent', zone: 'hand', perPlayer: true, count: 1, pick: 'top' },
        effects: [
          {
            op: 'conditional',
            if: { has: { target: { who: 'owner', zone: 'hand' }, atLeast: 4 } },
            then: [
              { op: 'discard', target: { who: 'owner', zone: 'hand', count: 2, pick: 'choose', chooser: 'owner' } },
            ],
            else: [
              {
                op: 'conditional',
                if: { has: { target: { who: 'owner', zone: 'hand' }, atLeast: 2 } },
                then: [
                  { op: 'discard', target: { who: 'owner', zone: 'hand', count: 1, pick: 'choose', chooser: 'owner' } },
                ],
              },
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
    art: { key: 'siphon_squad', status: 'placeholder' },
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
    art: { key: 'quiet_quorum', status: 'placeholder' },
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
    art: { key: 'midnight_raid', status: 'placeholder', anim: 'coin' },
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
    art: { key: 'thought_steal', status: 'placeholder' },
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
    art: { key: 'spyglass', status: 'placeholder' },
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
    art: { key: 'griftah', status: 'placeholder', anim: 'shuffle' },
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
    art: { key: 'antics', status: 'placeholder' },
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
    art: { key: 'corpo_espionage', status: 'placeholder' },
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
    art: { key: 'ambush_bid', status: 'placeholder' },
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
      // The floor is a reading of the CURATOR's hand, but each branch below runs
      // in the opponent's own effect frame — that is what makes them the chooser —
      // where `cheapestInHand` would read THEIR hand instead. So the number is
      // taken here, in the Curator's frame, and posted onto every opponent as a
      // player counter they read back as `curatorFloor`. The `turn:` prefix wipes
      // it at the start of their next turn. `addCounter` adds rather than sets, so
      // two Curators in one turn stack their floors — rare, and it only ever makes
      // the tax stricter, never looser.
      {
        op: 'addCounter',
        scope: 'player',
        key: 'turn:curatorFloor',
        amount: { expr: 'cheapestInHand' },
        who: 'eachOpponent',
      },
      {
        op: 'choose',
        who: 'eachOpponent',
        options: [
          {
            label: 'Give the Curator a card from the Draft Shop',
            // `count:1` is what makes this a real prompt: a pile selector with no
            // count returns every pile and `gainCard` then silently takes the top
            // of the first one. The floor cannot ride here — `selectPilesWith`
            // matches the raw filter, so an expression bound reads as no bound at
            // all — and the cheapest Draft pile already outprices a typical hand's
            // cheapest card. `who:'owner'` is the Curator's controller, so the
            // card crosses the table instead of landing in the giver's own GY.
            effects: [
              {
                op: 'gainCard',
                from: { shop: 'draft', count: 1, pick: 'choose', excludeJlore: true },
                to: 'gy',
                who: 'owner',
                free: true,
              },
            ],
          },
          {
            label: 'Give the Curator a card from your hand costing at least that much',
            effects: [
              // The row says MUST, so this branch has to cost something. A hand
              // holding nothing at or above the floor leaves the selector with an
              // empty candidate set, `resolveTargets` returns [] rather than
              // prompting, and the moveTo hands over nothing — picking this option
              // was a free dodge. Tested first: a hand that cannot pay pays out of
              // the Draft Shop instead, which is the row's other half rather than a
              // way out of it.
              {
                op: 'conditional',
                if: {
                  has: {
                    target: {
                      who: 'self',
                      zone: 'hand',
                      filter: { cost: { gte: { expr: 'curatorFloor' } } },
                    },
                    atLeast: 1,
                  },
                },
                then: [
                  {
                    op: 'moveTo',
                    target: {
                      who: 'self',
                      zone: 'hand',
                      count: 1,
                      pick: 'choose',
                      chooser: 'owner',
                      filter: { cost: { gte: { expr: 'curatorFloor' } } },
                    },
                    zone: 'gy',
                    who: 'owner',
                  },
                ],
                else: [
                  {
                    op: 'gainCard',
                    from: { shop: 'draft', count: 1, pick: 'choose', excludeJlore: true },
                    to: 'gy',
                    who: 'owner',
                    free: true,
                  },
                ],
              },
            ],
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
    art: { key: 'the_curator', status: 'placeholder' },
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
    art: { key: 'bribe', status: 'placeholder', anim: 'coin' },
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
    art: { key: 'corruption_scandal', status: 'placeholder' },
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
    art: { key: 'firing_squad', status: 'placeholder', anim: 'trash' },
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
    art: { key: 'polymorph', status: 'placeholder', anim: 'summon' },
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
      // STILL NOT EXPRESSIBLE. There is no cancel channel: `consumePlayMods`
      // reads multiply / multiplyStats / grantKeyword / grantSubtype /
      // appendEffects / buffTimes / nerfTimes / absorbInto / bind and nothing
      // else, `appendEffects` run AFTER the stat line and the printed body, and
      // `absorbInto` copies a card's effects without stopping them. `buyTo` is a
      // buy-mod field, so on this play-scoped mod it is read by nobody. The mod
      // is left in place because it is inert — it documents the hook a
      // `cancelTo` / `onlyTypes` pair would plug into — and because every
      // authorable substitute (denying the Action, trashing the card) is a
      // different card from the one the row prints.
      { op: 'nextCardModifier', mod: { who: 'eachOpponent', appliesTo: 'play', buyTo: 'gy', uses: 1 } },
    ],
    triggers: [],
    text: '+1 Action. The next Action each opponent plays is discarded instead of resolving. They do not lose the Action.',
    flavor: 'Denied, politely.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'counter_spell', status: 'placeholder' },
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
      // STILL NOT EXPRESSIBLE, and the previous shape was worse than nothing:
      // `appendEffects` resolve in the OPPONENT's frame, so the delayed `gain`
      // queued on the opponent and paid THEM the cost of the card they played at
      // the start of their own next turn. A (5) Epic attack was a gift.
      //
      // The payee half is authorable now — an `onOpponentPlay` trigger runs in
      // the owner's frame, `pick:'lastPlayed'` reaches the card the opponent just
      // played, and a `delayed` queued there lands on the taxer's own next turn.
      // The AMOUNT is not: nothing reads a card's Money output. `selfCost` is not
      // it (Copper costs 0 and pays 1, Gold costs 6 and pays 3), and no
      // expression variable, filter or op exposes `stats.money` of an instance.
      // Redirecting the wrong number is a different card, so the mod is left
      // inert — the hook is here, the reading is not.
      { op: 'nextCardModifier', mod: { who: 'eachOpponent', appliesTo: 'play', uses: 1 } },
    ],
    triggers: [],
    text: 'The Money from the next Resource each opponent plays is paid to you at the start of your next turn instead.',
    flavor: 'Compliance is not optional and never was.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'aggressive_taxation', status: 'placeholder', anim: 'coin' },
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
      // NARROWED AGAINST THE ROW, AND THE PRINTED TEXT SAYS SO. A.11 line 962
      // reads “Each player passes a card from hand to the next player”; this card
      // passes only YOUR card, and its `text` promises only that. The gap is on
      // the card rather than hidden behind it, which is the whole point of the
      // audit — a row the engine cannot reach must not be printed as if it could.
      //
      // Why the other seats cannot pass: a pass needs the seat AFTER each passer.
      // The only thing that names a destination seat is `moveTo`'s `who`, and it
      // is resolved once, against the frame the node runs in. No op reframes onto
      // another player: `forEach` rebinds the source card but keeps the caster as
      // `player`, `perPlayer` widens a selector without splitting the frame, and
      // `recruit` — the one per-player mover — hands every card back to the seat
      // it took it from. `who:'owner'` names a card's owner; nothing names the
      // seat after that owner. `{op:'choose', who:'eachOpponent'}` does open a
      // per-opponent frame, but only for two or more options, so reaching it
      // means inventing a choice the row does not print — a different card, which
      // is worse than a smaller one. Engine fix: a Who resolved from a bound
      // card's owner ('nextAfterOwner'), or a real per-player effect frame.
      //
      // The old node was actively wrong rather than merely inert: `pick:'choose'`
      // now suspends and resumes, and a `who:'eachPlayer'` hand selector pools
      // every hand at the table into one prompt, so it offered whoever owned the
      // first candidate a look at everybody's cards and then handed the pick back
      // to its own owner. Passing only your own card under-delivers; it does not
      // leak and it does not misfire.
      {
        op: 'moveTo',
        target: { who: 'self', zone: 'hand', count: 1, pick: 'choose', chooser: 'owner' },
        zone: 'hand',
        who: 'nextPlayer',
      },
    ],
    triggers: [],
    text: '+2 Cards. Pass a card from your hand to the next player.',
    flavor: 'The tier list rotates.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'meta_shift', status: 'placeholder', anim: 'shuffle' },
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
      // "Until your next turn" is a player counter with the `turn:` prefix: it is
      // written on your turn and wiped at the start of your next one, which is
      // exactly the window the row prints. `uses:99` was standing in for a
      // duration a NextCardMod does not have.
      { op: 'addCounter', scope: 'player', key: 'turn:clippedWings', amount: 1 },
    ],
    triggers: [
      // The rider is a trigger, not a buy mod: `buyCard` reads costDelta,
      // costFloor and buyTo off a buy-scoped mod and nothing else, so the old
      // `appendEffects` were unreachable and the card was +1 Action.
      //
      // A bought card is appended to the BUYER's graveyard, so `pick:'bottom'` is
      // the card they just gained. Binding it through `forEach` is what lets its
      // cost be read: `selfCost` is then the bought card's, where a `filter` on
      // the selector would have matched the dearest (6)+ card anywhere in that
      // graveyard and fired on a (2) purchase.
      //
      // Only purchases are observable — there is no onOpponentGain — so a card
      // an opponent gains without buying it slips the net.
      //
      // The counter arms the SEAT, not the copy, so every armed Clipped Wings in
      // play or in the graveyard fires on the same purchase. That does NOT stack
      // into a second Pig: each copy re-reads the bottom of the buyer's
      // graveyard, and the first copy has already appended a Cursed Pig there, so
      // the second binds a (0) token, fails `selfCost >= 6` and creates nothing.
      // One Pig per (6)+ purchase however many copies are armed, which is what
      // the row prints.
      {
        on: 'onOpponentBuy',
        zones: ['play', 'gy'],
        condition: { expr: 'clippedWings >= 1' },
        effects: [
          {
            op: 'forEach',
            over: { who: 'activePlayer', zone: 'gy', count: 1, pick: 'bottom' },
            effects: [
              {
                op: 'conditional',
                if: { expr: 'selfCost >= 6' },
                then: [{ op: 'createCard', defId: 'cursed_pig', to: 'gy', who: 'activePlayer' }],
              },
            ],
          },
        ],
      },
    ],
    text: '+1 Action. Until your next turn, an opponent who gains a card costing (6) or more also gains a Cursed Pig.',
    flavor: 'Fly lower. It is safer down here.',
    complexity: 'T3',
    subsystems: ['S-PVP', 'S-TOKEN'],
    shop: 'draft',
    art: { key: 'clipped_wings', status: 'placeholder' },
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
    art: { key: 'baby_witch', status: 'placeholder', anim: 'summon' },
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
      // `recruit` used to carry this because it was the only op that looped the
      // players itself, and it pays for that with an unconditional shuffle of its
      // source zone (B42 / SB-2) — right for a hidden Library, wrong for a hand,
      // whose order zones.ts calls meaningful (B13). `forEach` over one card per
      // opponent (`perPlayer`) is a per-seat effect frame with no zone churn at
      // all: `who:'owner'` names that seat, and `transform` replaces the card in
      // place, so the hand keeps its order and its size.
      //
      // A Discover pool still ignores its own `who` and always prompts the player
      // resolving the card, so the printed "Discovers" — three offered, one
      // picked — is not authorable; the opponent chooses from their whole hand
      // instead. That is more generous to them than a Discover and strictly
      // closer to the row than the old version, which took the top card of their
      // hand with no choice at all.
      {
        op: 'forEach',
        over: { who: 'eachOpponent', zone: 'hand', perPlayer: true, count: 1, pick: 'top' },
        effects: [
          {
            op: 'transform',
            target: { who: 'owner', zone: 'hand', count: 1, pick: 'choose', chooser: 'owner' },
            into: 'cursed_pig',
          },
        ],
      },
    ],
    triggers: [],
    text: 'Each opponent chooses a card in their hand and turns it into a Cursed Pig.',
    flavor: 'She taught the baby everything.',
    complexity: 'T3',
    subsystems: ['S-PVP', 'S-TOKEN'],
    shop: 'draft',
    art: { key: 'mother_witch', status: 'placeholder', anim: 'summon' },
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
    art: { key: 'weasel_turner', status: 'placeholder', anim: 'shuffle' },
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
    art: { key: 'ancient_curse', status: 'placeholder' },
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
    art: { key: 'ancient_curse_echo', status: 'placeholder' },
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
      // `filter.name` is an exact, case-sensitive comparison against def.name, so
      // the regex-shaped string it used to hold matched nothing and the (5)
      // Legendary was a blank. `nameContainsAny` is the substring axis, matched
      // case-insensitively, and the row's letters go in one at a time: M, O, O,
      // S, E collapses to four distinct letters.
      {
        op: 'trash',
        target: { who: 'eachOpponent', zone: 'hand', filter: { nameContainsAny: ['m', 'o', 's', 'e'] } },
      },
    ],
    triggers: [],
    text: 'Trash every card in every opponent’s hand whose name contains any letter of M, O, O, S, E.',
    flavor: 'He has been waiting for this lecture.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'profe_yates_unleashed', status: 'placeholder', anim: 'trash' },
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
      // `wordCountLt` reads the target definition's frozen `wordCount`, falling
      // back to counting whitespace-separated tokens of its text. The bound is
      // this card's own frozen count (SB-30 / doc 10.4), written out rather than
      // read from itself: a card whose rules text is a function of its own
      // rendered length only stays stable because the number never moves.
      { op: 'trash', target: { who: 'eachOpponent', zone: 'hand', filter: { wordCountLt: 16 } } },
    ],
    triggers: [],
    text: 'Trash every card in each opponent’s hand that has fewer words in its text than this.',
    flavor: 'Sixteen. Count them.',
    complexity: 'T4',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'hired_shrimp', status: 'placeholder', anim: 'trash' },
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
          // The whole branch runs in the OPPONENT's frame — a delayed entry is
          // queued per player and resolved with that player as the actor — so
          // `chosenOpponent` was their highest-VP opponent, which in a 3+ player
          // game is a third seat. A delayed entry carries the instance that
          // queued it, so `who:'owner'` is the Pickle's controller from inside
          // anybody's frame. Everything else here is meant to land on the
          // chooser, so it stays unqualified.
          {
            op: 'choose',
            options: [
              { label: '-2 Money', effects: [{ op: 'gain', stat: 'money', amount: -2 }] },
              { label: 'Discard a random card', effects: [{ op: 'discard', target: { zone: 'hand', count: 1, pick: 'random' } }] },
              { label: 'Give the Pickle player a Gold', effects: [{ op: 'createCard', defId: 'gold', to: 'gy', who: 'owner' }] },
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
    art: { key: 'pickle', status: 'placeholder' },
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
      //
      // "The last card an opponent discarded" is the last entry in that
      // graveyard: every route into a GY appends (`moveInstance` defaults to
      // 'bottom'), and end-of-turn cleanup empties the play area BEFORE it
      // discards the hand (turn.ts step 2), so the newest entry after a turn is
      // genuinely the last card discarded and not the last card played.
      // `pick:'bottom'` reads that entry; `pick:'mostExpensive'` was reaching the
      // dearest card anywhere in the pile, which is a much bigger card.
      //
      // The row's "most expensive if several" tie-break is not implemented, and
      // is unreachable from card data. Several cards can be discarded at once —
      // end-of-turn cleanup empties a whole hand (turn.ts step 2) — but the engine
      // applies them one at a time and records nothing about where one batch ends
      // and the next begins, so no selector can range over "the cards discarded
      // together" to find the dearest of them. "The last card discarded" stays
      // exact under that ordering, which is why `pick:'bottom'` is the reading
      // taken. Engine fix: a discard-batch (or discard-sequence) marker written by
      // discardWithTrigger, plus a filter that reads it.
      { op: 'reveal', target: { who: 'chosenOpponent', zone: 'gy', count: 1, pick: 'bottom' } },
      { op: 'copyCard', target: { who: 'chosenOpponent', zone: 'gy', count: 1, pick: 'bottom' }, to: 'gy', who: 'self' },
    ],
    triggers: [],
    text: 'Add a copy of the last card an opponent discarded to your GY. If several, take the most expensive. You see it first.',
    flavor: 'It reaches into the pile and keeps what it finds.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'ebon_hand', status: 'placeholder' },
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
    art: { key: 'rebellion', status: 'placeholder', anim: 'explode' },
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
    art: { key: 'coronation', status: 'placeholder', anim: 'summon' },
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
    art: { key: 'loot_attack', status: 'placeholder', anim: 'coin' },
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
      // A tie is two bets sharing the dearest cost. Binding the dearest through
      // `forEach` makes its cost readable as `selfCost`, and a filter bound may
      // now be an expression, so "how many bets cost exactly that" is a real
      // count. Two or more and everybody antes 3 more cards, which is what the
      // row prints; a second tie after that falls to seat order rather than
      // escalating again, because a `forEach` cannot re-enter itself.
      {
        op: 'forEach',
        over: {
          who: 'eachPlayer',
          zone: 'aside',
          filter: { not: { counter: { key: 'boxed', gte: 1 } } },
          count: 1,
          pick: 'mostExpensive',
        },
        effects: [
          {
            op: 'conditional',
            if: {
              has: {
                target: {
                  who: 'eachPlayer',
                  zone: 'aside',
                  filter: { cost: { eq: { expr: 'selfCost' } }, not: { counter: { key: 'boxed', gte: 1 } } },
                },
                atLeast: 2,
              },
            },
            then: [
              { op: 'recruit', zone: 'library', count: 3, who: 'eachPlayer', to: 'aside' },
              {
                op: 'reveal',
                target: { who: 'eachPlayer', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
              },
            ],
          },
        ],
      },
      // The pot goes to whoever bet the dearest card, whether that is you or not.
      // `forEach` binds that card, and `who:'owner'` on the `moveTo` is the owner
      // it belongs to — the only way card data can name the owner of a selected
      // card, and the reason this used to be written as "the dearest bet goes
      // home, and an empty aside pile of your own means you won".
      {
        op: 'forEach',
        over: {
          who: 'eachPlayer',
          zone: 'aside',
          filter: { not: { counter: { key: 'boxed', gte: 1 } } },
          count: 1,
          pick: 'mostExpensive',
        },
        effects: [
          {
            op: 'moveTo',
            target: { who: 'eachPlayer', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
            zone: 'gy',
            who: 'owner',
          },
        ],
      },
    ],
    triggers: [],
    text: 'Every player antes the top card of their Library. The dearest card takes the whole pot into its owner’s GY. If two or more tie for dearest, every player antes 3 more cards first.',
    flavor: 'War. War never changes the shuffle.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'war', status: 'placeholder', anim: 'explode' },
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
    art: { key: 'edge_of_tomorrow', status: 'placeholder', anim: 'summon' },
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
      //
      // "Any player replaying this resets the timer" is STILL NOT EXPRESSIBLE.
      // The fuse has no single rewritable home: `opDelayed` only ever pushes a
      // new entry onto the player's list, no op clears or reschedules one, and
      // nothing in card data can write `state.hardEndTurn` — so a second Clock
      // adds a second, LATER entry while the first one still fires on time,
      // which is the opposite of a reset. The counter-and-trigger shapes that
      // could fake it all need a way to SET a counter rather than add to one,
      // and every one of them risks the clause that does work.
      { op: 'delayed', when: { inTurns: 3 }, effects: [{ op: 'endGame', reason: 'doomsdayClock' }] },
    ],
    triggers: [],
    text: 'Play on Buy. Flimsy. The game ends 3 turns from now. Any player who plays another Doomsday Clock resets the timer to 3.',
    flavor: 'It is always three turns to midnight.',
    complexity: 'T3',
    subsystems: ['S-ENDGAME', 'S-PVP'],
    shop: 'draft',
    art: { key: 'doomsday_clock', status: 'placeholder', anim: 'explode' },
  },
];

export default cards;
