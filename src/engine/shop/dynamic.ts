/**
 * Prices that are a function of live state.
 *
 * Most cost movement is a `CostMod` pushed onto a pile, which is right for
 * "everything costs (1) less this turn". A handful of cards instead print a
 * price that *is* a reading of the board — "costs (0) if your hand is empty",
 * "costs (1) less per card played this turn" — and those cannot be a mod,
 * because nothing fires at the moment the condition changes. Every attempt to
 * express them as a start-of-turn trigger on the shop instance was dead code:
 * no dispatcher fires triggers on cards sitting in a pile, and a start-of-turn
 * snapshot samples the hand at the one moment it is guaranteed full.
 *
 * So they are read at price time instead. `costOf` consults this table right
 * after the printed cost and before the modifier stack, so a discount from
 * The Invisible Hand still applies on top.
 *
 * Every entry must be a PURE function of `(state, buyer)`. `costOf` is called
 * from rendering and from `legalActions` as well as from the buy path, so a
 * price that consumed randomness or mutated state would desync the table.
 */

import type { CardDefId, GameState, PlayerId } from '@engine/types';
import { makeRng } from '@engine/rng';

/** Lead's per-turn reroll, in [-2, 10]. */
export function leadPriceFor(state: GameState, turn: number): number {
  // Derived from (seed, turn) rather than drawn from the cursor: `costOf` is a
  // pure read called many times per turn, so it cannot advance the rng. This
  // still rerolls every turn and still reproduces exactly from the seed.
  const rng = makeRng(state.seed + turn * 7919, 0);
  return -2 + Math.floor(rng.next() * 13);
}

type PriceFn = (state: GameState, buyer: PlayerId) => number;

export const DYNAMIC_PRICES: Record<CardDefId, PriceFn> = {
  // A.7 730: "Costs (0) if your hand is empty."
  pure_of_heart: (state, buyer) => (state.players[buyer]?.hand.length === 0 ? 0 : 4),

  // A.7 749: "Costs (1) less per card played this turn."
  giants_aid: (state, buyer) =>
    Math.max(0, 11 - (state.players[buyer]?.playedThisTurn.length ?? 0)),

  // A.7 747: "Cost rerolls between (-2) and (10) each turn."
  lead: (state) => leadPriceFor(state, state.turn),

  // B.3 / SB-26: three cards share the printed name "Craft a Card" and the
  // price is "the highest it can be while still being purchasable", so it is a
  // reading of the buyer's wallet rather than a printed number.
  craft_a_card: (state, buyer) => {
    const money = state.players[buyer]?.money ?? 0;
    if (money >= 10) return 10;
    if (money >= 5) return 5;
    return 1;
  },
};

// Blood Diamond Cutter is deliberately NOT here. Its "(2) off per Action costing
// (1) or less trashed from hand" is paid by trashing cards as part of the
// purchase, so the price depends on a choice the buyer has not made yet — a buy
// -time prompt, not a pure read of the board.

/** The live price for a definition, or null when it prices normally. */
export function dynamicPriceFor(
  state: GameState,
  defId: CardDefId,
  buyer: PlayerId,
): number | null {
  const fn = DYNAMIC_PRICES[defId];
  if (!fn) return null;
  const out = fn(state, buyer);
  return Number.isFinite(out) ? out : null;
}
