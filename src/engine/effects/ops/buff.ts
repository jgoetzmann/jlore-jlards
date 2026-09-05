/**
 * Buff / Nerf / Upgrade. The arithmetic belongs to `applyBuff` in
 * `@engine/systems`; these ops decide scope and how many times to call it.
 *
 * B69: a random buff picks uniformly from the five buffable stats and never
 * picks prophet. B70: buffing a stat printed as 0 adds the line.
 */
import type { GameState, InstanceId, QueuedEffect, StatKey } from '@engine/types';
import { BUFFABLE_STATS } from '@engine/types';
import { applyBuff } from '@engine/systems';
import { bumpCounter, log } from '../runtime';
import { evalAmount } from '../evaluate';
import {
  commitRng,
  ctxFor,
  resolvePiles,
  resolveTargets,
  takeRng,
  type OpResult,
  type Pre,
} from '../opkit';
import { isPileSelector } from '../select';
import { fireEvent } from '../triggers';

function callApplyBuff(
  s: GameState,
  scope: 'instance' | 'allCopies' | 'pile',
  target: string,
  delta: 1 | -1,
  stat: StatKey | null,
): boolean {
  const rng = takeRng(s);
  try {
    const next = applyBuff(s, scope, target, delta, stat, rng);
    commitRng(s, rng);
    if (next && next !== s) {
      for (const key of Object.keys(next) as (keyof GameState)[]) {
        (s as unknown as Record<string, unknown>)[key as string] = (next as unknown as Record<string, unknown>)[
          key as string
        ];
      }
    }
    return true;
  } catch {
    commitRng(s, rng);
    log(s, 'buffFailed', { scope, target, delta, stat }, null);
    return false;
  }
}

function applyMany(
  s: GameState,
  item: QueuedEffect,
  q: QueuedEffect[],
  scope: 'instance' | 'allCopies' | 'pile',
  target: string,
  delta: 1 | -1,
  stat: StatKey | null,
  times: number,
): void {
  for (let k = 0; k < times; k += 1) callApplyBuff(s, scope, target, delta, stat);
  log(s, delta > 0 ? 'buff' : 'nerf', { scope, target, stat, times }, item.player);
  if (scope === 'instance') fireEvent(s, q, item, 'onBuff', target, item.player);
}

function runBuffNode(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre: Pre | undefined, delta: 1 | -1): OpResult {
  const node = item.node;
  if (node.op !== 'buff' && node.op !== 'nerf') return 'ok';
  const ctx = ctxFor(item);
  const amount = node.amount === undefined ? 1 : Math.max(1, Math.floor(Math.abs(evalAmount(s, node.amount, ctx))));
  const repeats = node.times === undefined ? 1 : Math.max(0, Math.floor(evalAmount(s, node.times, ctx)));
  const times = amount * repeats;
  const stat: StatKey | null = node.stat ?? null;

  if (times === 0) return 'ok';

  if (node.scope === 'nextPlayed') {
    const p = s.players[item.player];
    if (p) {
      p.nextCardMods.push(
        delta > 0
          ? { buffTimes: times, appliesTo: 'play', uses: 1 }
          : { nerfTimes: times, appliesTo: 'play', uses: 1 },
      );
      log(s, delta > 0 ? 'buffNextPlayed' : 'nerfNextPlayed', { times }, item.player);
    }
    return 'ok';
  }

  if (node.scope === 'self') {
    if (!item.sourceIid) return 'ok';
    applyMany(s, item, q, 'instance', item.sourceIid, delta, stat, times);
    return 'ok';
  }

  if (node.scope === 'pile') {
    const piles = resolvePiles(s, item, q, isPileSelector(node.target) ? node.target : undefined, pre, 'Buff a pile');
    if (piles === null) return 'suspend';
    for (const pileId of piles) applyMany(s, item, q, 'pile', pileId, delta, stat, times);
    return 'ok';
  }

  // instance / allCopies both start from a card selector.
  const sel = isPileSelector(node.target) ? undefined : node.target;
  const targets = resolveTargets(s, item, q, sel as Parameters<typeof resolveTargets>[3], pre, delta > 0 ? 'Buff' : 'Nerf');
  if (targets === null) return 'suspend';

  const iids: InstanceId[] = targets.length > 0 ? targets : item.sourceIid ? [item.sourceIid] : [];
  if (node.scope === 'allCopies') {
    const seen = new Set<string>();
    for (const iid of iids) {
      const i = s.instances[iid];
      if (!i || seen.has(i.defId)) continue;
      seen.add(i.defId);
      applyMany(s, item, q, 'allCopies', i.defId, delta, stat, times);
    }
    return 'ok';
  }

  for (const iid of iids) applyMany(s, item, q, 'instance', iid, delta, stat, times);
  return 'ok';
}

export function opBuff(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  return runBuffNode(s, item, q, pre, 1);
}

export function opNerf(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  return runBuffNode(s, item, q, pre, -1);
}

/** Relics accumulate permanent per-instance stat upgrades. */
export function opUpgradeRelic(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'upgradeRelic') return 'ok';
  const ctx = ctxFor(item);
  const amount = node.amount === undefined ? 1 : Math.max(1, Math.floor(evalAmount(s, node.amount, ctx)));

  const sel = node.target ?? { self: true };
  const targets = resolveTargets(s, item, q, sel, pre, 'Upgrade a Relic');
  if (targets === null) return 'suspend';
  const iids = targets.length > 0 ? targets : item.sourceIid ? [item.sourceIid] : [];

  for (const iid of iids) {
    let stat: StatKey | null;
    if (node.stat === 'random' || node.stat === undefined) {
      const rng = takeRng(s);
      stat = rng.pick(BUFFABLE_STATS);
      commitRng(s, rng);
    } else if (node.stat === 'all') {
      stat = null;
      for (const k of BUFFABLE_STATS) applyMany(s, item, q, 'instance', iid, 1, k, amount);
      bumpCounter(s, iid, 'upgrades', amount);
      continue;
    } else {
      stat = node.stat;
    }
    applyMany(s, item, q, 'instance', iid, 1, stat, amount);
    bumpCounter(s, iid, 'upgrades', amount);
    log(s, 'upgradeRelic', { iid, stat, amount }, item.player);
  }
  return 'ok';
}
