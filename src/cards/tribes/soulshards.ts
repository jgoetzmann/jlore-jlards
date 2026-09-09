/**
 * A.19 — Soul Shards.
 *
 * The `soul_shard` token is `PlayOnDraw` + `Flimsy`: it resolves the moment it
 * is drawn and trashes itself, so the whole archetype is about stuffing the GY
 * with cards that never take up a hand slot.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'soul_shard',
    name: 'Soul Shard',
    cost: { money: 0 },
    types: ['Action', 'Token'],
    subtypes: ['Soul Shard'],
    tags: [],
    rarity: 'token',
    keywords: ['PlayOnDraw', 'Flimsy'],
    stats: {},
    effects: [{ op: 'createCard', defId: 'tix', to: 'gy', count: 1 }],
    triggers: [],
    text: 'Play on Draw. Flimsy. Add a Tix to your GY.',
    flavor: 'A small, sharp piece of someone.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'soul_shard', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'soul_jailor',
    name: 'Soul Jailor',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: ['Soul Shard'],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    effects: [{ op: 'createCard', defId: 'soul_shard', to: 'gy', count: 2 }],
    triggers: [],
    text: '+1 Action, +1 Card. Add 2 Soul Shards to your GY.',
    flavor: 'He counts them every night.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'soul_jailor', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'soul_slicer',
    name: 'Soul Slicer',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Soul Shard'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: { combo: 1 },
        then: [
          // Soul Slicer is already in `play` and at the head of playedThisTurn when
          // its body runs, so an unfiltered 'lastPlayed' always ate itself. Same
          // exclusion The Past / The Future use.
          {
            op: 'trash',
            target: { zone: 'play', filter: { not: { defId: 'soul_slicer' } }, count: 1, pick: 'lastPlayed' },
          },
          { op: 'createCard', defId: 'soul_shard', to: 'gy', count: 2 },
          { op: 'gain', stat: 'actions', amount: 3 },
        ],
      },
    ],
    triggers: [],
    text: 'Combo 1: trash the last card you played to add 2 Soul Shards to your GY and +3 Actions.',
    flavor: 'One clean cut, straight through.',
    complexity: 'T3',
    subsystems: ['S-COMBO', 'S-TOKEN'],
    shop: 'draft',
    art: { key: 'soul_slicer', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'luckysoul_hoarder',
    name: 'Luckysoul Hoarder',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Soul Shard'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { buys: 1 },
    effects: [
      { op: 'createCard', defId: 'soul_shard', to: 'gy', count: 2 },
      { op: 'gain', stat: 'money', amount: { expr: 'buysRemaining' } },
    ],
    triggers: [],
    text: '+1 Buy. Add 2 Soul Shards to your GY. Gain Money equal to your remaining Buys.',
    flavor: 'He does not spend them. He just likes having them.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'luckysoul_hoarder', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'soulcologist_mike_kwzka',
    name: 'Soulcologist Mike Kwzka',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: ['Soul Shard'],
    tags: [],
    rarity: 'legendary',
    keywords: [],
    stats: { actions: 2 },
    effects: [
      {
        op: 'createCard',
        defId: { pool: { catalog: 'book' } },
        to: 'gy',
        count: { expr: 'count(soul_shard)' },
      },
    ],
    triggers: [],
    text: '+2 Actions. Add a Book to your GY for each Soul Shard in your deck.',
    flavor: 'He publishes on them.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'soulcologist_mike_kwzka', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'soul_shard_lapidary',
    name: 'Soul Shard Lapidary',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: ['Soul Shard', 'Tribal'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      // Same shape as Truss Flick: `{ifPrevious:true}` is never true, so the
      // payoff never ran and the Epic resolved to "trash a Soul Shard". Gate on
      // the Shard existing and destroy it inside the branch.
      {
        op: 'conditional',
        if: { has: { target: { zone: ['hand', 'gy'], filter: { defId: 'soul_shard' } }, atLeast: 1 } },
        then: [
          { op: 'trash', target: { zone: ['hand', 'gy'], filter: { defId: 'soul_shard' }, count: 1, pick: 'choose' } },
          {
            op: 'createCard',
            defId: { pool: { scope: 'knownUniverse', filter: { cost: { gte: 5 } } } },
            to: 'hand',
            count: 1,
            keywords: ['Flimsy'],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Destroy a Soul Shard to add a Flimsy Known Universe card costing (5) or more to your hand.',
    flavor: 'Cut, polished, set.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-CODEX'],
    shop: 'draft',
    art: { key: 'soul_shard_lapidary', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
];

export default cards;
