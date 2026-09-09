/**
 * A.12 — Draft Shop: the Warhero Token archetype.
 *
 * Slice S7 (cards-archetypes). The Warhero Token itself (`warhero_token`) is
 * owned by the tribes slice and is only referenced here.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'false_hero',
    name: 'False Hero',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: ['Warhero'],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { money: -1 },
    effects: [{ op: 'createCard', defId: 'warhero_token', to: 'gy', keywords: ['Flimsy'] }],
    triggers: [],
    text: '-1 Money. Add a Flimsy Warhero Token to your GY.',
    flavor: 'The statue went up before the battle did.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'false_hero', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'tylannt',
    name: 'Tylannt',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: ['Warhero'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    effects: [{ op: 'createCard', defId: 'warhero_token', to: 'library', position: 'top' }],
    triggers: [],
    text: '+1 Action, +1 Card. Add a Warhero Token to the top of your Library.',
    flavor: 'He promotes from within. Always himself.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'tylannt', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'aura_farming',
    name: 'Aura Farming',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Warhero'],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [{ op: 'createCard', defId: 'warhero_token', to: 'gy', count: 2, keywords: ['Flimsy'] }],
    triggers: [],
    text: 'Add 2 Flimsy Warhero Tokens to your GY.',
    flavor: 'Posture is a renewable resource.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'aura_farming', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'aura_gambit',
    name: 'Aura Gambit',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: ['Warhero'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'createCard',
        defId: 'warhero_token',
        to: 'gy',
        who: 'eachOpponent',
        keywords: ['Flimsy'],
        counters: { auraGambit: 1 },
      },
      // The stamp on the token records that *a* Gambit gave it away; it cannot
      // record WHICH seat did, because `counters` on createCard is a fixed
      // literal. This player-scoped tally is the other half of that pair: one
      // claim per token handed out, spent when a token is collected. Only a
      // seat that actually PLAYED the card holds claims.
      {
        op: 'addCounter',
        scope: 'player',
        key: 'auraGambitOwed',
        amount: { expr: 'playerCount - 1' },
        who: 'self',
      },
    ],
    triggers: [
      // The return leg. `warhero_token` is a shared definition with no triggers
      // of its own and an instance cannot carry one, so the gift is stamped with
      // a counter and this card collects from wherever it sits in your deck.
      // `zones` only NARROWS the declaration — a trigger with no `zones` fires
      // from any zone, and fireOwnedTriggers already sweeps play/hand/gy/library
      // — but naming them keeps the rider honest about where it watches from.
      // `who:'self'` on the moveTo is the whole trick: it names the DESTINATION
      // owner, and without it the token drops straight back into the GY of the
      // player who just trashed it. `who:'owner'` would be wrong here — inside
      // the forEach the source is the TOKEN, and its owner is the victim. The
      // stamp is cleared before the move, or the token would walk home again
      // every time you played and trashed it.
      //
      // Settled at the end of your turn — the trash happens on their turn, and a
      // card cannot watch another player's trash. The `auraGambitOwed` gate is
      // what stops the victim keeping the gift: endOfTurn fires for the active
      // player only, so the victim's end of turn always settles first, and
      // ungated, any seat holding ANY Gambit copy — this pile is `draft`, so a
      // copy bought and left in a library is a normal state — swept the stamped
      // token into its own GY before the granter's turn came round. One claim is
      // spent per collection, so no seat can take more tokens than it gave away.
      // Two seats that have both PLAYED a Gambit still share one stamp pool, and
      // there the first to settle takes the token.
      {
        on: 'endOfTurn',
        zones: ['play', 'gy', 'hand', 'library'],
        condition: { expr: 'auraGambitOwed > 0' },
        effects: [
          {
            op: 'forEach',
            over: {
              zone: 'trash',
              filter: { defId: 'warhero_token', counter: { key: 'auraGambit', gte: 1 } },
              count: { expr: 'auraGambitOwed' },
            },
            effects: [
              { op: 'addCounter', target: { self: true }, key: 'auraGambit', amount: -1 },
              { op: 'moveTo', target: { self: true }, zone: 'gy', who: 'self' },
              { op: 'addCounter', scope: 'player', key: 'auraGambitOwed', amount: -1, who: 'self' },
            ],
          },
        ],
      },
    ],
    text: '+1 Action. Give each opponent a Flimsy Warhero Token with “when trashed, give it to you”.',
    flavor: 'A gift with a return address.',
    complexity: 'T3',
    subsystems: ['S-TOKEN', 'S-PVP'],
    shop: 'draft',
    art: { key: 'aura_gambit', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'generational_aura_debt',
    name: 'Generational Aura Debt',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Warhero'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      { op: 'trash', target: { zone: 'library', count: 4, pick: 'top' } },
      { op: 'createCard', defId: 'warhero_token', to: 'library', count: 4, position: 'top', keywords: ['Flimsy'] },
      { op: 'delayed', when: 'startOfNextTurn', effects: [{ op: 'gain', stat: 'money', amount: -4 }] },
    ],
    triggers: [],
    text: 'Replace the top 4 cards of your Library with Flimsy Warhero Tokens. -4 Money at the start of your next turn.',
    flavor: 'Your grandchildren will also be very impressive.',
    complexity: 'T3',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'generational_aura_debt', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
];

export default cards;
