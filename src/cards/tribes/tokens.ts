/**
 * A.29 — the two shared tribe tokens this slice owns outright.
 *
 * `felinor` and `warhero_token` are referenced by roughly twenty cards spread
 * across every other card slice; the definitions live here so exactly one
 * module declares them.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'felinor',
    name: 'Felinor',
    cost: { money: 0 },
    types: ['Action', 'Token'],
    subtypes: ['Felinor'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { cards: 2 },
    effects: [],
    triggers: [],
    text: 'Flimsy. +2 Cards.',
    flavor: 'It has decided to be your problem now.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'felinor', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'warhero_token',
    name: 'Warhero Token',
    cost: { money: 3 },
    types: ['Action', 'Points', 'Token'],
    subtypes: ['Warhero Token'],
    tags: [],
    rarity: 'token',
    keywords: [],
    stats: { actions: 1, money: 1, vp: 1 },
    effects: [],
    triggers: [],
    text: '+1 Action, +1 Money, +1 VP.',
    flavor: 'Awarded posthumously, mostly.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'warhero_token', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
];

export default cards;
