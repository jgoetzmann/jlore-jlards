/**
 * Match setup.
 *
 * B1 Each player is dealt 7 Copper + 3 Tix and draws a 5-card opening hand.
 * B83 Anomalies may replace the starting deck, so `applyAnomalySetup` runs
 *     before the libraries are shuffled and the opening hands are drawn.
 * B93 With `seedCodexWithCommons`, every codex starts holding Basic, Common and
 *     Rare ids (SB-18).
 */

import type {
  AnomalyId,
  CardDefId,
  GameState,
  MatchConfig,
  PlayerId,
  PlayerState,
} from '@engine/types';
import { makeRng } from '@engine/rng';
import { allCards } from '@engine/registry';
import { DEFAULT_PROPHET_PILE_COUNT, buildShop } from '@engine/shop';
import { applyAnomalySetup, rollAnomaly } from '@engine/meta';
import { appendLog } from './log.js';
import { createInstance, shuffleLibrary, drawCards } from './zones.js';
import { startTurn } from './turn.js';

export const STARTING_COPPER = 7;
export const STARTING_TIX = 3;
export const OPENING_HAND = 5;

export function defaultMatchConfig(playerCount: number): MatchConfig {
  return {
    playerCount,
    draftPileCount: 10, // SB-10
    // SB-14 (revised): the Prophet Shop is sampled, not fully stocked.
    // `buildShop` carries the same default; this is here so a caller that
    // reads the config back sees the number the match actually used, and so
    // a count handed to `createMatch` survives normalizeConfig.
    prophetPileCount: DEFAULT_PROPHET_PILE_COUNT,
    // Gameplay doc 8.1: the source roll is 50% standard / 20% Anomalous /
    // 20% Formational / 10% Chaotic. Formations are out of scope this pass, and
    // the two anomaly-bearing rolls (Anomalous + Chaotic) sum to 30% — "the
    // interim split is 70% standard / 30% Anomalous".
    anomalyChance: 0.3,
    winCondition: {
      kind: 'standard',
      emptyPileFraction: 0.4, // SB-3
      emptyPileAbsolute: 4,
      x: null,
    },
    pileSizeScale: 1,
    effectNodeBudget: 200, // gameplay doc 12.2
    recursionDepth: 8,
    turnSeconds: 90,
    seedCodexWithCommons: true, // SB-18
  };
}

function normalizeConfig(config: MatchConfig, playerCount: number): MatchConfig {
  const base = defaultMatchConfig(playerCount);
  const wc = config?.winCondition ?? base.winCondition;
  return {
    playerCount: config?.playerCount ?? playerCount,
    draftPileCount: config?.draftPileCount ?? base.draftPileCount,
    prophetPileCount: config?.prophetPileCount ?? base.prophetPileCount,
    anomalyChance: config?.anomalyChance ?? base.anomalyChance,
    winCondition: {
      kind: wc.kind ?? 'standard',
      emptyPileFraction: wc.emptyPileFraction ?? base.winCondition.emptyPileFraction,
      emptyPileAbsolute:
        wc.emptyPileAbsolute === undefined ? base.winCondition.emptyPileAbsolute : wc.emptyPileAbsolute,
      x: wc.x === undefined ? null : wc.x,
    },
    pileSizeScale: config?.pileSizeScale ?? base.pileSizeScale,
    effectNodeBudget: config?.effectNodeBudget ?? base.effectNodeBudget,
    recursionDepth: config?.recursionDepth ?? base.recursionDepth,
    turnSeconds: config?.turnSeconds ?? base.turnSeconds,
    seedCodexWithCommons:
      config?.seedCodexWithCommons === undefined
        ? base.seedCodexWithCommons
        : config.seedCodexWithCommons,
  };
}

function emptyPlayer(id: PlayerId, name: string, codex: CardDefId[]): PlayerState {
  return {
    id,
    name,
    library: [],
    hand: [],
    gy: [],
    play: [],
    field: [],
    money: 0,
    buys: 0,
    actions: 0,
    prophet: 0,
    vp: 0,
    codex: [...codex],
    playedThisTurn: [],
    cardsGainedThisTurn: 0,
    buysUsedThisTurn: 0,
    combo: 0,
    delayed: [],
    nextCardMods: [],
    turnModifiers: {},
    carryMoney: 0,
    eliminated: false,
    quest: null,
    playCounts: {},
    counters: {},
    lastElement: null,
    extraTurns: 0,
  };
}

/** B93 / SB-18: Basic + Common + Rare are free; Epic and up are earned. */
function seededCodexIds(): CardDefId[] {
  const out: CardDefId[] = [];
  let defs: ReturnType<typeof allCards> = [];
  try {
    defs = allCards();
  } catch {
    return out;
  }
  for (const def of defs) {
    if (def.rarity === 'basic' || def.rarity === 'common' || def.rarity === 'rare') {
      out.push(def.id);
    }
  }
  return out;
}

export function createMatch(
  config: MatchConfig,
  players: { id: PlayerId; name: string; codex: CardDefId[] }[],
  seed: number,
  anomaly?: AnomalyId | null,
): GameState {
  const roster = players.length ? players : [{ id: 'p1', name: 'Player 1', codex: [] }];
  const cfg = normalizeConfig(config, roster.length);

  let s: GameState = {
    seed,
    rngCursor: 0,
    turn: 1,
    round: 1,
    activePlayer: roster[0]!.id,
    playerOrder: roster.map((p) => p.id),
    players: {},
    instances: {},
    nextInstanceSeq: 1,
    shop: {
      piles: {},
      order: { resource: [], points: [], prophet: [], draft: [] },
      globalCostMods: [],
    },
    variants: {},
    anomaly: null,
    config: cfg,
    pending: null,
    queue: [],
    nodesResolvedThisTurn: 0,
    log: [],
    logSeq: 0,
    ended: false,
    endTriggeredBy: null,
    endReason: null,
    winners: null,
    doomsdayCounter: 0,
    hardEndTurn: null,
    defsInMatch: [],
  };

  const seededCodex = cfg.seedCodexWithCommons ? seededCodexIds() : [];

  for (const entry of roster) {
    const codex = [...entry.codex];
    for (const id of seededCodex) if (!codex.includes(id)) codex.push(id);
    s.players[entry.id] = emptyPlayer(entry.id, entry.name, codex);
  }

  appendLog(s, 'matchStart', null, {
    seed,
    players: roster.map((p) => p.id),
    config: cfg,
  });

  // B1: 7 Copper + 3 Tix per player, in the library.
  for (const entry of roster) {
    for (let i = 0; i < STARTING_COPPER; i++) createInstance(s, 'copper', entry.id, 'library');
    for (let i = 0; i < STARTING_TIX; i++) createInstance(s, 'tix', entry.id, 'library');
  }

  // Anomaly: an explicit argument wins; `undefined` rolls (B81, B82 - one only).
  let anomalyId: AnomalyId | null;
  if (anomaly !== undefined) {
    anomalyId = anomaly ?? null;
  } else {
    const rng = makeRng(s.seed, s.rngCursor);
    let rolled: AnomalyId | null = null;
    try {
      rolled = rollAnomaly(rng, cfg.anomalyChance);
    } catch {
      rolled = null;
    }
    s.rngCursor = rng.cursor();
    anomalyId = rolled;
  }
  s.anomaly = anomalyId;

  // Shop.
  {
    const rng = makeRng(s.seed, s.rngCursor);
    try {
      s = buildShop(s, rng) ?? s;
    } catch (err) {
      appendLog(s, 'shopError', null, { message: String(err) });
    }
    s.rngCursor = rng.cursor();
  }

  // Anomaly setup runs against a fully built board so it can replace starting
  // decks (B83), rescale piles (B84), manifest starting auras (B90) and remove
  // cards that clash with the win condition (SB-28).
  if (anomalyId) {
    const rng = makeRng(s.seed, s.rngCursor);
    try {
      s = applyAnomalySetup(s, anomalyId, rng) ?? s;
    } catch (err) {
      appendLog(s, 'anomalyError', null, { anomalyId, message: String(err) });
    }
    s.rngCursor = rng.cursor();
    appendLog(s, 'anomaly', null, { anomalyId });
  }

  // Shuffle and deal opening hands (B1).
  for (const entry of roster) {
    shuffleLibrary(s, entry.id);
    drawCards(s, entry.id, OPENING_HAND);
  }

  // Every definition present in the match enters every codex (B92).
  for (const defId of s.defsInMatch) {
    for (const entry of roster) {
      const p = s.players[entry.id];
      if (p && !p.codex.includes(defId)) p.codex.push(defId);
    }
  }

  s.activePlayer = roster[0]!.id;
  s = startTurn(s);
  return s;
}
