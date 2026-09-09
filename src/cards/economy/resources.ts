/**
 * A.6 Draft Shop — Resource manipulation and refining.
 *
 * SB-6: the (5) Resource is `blood_diamond` / "Blood Diamond"; the (10) Action
 * is `blood_diamond_cutter` / "Blood Diamond Cutter". Two ids, two names.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'fools_gold',
    name: "Fool's Gold",
    cost: { money: 0 },
    types: ['Resource'],
    subtypes: ['Gold'],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { money: 3 },
    effects: [],
    triggers: [],
    text: 'Flimsy. +3 Money.',
    flavor: 'It glitters exactly once.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'fools_gold', status: 'placeholder', anim: 'coin' },
  },
  {
    id: 'gleamstone',
    name: 'Gleamstone',
    cost: { money: 8 },
    types: ['Resource'],
    subtypes: ['Diamond'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { money: 4, buys: 1 },
    effects: [],
    triggers: [],
    text: '+4 Money, +1 Buy.',
    flavor: 'Cut for spending, not for wearing.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'gleamstone', status: 'placeholder', anim: 'coin' },
  },
  {
    id: 'blood_diamond',
    name: 'Blood Diamond',
    cost: { money: 5 },
    types: ['Resource'],
    subtypes: ['Diamond'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { money: 5, vp: -5 },
    effects: [],
    triggers: [],
    text: '+5 Money, -5 VP.',
    flavor: 'Somebody paid for this. Not you.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'blood_diamond', status: 'placeholder', anim: 'coin' },
  },
  {
    id: 'blood_diamond_cutter',
    name: 'Blood Diamond Cutter',
    cost: { money: 10 },
    types: ['Action'],
    subtypes: ['Diamond'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1, money: 5 },
    effects: [],
    triggers: [
      // STILL BLOCKED as a real discount, and deliberately so at both ends.
      // A shop pile never receives startOfTurn (fireOwnedTriggers builds its
      // candidates from the owned zones and a shop instance has owner null), and
      // buyCard debits `p.money -= price` before it fires onBuy, so no trigger
      // on this card can reach the price it was bought at. The board-reading
      // price table in engine/shop/dynamic.ts cannot take it either, and says so
      // in its own comment: every entry there must be a pure function of
      // (state, buyer), and this price depends on a choice the buyer has not
      // made yet. It needs a buy-time hook that lets a pile's own card prompt
      // and then modify its price.
      //
      // So the discount is paid back one step later instead of shaved off the
      // price: the doc row's "reduce cost by (2) each" reads "refund (2) each",
      // and nothing here touches a cost modifier any more, so this card is no
      // longer an S-COSTMOD card. If the hook lands, revert to a `modifyCost`
      // with scope:'pile' and restore the printed wording.
      {
        on: 'onBuy',
        effects: [
          {
            op: 'selectCards',
            from: { who: 'self', zone: 'hand', filter: { type: 'Action', cost: { lte: 1 } } },
            min: 0,
            max: 99,
            then: [
              { op: 'trash', target: { self: true } },
              { op: 'gain', stat: 'money', amount: 2 },
            ],
          },
        ],
      },
    ],
    text: 'When you buy this you may trash any number of Actions costing (1) or less from your hand; each one refunds (2) Money. +1 Action, +5 Money.',
    flavor: 'A steady hand and a cheap conscience.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'blood_diamond_cutter', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'magnet',
    name: 'Magnet',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      // gainCard takes one card per matching pile, and there is exactly one
      // Copper pile — so visit it three times rather than asking for three.
      {
        op: 'repeat',
        times: 3,
        effects: [
          {
            op: 'gainCard',
            from: { shop: 'resource', filter: { defId: 'copper' } },
            to: 'hand',
            count: 1,
            free: true,
          },
        ],
      },
    ],
    triggers: [],
    text: 'Add up to 3 Copper from the Resource Shop to your hand. +1 Action.',
    flavor: 'Attracts only the cheap stuff.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'magnet', status: 'placeholder' },
  },
  {
    id: 'simple_refining',
    name: 'Simple Refining',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'transform',
        target: { who: 'self', zone: 'hand', filter: { defId: 'copper' }, count: 1, pick: 'choose' },
        // `upgrade` resolves as "a random card costing one more", which can
        // never be a Silver. Name the rung.
        into: 'silver',
      },
    ],
    triggers: [],
    text: 'Trash a Copper in your hand and add a Silver to your hand.',
    flavor: 'Heat, pressure, paperwork.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'simple_refining', status: 'placeholder' },
  },
  {
    id: 'advanced_refining',
    name: 'Advanced Refining',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      // `into:'upgrade'` walks the real Resource ladder now: opTransform
      // resolves it through upgradedDefId() (effects/ops/movement.ts) and only
      // falls back to "a random card costing one more" for a defId that is not
      // on the ladder at all. So the rung-by-rung choose tree this card used to
      // need is gone, and one `pick:'choose'` over the three climbable rungs is
      // the whole card. Diamond is left out because it is the top rung and its
      // upgrade is itself, which would make it an option that does nothing.
      {
        op: 'transform',
        target: {
          who: 'self',
          zone: 'hand',
          filter: { defId: ['copper', 'silver', 'gold'] },
          count: 1,
          pick: 'choose',
        },
        into: 'upgrade',
      },
    ],
    triggers: [],
    text: 'Trash a Copper, Silver or Gold in your hand and add its upgrade to your hand.',
    flavor: 'Copper to Silver to Gold to Diamond. No further.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'advanced_refining', status: 'placeholder' },
  },
  {
    id: 'pennymelting',
    name: 'Pennymelting',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      // The same ladder fix as Advanced Refining, run backwards:
      // `into:'downgrade'` resolves through downgradedDefId() in opTransform
      // rather than picking a random card costing one less, so the rung-by-rung
      // choose tree is gone. A Copper is the bottom rung and stays a Copper —
      // opTransform's `nextDefId === oldDefId` guard makes that a no-op — so a
      // melted Copper simply gains its second copy.
      //
      // `selectCards` rather than a bare transform because the second copy has
      // to be of the card that was just melted: `{self:true}` inside `then` is
      // the picked instance, and it is read after the transform has already
      // rewritten that instance's defId.
      {
        op: 'selectCards',
        from: {
          who: 'self',
          zone: 'hand',
          filter: { defId: ['copper', 'silver', 'gold', 'diamond'] },
        },
        min: 1,
        max: 1,
        then: [
          { op: 'transform', target: { self: true }, into: 'downgrade' },
          { op: 'copyCard', target: { self: true }, to: 'hand' },
        ],
      },
    ],
    triggers: [],
    text: 'Trash a Resource in your hand and add 2 copies of its downgrade to your hand. +1 Action.',
    flavor: 'Two worse things beat one better thing. Sometimes.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'pennymelting', status: 'placeholder' },
  },
  {
    id: 'currency_cremator',
    name: 'Currency Cremator',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'trash',
        target: { who: 'self', zone: 'hand', filter: { type: 'Resource' }, count: 1, pick: 'choose' },
      },
      { op: 'gain', stat: 'money', amount: 3 },
    ],
    triggers: [],
    text: 'Trash a Resource card from your hand for +3 Money.',
    flavor: 'Ashes, but liquid.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'currency_cremator', status: 'placeholder', anim: 'trash' },
  },
  {
    id: 'goldoron',
    name: 'Goldoron',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: ['Flimsy'],
    stats: {},
    effects: [{ op: 'createCard', defId: 'gold', to: 'gy' }],
    triggers: [],
    text: 'Flimsy. Add a Gold to your GY.',
    flavor: 'One gold, one goodbye.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'goldoron', status: 'placeholder', anim: 'coin' },
  },
  {
    id: 'diamondozen',
    name: 'Diamondozen',
    cost: { money: 8 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [{ op: 'createCard', defId: 'diamond', to: 'hand' }],
    triggers: [],
    text: 'Flimsy. Add a Diamond to your hand.',
    flavor: 'Not a dozen. Just the one.',
    complexity: 'T1',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'diamondozen', status: 'placeholder', anim: 'coin' },
  },
  {
    id: 'shine_bright',
    name: 'Shine Bright',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'transform',
        target: { who: 'self', zone: 'hand', filter: { defId: 'gold' } },
        into: 'diamond',
      },
      {
        op: 'transform',
        target: { who: 'self', zone: 'gy', filter: { defId: 'gold' } },
        into: 'diamond',
      },
    ],
    triggers: [],
    text: 'Turn every Gold in your hand into a Diamond, then do the same for your GY. +1 Action.',
    flavor: 'Like a diamond in the sky.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'shine_bright', status: 'placeholder', anim: 'summon' },
  },
  {
    id: 'put_a_ring_on_it',
    name: 'Put a Ring on It',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      // Each transformed card walks itself to the GY, so Points cards the
      // player was already holding stay in hand.
      {
        op: 'forEach',
        over: { who: 'self', zone: 'hand', filter: { defId: 'silver' } },
        effects: [
          { op: 'transform', target: { self: true }, into: 'tix' },
          { op: 'moveTo', target: { self: true }, zone: 'gy' },
        ],
      },
      {
        op: 'forEach',
        over: { who: 'self', zone: 'hand', filter: { defId: 'gold' } },
        effects: [
          { op: 'transform', target: { self: true }, into: 'robux' },
          { op: 'moveTo', target: { self: true }, zone: 'gy' },
        ],
      },
      {
        op: 'forEach',
        over: { who: 'self', zone: 'hand', filter: { defId: 'diamond' } },
        effects: [
          { op: 'transform', target: { self: true }, into: 'jlore' },
          { op: 'moveTo', target: { self: true }, zone: 'gy' },
        ],
      },
    ],
    triggers: [],
    text: 'Turn each Silver into a Tix, each Gold into a Robux and each Diamond into a Jlore, then move them from your hand to your GY.',
    flavor: 'If you liked it.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'put_a_ring_on_it', status: 'placeholder' },
  },
  {
    id: 'shining_kit',
    name: 'Shining Kit',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { money: 2 },
    effects: [
      // `scope:'nextPlayed'` is the wrong primitive here twice over: runBuffNode
      // drops the `stat` when it queues the mod (effects/ops/buff.ts), so the +1
      // landed on a RANDOM stat, and a NextCardMod carries no card filter, so
      // nothing restricted it to a Resource. `onPlay` is no way out either —
      // core/play.ts fires it on the played instance and on the Field, never on
      // a rider sitting in play — so a card in play cannot watch a later play.
      //
      // A modifier's `appendEffects` are the one hook that runs INSIDE the next
      // play with that card as their source, so the type test happens there:
      // mark the played card, buff it only if the mark landed on a Resource,
      // then clear the mark either way. The clear is unconditional because
      // `selfCounter` sums every non-bookkeeping counter, and a stray one would
      // be read by whatever card it stuck to.
      //
      // The gate is `selectCards` rather than a `buff` with a filtered target
      // because runBuffNode falls back to its own source instance when the
      // selector matches nothing — which would buff the non-Resource — while
      // opSelectCards does nothing at all on an empty selection. Only one card
      // ever carries the mark, so the pick resolves without a prompt.
      //
      // Two residuals are left standing on purpose, and one engine field closes
      // both: a `filter?: CardFilter` on NextCardMod, consulted by
      // consumePlayMods (core/play.ts), so a mod that does not match the card
      // being played is neither applied nor spent.
      //
      // 1. TIMING. `appendEffects` run at step 5 of playCard, after the stat
      //    step, so the +1 does not pay out on the play that earns it — a Gold
      //    buffed here yields 3 Money that play and 4 from the next one on. The
      //    `buffTimes` path (Performance Enhancing Cookie/Crumb) does land at
      //    step 3, before stats, but it is unconditional: nothing at step 3 can
      //    ask whether the played card is a Resource. Buffing at step 3 and
      //    nerfing back at step 5 is not a way round it — the non-Resource
      //    would be paid the Money anyway, and applyMany fires `onBuff` on a
      //    nerf too, so the undo would trip every card that watches for a buff.
      //    The late buff is the only shape that is never wrong on a
      //    non-Resource, and "permanently gains +1 Money" does not name the
      //    play it starts paying on.
      //
      // 2. SCOPE. `uses:1` is decremented by consumePlayMods on ANY play, so a
      //    non-Resource played next spends the offer and this card does nothing
      //    — the printed "next Resource" is really "next card, if it is a
      //    Resource". Under fire that branch is clean: no buff, no stray
      //    counter, the mark cleared. The card-data alternatives are worse: a
      //    mod that re-arms itself needs `appendEffects` to contain themselves,
      //    and a cyclic effect tree would break `cards:export` and the
      //    nextCardModifier log entry that carries the mod; a large `uses` with
      //    a player-counter arm leaks that counter into later copies whenever
      //    no Resource is played, and burns nodes on every play until it
      //    expires. The text is left matching the A.6 doc row.
      {
        op: 'nextCardModifier',
        mod: {
          appliesTo: 'play',
          uses: 1,
          appendEffects: [
            { op: 'addCounter', target: { self: true }, key: 'shiningKit', amount: 1 },
            {
              op: 'selectCards',
              from: {
                who: 'self',
                zone: 'play',
                filter: { type: 'Resource', counter: { key: 'shiningKit', gte: 1 } },
              },
              min: 1,
              max: 1,
              then: [{ op: 'buff', scope: 'self', stat: 'money', amount: 1 }],
            },
            { op: 'addCounter', target: { self: true }, key: 'shiningKit', amount: -1 },
          ],
        },
      },
    ],
    triggers: [],
    text: 'The next Resource you play permanently gains +1 Money. +2 Money.',
    flavor: 'A cloth, a polish, a permanent improvement.',
    complexity: 'T3',
    subsystems: ['S-BUFF'],
    shop: 'draft',
    art: { key: 'shining_kit', status: 'placeholder' },
  },
  {
    id: 'midas_touch',
    name: 'Midas Touch',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['PlayOnDraw'],
    stats: {},
    effects: [
      {
        op: 'transform',
        target: { who: 'self', zone: 'hand', count: 1, pick: 'random' },
        into: 'gold',
      },
    ],
    triggers: [],
    text: 'Play on Draw. Turn a random card in your hand into a Gold.',
    flavor: 'He never asked which card.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'midas_touch', status: 'placeholder', anim: 'coin' },
  },
  {
    id: 'depot_draw',
    name: 'Depot Draw',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      // Stage the four cards aside first: a filtered library selector matches
      // before it counts, so it would tutor Resources off the bottom and then
      // discard four cards nobody ever saw.
      { op: 'reveal', target: { who: 'self', zone: 'library', count: 4, pick: 'top' } },
      {
        op: 'moveTo',
        target: { who: 'self', zone: 'library', count: 4, pick: 'top' },
        zone: 'aside',
      },
      // `aside` is ONE shared staging pile per player and nothing empties it at
      // end of turn, so a Hand Box's stored hand — parked there by Save for
      // Later / Repackage and tagged with the `boxed` counter — is sitting in
      // it too. Both sweeps skip anything boxed, or this card would empty the
      // box into hand and GY on its way past.
      {
        op: 'moveTo',
        target: {
          who: 'self',
          zone: 'aside',
          filter: { type: 'Resource', not: { counter: { key: 'boxed', gte: 1 } } },
        },
        zone: 'hand',
      },
      {
        op: 'moveTo',
        target: { who: 'self', zone: 'aside', filter: { not: { counter: { key: 'boxed', gte: 1 } } } },
        zone: 'gy',
      },
    ],
    triggers: [],
    text: 'Reveal the top 4 cards of your Library. Put the Resources in your hand and discard the rest. +1 Action.',
    flavor: 'Loading bay, not showroom.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'depot_draw', status: 'placeholder' },
  },
  {
    id: 'sticky_fungers',
    name: 'Sticky Fungers',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: { cards: 1 },
    effects: [
      {
        op: 'moveTo',
        target: { who: 'self', zone: 'library', filter: { type: 'Resource' } },
        zone: 'library',
        position: 'top',
      },
    ],
    triggers: [],
    text: 'Move every Resource in your Library to the top of it. +1 Card.',
    flavor: 'They cling to money specifically.',
    complexity: 'T2',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'sticky_fungers', status: 'placeholder' },
  },
  {
    id: 'villa_d_moneybags',
    name: 'Villa D. Moneybags',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'legendary',
    keywords: [],
    stats: {},
    effects: [
      { op: 'createCard', defId: 'gold', to: 'hand' },
      { op: 'createCard', defId: 'gold', to: 'gy', who: 'eachOpponent' },
    ],
    triggers: [],
    text: 'Add a Gold to your hand and a Gold to each opponent’s GY.',
    flavor: 'Generous, in a way that costs him nothing.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'villa_d_moneybags', status: 'placeholder', anim: 'coin' },
  },
  {
    id: 'intellectual_property_theft',
    name: 'Intellectual Property Theft',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'discover',
        pool: { scope: 'opponentGy', who: 'chosenOpponent', filter: { type: 'Resource' } },
        count: 3,
        pick: 1,
        prompt: 'Take what is theirs',
        // An empty `then` is the default "the discovered card enters your
        // hand". A `then` cannot say it: {self:true} there is this card.
        then: [],
      },
    ],
    triggers: [],
    text: 'Discover a Resource in an opponent’s GY and add a copy of it to your hand.',
    flavor: 'It was in a public discard pile, technically.',
    complexity: 'T3',
    subsystems: ['S-STEAL', 'S-DISCOVER'],
    shop: 'draft',
    art: { key: 'intellectual_property_theft', status: 'placeholder' },
  },
  {
    id: 'second_degree_forgery',
    name: 'Second-Degree Forgery',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'copyCard',
        // Their play area is emptied into the GY at the end of their turn, so
        // by the time this resolves the card they last played is sitting there.
        target: {
          who: 'chosenOpponent',
          zone: 'gy',
          filter: { type: 'Resource' },
          count: 1,
          pick: 'lastPlayed',
        },
        to: 'hand',
        who: 'self',
      },
      {
        op: 'conditional',
        if: { combo: 3 },
        then: [{ op: 'setKeyword', target: { self: true }, keyword: 'Flimsy', on: false }],
      },
    ],
    triggers: [],
    text: 'Flimsy. Copy the last Resource an opponent played into your hand. Combo 3: this loses Flimsy.',
    flavor: 'The first degree was the idea.',
    complexity: 'T3',
    subsystems: ['S-STEAL', 'S-COMBO'],
    shop: 'draft',
    art: { key: 'second_degree_forgery', status: 'placeholder' },
  },
  {
    id: 'petty_theft',
    name: 'Petty Theft',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'conditional',
        if: {
          has: {
            target: { who: 'chosenOpponent', zone: 'hand', filter: { type: 'Resource' } },
            atLeast: 1,
          },
        },
        then: [
          // moveTo cannot change an owner, so a plain move just shuffles the
          // card inside their own hand. Copy it to yours, then trash theirs.
          {
            op: 'forEach',
            over: {
              who: 'chosenOpponent',
              zone: 'hand',
              filter: { type: 'Resource' },
              count: 1,
              pick: 'random',
            },
            effects: [
              { op: 'copyCard', target: { self: true }, to: 'hand', who: 'self' },
              { op: 'trash', target: { self: true } },
            ],
          },
        ],
        else: [{ op: 'createCard', defId: 'silver', to: 'gy' }],
      },
      {
        op: 'conditional',
        if: { combo: 3 },
        then: [{ op: 'setKeyword', target: { self: true }, keyword: 'Flimsy', on: false }],
      },
    ],
    triggers: [],
    text: 'Flimsy. Steal a Resource from an opponent’s hand. If they have none, add a Silver to your GY instead. Combo 3: this loses Flimsy.',
    flavor: 'Small crime, small sentence, small silver.',
    complexity: 'T3',
    subsystems: ['S-STEAL', 'S-COMBO'],
    shop: 'draft',
    art: { key: 'petty_theft', status: 'placeholder' },
  },
  {
    id: 'gold_ship',
    name: 'Gold Ship',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Gold'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { money: 3, actions: 1 },
    effects: [
      { op: 'lockPile', target: { shop: 'all', excludeJlore: true }, duration: 'turn' },
      // Without a count the "choose" branch returns every pile and never
      // prompts, which would unlock everything it just locked.
      { op: 'unlockPile', target: { shop: 'all', pick: 'choose', count: 1, excludeJlore: true } },
    ],
    triggers: [],
    text: '+3 Money, +1 Action. Lock every pile but one of your choice until end of turn.',
    flavor: 'The harbour closes when the gold sails.',
    complexity: 'T3',
    subsystems: ['S-LOCK'],
    shop: 'draft',
    art: { key: 'gold_ship', status: 'placeholder' },
  },
];

export default cards;
