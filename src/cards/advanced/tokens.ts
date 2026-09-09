/**
 * A.29 — the two tokens S9 owns: Permanent: Hand Box and Temporary: Hand Box.
 *
 * Every other token in A.29 belongs to another slice and is referenced by id.
 *
 * Stored cards live in the owner's `aside` zone and carry the `boxed` counter.
 * `aside` is ONE shared staging pile per player — a dozen other cards park
 * instances there for the length of a single effect — so a Hand Box has to
 * select on the counter, not on "everything in aside that is not a Token", or
 * opening one scoops up whatever another card happens to be staging.
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
      {
        op: 'moveTo',
        target: { who: 'self', zone: 'aside', filter: { counter: { key: 'boxed', gte: 1 } } },
        zone: 'hand',
      },
    ],
    triggers: [],
    text: '+1 Action. Add the cards stored in this box to your hand. ({boxed} stored.)',
    flavor: 'Saved for later. Later is now.',
    complexity: 'T2',
    subsystems: ['S-TOKEN', 'S-PERSIST'],
    notPurchasable: true,
    art: { key: 'permanent_hand_box', status: 'placeholder' },
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
        target: { who: 'self', zone: 'aside', filter: { counter: { key: 'boxed', gte: 1 } } },
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
    art: { key: 'temporary_hand_box', status: 'placeholder' },
  },
];

export default cards;
