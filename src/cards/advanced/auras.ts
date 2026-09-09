/**
 * §9 + B.4 — every Aura in the game.
 *
 * 11 Heroic (activationCost 2, once per turn), 12 Celestial (persistent,
 * unlimited), 2 Hypercelestial (one at a time).
 *
 * B.4's In Too Deep floors ship as `IN_TOO_DEEP_FLOORS` and drive the
 * `in_too_deep` Celestial aura's quest triggers.
 */
import type { AuraDefinition, EffectNode } from '@engine/types';

export interface QuestFloor {
  /** Floor label as printed in Appendix B.4. */
  id: string;
  quest: string;
  /** Counter in `QuestState.progress` this floor watches. */
  key: string;
  /** Value the counter must reach. */
  target: number;
  /** True when the counter resets every turn ("in one turn"). */
  perTurn: boolean;
  reward: EffectNode[];
  leadsTo: string[];
}

export const IN_TOO_DEEP_FLOORS: QuestFloor[] = [
  {
    id: '1',
    quest: 'Buy 2 cards',
    key: 'buys',
    target: 2,
    perTurn: false,
    reward: [{ op: 'delayed', when: 'startOfNextTurn', effects: [{ op: 'gain', stat: 'money', amount: 2 }], who: 'self' }],
    leadsTo: ['2a', '2b'],
  },
  {
    id: '2a',
    quest: 'Play 5 cards',
    key: 'plays',
    target: 5,
    perTurn: false,
    reward: [{ op: 'createCard', defId: 'truss', to: 'library', position: 'top' }],
    leadsTo: ['3a', '3b'],
  },
  {
    id: '2b',
    quest: 'Trash 3 cards',
    key: 'trashes',
    target: 3,
    perTurn: false,
    reward: [
      { op: 'createCard', defId: { pool: { catalog: 'book' } }, to: 'hand' },
      { op: 'gain', stat: 'actions', amount: 1 },
    ],
    leadsTo: ['3b', '3c'],
  },
  {
    id: '3a',
    quest: 'Draw 20 cards',
    key: 'draws',
    target: 20,
    perTurn: false,
    reward: [
      { op: 'moveTo', target: { who: 'self', zone: 'gy' }, zone: 'library' },
      { op: 'shuffle', zone: 'library', who: 'self' },
      { op: 'draw', amount: 4 },
      { op: 'gain', stat: 'actions', amount: 1 },
    ],
    leadsTo: ['4a', '4b'],
  },
  {
    id: '3b',
    quest: 'Buy a card costing (8) or more',
    key: 'expensiveBuys',
    target: 1,
    perTurn: false,
    reward: [{ op: 'createCard', defId: 'gold', to: 'library', position: 'top' }],
    leadsTo: ['4b', '4c'],
  },
  {
    id: '3c',
    quest: 'Buy a Diamond',
    key: 'diamondBuys',
    target: 1,
    perTurn: false,
    reward: [
      {
        op: 'discover',
        pool: { scope: 'opponentHand', who: 'chosenOpponent' },
        count: 3,
        pick: 1,
        prompt: "Steal a card from an opponent's hand",
        then: [{ op: 'moveTo', target: { who: 'chosenOpponent', zone: 'hand', count: 1, pick: 'random' }, zone: 'hand' }],
      },
    ],
    leadsTo: ['4c', '4d'],
  },
  {
    id: '4a',
    quest: 'Draw 20 cards in one turn',
    key: 'drawsThisTurn',
    target: 20,
    perTurn: true,
    reward: [{ op: 'manifestAura', tier: 'celestial', auraId: 'undead_army', who: 'self' }],
    leadsTo: ['5'],
  },
  {
    id: '4b',
    quest: 'Have 5 Diamonds in your deck',
    key: 'diamondsInDeck',
    target: 5,
    perTurn: false,
    reward: [{ op: 'manifestAura', tier: 'celestial', auraId: 'market_manipulation', who: 'self' }],
    leadsTo: ['5'],
  },
  {
    id: '4c',
    quest: 'End a turn with (12) or more unspent Money',
    key: 'bigUnspentTurns',
    target: 1,
    perTurn: false,
    reward: [{ op: 'manifestAura', tier: 'celestial', auraId: 'double_header', who: 'self' }],
    leadsTo: ['5'],
  },
  {
    id: '4d',
    quest: 'Have 16 unique cards in your deck',
    key: 'uniqueInDeck',
    target: 16,
    perTurn: false,
    reward: [{ op: 'manifestAura', tier: 'celestial', auraId: 'yuyas_mythical_portal', who: 'self' }],
    leadsTo: ['5'],
  },
  {
    id: '5',
    quest: 'Win the game',
    key: 'wins',
    target: 1,
    perTurn: false,
    reward: [{ op: 'gain', stat: 'vp', amount: 5 }],
    leadsTo: [],
  },
];

export const auras: AuraDefinition[] = [
  // -------------------------------------------------------------------------
  // 9.1 Heroic — (2) Money to activate, once per turn, one held at a time.
  // -------------------------------------------------------------------------
  {
    id: 'learning_subscription',
    name: 'Learning Subscription',
    tier: 'heroic',
    activationCost: 2,
    text: 'Add a Book to your hand.',
    effects: [{ op: 'createCard', defId: { pool: { catalog: 'book' } }, to: 'hand' }],
    triggers: [],
    art: { key: 'aura_learning_subscription', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'evolve',
    name: 'Evolve',
    tier: 'heroic',
    activationCost: 2,
    text: 'Trash a card from your hand, then add a random Known Universe card costing (3) more.',
    effects: [
      { op: 'trash', target: { who: 'self', zone: 'hand', count: 1, pick: 'choose', chooser: 'self' } },
      { op: 'createCard', defId: { pool: { scope: 'knownUniverse' } }, to: 'hand' },
    ],
    triggers: [],
    art: { key: 'aura_evolve', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'mycology',
    name: 'Mycology',
    tier: 'heroic',
    activationCost: 2,
    text: 'Discover two Known Universe cards costing (3) or less, Fuse them, and add the result to your hand.',
    effects: [
      {
        op: 'discover',
        pool: { scope: 'knownUniverse', filter: { cost: { lte: 3 } } },
        count: 3,
        pick: 2,
        prompt: 'Discover two cards to Fuse',
        then: [{ op: 'createCard', defId: { pool: { scope: 'knownUniverse', filter: { cost: { lte: 3 } } } }, to: 'hand' }],
      },
    ],
    triggers: [],
    art: { key: 'aura_mycology', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'power_play',
    name: 'Power Play',
    tier: 'heroic',
    activationCost: 2,
    text: 'Each opponent discards at random. If it was a Points card, add a Warhero Token to your hand.',
    effects: [
      { op: 'discard', target: { who: 'eachOpponent', zone: 'hand', count: 1, pick: 'random' } },
      {
        op: 'conditional',
        if: { has: { target: { who: 'eachOpponent', zone: 'gy', filter: { type: 'Points' } }, atLeast: 1 } },
        then: [{ op: 'createCard', defId: 'warhero_token', to: 'hand' }],
      },
    ],
    triggers: [],
    art: { key: 'aura_power_play', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'imprison',
    name: 'Imprison',
    tier: 'heroic',
    activationCost: 2,
    text: 'Lock a pile costing (5) or less. At the end of your next turn, unlock it and take a card from it.',
    effects: [
      {
        op: 'lockPile',
        target: { shop: 'draft', filter: { cost: { lte: 5 } }, count: 1, pick: 'choose', excludeJlore: true },
        duration: 'untilEndOfYourNextTurn',
      },
      {
        op: 'delayed',
        when: 'endOfNextTurn',
        who: 'self',
        effects: [
          { op: 'unlockPile', target: { shop: 'draft', filter: { cost: { lte: 5 } }, count: 1, pick: 'choose' } },
          { op: 'gainCard', from: { shop: 'draft', filter: { cost: { lte: 5 } }, count: 1, pick: 'choose' }, to: 'gy', free: true },
        ],
      },
    ],
    triggers: [],
    art: { key: 'aura_imprison', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'cloning_gallery',
    name: 'Cloning Gallery',
    tier: 'heroic',
    activationCost: 2,
    text: 'Add a copy of the last card you bought to your GY.',
    effects: [{ op: 'copyCard', target: { who: 'self', zone: 'gy', count: 1, pick: 'lastPlayed' }, to: 'gy' }],
    triggers: [],
    art: { key: 'aura_cloning_gallery', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'ladder_to_heaven',
    name: 'Ladder to Heaven',
    tier: 'heroic',
    activationCost: 2,
    text: 'Add a Truss with +1 VP to your hand.',
    effects: [{ op: 'createCard', defId: 'truss', to: 'hand', statDelta: { vp: 1 } }],
    triggers: [],
    art: { key: 'aura_ladder_to_heaven', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'blessed_by_raza',
    name: 'Blessed by Raza',
    tier: 'heroic',
    activationCost: 2,
    text: '+1 Action, +1 Card. This refreshes whenever you play an Action.',
    effects: [
      { op: 'gain', stat: 'actions', amount: 1 },
      { op: 'draw', amount: 1 },
    ],
    triggers: [
      {
        on: 'onPlay',
        condition: { has: { target: { who: 'self', zone: 'play', filter: { type: 'Action' } }, atLeast: 1 } },
        effects: [{ op: 'activateAura' }],
      },
    ],
    art: { key: 'aura_blessed_by_raza', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'smorc',
    name: 'Smorc',
    tier: 'heroic',
    activationCost: 2,
    text: 'Add a Tix to your hand. The next Tix you buy this turn costs (0).',
    effects: [
      { op: 'createCard', defId: 'tix', to: 'hand' },
      {
        op: 'modifyCost',
        scope: 'nextBuy',
        target: { shop: 'points', filter: { defId: 'tix' } },
        setTo: 0,
        floor: 0,
        duration: 'turn',
      },
    ],
    triggers: [],
    art: { key: 'aura_smorc', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'dead_sea_scroll',
    name: 'Dead Sea Scroll',
    tier: 'heroic',
    activationCost: 2,
    text: '+1 Prophet.',
    effects: [{ op: 'gain', stat: 'prophet', amount: 1 }],
    triggers: [],
    art: { key: 'aura_dead_sea_scroll', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'rugpull',
    name: 'Rugpull',
    tier: 'heroic',
    activationCost: 2,
    text: '+4 Money.',
    effects: [{ op: 'gain', stat: 'money', amount: 4 }],
    triggers: [],
    art: { key: 'aura_rugpull', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },

  // -------------------------------------------------------------------------
  // 9.2 Celestial — persistent, unlimited, fire every turn they are held.
  // -------------------------------------------------------------------------
  {
    id: 'double_header',
    name: 'Double Header',
    tier: 'celestial',
    text: 'Your first buy each turn adds an extra copy to your GY.',
    effects: [],
    triggers: [
      {
        on: 'onBuy',
        maxPerTurn: 1,
        effects: [{ op: 'copyCard', target: { who: 'self', zone: 'gy', count: 1, pick: 'lastPlayed' }, to: 'gy' }],
      },
    ],
    art: { key: 'aura_double_header', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'the_invisible_hand',
    name: 'The Invisible Hand',
    tier: 'celestial',
    text: 'Shop cards cost (2) less for you, to a minimum of (0).',
    effects: [],
    triggers: [
      {
        on: 'startOfTurn',
        effects: [{ op: 'modifyCost', scope: 'allShops', delta: -2, floor: 0, duration: 'turn' }],
      },
    ],
    art: { key: 'aura_the_invisible_hand', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'kwzkis_stimulants',
    name: "Kwzki's Stimulants",
    tier: 'celestial',
    text: '+1 Action and +3 Cards every turn.',
    effects: [],
    triggers: [
      {
        on: 'startOfTurn',
        effects: [
          { op: 'gain', stat: 'actions', amount: 1 },
          { op: 'gain', stat: 'cards', amount: 3 },
        ],
      },
    ],
    art: { key: 'aura_kwzkis_stimulants', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'symphony_of_3',
    name: 'Symphony of 3',
    tier: 'celestial',
    text: 'Every third card you play triggers twice.',
    effects: [],
    triggers: [
      {
        on: 'onPlay',
        condition: { expr: 'floor(cardsPlayedThisTurn / 3) - floor((cardsPlayedThisTurn - 1) / 3)' },
        effects: [{ op: 'multiplyNext', factor: 2, count: 1 }],
      },
    ],
    art: { key: 'aura_symphony_of_3', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'march_of_progress',
    name: 'March of Progress',
    tier: 'celestial',
    text: 'Start of turn: add a random Entire Universe card costing ({currentTurn}) to your hand.',
    effects: [],
    triggers: [
      {
        on: 'startOfTurn',
        effects: [{ op: 'createCard', defId: { pool: { scope: 'entireUniverse' } }, to: 'hand' }],
      },
    ],
    art: { key: 'aura_march_of_progress', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'outstanding_debt',
    name: 'Outstanding Debt',
    tier: 'celestial',
    text: '-X Money for 4 turns, where X = ceil((20 - your unspent Money) / 4).',
    effects: [],
    triggers: [
      {
        on: 'startOfTurn',
        effects: [{ op: 'gain', stat: 'money', amount: { expr: '0 - ceil((20 - moneyUnspent) / 4)' } }],
      },
    ],
    art: { key: 'aura_outstanding_debt', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'in_too_deep',
    name: 'In Too Deep',
    tier: 'celestial',
    text: 'The descent. Complete each floor\'s quest to claim its reward and choose the next room. One instance at a time.',
    effects: [{ op: 'questProgress', key: 'floor', amount: 1 }],
    triggers: [
      { on: 'onBuy', effects: [{ op: 'questProgress', key: 'buys', amount: 1 }] },
      {
        on: 'onBuy',
        condition: { has: { target: { who: 'self', zone: 'gy', filter: { cost: { gte: 8 } } }, atLeast: 1 } },
        effects: [{ op: 'questProgress', key: 'expensiveBuys', amount: 1 }],
      },
      {
        on: 'onBuy',
        condition: { has: { target: { who: 'self', zone: 'gy', filter: { defId: 'diamond' } }, atLeast: 1 } },
        effects: [{ op: 'questProgress', key: 'diamondBuys', amount: 1 }],
      },
      { on: 'onPlay', effects: [{ op: 'questProgress', key: 'plays', amount: 1 }] },
      { on: 'onTrash', effects: [{ op: 'questProgress', key: 'trashes', amount: 1 }] },
      {
        on: 'onDraw',
        effects: [
          { op: 'questProgress', key: 'draws', amount: 1 },
          { op: 'questProgress', key: 'drawsThisTurn', amount: 1 },
        ],
      },
      {
        on: 'endOfTurn',
        condition: { expr: 'floor(moneyUnspent / 12)' },
        effects: [{ op: 'questProgress', key: 'bigUnspentTurns', amount: 1 }],
      },
      {
        on: 'startOfTurn',
        effects: [
          { op: 'questProgress', key: 'diamondsInDeck', amount: { expr: 'count(diamond)' } },
          { op: 'questProgress', key: 'uniqueInDeck', amount: { expr: 'uniqueCardsInDeck' } },
        ],
      },
      { on: 'gameEnd', effects: [{ op: 'questProgress', key: 'wins', amount: 1 }] },
    ],
    art: { key: 'aura_in_too_deep', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'undead_army',
    name: 'Undead Army',
    tier: 'celestial',
    text: 'Cards you play go to the bottom of your Library. Start of turn: +3 Cards, +1 Action.',
    effects: [],
    triggers: [
      {
        on: 'onPlay',
        effects: [{ op: 'moveTo', target: { who: 'self', zone: 'play', count: 1, pick: 'lastPlayed' }, zone: 'library', position: 'bottom' }],
      },
      {
        on: 'startOfTurn',
        effects: [
          { op: 'gain', stat: 'cards', amount: 3 },
          { op: 'gain', stat: 'actions', amount: 1 },
        ],
      },
    ],
    art: { key: 'aura_undead_army', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'market_manipulation',
    name: 'Market Manipulation',
    tier: 'celestial',
    text: 'Money from Resources is doubled, and Resources cost (0) in the Resource Shop.',
    effects: [],
    triggers: [
      {
        on: 'startOfTurn',
        effects: [
          { op: 'multiplyNext', factor: 2, stats: ['money'], count: 99 },
          { op: 'modifyCost', scope: 'resourceShop', setTo: 0, floor: 0, duration: 'turn' },
        ],
      },
    ],
    art: { key: 'aura_market_manipulation', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'yuyas_mythical_portal',
    name: "Yuya's Mythical Portal",
    tier: 'celestial',
    text: 'Start of turn: add 2 Epics and 1 Legendary to your hand, +3 Actions.',
    effects: [],
    triggers: [
      {
        on: 'startOfTurn',
        effects: [
          { op: 'createCard', defId: { pool: { scope: 'entireUniverse', filter: { rarity: 'epic' } } }, to: 'hand', count: 2 },
          { op: 'createCard', defId: { pool: { scope: 'entireUniverse', filter: { rarity: 'legendary' } } }, to: 'hand', count: 1 },
          { op: 'gain', stat: 'actions', amount: 3 },
        ],
      },
    ],
    art: { key: 'aura_yuyas_mythical_portal', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'aspect_of_ares',
    name: 'Aspect of Ares',
    tier: 'celestial',
    text: 'You may play no Action but War!. Gain a War! each turn.',
    effects: [],
    triggers: [
      {
        on: 'startOfTurn',
        effects: [{ op: 'createCard', defId: 'war', to: 'hand' }],
      },
    ],
    art: { key: 'aura_aspect_of_ares', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'oathbound_memory',
    name: 'Oathbound Memory',
    tier: 'celestial',
    text: 'Start of each turn, add a Temporary copy of the bound card to your hand, +1 Action.',
    effects: [],
    triggers: [
      {
        on: 'startOfTurn',
        effects: [
          { op: 'createCard', defId: { pool: { scope: 'knownUniverse' } }, to: 'hand', keywords: ['Temporary'] },
          { op: 'gain', stat: 'actions', amount: 1 },
        ],
      },
    ],
    art: { key: 'aura_oathbound_memory', status: 'final', artist: 'LCM Dreamshaper v7' },
  },

  // -------------------------------------------------------------------------
  // 9.3 Hypercelestial — one at a time.
  // -------------------------------------------------------------------------
  {
    id: 'lotus_solutions',
    name: 'Lotus Solutions',
    tier: 'hypercelestial',
    text: 'After your turn, an AI plays a second turn with your deck.',
    effects: [],
    triggers: [
      {
        on: 'endOfTurn',
        maxPerTurn: 1,
        effects: [{ op: 'extraTurn', who: 'self' }],
      },
    ],
    art: { key: 'aura_lotus_solutions', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'shooting_star',
    name: 'Shooting Star',
    tier: 'hypercelestial',
    text: 'On summon, gain the effect of 3 random Celestial Auras.',
    effects: [
      { op: 'manifestAura', tier: 'celestial', who: 'self' },
      { op: 'manifestAura', tier: 'celestial', who: 'self' },
      { op: 'manifestAura', tier: 'celestial', who: 'self' },
    ],
    triggers: [],
    art: { key: 'aura_shooting_star', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
];

export default auras;
