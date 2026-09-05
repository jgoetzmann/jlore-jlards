/** Simulation harness barrel. The engine stays pure; every side effect is in tools/. */

export { botAction, cardValue, isLateGame, scoreAction } from './bot';
export {
  DEFAULT_SIM_CONFIG,
  MAX_STEPS,
  MAX_TURNS,
  simConfig,
  simPlayers,
  simulateMany,
  simulateManyDetailed,
  simulateMatch,
  simulateMatchDetailed,
} from './run';
export type { DetailedMatchResult, MatchResult } from './run';
export { aggregate, winsBySeat } from './telemetry';
export type { AnomalyBalance, BalanceReport, CardBalance, DeadCard, VariantLength } from './telemetry';
export { actionFromLog, extractActions, replay, replayState } from './replay';
