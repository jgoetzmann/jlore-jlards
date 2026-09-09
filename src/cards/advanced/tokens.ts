/**
 * A.29 — the two tokens S9 owns: Permanent: Hand Box and Temporary: Hand Box.
 *
 * Every other token in A.29 belongs to another slice and is referenced by id.
 * Stored cards live in the owner's `aside` zone and carry the `boxed` counter.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'permanent_hand_box',
    name: 'Permanent: Hand Box',
    cost: { money: 3 },
    types: ['Token'],
    subtypes: ['Hand Box'],
    tags: [],
    rarity: 'token',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'moveTo', target: { who: 'self', zone: 'aside', filter: { not: { type: 'Token' } } }, zone: 'hand' },
    ],
    triggers: [],
    text: '+1 Action. Add the cards stored in this box to your hand. ({boxed} stored.)',
    flavor: 'Saved for later. Later is now.',
    complexity: 'T2',
    subsystems: ['S-TOKEN', 'S-PERSIST'],
    notPurchasable: true,
    art: { key: 'permanent_hand_box', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'temporary_hand_box',
    name: 'Temporary: Hand Box',
    cost: { money: 3 },
    types: ['Token'],
    subtypes: ['Hand Box'],
    tags: [],
    rarity: 'token',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'copyCard',
        target: { who: 'self', zone: 'aside', filter: { not: { type: 'Token' } } },
        to: 'hand',
        keywords: ['Temporary'],
      },
    ],
    triggers: [],
    text: '+1 Action. Add Temporary copies of the cards stored in this box to your hand. ({boxed} stored.)',
    flavor: 'Repackaged. Some settling may have occurred.',
    complexity: 'T2',
    subsystems: ['S-TOKEN', 'S-PERSIST'],
    notPurchasable: true,
    art: { key: 'temporary_hand_box', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
];

export default cards;
