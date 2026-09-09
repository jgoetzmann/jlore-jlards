/**
 * A.27 — Draft Shop: Lunar and cosmic.
 *
 * Owns the `lunar_fragment` token.
 * SB-23: Arc of the Universe is a flat weighted VP roll, not a 3-D sim.
 * SB-39: Eastern Metaphysics ships with the Vainglorious gate removed.
 *
 * Per-game play counters read `player.playCounts` through the `selfPlayCount`
 * expression variable; `{selfPlayCount}` in `text` prints the live value.
 * It has to be `{selfPlayCount}` and not `{playCount}`: play.ts writes a
 * per-instance `playCount` counter too, and renderCardText checks
 * `inst.counters` before the player-wide fallback, so `{playCount}` freezes at
 * this copy's own play tally once it has been played. `selfPlayCount` is not a
 * counter key, so it always reaches the per-game total.
 * `floor(n/k) - floor((n-1)/k)` is 1 exactly on every kth play;
 * `max(0, 1 - abs(n - k))` is 1 exactly on the kth play.
 */
import type { CardDefinition, Condition, EffectNode, Zone } from '@engine/types';

function onExactPlay(n: number): Condition {
  return { expr: `max(0, 1 - abs(selfPlayCount - ${n}))` };
}

function onEveryNthPlay(n: number): Condition {
  return { expr: `floor(selfPlayCount / ${n}) - floor((selfPlayCount - 1) / ${n})` };
}

/** Where the Astrologists live once trashed, plus the copy still mid-play. */
const ASTROLOGIST_ZONES: Zone[] = ['trash', 'play'];
/** The receipt: one counter on one copy per Lunar Fragment already handed out. */
const ASTROLOGIST_MARK = 'fragmentPaid';
/** Scratch player counters, both recomputed from the table on every run. */
const ASTROLOGIST_TALLY = 'turn:astrologistsTrashed';
const ASTROLOGIST_PAID = 'turn:astrologistsPaid';
/**
 * One Fragment, and only if the ordinal has earned a Fragment nobody has
 * collected. One per run is enough: N trashes fire this N times and only ever
 * owe floor(N / 2), so the arrears always clear.
 */
const ASTROLOGIST_OWED = 'min(1, max(0, floor(astrologistsTrashed / 2) - astrologistsPaid))';

/**
 * The whole of Astrologist: work out the ordinal of the trash that just
 * happened, then pay a Fragment if that ordinal has earned one no copy has
 * already been paid for.
 *
 * Counting, first. The trash is permanent and global — `zoneIds` reads it
 * without an owner — so the number of Astrologists in it IS the number trashed
 * this game, which is the doc row's scope. No expression can count them:
 * `countIn(trash, x)` resolves x through NAMED_FILTERS and there is no
 * registered Astrologist filter, so naming one would read 0 forever. `forEach`
 * walks the instances instead and ticks a player counter, which an expression
 * reads back by name (the `turn:` prefix is stripped). The seed makes the key
 * exist so the reset has a name to read rather than throwing on an unknown
 * identifier; the reset is because the same counter is recomputed many times a
 * turn and must not tally on top of the last run.
 *
 * `play` is in the zone list because the ordinary Flimsy route runs this body
 * BEFORE the trash: core/play.ts resolves the body at step 5 and trashes at
 * step 8, so this copy is still on the table and the trash count is one short
 * of the ordinal it is about to take. Every other route — `{op:'playCard'}`,
 * which calls trashWithTrigger the moment resolveCardPlay returns and so has
 * already trashed the card by the time the queued body runs, and the `onTrash`
 * trigger below — sees it in the trash and nothing in play. Adding the two
 * zones gives the same ordinal on all of them.
 *
 * Paying, second. The receipt is a counter on the copies themselves, not a
 * number on the seat, and that is deliberate: the trash is one shared pile and
 * `CardFilter` cannot ask who owned a card, so a per-seat ledger would let two
 * players each claim arrears for the same global ordinal and the table would
 * pay twice over. Counting marked copies instead makes the ledger as global as
 * the pile it is counting. A payment always marks a copy that was not marked
 * before — `counter: { lt: 1 }` picks one, and there is always one to pick,
 * since the marks can never exceed floor(n / 2) and so never reach n.
 *
 * Both call sites run this identical list, ungated, because a second run over
 * the same table finds nothing owed and creates nothing. That is what makes the
 * card safe on the three routes that fire it more than once for one trash — a
 * `{op:'playCard'}` play (body AND trigger), a batch `{op:'trash'}` where every
 * trigger body resolves after all N cards are already in the trash and so reads
 * the same final count, and a Misery / Around the World replay, which re-fires
 * `onTrash` on a copy trashed turns ago. Under the old parity pair each of
 * those minted a spurious Fragment.
 *
 * Eight nodes plus one per Astrologist on the table, with no per-copy payout
 * loop, so even a batch trash of the whole pile stays inside the 200-node turn
 * budget.
 */
function astrologistPayout(): EffectNode[] {
  const astrologists = { who: 'self' as const, zone: ASTROLOGIST_ZONES, filter: { defId: 'astrologist' } };
  return [
    { op: 'addCounter', scope: 'player', key: ASTROLOGIST_TALLY, amount: 0 },
    { op: 'addCounter', scope: 'player', key: ASTROLOGIST_TALLY, amount: { expr: '0 - astrologistsTrashed' } },
    {
      op: 'forEach',
      over: astrologists,
      effects: [{ op: 'addCounter', scope: 'player', key: ASTROLOGIST_TALLY, amount: 1 }],
    },
    { op: 'addCounter', scope: 'player', key: ASTROLOGIST_PAID, amount: 0 },
    { op: 'addCounter', scope: 'player', key: ASTROLOGIST_PAID, amount: { expr: '0 - astrologistsPaid' } },
    {
      op: 'forEach',
      over: { ...astrologists, filter: { defId: 'astrologist', counter: { key: ASTROLOGIST_MARK, gte: 1 } } },
      effects: [{ op: 'addCounter', scope: 'player', key: ASTROLOGIST_PAID, amount: 1 }],
    },
    // Hand it over, then write the receipt. Nothing between the two touches
    // either counter, so both read the same `owed`; the receipt goes onto an
    // unmarked copy so the mark count rises by exactly the Fragments paid.
    { op: 'createCard', defId: 'lunar_fragment', to: 'hand', count: { expr: ASTROLOGIST_OWED } },
    {
      op: 'addCounter',
      target: { ...astrologists, filter: { defId: 'astrologist', counter: { key: ASTROLOGIST_MARK, lt: 1 } }, count: 1 },
      key: ASTROLOGIST_MARK,
      amount: { expr: ASTROLOGIST_OWED },
    },
  ];
}

export const cards: CardDefinition[] = [
  {
    id: 'lunar_fragment',
    name: 'Lunar Fragment',
    cost: { money: 6 },
    types: ['Action', 'Token'],
    subtypes: ['Lunar Fragment'],
    tags: [],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: { money: 3, buys: 3, actions: 3, cards: 3, vp: 3, prophet: 3 },
    effects: [],
    triggers: [],
    text: 'Flimsy. +3 to all six stats.',
    flavor: 'A chip off the old rock.',
    complexity: 'T1',
    subsystems: ['S-TOKEN'],
    notPurchasable: true,
    art: { key: 'lunar_fragment', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'journey_to_the_moon',
    name: 'Journey to the Moon',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    effects: [
      {
        op: 'conditional',
        if: onExactPlay(25),
        then: [
          { op: 'createCard', defId: 'lunar_fragment', to: 'library', count: 10, position: 'random' },
          { op: 'shuffle', zone: 'library', who: 'self' },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action, +1 Card. On the 25th play of this card this game, shuffle 10 Lunar Fragments into your deck. ({selfPlayCount}/25)',
    complexity: 'T4',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'journey_to_the_moon', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'shuffle' },
  },
  {
    id: 'astrologist',
    name: 'Astrologist',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    // Flimsy means playing this IS trashing it, and the play-cleanup trash in
    // core/play.ts calls `trashInstance` directly, so it raises no 'onTrash'.
    // The body therefore carries the ordinary case and the trigger below
    // carries every other route into the trash. Both run the same list, and it
    // is safe to run twice for one trash — see `astrologistPayout`.
    effects: [...astrologistPayout()],
    triggers: [
      {
        // No `zones`: an 'onTrash' trigger is dispatched to the instance it
        // happened to, and by the time it fires that instance is in the trash —
        // any zone list at all would exclude the only zone it can be in.
        on: 'onTrash',
        effects: [...astrologistPayout()],
      },
    ],
    text: 'Flimsy. +1 Action. On every even-numbered Astrologist trashed this game, add a Lunar Fragment to hand.',
    complexity: 'T4',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'astrologist', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'moon_dance',
    name: 'Moon Dance',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'delayed',
        when: { inTurns: 3 },
        effects: [{ op: 'createCard', defId: 'lunar_fragment', to: 'hand' }],
        who: 'self',
      },
    ],
    triggers: [],
    text: 'Flimsy. At the start of your 3rd turn from now, add a Lunar Fragment to your hand.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'moon_dance', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'space_race',
    name: 'Space Race',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: ['Lunar Fragment'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { money: 3, buys: 3, actions: 3, cards: 3, vp: 3, prophet: 3 },
    effects: [{ op: 'createCard', defId: 'lunar_fragment', to: 'gy', who: 'chosenOpponent' }],
    triggers: [],
    // `who:'chosenOpponent'` raises no prompt from createCard: it resolves to
    // the opponent with the most VP, which the doc row's "an opponent" allows.
    text: '+3 to all six stats. The opponent with the most VP also gets a Lunar Fragment.',
    complexity: 'T2',
    subsystems: ['S-TOKEN'],
    shop: 'draft',
    art: { key: 'space_race', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'wish_upon_the_stars',
    name: 'Wish Upon the Stars',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    effects: [
      {
        op: 'conditional',
        if: onExactPlay(100),
        then: [{ op: 'manifestAura', tier: 'hypercelestial', auraId: 'shooting_star', who: 'self' }],
      },
    ],
    triggers: [],
    text: '+1 Action, +1 Card. On the 100th play of this card this game, summon the Hypercelestial Aura Shooting Star. ({selfPlayCount}/100)',
    complexity: 'T4',
    subsystems: ['S-PERSIST', 'S-AURA'],
    shop: 'draft',
    art: { key: 'wish_upon_the_stars', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'runebinder_of_jlore',
    name: 'Runebinder of Jlore',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'conditional',
        if: {
          any: [
            onExactPlay(7),
            onExactPlay(9),
            onExactPlay(13),
            onExactPlay(14),
            onExactPlay(18),
            onExactPlay(21),
            onExactPlay(26),
            onExactPlay(27),
            onExactPlay(28),
          ],
        },
        then: [{ op: 'createCard', defId: 'jlore', to: 'gy' }],
      },
      { op: 'moveTo', target: { self: true }, zone: 'library', position: 'top' },
    ],
    triggers: [],
    text:
      '+1 Action. Put this on top of your Library after playing it. Add a Jlore to your GY on the 7th, 9th, 13th, ' +
      '14th, 18th, 21st, 26th, 27th and 28th play of this card this game. ({selfPlayCount} plays.)',
    complexity: 'T4',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'runebinder_of_jlore', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'arc_of_the_universe',
    name: 'Arc of the Universe',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'mythic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'random',
        branches: [
          { weight: 1, effects: [{ op: 'gain', stat: 'vp', amount: 999 }], displayAs: 'The Center of the Universe. +999 VP.' },
          { weight: 9, effects: [{ op: 'gain', stat: 'vp', amount: 25 }], displayAs: 'Near alignment. +25 VP.' },
          { weight: 90, effects: [{ op: 'gain', stat: 'vp', amount: 3 }], displayAs: 'The arc drifts. +3 VP.' },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action. Align with the Center of the Universe: 90% +3 VP, 9% +25 VP, 1% +999 VP.',
    flavor: 'Someone, somewhere, hits it.',
    complexity: 'T4',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'arc_of_the_universe', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
  {
    id: 'eastern_metaphysics',
    name: 'Eastern Metaphysics',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    // The tally has to sit under 'charges': `selfCounter` reads a named counter
    // only for 'counter' / 'uses' / 'charges' and otherwise sums every counter
    // on the instance, which meant the Auras were counted together with
    // `playCount` and the payoff fired on the second play.
    effects: [
      { op: 'addCounter', target: { self: true }, key: 'charges', amount: 1 },
      {
        op: 'conditional',
        if: { expr: 'floor(selfCounter / 3)' },
        then: [
          { op: 'addCounter', target: { self: true }, key: 'charges', amount: -3 },
          {
            op: 'choose',
            options: [
              { label: 'Positive: +3 Actions, +3 Cards', effects: [{ op: 'gain', stat: 'actions', amount: 3 }, { op: 'draw', amount: 3 }] },
              { label: 'Positive: +6 Money', effects: [{ op: 'gain', stat: 'money', amount: 6 }] },
              { label: 'Negative: each opponent discards down to 3 cards', effects: [{ op: 'discardDownTo', amount: 3, who: 'eachOpponent' }] },
              {
                label: 'Negative: trash a card from an opponent\'s GY and take a Lunar Fragment',
                effects: [
                  { op: 'trash', target: { who: 'chosenOpponent', zone: 'gy', count: 1, pick: 'mostExpensive' } },
                  { op: 'createCard', defId: 'lunar_fragment', to: 'hand' },
                ],
              },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text:
      'Track the last 3 Auras from Actions you play; each owned Action is assigned a Positive or Negative Aura. ' +
      'Consume 3 Auras for one of four payoffs. ({charges}/3 Auras.)',
    complexity: 'T4',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'eastern_metaphysics', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  // A.27 lists Constellation and Star Aligner as cross-references — both rows
  // read "(see A.10)" — not as second cards. Their definitions live in
  // `archetypes/victory.ts`.
];

export default cards;
