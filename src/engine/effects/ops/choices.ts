/**
 * The three ops that need a human: discover, choose, selectCards.
 *
 * Each of them writes `state.pending` and hands the rest of the queue back to
 * the interpreter, which parks it on `state.queue` (B30). Nothing here calls a
 * callback; a choice is state.
 */
import type {
  CardDefId,
  EffectNode,
  GameState,
  InstanceId,
  Prompt,
  PromptOption,
  QueuedEffect,
} from '@engine/types';
import { log, tryGetCard } from '../runtime';
import { evalAmount } from '../evaluate';
import {
  commitRng,
  ctxFor,
  optionForDef,
  optionForInstance,
  payloadFrom,
  promptId,
  suspend,
  takeRng,
  type OpResult,
  type Pre,
} from '../opkit';
import { samplePool } from '../pools';
import { selectInstancesWith } from '../select';

export const DISCOVERED_SENTINEL = '$discovered';
export const SELECTED_SENTINEL = '$selected';

/** Deep-copy an effect tree, swapping every sentinel string for `defId`. */
export function substituteDefId(nodes: readonly EffectNode[], defId: CardDefId): EffectNode[] {
  const swap = (v: unknown): unknown => {
    if (typeof v === 'string') return v === DISCOVERED_SENTINEL || v === SELECTED_SENTINEL ? defId : v;
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object') {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src)) out[k] = swap(src[k]);
      return out;
    }
    return v;
  };
  return swap(nodes as unknown) as EffectNode[];
}

/** What a Discover does with a chosen card when the author wrote no `then`. */
export function defaultDiscoverThen(defId: CardDefId): EffectNode[] {
  return [{ op: 'createCard', defId, to: 'hand' }];
}

/**
 * B31 / B32 / B33: sample `count` distinct pool-legal options, offer them, and
 * suspend until `pick` come back.
 */
export function opDiscover(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'discover') return 'ok';

  if (pre && pre.defIds) {
    pushChosen(s, item, q, pre.defIds, node.then ?? []);
    return 'ok';
  }

  const ctx = ctxFor(item);
  const count = typeof node.count === 'number' && node.count > 0 ? Math.floor(node.count) : 3;
  const pick = typeof node.pick === 'number' && node.pick > 0 ? Math.floor(node.pick) : 1;

  const rng = takeRng(s);
  const offered = samplePool(s, node.pool, ctx, rng, count);
  commitRng(s, rng);

  if (offered.length === 0) {
    log(s, 'discoverEmpty', { pool: node.pool }, item.player);
    return 'ok';
  }

  log(s, 'discoverOffered', { defIds: offered, pick }, item.player);

  if (offered.length <= pick) {
    pushChosen(s, item, q, offered, node.then ?? []);
    return 'ok';
  }

  const options: PromptOption[] = offered.map((defId, idx) =>
    optionForDef(defId, idx, node.displayAs),
  );

  const prompt: Prompt = {
    id: promptId(s),
    type: 'discover',
    player: item.player,
    prompt: node.prompt ?? 'Discover',
    options,
    min: pick,
    max: pick,
    then: node.then ?? [],
    ctx: payloadFrom(item, 'discover', { node, then: node.then ?? [], perChoice: true }),
    defaultKeys: options.slice(0, pick).map((o) => o.key),
  };
  return suspend(s, q, prompt);
}

/** Run the discover continuation once per chosen definition. */
export function pushChosen(
  s: GameState,
  item: QueuedEffect,
  q: QueuedEffect[],
  defIds: CardDefId[],
  then: readonly EffectNode[],
): void {
  const built: QueuedEffect[] = [];
  defIds.forEach((defId, idx) => {
    const body = then.length > 0 ? substituteDefId(then, defId) : defaultDiscoverThen(defId);
    for (const n of body) {
      built.push({
        node: n,
        player: item.player,
        sourceIid: item.sourceIid,
        depth: item.depth + 1,
        multiplier: item.multiplier,
        vars: { ...item.vars, x: idx },
      });
    }
    log(s, 'discoverPicked', { defId }, item.player);
  });
  if (built.length > 0) q.unshift(...built);
}

export function opChoose(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'choose') return 'ok';
  const options = node.options ?? [];
  if (options.length === 0) return 'ok';

  if (pre && pre.keys) {
    const built: QueuedEffect[] = [];
    for (const key of pre.keys) {
      const idx = Number(key);
      const chosen = Number.isFinite(idx) ? options[idx] : undefined;
      if (!chosen) continue;
      for (const n of chosen.effects) {
        built.push({
          node: n,
          player: item.player,
          sourceIid: item.sourceIid,
          depth: item.depth + 1,
          multiplier: item.multiplier,
          vars: { ...item.vars },
        });
      }
      log(s, 'chosen', { label: chosen.label }, item.player);
    }
    if (built.length > 0) q.unshift(...built);
    return 'ok';
  }

  if (options.length === 1) {
    const built: QueuedEffect[] = options[0].effects.map((n) => ({
      node: n,
      player: item.player,
      sourceIid: item.sourceIid,
      depth: item.depth + 1,
      multiplier: item.multiplier,
      vars: { ...item.vars },
    }));
    if (built.length > 0) q.unshift(...built);
    return 'ok';
  }

  const rng = takeRng(s);
  const chooser = node.who === 'eachOpponent' || node.who === 'randomOpponent' || node.who === 'chosenOpponent'
    ? pickChooser(s, item, rng)
    : item.player;
  if (node.who === 'randomOpponent') commitRng(s, rng);

  const prompt: Prompt = {
    id: promptId(s),
    type: 'choose',
    player: chooser,
    prompt: 'Choose one',
    options: options.map((o, i) => ({ key: String(i), label: o.label })),
    min: 1,
    max: 1,
    then: [],
    ctx: payloadFrom(item, 'choose', { node }),
    defaultKeys: ['0'],
  };
  return suspend(s, q, prompt);
}

function pickChooser(s: GameState, item: QueuedEffect, rng: ReturnType<typeof takeRng>): string {
  const opps = s.playerOrder.filter((id) => id !== item.player && !(s.players[id]?.eliminated ?? false));
  if (opps.length === 0) return item.player;
  return rng.pick(opps);
}

/**
 * selectCards: pick between `min` and `max` from a selector, then run `then`
 * once per selection with the selection bound as the source instance, so
 * `{self:true}` inside `then` means "the card I just picked".
 */
export function opSelectCards(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'selectCards') return 'ok';
  const ctx = ctxFor(item);

  if (pre && pre.iids) {
    runThenPerInstance(s, item, q, pre.iids, node.then ?? []);
    return 'ok';
  }

  const candidates = selectInstancesWith(s, { ...node.from, pick: undefined, count: undefined }, ctx, null);
  if (candidates.length === 0) return 'ok';

  const min = node.min === undefined ? 1 : Math.max(0, Math.floor(evalAmount(s, node.min, ctx)));
  const maxRaw = node.max === undefined ? min : Math.max(0, Math.floor(evalAmount(s, node.max, ctx)));
  const max = Math.min(candidates.length, Math.max(min, maxRaw));

  if (max === 0) return 'ok';
  if (candidates.length <= min) {
    runThenPerInstance(s, item, q, candidates, node.then ?? []);
    return 'ok';
  }

  const prompt: Prompt = {
    id: promptId(s),
    type: 'selectCards',
    player: item.player,
    prompt: 'Select cards',
    options: candidates.map((iid) => optionForInstance(s, iid)),
    min,
    max,
    then: node.then ?? [],
    ctx: payloadFrom(item, 'select', { node, then: node.then ?? [], perChoice: true }),
    defaultKeys: candidates.slice(0, min),
  };
  return suspend(s, q, prompt);
}

export function runThenPerInstance(
  s: GameState,
  item: QueuedEffect,
  q: QueuedEffect[],
  iids: InstanceId[],
  then: readonly EffectNode[],
): void {
  if (then.length === 0) return;
  const built: QueuedEffect[] = [];
  iids.forEach((iid, idx) => {
    const i = s.instances[iid];
    const body = i ? substituteDefId(then, i.defId) : then.slice();
    for (const n of body) {
      built.push({
        node: n,
        player: item.player,
        sourceIid: iid,
        depth: item.depth + 1,
        multiplier: item.multiplier,
        vars: { ...item.vars, x: idx },
      });
    }
  });
  if (built.length > 0) q.unshift(...built);
}

export function labelOfDef(defId: CardDefId): string {
  const def = tryGetCard(defId);
  return def ? def.name : defId;
}
