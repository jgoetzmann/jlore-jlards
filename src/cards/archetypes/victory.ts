/**
 * A.10 — Draft Shop: Victory Point and scoring cards.
 *
 * Slice S7 (cards-archetypes). Tokens owned here: Skyscraper, Cursed Pig, Carat.
 *
 * Authoring rule reminders applied throughout this file:
 *  - Plain stat lines live in `stats`, never in `effects` (Buff/Nerf reads `stats`).
 *  - Variable VP ("+X VP, X = ...") is an effect, because a variable cannot be a
 *    printed stat line.
 *  - `EndOfGame` tagged cards are excluded from running VP and score from a
 *    `gameEnd` trigger instead.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'kwzki_cultist',
    name: 'Kwzki Cultist',
    cost: { money: 2 },
    types: ['Points'],
    subtypes: ['Kwzki'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [{ op: 'gain', stat: 'vp', amount: { expr: 'count(kwzki_cultist)' } }],
    triggers: [],
    text: '+X VP, where X is the number of Kwzki Cultists in your deck.',
    flavor: 'They only make sense in groups.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'kwzki_cultist', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'courtyard_of_squeam',
    name: 'Courtyard of Squeam',
    cost: { money: 2 },
    types: ['Points'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [{ op: 'gain', stat: 'vp', amount: { expr: 'floor(4 - avgCostOfDeck)' } }],
    triggers: [],
    text: '+X VP, where X is floor(4 - the average cost of your deck).',
    flavor: 'Cheap company, cheerful company.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'courtyard_of_squeam', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'library_of_gods',
    name: 'Library of Gods',
    cost: { money: 5 },
    types: ['Points'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [{ op: 'gain', stat: 'vp', amount: { expr: 'ceil(avgCostOfDeck)' } }],
    triggers: [],
    text: '+X VP, where X is ceil(the average cost of your deck).',
    flavor: 'Only the expensive get shelved.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'library_of_gods', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'whale_poaching',
    name: 'Whale Poaching',
    cost: { money: 4 },
    types: ['Points'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [{ op: 'gain', stat: 'vp', amount: { expr: 'floor(deckSize / 12)' } }],
    triggers: [],
    text: '+X VP, where X is floor(your deck size / 12).',
    flavor: 'Bigger boat, bigger haul.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'whale_poaching', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'tnacks_ingenuity',
    name: "Tnack's Ingenuity",
    cost: { money: 4 },
    types: ['Points'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [{ op: 'gain', stat: 'vp', amount: { expr: 'floor(5 - deckSize / 12)' } }],
    triggers: [],
    text: '+X VP, where X is floor(5 - your deck size / 12).',
    flavor: 'Elegance is subtraction.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'tnacks_ingenuity', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'fountain_of_possibilities',
    name: 'Fountain of Possibilities',
    cost: { money: 4 },
    types: ['Points'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [{ op: 'gain', stat: 'vp', amount: { expr: 'floor(uniqueCardsInDeck / 4)' } }],
    triggers: [],
    text: '+X VP, where X is floor(the number of distinct cards in your deck / 4).',
    flavor: 'Variety, then water.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'fountain_of_possibilities', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'marble_columns',
    name: 'Marble Columns',
    cost: { money: 4 },
    types: ['Points'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [{ op: 'gain', stat: 'vp', amount: { expr: 'floor(sdOfDeckCost)' } }],
    triggers: [],
    text: '+X VP, where X is floor(the standard deviation of your deck costs).',
    flavor: 'Uneven heights, even grandeur.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'marble_columns', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'stand_together',
    name: 'Stand Together',
    cost: { money: 9 },
    types: ['Points'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [{ op: 'gain', stat: 'vp', amount: { expr: 'uniqueCardsInDeck' } }],
    triggers: [],
    text: '+X VP, where X is the number of distinct cards in your deck.',
    flavor: 'Nobody is redundant.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'stand_together', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'treasure_vault',
    name: 'Treasure Vault',
    cost: { money: 8 },
    types: ['Points'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [{ op: 'gain', stat: 'vp', amount: { expr: 'ceil(3 + count(diamond))' } }],
    triggers: [],
    text: '+X VP, where X is 3 plus the number of Diamonds in your deck.',
    flavor: 'The door alone cost four.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'treasure_vault', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'monumental_works',
    name: 'Monumental Works',
    cost: { money: 5 },
    types: ['Points'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    // `mostExpensive` ranks by printed cost, which an upgrade never touches, and
    // `selfCounter` sums every counter on the picked card: for a Relic that is
    // its 'playCount' (core/play.ts stamps one per play) on top of its
    // 'upgrades', so the old body paid out at roughly double.
    //
    // `maxRelicUpgrades` is the single reading that satisfies both halves of the
    // doc row: the largest 'upgrades' counter on any Relic in library + hand +
    // gy + play, never the sum across Relics — which is the "no double counting"
    // clause — and never any other counter key.
    effects: [{ op: 'gain', stat: 'vp', amount: { expr: 'maxRelicUpgrades' } }],
    triggers: [],
    text: '+X VP, where X is the number of upgrades on the most upgraded Relic in your deck. No double counting.',
    flavor: 'One monument, many chisels.',
    complexity: 'T3',
    subsystems: ['S-BUFF', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'monumental_works', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'ascendant_spread',
    name: 'Ascendant Spread',
    cost: { money: 2 },
    types: ['Points'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [],
    triggers: [
      {
        on: 'onGain',
        effects: [
          {
            op: 'random',
            branches: [
              { weight: 1, effects: [{ op: 'scoreOnCard', target: { self: true }, amount: 1, secret: true }], displayAs: 'Ascendant Spread is worth 1 or 2 VP.' },
              { weight: 1, effects: [{ op: 'scoreOnCard', target: { self: true }, amount: 2, secret: true }], displayAs: 'Ascendant Spread is worth 1 or 2 VP.' },
            ],
          },
        ],
      },
    ],
    text: 'When you gain this, it secretly becomes worth 1 or 2 VP. Only you know which.',
    flavor: 'Read the cards. Do not show the cards.',
    complexity: 'T3',
    subsystems: ['S-HIDDEN', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'ascendant_spread', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'shuffle' },
  },
  {
    id: 'mercenary_280',
    name: 'Mercenary 280',
    cost: { money: 3 },
    types: ['Action', 'Points'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: { expr: 'max(0, 1 - abs(sumOfDeckCosts - 280))' },
        then: [{ op: 'gain', stat: 'vp', amount: 280 }],
      },
    ],
    triggers: [],
    text: '+280 VP if the sum of the costs of every card in your deck is exactly 280.',
    flavor: 'He does not negotiate. He counts.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'mercenary_280', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
  {
    id: 'oh_mr_lebon',
    name: 'Oh Mr. Lebon',
    cost: { money: 3 },
    types: ['Action', 'Points'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'conditional',
        // `countIn` can only reach your own zones, so the comparison needs a
        // real variable for the tallest opponent Library. No Condition can
        // stand in for it either: `has.atLeast` is a literal number, never an
        // Amount, so a selector over opponent Libraries can never be measured
        // against `libraryHeight`.
        //
        // 'tallestOpponentLibrary' is the max Library height across live
        // opponents (0 at a solo table), so "taller than every opponent's" is
        // one strict comparison. The pre-audit expression collapsed to
        // max(0, libraryHeight) and paid an unconditional +2 VP every play.
        if: { expr: 'libraryHeight > tallestOpponentLibrary' },
        then: [{ op: 'scoreOnCard', target: { self: true }, amount: 2 }],
      },
    ],
    triggers: [],
    text: 'If your Library is taller than every opponent’s, score +2 VP on this card. ({vp} VP so far.)',
    flavor: 'He counts other people’s stacks for a living.',
    complexity: 'T3',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'oh_mr_lebon', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'tilted_towers',
    name: 'Tilted Towers',
    cost: { money: 3 },
    types: ['Points'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { vp: 1 },
    effects: [],
    triggers: [
      {
        on: 'onTrash',
        effects: [
          { op: 'addCounter', target: { self: true }, key: 'trashSurvivals', amount: 1 },
          {
            op: 'conditional',
            if: { expr: 'max(0, selfCounter - 1)' },
            then: [{ op: 'createCard', defId: 'tilted_towers', to: 'gy', statDelta: { vp: 3 } }],
            else: [{ op: 'moveTo', target: { self: true }, zone: 'gy' }],
          },
        ],
      },
    ],
    text: '+1 VP. Survives the first 2 trashings. On the second, it rebuilds worth 3 more VP. ({trashSurvivals} collapses so far.)',
    flavor: 'It leans. It has always leaned.',
    complexity: 'T3',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'tilted_towers', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
  {
    id: 'skyscraper',
    name: 'Skyscraper',
    cost: { money: 3 },
    types: ['Token', 'Points'],
    subtypes: [],
    tags: [],
    rarity: 'token',
    keywords: [],
    stats: {},
    effects: [],
    triggers: [],
    text: 'Worth {vp} VP. Its value was set when The Conglomerate built it.',
    flavor: 'Every floor was a smaller building once.',
    complexity: 'T2',
    subsystems: ['S-TOKEN', 'S-PERSIST'],
    notPurchasable: true,
    art: { key: 'skyscraper', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'the_conglomerate',
    name: 'The Conglomerate',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    effects: [
      { op: 'createCard', defId: 'skyscraper', to: 'gy' },
      // 'vpInHand' sums printed vp plus the accrued 'vp' counter over the WHOLE
      // hand, but only Points cards can be trashed — CardFilter has no VP axis,
      // so "every card worth VP" (Coronation +4, Blood Diamond −5, Rotten Egg
      // −5 …) is not expressible as a target. Left unmatched, the two sets paid
      // for cards that were never consumed: a Coronation held in hand banked a
      // repeatable +4 into every Skyscraper, a Blood Diamond poisoned one for
      // −5 and stayed. So everything the trash below will not take is staged
      // aside for exactly the one node that reads the sum, and the marker
      // counter — not a bare `not: Points` filter — brings back only what this
      // card put there, or a Hand Box's stored cards would be dragged into hand
      // with them.
      {
        op: 'addCounter',
        target: { zone: 'hand', filter: { not: { type: 'Points' } } },
        key: 'conglomerateStaged',
        amount: 1,
      },
      {
        // Indestructible beats every trash source (core/zones.trashInstance), so
        // a Series X Funding sits in hand at −18 VP and would have banked a
        // second −18 onto the Skyscraper. This target is disjoint from the one
        // above — that one is the non-Points cards, this one Points cards — so
        // no card is ever marked twice and the single −1 below clears it.
        op: 'addCounter',
        target: { zone: 'hand', filter: { type: 'Points', keyword: 'Indestructible' } },
        key: 'conglomerateStaged',
        amount: 1,
      },
      {
        op: 'moveTo',
        target: { zone: 'hand', filter: { counter: { key: 'conglomerateStaged', gte: 1 } } },
        zone: 'aside',
      },
      {
        // `bottom` is the Skyscraper this play just appended; `top` would score
        // onto an older one. The amount is a VP *sum*, which no card count can
        // express: countIn counts cards, and paying +1 per Points card would
        // turn every -1 VP card (Cursed Pig, Garlic, Chopped Chuzz) into +1.
        //
        // 'vpInHand' sums printed vp plus the accrued 'vp' counter — the same
        // two terms core/scoring.vpOnInstance adds — and with the hand narrowed
        // to Points cards it is exactly the total of what the trash below takes.
        op: 'scoreOnCard',
        target: { zone: 'gy', filter: { defId: 'skyscraper' }, count: 1, pick: 'bottom' },
        amount: { expr: 'vpInHand' },
      },
      {
        op: 'moveTo',
        target: { zone: 'aside', filter: { counter: { key: 'conglomerateStaged', gte: 1 } } },
        zone: 'hand',
      },
      // Clear the marker: `selfCounter` sums every counter key, so a leftover
      // staging mark would inflate any card that reads it.
      {
        op: 'addCounter',
        target: { zone: 'hand', filter: { counter: { key: 'conglomerateStaged', gte: 1 } } },
        key: 'conglomerateStaged',
        amount: -1,
      },
      { op: 'trash', target: { zone: 'hand', filter: { type: 'Points' } } },
    ],
    triggers: [],
    text: '+1 Action, +1 Card. Trash every Points card in your hand and add a Skyscraper worth their total VP to your GY.',
    flavor: 'Merged, floor by floor.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'the_conglomerate', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'master_of_jlore',
    name: 'Master of Jlore',
    cost: { money: 12 },
    types: ['Action', 'Points'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1, cards: 1, vp: 3 },
    effects: [{ op: 'createCard', defId: 'jlore', to: 'gy' }],
    triggers: [],
    text: '+1 Action, +1 Card, +3 VP. Add a Jlore to your GY.',
    flavor: 'Mastery is just owning more of it.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'master_of_jlore', status: 'final', artist: 'LCM Dreamshaper v7' },
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
    // `meta/scoring.ts` has a scorer that walks the run properly, but it is only
    // reached through meta `liveVp`; `core/endgame.finishGame` fires gameEnd
    // triggers and then scores through `core/scoring.computeScores`. So the
    // payout rides the gameEnd trigger like every other End of Game card, and
    // meta's `scoreFor` skips Constellation's triggers, so neither route double
    // counts. `longestCostRun` is an EXPR_VAR because the run is a property of
    // the deck's cost set, not a card count any filter can name.
    //
    // The run has to be trashed one card per rung: `pick: 'cheapest'` for X
    // cards ate the (0) cost cards and left the run standing. `repeat` binds `x`
    // to 0…X-1 and `times` is read once, before the first trash, so the body
    // trashes exactly one card of cost (1), one of (2), … one of (X).
    triggers: [
      {
        on: 'gameEnd',
        effects: [
          { op: 'gain', stat: 'vp', amount: { expr: 'longestCostRun' } },
          {
            op: 'repeat',
            times: { expr: 'longestCostRun' },
            effects: [
              {
                op: 'trash',
                target: {
                  who: 'self',
                  zone: ['library', 'hand', 'gy', 'play'],
                  filter: { cost: { eq: { expr: 'x + 1' } } },
                  count: 1,
                },
              },
            ],
          },
        ],
      },
    ],
    text: 'End of Game. For each Constellation: trash the longest unbroken run of cards costing (1), (2), ... (X) and gain +X VP. Not counted in your running VP.',
    flavor: 'Draw the line between them and it means something.',
    complexity: 'T4',
    subsystems: ['S-ENDGAME'],
    shop: 'draft',
    art: { key: 'constellation', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
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
            op: 'conditional',
            if: { expr: 'max(0, 1 - abs(count(cost7) - 7))' },
            then: [{ op: 'gain', stat: 'vp', amount: 7 }],
          },
        ],
      },
    ],
    text: 'End of Game. +7 VP if exactly 7 cards in your deck cost (7). Not counted in your running VP.',
    flavor: 'Seven, seven, seven. No more, no fewer.',
    complexity: 'T3',
    subsystems: ['S-ENDGAME'],
    shop: 'draft',
    art: { key: 'star_aligner', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'fist_of_jraxxus',
    name: 'Fist of Jraxxus',
    cost: { money: 4 },
    types: ['Action', 'Points'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { money: 2, vp: 1 },
    effects: [],
    triggers: [{ on: 'onDiscard', effects: [{ op: 'gain', stat: 'money', amount: 2 }] }],
    text: '+2 Money, +1 VP. When you discard this, +2 Money.',
    flavor: 'It pays whether it lands or not.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'fist_of_jraxxus', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
  {
    id: 'carat',
    name: 'Carat',
    cost: { money: 1 },
    types: ['Action', 'Food', 'Token', 'Points'],
    subtypes: ['Carrot'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { money: 1, vp: 1 },
    effects: [],
    triggers: [],
    text: 'Flimsy. +1 Money, +1 VP.',
    flavor: 'A carrot, weighed as a gem.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'carat', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'bullseye',
    name: 'Bullseye',
    cost: { money: 3 },
    types: ['Points'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { vp: 1 },
    effects: [],
    triggers: [
      {
        on: 'onDiscard',
        effects: [
          {
            op: 'forEach',
            over: { zone: 'hand', filter: { cost: { lte: 1 } } },
            effects: [
              {
                // Without `perPlayer` a Selector pools every opponent hand into
                // one list and `count: 1` Nerfs one card table-wide; with it the
                // count-and-pick runs once per live opponent, which is what "one
                // card in each opponent's hand" means. The guard stays because
                // `nerf` falls back to the source instance when its selector
                // resolves to nothing, so an empty table would Nerf Bullseye.
                op: 'conditional',
                if: { has: { target: { who: 'eachOpponent', zone: 'hand' }, atLeast: 1 } },
                then: [
                  {
                    op: 'nerf',
                    scope: 'instance',
                    target: { who: 'eachOpponent', zone: 'hand', count: 1, pick: 'random', perPlayer: true },
                  },
                ],
              },
            ],
          },
          { op: 'trash', target: { zone: 'hand', filter: { cost: { lte: 1 } } } },
        ],
      },
    ],
    text: '+1 VP. When you discard this: trash every card in your hand costing (1) or less, and Nerf one card in each opponent’s hand per card trashed.',
    flavor: 'Dead centre, every time.',
    complexity: 'T3',
    subsystems: ['S-BUFF'],
    shop: 'draft',
    art: { key: 'bullseye', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'mass_production',
    name: 'Mass Production',
    cost: { money: 1 },
    types: ['Action', 'Points'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 2, cards: 2, vp: -1 },
    effects: [{ op: 'copyCard', target: { self: true }, to: 'gy' }],
    triggers: [],
    text: '+2 Actions, +2 Cards, -1 VP. Add a copy of this to your GY.',
    flavor: 'Scale first. Quality is a later problem.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'mass_production', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'garlic',
    name: 'Garlic',
    cost: { money: 0 },
    types: ['Action', 'Points', 'Food'],
    subtypes: ['Garlic'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { vp: -1 },
    effects: [],
    triggers: [{ on: 'onTrash', effects: [{ op: 'gain', stat: 'money', amount: 7 }] }],
    text: '-1 VP. When this is trashed, +7 Money.',
    flavor: 'Worth more crushed.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'garlic', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'lotto_ticket',
    name: 'Lotto Ticket',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      { op: 'createCard', defId: 'tix', to: 'library', position: 'random' },
      { op: 'shuffle', zone: 'library' },
      // Recruited aside first, so `selfCost` reads the card that was actually
      // drawn. Recruiting straight to hand and re-scanning it paid out on the
      // most expensive Points card already there, and paid even when the
      // Library held none.
      { op: 'recruit', zone: 'library', filter: { type: 'Points' }, count: 1, to: 'aside' },
      {
        op: 'forEach',
        over: { zone: 'aside', filter: { type: 'Points' } },
        effects: [
          { op: 'gain', stat: 'money', amount: { expr: 'selfCost' } },
          { op: 'moveTo', target: { self: true }, zone: 'hand' },
        ],
      },
    ],
    triggers: [],
    text: 'Shuffle a Tix into your Library, then draw a Points card from it and gain Money equal to that card’s cost.',
    flavor: 'Somebody has to win.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'lotto_ticket', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'shuffle' },
  },
  {
    id: 'tixatus',
    name: 'Tixatus',
    cost: { money: 6 },
    types: ['Action', 'Points'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['PlayOnBuy'],
    stats: { vp: 4 },
    effects: [
      { op: 'moveTo', target: { zone: 'library', count: 5, pick: 'top' }, zone: 'aside' },
      {
        op: 'forEach',
        over: { zone: 'aside', filter: { defId: 'tix' } },
        effects: [
          { op: 'gain', stat: 'money', amount: 1 },
          {
            // Inside a forEach `{self:true}` is the iterated Tix, which the next
            // node trashes — the VP has to be named onto Tixatus itself.
            op: 'scoreOnCard',
            target: { zone: ['play', 'gy'], filter: { defId: 'tixatus' }, count: 1, pick: 'lastPlayed' },
            amount: 1,
          },
        ],
      },
      { op: 'trash', target: { zone: 'aside' } },
    ],
    triggers: [],
    text: 'Play on Buy. +4 VP. Trash the top 5 cards of your Library. For each Tix trashed, +1 Money and score +1 VP on this card. ({vp} VP scored.)',
    flavor: 'It eats tickets and grows.',
    complexity: 'T3',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'tixatus', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'squire_of_j',
    name: 'Squire of J',
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
        if: { has: { target: { zone: 'hand', filter: { defId: 'jlore' } }, atLeast: 1 } },
        then: [
          { op: 'discard', target: { zone: 'hand', filter: { defId: 'jlore' }, count: 1, pick: 'choose' } },
          { op: 'gain', stat: 'money', amount: 4 },
        ],
      },
    ],
    triggers: [],
    text: 'Discard a Jlore for +4 Money.',
    flavor: 'He carries it. He does not own it.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'squire_of_j', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'lord_of_j',
    name: 'Lord of J',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { zone: 'hand', filter: { defId: 'jlore' } }, atLeast: 1 } },
        then: [
          { op: 'discard', target: { zone: 'hand', filter: { defId: 'jlore' }, count: 1, pick: 'choose' } },
          { op: 'createCard', defId: 'jlore', to: 'gy' },
        ],
      },
    ],
    triggers: [],
    text: 'Discard a Jlore to add a Jlore to your GY.',
    flavor: 'Lordship is laundering, slowly.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'lord_of_j', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'purple_rain',
    name: 'Purple Rain',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'forEach',
        over: { zone: 'hand', filter: { rarity: 'epic' } },
        effects: [
          {
            op: 'random',
            branches: [
              { weight: 1, effects: [{ op: 'createCard', defId: 'tix', to: 'gy' }] },
              { weight: 1, effects: [{ op: 'createCard', defId: 'robux', to: 'gy' }] },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'For each Epic card in your hand, add a Tix or a Robux at random to your GY.',
    flavor: 'It only ever falls on the rich.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'purple_rain', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'iced_up',
    name: 'Iced Up',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        // "Any number" has to include none, so `min: 0` is the printed wording.
        // A forEach asking for handSize Rares always wants every Rare in hand,
        // which made the discard mandatory; the interim `choose` wrapper printed
        // a "discard nothing" option the card does not have. `localResume` now
        // runs a per-choice `then` zero times when nothing is picked, so
        // declining no longer discards Iced Up itself and pays out.
        op: 'selectCards',
        from: { zone: 'hand', filter: { rarity: 'rare' } },
        min: 0,
        max: { expr: 'handSize' },
        then: [
          { op: 'discard', target: { self: true } },
          { op: 'gain', stat: 'money', amount: 2 },
        ],
      },
    ],
    triggers: [],
    text: 'Discard any number of Rare cards from your hand. +2 Money for each.',
    flavor: 'Every chain, every finger.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'iced_up', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'yuyas_embrace',
    name: "Yuya's Embrace",
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'discover',
        pool: { scope: 'knownUniverse', filter: { type: 'Points' } },
        count: 3,
        pick: 1,
        prompt: 'Discover a Points card.',
        // '$discovered' is the card the player actually picked. Re-sampling the
        // pool here handed out a fourth, unrelated card.
        then: [{ op: 'createCard', defId: '$discovered', to: 'gy' }],
      },
    ],
    triggers: [],
    text: 'Flimsy. Discover a Points card from your Known Universe and add it to your GY.',
    flavor: 'She holds on until it scores.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'yuyas_embrace', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'chopped_chuzz',
    name: 'Chopped Chuzz',
    cost: { money: -1 },
    types: ['Points'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { vp: -1 },
    // The anti-fusion clause still has no working card-level hook. `opFuse`
    // (effects/ops/movement.ts) fires `onFuse` on each component and then, in
    // the same synchronous pass, keeps every component whose zone has not
    // changed — but `fireEvent` only ENQUEUES trigger effects, so an
    // `onFuse: [{op:'trash', target:{self:true}}]` runs after the merge is
    // already committed. Verified on a two-card fusion: the composite forms
    // either way, and when Chuzz happens to be the first component the late
    // trash destroys the whole fused card instead of just refusing. Shipping
    // that trigger would diverge further than leaving the clause unimplemented,
    // so the card carries only its printed text and its onTrash payout until
    // `opFuse` resolves onFuse inline (or drops flagged defIds itself).
    effects: [],
    triggers: [{ on: 'onTrash', effects: [{ op: 'gain', stat: 'actions', amount: 3 }] }],
    text: '-1 VP. When this attempts to Fuse, it is trashed instead. When trashed, +3 Actions.',
    flavor: 'It does not fuse. It scatters.',
    complexity: 'T3',
    subsystems: ['S-FUSE'],
    shop: 'draft',
    art: { key: 'chopped_chuzz', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'cursed_pig',
    name: 'Cursed Pig',
    cost: { money: 0 },
    types: ['Token', 'Points'],
    subtypes: [],
    tags: [],
    rarity: 'token',
    keywords: [],
    stats: { vp: -1 },
    effects: [],
    triggers: [],
    text: '-1 VP.',
    flavor: 'It followed you home. It is staying.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'cursed_pig', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'virtual_bank_robbery',
    name: 'Virtual Bank Robbery',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      { op: 'createCard', defId: 'robux', to: 'gy' },
      { op: 'createCard', defId: 'tix', to: 'gy' },
    ],
    triggers: [],
    text: 'Flimsy. Add a Robux and a Tix to your GY.',
    flavor: 'No vault, no guards, no witnesses.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'virtual_bank_robbery', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
];

export default cards;
