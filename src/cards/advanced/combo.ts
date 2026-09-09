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
    art: { key: id, status: 'placeholder' },
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
    art: { key: 'group_leader', status: 'placeholder' },
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
    art: { key: 'experience_dividend', status: 'placeholder', anim: 'coin' },
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
    art: { key: 'crime_wave', status: 'placeholder' },
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
    art: { key: 'wombo_combo', status: 'placeholder' },
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
    // "One Ricochet per turn" is subtype-wide and seat-scoped: the mark has to
    // stop a DIFFERENT Ricochet firing later the same turn, so it lives on the
    // player rather than on the instance. `turn:` is the prefix resetTurnStats
    // clears at the start of the owner's turn (src/engine/core/turn.ts).
    //
    // The 0-amount write in front is not a no-op. `addCounter` creates the key,
    // and the expression grammar THROWS on an identifier that is in neither
    // EXPR_VARS nor `vars`; evalCondition swallows that throw as `false`, so
    // without the seed the gate would be permanently closed on the first play
    // of every turn — the exact opposite of what it is for.
    effects: [
      { op: 'addCounter', scope: 'player', key: 'turn:ricochetUsed', amount: 0 },
      {
        op: 'conditional',
        if: { all: [{ combo: 3 }, { expr: 'ricochetUsed == 0' }] },
        then: [
          { op: 'addCounter', scope: 'player', key: 'turn:ricochetUsed', amount: 1 },
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
    art: { key: 'ricochet', status: 'placeholder' },
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
    // Same seat-scoped, turn-cleared mark as Ricochet — all three share it, so
    // playing Ricochet+ after Ricochet is the second Ricochet and does nothing.
    effects: [
      { op: 'addCounter', scope: 'player', key: 'turn:ricochetUsed', amount: 0 },
      {
        op: 'conditional',
        if: { all: [{ combo: 3 }, { expr: 'ricochetUsed == 0' }] },
        then: [
          { op: 'addCounter', scope: 'player', key: 'turn:ricochetUsed', amount: 1 },
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
    art: { key: 'ricochet_plus', status: 'placeholder' },
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
    // Shares the one `turn:ricochetUsed` mark with Ricochet and Ricochet+.
    effects: [
      { op: 'addCounter', scope: 'player', key: 'turn:ricochetUsed', amount: 0 },
      {
        op: 'conditional',
        if: { all: [{ combo: 3 }, { expr: 'ricochetUsed == 0' }] },
        then: [
          { op: 'addCounter', scope: 'player', key: 'turn:ricochetUsed', amount: 1 },
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
    art: { key: 'ricochet_plus_plus', status: 'placeholder' },
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
    art: { key: 'money_moves', status: 'placeholder' },
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
    art: { key: 'holy_topdeck', status: 'placeholder' },
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
    art: { key: 'boots_on_the_ground', status: 'placeholder' },
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
    art: { key: 'insidious_initiation', status: 'placeholder' },
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
    art: { key: 'full_house', status: 'placeholder' },
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
    art: { key: 'another_round', status: 'placeholder' },
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
    art: { key: 'vault', status: 'placeholder' },
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
    art: { key: 'safe', status: 'placeholder' },
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
    art: { key: 'silver_stash', status: 'placeholder' },
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
    art: { key: 'moon_rock', status: 'placeholder' },
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
    art: { key: 'too_many_stats', status: 'placeholder' },
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
    // "Same cost" needs a card to name the cost, so the first of the two
    // discards is chosen first and `forEach` binds it as the source — inside
    // that body `selfCost` IS its cost, and a NumericFilter bound may now be an
    // expression. The `has` gate counts the anchor itself, so `atLeast: 2` is
    // "there is a partner at this cost"; the second discard then picks from
    // that cost band only.
    //
    // The fetch is a `moveTo` + explicit shuffle rather than `{op:'recruit'}`
    // because opRecruit matches through `matchesDefFilter` WITHOUT calling
    // resolveFilter, so an expression bound in a recruit filter is not a
    // number, is skipped, and silently matches every Action.
    //
    // KNOWN DIVERGENCE: the anchor is picked before the gate can see it, so a
    // player holding a valid pair who picks an unpairable card as the anchor
    // gets nothing — no discard, no Recruit. It is inert rather than wrong (the
    // gate is what stops a half-paid cost), and it cannot be closed from card
    // data: CardFilter has no "has a same-cost partner in this zone" axis to
    // narrow the anchor pool with, and Selector carries no prompt string, so
    // the pick cannot even be labelled — opForEach passes a fixed
    // 'Choose cards'.
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { who: 'self', zone: 'hand' }, atLeast: 2 } },
        then: [
          {
            op: 'forEach',
            over: { who: 'self', zone: 'hand', count: 1, pick: 'choose' },
            effects: [
              {
                op: 'conditional',
                if: {
                  has: {
                    target: { who: 'self', zone: 'hand', filter: { cost: { eq: { expr: 'selfCost' } } } },
                    atLeast: 2,
                  },
                },
                then: [
                  { op: 'discard', target: { self: true } },
                  {
                    op: 'discard',
                    target: { who: 'self', zone: 'hand', filter: { cost: { eq: { expr: 'selfCost' } } }, count: 1, pick: 'choose' },
                  },
                  {
                    op: 'moveTo',
                    target: {
                      who: 'self',
                      zone: 'library',
                      filter: { type: 'Action', cost: { eq: { expr: 'selfCost' } } },
                      count: 1,
                      pick: 'top',
                    },
                    zone: 'hand',
                  },
                  { op: 'shuffle', zone: 'library' },
                ],
              },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Discard 2 same-cost cards to Recruit an Action of that cost. +1 Action, +1 Card.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'synchro_summon', status: 'placeholder', anim: 'summon' },
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
    // `forEach` over the one random hand card binds it as the source, and that
    // is what carries "of that cost" into the fetch: inside the body `selfCost`
    // is the trashed card's cost, and instanceCost is zone-independent, so it
    // still reads the same number once the card is sitting in the trash. The
    // forEach also replaces the old explicit hand check — an empty hand selects
    // nothing and the body never runs. Same `moveTo` + shuffle as Synchro
    // Summon, for the same reason: opRecruit does not resolve expression bounds
    // in its filter.
    effects: [
      {
        op: 'forEach',
        over: { who: 'self', zone: 'hand', count: 1, pick: 'random' },
        effects: [
          { op: 'trash', target: { self: true } },
          {
            op: 'moveTo',
            target: {
              who: 'self',
              zone: 'library',
              filter: { type: 'Action', cost: { eq: { expr: 'selfCost' } } },
              count: 1,
              pick: 'top',
            },
            zone: 'hand',
          },
          { op: 'shuffle', zone: 'library' },
        ],
      },
    ],
    triggers: [],
    text: 'Trash a random card from your hand to Recruit an Action of that cost. +1 Action, +1 Card.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'ritual_summon', status: 'placeholder', anim: 'summon' },
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
    // "Costing their sum" needs an accumulator, because `selfCost` only ever
    // names ONE card and the forEach rebinds it per discard. A player counter
    // is the one writable running total: each iteration adds its own cost to
    // `turn:fusedCost`, the fetch reads it back by name (the `turn:` prefix is
    // stripped for expressions), and the last node subtracts the total away
    // again so a second Fusion Summon in the same turn starts from zero. The
    // `turn:` prefix is the backstop for that — a suspended resolution that
    // never reaches the subtraction is cleared at the start of the next turn.
    //
    // `moveTo` + shuffle rather than `{op:'recruit'}`: opRecruit matches through
    // matchesDefFilter without resolveFilter, so an expression cost bound there
    // is skipped and every Action matches.
    effects: [
      {
        op: 'conditional',
        if: { has: { target: { who: 'self', zone: 'hand' }, atLeast: 2 } },
        then: [
          {
            op: 'forEach',
            over: { who: 'self', zone: 'hand', count: 2, pick: 'choose' },
            effects: [
              { op: 'addCounter', scope: 'player', key: 'turn:fusedCost', amount: { expr: 'selfCost' } },
              { op: 'discard', target: { self: true } },
            ],
          },
          {
            op: 'moveTo',
            target: {
              who: 'self',
              zone: 'library',
              filter: { type: 'Action', cost: { eq: { expr: 'fusedCost' } } },
              count: 1,
              pick: 'top',
            },
            zone: 'hand',
          },
          { op: 'shuffle', zone: 'library' },
          { op: 'addCounter', scope: 'player', key: 'turn:fusedCost', amount: { expr: '0 - fusedCost' } },
        ],
      },
    ],
    triggers: [],
    text: 'Discard 2 cards to Recruit an Action costing their sum. +1 Action, +1 Card.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'fusion_summon', status: 'placeholder', anim: 'summon' },
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
    art: { key: 'link_summon', status: 'placeholder', anim: 'summon' },
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
    art: { key: 'cookie_guild', status: 'placeholder' },
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
    art: { key: 'the_big_boys', status: 'placeholder' },
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
    art: { key: 'king_varian', status: 'placeholder' },
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
    art: { key: 'jeweled_scarab', status: 'placeholder' },
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
    // "When played, Gold is added to the options" needs the body to know which
    // resolution it is in, and buy.ts plays a Play-on-Buy card through the same
    // playCard path as a hand play. The discriminator is timing: buy.ts fires
    // the bought instance's own onBuy triggers BEFORE it hands the instance to
    // playCard, so the trigger below stamps this instance as "bought, not yet
    // resolved" and the Play-on-Buy resolution immediately spends the stamp.
    // Any later play — the card is Flimsy, so that means a copy gained rather
    // than bought — reads 0 and gets the Gold option.
    //
    // The 0-amount write in front creates the `counter` key without changing
    // it, which is what makes the read mean the stamp: buildVars falls back to
    // the SUM of every counter on the instance when no named key exists, and a
    // purchase already leaves `pricePaid` behind (buy.ts writes it before the
    // onBuy window), so an unseeded copy could read someone else's number.
    effects: [
      { op: 'addCounter', target: { self: true }, key: 'counter', amount: 0 },
      {
        op: 'conditional',
        if: { expr: 'selfCounter >= 1' },
        then: [
          { op: 'addCounter', target: { self: true }, key: 'counter', amount: -1 },
          {
            op: 'discover',
            pool: { scope: 'knownUniverse', filter: { cost: { eq: 4 } } },
            count: 3,
            pick: 1,
            prompt: 'Discover a (4)-cost card',
            then: [{ op: 'createCard', defId: '$discovered', to: 'gy' }],
          },
        ],
        else: [
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
      },
    ],
    // Keyed `counter` because that is the one instance counter buildVars
    // surfaces to expressions by name; any other key would fold into the sum of
    // every counter on the card.
    triggers: [
      {
        on: 'onBuy',
        effects: [
          { op: 'addCounter', target: { self: true }, key: 'counter', amount: 1 },
          // The Play-on-Buy resolution spends the stamp, but buy.ts skips that
          // play when an onBuy/onGain trigger trashed the instance first or
          // stripped PlayOnBuy, and the body can also be cut off by the node
          // budget before the -1 node runs. A stamp left standing would make a
          // LATER hand play of this same instance — recurred out of the trash —
          // take the bought branch and silently drop the Gold option, so the
          // stamp expires at end of turn: it only has to outlive the purchase.
          // A spent stamp reads 0 here and the cleanup is a no-op, so the
          // counter never runs negative and a re-bought copy re-stamps cleanly.
          {
            op: 'delayed',
            when: 'endOfTurn',
            effects: [
              {
                op: 'conditional',
                if: { expr: 'selfCounter >= 1' },
                then: [{ op: 'addCounter', target: { self: true }, key: 'counter', amount: -1 }],
              },
            ],
          },
        ],
      },
    ],
    text: 'Play on Buy, Flimsy. Discover a (4)-cost card from your Known Universe and add it to your GY. When played, a Gold is added to the options.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'golden_scarab', status: 'placeholder' },
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
    // Same buy-versus-play discriminator as Golden Scarab: the onBuy trigger
    // stamps the instance before buy.ts hands it to playCard, the Play-on-Buy
    // resolution spends the stamp and Discovers a (5), and a play that is not a
    // purchase Discovers a (6) instead. Same 0-amount seed as Golden Scarab so
    // `selfCounter` names the stamp rather than falling back to the sum of
    // whatever else is on the instance.
    effects: [
      { op: 'addCounter', target: { self: true }, key: 'counter', amount: 0 },
      {
        op: 'conditional',
        if: { expr: 'selfCounter >= 1' },
        then: [
          { op: 'addCounter', target: { self: true }, key: 'counter', amount: -1 },
          {
            op: 'discover',
            pool: { scope: 'knownUniverse', filter: { cost: { eq: 5 } } },
            count: 3,
            pick: 1,
            prompt: 'Discover a (5)-cost card',
            then: [{ op: 'createCard', defId: '$discovered', to: 'gy' }],
          },
        ],
        else: [
          {
            op: 'discover',
            pool: { scope: 'knownUniverse', filter: { cost: { eq: 6 } } },
            count: 3,
            pick: 1,
            prompt: 'Discover a (6)-cost card',
            then: [{ op: 'createCard', defId: '$discovered', to: 'gy' }],
          },
        ],
      },
    ],
    triggers: [
      {
        on: 'onBuy',
        effects: [
          { op: 'addCounter', target: { self: true }, key: 'counter', amount: 1 },
          // Same expiry as Golden Scarab: a stamp the Play-on-Buy resolution
          // never got to spend would make a later hand play of this instance
          // Discover a (5) instead of the printed (6), so it is cleared at the
          // end of the turn it was written in.
          {
            op: 'delayed',
            when: 'endOfTurn',
            effects: [
              {
                op: 'conditional',
                if: { expr: 'selfCounter >= 1' },
                then: [{ op: 'addCounter', target: { self: true }, key: 'counter', amount: -1 }],
              },
            ],
          },
        ],
      },
    ],
    text: 'Play on Buy, Flimsy. Discover a (5)-cost card from your Known Universe and add it to your GY. When played, Discover a (6)-cost card instead.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'empyreal_scarab', status: 'placeholder' },
  },
];

export default cards;
