/**
 * Prompt resolution and queue draining.
 *
 * Prompts are state, never callbacks (ARCHITECTURE 4.3). A card that needs a
 * choice sets `state.pending` and stops; the answer arrives as a normal
 * `resolve` action and resolution continues from `state.queue`.
 */

import type { EffectNode, GameState, InstanceId, PlayerId, Prompt } from '@engine/types';
import * as Effects from '@engine/effects';
import { appendLog } from './log.js';
import { makeContext, runEffects } from './triggers.js';
import { createInstance } from './zones.js';

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
 * Fallback resolution used when the effects slice does not expose a resume
 * entry point. It records the selection on the prompt's ctx, runs any
 * per-option effects the interpreter stashed there, then runs `then`.
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
    s = runEffects(s, prompt.then, ctx);
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

  let picked = keys;
  if (!isValidResolution(prompt, picked)) {
    // Fall back to the timeout default rather than rejecting a live match.
    picked = prompt.defaultKeys.filter((k) => validKeysFor(prompt).includes(k));
    if (!isValidResolution(prompt, picked)) picked = validKeysFor(prompt).slice(0, prompt.min);
  }

  let s = state;
  s.pending = null;
  appendLog(s, 'resolve', player, { promptId, keys: picked, type: prompt.type });

  const resume = (Effects as unknown as Record<string, unknown>)['resumePrompt'];
  if (typeof resume === 'function') {
    try {
      s = (resume as (a: GameState, b: Prompt, c: string[]) => GameState)(s, prompt, picked) ?? s;
    } catch (err) {
      appendLog(s, 'effectError', player, { message: String(err) });
    }
  } else {
    s = localResume(s, prompt, picked);
  }

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
