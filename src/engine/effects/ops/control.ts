/**
 * Control flow: conditional, repeat, forEach, random, sequence.
 *
 * Sub-effects go on the *front* of the queue so a node's body finishes before
 * the next sibling starts, which is what card text means by "then".
 */
import type { GameState, QueuedEffect } from '@engine/types';
import { childItems, log, pushFront } from '../runtime';
import { evalAmount, evalCondition } from '../evaluate';
import { commitRng, ctxFor, resolveTargets, takeRng, type OpResult, type Pre } from '../opkit';

/** B34: `{combo:N}` is handled inside evalCondition. */
export function opConditional(s: GameState, item: QueuedEffect, q: QueuedEffect[]): OpResult {
  const node = item.node;
  if (node.op !== 'conditional') return 'ok';
  const ctx = ctxFor(item);
  const passed = evalCondition(s, node.if, ctx);
  const body = passed ? node.then : node.else ?? [];
  log(s, 'conditional', { passed, branch: passed ? 'then' : 'else' }, item.player);
  if (body.length > 0) pushFront(q, childItems(item, body));
  return 'ok';
}

/** B36: run the body `times` times. */
export function opRepeat(s: GameState, item: QueuedEffect, q: QueuedEffect[]): OpResult {
  const node = item.node;
  if (node.op !== 'repeat') return 'ok';
  const ctx = ctxFor(item);
  const raw = Math.floor(evalAmount(s, node.times, ctx));
  const budget = Math.max(0, s.config.effectNodeBudget - s.nodesResolvedThisTurn);
  const bodyLen = Math.max(1, node.effects.length);
  const times = Math.max(0, Math.min(raw, Math.ceil(budget / bodyLen) + 1));
  if (times === 0 || node.effects.length === 0) return 'ok';

  const built: QueuedEffect[] = [];
  for (let k = 0; k < times; k += 1) {
    built.push(...childItems(item, node.effects, { vars: { ...item.vars, x: k } }));
  }
  pushFront(q, built);
  log(s, 'repeat', { times }, item.player);
  return 'ok';
}

/** B36: run the body once per selected instance, bound as the source. */
export function opForEach(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'forEach') return 'ok';
  const targets = resolveTargets(s, item, q, node.over, pre, 'Choose cards');
  if (targets === null) return 'suspend';
  if (targets.length === 0 || node.effects.length === 0) return 'ok';

  const built: QueuedEffect[] = [];
  targets.forEach((iid, idx) => {
    built.push(
      ...childItems(item, node.effects, {
        sourceIid: iid,
        vars: { ...item.vars, x: idx },
      }),
    );
  });
  pushFront(q, built);
  log(s, 'forEach', { count: targets.length }, item.player);
  return 'ok';
}

/**
 * B35: weighted, seeded, reproducible.
 * B120: a branch's `displayAs` becomes the instance's displayTextOverride, so
 * two entries can read identically to the table and resolve differently.
 */
export function opRandom(s: GameState, item: QueuedEffect, q: QueuedEffect[]): OpResult {
  const node = item.node;
  if (node.op !== 'random') return 'ok';
  const branches = (node.branches ?? []).filter((b) => b && typeof b.weight === 'number' && b.weight > 0);
  if (branches.length === 0) return 'ok';

  const rng = takeRng(s);
  const chosen =
    branches.length === 1
      ? branches[0]
      : rng.weighted(branches.map((b) => ({ item: b, weight: b.weight })));
  commitRng(s, rng);

  const index = node.branches.indexOf(chosen);
  if (chosen.displayAs && item.sourceIid) {
    const i = s.instances[item.sourceIid];
    if (i) i.displayTextOverride = chosen.displayAs;
  }
  log(
    s,
    'random',
    { index, displayAs: chosen.displayAs ?? null, branches: node.branches.length },
    item.player,
  );

  if (chosen.effects.length > 0) pushFront(q, childItems(item, chosen.effects));
  return 'ok';
}

export function opSequence(s: GameState, item: QueuedEffect, q: QueuedEffect[]): OpResult {
  const node = item.node;
  if (node.op !== 'sequence') return 'ok';
  if (node.effects.length === 0) return 'ok';
  pushFront(q, childItems(item, node.effects));
  return 'ok';
}
