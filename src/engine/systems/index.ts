/**
 * src/engine/systems — the cross-cutting rules subsystems.
 *
 * Nothing in here owns the turn loop or the shop; these are the systems every
 * card leans on and no card should reimplement:
 *
 *   buff        S-BUFF        B67–B70
 *   upgrade     S-BUFF        Resource ladder + Relic upgrades (§3.2)
 *   bigaction   S-BIGACTION   B72–B73 (SB-1)
 *   combo       S-COMBO       B71, B34
 *   delayed     S-DELAYED     scheduling and firing
 *   persist     S-PERSIST     B63–B64
 *   plague      S-PLAGUE      B65
 *   multiplier  S-MULTIPLIER  B74–B75
 *   keywords    keyword set   B12 (SB-16), B10, B11, B40
 *   steal       S-STEAL       move vs copy
 *   fuse        S-FUSE        SB-13
 */

// --- the five entry points named in SPEC.md ---------------------------------

export { applyBuff } from './buff';
export { bigActionCost } from './bigaction';
export { comboCount } from './combo';
export { tickDelayed } from './delayed';
export { plagueTokensOn } from './plague';

// --- S-BUFF -----------------------------------------------------------------

export {
  applyBuffTimes,
  applyNerf,
  effectiveDefStats,
  effectiveStats,
  ensureVariant,
  pickBuffStat,
  statOf,
} from './buff';

// --- Upgrade ----------------------------------------------------------------

export {
  RESOURCE_LADDER,
  downgradeResource,
  downgradedDefId,
  isUpgradableResource,
  totalUpgrades,
  upgradeCount,
  upgradeRelic,
  upgradeRelicAll,
  upgradeRelicRandom,
  upgradeResource,
  upgradedDefId,
} from './upgrade';

// --- S-BIGACTION ------------------------------------------------------------

export {
  actionCostOfPlay,
  canAffordBigAction,
  isBigAction,
  payBigAction,
  setBigActionOverride,
} from './bigaction';

// --- S-COMBO ----------------------------------------------------------------

export {
  COMBO_OFFSET_KEY,
  COMBO_OFFSET_TURN_KEY,
  clearComboForTurn,
  comboAtPlay,
  comboOffsetOf,
  comboClauseSuppressed,
  comboClausesOf,
  distinctPlayedThisTurn,
  meetsCombo,
  recordPlay,
  resetCombo,
  resetComboInPlace,
  stealComboClause,
} from './combo';

// --- S-DELAYED --------------------------------------------------------------

export type { DelayWhen } from './delayed';
export {
  cancelDelayed,
  pendingDelayedCount,
  resolveSchedule,
  scheduleDelayed,
  tickGameEnd,
  turnCycle,
} from './delayed';

// --- S-PERSIST --------------------------------------------------------------

export {
  RUNEBINDER_MILESTONES,
  bumpCounter,
  bumpCounterMany,
  bumpPlayCount,
  bumpPlayerCounter,
  clearCounter,
  counterOf,
  counterTotalForPlayer,
  instancesWithCounter,
  isMilestonePlay,
  isNthPlay,
  moveKeepingCounters,
  playCountOf,
  playedDefinitions,
  playerCounterOf,
  setCounter,
  totalPlays,
} from './persist';

// --- S-PLAGUE ---------------------------------------------------------------

export {
  addPlague,
  addPlagueMany,
  isPlagued,
  plaguedInPile,
  plaguedInstances,
  plaguedOwnedBy,
  removeAllPlague,
  removeAllPlagueMany,
  removePlague,
  spreadPlague,
  totalPlagueInMatch,
} from './plague';

// --- S-MULTIPLIER -----------------------------------------------------------

export {
  DESTROYS,
  DONGFANG,
  ELEMENT_CYCLE,
  GENERATES,
  applyMultiplier,
  assignElement,
  consumeMultiplier,
  elementMultiplier,
  elementMultiplierFor,
  elementOf,
  elementOfInstance,
  hasInPlay,
  multipliedGain,
  pendingMultiplier,
  previousElementOf,
  queueMultiplyNext,
  recordElement,
} from './multiplier';

// --- Keywords ---------------------------------------------------------------

export {
  canBeTrashed,
  destinationAfterDiscard,
  destinationAfterPlay,
  effectiveKeywords,
  grantKeyword,
  grantKeywordMany,
  hasKeyword,
  isUnfathomable,
  playsOnBuy,
  playsOnDraw,
  setKeyword,
  stripKeyword,
  trashesOnDiscard,
  trashesOnPlay,
} from './keywords';

// --- S-STEAL ----------------------------------------------------------------

export {
  copyToOwn,
  copyToOwnWithState,
  mostExpensiveStealable,
  opponentDeckSize,
  opponentsOf,
  randomOpponent,
  stealInstance,
  stealRandomFrom,
  stealableIn,
} from './steal';

// --- S-FUSE -----------------------------------------------------------------

export {
  CHOPPED_CHUZZ,
  FUSED_COST_CAP,
  fuseInstances,
  fusedDefinition,
  fusionComponents,
  isFused,
  refusesFusion,
} from './fuse';

// --- shared plumbing, useful to the interpreter ------------------------------

export {
  ALL_STAT_KEYS,
  addStats,
  allIids,
  bumpStat,
  copiesOf,
  maxRarity,
  pileContents,
  pileOf,
  scaleStats,
} from './internal';

