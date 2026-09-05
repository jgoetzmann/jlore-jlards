/**
 * The shared shape every op implementation uses, plus the suspension helper
 * that turns "this node needs a choice" into `state.pending` (B30).
 */
import type {
  EffectNode,
  GameState,
  InstanceId,
  PileId,
  Prompt,
  PromptOption,
  QueuedEffect,
  Selector,
} from '@engine/types';
import type { Rng } from '@engine/rng';
import { makeRng } from '@engine/rng';
import { contextOf, tryGetCard, type EffectContext } from './runtime';
import { selectInstancesWith, selectPilesWith } from './select';
import * as evaluateNs from './evaluate';

export type OpResult = 'ok' | 'suspend';

/** Choices already made, handed back on the resume path. */
export interface Pre {
  iids?: InstanceId[];
  pileIds?: PileId[];
  keys?: string[];
  defIds?: string[];
}

export interface ResumePayload extends Record<string, unknown> {
  mode: 'targets' | 'piles' | 'discover' | 'choose' | 'select';
  player: string;
  sourceIid: InstanceId | null;
  depth: number;
  multiplier: number;
  vars: Record<string, number>;
  node?: EffectNode;
  then?: EffectNode[];
  perChoice?: boolean;
}

export function ctxFor(item: QueuedEffect): EffectContext {
  return contextOf(item);
}

/** An rng that advances the state cursor. */
export function takeRng(s: GameState): Rng {
  const r = makeRng(s.seed, s.rngCursor);
  return r;
}

export function commitRng(s: GameState, r: Rng): void {
  s.rngCursor = r.cursor();
}

export function promptId(s: GameState): string {
  return 'pr_' + String(s.logSeq) + '_' + String(s.nodesResolvedThisTurn) + '_' + String(s.rngCursor);
}

export function optionForInstance(s: GameState, iid: InstanceId): PromptOption {
  const i = s.instances[iid];
  const def = i ? tryGetCard(i.defId) : null;
  const opt: PromptOption = {
    key: iid,
    label: def ? def.name : iid,
    iid,
  };
  if (i) opt.defId = i.defId;
  return opt;
}

export function optionForPile(s: GameState, pileId: PileId): PromptOption {
  const pile = s.shop.piles[pileId];
  let label = pileId;
  let defId: string | undefined;
  if (pile && pile.cards.length > 0) {
    const top = s.instances[pile.cards[0]];
    if (top) {
      defId = top.defId;
      const def = tryGetCard(top.defId);
      if (def) label = def.name;
    }
  }
  const opt: PromptOption = { key: pileId, label, pileId };
  if (defId) opt.defId = defId;
  return opt;
}

export function optionForDef(defId: string, index: number, displayAs?: string): PromptOption {
  const def = tryGetCard(defId);
  return {
    key: defId + '#' + String(index),
    label: displayAs ?? (def ? def.name : defId),
    defId,
  };
}

export function suspend(s: GameState, q: QueuedEffect[], prompt: Prompt): OpResult {
  s.pending = prompt;
  return 'suspend';
}

export function payloadFrom(
  item: QueuedEffect,
  mode: ResumePayload['mode'],
  extra?: Partial<ResumePayload>,
): ResumePayload {
  return {
    mode,
    player: item.player,
    sourceIid: item.sourceIid,
    depth: item.depth,
    multiplier: item.multiplier,
    vars: { ...item.vars },
    ...(extra ?? {}),
  };
}

/**
 * Resolve a target selector, suspending with a card prompt when the selector
 * asks the player to choose and there is a real decision to make.
 *
 * Returns `null` when the caller must return 'suspend'.
 */
export function resolveTargets(
  s: GameState,
  item: QueuedEffect,
  q: QueuedEffect[],
  sel: Selector | undefined,
  pre: Pre | undefined,
  promptText: string,
): InstanceId[] | null {
  if (pre && pre.iids) return pre.iids;
  if (!sel) return [];

  const ctx = ctxFor(item);

  if (sel.pick === 'choose') {
    const all = selectInstancesWith(s, { ...sel, pick: undefined, count: undefined }, ctx, null);
    if (all.length === 0) return [];
    const wantRaw = sel.count === undefined ? all.length : selectorCount(s, sel, ctx);
    const want = Math.max(0, Math.min(all.length, wantRaw));
    if (want === 0) return [];
    if (want >= all.length) return all;

    const chooser = sel.chooser === 'owner' ? ownerOf(s, all[0]) ?? item.player : item.player;
    const prompt: Prompt = {
      id: promptId(s),
      type: 'selectCards',
      player: chooser,
      prompt: promptText,
      options: all.map((iid) => optionForInstance(s, iid)),
      min: want,
      max: want,
      then: [],
      ctx: payloadFrom(item, 'targets', { node: item.node }),
      defaultKeys: all.slice(0, want),
    };
    suspend(s, q, prompt);
    return null;
  }

  const rng = takeRng(s);
  const out = selectInstancesWith(s, sel, ctx, rng);
  if (sel.pick === 'random' || sel.who === 'randomOpponent') commitRng(s, rng);
  return out;
}

function ownerOf(s: GameState, iid: InstanceId): string | null {
  const i = s.instances[iid];
  return i ? i.owner : null;
}

function selectorCount(s: GameState, sel: Selector, ctx: EffectContext): number {
  if (sel.count === undefined) return Number.MAX_SAFE_INTEGER;
  if (typeof sel.count === 'number') return Math.floor(sel.count);
  return Math.floor(evaluateNs.evalAmount(s, sel.count, ctx));
}

/** Resolve a pile selector, suspending with a pile prompt on pick:'choose'. */
export function resolvePiles(
  s: GameState,
  item: QueuedEffect,
  q: QueuedEffect[],
  sel: Parameters<typeof selectPilesWith>[1],
  pre: Pre | undefined,
  promptText: string,
): PileId[] | null {
  if (pre && pre.pileIds) return pre.pileIds;
  const ctx = ctxFor(item);

  if (sel && sel.pick === 'choose') {
    const all = selectPilesWith(s, { ...sel, pick: undefined, count: undefined }, ctx, null);
    if (all.length === 0) return [];
    const want = sel.count === undefined ? all.length : Math.max(0, Math.floor(evaluateNs.evalAmount(s, sel.count, ctx)));
    if (want === 0) return [];
    if (want >= all.length) return all;
    const prompt: Prompt = {
      id: promptId(s),
      type: 'selectPile',
      player: item.player,
      prompt: promptText,
      options: all.map((pid) => optionForPile(s, pid)),
      min: want,
      max: want,
      then: [],
      ctx: payloadFrom(item, 'piles', { node: item.node }),
      defaultKeys: all.slice(0, want),
    };
    suspend(s, q, prompt);
    return null;
  }

  const rng = takeRng(s);
  const out = selectPilesWith(s, sel, ctx, rng);
  if (sel && sel.pick === 'random') commitRng(s, rng);
  return out;
}
