/**
 * The effect interpreter.
 *
 * Nodes resolve FIFO off a queue, never off the JavaScript call stack
 * (gameplay doc §12.2). A node that needs a choice writes `state.pending` and
 * parks the rest of the queue on `state.queue`; `resumeFromPrompt` picks it up
 * when the matching `resolve` action arrives (B30).
 *
 * Two hard limits: `config.effectNodeBudget` nodes per turn (B37) and
 * `config.recursionDepth` of nesting (B38). Both fizzle and log; neither ever
 * overflows. An unknown op is logged and skipped, never thrown (B43).
 */
import type {
  Amount,
  Condition,
  EffectNode,
  GameState,
  InstanceId,
  PlayerId,
  QueuedEffect,
  Selector,
} from '@engine/types';
import { log, type EffectContext } from './runtime';
import { cloneState } from '@engine/core/clone.js';
import { evalAmount as evalAmountImpl, evalCondition as evalConditionImpl } from './evaluate';
import { selectInstances as selectInstancesImpl } from './select';
import type { OpResult, Pre, ResumePayload } from './opkit';

import { opDiscard, opDiscardDownTo, opDraw, opGain, opMill, opTrash } from './ops/cards';
import {
  opCopyCard,
  opCreateCard,
  opGainCard,
  opMoveTo,
  opRecruit,
  opReveal,
  opShuffle,
  opSortLibraryByCost,
  opTransform,
} from './ops/movement';
import { opChoose, opDiscover, opSelectCards, pushChosen } from './ops/choices';
import {
  opAddToPileTop,
  opLockPile,
  opMergePiles,
  opModifyCost,
  opReplenishPile,
  opSwapPileCosts,
  opTrashPile,
  opUnlockPile,
} from './ops/shop';
import { opActivateAura, opManifestAura } from './ops/auras';
import { opBuff, opNerf, opUpgradeRelic } from './ops/buff';
import { opDelayed, opEndTurn, opExtraTurn, opNextCardModifier } from './ops/timing';
import { opConditional, opForEach, opRandom, opRepeat, opSequence } from './ops/control';
import { opMultiplyNext, opPlayCard, opReplayPlayedThisTurn } from './ops/replay';
import {
  opAddCounter,
  opEndGame,
  opIncDoomsday,
  opNoop,
  opPlague,
  opQuestProgress,
  opRemovePlague,
  opResetCombo,
  opScoreOnCard,
  opSetKeyword,
} from './ops/misc';

export type { EffectContext };
export { selectPiles, matchesFilter, matchesDefFilter, NAMED_FILTERS } from './select';
export { buildVars } from './context';
export { samplePool, poolCandidates } from './pools';
export { evaluateExpr } from '@engine/expr';

// ---------------------------------------------------------------------------
// Exported surface (SPEC.md ## Surface)
// ---------------------------------------------------------------------------

export function evalAmount(state: GameState, amount: Amount, ctx: EffectContext): number {
  return evalAmountImpl(state, amount, ctx);
}

export function evalCondition(state: GameState, cond: Condition, ctx: EffectContext): boolean {
  return evalConditionImpl(state, cond, ctx);
}

export function selectInstances(state: GameState, sel: Selector, ctx: EffectContext): InstanceId[] {
  return selectInstancesImpl(state, sel, ctx);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function applyNode(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (!node || typeof node !== 'object' || typeof (node as { op?: unknown }).op !== 'string') {
    log(s, 'unknownOp', { node }, item.player);
    return 'ok';
  }

  switch (node.op) {
    // stats and cards
    case 'gain':
      return opGain(s, item, q);
    case 'draw':
      return opDraw(s, item, q);
    case 'mill':
      return opMill(s, item, q);
    case 'discard':
      return opDiscard(s, item, q, pre);
    case 'discardDownTo':
      return opDiscardDownTo(s, item, q);
    case 'trash':
      return opTrash(s, item, q, pre);

    // movement and creation
    case 'moveTo':
      return opMoveTo(s, item, q, pre);
    case 'createCard':
      return opCreateCard(s, item, q);
    case 'gainCard':
      return opGainCard(s, item, q, pre);
    case 'copyCard':
      return opCopyCard(s, item, q, pre);
    case 'transform':
      return opTransform(s, item, q, pre);
    case 'recruit':
      return opRecruit(s, item, q);
    case 'shuffle':
      return opShuffle(s, item, q);
    case 'sortLibraryByCost':
      return opSortLibraryByCost(s, item);
    case 'reveal':
      return opReveal(s, item, q, pre);

    // choices
    case 'discover':
      return opDiscover(s, item, q, pre);
    case 'choose':
      return opChoose(s, item, q, pre);
    case 'selectCards':
      return opSelectCards(s, item, q, pre);

    // shop
    case 'lockPile':
      return opLockPile(s, item, q, pre);
    case 'unlockPile':
      return opUnlockPile(s, item, q, pre);
    case 'modifyCost':
      return opModifyCost(s, item, q, pre);
    case 'replenishPile':
      return opReplenishPile(s, item, q, pre);
    case 'trashPile':
      return opTrashPile(s, item, q, pre);
    case 'swapPileCosts':
      return opSwapPileCosts(s, item, q, pre);
    case 'addToPileTop':
      return opAddToPileTop(s, item, q, pre);
    case 'mergePiles':
      return opMergePiles(s, item, q, pre);

    // auras
    case 'manifestAura':
      return opManifestAura(s, item, q, pre);
    case 'activateAura':
      return opActivateAura(s, item, q);

    // buff
    case 'buff':
      return opBuff(s, item, q, pre);
    case 'nerf':
      return opNerf(s, item, q, pre);
    case 'upgradeRelic':
      return opUpgradeRelic(s, item, q, pre);

    // timing
    case 'delayed':
      return opDelayed(s, item);
    case 'nextCardModifier':
      return opNextCardModifier(s, item);
    case 'endTurn':
      return opEndTurn(s, item);
    case 'extraTurn':
      return opExtraTurn(s, item);

    // control flow
    case 'conditional':
      return opConditional(s, item, q);
    case 'repeat':
      return opRepeat(s, item, q);
    case 'forEach':
      return opForEach(s, item, q, pre);
    case 'random':
      return opRandom(s, item, q);
    case 'sequence':
      return opSequence(s, item, q);

    // replay and multipliers
    case 'playCard':
      return opPlayCard(s, item, q, pre);
    case 'replayPlayedThisTurn':
      return opReplayPlayedThisTurn(s, item, q);
    case 'multiplyNext':
      return opMultiplyNext(s, item);

    // counters and misc
    case 'plague':
      return opPlague(s, item, q, pre);
    case 'removePlague':
      return opRemovePlague(s, item, q, pre);
    case 'addCounter':
      return opAddCounter(s, item, q, pre);
    case 'scoreOnCard':
      return opScoreOnCard(s, item, q, pre);
    case 'setKeyword':
      return opSetKeyword(s, item, q, pre);
    case 'resetCombo':
      return opResetCombo(s, item);
    case 'endGame':
      return opEndGame(s, item);
    case 'incDoomsday':
      return opIncDoomsday(s, item);
    case 'questProgress':
      return opQuestProgress(s, item);
    case 'noop':
      return opNoop();

    default: {
      // B43: an op the interpreter does not know is logged and skipped.
      const unknown = node as { op?: unknown };
      log(s, 'unknownOp', { op: String(unknown.op) }, item.player);
      return 'ok';
    }
  }
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/**
 * B37: the configured budget is taken literally, including 0 — a budget of 0
 * resolves nothing at all. Only a missing, negative or non-finite value falls
 * back to the default.
 */
function budget(s: GameState): number {
  const n = s.config && typeof s.config.effectNodeBudget === 'number' ? s.config.effectNodeBudget : 200;
  return Number.isFinite(n) && n >= 0 ? n : 200;
}

/**
 * B38: the boundary is exclusive. A node at exactly `recursionDepth` still
 * resolves; only something deeper than that fizzles.
 */
function maxDepth(s: GameState): number {
  const n = s.config && typeof s.config.recursionDepth === 'number' ? s.config.recursionDepth : 8;
  return Number.isFinite(n) && n >= 0 ? n : 8;
}

/** The entry depth a context resolves at, floored at 0. */
function entryDepthOf(ctx: { depth: number }): number {
  return Number.isFinite(ctx.depth) && ctx.depth > 0 ? Math.floor(ctx.depth) : 0;
}

/**
 * `depthCap` is absolute: the entry depth plus `config.recursionDepth`, so a
 * context handed in at exactly `recursionDepth` still gets its own nesting
 * allowance while nesting inside one resolution stays capped (B38).
 */
function runQueue(s: GameState, q: QueuedEffect[], depthCap: number): GameState {
  const cap = budget(s);

  while (q.length > 0) {
    if (s.pending) {
      // Suspended mid-resolution: park what is left and hand control back.
      s.queue = q.concat(s.queue);
      return s;
    }

    if (s.nodesResolvedThisTurn >= cap) {
      log(s, 'fizzle', { reason: 'effectNodeBudget', budget: cap, dropped: q.length }, s.activePlayer);
      q.length = 0;
      break;
    }

    const item = q.shift() as QueuedEffect;

    if (item.depth > depthCap) {
      log(s, 'fizzle', { reason: 'recursionDepth', depth: item.depth, cap: depthCap }, item.player);
      continue;
    }

    s.nodesResolvedThisTurn += 1;

    const result = applyNode(s, item, q);
    if (result === 'suspend') {
      s.queue = q.concat(s.queue);
      return s;
    }
  }

  // Nothing left of ours: drain anything parked earlier, if we can.
  if (!s.pending && s.queue.length > 0) {
    const parked = s.queue;
    s.queue = [];
    return runQueue(s, parked, depthCap);
  }

  return s;
}

function itemsFor(nodes: readonly EffectNode[], ctx: EffectContext): QueuedEffect[] {
  const out: QueuedEffect[] = [];
  for (const node of nodes) {
    out.push({
      node,
      player: ctx.player,
      sourceIid: ctx.sourceIid,
      depth: ctx.depth,
      multiplier: Number.isFinite(ctx.multiplier) && ctx.multiplier !== 0 ? ctx.multiplier : 1,
      vars: { ...ctx.vars },
    });
  }
  return out;
}

/**
 * Resolve `nodes` against `state`. Pure: the input state is never mutated and
 * the returned state carries the advanced rng cursor.
 */
export function resolveEffects(state: GameState, nodes: EffectNode[], ctx: EffectContext): GameState {
  const s = cloneState(state);
  if (!nodes || nodes.length === 0) return s;

  // B38: a context deeper than the cap resolves nothing and logs a fizzle. At
  // exactly the cap it still resolves, boundary included.
  const entryDepth = entryDepthOf(ctx);
  const cap = maxDepth(s);
  if (entryDepth > cap) {
    log(s, 'fizzle', { reason: 'recursionDepth', depth: entryDepth, cap }, ctx.player);
    return s;
  }

  const items = itemsFor(nodes, ctx);

  if (s.pending) {
    // A prompt is already open: everything new waits behind it.
    s.queue = s.queue.concat(items);
    return s;
  }

  return runQueue(s, items, entryDepth + cap);
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

function payloadCtx(payload: ResumePayload): EffectContext {
  return {
    player: payload.player,
    sourceIid: payload.sourceIid ?? null,
    depth: typeof payload.depth === 'number' ? payload.depth : 0,
    multiplier: typeof payload.multiplier === 'number' && payload.multiplier !== 0 ? payload.multiplier : 1,
    vars: payload.vars ?? {},
  };
}

function defIdFromKey(key: string): string {
  const at = key.lastIndexOf('#');
  return at > 0 ? key.slice(0, at) : key;
}

/**
 * Resume a suspended resolution with the player's answer (B30).
 * Unknown or empty keys fall back to the prompt's `defaultKeys`.
 */
export function resumeFromPrompt(state: GameState, keys: string[]): GameState {
  const s = cloneState(state);
  const prompt = s.pending;
  if (!prompt) return s;

  const valid = new Set(prompt.options.map((o) => o.key));
  let chosen = (keys ?? []).filter((k) => valid.has(k));
  if (chosen.length === 0) chosen = prompt.defaultKeys.filter((k) => valid.has(k));
  if (chosen.length > prompt.max) chosen = chosen.slice(0, prompt.max);

  s.pending = null;
  log(s, 'resolvePrompt', { promptId: prompt.id, keys: chosen }, prompt.player);

  const payload = prompt.ctx as unknown as ResumePayload;
  const ctx = payloadCtx(payload ?? { mode: 'choose', player: prompt.player, sourceIid: null, depth: 0, multiplier: 1, vars: {} });

  const parent: QueuedEffect = {
    node: payload && payload.node ? payload.node : { op: 'noop' },
    player: ctx.player,
    sourceIid: ctx.sourceIid,
    depth: ctx.depth,
    multiplier: ctx.multiplier,
    vars: { ...ctx.vars },
  };

  const q: QueuedEffect[] = [];

  const mode = payload ? payload.mode : 'choose';
  if (mode === 'discover') {
    const defIds = chosen.map(defIdFromKey);
    pushChosen(s, parent, q, defIds, (payload && payload.then) ?? []);
  } else if (mode === 'targets' || mode === 'select') {
    const pre: Pre = { iids: chosen };
    const result = applyNode(s, parent, q, pre);
    if (result === 'suspend') {
      s.queue = q.concat(s.queue);
      return s;
    }
  } else if (mode === 'piles') {
    const pre: Pre = { pileIds: chosen };
    const result = applyNode(s, parent, q, pre);
    if (result === 'suspend') {
      s.queue = q.concat(s.queue);
      return s;
    }
  } else {
    const pre: Pre = { keys: chosen };
    const result = applyNode(s, parent, q, pre);
    if (result === 'suspend') {
      s.queue = q.concat(s.queue);
      return s;
    }
  }

  const parked = s.queue;
  s.queue = [];
  return runQueue(s, q.concat(parked), entryDepthOf(ctx) + maxDepth(s));
}

/** Convenience for callers holding only a player and a node list. */
export function makeContext(
  player: PlayerId,
  sourceIid: InstanceId | null,
  depth = 0,
  multiplier = 1,
  vars: Record<string, number> = {},
): EffectContext {
  return { player, sourceIid, depth, multiplier, vars };
}

export default resolveEffects;
