/**
 * A.22 — CN archetype.
 *
 * CN is a subtype, not a `CardType`, so every card here carries `'CN'` in
 * `subtypes` and the cards that care about the tribe filter on
 * `{ subtype: 'CN' }`.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'rct_cn',
    name: 'RCT CN',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: ['CN'],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [
      {
        op: 'buff',
        scope: 'allCopies',
        target: { zone: ['hand', 'library', 'gy', 'play'], filter: { subtype: 'CN' } },
        times: 1,
      },
      // A.22 grants the next card the CN TAG — not a buff. This was encoded as
      // `buffTimes`, which is a different effect the doc never prints, so the node
      // is replaced rather than merely switched on. `grantSubtype` writes
      // `addedSubtypes` on the played instance and `matchesFilter` reads it, so the
      // granted tribe is visible to every `{ subtype: 'CN' }` selector afterwards.
      { op: 'nextCardModifier', mod: { grantSubtype: 'CN', appliesTo: 'play', uses: 1 } },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action. Next card played gains the CN tag. Buff all CN cards in your deck.',
    flavor: 'Randomised, controlled, and extremely CN.',
    complexity: 'T4',
    subsystems: ['S-BUFF'],
    shop: 'draft',
    art: { key: 'rct_cn', status: 'placeholder' },
  },
  {
    id: 'cn_phobia',
    name: 'CN-phobia',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: ['CN'],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { actions: 1, money: 3, cards: 1 },
    effects: [
      // "If successful" is the presence of a target, tested before the trash:
      // `ifPrevious` is never written by the interpreter, so a rider hung off it
      // would never pay. `chosenOpponent` is deterministic (the opponent with the
      // most VP), so the condition and the trash agree on the same player.
      {
        op: 'conditional',
        if: {
          has: {
            target: {
              who: 'chosenOpponent',
              zone: ['hand', 'library', 'gy'],
              filter: { subtype: 'CN' },
            },
            atLeast: 1,
          },
        },
        then: [
          {
            op: 'trash',
            target: {
              who: 'chosenOpponent',
              zone: ['hand', 'library', 'gy'],
              filter: { subtype: 'CN' },
              count: 1,
              pick: 'random',
            },
          },
          { op: 'gain', stat: 'money', amount: 2 },
        ],
      },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action, +3 Money, +1 Card. Trash a CN card in an opponent’s deck; if you do, +2 Money.',
    flavor: 'An irrational fear, mostly.',
    complexity: 'T3',
    subsystems: ['S-PVP'],
    shop: 'draft',
    art: { key: 'cn_phobia', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'cncias',
    name: 'CNcias',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: ['CN'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'discover',
        pool: { scope: 'knownUniverse', filter: { cost: { lte: 2 }, inMatch: false } },
        count: 3,
        pick: 1,
        // `$discovered` is the defId the player picked; `localResume` substitutes
        // it into `then` once per chosen card. Minting the card here rather than
        // leaning on the default Discover semantic is what lets it arrive with a
        // Plague Token already on it (`createCard` honours `counters`).
        then: [{ op: 'createCard', defId: '$discovered', to: 'hand', counters: { plague: 1 } }],
        prompt: 'Discover a card costing (2) or less that is not in this match',
      },
    ],
    triggers: [],
    text: '+1 Action. Discover a Known Universe card costing (2) or less that is not in this match. Add it to your hand with a Plague Token.',
    flavor: 'Imported, unlicensed, slightly ill.',
    complexity: 'T3',
    subsystems: ['S-CODEX', 'S-PLAGUE'],
    shop: 'draft',
    art: { key: 'cncias', status: 'placeholder' },
  },
  {
    id: 'cn_developer',
    name: 'CN Developer',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: ['CN'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [{ op: 'createCard', defId: 'upcycle', to: 'gy', count: 1 }],
    triggers: [
      {
        on: 'onDiscard',
        effects: [{ op: 'createCard', defId: 'upcycle', to: 'gy', count: 2 }],
      },
    ],
    text: 'Add an Upcycle to your GY. When discarded at end of turn, add two Upcycles to your GY instead.',
    flavor: 'Ship it, then ship it again.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'cn_developer', status: 'placeholder' },
  },
  {
    id: 'cn_century_of_humiliation',
    name: 'CN Century of Humiliation',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['CN'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'transform', target: { zone: 'hand' }, into: { costDelta: 1 } },
      { op: 'nerf', scope: 'instance', target: { zone: 'hand' }, times: 1 },
    ],
    triggers: [],
    text: '+1 Action. Replace every card in your hand with a card costing (1) more, then Nerf them.',
    flavor: 'Bigger, and worse.',
    complexity: 'T4',
    subsystems: ['S-BUFF'],
    shop: 'draft',
    art: { key: 'cn_century_of_humiliation', status: 'placeholder' },
  },
  {
    id: 'cn_tech',
    name: 'CN Tech',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: ['CN'],
    tags: ['Legacy'],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'gainCard',
        from: { shop: 'all', filter: { cost: { lte: 5 } }, count: 1, pick: 'choose', excludeJlore: true },
        to: 'hand',
        count: 1,
        free: true,
      },
    ],
    triggers: [],
    text: '+1 Action. Add a Shop card costing (5) or less to your hand.',
    flavor: 'Same specs, half the price, none of the warranty.',
    complexity: 'T2',
    subsystems: ['S-SHOP'],
    shop: 'draft',
    art: { key: 'cn_tech', status: 'placeholder' },
  },
  {
    id: 'cn_century_of_prosperity',
    name: 'CN Century of Prosperity',
    cost: { money: 8 },
    types: ['Action'],
    subtypes: ['CN'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1, money: 8 },
    effects: [
      {
        op: 'createCard',
        defId: { pool: { scope: 'entireUniverse', filter: { subtype: 'CN' } } },
        to: 'hand',
        who: 'eachPlayer',
        count: 1,
      },
    ],
    triggers: [],
    text: '+8 Money, +1 Action. Add a random CN card to every player’s hand.',
    flavor: 'Everyone gets one. Everyone.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'cn_century_of_prosperity', status: 'placeholder', anim: 'coin' },
  },
  {
    id: 'cn_succulent_xiao',
    name: 'CN Succulent Xiao',
    cost: { money: 1 },
    types: ['Action', 'Food', 'Token'],
    subtypes: ['CN', 'Food'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { actions: 1, buys: 1, cards: 1 },
    effects: [],
    triggers: [],
    text: 'Flimsy. +1 Action, +1 Buy, +1 Card.',
    flavor: 'Succulent.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'cn_succulent_xiao', status: 'placeholder' },
  },
  {
    id: 'performativity',
    name: 'Performativity',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: ['CN'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'discover',
        pool: { catalog: 'book' },
        count: 3,
        pick: 1,
        then: [],
        prompt: 'Discover a Book',
      },
      {
        op: 'discover',
        pool: { catalog: 'food' },
        count: 3,
        pick: 1,
        then: [],
        prompt: 'Discover a Food',
      },
      {
        op: 'discover',
        pool: { scope: 'entireUniverse', filter: { subtype: 'CN' } },
        count: 3,
        pick: 1,
        then: [],
        prompt: 'Discover a CN card',
      },
    ],
    triggers: [],
    text: '+1 Action. Discover a Book, a Food and a CN card, and add each to your hand.',
    flavor: 'The act of doing it is the whole point.',
    complexity: 'T3',
    subsystems: ['S-EFFECTS', 'S-CODEX'],
    shop: 'draft',
    art: { key: 'performativity', status: 'placeholder' },
  },
];

export default cards;
