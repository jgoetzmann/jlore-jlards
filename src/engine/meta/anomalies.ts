/**
 * S-ANOMALY — every anomaly from gameplay §8.3, as data plus its setup patch.
 *
 * B81  `rollAnomaly` returns null with probability `1 - chance`, otherwise one
 *      id, reproducibly for a given seed and cursor.
 * B82  Exactly one anomaly per match; the mutex groups (`startingDeck`,
 *      `endCondition`, `startingAura`, `stat`, `shop`) are never combined
 *      (SB-11).
 * B83  Miniature Deck / Economic Hedge / Xushi's Game replace the starting deck.
 * B84  Accelerated and Prolonged scale every pile by 0.6 / 1.4.
 * B85  Stat anomalies write `player.turnModifiers`, applied at every turn reset.
 * B86  Death's Door ends at the end of turn `10 × playerCount`.
 * B87  Heavy is the Crown = 10 VP lead; Aim for the Moon = 20 VP.
 * B88  Battle Royale needs 3+ players and eliminates the lowest VP every 15.
 * B90  Starting-aura anomalies manifest their named Celestial for every player.
 * SB-36 Time Flail is a turn-timer modifier only, never a rules change.
 * SB-28/SB-29 VP-threshold matches drop Prophesized Jlore and Mercenary 280.
 */

import type {
  AnomalyId,
  AuraId,
  CardDefId,
  CardVariant,
  Element,
  GameState,
  InstanceId,
  PlayerId,
  Stats,
} from '@engine/types';
import type { Rng } from '@engine/rng';
import { allCards, allAuras, getCard } from '@engine/registry';
import { costOf, rarityPullWeight } from '@engine/shop';
import { drawCards } from '@engine/core/zones';
import { cloneState } from '@engine/core/clone.js';
import { makeInstance, pushLog, withPlayer, livePlayers } from './util.js';
import { entireUniverse, stripExcludedFromShop, noteSeenAll } from './codex.js';
import { manifestAura } from './auras.js';
import { applyMeowText, MEOW_ANOMALY_ID } from './meow.js';
import { liveVp } from './scoring.js';

export type AnomalyGroup =
  | 'stat'
  | 'startingDeck'
  | 'shop'
  | 'endCondition'
  | 'startingAura'
  | 'other';

export interface AnomalyDef {
  id: AnomalyId;
  name: string;
  text: string;
  group: AnomalyGroup;
  /** Minimum seats this anomaly is legal at. */
  minPlayers: number;
}

// ---------------------------------------------------------------------------
// The catalog (gameplay doc §8.3)
// ---------------------------------------------------------------------------

export const anomalies: AnomalyDef[] = [
  // --- stat modifiers ---
  { id: 'extra_buy', name: 'Extra Buy!', text: '+1 Buy per turn.', group: 'stat', minPlayers: 1 },
  { id: 'extra_gold', name: 'Extra Gold!', text: '+1 Money per turn.', group: 'stat', minPlayers: 1 },
  { id: 'extra_action', name: 'Extra Action!', text: '+1 Action per turn.', group: 'stat', minPlayers: 1 },
  { id: 'extra_cards', name: 'Extra Cards!', text: '+1 Card per turn.', group: 'stat', minPlayers: 1 },
  { id: 'less_cards', name: 'Less Cards!', text: '-1 Card per turn.', group: 'stat', minPlayers: 1 },
  { id: 'less_money', name: 'Less Money!', text: '-1 Money per turn.', group: 'stat', minPlayers: 1 },

  // --- starting deck (mutex) ---
  { id: 'miniature_deck', name: 'Miniature Deck', text: 'Start with 5 cards: 4 Copper, 1 Tix.', group: 'startingDeck', minPlayers: 1 },
  { id: 'economic_hedge', name: 'Economic Hedge', text: 'Start with 3 Copper, 3 Silver, 1 Gold, 3 Robux.', group: 'startingDeck', minPlayers: 1 },
  { id: 'xushis_game', name: "Xushi's Game", text: 'Every player starts with the same 10 random cards.', group: 'startingDeck', minPlayers: 1 },

  // --- shop and pacing ---
  { id: 'accelerated_game', name: 'Accelerated Game', text: 'Shop piles 40% smaller.', group: 'shop', minPlayers: 1 },
  { id: 'prolonged_game', name: 'Prolonged Game', text: 'Shop piles 40% larger.', group: 'shop', minPlayers: 1 },
  { id: 'cash_injection', name: 'Cash Injection', text: 'At the start of turn 5, all Copper becomes Gold.', group: 'shop', minPlayers: 1 },
  { id: 'time_flail', name: 'Time Flail', text: 'Turns are 2.5x as fast.', group: 'shop', minPlayers: 1 },
  { id: 'dynamic_pricing', name: 'Dynamic Pricing', text: 'Shop costs doubled; -1 to all shop costs each end of turn (min 0); a bought card costs (3) more.', group: 'shop', minPlayers: 1 },
  { id: 'fading_blossom', name: 'Fading Blossom', text: 'All cards gain Flimsy. Shop prices halved. +5 Buys per turn.', group: 'shop', minPlayers: 1 },

  // --- end condition (mutex) ---
  { id: 'deaths_door', name: "Death's Door", text: 'The game ends at the end of turn 10 x playerCount.', group: 'endCondition', minPlayers: 1 },
  { id: 'heavy_is_the_crown', name: 'Heavy is the Crown', text: 'The game ends when a player leads by 10 VP.', group: 'endCondition', minPlayers: 1 },
  { id: 'aim_for_the_moon', name: 'Aim for the Moon', text: 'The game ends when a player reaches 20 VP.', group: 'endCondition', minPlayers: 1 },
  { id: 'battle_royale', name: 'Battle Royale', text: 'Every 15 turns the lowest-VP player is eliminated. Last standing wins.', group: 'endCondition', minPlayers: 3 },

  // --- starting aura (mutex) ---
  { id: 'double_header', name: 'Double Header', text: 'Every player gains the Celestial Double Header.', group: 'startingAura', minPlayers: 1 },
  { id: 'sasalele', name: 'Sasalele', text: 'Every player gains the Celestial The Invisible Hand.', group: 'startingAura', minPlayers: 1 },
  { id: 'adrenaline', name: 'Adrenaline', text: "Every player gains the Celestial Kwzki's Stimulants.", group: 'startingAura', minPlayers: 1 },
  { id: 'rule_of_thirds', name: 'Rule of Thirds', text: 'Every player gains the Celestial Symphony of 3.', group: 'startingAura', minPlayers: 1 },
  { id: 'onward_to_victory', name: 'Onward to Victory!', text: 'Every player gains the Celestial March of Progress.', group: 'startingAura', minPlayers: 1 },

  // --- other ---
  { id: 'audience_choice', name: 'Audience Choice', text: 'On each player first turn, an Entire-Universe card enters their GY.', group: 'other', minPlayers: 1 },
  { id: 'sliced_mangos', name: 'Sliced Mangos', text: 'On each player first turn, they gain a Heroic Aura.', group: 'other', minPlayers: 1 },
  { id: 'meow_meow_meow', name: 'MEOW MEOW MEOW', text: 'All words become meow. Functionally identical.', group: 'other', minPlayers: 1 },
  { id: 'dongfang_youxi_sheji', name: 'Dongfang Youxi Sheji', text: 'Every card is assigned one of the five elements.', group: 'other', minPlayers: 1 },
];

const BY_ID: Record<AnomalyId, AnomalyDef> = (() => {
  const out: Record<AnomalyId, AnomalyDef> = {};
  for (const a of anomalies) out[a.id] = a;
  return out;
})();

export function getAnomaly(id: AnomalyId): AnomalyDef | null {
  return BY_ID[id] ?? null;
}

export function anomalyIds(): AnomalyId[] {
  return anomalies.map((a) => a.id);
}

export function anomaliesInGroup(group: AnomalyGroup): AnomalyDef[] {
  return anomalies.filter((a) => a.group === group);
}

/**
 * B82 / SB-11 — two anomalies may never be combined when they share a mutex
 * group. Kept as a predicate so a later "Chaotic" roll can reuse it.
 */
export const MUTEX_GROUPS: readonly AnomalyGroup[] = [
  'startingDeck',
  'endCondition',
  'startingAura',
  'stat',
  'shop',
];

export function canCombine(a: AnomalyId, b: AnomalyId): boolean {
  if (a === b) return false;
  const da = getAnomaly(a);
  const db = getAnomaly(b);
  if (!da || !db) return false;
  if (da.group !== db.group) return true;
  return !MUTEX_GROUPS.includes(da.group);
}

/** Anomalies the blind roller may return — see `rollAnomaly`. */
export function rollableAnomalyIds(): AnomalyId[] {
  return anomalies.filter((a) => a.minPlayers <= 1).map((a) => a.id);
}

/**
 * B81 — one roll, one anomaly, or null. `chance` is the probability an anomaly
 * rolls at all (§8.1's interim 30%).
 *
 * The signature carries no seat count, so the roll is restricted to anomalies
 * that are legal at every table size. Battle Royale needs 3+ seats (B88) and
 * therefore has to be asked for by name through `createMatch`'s `anomaly`
 * argument; rolling it blind would produce a match whose anomaly is silently
 * swapped out at 2 seats.
 */
export function rollAnomaly(rng: Rng, chance: number): AnomalyId | null {
  const roll = rng.next();
  if (roll >= chance) return null;
  const ids = rollableAnomalyIds();
  if (ids.length === 0) return null;
  return rng.pick(ids);
}

// ---------------------------------------------------------------------------
// Setup patches
// ---------------------------------------------------------------------------

const STAT_MODIFIERS: Record<AnomalyId, Stats> = {
  extra_buy: { buys: 1 },
  extra_gold: { money: 1 },
  extra_action: { actions: 1 },
  extra_cards: { cards: 1 },
  less_cards: { cards: -1 },
  less_money: { money: -1 },
};

const STARTING_AURAS: Record<AnomalyId, AuraId> = {
  double_header: 'double_header',
  sasalele: 'the_invisible_hand',
  adrenaline: 'kwzkis_stimulants',
  rule_of_thirds: 'symphony_of_3',
  onward_to_victory: 'march_of_progress',
};

const MINIATURE_DECK: CardDefId[] = ['copper', 'copper', 'copper', 'copper', 'tix'];
const ECONOMIC_HEDGE: CardDefId[] = [
  'copper', 'copper', 'copper',
  'silver', 'silver', 'silver',
  'gold',
  'robux', 'robux', 'robux',
];

const ELEMENTS: readonly Element[] = ['water', 'wood', 'fire', 'earth', 'metal'];

const OPENING_HAND = 5;

/** Drop every instance a player owns and rebuild their deck from defIds. */
function replaceDeck(
  state: GameState,
  player: PlayerId,
  defIds: CardDefId[],
  rng: Rng,
): GameState {
  let next = cloneState(state);
  const p = next.players[player];
  if (!p) return state;

  // Setup deals the opening hand after the anomaly patch, so at match start
  // there is nothing in hand yet and nothing to redeal. When this runs against
  // an already-dealt match, give the player back the hand size they held.
  const handSize = p.hand.length;

  for (const iid of [...p.library, ...p.hand, ...p.gy, ...p.play]) {
    delete next.instances[iid];
  }
  p.library = [];
  p.hand = [];
  p.gy = [];
  p.play = [];

  const made: InstanceId[] = [];
  for (const defId of defIds) {
    const res = makeInstance(next, defId, player, 'library');
    next = res.state;
    made.push(res.iid);
  }
  // makeInstance returns fresh top-level objects; re-point the player array.
  next = withPlayer(next, player, (q) => ({ ...q, library: rng.shuffle(made) }));
  // `drawCards` returns the ids it drew and moves them on the state in place.
  if (handSize > 0) drawCards(next, player, Math.min(handSize, made.length));
  return pushLog(next, 'startingDeckReplaced', { defIds }, player);
}

/** Rarity-weighted pull of `count` ids out of the Entire Universe. */
export function randomUniverseCards(rng: Rng, count: number): CardDefId[] {
  const pool = entireUniverse()
    .map((id) => {
      let weight = 0;
      try {
        const def = getCard(id);
        if (def.notPurchasable) return null;
        weight = rarityPullWeight(def.rarity);
      } catch {
        return null;
      }
      return weight > 0 ? { item: id, weight } : null;
    })
    .filter((e): e is { item: CardDefId; weight: number } => e !== null);
  if (pool.length === 0) return [];
  const out: CardDefId[] = [];
  for (let i = 0; i < count; i += 1) out.push(rng.weighted(pool));
  return out;
}

function scalePiles(state: GameState, scale: number): GameState {
  const next = cloneState(state);
  next.config.pileSizeScale = scale;
  for (const pileId of Object.keys(next.shop.piles)) {
    const pile = next.shop.piles[pileId];
    const target = Math.max(1, Math.round(pile.startingSize * scale));
    if (target < pile.cards.length) {
      for (const iid of pile.cards.slice(target)) delete next.instances[iid];
      pile.cards = pile.cards.slice(0, target);
    }
    pile.startingSize = target;
  }
  return next;
}

function scaleShopCosts(state: GameState, factor: number, round: 'up' | 'down'): GameState {
  const next = cloneState(state);
  const buyer = next.playerOrder[0];
  for (const pileId of Object.keys(next.shop.piles)) {
    const pile = next.shop.piles[pileId];
    let base: number;
    try {
      base = costOf(next, pileId, buyer);
    } catch {
      base = pile.costOverride ?? 0;
    }
    const scaled = base * factor;
    pile.costOverride = Math.max(0, round === 'up' ? Math.ceil(scaled) : Math.floor(scaled));
  }
  return next;
}

function grantFlimsyToAll(state: GameState): GameState {
  const next = cloneState(state);
  for (const iid of Object.keys(next.instances)) {
    const inst = next.instances[iid];
    if (!inst.addedKeywords.includes('Flimsy')) inst.addedKeywords.push('Flimsy');
  }
  return next;
}

/** Fading Blossom keeps applying to cards created after setup. */
export function fadingBlossomKeyword(state: GameState, iid: InstanceId): GameState {
  if (state.anomaly !== 'fading_blossom') return state;
  const inst = state.instances[iid];
  if (!inst || inst.addedKeywords.includes('Flimsy')) return state;
  return {
    ...state,
    instances: {
      ...state.instances,
      [iid]: { ...inst, addedKeywords: [...inst.addedKeywords, 'Flimsy'] },
    },
  };
}

function assignElements(state: GameState, rng: Rng): GameState {
  const next = cloneState(state);
  for (const def of allCards()) {
    const existing: CardVariant | undefined = next.variants[def.id];
    const element = rng.pick(ELEMENTS);
    next.variants[def.id] = existing
      ? { ...existing, element }
      : { defId: def.id, statDelta: {}, costDelta: 0, element };
  }
  return pushLog(next, 'elementsAssigned', { count: Object.keys(next.variants).length });
}

function setTurnModifiers(state: GameState, delta: Stats): GameState {
  let next = state;
  for (const pid of next.playerOrder) {
    next = withPlayer(next, pid, (p) => ({
      ...p,
      turnModifiers: {
        money: (p.turnModifiers.money ?? 0) + (delta.money ?? 0),
        buys: (p.turnModifiers.buys ?? 0) + (delta.buys ?? 0),
        actions: (p.turnModifiers.actions ?? 0) + (delta.actions ?? 0),
        cards: (p.turnModifiers.cards ?? 0) + (delta.cards ?? 0),
        vp: (p.turnModifiers.vp ?? 0) + (delta.vp ?? 0),
        prophet: (p.turnModifiers.prophet ?? 0) + (delta.prophet ?? 0),
      },
    }));
  }
  return next;
}

/**
 * SPEC surface — stamp the anomaly onto the match and apply its setup patch.
 * Never throws: an unknown id logs and returns the state unchanged.
 */
export function applyAnomalySetup(state: GameState, anomalyId: AnomalyId, rng: Rng): GameState {
  const def = getAnomaly(anomalyId);
  if (!def) return pushLog(state, 'anomalyUnknown', { anomalyId });

  // B88 — Battle Royale needs three seats. Fall back to the other short clock.
  let id = anomalyId;
  if (def.minPlayers > state.config.playerCount) {
    id = 'deaths_door';
  }

  let next: GameState = { ...cloneState(state), anomaly: id };
  next = pushLog(next, 'anomalyApplied', { anomalyId: id, requested: anomalyId });

  // --- stat modifiers (B85) ---------------------------------------------
  const statDelta = STAT_MODIFIERS[id];
  if (statDelta) next = setTurnModifiers(next, statDelta);

  // --- starting decks (B83) ---------------------------------------------
  if (id === 'miniature_deck') {
    for (const pid of next.playerOrder) next = replaceDeck(next, pid, MINIATURE_DECK, rng);
    next = noteSeenAll(next, MINIATURE_DECK);
  } else if (id === 'economic_hedge') {
    for (const pid of next.playerOrder) next = replaceDeck(next, pid, ECONOMIC_HEDGE, rng);
    next = noteSeenAll(next, ECONOMIC_HEDGE);
  } else if (id === 'xushis_game') {
    // Identical for every player: roll once, deal the same ten.
    const deck = randomUniverseCards(rng, 10);
    for (const pid of next.playerOrder) next = replaceDeck(next, pid, deck, rng);
    next = noteSeenAll(next, deck);
    next = pushLog(next, 'xushisGame', { deck });
  }

  // --- shop and pacing (B84, SB-36) --------------------------------------
  if (id === 'accelerated_game') next = scalePiles(next, 0.6);
  if (id === 'prolonged_game') next = scalePiles(next, 1.4);
  if (id === 'time_flail') {
    // SB-36: a timer modifier only. No rule and no engine behaviour changes.
    next = { ...next, config: { ...next.config, turnSeconds: next.config.turnSeconds / 2.5 } };
    next = pushLog(next, 'timeFlail', { turnSeconds: next.config.turnSeconds });
  }
  if (id === 'dynamic_pricing') next = scaleShopCosts(next, 2, 'up');
  if (id === 'fading_blossom') {
    next = scaleShopCosts(next, 0.5, 'down');
    next = grantFlimsyToAll(next);
    next = setTurnModifiers(next, { buys: 5 });
  }

  // --- end conditions (B86, B87, B88) ------------------------------------
  if (id === 'deaths_door') {
    next = { ...next, hardEndTurn: 10 * Math.max(1, next.config.playerCount) };
  }
  if (id === 'heavy_is_the_crown') {
    next = {
      ...next,
      config: { ...next.config, winCondition: { ...next.config.winCondition, kind: 'duel', x: 10 } },
    };
  }
  if (id === 'aim_for_the_moon') {
    next = {
      ...next,
      config: { ...next.config, winCondition: { ...next.config.winCondition, kind: 'crown', x: 20 } },
    };
  }
  if (id === 'battle_royale') {
    next = withPlayerCounters(next, 'battleRoyaleNextCull', 15);
  }

  // --- starting auras (B90) ----------------------------------------------
  const auraId = STARTING_AURAS[id];
  if (auraId) {
    for (const pid of next.playerOrder) next = manifestAura(next, pid, auraId, 'celestial');
  }

  // --- other --------------------------------------------------------------
  if (id === 'dongfang_youxi_sheji') next = assignElements(next, rng);
  // B89 — MEOW MEOW MEOW is display-only: it rewrites the text every view
  // renders and touches no cost, stat, keyword or effect (see meow.ts).
  if (id === MEOW_ANOMALY_ID) next = applyMeowText(next);

  // SB-28 / SB-29: VP-threshold matches drop Prophesized Jlore and Mercenary 280.
  next = stripExcludedFromShop(next);

  return next;
}

function withPlayerCounters(state: GameState, key: string, value: number): GameState {
  let next = state;
  for (const pid of next.playerOrder) {
    next = withPlayer(next, pid, (p) => ({ ...p, counters: { ...p.counters, [key]: value } }));
  }
  return next;
}

// ---------------------------------------------------------------------------
// Per-turn hooks
// ---------------------------------------------------------------------------

/** B85 — the deltas the turn reset adds on top of 1 Action / 1 Buy / 0 Money. */
export function applyTurnModifiers(state: GameState, player: PlayerId): GameState {
  const p = state.players[player];
  if (!p) return state;
  const mod = p.turnModifiers;
  let next = withPlayer(state, player, (q) => ({
    ...q,
    money: q.money + (mod.money ?? 0),
    buys: q.buys + (mod.buys ?? 0),
    actions: q.actions + (mod.actions ?? 0),
    prophet: Math.max(0, q.prophet + (mod.prophet ?? 0)),
    vp: q.vp + (mod.vp ?? 0),
  }));
  const cards = mod.cards ?? 0;
  // `drawCards` mutates the draft and returns the drawn ids, not a state.
  if (cards > 0) drawCards(next, player, cards);
  if (cards < 0) next = discardRandomFromHand(next, player, -cards);
  return next;
}

function discardRandomFromHand(state: GameState, player: PlayerId, n: number): GameState {
  const p = state.players[player];
  if (!p || p.hand.length === 0) return state;
  const moved = p.hand.slice(0, Math.min(n, p.hand.length));
  let next = withPlayer(state, player, (q) => ({
    ...q,
    hand: q.hand.filter((iid) => !moved.includes(iid)),
    gy: [...q.gy, ...moved],
  }));
  const instances = { ...next.instances };
  for (const iid of moved) {
    const inst = instances[iid];
    if (inst) instances[iid] = { ...inst, zone: 'gy' };
  }
  next = { ...next, instances };
  return pushLog(next, 'anomalyLessCards', { discarded: moved.length }, player);
}

/**
 * The anomaly half of the start-of-turn window: Cash Injection at turn 5,
 * Battle Royale culls, and the first-turn anomalies (Audience Choice, Sliced
 * Mangos).
 */
export function anomalyStartOfTurn(state: GameState, player: PlayerId, rng: Rng): GameState {
  if (state.anomaly === null) return state;
  let next = state;

  if (next.anomaly === 'cash_injection' && next.turn === 5) {
    next = cashInjection(next);
  }

  if (next.anomaly === 'battle_royale') {
    next = battleRoyaleTick(next);
  }

  // B89 — instances minted after setup have no filtered text yet.
  if (next.anomaly === MEOW_ANOMALY_ID) next = applyMeowText(next);

  // Turn 1 is already under way when the anomaly is stamped onto the match
  // (`createMatch` opens it), so the per-player grants start from turn 2 and the
  // opening seat collects its own one lap later. Firing on turn 1 instead would
  // hand the opening seat an aura or a card that no other seat has yet, and B90
  // reads the board the moment `createMatch` returns.
  const p = next.players[player];
  if (p && next.turn > 1 && !p.counters.anomalyFirstTurnDone) {
    next = withPlayer(next, player, (q) => ({
      ...q,
      counters: { ...q.counters, anomalyFirstTurnDone: 1 },
    }));
    if (next.anomaly === 'audience_choice') {
      const [defId] = randomUniverseCards(rng, 1);
      if (defId) {
        const made = makeInstance(next, defId, player, 'gy');
        next = withPlayer(made.state, player, (q) => ({ ...q, gy: [...q.gy, made.iid] }));
        next = noteSeenAll(next, [defId]);
        next = pushLog(next, 'audienceChoice', { defId }, player);
      }
    }
    if (next.anomaly === 'sliced_mangos') {
      const heroics = heroicAuraIds();
      if (heroics.length > 0) {
        const auraId = rng.pick(heroics);
        next = manifestAura(next, player, auraId, 'heroic');
        next = pushLog(next, 'slicedMangos', { auraId }, player);
      }
    }
  }

  return next;
}

/** The Heroic pool Sliced Mangos draws from. Owned by the aura data slice. */
function heroicAuraIds(): AuraId[] {
  try {
    return allAuras()
      .filter((a) => a.tier === 'heroic')
      .map((a) => a.id)
      .sort();
  } catch {
    return [];
  }
}

/** Cash Injection: every Copper a player holds becomes a Gold. */
export function cashInjection(state: GameState): GameState {
  const next = cloneState(state);
  let changed = 0;
  for (const iid of Object.keys(next.instances)) {
    const inst = next.instances[iid];
    if (inst.defId !== 'copper') continue;
    if (inst.zone === 'shop') continue; // the Copper pile stays buyable
    inst.defId = 'gold';
    changed += 1;
  }
  if (changed === 0) return state;
  return pushLog(next, 'cashInjection', { converted: changed });
}

/** B88 — every 15 turns, the lowest-VP player is eliminated. */
export function battleRoyaleTick(state: GameState): GameState {
  if (state.turn === 0 || state.turn % 15 !== 0) return state;
  const alive = livePlayers(state);
  if (alive.length <= 1) return state;
  const marker = state.players[alive[0]]?.counters.battleRoyaleLastCull ?? 0;
  if (marker === state.turn) return state;

  const scored = alive.map((id) => ({ id, vp: liveVp(state, id) }));
  scored.sort((a, b) => (a.vp - b.vp) || (a.id < b.id ? -1 : 1));
  const victim = scored[0].id;

  let next = withPlayer(state, victim, (p) => ({ ...p, eliminated: true }));
  for (const pid of next.playerOrder) {
    next = withPlayer(next, pid, (p) => ({
      ...p,
      counters: { ...p.counters, battleRoyaleLastCull: next.turn },
    }));
  }
  return pushLog(next, 'battleRoyaleElimination', { player: victim, vp: scored[0].vp }, victim);
}

/** Dynamic Pricing: -1 to every shop cost at each end of turn, min 0. */
export function anomalyEndOfTurn(state: GameState): GameState {
  if (state.anomaly !== 'dynamic_pricing') return state;
  const next = cloneState(state);
  for (const pileId of Object.keys(next.shop.piles)) {
    const pile = next.shop.piles[pileId];
    const cur = pile.costOverride ?? 0;
    pile.costOverride = Math.max(0, cur - 1);
  }
  return pushLog(next, 'dynamicPricingDecay', {});
}

/** Dynamic Pricing: a bought card's pile costs (3) more afterwards. */
export function dynamicPricingOnBuy(state: GameState, pileId: string): GameState {
  if (state.anomaly !== 'dynamic_pricing') return state;
  const pile = state.shop.piles[pileId];
  if (!pile) return state;
  const next = cloneState(state);
  const target = next.shop.piles[pileId];
  target.costOverride = (target.costOverride ?? 0) + 3;
  return pushLog(next, 'dynamicPricingBump', { pileId, cost: target.costOverride });
}

/** The view layer's one-line anomaly banner. */
export function anomalyBanner(
  state: GameState,
): { id: AnomalyId; name: string; text: string } | null {
  if (state.anomaly === null) return null;
  const def = getAnomaly(state.anomaly);
  if (!def) return null;
  return { id: def.id, name: def.name, text: def.text };
}
