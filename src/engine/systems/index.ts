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
  upgradeRelic,
  upgradeResource,
  upgradedDefId,
} from './upgrade';

// --- S-BIGACTION ------------------------------------------------------------


// --- S-COMBO ----------------------------------------------------------------

export {
  COMBO_OFFSET_KEY,
  COMBO_OFFSET_TURN_KEY,
  comboOffsetOf,
  comboClausesOf,
  resetCombo,
  resetComboInPlace,
  stealComboClause,
} from './combo';

// --- S-DELAYED --------------------------------------------------------------

export type { DelayWhen } from './delayed';
export {
  resolveSchedule,
  scheduleDelayed,
  turnCycle,
} from './delayed';

// --- S-PERSIST --------------------------------------------------------------

export {
  bumpCounter,
  bumpPlayCount,
  isNthPlay,
  playCountOf,
} from './persist';

// --- S-PLAGUE ---------------------------------------------------------------


// --- S-MULTIPLIER -----------------------------------------------------------

export {
  DESTROYS,
  DONGFANG,
  GENERATES,
  elementMultiplier,
  elementMultiplierFor,
  elementOf,
  elementOfInstance,
  previousElementOf,
} from './multiplier';

// --- Keywords ---------------------------------------------------------------

export {
  effectiveKeywords,
  grantKeyword,
  hasKeyword,
  isUnfathomable,
  setKeyword,
  stripKeyword,
} from './keywords';

// --- S-STEAL ----------------------------------------------------------------

export {
  copyToOwn,
  opponentsOf,
  stealInstance,
} from './steal';

// --- S-FUSE -----------------------------------------------------------------

export {
  FUSED_COST_CAP,
  fusedDefinition,
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
} from './internal';

