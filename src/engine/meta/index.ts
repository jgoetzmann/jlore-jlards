/**
 * S5 engine-meta — anomalies, win conditions, scoring, auras, codex, quest,
 * and the SB-40 heuristic substitutes.
 *
 * The seven functions below are the frozen surface from SPEC.md. Everything
 * else re-exported here is the machinery the rest of the engine calls into.
 */

import type { AnomalyId, CardDefId, GameState, PlayerId } from '@engine/types';
import type { Rng } from '@engine/rng';

import { rollAnomaly as rollAnomalyImpl, applyAnomalySetup as applyAnomalySetupImpl } from './anomalies.js';
import { checkEndCondition as checkEndConditionImpl } from './wincon.js';
import { scoreFinal as scoreFinalImpl } from './scoring.js';
import { knownUniverse as knownUniverseImpl, entireUniverse as entireUniverseImpl } from './codex.js';
import { auraStartOfTurn as auraStartOfTurnImpl } from './auras.js';

// ---------------------------------------------------------------------------
// Frozen surface (SPEC.md > Surface > src/engine/meta/index.ts)
// ---------------------------------------------------------------------------

/** B81 — null with probability `1 - chance`, otherwise one anomaly id. */
export function rollAnomaly(rng: Rng, chance: number): AnomalyId | null {
  return rollAnomalyImpl(rng, chance);
}

/** B82–B90 — stamp the anomaly onto the match and apply its setup patch. */
export function applyAnomalySetup(
  state: GameState,
  anomalyId: AnomalyId,
  rng: Rng,
): GameState {
  return applyAnomalySetupImpl(state, anomalyId, rng);
}

/** B14 / B91 — has the game ended, and why. */
export function checkEndCondition(state: GameState): { ended: boolean; reason: string | null } {
  return checkEndConditionImpl(state);
}

/** B17 — final VP per player, including End of Game cards. */
export function scoreFinal(state: GameState): Record<PlayerId, number> {
  return scoreFinalImpl(state);
}

/** B93 / B94 — one player's Known Universe. */
export function knownUniverse(state: GameState, player: PlayerId): CardDefId[] {
  return knownUniverseImpl(state, player);
}

/** B32 / B33 — the whole registry minus `excludeFromPools`. */
export function entireUniverse(): CardDefId[] {
  return entireUniverseImpl();
}

/** B80 — the aura half of the start-of-turn window. */
export function auraStartOfTurn(state: GameState, player: PlayerId): GameState {
  return auraStartOfTurnImpl(state, player);
}

// ---------------------------------------------------------------------------
// Slice machinery the rest of the engine calls
// ---------------------------------------------------------------------------

export {
  anomalies,
  anomaliesInGroup,
  anomalyBanner,
  anomalyEndOfTurn,
  anomalyIds,
  anomalyStartOfTurn,
  applyTurnModifiers,
  battleRoyaleTick,
  canCombine,
  cashInjection,
  dynamicPricingOnBuy,
  fadingBlossomKeyword,
  getAnomaly,
  randomUniverseCards,
  MUTEX_GROUPS,
} from './anomalies.js';
export type { AnomalyDef, AnomalyGroup } from './anomalies.js';

export {
  activateAura,
  auraEndOfTurn,
  auraIdsForTier,
  aurasOfTier,
  bindAura,
  celestialsOf,
  fieldOf,
  hasAura,
  heroicOf,
  hypercelestialOf,
  manifestAura,
  outstandingDebtAmount,
  removeAura,
  tierOf,
  HEROIC_ACTIVATION_COST,
  OATHBOUND_MEMORY_ID,
  OUTSTANDING_DEBT_ID,
  OUTSTANDING_DEBT_TURNS,
} from './auras.js';

export {
  codexSeedIds,
  entireUniverseIn,
  isVpThresholdMatch,
  noteSeen,
  noteSeenAll,
  poolExclusions,
  seedCodexes,
  stripExcludedFromShop,
  VP_THRESHOLD_EXCLUSIONS,
} from './codex.js';

export { displayText, isMeowActive, meowify, MEOW_ANOMALY_ID } from './meow.js';

export {
  deckDiamondCount,
  deckUniqueCount,
  getFloor,
  questEndOfTurn,
  questFloors,
  questOnWin,
  questProgress,
  questStartOfTurn,
  questSummary,
  startQuest,
  IN_TOO_DEEP_AURA_ID,
} from './quest.js';
export type { QuestFloor, QuestPredicate } from './quest.js';

export {
  accruedVp,
  isEndOfGame,
  liveVp,
  scoreFor,
  winnersOf,
  CONSTELLATION_ID,
  STAR_ALIGNER_ID,
} from './scoring.js';

export {
  auctionBid,
  moneyGapToNextPile,
  perfectCardFor,
  rankedKnownUniverse,
  scoreCandidate,
  vpGapToLeader,
  winningDeckFor,
} from './sim.js';

export {
  countdownTarget,
  crownTarget,
  duelTarget,
  emptyDraftPiles,
  jloreEmpty,
  standardPileTrigger,
  turnsRemaining,
  vpLead,
  DOOMSDAY_LIMIT,
  JLORE_PILE_ID,
} from './wincon.js';
export type { EndCheck } from './wincon.js';
