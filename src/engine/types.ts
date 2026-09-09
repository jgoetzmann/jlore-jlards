/**
 * Jlore Jlards — frozen type surface.
 *
 * This file is the interface freeze for the whole build. It is written once,
 * owned by nobody, and imported read-only by every slice. Nothing in here has
 * an implementation; nothing in here imports anything.
 *
 * Rule: no other file may redeclare a name that appears here.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type PlayerId = string;
/** Stable id of a printed card, e.g. "temple_marketplace". */
export type CardDefId = string;
/** Stable id of one physical card in one match, e.g. "i_0417". */
export type InstanceId = string;
export type PileId = string;
export type AuraId = string;
export type AnomalyId = string;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type Zone =
  | 'library'
  | 'hand'
  | 'gy'
  | 'play'
  | 'field'
  | 'trash'
  | 'shop'
  | 'aside';

export type Rarity =
  | 'basic'
  | 'token'
  | 'common'
  | 'rare'
  | 'epic'
  | 'legendary'
  | 'mythic';

/** The five Buff/Nerf-reachable base stats, plus prophet. */
export type StatKey = 'money' | 'buys' | 'actions' | 'cards' | 'vp' | 'prophet';

/** The five stats Buff/Nerf may randomly pick. Prophet is deliberately absent. */
export const BUFFABLE_STATS: readonly StatKey[] = ['money', 'buys', 'actions', 'cards', 'vp'];

export type CardType = 'Action' | 'Resource' | 'Points' | 'Token' | 'Relic' | 'Book' | 'Food';

/** Orthogonal markers. Legacy is a set/rotation marker, not a rarity. */
export type CardTag = 'Legacy' | 'PvP' | 'EndOfGame' | 'Miracle' | 'Chaos' | 'Crafted';

export type Keyword =
  | 'Flimsy'
  | 'Temporary'
  | 'Indestructible'
  | 'Unfathomable'
  | 'PlayOnBuy'
  | 'PlayOnDraw';

export type Complexity = 'T1' | 'T2' | 'T3' | 'T4';

/** Dongfang Youxi Sheji five-element assignment. */
export type Element = 'water' | 'wood' | 'fire' | 'earth' | 'metal';

export type AuraTier = 'heroic' | 'celestial' | 'hypercelestial';

export type UniverseScope = 'knownUniverse' | 'entireUniverse';

// ---------------------------------------------------------------------------
// Card definition (immutable shipped content)
// ---------------------------------------------------------------------------

export interface Stats {
  money?: number;
  buys?: number;
  actions?: number;
  cards?: number;
  vp?: number;
  prophet?: number;
}

export interface ProphetCost {
  /** Prophet you must have banked to buy at all. */
  threshold: number;
  /** Prophet removed on purchase. */
  drain: number;
}

export interface Cost {
  /** Signed. Negative costs pay the buyer. Undefined means unbuyable for money. */
  money?: number;
  prophet?: ProphetCost;
}

/** Where a card's art lives and how finished it is. Drives the art pipeline. */
export interface ArtSlot {
  key: string;
  status: 'placeholder' | 'sketch' | 'final';
  artist?: string;
  /** Optional named animation preset played when the card resolves. */
  anim?: string;
}

export interface CardDefinition {
  id: CardDefId;
  name: string;
  cost: Cost;
  types: CardType[];
  /** Truss, Felinor, CN, Gold, Egg, Distilled, Scripture, Ricochet, ... */
  subtypes: string[];
  tags: CardTag[];
  rarity: Rarity;
  keywords: Keyword[];
  /** Plain stat line. Buff/Nerf reads and writes only this. */
  stats: Stats;
  /** Non-stat behaviour, resolved in order when the card is played. */
  effects: EffectNode[];
  triggers: Trigger[];
  /** Rules text template. `{tokens}` are resolved per viewer against instance state. */
  text: string;
  flavor?: string;
  complexity: Complexity;
  subsystems: string[];
  /** True for Tokens: generated only, never sits in a purchasable pile. */
  notPurchasable?: boolean;
  /** True for Unfathomable and similar: never appears in random/Discover pools. */
  excludeFromPools?: boolean;
  /** Which shop this card belongs to when it is purchasable. */
  shop?: 'resource' | 'points' | 'prophet' | 'draft';
  art?: ArtSlot;
  /** Actions this card costs to play. Default 1. Big Action N sets N. */
  bigAction?: number;
  /** Frozen word count for Hired Shrimp. Computed at authoring time, never at runtime. */
  wordCount?: number;
}

// ---------------------------------------------------------------------------
// Card variant (per-match overrides on a definition)
// ---------------------------------------------------------------------------

export interface CardVariant {
  defId: CardDefId;
  /** Universal Buff! / Universal Nerf! — applies to every copy, everywhere. */
  statDelta: Stats;
  /** Pile-scope cost change that outlives a single turn. */
  costDelta: number;
  element?: Element;
}

// ---------------------------------------------------------------------------
// Card instance (one physical card)
// ---------------------------------------------------------------------------

export interface CardInstance {
  iid: InstanceId;
  defId: CardDefId;
  /** null while the instance sits in a shop pile. */
  owner: PlayerId | null;
  zone: Zone;
  /** Set when zone === 'shop'. */
  pileId?: PileId;
  /** Keywords granted at runtime (Corrosion, Book of Blood, Stowaway, ...). */
  addedKeywords: Keyword[];
  /** Keywords stripped at runtime (Card Sleeve, Archivist, Goatman Family Genetics). */
  removedKeywords: Keyword[];
  /** Subtypes granted at runtime (RCT CN makes a card a CN card). */
  addedSubtypes?: string[];
  /** plague, playCount, upgrades, vp, trashSurvivals, ... */
  counters: Record<string, number>;
  /** Per-instance stat buffs (Quick Patch, Relics, Shining Kit). */
  statDelta: Stats;
  /** Effects permanently absorbed by Hivemind / Homebrew. */
  extraEffects: EffectNode[];
  /** Component definition ids when this instance is a fusion. */
  fusedFrom?: CardDefId[];
  /** Turn number this instance was last played on. Blocks same-turn reshuffle. */
  playedOnTurn: number | null;
  /** Values only the owner may see (Ascendant Spread's real VP). */
  secret?: Record<string, number>;
  /** Display text override that decouples shown text from real effect (Call to Chaos 12-15). */
  displayTextOverride?: string;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

/** A number, or an expression string evaluated against the current context. */
export type Amount = number | { expr: string };

/** Every variable the expression evaluator recognises. Frozen list. */
export const EXPR_VARS = [
  'deckSize',
  'uniqueCardsInDeck',
  'avgCostOfDeck',
  'sdOfDeckCost',
  'sumOfDeckCosts',
  'madOfOpponentDeck',
  'handSize',
  'currentTurn',
  'roundNumber',
  'playerCount',
  'buysRemaining',
  'actionsRemaining',
  'moneyUnspent',
  'comboCount',
  'cardsPlayedThisTurn',
  'cardsGainedThisTurn',
  'libraryHeight',
  'gyHeight',
  'prophet',
  'vp',
  'vpLead',
  'emptyOrLockedPiles',
  'emptyPiles',
  'lockedPiles',
  /** Constellation's X: the longest unbroken run of costs 1, 2, ... in your deck. */
  'longestCostRun',
  'buysUsedThisTurn',
  /** Deck size and Library height of the opponent with the most, for real leads. */
  'largestOpponentDeck',
  'tallestOpponentLibrary',
  /** VP sitting in your hand, printed plus accrued. A sum, not a card count. */
  'vpInHand',
  'cheapestInHand',
  /** The deepest single Relic upgrade in your deck — the highest, never the sum. */
  'maxRelicUpgrades',
  'avgDraftPileCost',
  'selfPlayCount',
  'selfCounter',
  'selfCost',
  'x',
] as const;
export type ExprVar = (typeof EXPR_VARS)[number];

/**
 * Functions the evaluator recognises:
 *   floor ceil round abs min max sqrt log
 *   count(<filterName>)   — count matching cards in your deck
 *   countIn(<zone>, <filterName>)
 * plus + - * / % and parentheses. No other syntax is legal.
 */

// ---------------------------------------------------------------------------
// Selectors and filters
// ---------------------------------------------------------------------------

export interface CardFilter {
  type?: CardType | CardType[];
  subtype?: string | string[];
  tag?: CardTag | CardTag[];
  rarity?: Rarity | Rarity[];
  keyword?: Keyword | Keyword[];
  name?: string;
  /** Case-insensitive: the name contains at least one of these substrings. */
  nameContainsAny?: string[];
  /**
   * The card's printed rules text is shorter than this many words. Hired Shrimp
   * is the only user; `CardDefinition.wordCount` is frozen at authoring time so
   * the count never depends on how the text renders (SB-30 / gameplay doc 10.4).
   */
  wordCountLt?: number;
  defId?: CardDefId | CardDefId[];
  cost?: NumericFilter;
  /** Cards NOT matching this nested filter. */
  not?: CardFilter;
  /** True if the card has any plague tokens. */
  plagued?: boolean;
  /**
   * Match on a per-instance counter. `aside` is one shared staging pile per
   * player, so a card that parks instances there across turns (a Hand Box) and
   * a card that stages them for the length of one effect need a way to tell
   * their own cards apart. Definition-level matching ignores this, exactly as
   * it ignores `plagued`: a definition has no counters.
   */
  counter?: { key: string; eq?: number; lt?: number; lte?: number; gt?: number; gte?: number };
  /** Match cards already present in this match (CNcias inverts it). */
  inMatch?: boolean;
}

/**
 * Bounds may be an expression, so a filter can read live state — "a card you
 * can currently afford" is `cost: { lte: { expr: 'moneyUnspent' } }`. A
 * selector resolves these against its context before matching; an unresolved
 * bound is ignored rather than failing closed.
 */
export interface NumericFilter {
  eq?: Amount;
  lt?: Amount;
  lte?: Amount;
  gt?: Amount;
  gte?: Amount;
}

/**
 * `self` is whoever the effect is resolving for, which inside a trigger is the
 * instance's owner — not necessarily the player taking the turn. `activePlayer`
 * is the seat actually playing, which is what "the current player" means on a
 * card like Recurring Felinor. `owner` is the source instance's owner, for a
 * trigger that has to pay the card's owner rather than the actor.
 */
export type Who =
  | 'self'
  | 'eachOpponent'
  | 'randomOpponent'
  | 'chosenOpponent'
  | 'eachPlayer'
  | 'activePlayer'
  | 'nextPlayer'
  | 'owner';

export interface Selector {
  who?: Who;
  zone?: Zone | Zone[];
  filter?: CardFilter;
  /**
   * How many to take. Omitted means all matches.
   *
   * This is a TOTAL across every player `who` reached, not a quota each. "Each
   * opponent discards 2" needs `perPlayer: true`, or two opponents lose two
   * cards between them.
   */
  count?: Amount;
  /** Apply `count` and `pick` once per resolved player rather than to the pool. */
  perPlayer?: boolean;
  /** How to pick when count < matches. */
  pick?: 'choose' | 'random' | 'top' | 'bottom' | 'mostExpensive' | 'cheapest' | 'lastPlayed';
  /** Who does the choosing when pick === 'choose'. */
  chooser?: 'self' | 'owner';
  /** Restrict to the instance that is resolving. */
  self?: boolean;
}

export interface PileSelector {
  shop?: 'draft' | 'resource' | 'points' | 'prophet' | 'all';
  filter?: CardFilter;
  count?: Amount;
  pick?: 'choose' | 'random' | 'tallest' | 'shortest' | 'mostExpensive' | 'cheapest';
  /** Never select the Jlore pile. */
  excludeJlore?: boolean;
}

export interface PoolSpec {
  scope?: UniverseScope | 'shop' | 'deck' | 'gy' | 'hand' | 'library' | 'opponentLibrary' | 'opponentHand' | 'opponentGy';
  who?: Who;
  filter?: CardFilter;
  /** Named sub-catalog: 'miracle' | 'chaos' | 'book' | 'egg' | 'food' | 'grape' | 'relic' | 'heroicAura' | 'celestialAura' | 'scripture'. */
  catalog?: string;
  /** Apply rarity pull weights (§7.1) when sampling. Default true for universe scopes. */
  weighted?: boolean;
}

export type Duration =
  | 'turn'
  | 'untilYourNextTurn'
  | 'untilEndOfYourNextTurn'
  | 'permanent'
  | { turns: number }
  | { untilDiscarded: number };

// ---------------------------------------------------------------------------
// Effect DSL
// ---------------------------------------------------------------------------

export type EffectNode =
  // --- stats and cards ---
  | { op: 'gain'; stat: StatKey; amount: Amount; who?: Who }
  | { op: 'draw'; amount: Amount; who?: Who }
  | { op: 'mill'; amount: Amount; who?: Who }
  | { op: 'discard'; target: Selector }
  | { op: 'discardDownTo'; amount: Amount; who?: Who }
  | { op: 'trash'; target: Selector }
  // --- movement and creation ---
  /**
   * `who` is the DESTINATION owner — the player the card ends up belonging to.
   * Omitted, a card keeps its current owner, which is what you want for moving
   * a card between your own zones. A steal has to name `who: 'self'`, or the
   * card lands back in the zone of the player you took it from.
   */
  | { op: 'moveTo'; target: Selector; zone: Zone; who?: Who; position?: 'top' | 'bottom' | 'random' | { index: number } }
  | { op: 'createCard'; defId: CardDefId | { pool: PoolSpec }; to: Zone; who?: Who; count?: Amount; position?: 'top' | 'bottom' | 'random'; keywords?: Keyword[]; counters?: Record<string, number>; statDelta?: Stats }
  | { op: 'gainCard'; from: PileSelector | { pool: PoolSpec }; to: Zone; who?: Who; count?: Amount; free?: boolean }
  | { op: 'copyCard'; target: Selector; to: Zone; who?: Who; keywords?: Keyword[] }
  | { op: 'transform'; target: Selector; into: CardDefId | { pool: PoolSpec } | { costDelta: number } | 'upgrade' | 'downgrade' }
  | { op: 'recruit'; zone?: Zone; filter?: CardFilter; count?: Amount; who?: Who; to?: Zone }
  /**
   * Merge two or more cards into one composite (§3.1 "Fused"). The components
   * are consumed and the result lands in `to` (default: where the first
   * component already was, so Matchmaker can fuse cards inside a Library).
   * A component with an `onFuse` trigger gets to react first — that is Chopped
   * Chuzz's "when this attempts to Fuse, trash it instead" — and anything that
   * leaves play during that window is dropped from the merge.
   */
  | { op: 'fuse'; target: Selector; to?: Zone }
  | { op: 'shuffle'; zone?: Zone; who?: Who }
  | { op: 'sortLibraryByCost'; who?: Who }
  | { op: 'reveal'; target: Selector }
  // --- choices ---
  | { op: 'discover'; pool: PoolSpec; count?: number; pick?: number; then: EffectNode[]; prompt?: string; displayAs?: string }
  | { op: 'choose'; options: { label: string; effects: EffectNode[] }[]; who?: Who }
  | { op: 'selectCards'; from: Selector; min?: Amount; max?: Amount; then: EffectNode[] }
  // --- shop ---
  | { op: 'lockPile'; target: PileSelector; duration: Duration }
  | { op: 'unlockPile'; target: PileSelector }
  | { op: 'modifyCost'; scope: 'draftShop' | 'resourceShop' | 'pointsShop' | 'prophetShop' | 'allShops' | 'pile' | 'nextBuy' | 'nextBuyOpponent'; target?: PileSelector; delta?: Amount; setTo?: Amount; floor?: number; duration: Duration }
  | { op: 'replenishPile'; target: PileSelector }
  | { op: 'trashPile'; target: PileSelector }
  | { op: 'swapPileCosts'; target: PileSelector }
  | { op: 'addToPileTop'; target: PileSelector; defId: CardDefId | { pool: PoolSpec }; count?: Amount; costOverride?: number }
  | { op: 'mergePiles'; target: PileSelector }
  // --- auras ---
  | { op: 'manifestAura'; tier: AuraTier; auraId?: AuraId; discover?: boolean; who?: Who; bindTo?: 'nextPlayed' }
  | { op: 'activateAura' }
  // --- buff / upgrade ---
  | { op: 'buff'; scope: 'instance' | 'allCopies' | 'pile' | 'nextPlayed' | 'self'; target?: Selector | PileSelector; stat?: StatKey; amount?: Amount; times?: Amount }
  | { op: 'nerf'; scope: 'instance' | 'allCopies' | 'pile' | 'nextPlayed' | 'self'; target?: Selector | PileSelector; stat?: StatKey; amount?: Amount; times?: Amount }
  | { op: 'upgradeRelic'; target?: Selector; stat?: StatKey | 'random' | 'all'; amount?: Amount }
  // --- timing ---
  | { op: 'delayed'; when: 'startOfNextTurn' | 'endOfTurn' | 'endOfNextTurn' | 'startOfTurn' | { inTurns: number } | { atTurn: number } | 'gameEnd'; effects: EffectNode[]; who?: Who }
  | { op: 'nextCardModifier'; mod: NextCardMod }
  | { op: 'endTurn'; who?: Who }
  | { op: 'extraTurn'; who?: Who }
  // --- control flow ---
  | { op: 'conditional'; if: Condition; then: EffectNode[]; else?: EffectNode[] }
  | { op: 'repeat'; times: Amount; effects: EffectNode[] }
  | { op: 'forEach'; over: Selector; effects: EffectNode[] }
  | { op: 'random'; branches: { weight: number; effects: EffectNode[]; displayAs?: string }[] }
  | { op: 'sequence'; effects: EffectNode[] }
  // --- replay and multipliers ---
  | { op: 'playCard'; target: Selector; randomTargets?: boolean; thenTrash?: boolean }
  | { op: 'replayPlayedThisTurn'; filter?: CardFilter; thenTrash?: boolean }
  | { op: 'multiplyNext'; factor: number; stats?: StatKey[]; count?: number }
  // --- counters and misc ---
  | { op: 'plague'; target: Selector | PileSelector; amount: Amount }
  | { op: 'removePlague'; target: Selector | PileSelector }
  /**
   * `scope:'player'` writes to `PlayerState.counters` instead of to an
   * instance — a mark that belongs to the seat, not to a card. A key prefixed
   * `turn:` is cleared at the start of that player's turn.
   */
  | { op: 'addCounter'; target?: Selector; key: string; amount: Amount; scope?: 'instance' | 'player'; who?: Who }
  | { op: 'scoreOnCard'; target: Selector; amount: Amount; secret?: boolean }
  | { op: 'setKeyword'; target: Selector; keyword: Keyword; on: boolean }
  | { op: 'resetCombo' }
  | { op: 'endGame'; reason?: string }
  | { op: 'incDoomsday'; amount: Amount }
  | { op: 'questProgress'; key: string; amount: Amount }
  | { op: 'noop' };

export interface NextCardMod {
  /** Bought card goes here instead of GY (Express Shipping). */
  buyTo?: Zone;
  /** Cost reduction on the next purchase. */
  costDelta?: number;
  costFloor?: number;
  /** Grant a keyword to the next card played. */
  grantKeyword?: Keyword;
  /** Grant a subtype — RCT CN makes the next card played a CN card. */
  grantSubtype?: string;
  /** Which stat `buffTimes`/`nerfTimes` moves. Omitted means a random one. */
  buffStat?: StatKey;
  /** Effects appended to the next card played. */
  appendEffects?: EffectNode[];
  /** Buff the next card played N times. */
  buffTimes?: number;
  nerfTimes?: number;
  /** Multiply the next card's output. */
  multiply?: number;
  multiplyStats?: StatKey[];
  /** Absorb the next played card's effects into the source instance (Hivemind). */
  absorbInto?: InstanceId;
  /** Bind the next played card to an aura (Infini Scepter) or pointer (Pointer). */
  bind?: 'oathboundMemory' | 'pointer' | 'rightHandMan';
  /** Applies to buys rather than plays. */
  appliesTo?: 'play' | 'buy' | 'action';
  /** Whose next card. */
  who?: Who;
  /** How many upcoming cards this applies to. Default 1. */
  uses?: number;
}

export interface Condition {
  expr?: string;
  /** Combo N: this is at least the Nth card played this turn. */
  combo?: number;
  /** True when the given selector matches at least `atLeast` cards. */
  has?: { target: Selector; atLeast?: number };
  /** Fires only if the previous op in the sequence did something. */
  ifPrevious?: boolean;
  not?: Condition;
  all?: Condition[];
  any?: Condition[];
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export type TriggerEvent =
  | 'onPlay'
  | 'onBuy'
  | 'onGain'
  | 'onDraw'
  | 'onDiscard'
  | 'onTrash'
  | 'onShuffle'
  | 'onLock'
  | 'onUnlock'
  | 'onBuff'
  | 'onPileEmpty'
  | 'startOfTurn'
  | 'endOfTurn'
  | 'onOpponentBuy'
  | 'onOpponentPlay'
  | 'onPlagueAdded'
  /** Fires on each component as a fusion is attempted, before it is merged. */
  | 'onFuse'
  | 'gameEnd';

export interface Trigger {
  on: TriggerEvent;
  /** Fires only while the instance is in one of these zones. Default: any. */
  zones?: Zone[];
  condition?: Condition;
  effects: EffectNode[];
  /** Fire at most N times per turn. */
  maxPerTurn?: number;
}

// ---------------------------------------------------------------------------
// Auras
// ---------------------------------------------------------------------------

export interface AuraDefinition {
  id: AuraId;
  name: string;
  tier: AuraTier;
  text: string;
  /** Heroic auras cost 2 money to activate, once per turn. */
  activationCost?: number;
  effects: EffectNode[];
  triggers: Trigger[];
  art?: ArtSlot;
}

export interface AuraInstance {
  auraId: AuraId;
  owner: PlayerId;
  usedThisTurn: boolean;
  counters: Record<string, number>;
  /** Oathbound Memory: [Card] */
  boundDefId?: CardDefId;
  /** Turns remaining for timed auras (Outstanding Debt). */
  turnsRemaining?: number;
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

export interface Pile {
  id: PileId;
  shop: 'resource' | 'points' | 'prophet' | 'draft';
  /** Ordered stack, top first. The top card matters. */
  cards: InstanceId[];
  /** Cost override for this pile, applied after variant deltas. */
  costOverride?: number;
  locks: PileLock[];
  /** Per-pile cost modifiers with durations. */
  costMods: CostMod[];
  /** Number of cards the pile started with, for replenish. */
  startingSize: number;
}

export interface PileLock {
  by: PlayerId;
  duration: Duration;
  /** Turn index the lock expires on. */
  expiresOnTurn: number | null;
  /** Archwarden: unlock once this much discarded cost accrues. */
  unlockOnDiscardedCost?: number;
  accruedDiscardCost?: number;
}

export interface CostMod {
  id: string;
  delta?: number;
  setTo?: number;
  floor: number;
  expiresOnTurn: number | null;
  source: string;
  /** Applies only to purchases by this player. Undefined means everyone. */
  onlyFor?: PlayerId;
}

export interface ShopState {
  piles: Record<PileId, Pile>;
  /** Ordered pile ids per shop, for stable UI layout. */
  order: { resource: PileId[]; points: PileId[]; prophet: PileId[]; draft: PileId[] };
  /** Global cost modifiers not attached to one pile. */
  globalCostMods: CostMod[];
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export interface PlayerState {
  id: PlayerId;
  name: string;
  library: InstanceId[];
  hand: InstanceId[];
  gy: InstanceId[];
  play: InstanceId[];
  field: AuraInstance[];
  money: number;
  buys: number;
  actions: number;
  prophet: number;
  /** Running VP total. End of Game cards are excluded from this. */
  vp: number;
  /** Card ids this account has ever seen. Feeds Known Universe pools. */
  codex: CardDefId[];
  /** Cards played this turn, in order, as instance ids. */
  playedThisTurn: InstanceId[];
  cardsGainedThisTurn: number;
  buysUsedThisTurn: number;
  /** Combo counter. Reset each turn and by Crime Wave. */
  combo: number;
  /** Pending "next turn" and "in N turns" effects. */
  delayed: DelayedEffect[];
  /** Modifiers waiting for the next card played or bought. */
  nextCardMods: NextCardMod[];
  /** Per-turn stat carryover set by anomalies and auras. */
  turnModifiers: Stats;
  /** Money carried over by Smart Savings. */
  carryMoney: number;
  eliminated: boolean;
  /** Quest progress keyed by counter name. */
  quest: QuestState | null;
  /** Per-game play counts keyed by defId, for Lection / Journey / Wish. */
  playCounts: Record<CardDefId, number>;
  /** Cumulative per-game counters (astrologistsTrashed, ricochetUsedThisTurn, ...). */
  counters: Record<string, number>;
  /** Element last played, for Dongfang Youxi Sheji. */
  lastElement: Element | null;
  /** Extra turns owed to this player. */
  extraTurns: number;
}

export interface DelayedEffect {
  id: string;
  fireOnTurn: number;
  when: 'startOfTurn' | 'endOfTurn' | 'gameEnd';
  effects: EffectNode[];
  sourceIid?: InstanceId;
}

export interface QuestState {
  floor: string;
  progress: Record<string, number>;
  completedFloors: string[];
}

// ---------------------------------------------------------------------------
// Prompts (choices are state, never callbacks)
// ---------------------------------------------------------------------------

export interface PromptOption {
  /** Identifier the client sends back. */
  key: string;
  /** What the player sees. May deliberately differ from the real effect. */
  label: string;
  /** Present only when the option is a concrete card. */
  defId?: CardDefId;
  iid?: InstanceId;
  pileId?: PileId;
}

export interface Prompt {
  id: string;
  type: 'discover' | 'choose' | 'selectCards' | 'selectPile' | 'selectPlayer' | 'order' | 'auction' | 'confirm';
  player: PlayerId;
  prompt: string;
  options: PromptOption[];
  min: number;
  max: number;
  /** Effects to run once the choice comes back. */
  then: EffectNode[];
  /** Opaque continuation payload the interpreter needs to resume. */
  ctx: Record<string, unknown>;
  /** What to auto-pick if the player times out. */
  defaultKeys: string[];
}

// ---------------------------------------------------------------------------
// Match configuration
// ---------------------------------------------------------------------------

export type WinConditionKind = 'standard' | 'countdown' | 'duel' | 'crown';

export interface WinConditionConfig {
  kind: WinConditionKind;
  /** Fraction of draft piles that must empty. Default 0.40. */
  emptyPileFraction: number;
  /** Absolute pile count override. Default 4. Whichever triggers first. */
  emptyPileAbsolute: number | null;
  /** Countdown: total turns. Duel: VP lead. Crown: VP target. */
  x: number | null;
}

export interface MatchConfig {
  playerCount: number;
  draftPileCount: number;
  /** Chance an anomaly rolls at match start. */
  anomalyChance: number;
  winCondition: WinConditionConfig;
  /** Multiplies every pile's starting size (Accelerated / Prolonged). */
  pileSizeScale: number;
  /** Hard cap on effect nodes resolved in one turn before fizzling. */
  effectNodeBudget: number;
  /** Max nesting depth for play-triggers-play recursion. */
  recursionDepth: number;
  /** Seconds per turn. Time Flail divides this. */
  turnSeconds: number;
  /** When true, cards the players have never seen still appear in Known Universe pools. */
  seedCodexWithCommons: boolean;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export interface LogEntry {
  seq: number;
  turn: number;
  player: PlayerId | null;
  kind: string;
  detail: Record<string, unknown>;
}

export interface GameState {
  seed: number;
  /** Advances every time the engine consumes randomness. Makes reduce pure. */
  rngCursor: number;
  /** Increments once per player turn, starting at 1. */
  turn: number;
  /** Increments once per full pass around the table. */
  round: number;
  activePlayer: PlayerId;
  playerOrder: PlayerId[];
  players: Record<PlayerId, PlayerState>;
  instances: Record<InstanceId, CardInstance>;
  nextInstanceSeq: number;
  shop: ShopState;
  variants: Record<CardDefId, CardVariant>;
  anomaly: AnomalyId | null;
  config: MatchConfig;
  pending: Prompt | null;
  /** Suspended effect nodes waiting on `pending`. FIFO. */
  queue: QueuedEffect[];
  /** Nodes resolved this turn, against config.effectNodeBudget. */
  nodesResolvedThisTurn: number;
  log: LogEntry[];
  logSeq: number;
  ended: boolean;
  endTriggeredBy: PlayerId | null;
  endReason: string | null;
  winners: PlayerId[] | null;
  doomsdayCounter: number;
  /** Turn index the game ends on, when a card or anomaly set one. */
  hardEndTurn: number | null;
  /** Ids of definitions present in this match, for CNcias-style queries. */
  defsInMatch: CardDefId[];
}

export interface QueuedEffect {
  node: EffectNode;
  player: PlayerId;
  sourceIid: InstanceId | null;
  /** Nesting depth, against config.recursionDepth. */
  depth: number;
  /** Multiplier applied to stat gains inside this node. */
  multiplier: number;
  /** Loop variable for forEach / repeat and Big Action X style values. */
  vars: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type GameAction =
  | { type: 'start'; config: MatchConfig; players: { id: PlayerId; name: string; codex: CardDefId[] }[]; seed: number; anomaly?: AnomalyId | null }
  | { type: 'play'; player: PlayerId; iid: InstanceId }
  | { type: 'buy'; player: PlayerId; pileId: PileId }
  | { type: 'activateAura'; player: PlayerId; auraId: AuraId }
  | { type: 'reorderHand'; player: PlayerId; hand: InstanceId[] }
  | { type: 'endTurn'; player: PlayerId }
  | { type: 'resolve'; player: PlayerId; promptId: string; keys: string[] }
  | { type: 'concede'; player: PlayerId };

// ---------------------------------------------------------------------------
// Views (what a client is allowed to know)
// ---------------------------------------------------------------------------

export interface CardView {
  iid: InstanceId;
  defId: CardDefId;
  name: string;
  cost: number | null;
  prophetCost: ProphetCost | null;
  types: CardType[];
  subtypes: string[];
  rarity: Rarity;
  keywords: Keyword[];
  stats: Stats;
  /** Already rendered against instance state for this viewer. */
  text: string;
  counters: Record<string, number>;
  art?: ArtSlot;
  playable?: boolean;
  affordable?: boolean;
}

export interface PileView {
  id: PileId;
  shop: 'resource' | 'points' | 'prophet' | 'draft';
  top: CardView | null;
  count: number;
  cost: number | null;
  prophetCost: ProphetCost | null;
  locked: boolean;
  lockedUntil: number | null;
}

export interface SelfView {
  id: PlayerId;
  name: string;
  hand: CardView[];
  play: CardView[];
  gy: CardView[];
  field: { auraId: AuraId; name: string; tier: AuraTier; text: string; usedThisTurn: boolean }[];
  libraryCount: number;
  money: number;
  buys: number;
  actions: number;
  prophet: number;
  vp: number;
  combo: number;
  delayedCount: number;
  quest: QuestState | null;
}

export interface OpponentView {
  id: PlayerId;
  name: string;
  handCount: number;
  libraryCount: number;
  gy: CardView[];
  play: CardView[];
  field: { auraId: AuraId; name: string; tier: AuraTier; text: string }[];
  vp: number;
  prophet: number;
  eliminated: boolean;
}

export interface GameView {
  you: SelfView;
  others: OpponentView[];
  shop: { resource: PileView[]; points: PileView[]; prophet: PileView[]; draft: PileView[] };
  turn: number;
  round: number;
  activePlayer: PlayerId;
  anomaly: { id: AnomalyId; name: string; text: string } | null;
  /** Full prompt when it is yours, otherwise only who is being waited on. */
  pending: Prompt | { waitingOn: PlayerId } | null;
  ended: boolean;
  winners: PlayerId[] | null;
  endReason: string | null;
  log: LogEntry[];
  doomsdayCounter: number;
  hardEndTurn: number | null;
}

// ---------------------------------------------------------------------------
// Relay envelope
// ---------------------------------------------------------------------------

export type MessageKind = 'intent' | 'view' | 'hello' | 'snapshot';

export interface RelayMessage {
  seq: number;
  from: string;
  to?: string;
  kind: MessageKind;
  payload: unknown;
}
