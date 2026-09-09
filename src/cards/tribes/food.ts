/**
 * A.16 — Food, Distilled and Grapes.
 *
 * Food tokens are cheap Flimsy Actions that pay out immediately. The Distilled
 * line is what Food becomes when it is discarded rather than played, and the
 * Grape line is Grapevine's weighted drop table made into cards.
 *
 * SB-30 is applied here: the token is `fruit_gummy` / "Fruit Gummy", never
 * "Fuit Gummy".
 */
import type { CardDefinition, EffectNode, PoolSpec, Rarity } from '@engine/types';

const foodPool: { pool: PoolSpec } = { pool: { catalog: 'food' } };

/** Grapevine's drop table: 79% normal, 20% big, 1% golden. */
const grapeDrop = (): EffectNode => ({
  op: 'random',
  branches: [
    { weight: 79, effects: [{ op: 'createCard', defId: 'grape', to: 'gy', count: 1 }], displayAs: 'a Grape' },
    { weight: 20, effects: [{ op: 'createCard', defId: 'big_grape', to: 'gy', count: 1 }], displayAs: 'a Big Grape' },
    {
      weight: 1,
      effects: [{ op: 'createCard', defId: 'golden_grape', to: 'gy', count: 1 }],
      displayAs: 'a Golden Grape',
    },
  ],
});

/** Fruit Gummy pays +1 Action per distinct rarity sitting in your hand. */
const RARITIES: Rarity[] = ['basic', 'token', 'common', 'rare', 'epic', 'legendary', 'mythic'];
const rarityCheck = (r: Rarity): EffectNode => ({
  op: 'conditional',
  if: { has: { target: { zone: 'hand', filter: { rarity: r } }, atLeast: 1 } },
  then: [{ op: 'gain', stat: 'actions', amount: 1 }],
});

export const cards: CardDefinition[] = [
  // -------------------------------------------------------------------------
  // Food tokens
  // -------------------------------------------------------------------------
  {
    id: 'gruel',
    name: 'Gruel',
    cost: { money: 0 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: {},
    effects: [],
    triggers: [],
    text: 'Flimsy. It does nothing. It is gruel.',
    flavor: 'Warm, grey, technically food.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'gruel', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'crumb',
    name: 'Crumb',
    cost: { money: 1 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 1, cards: 1, money: 1 },
    effects: [],
    triggers: [],
    text: 'Flimsy. +1 Action, +1 Card, +1 Money.',
    flavor: 'The best part of the cookie, arguably.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'crumb', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'brownie',
    name: 'Brownie',
    cost: { money: 1 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 1, cards: 2 },
    // A.16: "Flimsy - loses Flimsy if on the edge of your hand". §2.1 hand
    // adjacency: `playCard` stamps `handEdge` before the card leaves the hand,
    // readable here as `selfHandEdge`, so the corner piece can be told from a
    // middle one. The strip lands before step 8's Flimsy cleanup, so an edge
    // Brownie survives into play while a middle one still trashes.
    //
    // The row is a per-play test, so the strip has to be per-play too.
    // `{setKeyword, on:false}` pushes into `removedKeywords` and nothing ever
    // clears it, so a strip-only clause made the FIRST edge play permanent:
    // an edge Brownie that survived into the GY came back and kept Flimsy off
    // from the middle of the hand for the rest of the game. The else branch
    // puts it back.
    //
    // Re-granting blind would be worse than the bug — `on:true` clears
    // `removedKeywords`, so a middle Brownie would undo a Card Sleeve that had
    // legitimately taken Flimsy off it. So the re-grant is gated on this
    // instance's own mark: `counter` is set to 1 by the strip and back to 0 by
    // the re-grant, and only a Brownie carrying its own mark puts Flimsy back.
    // A Sleeve-stripped Brownie that never played from an edge has no mark and
    // is left alone; a Sleeve landing on top of an edge Brownie's own strip is
    // the one case the mark cannot tell apart, and the next middle play does
    // put Flimsy back. `counter` is primed at 0 first because `selfCounter`
    // falls back to the SUM of an instance's counters when none of the named
    // keys exist, and `playCard` has already stamped `handIndex`,
    // `handSizeAtPlay` and `handEdge` on this instance by the time the body
    // runs — that sum is never 0, so an unprimed read would claim a mark that
    // was never set.
    effects: [
      { op: 'addCounter', target: { self: true }, key: 'counter', amount: 0 },
      {
        op: 'conditional',
        if: { expr: 'selfHandEdge' },
        then: [
          { op: 'setKeyword', target: { self: true }, keyword: 'Flimsy', on: false },
          { op: 'addCounter', target: { self: true }, key: 'counter', amount: { expr: '1 - selfCounter' } },
        ],
        else: [
          {
            op: 'conditional',
            if: { expr: 'selfCounter >= 1' },
            then: [
              { op: 'setKeyword', target: { self: true }, keyword: 'Flimsy', on: true },
              { op: 'addCounter', target: { self: true }, key: 'counter', amount: { expr: '0 - selfCounter' } },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Flimsy — loses Flimsy if on the edge of your hand. +2 Cards, +1 Action.',
    flavor: 'Corner piece.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-PERSIST'],
    notPurchasable: true,
    art: { key: 'brownie', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'banana',
    name: 'Banana',
    cost: { money: 1 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [
      {
        op: 'discover',
        pool: { scope: 'knownUniverse', filter: { cost: { lte: 1 } } },
        count: 3,
        pick: 1,
        then: [],
        prompt: 'Discover a card costing (1) or less',
      },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action. Discover a Known Universe card costing (1) or less.',
    flavor: 'Potassium and opportunity.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-CODEX'],
    notPurchasable: true,
    art: { key: 'banana', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'rosemary_triscuit',
    name: 'Rosemary Triscuit',
    cost: { money: 1 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      { op: 'createCard', defId: 'crumb', to: 'gy', count: 1 },
      {
        op: 'delayed',
        when: { inTurns: 3 },
        effects: [{ op: 'createCard', defId: 'gold', to: 'gy', count: 3 }],
      },
    ],
    triggers: [],
    text: 'Flimsy. Add a Crumb to your GY. In 3 turns, add 3 Gold to your GY.',
    flavor: 'It keeps.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'rosemary_triscuit', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'fruit_gummy',
    name: 'Fruit Gummy',
    cost: { money: 2 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: {},
    effects: RARITIES.map(rarityCheck),
    triggers: [],
    text: 'Flimsy. +1 Action for each distinct rarity present in your hand.',
    flavor: 'Every colour is the same flavour.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-EFFECTS'],
    notPurchasable: true,
    art: { key: 'fruit_gummy', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'matcha',
    name: 'Matcha',
    cost: { money: 2 },
    types: ['Action', 'Token', 'Food'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 4, money: -2 },
    effects: [],
    triggers: [],
    text: 'Flimsy. +4 Actions, −2 Money.',
    flavor: 'Ceremonial grade. Ceremonial price.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'matcha', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'boba',
    name: 'Boba',
    cost: { money: 2 },
    types: ['Action', 'Token', 'Food'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 3, money: -2 },
    effects: [{ op: 'createCard', defId: 'felinor', to: 'hand', count: 1 }],
    triggers: [],
    text: 'Flimsy. +3 Actions, −2 Money. Add a Felinor to your hand.',
    flavor: 'Extra pearls, extra cat.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'boba', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'slop_bowl',
    name: 'Slop Bowl',
    cost: { money: 3 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 4 },
    effects: [],
    triggers: [],
    text: 'Flimsy. Big Action 2. +4 Actions.',
    flavor: 'A bowl. Of slop.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-BIGACTION'],
    notPurchasable: true,
    bigAction: 2,
    art: { key: 'slop_bowl', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'combo_meal',
    name: 'Combo Meal',
    cost: { money: 2 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 2 },
    effects: [{ op: 'conditional', if: { combo: 2 }, then: [{ op: 'gain', stat: 'actions', amount: 1 }] }],
    triggers: [],
    text: 'Flimsy. +2 Actions. Combo 2: +1 Action.',
    flavor: 'Would you like to make that a combo?',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-COMBO'],
    notPurchasable: true,
    art: { key: 'combo_meal', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'huckleberry',
    name: 'Huckleberry',
    cost: { money: 3 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    // An omitted `count` on `recruit` means ONE, not "all matches" the way it
    // does on a Selector, so "draw all Food" needs an explicit ceiling. The
    // Library height is that ceiling: `recruit` only takes cards that match.
    effects: [
      { op: 'recruit', zone: 'library', filter: { type: 'Food' }, to: 'hand', count: { expr: 'libraryHeight' } },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action. Draw every Food card in your Library.',
    flavor: 'I am your huckleberry.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'huckleberry', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  // Milkshake lives in `economy/draw.ts`: A.7 prices it at (4) and rates it
  // Rare, so it is a purchasable draw card, not a generated Food token.
  {
    id: 'slice_of_bread',
    name: 'Slice of Bread',
    cost: { money: 2 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [
      { op: 'moveTo', target: { zone: 'library', count: 1, pick: 'mostExpensive' }, zone: 'hand' },
      { op: 'createCard', defId: 'crumb', to: 'gy', count: 1 },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action. Draw the most expensive card in your Library. Add a Crumb to your GY.',
    flavor: 'The heel, if we are honest.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'slice_of_bread', status: 'final', artist: 'LCM Dreamshaper v7' },
  },

  // -------------------------------------------------------------------------
  // Distilled line
  // -------------------------------------------------------------------------
  {
    id: 'distilled_potato',
    name: 'Distilled Potato',
    cost: { money: 4 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food', 'Distilled'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 2, cards: 4 },
    effects: [
      {
        op: 'delayed',
        when: 'endOfTurn',
        effects: [
          { op: 'trash', target: { zone: 'hand' } },
          // `count` is a TOTAL across everyone `who` reached, so without
          // `perPlayer` this pooled every opponent's hand and took a single card
          // from one of them — correct only at two players. `perPlayer` runs the
          // count-and-pick once per opponent, which is the printed line.
          {
            op: 'trash',
            target: { who: 'eachOpponent', zone: 'hand', count: 1, pick: 'random', perPlayer: true },
          },
        ],
      },
    ],
    triggers: [],
    text: 'Flimsy. +2 Actions, +4 Cards. At end of turn, trash your hand and one random card from each opponent’s hand.',
    flavor: 'Ninety proof, still a potato.',
    complexity: 'T3',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'distilled_potato', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'distilled_gluten',
    name: 'Distilled Gluten',
    cost: { money: 1 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food', 'Distilled'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 2, cards: 1 },
    // Same pooling trap as Distilled Potato: `pick: 'cheapest'` over the union of
    // every hand trashed one card overall. `perPlayer` resolves the cheapest card
    // in each player's hand separately.
    effects: [
      {
        op: 'trash',
        target: { who: 'eachPlayer', zone: 'hand', count: 1, pick: 'cheapest', perPlayer: true },
      },
    ],
    triggers: [],
    text: 'Flimsy. +2 Actions, +1 Card. Trash the cheapest card in each player’s hand.',
    flavor: 'Gluten free, in the sense that it is now free of you.',
    complexity: 'T3',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'distilled_gluten', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'distilled_grape',
    name: 'Distilled Grape',
    cost: { money: 2 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food', 'Distilled', 'Grape'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 1, cards: 1, money: 2 },
    effects: [
      {
        op: 'playCard',
        target: { zone: 'hand', filter: { type: 'Action' }, count: 2, pick: 'random' },
        randomTargets: true,
        thenTrash: true,
      },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action, +1 Card, +2 Money. Play 2 random Actions in your hand, then trash them.',
    flavor: 'Vintage: last Tuesday.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-EFFECTS'],
    notPurchasable: true,
    art: { key: 'distilled_grape', status: 'final', artist: 'LCM Dreamshaper v7' },
  },

  // -------------------------------------------------------------------------
  // Grape line
  // -------------------------------------------------------------------------
  {
    id: 'grape',
    name: 'Grape',
    cost: { money: 1 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food', 'Grape'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 1, cards: 1 },
    effects: [
      {
        op: 'playCard',
        target: { zone: 'hand', filter: { type: 'Action' }, count: 1, pick: 'random' },
        randomTargets: true,
      },
    ],
    triggers: [
      {
        on: 'onDiscard',
        effects: [{ op: 'transform', target: { self: true }, into: 'distilled_grape' }],
      },
    ],
    text: 'Flimsy. +1 Action, +1 Card. Play a random Action in your hand. When discarded, becomes a Distilled Grape.',
    flavor: 'Sour on the way in.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-EFFECTS'],
    notPurchasable: true,
    art: { key: 'grape', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'big_grape',
    name: 'Big Grape',
    cost: { money: 5 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food', 'Grape'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 1, cards: 1 },
    effects: [
      {
        op: 'playCard',
        target: { zone: 'hand', filter: { type: 'Action' }, pick: 'random' },
        randomTargets: true,
      },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action, +1 Card. Play every Action in your hand, in random order.',
    flavor: 'Structurally, a plum.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-EFFECTS'],
    notPurchasable: true,
    art: { key: 'big_grape', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'golden_grape',
    name: 'Golden Grape',
    cost: { money: 6 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['Food', 'Grape', 'Gold'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 1, cards: 1, money: 3 },
    effects: [
      {
        op: 'playCard',
        target: { zone: 'hand', filter: { type: 'Action', rarity: 'legendary' }, count: 1, pick: 'random' },
        randomTargets: true,
      },
    ],
    triggers: [
      {
        on: 'onDiscard',
        effects: [
          {
            op: 'createCard',
            defId: { pool: { scope: 'entireUniverse', filter: { rarity: 'legendary' } } },
            to: 'gy',
            count: 1,
          },
        ],
      },
    ],
    text: 'Flimsy. +1 Action, +1 Card, +3 Money. Play a random Legendary Action. When discarded, add a random Legendary to your GY.',
    flavor: 'Willy would be proud.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-EFFECTS'],
    notPurchasable: true,
    art: { key: 'golden_grape', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },

  // -------------------------------------------------------------------------
  // Draft Shop Food cards
  // -------------------------------------------------------------------------
  {
    id: 'loaf_of_bread',
    name: 'Loaf of Bread',
    cost: { money: 3 },
    types: ['Action', 'Food'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      // §2.1 hand adjacency. `playCard` marks the two cards this one sat
      // between with `sandwich = 1` before it leaves the hand, and clears stale
      // marks first, so the filter names exactly the neighbours of the Loaf
      // resolving right now. A `pick:'choose'` over the whole hand used to
      // stand in for this, letting the player pick any two cards in hand,
      // which is a strictly better card than the row prints. No `count`: the
      // mark selects at most two, and a Loaf on the edge of the hand has only
      // a single neighbour to play.
      {
        op: 'playCard',
        target: { who: 'self', zone: 'hand', filter: { counter: { key: 'sandwich', gte: 1 } } },
      },
      { op: 'createCard', defId: 'slice_of_bread', to: 'gy', count: 1 },
    ],
    triggers: [],
    text: 'Flimsy. Also play the cards sandwiching this in hand. Add a Slice of Bread to GY.',
    flavor: 'Everything between the ends.',
    complexity: 'T3',
    subsystems: ['S-EFFECTS'],
    shop: 'draft',
    art: { key: 'loaf_of_bread', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'potato',
    name: 'Potato',
    cost: { money: 2 },
    types: ['Action', 'Food'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { actions: 1, cards: 3 },
    effects: [],
    triggers: [
      {
        on: 'onDiscard',
        effects: [{ op: 'transform', target: { self: true }, into: 'distilled_potato' }],
      },
    ],
    text: 'Flimsy. +1 Action, +3 Cards. When discarded, transforms into a Distilled Potato.',
    flavor: 'Left in the cupboard long enough, it becomes ambitious.',
    complexity: 'T3',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'potato', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'grapevine',
    name: 'Grapevine',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      // The vintage is kept under the key `counter`, and seeded here, because
      // `selfCounter` is the SUM of every counter on the instance unless a key
      // named counter/uses/charges exists — and `playCard` has already written
      // `playCount` by the time effects run, which inflated a fresh Grapevine
      // from 4 Grapes to 6. Seeding at amount 0 creates the key on the first
      // play, so an undiscarded Grapevine drops the printed 4.
      { op: 'addCounter', target: { self: true }, key: 'counter', amount: 0 },
      { op: 'repeat', times: { expr: '4 + selfCounter * 2' }, effects: [grapeDrop()] },
    ],
    triggers: [
      {
        on: 'onDiscard',
        effects: [{ op: 'addCounter', target: { self: true }, key: 'counter', amount: 1 }],
      },
    ],
    text: 'Flimsy. Add 4 Grapes to your GY, plus 2 more for each time it has been discarded ({counter} so far) — 79% Grape, 20% Big Grape, 1% Golden Grape.',
    flavor: 'Heard it through.',
    complexity: 'T3',
    subsystems: ['S-PERSIST', 'S-EFFECTS'],
    shop: 'draft',
    art: { key: 'grapevine', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'fruit_basket',
    name: 'Fruit Basket',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { actions: 1 },
    effects: [{ op: 'createCard', defId: foodPool, to: 'hand', count: 1 }],
    triggers: [],
    text: '+1 Action. Add a random Food to your hand.',
    flavor: 'Nobody ever eats the pear.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'fruit_basket', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'hearty_meal',
    name: 'Hearty Meal',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [{ op: 'createCard', defId: foodPool, to: 'hand', count: 3 }],
    triggers: [],
    text: 'Flimsy. +1 Action. Add 3 random Foods to your hand.',
    flavor: 'Sit down. Eat.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'hearty_meal', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'house_party',
    name: 'House Party',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { actions: 1, money: -1 },
    effects: [
      { op: 'createCard', defId: { pool: { catalog: 'food', filter: { subtype: 'Distilled' } } }, to: 'hand', count: 1 },
      { op: 'createCard', defId: foodPool, to: 'hand', count: 2 },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action, −1 Money. Add 3 random Foods to your hand; at least one is Distilled.',
    flavor: 'Someone brought their own.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'house_party', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'cornucopia',
    name: 'Cornucopia',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [],
    triggers: [
      {
        on: 'endOfTurn',
        zones: ['play', 'hand'],
        // The doc gate is "if you used no Buys", which is exactly
        // `buysUsedThisTurn` — now an EXPR_VAR, filled from PlayerState in
        // buildVars. The two earlier readings are both gone: `cardsGainedThisTurn`
        // counted every minted token, so a Food deck blanked this with zero Buys
        // spent, and `buysRemaining >= 1` diverged on a turn that granted an extra
        // Buy and spent one. `resetTurnStats` zeroes the counter at the START of a
        // turn, so it is still live while endOfTurn triggers run.
        condition: { expr: 'buysUsedThisTurn == 0' },
        effects: [
          { op: 'createCard', defId: foodPool, to: 'library', count: 10, position: 'random' },
          { op: 'shuffle', zone: 'library' },
        ],
        maxPerTurn: 1,
      },
    ],
    text: 'At end of turn, if you used no Buys, shuffle 10 random Foods into your Library.',
    flavor: 'It refills while you are looking at it.',
    complexity: 'T3',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'cornucopia', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'shuffle' },
  },
  {
    id: 'miracle_fruit',
    name: 'Miracle Fruit',
    cost: { money: 10 },
    types: ['Action', 'Food'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'legendary',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'discover',
        pool: { catalog: 'miracle' },
        count: 3,
        pick: 1,
        then: [],
        prompt: 'Discover a Miracle',
      },
    ],
    triggers: [],
    text: 'Flimsy. Discover a Miracle.',
    flavor: 'Everything tastes sweet afterwards.',
    complexity: 'T3',
    subsystems: ['S-EFFECTS'],
    shop: 'draft',
    art: { key: 'miracle_fruit', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'blueberry_pie',
    name: 'Blueberry Pie',
    cost: { money: 7 },
    types: ['Action', 'Food'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'createCard',
        defId: { pool: { scope: 'knownUniverse', filter: { rarity: 'rare', type: 'Action' } } },
        to: 'hand',
        count: 3,
      },
    ],
    triggers: [],
    text: 'Flimsy. Add 3 random Rare Actions from your Known Universe to your hand.',
    flavor: 'Three slices, one for each of you.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'blueberry_pie', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'jmart_banana_bunch',
    name: 'Jmart Banana Bunch',
    cost: { money: 5 },
    types: ['Action', 'Food'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'rare',
    keywords: ['Temporary'],
    stats: {},
    effects: [
      { op: 'createCard', defId: 'banana', to: 'hand', count: 5 },
      {
        op: 'nerf',
        scope: 'instance',
        target: { zone: 'hand', filter: { defId: 'banana' }, count: 2, pick: 'random' },
        times: 1,
      },
    ],
    triggers: [],
    text: 'Temporary. Add 5 Bananas to your hand, then Nerf some of them at random.',
    flavor: 'Bulk fruit, bulk regret.',
    complexity: 'T3',
    subsystems: ['S-BUFF', 'S-TOKEN'],
    shop: 'draft',
    art: { key: 'jmart_banana_bunch', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'conjure_rosemary_triscuits',
    name: 'Conjure Rosemary Triscuits',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [{ op: 'createCard', defId: 'rosemary_triscuit', to: 'hand', count: 2 }],
    triggers: [],
    text: 'Add 2 Rosemary Triscuits to your hand.',
    flavor: 'A modest spell.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'conjure_rosemary_triscuits', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'better_budder',
    name: 'Better Budder',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'transform', target: { zone: 'hand', filter: { type: 'Food' } }, into: 'gold' },
      { op: 'transform', target: { zone: 'gy', filter: { defId: 'gold' } }, into: foodPool },
    ],
    triggers: [],
    text: '+1 Action. Turn every Food in your hand into Gold, and every Gold in your GY into Food.',
    flavor: 'It is better. It is budder.',
    complexity: 'T2',
    subsystems: ['S-EFFECTS'],
    shop: 'draft',
    art: { key: 'better_budder', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'goatman_family_genetics',
    name: 'Goatman Family Genetics',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'createCard',
        defId: { pool: { catalog: 'food', filter: { subtype: 'Distilled' } } },
        to: 'hand',
        who: 'eachPlayer',
        count: 1,
      },
      {
        op: 'setKeyword',
        target: { zone: 'hand', filter: { subtype: 'Distilled' } },
        keyword: 'Flimsy',
        on: false,
      },
    ],
    triggers: [],
    text: 'Add a Distilled card to each player’s hand, then remove Flimsy from yours.',
    flavor: 'It runs in the family.',
    complexity: 'T3',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'goatman_family_genetics', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'performance_enhancing_cookie',
    name: 'Performance Enhancing Cookie',
    cost: { money: 5 },
    types: ['Action', 'Food'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [
      { op: 'nextCardModifier', mod: { buffTimes: 5, appliesTo: 'play', uses: 1 } },
      { op: 'createCard', defId: 'performance_enhancing_crumb', to: 'gy', count: 1 },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action. The next card you play is Buffed 5 times. Add a Performance Enhancing Crumb to your GY.',
    flavor: 'Banned in four leagues.',
    complexity: 'T4',
    subsystems: ['S-BUFF'],
    shop: 'draft',
    art: { key: 'performance_enhancing_cookie', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'performance_enhancing_crumb',
    name: 'Performance Enhancing Crumb',
    cost: { money: 2 },
    types: ['Action', 'Food'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [{ op: 'nextCardModifier', mod: { buffTimes: 2, appliesTo: 'play', uses: 1 } }],
    triggers: [],
    text: 'Flimsy. +1 Action. The next card you play is Buffed twice.',
    flavor: 'What fell off the cookie.',
    complexity: 'T4',
    subsystems: ['S-BUFF'],
    shop: 'draft',
    art: { key: 'performance_enhancing_crumb', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'boom_big_max',
    name: 'BOOM! Big Max',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: ['Food'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        // A real comparison. `selfCounter - 4` was truthy everywhere except at
        // exactly 4, so the payout fired from the first play. The gate reads the
        // `counter` key the trigger below keeps in step with the Plague Token,
        // because a bare `selfCounter` is the SUM of every counter — including
        // the `playCount` that `playCard` writes before effects run.
        //
        // `counter` therefore means "times THIS card was discarded", which is
        // the number the printed line shows. A Plague Token dealt from outside
        // (plague.ts plagues cards sitting in a GY) lands on the `plague` key
        // and cannot reach the gate: no expression reads a named counter other
        // than counter/uses/charges, and a `{self:true}` selector short-circuits
        // in selectInstancesWith before any `counter` filter is read. So the
        // text prints {counter} — the number that actually gates — rather than
        // {plague}, which can drift above it.
        op: 'conditional',
        if: { expr: 'selfCounter >= 5' },
        then: [
          { op: 'createCard', defId: 'jlore', to: 'gy', count: 1 },
          { op: 'gain', stat: 'vp', amount: 3 },
          { op: 'gain', stat: 'actions', amount: 1 },
          { op: 'gain', stat: 'cards', amount: 1 },
        ],
      },
    ],
    triggers: [
      {
        on: 'onDiscard',
        effects: [
          { op: 'plague', target: { self: true }, amount: 1 },
          { op: 'addCounter', target: { self: true }, key: 'counter', amount: 1 },
        ],
      },
    ],
    text: 'When discarded, gain a Plague Token. Active only after 5 discards ({counter} so far): add a Jlore to your GY, +3 VP, +1 Action, +1 Card.',
    flavor: 'It has been ticking for a while now.',
    complexity: 'T4',
    subsystems: ['S-PLAGUE', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'boom_big_max', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
];

export default cards;
