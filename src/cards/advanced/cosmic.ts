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
import type { CardDefinition, Condition } from '@engine/types';

function onExactPlay(n: number): Condition {
  return { expr: `max(0, 1 - abs(selfPlayCount - ${n}))` };
}

function onEveryNthPlay(n: number): Condition {
  return { expr: `floor(selfPlayCount / ${n}) - floor((selfPlayCount - 1) / ${n})` };
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
    art: { key: 'lunar_fragment', status: 'placeholder', anim: 'summon' },
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
    art: { key: 'journey_to_the_moon', status: 'placeholder', anim: 'shuffle' },
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
    // Flimsy means playing this IS trashing it, and the play-cleanup trash
    // raises no 'onTrash' — so the clause lives in the body, where it can count
    // Astrologists. `selfPlayCount` is the per-game, per-player total and is
    // bumped before the body runs, so an even value is an even-numbered trash.
    // A per-instance counter cannot do it: each copy is trashed at most once,
    // and `selfCounter` under any other key sums `playCount` in as well.
    // That makes the clause narrower than the doc row's "trashed this game":
    // it counts the copies YOU PLAY, so a copy another card trashes out of
    // hand does not tick and neither does an opponent's. The text says so.
    effects: [
      {
        op: 'conditional',
        if: { not: { expr: 'selfPlayCount % 2' } },
        then: [{ op: 'createCard', defId: 'lunar_fragment', to: 'hand' }],
      },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action. On every 2nd Astrologist you play this game — Flimsy trashes it — add a Lunar Fragment to your hand. ({selfPlayCount} played.)',
    complexity: 'T4',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'astrologist', status: 'placeholder' },
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
    art: { key: 'moon_dance', status: 'placeholder' },
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
    art: { key: 'space_race', status: 'placeholder' },
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
    art: { key: 'wish_upon_the_stars', status: 'placeholder' },
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
    art: { key: 'runebinder_of_jlore', status: 'placeholder' },
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
    art: { key: 'arc_of_the_universe', status: 'placeholder', anim: 'explode' },
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
    art: { key: 'eastern_metaphysics', status: 'placeholder' },
  },
  // A.27 lists Constellation and Star Aligner as cross-references — both rows
  // read "(see A.10)" — not as second cards. Their definitions live in
  // `archetypes/victory.ts`.
];

export default cards;
