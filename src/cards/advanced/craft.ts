/**
 * B.3 — Craft a Card.
 *
 * SB-26: ONE definition. The cost resolves at purchase time to the highest of
 * 1, 5 and 10 the buyer can afford; the price actually paid is written onto the
 * instance as the `craftPrice` counter and scales X and Y:
 *
 *   price 1  -> X 1, Y 1
 *   price 5  -> X 3, Y 2
 *   price 10 -> X 6, Y 3
 *
 * Two chained menus, from Appendix B.3's two option lists.
 */
import type { CardDefinition, EffectNode } from '@engine/types';

/** The second menu: 8 options scaled by Y (and by X where the text says so). */
function secondMenu(x: number, y: number): EffectNode {
  return {
    op: 'choose',
    who: 'self',
    options: [
      {
        label: `Copy ${y} cards from an opponent's deck into yours`,
        effects: [
          {
            op: 'copyCard',
            target: { who: 'chosenOpponent', zone: ['library', 'hand', 'gy'], count: y, pick: 'random' },
            to: 'gy',
            who: 'self',
          },
        ],
      },
      {
        label: `Transform ${y} random cards in your deck into ones costing (${x}) more`,
        effects: [
          {
            op: 'transform',
            target: { who: 'self', zone: ['library', 'hand', 'gy'], count: y, pick: 'random' },
            into: { costDelta: x },
          },
        ],
      },
      {
        label: `Add ${y} random Entire Universe cards costing (${x}) or less to hand`,
        effects: [
          {
            op: 'createCard',
            defId: { pool: { scope: 'entireUniverse', filter: { cost: { lte: x } } } },
            to: 'hand',
            count: y,
          },
        ],
      },
      {
        label: `Add ${y} Truss to hand`,
        effects: [{ op: 'createCard', defId: 'truss', to: 'hand', count: y }],
      },
      {
        label: `Add ${y} Silver to hand`,
        effects: [{ op: 'createCard', defId: 'silver', to: 'hand', count: y }],
      },
      {
        label: `Discard ${y} cards from an opponent's hand`,
        effects: [{ op: 'discard', target: { who: 'chosenOpponent', zone: 'hand', count: y, pick: 'random' } }],
      },
      {
        label: `+${y} VP`,
        effects: [{ op: 'gain', stat: 'vp', amount: y }],
      },
      {
        label: `Lock ${y} random Draft piles until your next turn`,
        effects: [
          {
            op: 'lockPile',
            target: { shop: 'draft', count: y, pick: 'random', excludeJlore: true },
            duration: 'untilYourNextTurn',
          },
        ],
      },
    ],
  };
}

/** The first menu: 8 options scaled by X, chaining into the second menu. */
function craftTier(x: number, y: number): EffectNode {
  const next = secondMenu(x, y);
  return {
    op: 'choose',
    who: 'self',
    options: [
      { label: `+${x} Action`, effects: [{ op: 'gain', stat: 'actions', amount: x }, next] },
      { label: `+${x} Money`, effects: [{ op: 'gain', stat: 'money', amount: x }, next] },
      { label: `+${x} Buys`, effects: [{ op: 'gain', stat: 'buys', amount: x }, next] },
      { label: `+${x} Cards`, effects: [{ op: 'draw', amount: x }, next] },
      {
        label: `+${x} Actions next turn`,
        effects: [{ op: 'delayed', when: 'startOfNextTurn', effects: [{ op: 'gain', stat: 'actions', amount: x }], who: 'self' }, next],
      },
      {
        label: `+${x} Money next turn`,
        effects: [{ op: 'delayed', when: 'startOfNextTurn', effects: [{ op: 'gain', stat: 'money', amount: x }], who: 'self' }, next],
      },
      {
        label: `+${x} Buys next turn`,
        effects: [{ op: 'delayed', when: 'startOfNextTurn', effects: [{ op: 'gain', stat: 'buys', amount: x }], who: 'self' }, next],
      },
      {
        label: `+${x} Cards next turn`,
        effects: [{ op: 'delayed', when: 'startOfNextTurn', effects: [{ op: 'draw', amount: x }], who: 'self' }, next],
      },
    ],
  };
}

export const cards: CardDefinition[] = [
  {
    id: 'craft_a_card',
    name: 'Craft a Card',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: ['Crafted'],
    tags: ['Legacy', 'Crafted'],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: {},
    // The tier reads the reserved 'counter' key, so selfCounter is the price
    // paid and nothing else — the counter SUM would fold in the playCount
    // playCard writes at step 2.
    effects: [
      {
        op: 'conditional',
        if: { expr: 'floor(selfCounter / 10)' },
        then: [craftTier(6, 3)],
        else: [
          {
            op: 'conditional',
            if: { expr: 'floor(selfCounter / 5)' },
            then: [craftTier(3, 2)],
            else: [craftTier(1, 1)],
          },
        ],
      },
    ],
    // SB-26 wants one definition whose price resolves at purchase to the
    // highest of (1), (5) and (10) the buyer can afford. A CardDefinition's
    // cost is static and the buy path charges it before onBuy runs, so the pile
    // stays priced at (1) — always affordable, which is the right floor — and
    // the rest of the price is collected here, at buy time.
    //
    // Two things the old version got wrong. `moneyUnspent` inside onBuy is what
    // is left AFTER the (1) was deducted, so the thresholds were off by the
    // price paid: a buyer holding exactly 10 tiered as 5. Adding selfCost back
    // restores the wallet as it stood at purchase. And nothing ever charged the
    // 5 or the 10, so the money sink never emptied anything; the balance of the
    // price is taken as an explicit spend, which cannot overdraw because the
    // threshold has already proved the buyer holds it.
    triggers: [
      {
        on: 'onBuy',
        effects: [
          {
            op: 'conditional',
            if: { expr: 'moneyUnspent + selfCost >= 10' },
            then: [
              { op: 'addCounter', target: { self: true }, key: 'counter', amount: 10 },
              { op: 'gain', stat: 'money', amount: { expr: '0 - (10 - selfCost)' } },
            ],
            else: [
              {
                op: 'conditional',
                if: { expr: 'moneyUnspent + selfCost >= 5' },
                then: [
                  { op: 'addCounter', target: { self: true }, key: 'counter', amount: 5 },
                  { op: 'gain', stat: 'money', amount: { expr: '0 - (5 - selfCost)' } },
                ],
                else: [{ op: 'addCounter', target: { self: true }, key: 'counter', amount: 1 }],
              },
            ],
          },
        ],
      },
    ],
    text:
      'Flimsy. Costs the most of (1), (5) and (10) you can afford. Craft a card from two menus and add it to your GY. ' +
      'Paid ({counter}): X and Y scale 1/1, 3/2, 6/3.',
    flavor: 'Some assembly required.',
    complexity: 'T4',
    subsystems: ['S-COSTMOD', 'S-CORE'],
    shop: 'draft',
    art: { key: 'craft_a_card', status: 'placeholder', anim: 'summon' },
  },
];

export default cards;
