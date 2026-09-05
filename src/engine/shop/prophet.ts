/**
 * The Prophet Shop. B57-B61, SB-5, SB-14, SB-28.
 *
 * Prophet is the persistent second currency: it never resets between turns, it
 * is clamped at 0, and it is spent by threshold rather than by wallet. A Prophet
 * purchase costs no Money (B58) and no Buy (B59) — the threshold is the whole
 * limiter, which is why it is a hard one.
 */

import type { CardDefId, GameState, PileId, PlayerId, ProphetCost } from '@engine/types';
import { appendLog, pileDefId, safeGetCard } from './util';

/**
 * SB-14 / B98. All 24 Prophet cards are present in every match — threshold-gated,
 * not supply-gated. Doomsday Button is in the list because it belongs to the
 * Prophet catalog, but it is `notPurchasable` and so never forms a pile.
 */
export const PROPHET_SHOP_CARD_IDS: CardDefId[] = [
  'chains_of_the_sovereign',
  'destiny_draw',
  'mulligan',
  'cost_co',
  'all_in',
  'platinum',
  'the_trilogy',
  'pray_for_rain',
  'project_doomsday',
  'kwzki_high_council_consultant',
  'truss_pluss',
  'seal_the_rift',
  'ebon_blade',
  'idol_of_the_false_god',
  'religious_dividends',
  'giants_horn',
  'scripture_of_kwzki',
  'scripture_of_siva',
  'scripture_of_jayaad',
  'scripture_of_space',
  'tnack_trav',
  'prophesized_jlore',
  'the_unconcerned_lion',
  'doomsday_button',
];

/** B61. The single card that may be bought into Prophet debt. */
export const DEBT_LEGAL_DEF_ID: CardDefId = 'the_unconcerned_lion';

/**
 * SB-28 / SB-29. Cards that end the game outright on a VP threshold cannot share
 * a match with a VP-threshold win condition.
 */
export const VP_THRESHOLD_EXCLUDED_IDS: CardDefId[] = ['prophesized_jlore', 'mercenary_280'];

/** True when this match wins on a VP number rather than on empty piles. */
export function isVpThresholdMatch(state: GameState): boolean {
  const kind = state.config.winCondition.kind;
  if (kind === 'crown' || kind === 'duel') return true;
  return state.anomaly === 'aim_for_the_moon' || state.anomaly === 'heavy_is_the_crown';
}

/** The printed Prophet price of a definition, or null when it has none. */
export function prophetCostOfDef(defId: CardDefId): ProphetCost | null {
  const def = safeGetCard(defId);
  if (!def || !def.cost.prophet) return null;
  return def.cost.prophet;
}

/** The Prophet price a pile charges, or null for a Money pile. */
export function prophetCostOfPile(state: GameState, pileId: PileId): ProphetCost | null {
  const defId = pileDefId(state, pileId);
  if (!defId) return null;
  return prophetCostOfDef(defId);
}

/** True when this pile is bought with Prophet rather than Money. */
export function isProphetPile(state: GameState, pileId: PileId): boolean {
  const pile = state.shop.piles[pileId];
  if (pile && pile.shop === 'prophet') return true;
  return prophetCostOfPile(state, pileId) !== null;
}

/**
 * B57. A Prophet card is buyable only when the buyer's banked Prophet is at
 * least its threshold. B61: The Unconcerned Lion ignores the check entirely, so
 * a player at 0 (or below) can still take it.
 */
export function canAffordProphet(state: GameState, defId: CardDefId, player: PlayerId): boolean {
  const cost = prophetCostOfDef(defId);
  if (!cost) return false;
  if (defId === DEBT_LEGAL_DEF_ID) return true;
  const p = state.players[player];
  if (!p) return false;
  return p.prophet >= cost.threshold;
}

/**
 * B58, B60, B61. Pay a Prophet price: subtract the drain, clamp the result at 0,
 * and let The Unconcerned Lion alone go negative. No Money moves and no Buy is
 * consumed — those are the caller's job not to charge.
 */
export function payProphet(state: GameState, defId: CardDefId, player: PlayerId): GameState {
  const cost = prophetCostOfDef(defId);
  const p = state.players[player];
  if (!cost || !p) return state;

  const raw = p.prophet - cost.drain;
  const banked = defId === DEBT_LEGAL_DEF_ID ? raw : Math.max(0, raw);

  const next: GameState = {
    ...state,
    players: {
      ...state.players,
      [player]: { ...p, prophet: banked },
    },
  };
  return appendLog(
    next,
    'prophetPaid',
    { defId, drain: cost.drain, threshold: cost.threshold, before: p.prophet, after: banked },
    player,
  );
}

/**
 * B60. Every write to banked Prophet goes through here. Clamped at 0 for every
 * card except the one debt-legal exception.
 */
export function addProphet(
  state: GameState,
  player: PlayerId,
  amount: number,
  allowDebt = false,
): GameState {
  const p = state.players[player];
  if (!p || amount === 0) return state;
  const raw = p.prophet + amount;
  const banked = allowDebt ? raw : Math.max(0, raw);
  if (banked === p.prophet) return state;
  const next: GameState = {
    ...state,
    players: { ...state.players, [player]: { ...p, prophet: banked } },
  };
  return appendLog(next, 'prophetChanged', { amount, before: p.prophet, after: banked }, player);
}

/** B59. Prophet purchases never consume a Buy; Money purchases always do. */
export function purchaseConsumesBuy(state: GameState, pileId: PileId): boolean {
  return !isProphetPile(state, pileId);
}

/** B58. Prophet purchases cost no Money at all, whatever the pile's price says. */
export function purchaseCostsMoney(state: GameState, pileId: PileId): boolean {
  return !isProphetPile(state, pileId);
}

/** The Prophet cards this buyer could take right now, for the bot and the UI. */
export function affordableProphetPiles(state: GameState, player: PlayerId): PileId[] {
  const out: PileId[] = [];
  for (const pileId of state.shop.order.prophet) {
    const pile = state.shop.piles[pileId];
    if (!pile || pile.cards.length === 0) continue;
    const defId = pileDefId(state, pileId);
    if (!defId) continue;
    if (canAffordProphet(state, defId, player)) out.push(pileId);
  }
  return out;
}
