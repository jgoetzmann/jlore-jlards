/**
 * Prompt resolution and queue draining.
 *
 * Prompts are state, never callbacks (ARCHITECTURE 4.3). A card that needs a
 * choice sets `state.pending` and stops; the answer arrives as a normal
 * `resolve` action and resolution continues from `state.queue`.
 */

import type { EffectNode, GameState, InstanceId, PlayerId, Prompt } from '@engine/types';
import { appendLog } from './log.js';
import { makeContext, runEffects } from './triggers.js';
import { createInstance } from './zones.js';

/**
 * How many prompts one player may resolve in a single turn before the chain is
 * treated as a cycle and fizzled. Generous: a Discover-heavy turn spends fewer
 * than a dozen.
 */
const PROMPT_BUDGET_PER_TURN = 60;

/** Keys the player is allowed to send back for a pending prompt. */
export function validKeysFor(prompt: Prompt): string[] {
  return prompt.options.map((o) => o.key);
}

export function isValidResolution(prompt: Prompt, keys: string[]): boolean {
  const valid = new Set(validKeysFor(prompt));
  if (keys.length < prompt.min) return false;
  if (keys.length > prompt.max) return false;
  const seen = new Set<string>();
  for (const k of keys) {
    if (!valid.has(k)) return false;
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

/** What `legalActions` offers for a pending prompt: never something reduce rejects. */
export function legalResolutions(prompt: Prompt): string[][] {
  const keys = validKeysFor(prompt);
  const out: string[][] = [];
  if (prompt.min <= 1 && prompt.max >= 1) {
    for (const k of keys) out.push([k]);
  }
  if (prompt.min === 0) out.push([]);
  if (out.length === 0) {
    const take = Math.min(Math.max(prompt.min, 1), keys.length);
    if (take >= prompt.min && take <= prompt.max) out.push(keys.slice(0, take));
    const fallback = prompt.defaultKeys.filter((k) => keys.includes(k));
    if (isValidResolution(prompt, fallback)) out.push(fallback);
  }
  return out;
}

function contextFromPrompt(prompt: Prompt): ReturnType<typeof makeContext> {
  const raw = (prompt.ctx ?? {}) as Record<string, unknown>;
  const sourceIid = typeof raw['sourceIid'] === 'string' ? (raw['sourceIid'] as InstanceId) : null;
  const depth = typeof raw['depth'] === 'number' ? (raw['depth'] as number) : 0;
  const multiplier = typeof raw['multiplier'] === 'number' ? (raw['multiplier'] as number) : 1;
  const vars =
    raw['vars'] && typeof raw['vars'] === 'object'
      ? ({ ...(raw['vars'] as Record<string, number>) })
      : {};
  return makeContext(prompt.player, sourceIid, depth, multiplier, vars);
}

/**
 * How a prompt resolves. Records the selection on the prompt's ctx, runs any
 * per-option effects the interpreter stashed there (`{op:'choose'}` writes them
 * to `ctx.optionEffects`), then runs `then`.
 */
function localResume(state: GameState, prompt: Prompt, keys: string[]): GameState {
  let s = state;
  const ctx = contextFromPrompt(prompt);
  const chosen = prompt.options.filter((o) => keys.includes(o.key));

  const raw = (prompt.ctx ?? {}) as Record<string, unknown>;
  raw['selectedKeys'] = keys;
  raw['selectedDefIds'] = chosen.map((o) => o.defId).filter((d): d is string => !!d);
  raw['selectedIids'] = chosen.map((o) => o.iid).filter((i): i is string => !!i);
  raw['selectedPileIds'] = chosen.map((o) => o.pileId).filter((p): p is string => !!p);

  // A 'targets' or 'piles' prompt came from a `pick:'choose'` selector inside an
  // ordinary op — discard, trash, moveTo, lockPile, gainCard. Those carry no
  // `then`: the op itself has to run again with the answer. The mode is on the
  // ctx, not on `prompt.type`, because a target prompt is typed 'selectCards'
  // like a real selectCards node.
  const mode = raw['mode'];
  if (mode === 'targets' || mode === 'piles') {
    const pre =
      mode === 'piles'
        ? { pileIds: raw['selectedPileIds'] as string[] }
        : { iids: raw['selectedIids'] as string[] };
    return Effects.resumeNode(s, prompt, pre);
  }

  ctx.vars['chosenCount'] = chosen.length;
  ctx.vars['x'] = ctx.vars['x'] ?? chosen.length;

  // Per-option branches (`{op:'choose'}` stores them here).
  const branches = raw['optionEffects'];
  if (branches && typeof branches === 'object') {
    const table = branches as Record<string, EffectNode[]>;
    for (const opt of chosen) {
      const nodes = table[opt.key];
      if (Array.isArray(nodes) && nodes.length) s = runEffects(s, nodes, ctx);
      if (s.pending) return s;
    }
  }

  if (prompt.then && prompt.then.length) {
    // The `then` of a choice runs ONCE PER CHOSEN CARD, with the sentinel
    // '$discovered' / '$selected' replaced by that card's defId. This mirrors
    // `pushChosen` and `runThenPerInstance` in effects/ops/choices.ts, which is
    // where the interpreter would have resumed if the effects slice exported a
    // `resumePrompt`. It does not, so every prompt in the game lands here
    // instead, and running `then` raw meant the sentinel was never substituted
    // and the body never saw the player's choice.
    //
    // `selectCards` additionally rebinds `self` to the selected instance —
    // {self:true} inside its `then` means "the card I just picked", not the
    // card that asked. `discover` keeps the source binding, because a
    // discovered card has no instance yet.
    const perChoice = chosen.filter((o) => o.defId || o.iid);
    const isPerChoice = raw['perChoice'] === true;
    if (perChoice.length === 0) {
      // A per-choice `then` describes what to do WITH a pick. Declining a
      // `min:0` selection means there is nothing to do it to — running the body
      // anyway resolves {self:true} to the card that asked, so Antibody
      // Extraction trashed itself when the player chose nothing.
      if (!isPerChoice) s = runEffects(s, prompt.then, ctx);
    } else {
      perChoice.forEach((opt, idx) => {
        const inst = opt.iid ? s.instances[opt.iid] : undefined;
        const defId = opt.defId ?? inst?.defId;
        const body = defId ? Effects.substituteDefId(prompt.then, defId) : prompt.then.slice();
        const boundIid = prompt.type === 'selectCards' && opt.iid ? opt.iid : ctx.sourceIid;
        s = runEffects(
          s,
          body,
          makeContext(prompt.player, boundIid, ctx.depth, ctx.multiplier, {
            ...ctx.vars,
            x: idx,
          }),
        );
        if (s.pending) return;
      });
    }
  } else if (prompt.type === 'discover') {
    // Default Discover semantic: the picked card joins your hand.
    for (const opt of chosen) {
      if (!opt.defId) continue;
      const inst = createInstance(s, opt.defId, prompt.player, 'hand');
      appendLog(s, 'discoverGain', prompt.player, { iid: inst.iid, defId: opt.defId });
      const p = s.players[prompt.player];
      if (p && !p.codex.includes(opt.defId)) p.codex.push(opt.defId);
    }
  }
  return s;
}

export function resolvePrompt(
  state: GameState,
  player: PlayerId,
  promptId: string,
  keys: string[],
): GameState {
  const prompt = state.pending;
  if (!prompt) return state;
  if (prompt.id !== promptId) return state;
  if (prompt.player !== player) return state;

  // B30: a resolve carrying a key that was never offered is rejected and leaves
  // the prompt standing, per `error.style`. Substituting the timeout default
  // here made a bogus resolve indistinguishable from a legitimate one — for a
  // default Discover the substitution is exactly `[options[0].key]`. A timeout
  // resolves by passing `prompt.defaultKeys` explicitly, which validates.
  if (!isValidResolution(prompt, keys)) {
    appendLog(state, 'resolveRejected', player, { promptId, keys, reason: 'keyNotOffered' });
    return state;
  }
  const picked = keys;

  // Cycle guard. `config.effectNodeBudget` counts nodes within one resolution,
  // but every resume starts a fresh one — so a card whose prompt leads to
  // another prompt can loop forever without ever exhausting anything, which is
  // the one path the depth cap does not cover. Prompts are per-turn and a
  // Discover-heavy turn uses well under a dozen, so the ceiling only bites on a
  // genuine cycle. The turn stamp is needed because the turn loop clears
  // `playedThisTurn` but not player counters.
  const guard = state.players[player];
  if (guard) {
    const stamped = guard.counters['promptTurn'] === state.turn;
    const used = (stamped ? (guard.counters['promptsThisTurn'] ?? 0) : 0) + 1;
    guard.counters['promptTurn'] = state.turn;
    guard.counters['promptsThisTurn'] = used;
    if (used > PROMPT_BUDGET_PER_TURN) {
      state.pending = null;
      state.queue = [];
      appendLog(state, 'promptFizzle', player, { promptId, used, cap: PROMPT_BUDGET_PER_TURN });
      return state;
    }
  }

  let s = state;
  s.pending = null;
  appendLog(s, 'resolve', player, { promptId, keys: picked, type: prompt.type });

  // `localResume` is the resume path. There used to be a dynamic lookup for a
  // `resumePrompt` export on the effects barrel here, taken when present — but
  // no such export has ever existed, so the branch was unreachable and every
  // `vite build` warned about the missing name. It was the same
  // two-rival-implementations shape as SB-43, which is precisely how the
  // `{op:'choose'}` bug hid for the whole build: one path live, one dead, and
  // the dead one holding the logic people assumed was running.
  s = localResume(s, prompt, picked);

  return drainQueue(s);
}

/** Run whatever the interpreter suspended, until it needs another choice. */
export function drainQueue(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (!s.pending && s.queue.length > 0 && guard < 5000) {
    guard += 1;
    const q = s.queue.shift();
    if (!q) break;
    s = runEffects(s, [q.node], {
      player: q.player,
      sourceIid: q.sourceIid,
      depth: q.depth,
      multiplier: q.multiplier,
      vars: { ...q.vars },
    });
  }
  if (guard >= 5000) appendLog(s, 'fizzle', null, { reason: 'queueGuard' });
  return s;
}
