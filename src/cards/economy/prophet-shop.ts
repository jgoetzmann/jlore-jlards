/**
 * A.3 Prophet Shop — all 24 entries.
 *
 * Every purchasable card here has `cost.prophet = { threshold, drain }` and
 * `shop: 'prophet'` (B99). All 24 are present in every match (SB-14).
 * Each carries the subtype 'Prophet' so cards that fish the Prophet menu
 * (Kwzki High Council Consultant) have a filterable handle.
 *
 * SB-19: Scripture of Siva is written, not blank.
 */
import type { CardDefId, CardDefinition, EffectNode } from '@engine/types';

/**
 * The (−1) drain tier of A.3, named by id. `CardFilter` carries no Prophet-drain
 * field, so a pool that wants "a (−1) Prophet card" has to list its members;
 * filtering on `subtype: 'Prophet'` alone offers the whole 24-card menu.
 */
const DRAIN_1_PROPHET: CardDefId[] = [
  'chains_of_the_sovereign',
  'destiny_draw',
  'mulligan',
  'platinum',
  'pray_for_rain',
  'truss_pluss',
  'the_unconcerned_lion',
];

/**
 * Kwzki High Council Consultant fires the same Discover from its body and from
 * its onDiscard trigger. '$discovered' is substituted for the picked defId on
 * resume; `{self:true}` in a Discover `then` would mean the Consultant itself.
 */
const consultTheCouncil = (): EffectNode => ({
  op: 'discover',
  pool: { scope: 'knownUniverse', filter: { subtype: 'Prophet', defId: DRAIN_1_PROPHET } },
  count: 3,
  pick: 1,
  prompt: 'Consult the Council',
  then: [{ op: 'createCard', defId: '$discovered', to: 'hand', keywords: ['Temporary'] }],
});

export const cards: CardDefinition[] = [
  {
    id: 'chains_of_the_sovereign',
    name: 'Chains of the Sovereign',
    cost: { prophet: { threshold: 1, drain: 1 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: ['PvP'],
    rarity: 'rare',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    effects: [
      {
        op: 'conditional',
        // Approximate, and the only reading available. `lockedPiles` walks
        // EVERY pile in the shop and counts `locks.length > 0` without asking
        // `lockIsActive`, so inert locks and other shops' locks feed the gate
        // while the draft shop's own live count is never isolated; the literal
        // 5 is half of the default draft pile count. Neither a live draft-lock
        // count nor the configured pile count is exposed to expressions.
        if: { expr: 'lockedPiles < 5' },
        then: [
          {
            op: 'lockPile',
            // A real prompt: `count: 1` is what makes `pick:'choose'` suspend
            // (an uncounted pile selector short-circuits on `want >= all.length`
            // and silently returns the whole Draft Shop), and a suspended
            // 'selectPile' node is now re-dispatched with the answer on resume.
            target: { shop: 'draft', pick: 'choose', count: 1, excludeJlore: true },
            duration: 'untilEndOfYourNextTurn',
          },
        ],
      },
    ],
    triggers: [
      {
        // Dormant on purpose, and left at the default trigger zones. 'onUnlock'
        // carries no pile identity (opUnlockPile fires it with `subject: null`)
        // and fireEvent sweeps every instance in the game for a non-self event,
        // so widening `zones` to reach this card in its Flimsy trash would charge
        // the owner's chosen opponent on ANY explicit unlock of ANY pile by
        // anyone — Seal the Rift's own delayed unlock included, and once per
        // locked pile for a `{ shop: 'all' }` unlock. Natural expiry in
        // expireShopTimers fires nothing at all, so the printed case needs the
        // event to name its pile before this clause can be scoped correctly.
        on: 'onUnlock',
        effects: [{ op: 'gain', stat: 'prophet', amount: -2, who: 'chosenOpponent' }],
      },
    ],
    text: 'Play on Buy, Flimsy. Lock a Draft Shop pile. Unlocking it costs an opponent (-2) Prophet. Fails if half or more of the Draft piles are already Locked.',
    flavor: 'The market kneels.',
    complexity: 'T3',
    subsystems: ['S-LOCK', 'S-PROPHET'],
    shop: 'prophet',
    art: { key: 'chains_of_the_sovereign', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'destiny_draw',
    name: 'Destiny Draw',
    cost: { prophet: { threshold: 1, drain: 1 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'moveTo',
        target: { who: 'self', zone: 'library', count: 1, pick: 'mostExpensive' },
        zone: 'hand',
      },
    ],
    triggers: [],
    text: 'Draw the most expensive card in your Library. +1 Action.',
    flavor: 'It was always going to be that one.',
    complexity: 'T2',
    subsystems: ['S-PROPHET', 'S-CORE'],
    shop: 'prophet',
    art: { key: 'destiny_draw', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'mulligan',
    name: 'Mulligan',
    cost: { prophet: { threshold: 2, drain: 1 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: [],
    rarity: 'common',
    keywords: ['PlayOnBuy', 'Flimsy'],
    // The draw has to follow the discard, and `applyStats` always runs before
    // the effect body — a `stats: { cards: 5 }` line drew first and the discard
    // then swept the fresh hand. Ordered draws live in `effects` (the shape
    // Infinite Realities uses); the standing cost is that Buff/Nerf can no
    // longer see the +5 Cards.
    stats: {},
    effects: [
      { op: 'discard', target: { who: 'self', zone: 'hand' } },
      { op: 'draw', amount: 5 },
    ],
    triggers: [],
    text: 'Play on Buy, Flimsy. Discard your hand, then +5 Cards.',
    flavor: 'Do-over.',
    complexity: 'T2',
    subsystems: ['S-PROPHET', 'S-CORE'],
    shop: 'prophet',
    art: { key: 'mulligan', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'shuffle' },
  },
  {
    id: 'cost_co',
    name: 'Cost Co.',
    cost: { prophet: { threshold: 2, drain: 2 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: [],
    rarity: 'epic',
    keywords: [],
    stats: { actions: 2, buys: 2, cards: 2, money: 2 },
    effects: [],
    triggers: [],
    text: '+2 Actions, +2 Buys, +2 Cards, +2 Money.',
    flavor: 'Membership has its privileges.',
    complexity: 'T1',
    subsystems: ['S-PROPHET'],
    shop: 'prophet',
    art: { key: 'cost_co', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'all_in',
    name: 'All In',
    cost: { prophet: { threshold: 3, drain: 3 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: [],
    rarity: 'epic',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    effects: [
      { op: 'recruit', zone: 'library', count: { expr: 'libraryHeight' }, to: 'hand' },
      { op: 'recruit', zone: 'gy', count: { expr: 'gyHeight' }, to: 'hand' },
      { op: 'trash', target: { who: 'self', zone: 'hand' } },
    ],
    triggers: [],
    text: 'Play on Buy, Flimsy. Recruit your entire deck, then trash it.',
    flavor: 'Push everything forward. Smile.',
    complexity: 'T3',
    subsystems: ['S-PROPHET', 'S-CORE'],
    shop: 'prophet',
    art: { key: 'all_in', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'platinum',
    name: 'Platinum',
    cost: { prophet: { threshold: 3, drain: 1 } },
    types: ['Resource'],
    subtypes: ['Prophet', 'Platinum'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { money: 4 },
    effects: [],
    triggers: [],
    text: '+4 Money.',
    flavor: 'Above Gold, below faith.',
    complexity: 'T1',
    subsystems: ['S-PROPHET'],
    shop: 'prophet',
    art: { key: 'platinum', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'coin' },
  },
  {
    id: 'the_trilogy',
    name: 'The Trilogy',
    cost: { prophet: { threshold: 3, drain: 2 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: [],
    rarity: 'epic',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    // "The 3 Books PRINTED on this" — a fixed, previewable trio. Sampling the
    // book catalog three times gave a different set every play and could deal
    // the same Book twice, which neither the printed identity nor the S-HIDDEN
    // hover preview can render.
    effects: [
      { op: 'createCard', defId: 'book_of_knowledge', to: 'hand' },
      { op: 'createCard', defId: 'book_of_flame', to: 'hand' },
      { op: 'createCard', defId: 'book_of_books', to: 'hand' },
    ],
    triggers: [],
    text: 'Cast on Buy, Flimsy. Add the 3 Books printed on this card to your hand: Book of Knowledge, Book of Flame and Book of Books.',
    flavor: 'Volumes I, II and the one nobody finishes.',
    complexity: 'T3',
    subsystems: ['S-PROPHET', 'S-HIDDEN', 'S-TOKEN'],
    shop: 'prophet',
    art: { key: 'the_trilogy', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'pray_for_rain',
    name: 'Pray for Rain',
    cost: { prophet: { threshold: 3, drain: 1 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: [],
    rarity: 'rare',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    effects: [
      {
        op: 'createCard',
        defId: { pool: { scope: 'entireUniverse', filter: { type: 'Resource' } } },
        to: 'gy',
        count: 5,
      },
    ],
    triggers: [],
    text: 'Cast on Buy, Flimsy. Add 5 random Resources to your GY.',
    flavor: 'It worked. It always works eventually.',
    complexity: 'T2',
    subsystems: ['S-PROPHET'],
    shop: 'prophet',
    art: { key: 'pray_for_rain', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'project_doomsday',
    name: 'Project: Doomsday',
    cost: { prophet: { threshold: 3, drain: 3 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: ['PvP'],
    rarity: 'legendary',
    keywords: ['PlayOnBuy'],
    stats: {},
    effects: [
      { op: 'incDoomsday', amount: 1 },
      { op: 'createCard', defId: 'doomsday_button', to: 'gy', who: 'randomOpponent' },
    ],
    triggers: [],
    text: 'Cast on Buy. Doomsday Counter +1; at 10 the game ends immediately. Add a Doomsday Button to a random opponent’s GY.',
    flavor: 'Everyone gets a button. That is the project.',
    complexity: 'T3',
    subsystems: ['S-PROPHET', 'S-TOKEN', 'S-ENDGAME'],
    shop: 'prophet',
    art: { key: 'project_doomsday', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
  {
    id: 'kwzki_high_council_consultant',
    name: 'Kwzki High Council Consultant',
    cost: { prophet: { threshold: 4, drain: 2 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: [],
    rarity: 'epic',
    keywords: ['PlayOnBuy'],
    stats: {},
    effects: [consultTheCouncil()],
    triggers: [
      {
        on: 'onDiscard',
        effects: [consultTheCouncil()],
      },
    ],
    text: 'Play on Buy. On play or discard, add a Temporary (-1) Prophet card from your Known Universe to your hand.',
    flavor: 'Billable by the revelation.',
    complexity: 'T3',
    subsystems: ['S-PROPHET', 'S-DISCOVER', 'S-CODEX'],
    shop: 'prophet',
    art: { key: 'kwzki_high_council_consultant', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'truss_pluss',
    name: 'Truss Pluss',
    cost: { prophet: { threshold: 4, drain: 1 } },
    types: ['Action'],
    subtypes: ['Prophet', 'Truss'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 4, cards: 2 },
    effects: [],
    triggers: [],
    text: '+4 Actions, +2 Cards.',
    flavor: 'Structurally sound. Spiritually load-bearing.',
    complexity: 'T1',
    subsystems: ['S-PROPHET'],
    shop: 'prophet',
    art: { key: 'truss_pluss', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'seal_the_rift',
    name: 'Seal the Rift',
    cost: { prophet: { threshold: 4, drain: 2 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { actions: 1 },
    // Both halves have to name the SAME pile, and `pick:'choose'` named all ten:
    // an uncounted pile selector never prompts, it just returns the whole shop.
    // A pile prompt cannot be answered yet, and a chosen pile cannot be carried
    // into a delayed body, so all three selectors use the same deterministic
    // pick — a locked pile cannot be bought out, so it is still the most
    // expensive one when the delayed half fires.
    effects: [
      {
        op: 'lockPile',
        target: { shop: 'draft', pick: 'mostExpensive', count: 1, excludeJlore: true },
        duration: 'untilYourNextTurn',
      },
      {
        op: 'delayed',
        when: 'startOfNextTurn',
        effects: [
          {
            op: 'unlockPile',
            target: { shop: 'draft', pick: 'mostExpensive', count: 1, excludeJlore: true },
          },
          {
            op: 'gainCard',
            from: { shop: 'draft', pick: 'mostExpensive', count: 1, excludeJlore: true },
            to: 'gy',
            free: true,
          },
        ],
      },
    ],
    triggers: [],
    text: 'Lock the most expensive Draft Shop pile. At the start of your next turn, unlock it and add its top card to your GY. +1 Action.',
    flavor: 'Close it, then take what leaked out.',
    complexity: 'T3',
    subsystems: ['S-LOCK', 'S-DELAYED', 'S-PROPHET'],
    shop: 'prophet',
    art: { key: 'seal_the_rift', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'ebon_blade',
    name: 'Ebon Blade',
    cost: { prophet: { threshold: 5, drain: 3 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: ['PvP'],
    rarity: 'legendary',
    keywords: [],
    stats: { actions: 1 },
    effects: [
      {
        op: 'trash',
        target: {
          who: 'eachOpponent',
          zone: ['library', 'hand', 'gy'],
          count: 1,
          // Without this, `count` is a total across the whole table: the blade
          // took ONE card at three seats, and both could come from the same
          // player. `perPlayer` runs the count-and-pick once per opponent.
          perPlayer: true,
          pick: 'mostExpensive',
        },
      },
    ],
    triggers: [],
    text: 'Trash the most expensive card in each opponent’s deck. +1 Action.',
    flavor: 'It only cuts what is worth cutting.',
    complexity: 'T3',
    subsystems: ['S-STEAL', 'S-PROPHET'],
    shop: 'prophet',
    art: { key: 'ebon_blade', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'idol_of_the_false_god',
    name: 'Idol of the False God',
    cost: { prophet: { threshold: 6, drain: 3 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: [],
    rarity: 'legendary',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    effects: [
      { op: 'moveTo', target: { who: 'self', zone: 'hand' }, zone: 'gy' },
      {
        op: 'createCard',
        defId: { pool: { scope: 'entireUniverse', filter: { rarity: 'legendary' } } },
        to: 'hand',
        count: 5,
      },
      // `duration:'turn'` writes a lock that expires on the turn it was made —
      // `lockIsActive` is `turn < expiresOnTurn`, so it was inert on arrival.
      // `{ turns: 1 }` expires on the next turn, i.e. it binds for this one.
      { op: 'lockPile', target: { shop: 'prophet' }, duration: { turns: 1 } },
    ],
    triggers: [],
    text: 'Cast on Buy, Flimsy. Replace your hand with random Legendaries. Lock the Prophet Shop until end of turn.',
    flavor: 'Wrong god. Right rewards.',
    complexity: 'T3',
    subsystems: ['S-PROPHET', 'S-LOCK'],
    shop: 'prophet',
    art: { key: 'idol_of_the_false_god', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'religious_dividends',
    name: 'Religious Dividends',
    cost: { prophet: { threshold: 7, drain: 0 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: [],
    rarity: 'rare',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: { money: 2, cards: 1 },
    effects: [],
    triggers: [
      {
        on: 'onBuy',
        effects: [
          {
            op: 'lockPile',
            target: { shop: 'prophet', filter: { defId: 'religious_dividends' } },
            duration: 'untilYourNextTurn',
          },
        ],
      },
    ],
    text: 'Play on Buy, Flimsy. On buy, Lock this pile until your next turn. +2 Money, +1 Card.',
    flavor: 'The collection plate pays out. Once.',
    complexity: 'T2',
    subsystems: ['S-PROPHET', 'S-LOCK'],
    shop: 'prophet',
    art: { key: 'religious_dividends', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'giants_horn',
    name: "Giant's Horn",
    cost: { prophet: { threshold: 8, drain: 4 } },
    types: ['Action'],
    subtypes: ['Prophet'],
    tags: [],
    rarity: 'epic',
    keywords: ['Flimsy', 'PlayOnBuy'],
    stats: { actions: 1 },
    effects: [
      {
        op: 'discover',
        pool: {
          scope: 'entireUniverse',
          filter: { type: 'Action', cost: { gte: 10 } },
        },
        count: 3,
        pick: 1,
        prompt: 'Sound the horn',
        // Empty: the default Discover semantic puts the picked card in hand.
        // `{self:true}` here meant the Horn, which pulled it back out of its own
        // Flimsy trash and never created the Action.
        then: [],
      },
    ],
    triggers: [],
    text: 'Flimsy, Play on Buy. +1 Action. Discover an Action costing (10) or more from the Entire Universe and add it to your hand.',
    flavor: 'One note. Everything hears it.',
    complexity: 'T3',
    subsystems: ['S-PROPHET', 'S-DISCOVER'],
    shop: 'prophet',
    art: { key: 'giants_horn', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'scripture_of_kwzki',
    name: 'Scripture of Kwzki',
    cost: { prophet: { threshold: 10, drain: 5 } },
    types: ['Action'],
    subtypes: ['Prophet', 'Scripture'],
    tags: [],
    rarity: 'legendary',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    effects: [
      {
        op: 'modifyCost',
        scope: 'pile',
        // "Choose a Draft Shop pile" is now a real prompt: `count: 1` is what
        // makes `pick:'choose'` suspend (an uncounted pile selector returns
        // every draft pile without ever asking, which discounted the whole
        // shop), and the suspended node is re-dispatched with the chosen pile.
        target: { shop: 'draft', pick: 'choose', count: 1 },
        delta: -3,
        floor: 0,
        duration: 'turn',
      },
      {
        // Still dormant, and kept as the correct authoring shape. `peekBuyMods`
        // and `consumeBuyMods` read only costDelta/costFloor/buyTo off an
        // `appliesTo:'buy'` mod, and `consumePlayMods` — the one place
        // grantKeyword IS honoured — skips buy-scoped mods, so no bought card
        // ever gains PlayOnBuy. The card-side alternative would be `setKeyword`
        // over the pile's cards, but a Selector has no pile axis (only
        // `zone:'shop'`, which is every pile in every shop) and setKeyword has
        // no duration, so it would grant the keyword shop-wide and forever.
        op: 'nextCardModifier',
        mod: { appliesTo: 'buy', grantKeyword: 'PlayOnBuy', uses: 9 },
      },
    ],
    triggers: [],
    text: 'Play on Buy, Flimsy. Choose a Draft Shop pile: this turn its cards cost (3) less and gain Play on Buy.',
    flavor: 'The verse on discounts.',
    complexity: 'T3',
    subsystems: ['S-COSTMOD', 'S-PROPHET'],
    shop: 'prophet',
    art: { key: 'scripture_of_kwzki', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'scripture_of_siva',
    name: 'Scripture of Siva',
    cost: { prophet: { threshold: 10, drain: 5 } },
    types: ['Action'],
    subtypes: ['Prophet', 'Scripture'],
    tags: ['PvP'],
    rarity: 'legendary',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    effects: [
      {
        op: 'repeat',
        times: { expr: 'playerCount - 1' },
        effects: [
          {
            op: 'discover',
            pool: { scope: 'opponentLibrary', who: 'eachOpponent' },
            count: 3,
            pick: 1,
            prompt: 'Read an opponent’s Library',
            // Empty: the default Discover semantic puts a fresh copy of the
            // picked card in your hand. `{self:true}` here meant Siva itself,
            // so a 4-player play handed you three copies of Siva.
            then: [],
          },
        ],
      },
    ],
    triggers: [],
    text: 'Play on Buy, Flimsy. Discover a card from an opponent’s Library and add a copy to your hand. Repeat for each other opponent.',
    flavor: 'Every library is an open book to the one who wrote them all.',
    complexity: 'T3',
    subsystems: ['S-PROPHET', 'S-DISCOVER', 'S-STEAL', 'S-HIDDEN'],
    shop: 'prophet',
    art: { key: 'scripture_of_siva', status: 'final', artist: 'LCM Dreamshaper v7' },
  },
  {
    id: 'scripture_of_jayaad',
    name: 'Scripture of Jayaad',
    cost: { prophet: { threshold: 10, drain: 5 } },
    types: ['Action'],
    subtypes: ['Prophet', 'Scripture'],
    tags: ['PvP'],
    rarity: 'legendary',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    effects: [{ op: 'trash', target: { who: 'eachPlayer', zone: 'library' } }],
    triggers: [],
    text: 'Play on Buy, Flimsy. Trash all Libraries.',
    flavor: 'And the shelves were bare.',
    complexity: 'T3',
    subsystems: ['S-PROPHET'],
    shop: 'prophet',
    art: { key: 'scripture_of_jayaad', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'trash' },
  },
  {
    id: 'scripture_of_space',
    name: 'Scripture of Space',
    cost: { prophet: { threshold: 10, drain: 5 } },
    types: ['Action'],
    subtypes: ['Prophet', 'Scripture'],
    tags: [],
    rarity: 'legendary',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: {},
    effects: [{ op: 'manifestAura', tier: 'celestial', discover: true }],
    triggers: [],
    text: 'Play on Buy, Flimsy. Discover a Celestial Aura and manifest it.',
    flavor: 'Written in the gaps between stars.',
    complexity: 'T3',
    subsystems: ['S-AURA', 'S-PROPHET', 'S-DISCOVER'],
    shop: 'prophet',
    art: { key: 'scripture_of_space', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'tnack_trav_prophesized_savior',
    name: 'Tnack Trav, Prophesized Savior',
    cost: { prophet: { threshold: 16, drain: 0 } },
    types: ['Action'],
    subtypes: ['Prophet', 'Warhero Token'],
    tags: [],
    rarity: 'legendary',
    keywords: ['PlayOnBuy', 'Flimsy'],
    stats: { buys: 1 },
    effects: [{ op: 'createCard', defId: 'warhero_token', to: 'gy' }],
    triggers: [],
    text: 'Play on Buy, Flimsy. Add a Warhero Token to your GY. +1 Buy.',
    flavor: 'He was late, but he came.',
    complexity: 'T2',
    subsystems: ['S-PROPHET', 'S-TOKEN'],
    shop: 'prophet',
    art: { key: 'tnack_trav_prophesized_savior', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'prophesized_jlore',
    name: 'Prophesized Jlore',
    cost: { prophet: { threshold: 30, drain: 30 } },
    types: ['Points'],
    subtypes: ['Prophet', 'Jlore'],
    tags: [],
    rarity: 'mythic',
    keywords: ['Unfathomable'],
    stats: { vp: 100 },
    effects: [],
    triggers: [
      // SB-8 keeps the rider as the failsafe for routes the Unfathomable pool
      // exclusion misses, but `buyCard` fires onBuy and then onGain on the same
      // copy — so an honest 30-drain purchase trashed itself before it could
      // ever score. onBuy runs first and stamps the instance; onGain trashes
      // only an unstamped copy, i.e. one that arrived by any other means.
      {
        on: 'onBuy',
        effects: [{ op: 'addCounter', target: { self: true }, key: 'counter', amount: 1 }],
      },
      {
        on: 'onGain',
        condition: { expr: 'selfCounter < 1' },
        effects: [{ op: 'trash', target: { self: true } }],
      },
    ],
    text: '+100 VP. Unfathomable. If obtained through any means other than purchase, TRASH THIS.',
    flavor: 'Thirty turns of faith, cashed in at once.',
    complexity: 'T3',
    subsystems: ['S-PROPHET', 'S-ENDGAME'],
    excludeFromPools: true,
    shop: 'prophet',
    art: { key: 'prophesized_jlore', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'summon' },
  },
  {
    id: 'the_unconcerned_lion',
    name: 'The Unconcerned Lion',
    cost: { prophet: { threshold: 0, drain: 1 } },
    types: ['Action'],
    subtypes: ['Prophet', 'Felinor'],
    tags: [],
    rarity: 'rare',
    keywords: [],
    stats: { cards: 3 },
    effects: [],
    triggers: [],
    text: 'You may go into Prophet debt to buy this. +3 Cards.',
    flavor: 'He does not check the balance.',
    complexity: 'T2',
    subsystems: ['S-PROPHET'],
    shop: 'prophet',
    art: { key: 'the_unconcerned_lion', status: 'final', artist: 'LCM Dreamshaper v7' },
  },

  // --- Token generated by Project: Doomsday --------------------------------
  {
    id: 'doomsday_button',
    name: 'Doomsday Button',
    // A.29 lists it at (0), and every other token states `{ money: 0 }`. An
    // absent `money` reads as "unbuyable for money", which is a different
    // thing from free and diverges from the rest of the token family.
    cost: { money: 0 },
    types: ['Action', 'Token'],
    subtypes: [],
    tags: ['PvP'],
    rarity: 'token',
    keywords: ['Flimsy'],
    stats: {},
    effects: [{ op: 'incDoomsday', amount: 1 }],
    triggers: [],
    text: 'Flimsy. Doomsday Counter +1; at 10 the game ends immediately.',
    flavor: 'Do not press. You will press it.',
    complexity: 'T2',
    subsystems: ['S-TOKEN', 'S-ENDGAME'],
    notPurchasable: true,
    art: { key: 'doomsday_button', status: 'final', artist: 'LCM Dreamshaper v7', anim: 'explode' },
  },
];

export default cards;
