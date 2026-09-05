/**
 * Barrel for the core turn loop and zone machinery, so the effects, systems,
 * shop and meta slices have one import point for the primitives they need.
 */

export { cloneState, deepClone, deepEqual } from './clone.js';
export { appendLog, logReject, lastLog, nextIdFor } from './log.js';

export {
  createInstance,
  deckOf,
  defOfInstance,
  detach,
  discardInstance,
  drawCards,
  drawOne,
  effectiveStats,
  hasKeyword,
  instOf,
  keywordsOf,
  millCards,
  moveInstance,
  moveToPile,
  nextInstanceId,
  printedVp,
  reshuffleGyIntoLibrary,
  safeDef,
  shuffleLibrary,
  shuffleZone,
  topOfPile,
  trashInstance,
  zoneList,
} from './zones.js';
export type { Position } from './zones.js';

export {
  clearTriggerCounters,
  fireInstanceTriggers,
  fireOwnedTriggers,
  fireTableTriggers,
  makeContext,
  runEffects,
} from './triggers.js';

export {
  actionCostOf,
  addProphet,
  applyStats,
  canPlayCard,
  consumePlayMods,
  playCard,
  resolvePlayOnDraw,
} from './play.js';
export type { PlayOptions } from './play.js';

export { buyCard, buyablePiles, canBuyPile, pileTops, priceFor } from './buy.js';

export {
  activateAura,
  activatableAuras,
  activationCostOf,
  auraOf,
  canActivateAura,
  manifestAura,
  HEROIC_ACTIVATION_COST,
} from './aura.js';

export {
  advanceTurn,
  endTurn,
  expireShopTimers,
  resetTurnStats,
  startTurn,
} from './turn.js';

export {
  computeScores,
  deckSizeOf,
  determineWinners,
  endOfGameCards,
  scoreFor,
  turnsTakenBy,
  vpOnInstance,
} from './scoring.js';

export {
  emptyDraftPiles,
  endGameIfLapComplete,
  endGameNow,
  finishGame,
  jlorePileId,
  localEndCondition,
  noteEndCondition,
} from './endgame.js';

export { drainQueue, isValidResolution, legalResolutions, resolvePrompt, validKeysFor } from './resume.js';

export { isHandPermutation, legalActions } from './actions.js';

export {
  createMatch,
  defaultMatchConfig,
  OPENING_HAND,
  STARTING_COPPER,
  STARTING_TIX,
} from './setup.js';
