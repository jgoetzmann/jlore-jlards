/**
 * Aura ops. One Heroic, unlimited Celestial, one Hypercelestial (SB-12 /
 * B76 / B78 / B79). Heroic activation costs 2 Money, once per turn (B77).
 */
import type {
  AuraDefinition,
  AuraId,
  AuraTier,
  GameState,
  Prompt,
  PromptOption,
  QueuedEffect,
} from '@engine/types';
import { allAuras, getAura } from '@engine/registry';
import { manifestAura } from '@engine/meta/auras.js';
import { childItems, log, pushFront, resolveWho } from '../runtime';
import {
  commitRng,
  payloadFrom,
  promptId,
  suspend,
  takeRng,
  type OpResult,
  type Pre,
} from '../opkit';

function safeAura(auraId: AuraId): AuraDefinition | null {
  try {
    return getAura(auraId);
  } catch {
    return null;
  }
}

function auraPool(tier: AuraTier): AuraDefinition[] {
  try {
    return allAuras().filter((a) => a.tier === tier);
  } catch {
    return [];
  }
}

export function opManifestAura(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'manifestAura') return 'ok';

  const rngWho = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rngWho, item.sourceIid);
  commitRng(s, rngWho);

  if (pre && pre.keys && pre.keys.length > 0) {
    for (const pid of players) manifestAura(s, pid, pre.keys[0], node.tier);
    return 'ok';
  }

  if (node.bindTo === 'nextPlayed') {
    for (const pid of players) {
      const p = s.players[pid];
      if (!p) continue;
      p.nextCardMods.push({ bind: 'oathboundMemory', appliesTo: 'play', uses: 1 });
    }
    log(s, 'auraBindPending', { tier: node.tier }, item.player);
    return 'ok';
  }

  if (node.auraId) {
    for (const pid of players) manifestAura(s, pid, node.auraId, node.tier);
    return 'ok';
  }

  const pool = auraPool(node.tier);
  if (pool.length === 0) {
    log(s, 'manifestAuraEmpty', { tier: node.tier }, item.player);
    return 'ok';
  }

  const rng = takeRng(s);
  const shuffled = rng.shuffle(pool.map((a) => a.id));
  commitRng(s, rng);

  if (!node.discover) {
    for (const pid of players) manifestAura(s, pid, shuffled[0], node.tier);
    return 'ok';
  }

  const offered = shuffled.slice(0, Math.min(3, shuffled.length));
  if (offered.length === 1) {
    for (const pid of players) manifestAura(s, pid, offered[0], node.tier);
    return 'ok';
  }

  const options: PromptOption[] = offered.map((id) => {
    const def = safeAura(id);
    return { key: id, label: def ? def.name : id };
  });

  const prompt: Prompt = {
    id: promptId(s),
    type: 'discover',
    player: item.player,
    prompt: 'Manifest an Aura',
    options,
    min: 1,
    max: 1,
    then: [],
    ctx: payloadFrom(item, 'choose', { node }),
    defaultKeys: [offered[0]],
  };
  return suspend(s, q, prompt);
}

/** B77: 2 Money, once per turn, and the aura's effects go on the queue. */
export function opActivateAura(s: GameState, item: QueuedEffect, q: QueuedEffect[]): OpResult {
  const node = item.node;
  if (node.op !== 'activateAura') return 'ok';
  const p = s.players[item.player];
  if (!p) return 'ok';

  for (const held of p.field) {
    const def = safeAura(held.auraId);
    if (!def || def.tier !== 'heroic') continue;
    if (held.usedThisTurn) {
      log(s, 'auraAlreadyUsed', { auraId: held.auraId }, item.player);
      continue;
    }
    const cost = typeof def.activationCost === 'number' ? def.activationCost : 2;
    if (p.money < cost) {
      log(s, 'auraUnaffordable', { auraId: held.auraId, cost }, item.player);
      continue;
    }
    p.money -= cost;
    held.usedThisTurn = true;
    log(s, 'activateAura', { auraId: held.auraId, cost }, item.player);
    pushFront(q, childItems(item, def.effects));
    return 'ok';
  }
  return 'ok';
}
