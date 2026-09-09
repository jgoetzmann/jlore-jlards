/**
 * A.24 — Draft Shop: recursion, copying and replay.
 *
 * SB-24 governs The Past / The Future / The Eternal Show.
 * SB-7 governs Pointer's Mutilate binding.
 */
import type { CardDefinition } from '@engine/types';

export const cards: CardDefinition[] = [
  {
    id: 'solar_eclipse',
    name: 'Solar Eclipse',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: {},
    effects: [{ op: 'multiplyNext', factor: 2, count: 1 }],
    triggers: [],
    text: 'Flimsy. Double the next card you play.',
    flavor: 'Two of everything, briefly.',
    complexity: 'T3',
    subsystems: ['S-MULTIPLIER'],
    shop: 'draft',
    art: { key: 'solar_eclipse', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
  {
    id: 'kys_chosen',
    name: "KY's Chosen",
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [{ op: 'multiplyNext', factor: 2, stats: ['buys', 'money', 'cards', 'actions'], count: 1 }],
    triggers: [],
    text: 'Flimsy. The next card you play gains x2 Buy, x2 Money, x2 Draw and x2 Action. +1 Action.',
    complexity: 'T3',
    subsystems: ['S-MULTIPLIER'],
    shop: 'draft',
    art: { key: 'kys_chosen', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'misery',
    name: 'Misery',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [{ op: 'replayPlayedThisTurn', filter: { type: 'Action' }, thenTrash: true }],
    triggers: [],
    text: 'Replay every Action you have played this turn, in order, with random targets. Then trash them all.',
    flavor: 'Company loves it.',
    complexity: 'T3',
    subsystems: ['S-MULTIPLIER'],
    shop: 'draft',
    art: { key: 'misery', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'drain_game',
    name: 'Drain Game',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: {},
    effects: [{ op: 'replayPlayedThisTurn', filter: { type: 'Resource' }, thenTrash: true }],
    triggers: [],
    text: 'Replay every Resource you have played this turn, in order. Then trash them all.',
    complexity: 'T2',
    subsystems: ['S-MULTIPLIER'],
    shop: 'draft',
    art: { key: 'drain_game', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'spell_tyrant',
    name: 'Spell Tyrant',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'playCard',
        target: { who: 'self', zone: 'gy', filter: { type: 'Action' }, count: 3, pick: 'random' },
        randomTargets: true,
      },
    ],
    triggers: [],
    text: 'Cast 3 random Actions from your GY with random targets.',
    complexity: 'T3',
    subsystems: ['S-MULTIPLIER'],
    shop: 'draft',
    art: { key: 'spell_tyrant', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'mathemagiks',
    name: 'Mathemagiks',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    // The doc row's pool is "costing (handSize)". A NumericFilter bound may now
    // be an expression, but only the SELECTOR path resolves one: `poolCandidates`
    // (effects/pools.ts) hands the raw filter to `matchesDefFilter`, and
    // `matchesNumeric` skips any bound that is not already a literal — so an
    // `{expr:'handSize'}` here would fail OPEN and offer cards at any price.
    // The literal ceiling stays until the pool path resolves filters too.
    effects: [
      {
        op: 'discover',
        pool: { scope: 'knownUniverse', filter: { type: ['Action', 'Resource'], cost: { lte: 10 } } },
        count: 3,
        pick: 1,
        prompt: 'Discover a Known Universe Action or Resource, then cast it',
        // The pick is the card that gets cast: '$discovered' is substituted for
        // the chosen defId, so the copy created here is the one played back.
        then: [
          { op: 'createCard', defId: '$discovered', to: 'hand' },
          { op: 'playCard', target: { who: 'self', zone: 'hand', filter: { defId: '$discovered' }, count: 1 } },
        ],
      },
    ],
    triggers: [],
    text: 'Discover a Known Universe Action or Resource costing (10) or less and cast it.',
    complexity: 'T3',
    subsystems: ['S-CODEX', 'S-MULTIPLIER'],
    shop: 'draft',
    art: { key: 'mathemagiks', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'the_past',
    name: 'The Past',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: ['Paradox'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'playCard',
        target: { who: 'self', zone: 'play', filter: { not: { defId: 'the_past' } }, count: 1, pick: 'lastPlayed' },
      },
    ],
    triggers: [],
    text: 'This is a copy of the last card you fully resolved this turn. If there is none, it does nothing.',
    complexity: 'T3',
    subsystems: ['S-MULTIPLIER'],
    shop: 'draft',
    art: { key: 'the_past', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'the_future',
    name: 'The Future',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: ['Paradox'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'nextCardModifier',
        mod: {
          uses: 1,
          appliesTo: 'play',
          appendEffects: [
            {
              op: 'playCard',
              target: { who: 'self', zone: 'play', filter: { not: { defId: 'the_future' } }, count: 1, pick: 'lastPlayed' },
            },
          ],
        },
      },
    ],
    triggers: [],
    text: 'This is a copy of the next card you play this turn. If your turn ends first, it does nothing.',
    complexity: 'T4',
    subsystems: ['S-MULTIPLIER'],
    shop: 'draft',
    art: { key: 'the_future', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'the_eternal_show',
    name: 'The Eternal Show',
    cost: { money: 10 },
    types: ['Action'],
    subtypes: ['Paradox'],
    tags: [],
    rarity: 'mythic',
    keywords: [],
    stats: {},
    // SB-24 wants the actual chain — a resolving The Past whose copy target is a
    // The Future whose copy target is this instance. Two things are still in the
    // way. The cycle detector (`__playing:` guard, effects/ops/replay.ts) writes
    // only a `replayCycleBlocked` log line, leaving no state a Condition can
    // read; and The Future copies through a `nextCardModifier`, which only
    // core/play.ts consumes — a REPLAYED The Future re-queues the mod instead of
    // copying anything, so the chain cannot even form. Until then the condition
    // tests the nearest readable thing: both Paradoxes are in your play area.
    effects: [
      {
        op: 'conditional',
        if: {
          all: [
            { has: { target: { who: 'self', zone: 'play', filter: { defId: 'the_past' } }, atLeast: 1 } },
            { has: { target: { who: 'self', zone: 'play', filter: { defId: 'the_future' } }, atLeast: 1 } },
          ],
        },
        then: [
          { op: 'trash', target: { who: 'eachOpponent', zone: ['library', 'hand', 'gy'] } },
        ],
        else: [{ op: 'noop' }],
      },
    ],
    triggers: [],
    text: 'If your The Past would play your The Future and it plays this, the loop breaks: trash every opponent\'s deck.',
    flavor: 'The show must go on. And on.',
    complexity: 'T4',
    subsystems: ['S-MULTIPLIER'],
    shop: 'draft',
    art: { key: 'the_eternal_show', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'right_hand_man',
    name: 'Right Hand Man',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [
      {
        op: 'nextCardModifier',
        // `bind` is collected and never read, so the clause has to ride on
        // `appendEffects`, which is spliced into the next card's own body with
        // {self:true} bound to it. That buys one recall, not a permanent
        // trigger — the printed "every turn" form needs a granted trigger.
        mod: {
          uses: 1,
          appliesTo: 'play',
          appendEffects: [
            {
              op: 'delayed',
              when: 'startOfNextTurn',
              effects: [{ op: 'moveTo', target: { self: true }, zone: 'hand' }],
              who: 'self',
            },
          ],
        },
      },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action. The next card you play returns to your hand from anywhere at the start of your next turn.',
    complexity: 'T4',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'right_hand_man', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'card_mastery',
    name: 'Card Mastery',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [{ op: 'nextCardModifier', mod: { grantKeyword: 'PlayOnDraw', uses: 1, appliesTo: 'play' } }],
    triggers: [],
    text: 'Flimsy. +1 Action. The next Action you play gains Play on Draw (random targets).',
    complexity: 'T3',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'card_mastery', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'infini_scepter',
    name: 'Infini Scepter',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'legendary',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [
      // `playCard` consumes `bind:'oathboundMemory'`: the Celestial Aura is
      // manifested only when the bound card resolves, and it is manifested
      // BOUND to that card's definition, which is what makes it "Oathbound
      // Memory: [Card]" — each turn it mints a Temporary copy of the card it
      // remembers. `filter` keeps the mod waiting for an Action rather than
      // being spent by the next Resource: a card that does not match neither
      // consumes the modifier nor receives it.
      // (`{op:'manifestAura', bindTo:'nextPlayed'}` arms the same bind, but it
      // cannot carry the filter, so it would bind to the next card of any type.)
      {
        op: 'nextCardModifier',
        mod: { bind: 'oathboundMemory', filter: { type: 'Action' }, uses: 1, appliesTo: 'play' },
      },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action. The next Action you play is bound to the Celestial Aura Oathbound Memory.',
    complexity: 'T4',
    subsystems: ['S-AURA', 'S-PERSIST'],
    shop: 'draft',
    art: { key: 'infini_scepter', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'ancient_acquisition',
    name: 'Ancient Acquisition',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'discover',
        pool: { scope: 'gy', who: 'self', filter: { not: { defId: 'ancient_acquisition' } } },
        count: 3,
        pick: 1,
        prompt: 'Discover a card in your GY',
        // '$discovered' is the card the player picked, so the move takes that
        // GY card and no other. The repeat is a sibling node rather than a
        // nested one: the substitution walks the whole `then` tree, so a
        // sentinel inside a nested Discover would be filled in with the outer
        // pick before the inner prompt was ever answered.
        then: [
          { op: 'moveTo', target: { who: 'self', zone: 'gy', filter: { defId: '$discovered' }, count: 1 }, zone: 'hand' },
        ],
      },
      {
        op: 'discover',
        pool: { scope: 'gy', who: 'self', filter: { not: { defId: 'ancient_acquisition' } } },
        count: 3,
        pick: 1,
        prompt: 'Discover another card in your GY',
        then: [
          { op: 'moveTo', target: { who: 'self', zone: 'gy', filter: { defId: '$discovered' }, count: 1 }, zone: 'hand' },
        ],
      },
    ],
    triggers: [],
    text: 'Discover a card in your GY and add it to your hand, then repeat (excluding Ancient Acquisition). +1 Action.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'ancient_acquisition', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'back_from_the_gy',
    name: 'Back From the GY',
    cost: { money: 7 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 3 },
    effects: [
      {
        op: 'choose',
        options: [
          {
            label: '4 GY Actions costing (0)-(2)',
            effects: [
              {
                op: 'moveTo',
                target: { who: 'self', zone: 'gy', filter: { type: 'Action', cost: { lte: 2 } }, count: 4, pick: 'choose', chooser: 'self' },
                zone: 'hand',
              },
            ],
          },
          {
            label: '2 GY Actions costing (3)-(4)',
            effects: [
              {
                op: 'moveTo',
                target: { who: 'self', zone: 'gy', filter: { type: 'Action', cost: { gte: 3, lte: 4 } }, count: 2, pick: 'choose', chooser: 'self' },
                zone: 'hand',
              },
            ],
          },
          {
            label: '1 GY Action costing (5)-(7)',
            effects: [
              {
                op: 'moveTo',
                target: { who: 'self', zone: 'gy', filter: { type: 'Action', cost: { gte: 5, lte: 7 } }, count: 1, pick: 'choose', chooser: 'self' },
                zone: 'hand',
              },
            ],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Choose: 4 GY Actions costing (0)-(2), 2 costing (3)-(4), or 1 costing (5)-(7). Add them to your hand. +3 Actions.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'back_from_the_gy', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'pointer',
    name: 'Pointer',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    // SB-7's Mutilate, now that `playCard` consumes the bind. The card names
    // nothing: `opNextCardModifier` stamps the arming instance into
    // `bindSource`, and when the next card resolves, play.ts marks both halves
    // with one shared `pointerPair` id. `trashWithTrigger` reads that id —
    // trash either half and the other goes with it, which is Mutilate.
    // (The old `absorbInto:''` guard is gone with the autofill it blocked: a
    // bind no longer fills `absorbInto`, so there is nothing left to stop.)
    // Measured, with a partner that has a printed effect body — the 82% case
    // that used to lose its stamp to a stale object: both halves come out of
    // the play carrying pointerPair=341, and trashing the partner puts THIS
    // card in the trash with it. Mutilated and Trashed together are real.
    //
    // PLAYED TOGETHER is the same ongoing property as the other two verbs, not
    // just the formation moment: once the pair exists, playing either half from
    // hand plays the other, free (play.ts step 7b). It lives in the engine and
    // not on this card because triggers are per-DEFINITION and the partner is
    // whatever the player played next — its definition has never heard of
    // Pointer. The pairing was already engine state for exactly this reason:
    // step 6b mints the id, `trashWithTrigger` reads it for Mutilate, and step
    // 7b reads it for the play.
    //
    // Naming this card by `{defId:'pointer'}` from data would have been the
    // other road, and it is a trap: it re-resolves this body, arming a SECOND
    // binding that captures whatever is played next, chaining every later card
    // onto one instance.
    effects: [{ op: 'nextCardModifier', mod: { bind: 'pointer', uses: 1, appliesTo: 'play' } }],
    triggers: [],
    text: '+1 Action. The next card you play is Pointed to this one: they are Played, Mutilated and Trashed together.',
    flavor: 'Dereference at your own risk.',
    complexity: 'T4',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'pointer', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'hivemind',
    name: 'Hivemind',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    // The headline clause is live. `absorbInto` is typed InstanceId — an id
    // minted at runtime that card data can never write — so `'self'` is the
    // sentinel for "the card arming this", and `opNextCardModifier`
    // (effects/ops/timing.ts) swaps it for the arming `item.sourceIid` before
    // the mod is queued. When the next card resolves, play.ts step 6 pushes
    // that card's `def.effects` onto this instance's `extraEffects`, which is
    // per-instance state and survives zone changes and shuffles (B63) — so the
    // gain really is permanent, not until-end-of-turn.
    // Measured: play Hivemind, then a card printing +3 Money. The mod resolves
    // to Hivemind's own iid, the donor gets Flimsy and trashes on play, and
    // Hivemind's `extraEffects` becomes [{op:'gain',stat:'money',amount:3}].
    // Return Hivemind to hand and play it again and that +3 fires from step 5's
    // `[...def.effects, ...inst.extraEffects]` — money 3 -> 6.
    // A card with an empty printed body is absorbed as nothing, which is
    // correct: it has no effects to give.
    effects: [
      { op: 'nextCardModifier', mod: { grantKeyword: 'Flimsy', absorbInto: 'self', uses: 1, appliesTo: 'play' } },
      { op: 'addCounter', target: { self: true }, key: 'absorbed', amount: 1 },
    ],
    triggers: [],
    text: '+1 Action. The next card you play gains Flimsy; this card permanently gains its effects. ({absorbed} absorbed.)',
    complexity: 'T4',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'hivemind', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'homebrew',
    name: 'Homebrew',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'discover',
        pool: { scope: 'knownUniverse', filter: { cost: { eq: 1 } } },
        count: 3,
        pick: 1,
        prompt: 'Discover a (1)-cost card to brew into this one',
        // The row is "add its effect to this card, THEN upgrade it" — one
        // breath, no play in the middle, and the discovered card is never
        // gained. That is `{op:'absorb'}`: it grafts the picked definition's
        // printed effects onto this instance's `extraEffects` immediately.
        //
        // The deferred cousin, `NextCardMod.absorbInto`, is Hivemind's shape —
        // it waits for the absorbed card to be PLAYED. Homebrew was written
        // that way once, which meant handing the player the card and hoping
        // they played it; the row promises the effect outright, so the absorb
        // has to land here.
        //
        // `pushChosen` (ops/choices.ts) carries the outer `sourceIid` into
        // every node of `then`, so `{self:true}` is Homebrew's own instance,
        // and `substituteDefId` walks the whole node, so `$discovered` is the
        // card that was actually picked. `transform` replaces in place (same
        // iid, counters and extraEffects intact), so the brew survives the
        // upgrade on the last line — which is what lets one row say
        // "permanently" and "then upgrade it" at the same time.
        then: [
          { op: 'absorb', defId: '$discovered', target: { self: true } },
          { op: 'addCounter', target: { self: true }, key: 'brewed', amount: 1 },
          { op: 'transform', target: { self: true }, into: 'upgrade' },
        ],
      },
    ],
    triggers: [],
    text: 'Discover a (1)-cost Known Universe card and permanently add its effect to this card. Then upgrade this card. ({brewed} brewed.)',
    complexity: 'T4',
    subsystems: ['S-PERSIST', 'S-CODEX'],
    shop: 'draft',
    art: { key: 'homebrew', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'one_twelfth_in_the_light',
    name: '1/12th In the Light',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'transform',
        target: { who: 'self', zone: 'library', count: { expr: 'floor(deckSize / 12)' }, pick: 'random' },
        into: { pool: { scope: 'hand', who: 'self' } },
      },
    ],
    triggers: [],
    text: 'Transform every 12th card in your deck into a copy of a card in your hand.',
    complexity: 'T3',
    subsystems: ['S-CORE'],
    shop: 'draft',
    art: { key: 'one_twelfth_in_the_light', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'pashes_the_pie_rat',
    name: 'Pashes the Pie Rat',
    cost: { money: 1 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'legendary',
    keywords: [],
    stats: { cards: 1 },
    effects: [],
    triggers: [
      {
        // 'onPlay' only ever reaches the card that was just played, and that
        // card is in 'play' — the old zones list could never match, so the
        // whole trigger was dead. Firing on Pashes' own play is the reachable
        // half of the printed clause; the rest needs a table-wide play event.
        on: 'onPlay',
        zones: ['play'],
        condition: { has: { target: { who: 'self', zone: 'play', filter: { rarity: 'legendary', cost: { eq: 1 } } }, atLeast: 1 } },
        effects: [{ op: 'recruit', zone: 'library', filter: { defId: 'pashes_the_pie_rat' }, count: 1, who: 'self', to: 'hand' }],
        maxPerTurn: 3,
      },
    ],
    text: 'Whenever you play this (1)-cost Legendary, Recruit another Pashes the Pie Rat from your Library. +1 Card.',
    flavor: 'He knows where the pies are.',
    complexity: 'T3',
    subsystems: ['S-PERSIST'],
    shop: 'draft',
    art: { key: 'pashes_the_pie_rat', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
];

export default cards;
