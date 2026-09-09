/**
 * Playing a card.
 *
 * B4  Resources cost no Action; Actions cost 1.
 * B18 Playing with no Actions left is rejected, state unchanged.
 * B10 Flimsy trashes on play.
 * B11 Temporary trashes on play (and on discard, see zones.ts).
 * B12 Indestructible beats both: the card goes to GY instead.
 * B64 Per-player per-defId play counts persist for the whole match.
 * B71 The combo counter counts cards played this turn.
 * B72/B73 Big Action N costs N Actions and cannot be played with fewer.
 */

import { makeRng } from '@engine/rng';
import { applyBuff } from '@engine/systems/buff.js';
import { matchesFilter } from '@engine/effects';
import type {
  EffectNode,
  GameState,
  InstanceId,
  Keyword,
  NextCardMod,
  PlayerId,
  StatKey,
  Stats,
} from '@engine/types';
import { bigActionCost, effectiveStats, elementMultiplierFor, hasKeyword } from '@engine/systems';
import { appendLog } from './log.js';
import {
  makeContext,
  fireFieldTriggers,
  fireInstanceTriggers,
  fireOwnedTriggers,
  runEffects,
} from './triggers.js';
import { defOfInstance, drawCards, moveInstance, safeDef, trashInstance } from './zones.js';
import { questProgress } from '@engine/meta';

export interface PlayOptions {
  /** Skip the Action cost (Play on Draw, Play on Buy, replay effects). */
  free?: boolean;
  depth?: number;
  /** Extra multiplier stacked on top of any pending NextCardMod multiplier. */
  multiplier?: number;
}

// ---------------------------------------------------------------------------
// Costing and legality
// ---------------------------------------------------------------------------

/** B4 + B72: 0 for a non-Action card, otherwise the Big Action value (default 1). */
export function actionCostOf(state: GameState, iid: InstanceId): number {
  const def = defOfInstance(state, iid);
  if (!def.types.includes('Action')) return 0;
  let n: number;
  try {
    n = bigActionCost(state, iid);
  } catch {
    n = def.bigAction ?? 1;
  }
  if (!Number.isFinite(n)) n = def.bigAction ?? 1;
  return Math.max(0, Math.floor(n));
}

/**
 * The single legality gate. `legalActions` and `reduce` both call this, which
 * is what makes B25 true by construction.
 */
export function canPlayCard(state: GameState, player: PlayerId, iid: InstanceId): boolean {
  if (state.ended) return false;
  if (state.pending) return false;
  if (state.activePlayer !== player) return false;
  const p = state.players[player];
  if (!p || p.eliminated) return false;
  const inst = state.instances[iid];
  if (!inst) return false;
  if (inst.owner !== player) return false;
  if (inst.zone !== 'hand') return false;
  if (!p.hand.includes(iid)) return false;
  return p.actions >= actionCostOf(state, iid);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function addProphet(state: GameState, player: PlayerId, amount: number): void {
  const p = state.players[player];
  if (!p) return;
  p.prophet += amount;
  // B60: Prophet is clamped at 0, and never resets between turns.
  if (p.prophet < 0) p.prophet = 0;
}

/**
 * Apply a stat line to a player. Printed VP is deliberately NOT added to the
 * running `player.vp` - B17 scores printed VP off the whole deck at game end,
 * and adding it here would double count every Tix in the pile.
 */
export function applyStats(
  state: GameState,
  player: PlayerId,
  stats: Stats,
  multiplier = 1,
  multiplyStats?: StatKey[],
  depth = 0,
): GameState {
  const p = state.players[player];
  if (!p) return state;
  const mult = (k: StatKey): number =>
    !multiplyStats || multiplyStats.includes(k) ? Math.max(0, multiplier) : 1;

  if (stats.money) p.money += stats.money * mult('money');
  if (stats.buys) p.buys += stats.buys * mult('buys');
  if (stats.actions) p.actions += stats.actions * mult('actions');
  if (stats.prophet) addProphet(state, player, stats.prophet * mult('prophet'));

  let s = state;
  if (stats.cards) {
    const n = stats.cards * mult('cards');
    if (n > 0) {
      const drawn = drawCards(s, player, n);
      // B.4 floors 3a and 4a count cards drawn (cumulative and per turn).
      if (drawn.length > 0) {
        try {
          s = questProgress(s, player, 'draw', drawn.length) ?? s;
        } catch {
          /* meta slice unavailable */
        }
      }
      s = resolvePlayOnDraw(s, player, drawn, depth + 1);
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Next-card modifiers
// ---------------------------------------------------------------------------

interface ResolvedMods {
  multiplier: number;
  multiplyStats?: StatKey[];
  grantKeywords: Keyword[];
  grantSubtypes: string[];
  appendEffects: EffectNode[];
  buffTimes: number;
  nerfTimes: number;
  buffStat: StatKey | null;
  absorbInto: InstanceId | null;
  bind: NextCardMod['bind'] | null;
}

function emptyMods(): ResolvedMods {
  return {
    multiplier: 1,
    grantKeywords: [],
    grantSubtypes: [],
    appendEffects: [],
    buffTimes: 0,
    nerfTimes: 0,
    buffStat: null,
    absorbInto: null,
    bind: null,
  };
}

/**
 * Consume every pending modifier that applies to a play. B41/B74: multiplyNext
 * routes through here, once, and then the modifier is gone.
 */
export function consumePlayMods(
  state: GameState,
  player: PlayerId,
  iid?: InstanceId,
): ResolvedMods {
  const p = state.players[player];
  const out = emptyMods();
  if (!p) return out;
  const keep: NextCardMod[] = [];
  for (const mod of p.nextCardMods) {
    const applies = mod.appliesTo === undefined || mod.appliesTo === 'play' || mod.appliesTo === 'action';
    if (!applies) {
      keep.push(mod);
      continue;
    }
    // A filtered modifier waits for a card it actually names. Without this,
    // "the next Resource you play" is spent by whatever you play first, so
    // Shining Kit's buff went to a card the doc row does not cover.
    if (mod.filter && iid && !matchesFilter(state, iid, mod.filter)) {
      keep.push(mod);
      continue;
    }
    if (mod.multiply && mod.multiply > 0) {
      out.multiplier *= mod.multiply;
      if (mod.multiplyStats) out.multiplyStats = [...(out.multiplyStats ?? []), ...mod.multiplyStats];
    }
    if (mod.grantKeyword) out.grantKeywords.push(mod.grantKeyword);
    if (mod.grantSubtype) out.grantSubtypes.push(mod.grantSubtype);
    if (mod.appendEffects) out.appendEffects.push(...mod.appendEffects);
    if (mod.buffTimes) out.buffTimes += mod.buffTimes;
    if (mod.nerfTimes) out.nerfTimes += mod.nerfTimes;
    if (mod.buffStat) out.buffStat = mod.buffStat;
    if (mod.absorbInto) out.absorbInto = mod.absorbInto;
    if (mod.bind) out.bind = mod.bind;
    const uses = (mod.uses ?? 1) - 1;
    if (uses > 0) keep.push({ ...mod, uses });
  }
  p.nextCardMods = keep;
  return out;
}

// ---------------------------------------------------------------------------
// Play on Draw
// ---------------------------------------------------------------------------

/**
 * SB-35: Play-on-Draw cascades are capped by config.recursionDepth, and a card
 * may not re-trigger its own Play-on-Draw inside one chain.
 */
export function resolvePlayOnDraw(
  state: GameState,
  player: PlayerId,
  drawn: InstanceId[],
  depth: number,
): GameState {
  if (drawn.length === 0) return state;
  if (depth > state.config.recursionDepth) return state;
  let s = state;
  for (const iid of drawn) {
    const inst = s.instances[iid];
    if (!inst || inst.zone !== 'hand') continue;
    if (!hasKeyword(s, iid, 'PlayOnDraw')) continue;
    const guard = inst.counters['podChain'] ?? 0;
    if (guard > 0) continue;
    inst.counters['podChain'] = 1;
    s = fireInstanceTriggers(s, 'onDraw', player, iid, depth);
    s = playCard(s, player, iid, { free: true, depth });
    const after = s.instances[iid];
    if (after) delete after.counters['podChain'];
    if (s.pending) break;
  }
  return s;
}

// ---------------------------------------------------------------------------
// The play itself
// ---------------------------------------------------------------------------

export function playCard(
  state: GameState,
  player: PlayerId,
  iid: InstanceId,
  opts: PlayOptions = {},
): GameState {
  let s = state;
  const p = s.players[player];
  const inst = s.instances[iid];
  if (!p || !inst) return s;

  const def = safeDef(inst.defId);
  const depth = opts.depth ?? 0;

  // 1. Pay the Action cost.
  if (!opts.free) {
    const cost = actionCostOf(s, iid);
    if (cost > p.actions) return s; // B18/B73 - caller should have gated this.
    p.actions -= cost;
  }

  // 2. Move to the play area and record the play.
  moveInstance(s, iid, player, 'play', 'bottom');
  inst.playedOnTurn = s.turn; // B9
  p.playedThisTurn.push(iid);
  p.combo += 1; // B71
  // B.4 floor 2a counts plays.
  try {
    s = questProgress(s, player, 'play', 1) ?? s;
  } catch {
    /* meta slice unavailable */
  }
  p.playCounts[inst.defId] = (p.playCounts[inst.defId] ?? 0) + 1; // B64
  inst.counters['playCount'] = (inst.counters['playCount'] ?? 0) + 1;
  const variant = s.variants[inst.defId];
  if (variant?.element) p.lastElement = variant.element;
  if (!p.codex.includes(inst.defId)) p.codex.push(inst.defId); // B92

  appendLog(s, 'play', player, {
    iid,
    defId: inst.defId,
    combo: p.combo,
    actionsLeft: p.actions,
  });

  // 3. Consume pending next-card modifiers (B41, B74).
  const mods = consumePlayMods(s, player, iid);
  for (const kw of mods.grantKeywords) {
    if (!inst.addedKeywords.includes(kw)) inst.addedKeywords.push(kw);
  }
  // A granted subtype — RCT CN makes the next card played a CN card, which is
  // a tribe, not a keyword.
  for (const sub of mods.grantSubtypes) {
    if (!inst.addedSubtypes) inst.addedSubtypes = [];
    if (!inst.addedSubtypes.includes(sub)) inst.addedSubtypes.push(sub);
  }
  // `buffTimes` / `nerfTimes` were collected here and then never applied, so
  // Performance Enhancing Cookie and Crumb, Shining Kit and Quick Patch all
  // resolved to their stat lines and no buff. Applied BEFORE the stat step, so
  // the buff this card just received is part of what it pays out.
  if (mods.buffTimes > 0 || mods.nerfTimes > 0) {
    const rng = makeRng(s.seed, s.rngCursor);
    for (let k = 0; k < mods.buffTimes; k += 1) {
      s = applyBuff(s, 'instance', iid, 1, mods.buffStat ?? null, rng);
    }
    for (let k = 0; k < mods.nerfTimes; k += 1) {
      s = applyBuff(s, 'instance', iid, -1, mods.buffStat ?? null, rng);
    }
    s.rngCursor = rng.cursor();
  }
  // B74/B75: a printed stat line is produced here, not by `{op:'gain'}`, so the
  // Five Elements multiplier has to be composed in at this point or a card whose
  // whole output is `stats` (every Resource) never sees it. Called after the
  // element has been pushed onto `playedThisTurn`, so the pairing reads the
  // previous card. `elementMultiplierFor` returns 1 unless the anomaly is live.
  const multiplier = Math.max(
    0,
    mods.multiplier * (opts.multiplier ?? 1) * elementMultiplierFor(s, player, iid),
  );

  // 4. Stat line.
  s = applyStats(s, player, effectiveStats(s, iid), multiplier, mods.multiplyStats, depth);

  // 5. Effect body: printed effects, absorbed effects, appended modifier effects.
  const body: EffectNode[] = [...def.effects, ...inst.extraEffects, ...mods.appendEffects];
  const ctx = makeContext(player, iid, depth, multiplier, {});
  if (body.length) s = runEffects(s, body, ctx);

  // 6. Hivemind-style absorption: the source keeps this card's effects forever.
  if (mods.absorbInto) {
    const host = s.instances[mods.absorbInto];
    if (host) host.extraEffects.push(...def.effects);
  }

  // 7. onPlay triggers on the card itself and on the Field (Blessed by Raza
  // refreshes on every Action), then table-wide onOpponentPlay.
  s = fireInstanceTriggers(s, 'onPlay', player, iid, depth);
  s = fireFieldTriggers(s, 'onPlay', player, depth);
  for (const other of s.playerOrder) {
    if (other === player) continue;
    s = fireOwnedTriggers(s, 'onOpponentPlay', other, depth);
  }

  // 8. Cleanup: Flimsy / Temporary trash on play, unless Indestructible (B10-B12).
  const live = s.instances[iid];
  if (live && live.zone === 'play') {
    const flimsy = hasKeyword(s, iid, 'Flimsy');
    const temporary = hasKeyword(s, iid, 'Temporary');
    if (flimsy || temporary) {
      if (hasKeyword(s, iid, 'Indestructible')) {
        // B12: Indestructible wins, the card goes to GY instead of the trash.
        moveInstance(s, iid, player, 'gy');
        appendLog(s, 'playCleanup', player, { iid, to: 'gy', reason: 'indestructible' });
      } else {
        trashInstance(s, iid);
        appendLog(s, 'playCleanup', player, {
          iid,
          to: 'trash',
          reason: flimsy ? 'flimsy' : 'temporary',
        });
      }
    }
  }

  return s;
}
