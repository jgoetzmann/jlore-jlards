/**
 * Shop slice public surface. S-SHOP, S-LOCK, S-COSTMOD, S-PROPHET (B44-B61).
 *
 * The six functions the SPEC names are exported first and re-exported verbatim
 * from their implementation files; everything below them is the working surface
 * the effect interpreter and the reducer need.
 */

import type { GameState, PileId, PlayerId } from '@engine/types';
import { pileDefId, safeGetCard } from './util';
import { canAffordMoney, costOf } from './cost';
import { isLocked } from './locks';
import { canAffordProphet, isProphetPile } from './prophet';

export { buildShop } from './build';
export { costOf } from './cost';
export { isLocked } from './locks';
export { pileSizeFor, rarityPullWeight } from './sizes';

/**
 * B50, B57, B19. Everything the reducer checks before letting a buy through,
 * in one predicate so `legalActions` and `reduce` cannot disagree (B25).
 *
 * A Prophet pile is gated on banked Prophet and consumes no Buy (B59); a Money
 * pile is gated on the wallet and one Buy. A negative price is always affordable
 * because it pays out (B55).
 */
export function canBuy(state: GameState, pileId: PileId, buyer: PlayerId): boolean {
  const pile = state.shop.piles[pileId];
  if (!pile) return false;
  if (pile.cards.length === 0) return false;

  // B50: locked piles are closed to everybody, including the locker.
  if (isLocked(state, pileId)) return false;

  const player = state.players[buyer];
  if (!player || player.eliminated) return false;

  const defId = pileDefId(state, pileId);
  if (!defId) return false;
  const def = safeGetCard(defId);
  // B62: Tokens are never purchasable, even if one somehow lands in a pile.
  if (def && def.notPurchasable) return false;

  if (isProphetPile(state, pileId)) {
    // B58, B59: no Money, no Buy — only the threshold.
    return canAffordProphet(state, defId, buyer);
  }

  if (player.buys < 1) return false;
  return canAffordMoney(player.money, costOf(state, pileId, buyer));
}

/** Every pile this player could buy from right now. Feeds `legalActions`. */
export function buyablePiles(state: GameState, buyer: PlayerId): PileId[] {
  const out: PileId[] = [];
  const shops: ('resource' | 'points' | 'prophet' | 'draft')[] = [
    'resource',
    'points',
    'prophet',
    'draft',
  ];
  for (const shop of shops) {
    for (const pileId of state.shop.order[shop]) {
      if (canBuy(state, pileId, buyer)) out.push(pileId);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Working surface for the reducer, effect interpreter and view
// ---------------------------------------------------------------------------

export {
  DEFAULT_PROPHET_PILE_COUNT,
  RESOURCE_SHOP,
  POINTS_SHOP,
  draftCandidates,
  draftPileSize,
  prophetCandidates,
  sampleDraftDefs,
  sampleProphetDefs,
} from './build';

export {
  BASIC_POINTS_IDS,
  JLORE_ID,
  RARITY_PILE_SIZE,
  RARITY_PULL_WEIGHT,
  basicPileSize,
  prophetPileSize,
} from './sizes';

export {
  addToPileTop,
  createShopInstance,
  pileOfInstance,
  pushTop,
  removeFromPile,
  replenish,
} from './piles';

export {
  accruedDiscardCost,
  expiryTurnFor,
} from './locks';

export {
  DEFAULT_COST_FLOOR,
  applyCostMod,
  canAffordMoney,
  costModExpiryFor,
  costModIsActive,
  costModStack,
} from './cost';

export {
  DEBT_LEGAL_DEF_ID,
  PROPHET_SHOP_CARD_IDS,
  VP_THRESHOLD_EXCLUDED_IDS,
  canAffordProphet,
  isProphetPile,
  isVpThresholdMatch,
  prophetCostOfDef,
  prophetCostOfPile,
} from './prophet';

export { makePileId, pileDefId } from './util';

