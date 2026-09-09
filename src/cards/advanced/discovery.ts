/**
 * A.25 — Draft Shop: Discover, generation and rarity pulls.
 *
 * SB-40: Zephrys, Second Time Around and Infinite Realities resolve through the
 * cheap substitutes in `@engine/meta` rather than any solver. The card data
 * below carries the Discover shape; `simSubstitutes` is the hook the
 * interpreter is meant to call to fill those pools with the heuristic picks
 * — nothing in the engine reads it yet, so those three still sample at random.
 *
 * SB-13: the Fusion cards merge through `{op:'fuse'}`. The op runs the fusion
 * arithmetic in `@engine/systems`, gives each component its `onFuse` window
 * first (Chopped Chuzz's refusal) and consumes the components, so card data
 * never assembles a composite itself.
 */
import type { CardDefId, CardDefinition, CardFilter, EffectNode, GameState, PlayerId, Rarity } from '@engine/types';
import { perfectCardFor, winningDeckFor } from '@engine/meta';
import { rarityPullWeight } from '@engine/shop';

/**
 * SB-40 hooks. The interpreter looks a card up here before opening its Discover
 * prompt; a hit replaces the sampled pool with these ids.
 */
export const simSubstitutes: Record<CardDefId, (state: GameState, player: PlayerId) => CardDefId[]> = {
  zephrys: (state, player) => {
    const pick = perfectCardFor(state, player);
    return pick === null ? [] : [pick];
  },
  second_time_around: (state, player) => winningDeckFor(state, player).slice(0, 3),
  infinite_realities: (state, player) => winningDeckFor(state, player),
};

/**
 * Matchmaker and Freaky Phil fuse "non-fused" cards. A composite carries no
 * mark a `CardFilter` can read — `CardInstance.fusedFrom` is instance state the
 * filter layer never looks at — but SB-13 fixes a fused card's NAME as
 * "<A> · <B>", and no printed card in the catalog holds that separator, so the
 * name is an exact test for "this is already a fusion".
 */
const NOT_ALREADY_FUSED: CardFilter = { not: { nameContainsAny: [' · '] } };

/**
 * One "Discover 2 Known Universe cards and Fuse them" pass for What is Love?.
 *
 * Both picks are created in hand carrying `tag`, and the fuse runs from inside
 * the Discover's own `then`, on the LAST pick — `x` is the pick index, so
 * `x == 1` is the second of two. That is the only point where both picks are
 * guaranteed to exist: `then` runs once per chosen card (pushChosen in
 * effects/ops/choices.ts, and the same contract in core/resume.ts), and each of
 * those runs ends in `runQueue`'s tail drain (effects/index.ts, "drain anything
 * parked earlier"), which empties the queue parked behind the prompt — so a
 * fuse written as a sibling node after the Discover would resolve after pick 0,
 * with one card on the table, and merge nothing. Heroic Aura Mycology
 * (advanced/auras.ts) is the same shape for the same reason. That drain is also
 * why each pass carries its own tag: the second Discover runs between the first
 * one's two picks, so the two passes interleave and each fuse has to be able to
 * find its own pair.
 *
 * The mark is `trg:`-prefixed, the engine's "bookkeeping, not a game tally"
 * namespace: `selfCounter` skips it (effects/context.ts), the client view hides
 * it (view.ts) and start of turn wipes it (core/triggers.ts). The cleanup below
 * clears it in the ordinary case; the prefix is what keeps the one case that
 * cannot reach the cleanup harmless — a codex too small to offer 2 options
 * makes `pick` clamp to 1 (opDiscover), so `x == 1` never comes round and the
 * single card would otherwise carry a permanent tally no effect ever meant to
 * read. The component consumed into the composite keeps its mark in the trash
 * for the same reason.
 */
function discoverAndFuse(tag: string): EffectNode {
  return {
    op: 'discover',
    pool: { scope: 'knownUniverse' },
    count: 3,
    pick: 2,
    prompt: 'Discover 2 cards to Fuse',
    then: [
      { op: 'createCard', defId: '$discovered', to: 'hand', counters: { [tag]: 1 } },
      {
        op: 'conditional',
        if: { expr: 'x == 1' },
        then: [
          {
            op: 'fuse',
            target: { who: 'self', zone: 'hand', filter: { counter: { key: tag, gte: 1 } } },
            to: 'hand',
          },
          // The composite is the first component reused in place, counters and
          // all, so the mark has to come off it: a second copy of this card
          // played the same turn writes the same key, and its fuse would
          // otherwise pull this composite in as a third component.
          {
            op: 'addCounter',
            target: { who: 'self', zone: 'hand', filter: { counter: { key: tag, gte: 1 } } },
            key: tag,
            amount: -1,
          },
        ],
      },
    ],
  };
}

/** Hearthstone pack odds expressed over the shop's own rarity pull weights. */
function packBranches(): { weight: number; effects: EffectNode[] }[] {
  const tiers: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
  const branches: { weight: number; effects: EffectNode[] }[] = [];
  for (const tier of tiers) {
    const w = rarityPullWeight(tier);
    branches.push({
      weight: w * 0.95,
      effects: [{ op: 'createCard', defId: { pool: { scope: 'entireUniverse', filter: { rarity: tier }, weighted: false } }, to: 'hand' }],
    });
    // Golden pull: same card, plus a Gold.
    branches.push({
      weight: w * 0.05,
      effects: [
        { op: 'createCard', defId: { pool: { scope: 'entireUniverse', filter: { rarity: tier }, weighted: false } }, to: 'hand' },
        { op: 'createCard', defId: 'gold', to: 'hand' },
      ],
    });
  }
  return branches;
}

export const cards: CardDefinition[] = [
  {
    id: 'pandoras_box',
    name: "Pandora's Box",
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'discover',
        pool: { scope: 'entireUniverse' },
        count: 3,
        pick: 1,
        prompt: 'Discover any card in the Entire Universe',
        then: [],
      },
    ],
    triggers: [],
    text: 'Discover an Entire Universe card and add it to your hand. +1 Action.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'pandoras_box', status: 'placeholder' },
  },
  {
    id: 'lag_in_the_system',
    name: 'Lag in the System',
    cost: { money: 2 },
    types: ['Action'],
    subtypes: [],
    tags: ['Legacy'],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      { op: 'gainCard', from: { shop: 'all', filter: { cost: { eq: 0 } } }, to: 'hand', free: true },
      { op: 'gainCard', from: { shop: 'all', filter: { cost: { eq: 1 } } }, to: 'hand', free: true },
    ],
    triggers: [],
    text: 'Add one of each (0)- and (1)-cost shop card to your hand. +1 Action.',
    complexity: 'T2',
    subsystems: ['S-SHOP'],
    shop: 'draft',
    art: { key: 'lag_in_the_system', status: 'placeholder' },
  },
  {
    id: 'epic_fate',
    name: 'Epic Fate',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [{ op: 'createCard', defId: { pool: { scope: 'knownUniverse', filter: { rarity: 'epic' } } }, to: 'hand' }],
    triggers: [],
    text: 'Flimsy. Add a random Epic from your Known Universe to your hand. +1 Action.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'epic_fate', status: 'placeholder' },
  },
  {
    id: 'legendary_destiny',
    name: 'Legendary Destiny',
    cost: { money: 8 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [
      {
        op: 'discover',
        pool: { scope: 'entireUniverse', filter: { rarity: 'legendary' } },
        count: 3,
        pick: 1,
        prompt: 'Discover a Legendary',
        then: [],
      },
    ],
    triggers: [],
    text: 'Flimsy. Discover a Legendary from the Entire Universe and add it to your hand. +1 Action.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'legendary_destiny', status: 'placeholder' },
  },
  {
    id: 'zephrys',
    name: 'Zephrys',
    cost: { money: 10 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'legendary',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'discover',
        pool: { scope: 'knownUniverse' },
        count: 3,
        pick: 1,
        prompt: 'Discover the perfect card for your hand',
        then: [],
      },
    ],
    triggers: [],
    text: 'Discover the perfect card for your hand. +1 Action.',
    flavor: 'The wish is granted, more or less.',
    complexity: 'T4',
    subsystems: ['S-SIM', 'S-CODEX'],
    shop: 'draft',
    art: { key: 'zephrys', status: 'placeholder' },
  },
  {
    id: 'wardrums_mystery_box',
    name: "Wardrum's Mystery Box",
    cost: { money: 8 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'legendary',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'repeat',
        times: 5,
        effects: [
          { op: 'createCard', defId: { pool: { scope: 'entireUniverse', filter: { type: 'Action' } } }, to: 'hand', keywords: ['Flimsy'] },
          // `createCard` appends to the end of hand, so `pick:'bottom'` casts the
          // Action this iteration just generated rather than a card already held.
          { op: 'playCard', target: { who: 'self', zone: 'hand', count: 1, pick: 'bottom' } },
        ],
      },
    ],
    triggers: [],
    text: 'Flimsy. Cast 5 random Entire Universe Actions with random targets.',
    complexity: 'T3',
    subsystems: ['S-CODEX', 'S-MULTIPLIER'],
    shop: 'draft',
    art: { key: 'wardrums_mystery_box', status: 'placeholder', anim: 'explode' },
  },
  {
    id: 'wardrums_bold_prediction',
    name: "Wardrum's Bold Prediction",
    cost: { money: 8 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'legendary',
    keywords: ['Flimsy'],
    stats: {},
    effects: [
      {
        op: 'transform',
        target: { who: 'self', zone: ['library', 'hand', 'gy'] },
        into: { pool: { scope: 'knownUniverse' } },
      },
    ],
    triggers: [],
    text: 'Flimsy. Transform your entire deck into random Known Universe cards.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'wardrums_bold_prediction', status: 'placeholder', anim: 'shuffle' },
  },
  {
    id: 'predatory_monetization',
    name: 'Predatory Monetization',
    cost: { money: 10 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [
      { op: 'repeat', times: 5, effects: [{ op: 'random', branches: packBranches() }] },
    ],
    triggers: [],
    text: 'Flimsy. +1 Action. Open a card pack: 5 cards at pack odds. Golden pulls also give you a Gold.',
    flavor: 'Just one more pack.',
    complexity: 'T4',
    subsystems: ['S-SHOP', 'S-CODEX'],
    shop: 'draft',
    art: { key: 'predatory_monetization', status: 'placeholder', anim: 'explode' },
  },
  {
    id: 'alien_dropshipping',
    name: 'Alien Dropshipping',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    effects: [
      {
        op: 'createCard',
        defId: { pool: { scope: 'entireUniverse', filter: { cost: { eq: 6 } } } },
        to: 'library',
        count: 3,
        position: 'random',
        keywords: ['Flimsy'],
      },
      { op: 'shuffle', zone: 'library', who: 'self' },
    ],
    triggers: [],
    text: 'Play on Buy, Flimsy. Shuffle 3 random (6)-cost Entire Universe cards into your Library with Flimsy.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'alien_dropshipping', status: 'placeholder', anim: 'shuffle' },
  },
  {
    id: 'a_gaze_into_the_past',
    name: 'A Gaze into the Past',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    effects: [{ op: 'createCard', defId: { pool: { scope: 'entireUniverse', filter: { tag: 'Legacy' } } }, to: 'hand' }],
    triggers: [],
    text: '+1 Action. Add a random Legacy card from the Entire Universe to your hand.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'a_gaze_into_the_past', status: 'placeholder' },
  },
  {
    id: 'a_glimpse_of_the_past',
    name: 'A Glimpse of the Past',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'rare',
    keywords: ['Flimsy'],
    stats: { actions: 1 },
    effects: [{ op: 'createCard', defId: { pool: { scope: 'entireUniverse', filter: { tag: 'Legacy' } } }, to: 'hand' }],
    triggers: [],
    text: 'Flimsy. +1 Action. Add a random Legacy card from the Entire Universe to your hand.',
    complexity: 'T3',
    subsystems: ['S-CODEX'],
    shop: 'draft',
    art: { key: 'a_glimpse_of_the_past', status: 'placeholder' },
  },
  {
    id: 'second_time_around',
    name: 'Second Time Around',
    cost: { money: 5 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: {},
    effects: [
      {
        op: 'discover',
        pool: { scope: 'knownUniverse' },
        count: 3,
        pick: 1,
        prompt: 'Discover a card from a reality where you win',
        then: [],
      },
    ],
    triggers: [],
    text: 'Discover a card from a simulated reality where you win.',
    complexity: 'T4',
    subsystems: ['S-SIM', 'S-CODEX'],
    shop: 'draft',
    art: { key: 'second_time_around', status: 'placeholder' },
  },
  {
    id: 'infinite_realities',
    name: 'Infinite Realities',
    cost: { money: 20 },
    types: ['Action'],
    subtypes: [],
    tags: [],
    rarity: 'mythic',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    effects: [
      { op: 'trash', target: { who: 'self', zone: ['hand', 'library', 'gy'] } },
      {
        op: 'createCard',
        defId: { pool: { scope: 'knownUniverse' } },
        to: 'library',
        count: 10,
        position: 'random',
      },
      { op: 'shuffle', zone: 'library', who: 'self' },
      { op: 'draw', amount: 5 },
    ],
    triggers: [],
    text: 'Play on Buy, Flimsy. Replace your hand, Library and GY with a deck from a reality where you win.',
    flavor: 'One of them had to work.',
    complexity: 'T4',
    subsystems: ['S-SIM', 'S-CODEX'],
    shop: 'draft',
    art: { key: 'infinite_realities', status: 'placeholder', anim: 'shuffle' },
  },
  {
    id: 'what_is_love',
    name: 'What is Love?',
    cost: { money: 9 },
    types: ['Action'],
    subtypes: ['Fusion'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 2 },
    // Written out twice rather than wrapped in `repeat`, because the two passes
    // need different tags to keep their pairs apart — see `discoverAndFuse`.
    effects: [discoverAndFuse('trg:wil:1'), discoverAndFuse('trg:wil:2')],
    triggers: [],
    text: 'Discover 2 Known Universe cards to Fuse and add the result to your hand — twice. +2 Actions.',
    flavor: 'Baby don\'t hurt me.',
    complexity: 'T4',
    subsystems: ['S-FUSE', 'S-CODEX'],
    shop: 'draft',
    art: { key: 'what_is_love', status: 'placeholder' },
  },
  {
    id: 'matchmaker',
    name: 'Matchmaker',
    cost: { money: 4 },
    types: ['Action'],
    subtypes: ['Fusion'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 1 },
    // No `to`: the fusion mutates the first component in place, so the
    // composite stays at that card's position in the Library (SB-13) and the
    // Library shrinks by one. Nothing is copied and nothing is shuffled — the
    // printed line is deck compression, not deck growth.
    effects: [
      {
        op: 'fuse',
        target: { who: 'self', zone: 'library', count: 2, pick: 'random', filter: NOT_ALREADY_FUSED },
      },
    ],
    triggers: [],
    text: 'Fuse 2 random non-fused cards in your Library. +1 Action.',
    complexity: 'T4',
    subsystems: ['S-FUSE'],
    shop: 'draft',
    art: { key: 'matchmaker', status: 'placeholder' },
  },
  {
    id: 'freaky_phil',
    name: 'Freaky Phil',
    cost: { money: 6 },
    types: ['Action'],
    subtypes: ['Fusion'],
    tags: [],
    rarity: 'legendary',
    keywords: [],
    stats: { actions: 1 },
    // Matchmaker with three components. `fusedDefinition` sums the three costs
    // and caps the result at 20 (SB-13); a Library holding fewer than 2
    // non-fused cards fuses nothing rather than half-merging.
    effects: [
      {
        op: 'fuse',
        target: { who: 'self', zone: 'library', count: 3, pick: 'random', filter: NOT_ALREADY_FUSED },
      },
    ],
    triggers: [],
    text: 'Fuse 3 random non-fused cards in your Library. +1 Action.',
    complexity: 'T4',
    subsystems: ['S-FUSE'],
    shop: 'draft',
    art: { key: 'freaky_phil', status: 'placeholder' },
  },
  {
    id: 'frankenstein',
    name: 'Frankenstein',
    cost: { money: 3 },
    types: ['Action'],
    subtypes: ['Fusion'],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy'],
    stats: { buys: 1 },
    effects: [
      // Both clauses are still engine-blocked, and the mods below are the
      // closest inert placeholders. `appendEffects` is only read by
      // `consumePlayMods` (core/play.ts), which skips every `appliesTo:'buy'`
      // mod, and the buy path's own `peekBuyMods`/`consumeBuyMods`
      // (core/buy.ts) read costDelta, costFloor and buyTo alone — so the refund
      // never pays out, and `selfCost` would read Frankenstein's (3) rather
      // than the purchase's cost even if it did.
      {
        op: 'nextCardModifier',
        mod: { appliesTo: 'buy', uses: 1, costDelta: 0, appendEffects: [{ op: 'gain', stat: 'money', amount: { expr: 'floor(selfCost / 2)' } }] },
      },
      // `consumeBuyMods` decrements every `appliesTo:'buy'` mod on the FIRST
      // purchase, so this lands there too instead of on the second one, and
      // NextCardMod has no ordering or skip field to say otherwise.
      {
        op: 'nextCardModifier',
        mod: { appliesTo: 'buy', uses: 1, buyTo: 'hand' },
      },
    ],
    triggers: [],
    text: 'Flimsy. +1 Buy. Your first purchase refunds 50% (round down); your next purchase fuses with the previous one.',
    complexity: 'T4',
    subsystems: ['S-FUSE', 'S-COSTMOD'],
    shop: 'draft',
    art: { key: 'frankenstein', status: 'placeholder' },
  },
];

export default cards;
