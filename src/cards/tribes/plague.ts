/**
 * A.18 — Plague archetype.
 *
 * Plague tokens live on a specific instance in *any* zone, shop piles included
 * (B65), so a `plague` target here is sometimes a `Selector` over a player's
 * zones and sometimes a `PileSelector` over the shop.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'crop_dusting',
    name: 'Crop Dusting',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: ['Plague'],
    tags: ['Legacy'],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      // "+2 Money if any had none" is a question about pile TOPS, and a
      // `{zone:'shop'}` Selector reaches every card in every pile — including the
      // buried ones opPlague never touches, so the old `has` gate was true every
      // single play. A PileSelector's filter matches the top card, so splitting
      // the token by whether that top already carried one turns the answer into
      // "did the second node do anything", which is exactly `{ifPrevious:true}`.
      // Every top still ends up with exactly one new token.
      { op: 'plague', target: { shop: 'all', filter: { plagued: true } }, amount: 1 },
      { op: 'plague', target: { shop: 'all', filter: { plagued: false } }, amount: 1 },
      {
        op: 'conditional',
        if: { ifPrevious: true },
        then: [{ op: 'gain', stat: 'money', amount: 2 }],
      },
    ],
    triggers: [],
    text: 'Put 1 Plague Token on the top card of every Shop pile. +2 Money if any of them had none.',
    flavor: 'Low pass over the whole market.',
    complexity: 'T3',
    subsystems: ['S-PLAGUE', 'S-SHOP'],
    shop: 'draft',
    art: { key: 'crop_dusting', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'plague_crawler',
    name: 'Plague Crawler',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: ['Plague'],
    tags: ['Legacy'],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [{ op: 'plague', target: { zone: 'gy', count: 1, pick: 'random' }, amount: 1 }],
    triggers: [
      {
        on: 'onPlagueAdded',
        // A trigger resolves for the instance's OWNER, so the Crawler's owner was
        // drawing the 2 Cards even when an opponent placed the token — the doc
        // and the printed line both say the placer. `activePlayer` is the seat
        // actually taking the turn, which is who is placing tokens.
        effects: [{ op: 'gain', stat: 'cards', amount: 2, who: 'activePlayer' }],
      },
    ],
    text: '+1 Action. Put 1 Plague Token on a random card in your GY. Whenever a token is placed on this, the placer draws 2 Cards. ({plague} on this.)',
    flavor: 'It goes where the sickness is thickest.',
    complexity: 'T3',
    subsystems: ['S-PLAGUE', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'plague_crawler', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'plague_charger',
    name: 'Plague Charger',
    cost: { money: 3 },
    types: ['Points'],
    subtypes: ['Plague'],
    tags: ['Legacy'],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [{ op: 'gain', stat: 'vp', amount: { expr: 'selfCounter' } }],
    triggers: [
      {
        on: 'onBuy',
        effects: [
          {
            op: 'choose',
            options: [
              {
                label: 'Trash Plague Charger to put 3 Plague Tokens on a card in your GY',
                effects: [
                  { op: 'plague', target: { zone: 'gy', count: 1, pick: 'choose' }, amount: 3 },
                  { op: 'trash', target: { self: true } },
                ],
              },
              { label: 'Keep it', effects: [{ op: 'noop' }] },
            ],
          },
        ],
      },
    ],
    text: 'On purchase you may trash this to put 3 Plague Tokens on a card in your GY. Otherwise it is worth +{plague} VP.',
    flavor: 'Charged and waiting.',
    complexity: 'T3',
    subsystems: ['S-PLAGUE', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'plague_charger', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'patient_zero',
    name: 'Patient Zero',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: ['Plague'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'plague', target: { shop: 'draft', count: 1, pick: 'choose' }, amount: 1 },
      {
        op: 'conditional',
        if: { has: { target: { zone: 'gy', filter: { plagued: true } }, atLeast: 1 } },
        then: [{ op: 'gain', stat: 'cards', amount: 2 }],
      },
    ],
    triggers: [],
    text: '+1 Action. Put a Plague Token on the top card of a Draft pile. If any card you gained this turn carried a token, +2 Cards.',
    flavor: 'He felt fine, mostly.',
    complexity: 'T3',
    subsystems: ['S-PLAGUE', 'S-SHOP'],
    shop: 'draft',
    art: { key: 'patient_zero', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'outbreak',
    name: 'Outbreak',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: ['Plague'],
    tags: ['Legacy'],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'plague', target: { shop: 'all', count: 2, pick: 'random' }, amount: 1 },
      // "tokens exceed its cost" compares two of the CANDIDATE's own fields, and
      // no CardFilter can hold both sides of that — `filter:{plagued:true}` alone
      // handed over the most expensive plagued pile in the Shop, free, every
      // play. Inside a forEach the candidate *is* the source, so
      // `selfCounter > selfCost` reads the comparison straight off it. The mark
      // carries the verdict out to a real `gainCard`, which is what keeps this a
      // gain (codex, cardsGainedThisTurn, onGain) rather than a bare move.
      // Marks are cleared at both ends: the sweep below the gain retires every
      // mark this play made — including the one riding the gained card into the
      // GY, which is why it looks in `gy` as well as `shop` — and this leading
      // one retires anything an abandoned prompt stranded before that sweep
      // could run, so a stale mark is never gainable on a later play.
      {
        op: 'forEach',
        over: { zone: ['shop', 'gy'], filter: { counter: { key: 'outbreakMark', gte: 1 } } },
        effects: [{ op: 'addCounter', target: { self: true }, key: 'outbreakMark', amount: -1 }],
      },
      // Prophet cards are priced in banked Prophet and carry no `cost.money`,
      // which `selfCost` reads as 0 — one token would put all 24 Prophet piles
      // over their "cost" at once. "Tokens exceed its cost" only means anything
      // against a money price, so the Prophet shop is out, and the printed line
      // says so. The (0)-cost Draft piles — Feather, Coal, Garlic and the rest —
      // stay in: they really do cost (0), so one token really does exceed it.
      {
        op: 'forEach',
        over: { zone: 'shop', filter: { plagued: true, not: { subtype: 'Prophet' } } },
        effects: [
          {
            op: 'conditional',
            if: { expr: 'selfCounter > selfCost' },
            then: [{ op: 'addCounter', target: { self: true }, key: 'outbreakMark', amount: 1 }],
          },
        ],
      },
      {
        op: 'gainCard',
        from: {
          shop: 'all',
          filter: { counter: { key: 'outbreakMark', gte: 1 } },
          pick: 'choose',
          count: 1,
        },
        to: 'gy',
        count: 1,
        free: true,
      },
      // Retire every mark this play made, wherever it ended up: the piles that
      // qualified and were passed over, and the gained card, which carries its
      // mark out of the Shop and into the GY.
      {
        op: 'forEach',
        over: { zone: ['shop', 'gy'], filter: { counter: { key: 'outbreakMark', gte: 1 } } },
        effects: [{ op: 'addCounter', target: { self: true }, key: 'outbreakMark', amount: -1 }],
      },
    ],
    triggers: [],
    text: '+1 Action. Put a Plague Token on the top card of two random piles, then gain any non-Prophet Shop card whose tokens exceed its cost.',
    flavor: 'It got out.',
    complexity: 'T3',
    subsystems: ['S-PLAGUE', 'S-SHOP'],
    shop: 'draft',
    art: { key: 'outbreak', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'antibody_extraction',
    name: 'Antibody Extraction',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: ['Plague'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'plague', target: { zone: 'hand', count: 1, pick: 'random' }, amount: 1 },
      // "Up to 2" needs the op with an optional count: a `repeat` + forced
      // `pick:'choose'` made the trash compulsory, and with one plagued card in
      // hand it never even prompted. `selectCards` binds each pick as the source,
      // so `{self:true}` is the card the player actually chose.
      {
        op: 'selectCards',
        from: { zone: 'hand', filter: { plagued: true } },
        min: 0,
        max: 2,
        then: [
          { op: 'trash', target: { self: true } },
          { op: 'gain', stat: 'cards', amount: 1 },
          { op: 'gain', stat: 'money', amount: 1 },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action. Put a Plague Token on a random card in your hand, then trash up to 2 plagued cards from your hand for +1 Card and +1 Money each.',
    flavor: 'The cure is in the patient.',
    complexity: 'T3',
    subsystems: ['S-PLAGUE'],
    shop: 'draft',
    art: { key: 'antibody_extraction', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'living_bomb',
    name: 'Living Bomb',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: ['Plague'],
    tags: ['Legacy'],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'trash', target: { who: 'eachPlayer', zone: 'gy', filter: { plagued: true } } },
      // A PileSelector matches a pile on its top card and `trashPile` then destroys
      // the whole stack, so one plagued top wiped a 10-card Common pile. Trash the
      // plagued instances instead; the nested `not` replaces `excludeJlore`.
      { op: 'trash', target: { zone: 'shop', filter: { plagued: true, not: { defId: 'jlore' } } } },
      // `count` is a TOTAL across everyone the selector reached, so a single
      // token used to be shared out between all the opponents. The doc says one
      // each.
      {
        op: 'plague',
        target: { who: 'eachOpponent', zone: 'gy', count: 1, pick: 'random', perPlayer: true },
        amount: 1,
      },
    ],
    triggers: [],
    text: '+1 Action. Trash every plagued card in the Shop and in every GY, then put 1 Plague Token on a random card in each opponent’s GY.',
    flavor: 'Contain it by removing everything near it.',
    complexity: 'T3',
    subsystems: ['S-PLAGUE', 'S-SHOP'],
    shop: 'draft',
    art: { key: 'living_bomb', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
  {
    id: 'plandemic',
    name: 'Plandemic',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Plague'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      // The tally of what the copy clause actually copied, so the printed
      // "minimum 1" is a real fallback rather than a side effect of an
      // unfiltered pick. It is a per-play tally, not a once-per-turn gate: a
      // player counter is shared by every copy of this card, so the reset in
      // front of the passes is what stops a second Plandemic in the same turn
      // from reading the first one's total. The reset also *creates* the key,
      // which is what makes the first read of it legal — an expression naming
      // a key that does not exist throws, and a condition that throws is false.
      {
        op: 'addCounter',
        scope: 'player',
        key: 'turn:plandemicCopies',
        amount: { expr: '0 - plandemicCopies' },
      },
      // Doubling and the copy gate ride in ONE pass per zone. "Double" is not
      // what `{op:'plague', amount:1}` does — a 3-token card went to 4 — but
      // inside a forEach the iterated card is the source, so `selfCounter` is
      // its own token count and adding it again is the doubling the doc prints.
      // "Tokens equal their cost" compares two of the CANDIDATE's own fields,
      // which no CardFilter can hold, so it is the same forEach binding that
      // expresses it; tested BEFORE the doubling as `t * 2 == cost`, which is
      // the same question as `2t == cost` asked after. Two passes instead of
      // four cost the same 2 nodes per plagued card (89 for a 40-pile board),
      // but the copies now land as each card doubles instead of in a second
      // sweep behind them, so a turn that runs out of the 200-node budget
      // mid-Plandemic keeps the copies it reached rather than losing the whole
      // clause, which was the last thing in the array.
      {
        op: 'forEach',
        over: { who: 'eachPlayer', zone: 'gy', filter: { plagued: true } },
        effects: [
          {
            op: 'conditional',
            if: { expr: 'selfCounter * 2 == selfCost' },
            then: [
              { op: 'plague', target: { self: true }, amount: { expr: 'selfCounter' } },
              { op: 'copyCard', target: { self: true }, to: 'hand', who: 'self' },
              { op: 'addCounter', scope: 'player', key: 'turn:plandemicCopies', amount: 1 },
            ],
            else: [{ op: 'plague', target: { self: true }, amount: { expr: 'selfCounter' } }],
          },
        ],
      },
      {
        op: 'forEach',
        over: { zone: 'shop', filter: { plagued: true } },
        effects: [
          {
            op: 'conditional',
            if: { expr: 'selfCounter * 2 == selfCost' },
            then: [
              { op: 'plague', target: { self: true }, amount: { expr: 'selfCounter' } },
              { op: 'copyCard', target: { self: true }, to: 'hand', who: 'self' },
              { op: 'addCounter', scope: 'player', key: 'turn:plandemicCopies', amount: 1 },
            ],
            else: [{ op: 'plague', target: { self: true }, amount: { expr: 'selfCounter' } }],
          },
        ],
      },
      // The respread: one token, into one graveyard at the table. Neither the
      // printed line nor the doc row says "each" — unlike Living Bomb, which
      // does — so this stays a single token rather than one per player.
      {
        op: 'plague',
        target: { who: 'eachPlayer', zone: 'gy', count: 1, pick: 'random' },
        amount: 1,
      },
      // "minimum 1". The gate above can match nothing at all, and the fallback
      // has to look everywhere the clause above it looked, or a lone plagued
      // Shop card leaves it empty-handed: one selector over both zones, so the
      // card it hands over is the most expensive plagued card anywhere, not the
      // most expensive one in a graveyard.
      {
        op: 'conditional',
        if: { expr: 'plandemicCopies < 1' },
        then: [
          {
            op: 'copyCard',
            target: {
              who: 'eachPlayer',
              zone: ['gy', 'shop'],
              filter: { plagued: true },
              count: 1,
              pick: 'mostExpensive',
            },
            to: 'hand',
            who: 'self',
          },
        ],
      },
    ],
    triggers: [],
    text: '+1 Action. Double every Plague Token in the Shop and in every GY and respread them, minimum 1. Add copies of cards whose tokens equal their cost to your hand, minimum 1.',
    flavor: 'Someone drew the graph in advance.',
    complexity: 'T4',
    subsystems: ['S-PLAGUE', 'S-SHOP'],
    shop: 'draft',
    art: { key: 'plandemic', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'jalshi',
    name: 'Jalshi',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: ['Plague'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'choose',
        options: [
          {
            label: 'Plague every card in your hand',
            effects: [{ op: 'plague', target: { zone: 'hand' }, amount: 1 }],
          },
          {
            label: 'Remove every Plague Token from your hand for +X Money',
            effects: [
              // X is tokens removed, not cards cured. `countIn(hand, plagued)`
              // counts matching instances, so a card carrying 3 tokens was
              // stripped for 1 Money. A forEach binds each plagued card as the
              // source, and `selfCounter` is then that card's own token count.
              // The body runs before the cure, so it reads the tokens while they
              // are still there.
              {
                op: 'forEach',
                over: { zone: 'hand', filter: { plagued: true } },
                effects: [{ op: 'gain', stat: 'money', amount: { expr: 'selfCounter' } }],
              },
              { op: 'removePlague', target: { zone: 'hand' } },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Choose one: plague every card in your hand; or remove every Plague Token from your hand for +X Money, X = tokens removed.',
    flavor: 'Sell the sickness or sell the cure.',
    complexity: 'T3',
    subsystems: ['S-PLAGUE'],
    shop: 'draft',
    art: { key: 'jalshi', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'juhan_wet_market',
    name: 'Juhan Wet Market',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: ['CN', 'Plague'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [{ op: 'gain', stat: 'cards', amount: { expr: 'selfCounter' } }],
    triggers: [
      {
        on: 'onDiscard',
        effects: [{ op: 'plague', target: { self: true }, amount: 2 }],
      },
    ],
    text: '+1 Action, +{plague} Cards. When discarded, put 2 more Plague Tokens on this.',
    flavor: 'Everything here is fresh, technically.',
    complexity: 'T3',
    subsystems: ['S-PLAGUE', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'juhan_wet_market', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
];

export default cards;
