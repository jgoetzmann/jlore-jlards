/**
 * Deterministic greedy bot.
 *
 * B114 is the contract: every action this returns is a member of
 * `legalActions(state, player)`. The implementation enumerates that list and
 * scores each candidate, so the contract holds by construction.
 *
 * No `Math.random` anywhere. Tie-breaking jitter comes from an Rng derived from
 * `(state.seed, state.rngCursor)`, so two calls on the same state pick the same
 * action forever.
 */

import type {
  AuraId,
  CardDefId,
  CardDefinition,
  GameAction,
  GameState,
  InstanceId,
  PileId,
  PlayerId,
  Prompt,
  PromptOption,
  Stats,
} from '@engine/types';
import { legalActions } from '@engine/index';
import { makeRng } from '@engine/rng';
import { getCard } from '@engine/registry';
import { costOf } from '@engine/shop/index';

// ---------------------------------------------------------------------------
// Small read-only helpers over state. None of these mutate anything.
// ---------------------------------------------------------------------------

/** getCard throws on unknown ids; the bot must never throw mid-simulation. */
export function defOrNull(defId: CardDefId | undefined | null): CardDefinition | null {
  if (!defId) return null;
  try {
    return getCard(defId);
  } catch {
    return null;
  }
}

export function instanceDef(state: GameState, iid: InstanceId): CardDefinition | null {
  const inst = state.instances ? state.instances[iid] : undefined;
  if (!inst) return null;
  return defOrNull(inst.defId);
}

function num(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function addStats(a: Stats | undefined, b: Stats | undefined): Stats {
  return {
    money: num(a?.money) + num(b?.money),
    buys: num(a?.buys) + num(b?.buys),
    actions: num(a?.actions) + num(b?.actions),
    cards: num(a?.cards) + num(b?.cards),
    vp: num(a?.vp) + num(b?.vp),
    prophet: num(a?.prophet) + num(b?.prophet),
  };
}

/** Printed stats + match-wide variant delta + this instance's own delta. */
export function effectiveStats(state: GameState, iid: InstanceId): Stats {
  const inst = state.instances ? state.instances[iid] : undefined;
  if (!inst) return {};
  const def = defOrNull(inst.defId);
  const variant = state.variants ? state.variants[inst.defId] : undefined;
  return addStats(addStats(def ? def.stats : undefined, variant ? variant.statDelta : undefined), inst.statDelta);
}

/** Printed stats + match-wide variant delta, for a definition with no instance. */
export function definitionStats(state: GameState, def: CardDefinition): Stats {
  const variant = state.variants ? state.variants[def.id] : undefined;
  return addStats(def.stats, variant ? variant.statDelta : undefined);
}

function hasType(def: CardDefinition | null, t: string): boolean {
  if (!def || !Array.isArray(def.types)) return false;
  for (const x of def.types) if (x === t) return true;
  return false;
}

/**
 * Late game means "buy points, not engine". Two triggers: the turn counter, and
 * how hollowed out the draft board already is.
 */
export function isLateGame(state: GameState): boolean {
  if (state.turn >= 20) return true;
  const shop = state.shop;
  if (!shop || !shop.order || !shop.piles) return false;
  const order = shop.order.draft;
  if (!order || order.length === 0) return false;
  let empty = 0;
  for (const id of order) {
    const p = shop.piles[id];
    if (!p || p.cards.length === 0) empty++;
  }
  return empty / order.length >= 0.5;
}

/** Economy weight of a stat line: money and cards dominate while building. */
function economyValue(st: Stats): number {
  return 12 * num(st.money) + 7 * num(st.cards) + 6 * num(st.actions) + 5 * num(st.buys) + 4 * num(st.prophet);
}

/** Points weight of a stat line. */
function pointsValue(st: Stats): number {
  return 10 * num(st.vp);
}

/**
 * How much the bot wants a given definition right now. Used for buys, for
 * Discover options and for any prompt option that names a card.
 */
export function cardValue(state: GameState, def: CardDefinition | null, late: boolean): number {
  if (!def) return 0;
  const st = definitionStats(state, def);
  const econ = economyValue(st);
  const pts = pointsValue(st);
  const effectCount = def.effects ? def.effects.length : 0;
  const triggerCount = def.triggers ? def.triggers.length : 0;
  const bodyBonus = Math.min(24, 4 * effectCount + 3 * triggerCount);
  const base = late ? pts * 3 + econ * 0.5 : econ * 1.5 + pts * 0.5;
  return base + bodyBonus;
}

function pileTopIid(state: GameState, pileId: PileId): InstanceId | null {
  const shop = state.shop;
  const pile = shop && shop.piles ? shop.piles[pileId] : undefined;
  if (!pile || !pile.cards || pile.cards.length === 0) return null;
  return pile.cards[0];
}

export function pileTopDef(state: GameState, pileId: PileId): CardDefinition | null {
  const iid = pileTopIid(state, pileId);
  if (!iid) return null;
  return instanceDef(state, iid);
}

function safeCost(state: GameState, pileId: PileId, buyer: PlayerId): number {
  try {
    const c = costOf(state, pileId, buyer);
    return Number.isFinite(c) ? c : 0;
  } catch {
    const def = pileTopDef(state, pileId);
    return def && def.cost ? num(def.cost.money) : 0;
  }
}

// ---------------------------------------------------------------------------
// Per-action scoring
// ---------------------------------------------------------------------------

/**
 * Play scoring. Resources cost no Action (B4) so they always go first; among
 * Actions, the ones that replace themselves (+Actions, +Cards) go before the
 * ones that cash out.
 */
export function playScore(state: GameState, player: PlayerId, iid: InstanceId): number {
  const def = instanceDef(state, iid);
  if (!def) return 50;
  const st = effectiveStats(state, iid);
  const isAction = hasType(def, 'Action');
  if (!isAction) {
    // Free to play. Money now is money for this turn's buy.
    return 900 + 10 * num(st.money) + 8 * num(st.cards) + 6 * num(st.actions) + 4 * num(st.buys) + 2 * num(st.vp);
  }
  const cost = Math.max(1, def.bigAction === undefined ? 1 : def.bigAction);
  const me = state.players ? state.players[player] : undefined;
  const actionsLeft = num(me ? me.actions : undefined);
  const effectCount = def.effects ? def.effects.length : 0;
  let score =
    400 +
    30 * num(st.actions) +
    22 * num(st.cards) +
    10 * num(st.money) +
    6 * num(st.buys) +
    3 * num(st.vp) +
    Math.min(20, 4 * effectCount);
  // Big Action N eats the action budget; only worth it when actions are spare.
  score -= 18 * (cost - 1);
  if (cost > 1 && actionsLeft <= cost) score -= 60;
  // A terminal action with nothing left behind it is still fine, just later.
  if (num(st.actions) === 0 && actionsLeft <= 1) score -= 25;
  return score;
}

/** Buy scoring: most expensive affordable, tilted to VP late and economy early. */
export function buyScore(state: GameState, player: PlayerId, pileId: PileId, late: boolean): number {
  const def = pileTopDef(state, pileId);
  if (!def) return 0;
  const cost = safeCost(state, pileId, player);
  const value = cardValue(state, def, late);
  let score = 120 + value + 4 * Math.max(0, cost);
  // Prophet buys spend no Buy and no Money (B58, B59) — nearly free upside.
  if (def.cost && def.cost.prophet) score += 40;
  // Negative-cost cards pay the buyer (B55): worth taking for the credit.
  if (cost < 0) score += 10 * -cost;
  const st = definitionStats(state, def);
  if (!late && num(st.vp) > 0 && economyValue(st) === 0) score -= 60;
  if (num(st.vp) < 0) score -= late ? 120 : 40;
  return score;
}

/** Value of one prompt option to this bot. */
export function optionValue(state: GameState, opt: PromptOption, late: boolean): number {
  if (opt.defId) return cardValue(state, defOrNull(opt.defId), late);
  if (opt.iid) return cardValue(state, instanceDef(state, opt.iid), late);
  if (opt.pileId) {
    const def = pileTopDef(state, opt.pileId);
    if (def) return cardValue(state, def, late);
  }
  // A labelled branch with no card behind it: prefer the earlier option, which
  // is the authored "main line" on almost every card in this catalog.
  return 1;
}

/** True for prompts where picking the *best* card is the wrong move. */
function promptIsDisposal(prompt: Prompt): boolean {
  const text = String(prompt.prompt === undefined ? '' : prompt.prompt).toLowerCase();
  return text.indexOf('trash') >= 0 || text.indexOf('discard') >= 0 || text.indexOf('give') >= 0;
}

export function resolveScore(state: GameState, keys: string[], late: boolean): number {
  const prompt = state.pending;
  if (!prompt) return 0;
  const byKey: Record<string, PromptOption> = {};
  const opts = prompt.options ? prompt.options : [];
  for (const o of opts) byKey[o.key] = o;
  const invert = promptIsDisposal(prompt) ? -1 : 1;
  let total = 0;
  for (const k of keys) {
    const o = byKey[k];
    if (o) total += invert * optionValue(state, o, late);
  }
  // Resolving is always better than stalling.
  return 2000 + total;
}

function auraScore(state: GameState, player: PlayerId, auraId: AuraId): number {
  const me = state.players ? state.players[player] : undefined;
  // Heroic activation costs 2 Money (B77). Only worth it with money to spare.
  if (num(me ? me.money : undefined) < 2) return -50;
  return 300;
}

export function scoreAction(state: GameState, player: PlayerId, action: GameAction, late: boolean): number {
  switch (action.type) {
    case 'resolve':
      return resolveScore(state, action.keys ? action.keys : [], late);
    case 'play':
      return playScore(state, player, action.iid);
    case 'buy':
      return buyScore(state, player, action.pileId, late);
    case 'activateAura':
      return auraScore(state, player, action.auraId);
    case 'reorderHand':
      // The bot reads no adjacency, so reordering is pure noise.
      return -900;
    case 'endTurn':
      return -1000;
    case 'concede':
      return -1e9;
    case 'start':
      return -1e9;
    default:
      return -1e8;
  }
}

// ---------------------------------------------------------------------------
// The bot
// ---------------------------------------------------------------------------

export function botAction(state: GameState, player: PlayerId): GameAction {
  const options = legalActions(state, player);
  if (!options || options.length === 0) {
    // Nothing legal: ending the turn is the only move that can unstick a match.
    return { type: 'endTurn', player };
  }
  const rng = makeRng(state.seed, state.rngCursor);
  const late = isLateGame(state);
  let best: GameAction = options[0];
  let bestScore = -Infinity;
  for (let i = 0; i < options.length; i++) {
    const candidate = options[i];
    // Jitter is drawn in list order from a seeded Rng, so it is stable for a
    // given state and never touches Math.random.
    const score = scoreAction(state, player, candidate, late) + rng.next() * 0.001;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

export default botAction;
