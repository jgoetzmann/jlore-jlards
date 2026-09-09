/**
 * §9 + B.4 — every Aura in the game.
 *
 * 11 Heroic (activationCost 2, once per turn), 12 Celestial (persistent,
 * unlimited), 2 Hypercelestial (one at a time).
 *
 * B.4's In Too Deep floors are NOT here. They are engine data, not card data,
 * and live in `src/engine/meta/quest.ts` as `questFloors` — the table that
 * `getFloor`, `questProgress` and `questStartOfTurn` actually read. A second
 * copy used to sit in this file, exported but imported by nobody, so an edit
 * made here landed on a table the game never consulted.
 */
import type { AuraDefinition } from '@engine/types';

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
      // Swept before the Discover, not after it: a pool too small to offer two
      // options leaves one marked card behind, and it must not be dragged into
      // the next activation's merge.
      {
        op: 'addCounter',
        target: { zone: 'hand', filter: { counter: { key: 'mycology', gte: 1 } } },
        key: 'mycology',
        amount: -1,
      },
      {
        op: 'discover',
        pool: { scope: 'knownUniverse', filter: { cost: { lte: 3 } } },
        count: 3,
        pick: 2,
        prompt: 'Discover two cards',
        // `then` runs once per pick with `$discovered` swapped for the card the
        // player actually chose — writing the pool spec again here would have
        // re-rolled it and delivered two fresh strangers. The counter is how the
        // Fuse finds exactly these two and not the rest of the hand.
        //
        // The Fuse rides the LAST pick (`x` is the 0-based pick index) rather
        // than sitting after the Discover: a resume drains the parked queue
        // between picks, so a node written after the prompt would have run with
        // only the first card on the table and merged nothing. Clearing the mark
        // is part of the same step — the composite is the first component reused
        // in place, counters and all.
        then: [
          { op: 'createCard', defId: '$discovered', to: 'hand', counters: { mycology: 1 } },
          {
            op: 'conditional',
            if: { expr: 'x' },
            then: [
              { op: 'fuse', target: { zone: 'hand', filter: { counter: { key: 'mycology', gte: 1 } } }, to: 'hand' },
              {
                op: 'addCounter',
                target: { zone: 'hand', filter: { counter: { key: 'mycology', gte: 1 } } },
                key: 'mycology',
                amount: -1,
              },
            ],
          },
        ],
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
    // B.4 is engine data, not card data. Manifesting this aura seeds `p.quest`
    // at floor 1 (meta/auras.ts) and the buy / play / trash / draw / end-of-turn
    // paths call meta/quest.ts's questProgress, the only thing that settles a
    // floor and pays its reward. The triggers that used to stand here called
    // {op:'questProgress'}, which only writes `p.quest.progress` under key names
    // no floor reads and never settles anything — and their two onBuy conditions
    // asked "do I hold any (8)+ card" rather than "is the card I just bought
    // one", which an aura context (sourceIid === null) cannot ask at all.
    // Deleted rather than left to burn node budget on every draw.
    effects: [],
    triggers: [],
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
    // The start-of-turn payout is machinery, not data: `auraStartOfTurn`
    // (meta/auras.ts) reads this instance's `boundDefId` — the card Infini
    // Scepter bound it to — and runs `oathboundEffects`, which is exactly the
    // printed line, a Temporary copy of THAT card plus +1 Action.
    // A `startOfTurn` trigger here does not replace that half, it runs in
    // ADDITION to it, in the same window, a few lines further down the same
    // loop. So the trigger that used to sit here made the aura pay twice every
    // turn: measured, one turn with the aura bound to a card produced two
    // Temporary cards in hand (the bound one and a random Known Universe
    // stranger, because a data trigger cannot read `boundDefId`) and +2
    // Actions. Deleted; the engine half is the one §9.2 describes.
    effects: [],
    triggers: [],
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
    // An aura's `effects` array is only ever run by activateAura, and
    // canActivateAura refuses a non-heroic aura with no activationCost, so the
    // three manifests sat here unreachable. There is no onManifest event, but
    // play.ts fires the Field's onPlay triggers in step 7 — after the card body
    // in step 5 that summoned this — so the summoning play itself is the window.
    // Giving it an activationCost instead would turn "on summon" into a
    // repeatable once-per-turn purchase, which is worse than inert.
    effects: [],
    triggers: [
      {
        on: 'onPlay',
        maxPerTurn: 1,
        // Once per game, not once per turn. `shootingStarSummons` is a player
        // counter; while it has never been written the expression names an
        // unknown identifier, which evalCondition scores as false, and `not`
        // turns that into "this has never happened" — the same answer it gives
        // once the counter exists and reads 0. The increment inside is what
        // closes the gate for good.
        condition: { not: { expr: 'shootingStarSummons' } },
        effects: [
          { op: 'addCounter', scope: 'player', key: 'shootingStarSummons', amount: 1, who: 'self' },
          { op: 'manifestAura', tier: 'celestial', who: 'self' },
          { op: 'manifestAura', tier: 'celestial', who: 'self' },
          { op: 'manifestAura', tier: 'celestial', who: 'self' },
        ],
      },
    ],
    art: { key: 'aura_shooting_star', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
];

export default auras;
