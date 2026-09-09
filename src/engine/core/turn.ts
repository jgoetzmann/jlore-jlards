/**
 * The turn loop (gameplay doc 2.3).
 *
 * START OF TURN
 *   - end the game first if the lap is complete (B15)
 *   - reset Actions = 1, Buys = 1, Money = 0, plus turnModifiers and carryMoney (B3)
 *   - tick delayed effects
 *   - start-of-turn aura triggers (B80, after the reset, before card triggers)
 *   - start-of-turn card triggers
 *
 * MAIN
 *   - a single interleaved phase. Buys and plays alternate freely (B6). There is
 *     no phase field in the state because there is no phase split.
 *
 * END OF TURN
 *   - end-of-turn triggers, discard hand to GY, draw 5, reset (B7)
 */

import type { AuraInstance, GameState, PlayerId } from '@engine/types';
import { tickDelayed } from '@engine/systems';
import { auraStartOfTurn, questProgress, questStartOfTurn } from '@engine/meta';
import { appendLog } from './log.js';
import {
  clearTriggerCounters,
  fireInstanceTriggers,
  fireOwnedTriggers,
  makeContext,
  runEffects,
} from './triggers.js';
import { discardInstance, drawCards, moveInstance } from './zones.js';
import { resolvePlayOnDraw } from './play.js';
import { endGameIfLapComplete, noteEndCondition } from './endgame.js';

/** Absolute safety valve so a looping card can never hang a sim run. */
const HARD_TURN_CEILING = 2000;

// ---------------------------------------------------------------------------
// Expiry bookkeeping (B51 locks, B56 cost mods)
// ---------------------------------------------------------------------------

export function expireShopTimers(state: GameState): void {
  for (const pileId of Object.keys(state.shop.piles)) {
    const pile = state.shop.piles[pileId];
    if (!pile) continue;
    const beforeLocks = pile.locks.length;
    pile.locks = pile.locks.filter(
      (l) => l.expiresOnTurn === null || l.expiresOnTurn > state.turn,
    );
    if (pile.locks.length !== beforeLocks) {
      appendLog(state, 'unlock', null, { pileId, reason: 'expired' });
    }
    // B56: a cost mod's `expiresOnTurn` is the last turn it still bites, so it
    // survives that turn and goes here at the start of the next one. (A lock's
    // `expiresOnTurn` is the first turn it is already gone, hence the `>` above
    // and the `>=` here.)
    pile.costMods = pile.costMods.filter(
      (m) => m.expiresOnTurn === null || m.expiresOnTurn >= state.turn,
    );
  }
  state.shop.globalCostMods = state.shop.globalCostMods.filter(
    (m) => m.expiresOnTurn === null || m.expiresOnTurn >= state.turn,
  );
}

// ---------------------------------------------------------------------------
// Delayed effects
// ---------------------------------------------------------------------------

function tickDelayedLocal(
  state: GameState,
  player: PlayerId,
  when: 'startOfTurn' | 'endOfTurn',
): GameState {
  const p = state.players[player];
  if (!p) return state;
  const due = p.delayed.filter((d) => d.when === when && d.fireOnTurn <= state.turn);
  if (due.length === 0) return state;
  p.delayed = p.delayed.filter((d) => !(d.when === when && d.fireOnTurn <= state.turn));
  let s = state;
  for (const d of due) {
    appendLog(s, 'delayed', player, { id: d.id, when });
    s = runEffects(s, d.effects, makeContext(player, d.sourceIid ?? null, 0, 1, {}));
    if (s.pending) break;
  }
  return s;
}

function tickDelayedFor(
  state: GameState,
  player: PlayerId,
  when: 'startOfTurn' | 'endOfTurn',
): GameState {
  let s = state;
  try {
    s = tickDelayed(s, player, when) ?? s;
  } catch {
    /* systems slice unavailable; the local tick below covers it */
  }
  return tickDelayedLocal(s, player, when);
}

// ---------------------------------------------------------------------------
// Start of turn
// ---------------------------------------------------------------------------

/** B3: the reset, before any card or aura trigger. */
export function resetTurnStats(state: GameState, player: PlayerId): void {
  const p = state.players[player];
  if (!p) return;
  const mod = p.turnModifiers;
  p.actions = Math.max(0, 1 + (mod.actions ?? 0));
  p.buys = Math.max(0, 1 + (mod.buys ?? 0));
  p.money = 0 + (mod.money ?? 0) + p.carryMoney;
  p.carryMoney = 0;
  p.combo = 0; // B71
  p.playedThisTurn = [];
  p.cardsGainedThisTurn = 0;
  p.buysUsedThisTurn = 0;
  // Per-turn player counters. `PlayerState.counters` is otherwise cumulative
  // for the whole game; a `turn:` prefix opts a key into being cleared here, so
  // "one Ricochet per turn" and "if you trashed a Felinor this turn" have
  // somewhere to live. An instance counter cannot express either: it is per
  // card, so a second copy of the card would not see the first one's mark.
  for (const key of Object.keys(p.counters)) {
    if (key.startsWith('turn:')) delete p.counters[key];
  }
  // Prophet is deliberately untouched (B60).
}

export function startTurn(state: GameState): GameState {
  let s = state;
  if (s.ended) return s;

  // B15: the game ends here, before anything else in the window fires.
  s = endGameIfLapComplete(s);
  if (s.ended) return s;

  if (s.turn > HARD_TURN_CEILING) {
    return noteEndCondition(s, s.activePlayer);
  }

  const player = s.activePlayer;
  const p = s.players[player];
  if (!p) return s;

  s.nodesResolvedThisTurn = 0; // B37 budget is per turn
  clearTriggerCounters(s);
  expireShopTimers(s);

  p.counters['turnsTaken'] = (p.counters['turnsTaken'] ?? 0) + 1;
  for (const aura of p.field) (aura as AuraInstance).usedThisTurn = false; // B77

  appendLog(s, 'startTurn', player, { turn: s.turn, round: s.round });

  // 1. Stat reset (B3).
  resetTurnStats(s, player);

  // 2. Delayed effects.
  s = tickDelayedFor(s, player, 'startOfTurn');
  if (s.ended) return s;

  // 3. Aura triggers (B80): after the reset, before card triggers.
  try {
    s = auraStartOfTurn(s, player) ?? s;
  } catch {
    /* meta slice unavailable */
  }
  // B.4's In Too Deep quest advances off ordinary play, so the engine has to
  // drive it. Nothing called the quest module at all, which is why every floor
  // sat unfinished and the four Celestial rewards were unreachable.
  try {
    s = questStartOfTurn(s, player) ?? s;
  } catch {
    /* meta slice unavailable */
  }
  s = tickAuraTimers(s, player);
  if (s.ended) return s;

  // 4. Start-of-turn card triggers.
  s = fireOwnedTriggers(s, 'startOfTurn', player, 0);

  return s;
}

/** Countdown auras (Outstanding Debt) lose a turn every start of turn. */
function tickAuraTimers(state: GameState, player: PlayerId): GameState {
  const p = state.players[player];
  if (!p) return state;
  const kept: AuraInstance[] = [];
  for (const aura of p.field) {
    if (aura.turnsRemaining === undefined) {
      kept.push(aura);
      continue;
    }
    const left = aura.turnsRemaining - 1;
    if (left <= 0) {
      appendLog(state, 'auraExpired', player, { auraId: aura.auraId });
      continue;
    }
    kept.push({ ...aura, turnsRemaining: left });
  }
  p.field = kept;
  return state;
}

// ---------------------------------------------------------------------------
// End of turn
// ---------------------------------------------------------------------------

export function endTurn(state: GameState): GameState {
  let s = state;
  if (s.ended) return s;
  const player = s.activePlayer;
  const p = s.players[player];
  if (!p) return s;

  appendLog(s, 'endTurn', player, { turn: s.turn });

  // B.4 floor 4c: "End a turn with (12)+ unspent Money." Read before the reset.
  // Floor 2b's trash count is reconciled from the tally `trashInstance` keeps,
  // because a trash can happen deep inside the effects layer, which must not
  // import `meta`.
  try {
    if (p.money >= 12) s = questProgress(s, player, 'endTurnMoney12', 1) ?? s;
    const total = p.counters['trashedTotal'] ?? 0;
    const seen = p.counters['questTrashSeen'] ?? 0;
    if (total > seen) {
      s = questProgress(s, player, 'trash', total - seen) ?? s;
      const live = s.players[player];
      if (live) live.counters['questTrashSeen'] = total;
    }
  } catch {
    /* meta slice unavailable */
  }

  // 1. End-of-turn triggers, then delayed end-of-turn effects.
  s = fireOwnedTriggers(s, 'endOfTurn', player, 0);
  s = tickDelayedFor(s, player, 'endOfTurn');
  if (s.ended) return s;

  // 2. Cleanup: the play area goes to GY, then the hand is discarded (B7).
  for (const iid of [...p.play]) {
    const inst = s.instances[iid];
    if (!inst) continue;
    moveInstance(s, iid, player, 'gy');
  }
  const discarded = [...p.hand];
  for (const iid of discarded) {
    discardInstance(s, iid);
    s = fireInstanceTriggers(s, 'onDiscard', player, iid, 0);
  }
  if (discarded.length) s = fireOwnedTriggers(s, 'onDiscard', player, 0);

  // 3. Draw the next hand at end of turn, not at start of next (B7).
  const handSize = Math.max(0, 5 + (p.turnModifiers.cards ?? 0));
  const drawn = drawCards(s, player, handSize);
  s = resolvePlayOnDraw(s, player, drawn, 1);

  // 4. Money and Buys reset.
  p.money = 0;
  p.buys = 0;
  p.actions = 0;

  // 5. Did anything this turn end the game?
  s = noteEndCondition(s, player);
  if (s.ended) return s;

  // 6. Pass the turn.
  s = advanceTurn(s);
  return startTurn(s);
}

/** Move `activePlayer` on, honouring extra turns and skipping eliminated seats. */
export function advanceTurn(state: GameState): GameState {
  const s = state;
  const current = s.activePlayer;
  const p = s.players[current];

  s.turn += 1;

  if (p && p.extraTurns > 0 && !p.eliminated) {
    p.extraTurns -= 1;
    appendLog(s, 'extraTurn', current, { remaining: p.extraTurns });
    return s;
  }

  const order = s.playerOrder;
  const idx = order.indexOf(current);
  for (let step = 1; step <= order.length; step++) {
    const nextIdx = (idx + step) % order.length;
    const nextId = order[nextIdx] as PlayerId;
    const np = s.players[nextId];
    if (!np || np.eliminated) continue;
    if (nextIdx <= idx) s.round += 1;
    s.activePlayer = nextId;
    return s;
  }
  // Everybody is eliminated; leave the seat where it is and let endgame handle it.
  return s;
}
