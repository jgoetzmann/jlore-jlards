/**
 * A.23 — Draft Shop: Combo, Ricochet and variable stat blocks.
 *
 * Slice S9 (cards-advanced). Authoring contract: `stats` carries every plain
 * stat line; only non-stat behaviour lives in `effects`.
 */
import type { CardDefinition, EffectNode, StatKey } from '@engine/types';

/**
 * A reroll REPLACES last turn's value, but every primitive that writes one adds
 * to it: applyBuff bumps an instance statDelta that nothing ever expires, and
 * addCounter is bumpCounter. So each branch books its own undo for the end of
 * the turn it rolled on. SB-25 freezes the values mid-turn anyway, so the card
 * reads its fresh roll all turn and is back at zero before the next one.
 */
function undoAtEndOfTurn(effects: EffectNode[]): EffectNode {
  return { op: 'delayed', when: 'endOfTurn', effects };
}

/** SB-25: cost rerolls in [2,10] inclusive, at start of turn only. */
function costRerollBranches(): { weight: number; effects: EffectNode[] }[] {
  const out: { weight: number; effects: EffectNode[] }[] = [];
  for (let n = 2; n <= 10; n++) {
    out.push({
      weight: 1,
      effects: [
        {
          op: 'modifyCost',
          scope: 'pile',
          target: { shop: 'draft', filter: { defId: 'too_many_stats' } },
          setTo: n,
          floor: 0,
          duration: 'turn',
        },
        { op: 'addCounter', target: { self: true }, key: 'rolledCost', amount: n },
        undoAtEndOfTurn([{ op: 'addCounter', target: { self: true }, key: 'rolledCost', amount: -n }]),
      ],
    });
  }
  return out;
}

/** SB-25: all six stats reroll in [-3, 3]. */
function statRerollBranches(stat: StatKey, counterKey: string): { weight: number; effects: EffectNode[] }[] {
  const out: { weight: number; effects: EffectNode[] }[] = [];
  for (let d = -3; d <= 3; d++) {
    const effects: EffectNode[] = [
      { op: 'addCounter', target: { self: true }, key: counterKey, amount: d },
    ];
    const undo: EffectNode[] = [
      { op: 'addCounter', target: { self: true }, key: counterKey, amount: -d },
    ];
    if (d > 0) {
      effects.push({ op: 'buff', scope: 'instance', target: { self: true }, stat, amount: 1, times: d });
      undo.push({ op: 'nerf', scope: 'instance', target: { self: true }, stat, amount: 1, times: d });
    } else if (d < 0) {
      effects.push({ op: 'nerf', scope: 'instance', target: { self: true }, stat, amount: 1, times: -d });
      undo.push({ op: 'buff', scope: 'instance', target: { self: true }, stat, amount: 1, times: -d });
    }
    effects.push(undoAtEndOfTurn(undo));
    out.push({ weight: 1, effects });
  }
  return out;
}

/**
 * SB-25: Big Action rerolls in [1, 3]. `counters.bigAction` is the engine's
 * per-instance Big Action override (bigActionCost reads it ahead of
 * def.bigAction), so the roll goes straight there rather than to a counter
 * nothing reads.
 */
function bigActionRerollBranches(): { weight: number; effects: EffectNode[] }[] {
  return [1, 2, 3].map((n) => ({
    weight: 1,
    effects: [
      { op: 'addCounter', target: { self: true }, key: 'bigAction', amount: n },
      undoAtEndOfTurn([{ op: 'addCounter', target: { self: true }, key: 'bigAction', amount: -n }]),
    ] as EffectNode[],
  }));
}

/**
 * SB-25: Combo and Recruit both reroll in [1, 3], and both have to be legible
 * to an expression when the card is played. buildVars exposes exactly ONE
 * instance counter to expressions — the one keyed `counter`; every other key
 * folds into a sum — so the pair is packed into it as `combo * 10 + recruit`
 * and unpacked with floor/% in the card body. `rolledCombo` and `rolledRecruit`
 * ride alongside purely so the printed text can show this turn's roll.
 */
function comboRecruitRerollBranches(): { weight: number; effects: EffectNode[] }[] {
  const out: { weight: number; effects: EffectNode[] }[] = [];
  for (const combo of [1, 2, 3]) {
    for (const recruit of [1, 2, 3]) {
      const packed = combo * 10 + recruit;
      out.push({
        weight: 1,
        effects: [
          { op: 'addCounter', target: { self: true }, key: 'counter', amount: packed },
          { op: 'addCounter', target: { self: true }, key: 'rolledCombo', amount: combo },
          { op: 'addCounter', target: { self: true }, key: 'rolledRecruit', amount: recruit },
          undoAtEndOfTurn([
            { op: 'addCounter', target: { self: true }, key: 'counter', amount: -packed },
            { op: 'addCounter', target: { self: true }, key: 'rolledCombo', amount: -combo },
            { op: 'addCounter', target: { self: true }, key: 'rolledRecruit', amount: -recruit },
          ]),
        ],
      });
    }
  }
  return out;
}

function dynamicStatAllocation(id: string, name: string, price: number, x: number): CardDefinition {
  return {
    id,
    name,
    cost: { money: price },
    types: ['Action'],
    subtypes: ['Dynamic'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { money: x, buys: x, actions: x, cards: x, vp: x, prophet: x },
    effects: [
      {
        op: 'conditional',
        if: { combo: x },
        then: [{ op: 'recruit', zone: 'library', count: x, who: 'self', to: 'hand' }],
      },
    ],
    triggers: [],
    text: `Big Action ${x}, Combo ${x}, Recruit ${x}. +${x} to all six stats.`,
    flavor: 'Allocate responsibly.',
    complexity: 'T4',
    subsystems: ['S-COMBO', 'S-BIGACTION'],
    shop: 'draft',
    bigAction: x,
    art: { key: id, status: 'final', artist: 'LCM Dreamshaper v7' },
  };
}

export const cards: CardDefinition[] = [
  {
    id: 'group_leader',
    name: 'Group Leader',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    effects: [
      {
        op: 'conditional',
        if: { combo: 1 },
        then: [
          { op: 'gain', stat: 'actions', amount: 1 },
          { op: 'draw', amount: 1 },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action, +1 Card. Combo 1: cast this twice.',
    flavor: 'Somebody has to hold the clipboard.',
    complexity: 'T3',
    subsystems: ['S-COMBO', 'S-MULTIPLIER'],
    shop: 'draft',
    art: { key: 'group_leader', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'experience_dividend',
    name: 'Experience Dividend',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'conditional',
        if: { combo: 1 },
        then: [{ op: 'gain', stat: 'money', amount: { expr: 'comboCount' } }],
      },
    ],
    triggers: [],
    // `comboCount` is an expression variable, not a text token: renderCardText
    // resolves counters/secrets/stats and falls through to '0', so the
    // parenthetical always printed "(Combo is at 0.)". The payout itself is fine.
    text: '+1 Action. Combo X: +X Money.',
    complexity: 'T3',
    subsystems: ['S-COMBO'],
    shop: 'draft',
    art: { key: 'experience_dividend', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'crime_wave',
    name: 'Crime Wave',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 2 },
    effects: [
      {
        op: 'conditional',
        if: { combo: 3 },
        then: [{ op: 'moveTo', target: { self: true }, zone: 'hand' }],
      },
      { op: 'resetCombo' },
    ],
    triggers: [],
    text: '+2 Actions. Combo 3: return this to your hand. Then reset your Combo.',
    flavor: 'Everybody was doing it.',
    complexity: 'T3',
    subsystems: ['S-COMBO'],
    shop: 'draft',
    art: { key: 'crime_wave', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'wombo_combo',
    name: 'Wombo Combo',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'conditional',
        if: { combo: 1 },
        then: [
          // The tally is keyed `counter` on purpose: buildVars exposes exactly
          // one instance counter to expressions, and it is that key. Every
          // other name reads back as the SUM of every counter on the instance
          // (playCount included), which is not a clause count.
          { op: 'addCounter', target: { self: true }, key: 'counter', amount: 1 },
          {
            // The COUNT is cumulative, the clauses are not: the tally grows
            // by one per Combo 1 play and that many clauses resolve, but each
            // one is rolled fresh. Keeping a chosen clause would need the
            // engine's real primitive (stealComboClause -> inst.extraEffects),
            // which no op is wired to, so these five stand in for "a random
            // Combo clause" and the text promises no stable absorbed set.
            op: 'repeat',
            times: { expr: 'selfCounter' },
            effects: [
              {
                op: 'random',
                branches: [
                  {
                    weight: 1,
                    effects: [
                      { op: 'gain', stat: 'actions', amount: 1 },
                      { op: 'draw', amount: 1 },
                    ],
                  },
                  { weight: 1, effects: [{ op: 'gain', stat: 'money', amount: { expr: 'comboCount' } }] },
                  {
                    weight: 1,
                    effects: [
                      { op: 'moveTo', target: { who: 'self', zone: 'play', filter: { type: 'Action' }, count: 1, pick: 'random' }, zone: 'hand' },
                      { op: 'gain', stat: 'actions', amount: 1 },
                    ],
                  },
                  { weight: 1, effects: [{ op: 'gain', stat: 'buys', amount: 2 }] },
                  { weight: 1, effects: [{ op: 'gain', stat: 'cards', amount: 2 }] },
                ],
              },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action. Combo 1: resolve a random Combo clause, once for every time this card has done so. ({counter} so far.)',
    complexity: 'T4',
    subsystems: ['S-COMBO', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'wombo_combo', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'ricochet',
    name: 'Ricochet',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: ['Ricochet'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: { combo: 3 },
        then: [
          { op: 'addCounter', target: { self: true }, key: 'ricochetUsedThisTurn', amount: 1 },
          { op: 'moveTo', target: { who: 'self', zone: 'play', filter: { type: 'Action' }, count: 1, pick: 'random' }, zone: 'hand' },
          { op: 'gain', stat: 'actions', amount: 1 },
        ],
      },
    ],
    triggers: [],
    text: 'Combo 3: return a random Action you played this turn to your hand, +1 Action. One Ricochet per turn.',
    complexity: 'T3',
    subsystems: ['S-COMBO'],
    shop: 'draft',
    art: { key: 'ricochet', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'ricochet_plus',
    name: 'Ricochet+',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: ['Ricochet'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: { combo: 3 },
        then: [
          { op: 'addCounter', target: { self: true }, key: 'ricochetUsedThisTurn', amount: 1 },
          { op: 'moveTo', target: { who: 'self', zone: 'play', filter: { type: 'Action' }, count: 2, pick: 'random' }, zone: 'hand' },
          { op: 'gain', stat: 'actions', amount: 2 },
        ],
      },
    ],
    triggers: [],
    text: 'Combo 3: return 2 different Actions you played this turn to your hand, +2 Actions. One Ricochet per turn.',
    complexity: 'T3',
    subsystems: ['S-COMBO'],
    shop: 'draft',
    art: { key: 'ricochet_plus', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'ricochet_plus_plus',
    name: 'Ricochet++',
    cost: { money: 8 },
    types: ['Action'],
    subtypes: ['Ricochet'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: { combo: 3 },
        then: [
          { op: 'addCounter', target: { self: true }, key: 'ricochetUsedThisTurn', amount: 1 },
          { op: 'moveTo', target: { who: 'self', zone: 'play', filter: { type: 'Action' }, count: 3, pick: 'random' }, zone: 'hand' },
          { op: 'gain', stat: 'actions', amount: 3 },
        ],
      },
    ],
    triggers: [],
    text: 'Combo 3: return 3 different Actions you played this turn to your hand, +3 Actions. One Ricochet per turn.',
    complexity: 'T3',
    subsystems: ['S-COMBO'],
    shop: 'draft',
    art: { key: 'ricochet_plus_plus', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'money_moves',
    name: 'Money Moves',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['PlayOnBuy'],
    stats: { actions: 2 },
    effects: [],
    triggers: [],
    text: 'Play on Buy. +2 Actions.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'money_moves', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'holy_topdeck',
    name: 'Holy Topdeck',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 1 },
    effects: [
      {
        op: 'repeat',
        times: 5,
        effects: [
          {
            op: 'random',
            branches: [
              { weight: 1, effects: [{ op: 'gain', stat: 'actions', amount: 1 }] },
              { weight: 1, effects: [{ op: 'gain', stat: 'buys', amount: 1 }] },
              { weight: 1, effects: [{ op: 'draw', amount: 1 }] },
              { weight: 1, effects: [{ op: 'gain', stat: 'money', amount: 1 }] },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: '+1 Card, then gain a random mix of Actions, Buys, Cards and Money totalling this card\'s cost.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'holy_topdeck', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'boots_on_the_ground',
    name: 'Boots on the Ground',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    effects: [
      {
        op: 'conditional',
        if: { not: { combo: 2 } },
        then: [
          { op: 'gain', stat: 'actions', amount: 1 },
          { op: 'draw', amount: 1 },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action, +1 Card. Repeat this if it was the first card you played this turn.',
    complexity: 'T2',
    subsystems: ['S-COMBO'],
    shop: 'draft',
    art: { key: 'boots_on_the_ground', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'insidious_initiation',
    name: 'Insidious Initiation',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { who: 'self', zone: 'hand', filter: { defId: 'insidious_initiation' } }, atLeast: 1 } },
        then: [
          { op: 'discard', target: { who: 'self', zone: 'hand', filter: { defId: 'insidious_initiation' }, count: 1, pick: 'choose' } },
          { op: 'gain', stat: 'actions', amount: 2 },
          { op: 'draw', amount: 2 },
        ],
      },
    ],
    triggers: [],
    text: 'Discard another Insidious Initiation: +2 Actions, +2 Cards.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'insidious_initiation', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'full_house',
    name: 'Full House',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { who: 'self', zone: 'hand', filter: { defId: 'full_house' } }, atLeast: 1 } },
        then: [
          { op: 'discard', target: { who: 'self', zone: 'hand', filter: { defId: 'full_house' }, count: 1, pick: 'choose' } },
          { op: 'draw', amount: 5 },
          { op: 'gain', stat: 'money', amount: 5 },
        ],
      },
    ],
    triggers: [],
    text: 'Discard a Full House for +5 Cards and +5 Money. +1 Action.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'full_house', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'another_round',
    name: 'Another Round?',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 1, money: 1 },
    // "Until end of turn" has to be written by hand: an instance Buff is a
    // permanent statDelta and the buff node carries no duration, so each of the
    // two cards also books its own end-of-turn Nerf. The forEach is what binds
    // {self:true} — and therefore the delayed reversal — to the same instance
    // that was buffed, wherever it has moved to by then.
    effects: [
      {
        op: 'forEach',
        over: { who: 'self', zone: 'library', count: 2, pick: 'top' },
        effects: [
          { op: 'buff', scope: 'instance', target: { self: true }, stat: 'cards', amount: 1 },
          { op: 'buff', scope: 'instance', target: { self: true }, stat: 'money', amount: 1 },
          {
            op: 'delayed',
            when: 'endOfTurn',
            effects: [
              { op: 'nerf', scope: 'instance', target: { self: true }, stat: 'cards', amount: 1 },
              { op: 'nerf', scope: 'instance', target: { self: true }, stat: 'money', amount: 1 },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'The top 2 cards of your Library get +1 Card and +1 Money until end of turn. +1 Card, +1 Money.',
    flavor: 'One more, then we go.',
    complexity: 'T3',
    subsystems: ['S-BUFF'],
    shop: 'draft',
    art: { key: 'another_round', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'vault',
    name: 'Vault',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [{ op: 'createCard', defId: 'diamond', to: 'hand', count: 2 }],
    triggers: [],
    text: 'Big Action 5, Flimsy. Add two Diamonds to your hand.',
    complexity: 'T3',
    subsystems: ['S-BIGACTION'],
    shop: 'draft',
    bigAction: 5,
    art: { key: 'vault', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'safe',
    name: 'Safe',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [{ op: 'createCard', defId: 'gold', to: 'hand', count: 2 }],
    triggers: [],
    text: 'Big Action 4, Flimsy. Add two Gold to your hand.',
    complexity: 'T3',
    subsystems: ['S-BIGACTION'],
    shop: 'draft',
    bigAction: 4,
    art: { key: 'safe', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'silver_stash',
    name: 'Silver Stash',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: ['Flimsy'],
    stats: {},
    effects: [{ op: 'createCard', defId: 'silver', to: 'hand', count: 2 }],
    triggers: [],
    text: 'Big Action 3, Flimsy. Add two Silver to your hand.',
    complexity: 'T3',
    subsystems: ['S-BIGACTION'],
    shop: 'draft',
    bigAction: 3,
    art: { key: 'silver_stash', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'moon_rock',
    name: 'Moon Rock',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [{ op: 'createCard', defId: 'lunar_fragment', to: 'hand', count: 1 }],
    triggers: [],
    text: 'Big Action 3. Add a Lunar Fragment to your hand.',
    complexity: 'T3',
    subsystems: ['S-BIGACTION'],
    shop: 'draft',
    bigAction: 3,
    art: { key: 'moon_rock', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  // A.23 prints one row — "6 / 8 / 10 ... X = 2/3/4 by purchase price" — as
  // three purchasable cards. B103 forbids two definitions sharing a name, so
  // the two dearer ones carry a numeral; the cheapest keeps the doc's own name.
  dynamicStatAllocation('dynamic_stat_allocation', 'Dynamic Stat Allocation', 6, 2),
  dynamicStatAllocation('dynamic_stat_allocation_iii', 'Dynamic Stat Allocation III', 8, 3),
  dynamicStatAllocation('dynamic_stat_allocation_iv', 'Dynamic Stat Allocation IV', 10, 4),
  {
    id: 'too_many_stats',
    name: 'Too Many Stats',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'legendary',
    keywords: [],
    stats: { money: 0, buys: 0, actions: 0, cards: 0, vp: 0, prophet: 0 },
    // Both halves come out of the packed `counter` written at start of turn:
    // the tens digit is this turn's Combo requirement, the units digit is this
    // turn's Recruit count. Condition.combo only takes a literal, so the gate
    // is spelled as an expression instead. A bare {expr:'selfCounter'} Recruit
    // was the SUM of every counter on the card and grew all match.
    effects: [
      {
        op: 'conditional',
        if: { expr: 'comboCount >= floor(selfCounter / 10)' },
        then: [{ op: 'recruit', zone: 'library', count: { expr: 'selfCounter % 10' }, who: 'self', to: 'hand' }],
      },
    ],
    triggers: [
      {
        on: 'startOfTurn',
        effects: [
          { op: 'random', branches: costRerollBranches() },
          { op: 'random', branches: statRerollBranches('money', 'rolledMoney') },
          { op: 'random', branches: statRerollBranches('buys', 'rolledBuys') },
          { op: 'random', branches: statRerollBranches('actions', 'rolledActions') },
          { op: 'random', branches: statRerollBranches('cards', 'rolledCards') },
          { op: 'random', branches: statRerollBranches('vp', 'rolledVp') },
          { op: 'random', branches: statRerollBranches('prophet', 'rolledProphet') },
          { op: 'random', branches: bigActionRerollBranches() },
          { op: 'random', branches: comboRecruitRerollBranches() },
        ],
      },
    ],
    text:
      'At the start of every turn, every value on this card rerolls: cost {rolledCost}, Big Action {bigAction}, ' +
      'Combo {rolledCombo}, Recruit {rolledRecruit}, and all six stats between -3 and 3. Values never change mid-turn.',
    flavor: 'The designer has been asked to stop.',
    complexity: 'T4',
    subsystems: ['S-BUFF', 'S-BIGACTION', 'S-COMBO', 'S-PERSIST'],
    shop: 'draft',
    bigAction: 2,
    art: { key: 'too_many_stats', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'synchro_summon',
    name: 'Synchro Summon',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: ['Summon'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    // A `selectCards` `then` runs once per selected card, so the old min/max 2
    // wrapper raised two separate choose-2 discards (four cards) and Recruited
    // twice. The discard prompt IS the selection; the conditional keeps the
    // Recruit contingent on there being two cards to pay with.
    // The "same cost" / "of that cost" linkage stays unwritten: CardFilter.cost
    // is a NumericFilter of literal numbers and nothing binds a discarded
    // card's cost into scope, so the text no longer promises it.
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { who: 'self', zone: 'hand' }, atLeast: 2 } },
        then: [
          { op: 'discard', target: { who: 'self', zone: 'hand', count: 2, pick: 'choose' } },
          { op: 'recruit', zone: 'library', filter: { type: 'Action' }, count: 1, who: 'self', to: 'hand' },
        ],
      },
    ],
    triggers: [],
    text: 'Discard 2 cards to Recruit an Action. +1 Action, +1 Card.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'synchro_summon', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'ritual_summon',
    name: 'Ritual Summon',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: ['Summon'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    // The Recruit was unsequenced from the trash and fired on an empty hand as
    // well. `ifPrevious` is not an option — PREV_KEY is read in evalCondition
    // and written nowhere, so it is always false — hence the explicit hand
    // check in front. "Of that cost" is the same unwritable cost binding as on
    // Synchro Summon, so the text no longer promises it.
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { who: 'self', zone: 'hand' }, atLeast: 1 } },
        then: [
          { op: 'trash', target: { who: 'self', zone: 'hand', count: 1, pick: 'random' } },
          { op: 'recruit', zone: 'library', filter: { type: 'Action' }, count: 1, who: 'self', to: 'hand' },
        ],
      },
    ],
    triggers: [],
    text: 'Trash a random card from your hand to Recruit an Action. +1 Action, +1 Card.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'ritual_summon', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'fusion_summon',
    name: 'Fusion Summon',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Summon'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    // Same `selectCards` misuse as Synchro Summon: the body ran twice, for four
    // discards and two Recruits. "Costing their sum" cannot be written — no op
    // accumulates the cost of what was discarded and NumericFilter takes
    // literals only — so the text stops promising the cost band.
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { who: 'self', zone: 'hand' }, atLeast: 2 } },
        then: [
          { op: 'discard', target: { who: 'self', zone: 'hand', count: 2, pick: 'choose' } },
          { op: 'recruit', zone: 'library', filter: { type: 'Action' }, count: 1, who: 'self', to: 'hand' },
        ],
      },
    ],
    triggers: [],
    text: 'Discard 2 cards to Recruit an Action. +1 Action, +1 Card.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'fusion_summon', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'link_summon',
    name: 'Link Summon',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Summon'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1, cards: 1 },
    // Same `selectCards` misuse as the other Summons, at min/max 3: nine
    // discards and three Recruits. "Most expensive" is writable, but not by
    // `recruit` — opRecruit walks the library in array order with no ordering
    // option, and sortLibraryByCost is hard-coded ascending, so it would fetch
    // the cheapest. A `moveTo` with pick:'mostExpensive' plus the explicit
    // shuffle that SB-2 requires after a Recruit is the same effect.
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { who: 'self', zone: 'hand' }, atLeast: 3 } },
        then: [
          { op: 'discard', target: { who: 'self', zone: 'hand', count: 3, pick: 'choose' } },
          { op: 'moveTo', target: { who: 'self', zone: 'library', filter: { type: 'Action' }, count: 1, pick: 'mostExpensive' }, zone: 'hand' },
          { op: 'shuffle', zone: 'library' },
        ],
      },
    ],
    triggers: [],
    text: 'Discard 3 cards to Recruit your most expensive Action. +1 Action, +1 Card.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'link_summon', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'cookie_guild',
    name: 'Cookie Guild',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      { op: 'recruit', zone: 'library', filter: { type: 'Action', cost: { lte: 3 } }, count: 1, who: 'self', to: 'hand' },
    ],
    triggers: [],
    text: 'Recruit an Action costing (3) or less.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'cookie_guild', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'the_big_boys',
    name: 'The Big Boys',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      { op: 'recruit', zone: 'library', filter: { type: 'Action', cost: { gte: 5 } }, count: 1, who: 'self', to: 'hand' },
    ],
    triggers: [],
    text: 'Recruit an Action costing (5) or more.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'the_big_boys', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'king_varian',
    name: 'King Varian',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'legendary',
    keywords: [],
    stats: {},
    effects: [{ op: 'recruit', zone: 'library', count: 3, who: 'self', to: 'hand' }],
    triggers: [],
    text: 'Recruit the top 3 cards of your Library, then shuffle it.',
    flavor: 'For the Alliance.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'king_varian', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'jeweled_scarab',
    name: 'Jeweled Scarab',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: ['Scarab'],
    tags: [],
    rarity: 'common',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    effects: [
      {
        op: 'discover',
        pool: { scope: 'knownUniverse', filter: { cost: { eq: 3 } } },
        count: 3,
        pick: 1,
        prompt: 'Discover a (3)-cost card',
        // '$discovered' is the chosen card. A `{pool:...}` here would be
        // re-sampled by resolveDefIdSpec, so the player could be offered A/B/C
        // and handed D. The default Discover `then` sends the pick to hand, not
        // GY, so the sentinel form is the one this card needs.
        then: [{ op: 'createCard', defId: '$discovered', to: 'gy' }],
      },
    ],
    triggers: [],
    text: 'Play on Buy, Flimsy. Discover a (3)-cost card from your Known Universe and add it to your GY.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'jeweled_scarab', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'golden_scarab',
    name: 'Golden Scarab',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: ['Scarab'],
    tags: [],
    rarity: 'rare',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    // The Gold option is offered on every resolution, the Play-on-Buy one
    // included: buy.ts moves the card to hand and calls playCard, so the buy
    // resolution and a later play are indistinguishable to the effect body and
    // nothing in ctx.vars marks which is which. The doc's "when played, Gold is
    // added to the options" split needs that signal; until it exists the card
    // prints the always-offered choice it actually gives you.
    effects: [
      {
        op: 'choose',
        options: [
          {
            label: 'Discover a (4)-cost card',
            effects: [
              {
                op: 'discover',
                pool: { scope: 'knownUniverse', filter: { cost: { eq: 4 } } },
                count: 3,
                pick: 1,
                prompt: 'Discover a (4)-cost card',
                then: [{ op: 'createCard', defId: '$discovered', to: 'gy' }],
              },
            ],
          },
          {
            label: 'Take a Gold instead',
            effects: [{ op: 'createCard', defId: 'gold', to: 'gy' }],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Play on Buy, Flimsy. Choose one: Discover a (4)-cost card from your Known Universe to your GY, or take a Gold to your GY.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'golden_scarab', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'empyreal_scarab',
    name: 'Empyreal Scarab',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Scarab'],
    tags: [],
    rarity: 'rare',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    effects: [
      {
        op: 'discover',
        pool: { scope: 'knownUniverse', filter: { cost: { gte: 5, lte: 6 } } },
        count: 3,
        pick: 1,
        prompt: 'Discover a (5)- or (6)-cost card',
        then: [{ op: 'createCard', defId: '$discovered', to: 'gy' }],
      },
    ],
    triggers: [],
    // The (5)-on-buy / (6)-when-played split needs a "this resolution came from
    // Play on Buy" signal the engine does not expose — buy.ts plays the card
    // through the same playCard path, and selfPlayCount counts plays of the
    // DEFINITION, so a second bought copy already reads 2 on its own on-buy
    // resolution. One (5)-or-(6) pool is what the card actually does.
    text: 'Play on Buy, Flimsy. Discover a (5)- or (6)-cost card from your Known Universe and add it to your GY.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'empyreal_scarab', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
];

export default cards;
