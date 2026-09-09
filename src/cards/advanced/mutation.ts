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
      // A PileSelector cannot reach the 'allCopies' branch of runBuffNode: it
      // throws the selector away (isPileSelector -> sel = undefined), resolves
      // no targets and falls back to buffing this card itself, with no prompt.
      // A card Selector prompts through resolveTargets and hands the chosen
      // instance's defId to the allCopies branch. Basics are filtered out
      // because zone 'shop' spans the Resource and Points shops too, and the
      // Draft-pile-only reading (plus excludeJlore) has to survive.
      {
        op: 'buff',
        scope: 'allCopies',
        target: { zone: 'shop', count: 1, pick: 'choose', filter: { not: { rarity: 'basic' } } },
        amount: 1,
        times: 1,
      },
    ],
    triggers: [],
    text: 'Flimsy. Choose a non-basic card in the Shop. Randomly Buff every copy of that card, wherever it is.',
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
      // Same PileSelector trap as Universal Buff! — see the note there.
      {
        op: 'nerf',
        scope: 'allCopies',
        target: { zone: 'shop', count: 1, pick: 'choose', filter: { not: { rarity: 'basic' } } },
        amount: 1,
        times: 1,
      },
    ],
    triggers: [],
    text: 'Flimsy. Choose a non-basic card in the Shop. Randomly Nerf every copy of that card, wherever it is.',
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
      // The guard is load-bearing. `fireOnBuff` (systems/buff.ts) re-enters at
      // depth 0 on every buff, so an unguarded self-buff re-fires itself until
      // the turn's whole node budget is gone and everything else queued that
      // turn fizzles. `buffedSelf` is 1 exactly when this instance is the card
      // that was just Buffed, which stops the cascade after one step. It is
      // also unset on the second dispatch `applyMany` raises through
      // `fireEvent`, where the expression throws and the conditional reads
      // false — so the Buffalo answers each buff once, not twice.
      {
        on: 'onBuff',
        effects: [
          {
            op: 'conditional',
            if: { expr: 'buffedSelf == 0' },
            then: [{ op: 'buff', scope: 'instance', target: { self: true }, amount: 1, times: 1 }],
          },
        ],
      },
    ],
    text: '+1 Action, +1 Card. Whenever another card in your deck is Buffed, this is Buffed too.',
    flavor: 'It grazes on patch notes.',
    complexity: 'T3',
    subsystems: ['S-BUFF'],
    shop: 'draft',
    art: { key: 'indirect_buffalo', status: 'placeholder' },
  },
];

export default cards;
