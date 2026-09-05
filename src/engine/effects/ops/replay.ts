/**
 * Replay and multiplier ops: playCard, replayPlayedThisTurn, multiplyNext.
 *
 * B41 / B74: every "double the next card" route writes the same NextCardMod, so
 * Solar Eclipse, KY's Chosen and the Five Elements rule all land on one hook.
 * SB-24: a card may not be replayed by an effect it is itself resolving inside.
 */
import type {
  CardDefinition,
  GameState,
  InstanceId,
  QueuedEffect,
  StatKey,
} from '@engine/types';
import { childItems, log, pushFront, tryGetCard } from '../runtime';
import { effectiveStats } from '@engine/systems/buff.js';
import { hasKeyword } from '@engine/systems/keywords.js';
import { resolveTargets, type OpResult, type Pre } from '../opkit';
import { drawCards, moveInstance, trashInstance } from '@engine/core/zones';
import { fireEvent } from '../triggers';
import { matchesFilter } from '../select';

const GUARD_PREFIX = '__playing:';

function multiplierFor(s: GameState, player: string, base: number, stats: StatKey[] | undefined): number {
  const p = s.players[player];
  if (!p) return base;
  let mult = base;
  for (let k = 0; k < p.nextCardMods.length; k += 1) {
    const mod = p.nextCardMods[k];
    if (!mod || typeof mod.multiply !== 'number') continue;
    if (mod.appliesTo !== undefined && mod.appliesTo !== 'play') continue;
    mult *= mod.multiply;
    const uses = typeof mod.uses === 'number' ? mod.uses : 1;
    if (uses <= 1) {
      p.nextCardMods.splice(k, 1);
    } else {
      mod.uses = uses - 1;
    }
    break;
  }
  return mult;
}

function applyStatLine(
  s: GameState,
  item: QueuedEffect,
  q: QueuedEffect[],
  player: string,
  iid: InstanceId,
  mult: number,
): void {
  const p = s.players[player];
  if (!p) return;
  const stats = effectiveStats(s, iid);
  const scale = (n: number): number => {
    const v = n * mult;
    return v < 0 ? Math.ceil(v) : Math.floor(v);
  };
  if (typeof stats.money === 'number') p.money += scale(stats.money);
  if (typeof stats.buys === 'number') p.buys += scale(stats.buys);
  if (typeof stats.actions === 'number') p.actions += scale(stats.actions);
  if (typeof stats.vp === 'number') p.vp += scale(stats.vp);
  if (typeof stats.prophet === 'number') p.prophet = Math.max(0, p.prophet + scale(stats.prophet));
  if (typeof stats.cards === 'number' && stats.cards > 0) drawCards(s, player, scale(stats.cards));
}

/**
 * Resolve one card as if it had just been played: stat line, effects, triggers.
 * `moveToPlay` is false for replays of a card already sitting in play.
 */
export function resolveCardPlay(
  s: GameState,
  item: QueuedEffect,
  q: QueuedEffect[],
  iid: InstanceId,
  moveToPlay: boolean,
): boolean {
  const i = s.instances[iid];
  if (!i) return false;
  const guard = GUARD_PREFIX + iid;
  if (item.vars[guard]) {
    log(s, 'replayCycleBlocked', { iid, defId: i.defId }, item.player);
    return false;
  }
  const def: CardDefinition | null = tryGetCard(i.defId);
  if (!def) return false;

  const player = i.owner ?? item.player;
  const p = s.players[player];
  if (!p) return false;

  if (moveToPlay) {
    moveInstance(s, iid, player, 'play');
    i.playedOnTurn = s.turn;
    p.playedThisTurn.push(iid);
    p.combo += 1;
    const prior = typeof p.playCounts[i.defId] === 'number' ? p.playCounts[i.defId] : 0;
    p.playCounts[i.defId] = prior + 1;
  }

  const mult = multiplierFor(s, player, item.multiplier > 0 ? item.multiplier : 1, undefined);
  applyStatLine(s, item, q, player, iid, mult);

  const body = def.effects.concat(i.extraEffects);
  if (body.length > 0) {
    pushFront(
      q,
      childItems(item, body, {
        player,
        sourceIid: iid,
        multiplier: mult,
        vars: { ...item.vars, [guard]: 1 },
      }),
    );
  }

  log(s, 'playCard', { iid, defId: i.defId, multiplier: mult, replay: !moveToPlay }, player);
  fireEvent(s, q, item, 'onPlay', iid, player);
  fireEvent(s, q, item, 'onOpponentPlay', iid, player);
  return true;
}

export function opPlayCard(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'playCard') return 'ok';

  const sel = node.randomTargets ? { ...node.target, pick: 'random' as const } : node.target;
  const targets = resolveTargets(s, item, q, sel, pre, 'Play a card');
  if (targets === null) return 'suspend';

  for (const iid of targets) {
    const i = s.instances[iid];
    if (!i) continue;
    const alreadyInPlay = i.zone === 'play';
    const played = resolveCardPlay(s, item, q, iid, !alreadyInPlay);
    if (!played) continue;
    if (node.thenTrash) trashInstance(s, iid);
    else if (hasKeyword(s, iid, 'Flimsy') && !hasKeyword(s, iid, 'Indestructible')) {
      trashInstance(s, iid);
    }
  }
  return 'ok';
}

/** Misery / Around the World: re-run everything played this turn. */
export function opReplayPlayedThisTurn(s: GameState, item: QueuedEffect, q: QueuedEffect[]): OpResult {
  const node = item.node;
  if (node.op !== 'replayPlayedThisTurn') return 'ok';
  const p = s.players[item.player];
  if (!p) return 'ok';

  const targets = p.playedThisTurn
    .slice()
    .filter((iid) => iid !== item.sourceIid && matchesFilter(s, iid, node.filter));

  for (const iid of targets) {
    resolveCardPlay(s, item, q, iid, false);
    if (node.thenTrash) trashInstance(s, iid);
  }
  log(s, 'replayPlayedThisTurn', { count: targets.length }, item.player);
  return 'ok';
}

/** B41: doubles the next card played's stat output, once, then clears. */
export function opMultiplyNext(s: GameState, item: QueuedEffect): OpResult {
  const node = item.node;
  if (node.op !== 'multiplyNext') return 'ok';
  const p = s.players[item.player];
  if (!p) return 'ok';
  const uses = typeof node.count === 'number' && node.count > 0 ? Math.floor(node.count) : 1;
  p.nextCardMods.push({
    multiply: node.factor,
    multiplyStats: node.stats,
    appliesTo: 'play',
    uses,
  });
  log(s, 'multiplyNext', { factor: node.factor, uses, stats: node.stats ?? null }, item.player);
  return 'ok';
}
