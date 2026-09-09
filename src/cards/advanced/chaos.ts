/**
 * B.2 — Call to Chaos.
 *
 * One card, one `{op:'random'}` with all 31 branches.
 *
 * SB-20: the suggested weight column is taken literally —
 *   Very low = 1, Low = 2, Medium = 5, High = 9.
 *
 * B120: branches 12-15 share one display string. The view renders
 * `displayAs`; the four real effects differ and never reach the client.
 */
import type { CardDefinition, EffectNode } from '@engine/types';

const UNKNOWN_CARD = 'Add an unknown card to the top of your library.';

const branches: { weight: number; effects: EffectNode[]; displayAs?: string }[] = [
  // 1 — Low
  {
    weight: 2,
    effects: [{ op: 'lockPile', target: { shop: 'all', excludeJlore: true }, duration: 'untilEndOfYourNextTurn' }],
    displayAs: 'All Shops are Locked until the end of your next turn.',
  },
  // 2 — Low
  {
    weight: 2,
    effects: [{ op: 'trashPile', target: { shop: 'draft', count: 1, pick: 'random', excludeJlore: true } }],
    displayAs: 'Trash a random Draft Shop pile.',
  },
  // 3 — Low
  {
    weight: 2,
    effects: [{ op: 'trash', target: { who: 'eachPlayer', zone: ['library', 'hand', 'gy'], count: 5, pick: 'random' } }],
    displayAs: 'All players trash 5 random cards from their deck.',
  },
  // 4 — Low
  {
    weight: 2,
    effects: [
      {
        op: 'transform',
        target: { who: 'self', zone: 'hand' },
        into: { pool: { scope: 'entireUniverse', filter: { rarity: 'legendary' } } },
      },
    ],
    displayAs: 'Transform your hand into random Legendaries.',
  },
  // 5 — Very low
  {
    weight: 1,
    effects: [
      { op: 'setKeyword', target: { who: 'eachPlayer', zone: ['library', 'hand', 'gy', 'play'] }, keyword: 'Flimsy', on: true },
    ],
    displayAs: 'Every card currently in a deck gains Flimsy.',
  },
  // 6 — Medium
  {
    weight: 5,
    // `who` on a moveTo names the DESTINATION owner. Without it the three cards
    // went back into the opponent's own hand and the branch was a no-op.
    effects: [
      { op: 'moveTo', target: { who: 'chosenOpponent', zone: 'hand', count: 3, pick: 'random' }, zone: 'hand', who: 'self' },
    ],
    displayAs: "Steal 3 cards from an opponent's hand.",
  },
  // 7 — Medium
  {
    weight: 5,
    effects: [
      { op: 'createCard', defId: { pool: { catalog: 'book' } }, to: 'hand', count: 3 },
      { op: 'playCard', target: { who: 'self', zone: 'hand', filter: { type: 'Book' }, count: 3, pick: 'random' }, randomTargets: true },
    ],
    displayAs: 'Cast 3 Books with random targets.',
  },
  // 8 — Medium
  {
    weight: 5,
    effects: [
      { op: 'createCard', defId: 'miracle_fruit', to: 'hand', count: 1 },
      { op: 'playCard', target: { who: 'self', zone: 'hand', filter: { defId: 'miracle_fruit' }, count: 1 } },
    ],
    displayAs: 'Cast Miracle Fruit.',
  },
  // 9 — Medium (the downside roll)
  { weight: 5, effects: [{ op: 'endTurn', who: 'self' }], displayAs: 'End your turn.' },
  // 10 — Medium
  {
    weight: 5,
    effects: [{ op: 'createCard', defId: 'copper', to: 'gy', who: 'eachPlayer', count: 10 }],
    displayAs: "Add 10 Copper to each player's GY.",
  },
  // 11 — High
  {
    weight: 9,
    effects: [{ op: 'createCard', defId: { pool: { scope: 'entireUniverse' } }, to: 'hand', count: 3 }],
    displayAs: 'Add 3 random Entire Universe cards to your hand.',
  },
  // 12 — Low — B120: hidden behind the shared display string
  {
    weight: 2,
    effects: [
      { op: 'createCard', defId: { pool: { scope: 'entireUniverse', filter: { rarity: 'mythic' } } }, to: 'library', position: 'top' },
    ],
    displayAs: UNKNOWN_CARD,
  },
  // 13 — Medium — B120
  {
    weight: 5,
    effects: [{ op: 'createCard', defId: 'diamond', to: 'library', position: 'top' }],
    displayAs: UNKNOWN_CARD,
  },
  // 14 — Medium — B120
  {
    weight: 5,
    effects: [
      { op: 'createCard', defId: { pool: { scope: 'entireUniverse', filter: { cost: { gte: 6 } } } }, to: 'library', position: 'top' },
    ],
    displayAs: UNKNOWN_CARD,
  },
  // 15 — High — B120
  {
    weight: 9,
    effects: [{ op: 'createCard', defId: 'felinor', to: 'library', position: 'top' }],
    displayAs: UNKNOWN_CARD,
  },
  // 16 — Medium
  {
    weight: 5,
    effects: [
      {
        op: 'transform',
        target: { who: 'self', zone: ['library', 'hand', 'gy'], filter: { cost: { lte: 3 } } },
        into: 'silver',
      },
    ],
    displayAs: 'Transform every card in your deck costing (3) or less into Silver.',
  },
  // 17 — Medium
  {
    weight: 5,
    effects: [{ op: 'createCard', defId: 'cursed_pig', to: 'gy', who: 'eachOpponent', count: 3 }],
    displayAs: "Add 3 Cursed Pigs to your opponents' decks.",
  },
  // 18 — Medium
  {
    weight: 5,
    effects: [{ op: 'transform', target: { who: 'self', zone: 'hand' }, into: { costDelta: 2 } }],
    displayAs: 'Transform your hand into cards costing (2) more, where possible.',
  },
  // 19 — Low
  {
    weight: 2,
    effects: [
      { op: 'createCard', defId: 'restart_mission', to: 'hand', count: 1, keywords: ['Flimsy'] },
      { op: 'playCard', target: { who: 'self', zone: 'hand', filter: { defId: 'restart_mission' }, count: 1 } },
    ],
    displayAs: 'Cast Restart Mission.',
  },
  // 20 — Medium
  { weight: 5, effects: [{ op: 'trash', target: { who: 'self', zone: 'gy' } }], displayAs: 'Trash your GY.' },
  // 21 — Low
  {
    weight: 2,
    effects: [
      { op: 'createCard', defId: 'wardrums_mystery_box', to: 'hand', count: 1, keywords: ['Flimsy'] },
      { op: 'playCard', target: { who: 'self', zone: 'hand', filter: { defId: 'wardrums_mystery_box' }, count: 1 } },
    ],
    displayAs: "Cast Wardrum's Mystery Box.",
  },
  // 22 — Medium
  {
    weight: 5,
    effects: [
      { op: 'createCard', defId: 'truss', to: 'library', who: 'eachPlayer', count: 3, position: 'random' },
    ],
    displayAs: "Add 3 Truss to each player's Library.",
  },
  // 23 — Medium
  {
    weight: 5,
    effects: [{ op: 'delayed', when: 'startOfNextTurn', effects: [{ op: 'gain', stat: 'money', amount: -10 }], who: 'self' }],
    displayAs: '-10 Money next turn.',
  },
  // 24 — Medium
  {
    weight: 5,
    effects: [{ op: 'createCard', defId: 'call_to_chaos', to: 'hand', who: 'chosenOpponent' }],
    displayAs: "Add a Call to Chaos to an opponent's hand.",
  },
  // 25 — Low
  {
    weight: 2,
    effects: [
      { op: 'transform', target: { who: 'self', zone: ['library', 'hand', 'gy'], filter: { type: 'Resource' } }, into: 'upgrade' },
    ],
    displayAs: 'Upgrade every Resource in your deck.',
  },
  // 26 — Medium
  {
    weight: 5,
    effects: [{ op: 'manifestAura', tier: 'heroic', who: 'self' }],
    displayAs: 'Add a random Heroic Aura to your Field.',
  },
  // 27 — Medium
  {
    weight: 5,
    effects: [
      { op: 'createCard', defId: 'call_to_chaos', to: 'hand', count: 1, keywords: ['Flimsy'] },
      { op: 'playCard', target: { who: 'self', zone: 'hand', filter: { defId: 'call_to_chaos' }, count: 1 } },
    ],
    // The doc row asks for a Discover among Chaos effects, which needs a way to
    // offer branches as prompt options that {op:'random'} does not have. The
    // roll is what actually happens, so the printed line says so.
    displayAs: 'Cast another Call to Chaos effect.',
  },
  // 28 — High
  { weight: 9, effects: [{ op: 'gain', stat: 'prophet', amount: 3 }], displayAs: '+3 Prophet.' },
  // 29 — High
  {
    weight: 9,
    effects: [
      { op: 'repeat', times: { expr: 'handSize' }, effects: [{ op: 'createCard', defId: { pool: { catalog: 'food' } }, to: 'hand' }] },
    ],
    displayAs: 'Add a Food to your hand for each card in your hand.',
  },
  // 30 — Medium
  {
    weight: 5,
    effects: [
      {
        op: 'transform',
        target: { who: 'self', zone: ['library', 'hand', 'gy'], filter: { defId: 'copper' } },
        into: 'grubbing_goblin',
      },
    ],
    displayAs: 'Every Copper in your deck becomes a Grubbing Goblin.',
  },
  // 31 — Medium
  {
    weight: 5,
    effects: [{ op: 'transform', target: { self: true }, into: 'lunar_fragment' }],
    displayAs: 'Replace this card with a Lunar Fragment.',
  },
];

export const cards: CardDefinition[] = [
  {
    id: 'call_to_chaos',
    name: 'Call to Chaos',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: ['Chaos'],
    tags: ['Chaos'],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [{ op: 'random', branches }],
    triggers: [],
    text: '???',
    flavor: 'Thirty-one ways for this to go.',
    complexity: 'T4',
    subsystems: ['S-CHAOS', 'S-HIDDEN'],
    shop: 'draft',
    art: { key: 'call_to_chaos', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
];

export default cards;
