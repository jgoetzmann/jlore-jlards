/**
 * A.26 — Draft Shop: Buff, Nerf and card mutation.
 *
 * Universal Buff!/Nerf! write to the match CardVariant (`scope:'allCopies'`),
 * Quick Patch writes to one instance (`scope:'instance'`).
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'universal_buff',
    name: 'Universal Buff!',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'buff',
        scope: 'allCopies',
        target: { shop: 'draft', count: 1, pick: 'choose', excludeJlore: true },
        amount: 1,
        times: 1,
      },
    ],
    triggers: [],
    text: 'Flimsy. Choose a Draft pile. Randomly Buff every copy of that card, wherever it is.',
    flavor: 'Patch notes: everything.',
    complexity: 'T4',
    subsystems: ['S-BUFF'],
    shop: 'draft',
    art: { key: 'universal_buff', status: 'placeholder' },
  },
  {
    id: 'universal_nerf',
    name: 'Universal Nerf!',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'nerf',
        scope: 'allCopies',
        target: { shop: 'draft', count: 1, pick: 'choose', excludeJlore: true },
        amount: 1,
        times: 1,
      },
    ],
    triggers: [],
    text: 'Flimsy. Choose a Draft pile. Randomly Nerf every copy of that card, wherever it is.',
    complexity: 'T4',
    subsystems: ['S-BUFF'],
    shop: 'draft',
    art: { key: 'universal_nerf', status: 'placeholder' },
  },
  {
    id: 'quick_patch',
    name: 'Quick Patch',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['PlayOnDraw'],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { who: 'self', zone: 'hand' }, atLeast: 1 } },
        then: [{ op: 'buff', scope: 'instance', target: { who: 'self', zone: 'hand', count: 1, pick: 'random' }, amount: 1, times: 1 }],
        else: [
          { op: 'buff', scope: 'instance', target: { who: 'self', zone: ['library', 'gy'], count: 1, pick: 'random' }, amount: 1, times: 1 },
        ],
      },
    ],
    triggers: [],
    text: 'Play on Draw. Buff a random card in your deck, preferring your hand.',
    complexity: 'T3',
    subsystems: ['S-BUFF'],
    shop: 'draft',
    art: { key: 'quick_patch', status: 'placeholder' },
  },
  {
    id: 'indirect_buffalo',
    name: 'Indirect Buffalo',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    effects: [],
    triggers: [
      {
        on: 'onBuff',
        effects: [{ op: 'buff', scope: 'instance', target: { self: true }, amount: 1, times: 1 }],
      },
    ],
    text: '+1 Action, +1 Card. Whenever a card in your deck is Buffed, this is Buffed too.',
    flavor: 'It grazes on patch notes.',
    complexity: 'T3',
    subsystems: ['S-BUFF'],
    shop: 'draft',
    art: { key: 'indirect_buffalo', status: 'placeholder' },
  },
];

export default cards;
