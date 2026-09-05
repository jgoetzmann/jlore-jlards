/**
 * Movement and creation ops.
 */
import type { CardDefId, GameState, InstanceId, PileId, PoolSpec, QueuedEffect, Zone } from '@engine/types';
import { defCost, log, resolveWho, tryGetCard, uniq } from '../runtime';
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
import {
  createInstance,
  moveInstance,
  noteCodex,
  shuffleZone,
  sortLibraryByCost,
  type Position,
} from '../zones';
import { fireEvent } from '../triggers';
import { poolCandidates, resolveDefIdSpec, sampleOne } from '../pools';
import { matchesDefFilter } from '../select';

const OWNED: Zone[] = ['library', 'hand', 'gy', 'play'];

export function opMoveTo(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'moveTo') return 'ok';
  const targets = resolveTargets(s, item, q, node.target, pre, 'Move a card');
  if (targets === null) return 'suspend';
  for (const iid of targets) {
    const i = s.instances[iid];
    if (!i) continue;
    const owner = OWNED.indexOf(node.zone) >= 0 ? i.owner ?? item.player : i.owner;
    moveInstance(s, iid, node.zone, { owner, position: node.position as Position | undefined });
    log(s, 'moveTo', { iid, defId: i.defId, zone: node.zone }, owner);
  }
  return 'ok';
}

export function opCreateCard(s: GameState, item: QueuedEffect, q: QueuedEffect[]): OpResult {
  const node = item.node;
  if (node.op !== 'createCard') return 'ok';
  const ctx = ctxFor(item);
  const count = node.count === undefined ? 1 : Math.max(0, Math.floor(evalAmount(s, node.count, ctx)));
  if (count === 0) return 'ok';

  const rng = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rng);

  for (const pid of players) {
    for (let k = 0; k < count; k += 1) {
      const defId = resolveDefIdSpec(s, node.defId, { ...ctx, player: pid }, rng);
      if (!defId) continue;
      const iid = createInstance(s, defId, OWNED.indexOf(node.to) >= 0 ? pid : null, node.to, {
        keywords: node.keywords,
        counters: node.counters,
        statDelta: node.statDelta,
        position: node.position as Position | undefined,
      });
      noteCodex(s, pid, defId);
      const p = s.players[pid];
      if (p) p.cardsGainedThisTurn += 1;
      log(s, 'createCard', { iid, defId, zone: node.to }, pid);
      fireEvent(s, q, item, 'onGain', iid, pid);
    }
  }
  commitRng(s, rng);
  return 'ok';
}

export function opGainCard(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'gainCard') return 'ok';
  const ctx = ctxFor(item);
  const count = node.count === undefined ? 1 : Math.max(0, Math.floor(evalAmount(s, node.count, ctx)));
  if (count === 0) return 'ok';

  const rngWho = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rngWho);
  commitRng(s, rngWho);

  const isPool = !!node.from && typeof node.from === 'object' && 'pool' in node.from;

  if (isPool) {
    const rng = takeRng(s);
    for (const pid of players) {
      for (let k = 0; k < count; k += 1) {
        const defId = sampleOne(s, (node.from as { pool: PoolSpec }).pool, { ...ctx, player: pid }, rng);
        if (!defId) continue;
        const iid = createInstance(s, defId, OWNED.indexOf(node.to) >= 0 ? pid : null, node.to);
        noteCodex(s, pid, defId);
        const p = s.players[pid];
        if (p) p.cardsGainedThisTurn += 1;
        log(s, 'gainCard', { iid, defId, zone: node.to, source: 'pool' }, pid);
        fireEvent(s, q, item, 'onGain', iid, pid);
      }
    }
    commitRng(s, rng);
    return 'ok';
  }

  const piles = resolvePiles(s, item, q, node.from as Parameters<typeof resolvePiles>[3], pre, 'Gain a card from a pile');
  if (piles === null) return 'suspend';

  for (const pid of players) {
    let taken = 0;
    for (const pileId of piles) {
      if (taken >= count) break;
      const pile = s.shop.piles[pileId];
      if (!pile || pile.cards.length === 0) continue;
      const iid = pile.cards[0];
      const i = s.instances[iid];
      if (!i) continue;

      if (node.free === false) {
        const p = s.players[pid];
        const price = defCost(s, i.defId);
        if (!p || p.money < price) continue;
        p.money -= price;
      }

      moveInstance(s, iid, node.to, { owner: OWNED.indexOf(node.to) >= 0 ? pid : null });
      noteCodex(s, pid, i.defId);
      const p2 = s.players[pid];
      if (p2) p2.cardsGainedThisTurn += 1;
      taken += 1;
      log(s, 'gainCard', { iid, defId: i.defId, zone: node.to, pileId }, pid);
      fireEvent(s, q, item, 'onGain', iid, pid);
      if (pile.cards.length === 0) fireEvent(s, q, item, 'onPileEmpty', null, pid);
    }
  }
  return 'ok';
}

export function opCopyCard(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'copyCard') return 'ok';
  const targets = resolveTargets(s, item, q, node.target, pre, 'Copy a card');
  if (targets === null) return 'suspend';

  const rng = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rng);
  commitRng(s, rng);
  const owner = players.length > 0 ? players[0] : item.player;

  for (const iid of targets) {
    const src = s.instances[iid];
    if (!src) continue;
    const keywords = src.addedKeywords.concat(node.keywords ?? []);
    const copyIid = createInstance(s, src.defId, OWNED.indexOf(node.to) >= 0 ? owner : null, node.to, {
      keywords: uniq(keywords),
      statDelta: { ...src.statDelta },
    });
    noteCodex(s, owner, src.defId);
    const p = s.players[owner];
    if (p) p.cardsGainedThisTurn += 1;
    log(s, 'copyCard', { from: iid, to: copyIid, defId: src.defId, zone: node.to }, owner);
    fireEvent(s, q, item, 'onGain', copyIid, owner);
  }
  return 'ok';
}

/** B39: same zone, same position, no trash trigger and no gain trigger. */
export function opTransform(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'transform') return 'ok';
  const targets = resolveTargets(s, item, q, node.target, pre, 'Transform a card');
  if (targets === null) return 'suspend';

  const ctx = ctxFor(item);
  const rng = takeRng(s);

  for (const iid of targets) {
    const i = s.instances[iid];
    if (!i) continue;
    const oldDefId = i.defId;
    let nextDefId: CardDefId | null = null;

    if (typeof node.into === 'string' && node.into !== 'upgrade' && node.into !== 'downgrade') {
      nextDefId = node.into;
    } else if (node.into === 'upgrade' || node.into === 'downgrade') {
      nextDefId = pickByCostDelta(s, ctx, oldDefId, node.into === 'upgrade' ? 1 : -1, rng);
    } else if (node.into && typeof node.into === 'object' && 'pool' in node.into) {
      nextDefId = sampleOne(s, node.into.pool, ctx, rng);
    } else if (node.into && typeof node.into === 'object' && 'costDelta' in node.into) {
      nextDefId = pickByCostDelta(s, ctx, oldDefId, node.into.costDelta, rng);
    }

    if (!nextDefId || nextDefId === oldDefId) continue;

    // Replace in place: same iid, same zone, same index, counters intact.
    i.defId = nextDefId;
    if (s.defsInMatch.indexOf(nextDefId) < 0) s.defsInMatch.push(nextDefId);
    if (i.owner) noteCodex(s, i.owner, nextDefId);
    log(s, 'transform', { iid, from: oldDefId, to: nextDefId, zone: i.zone }, i.owner);
  }
  commitRng(s, rng);
  return 'ok';
}

function pickByCostDelta(
  s: GameState,
  ctx: Parameters<typeof poolCandidates>[2],
  fromDefId: CardDefId,
  delta: number,
  rng: ReturnType<typeof takeRng>,
): CardDefId | null {
  const targetCost = defCost(s, fromDefId) + delta;
  const candidates = poolCandidates(s, { scope: 'entireUniverse' }, ctx).filter((id) => {
    const def = tryGetCard(id);
    if (!def) return false;
    if (def.notPurchasable) return false;
    return defCost(s, id) === targetCost && matchesDefFilter(def, undefined, s);
  });
  if (candidates.length === 0) return null;
  return rng.pick(candidates);
}

/** B42 / SB-2: pull matching cards into hand, then shuffle the source zone. */
export function opRecruit(s: GameState, item: QueuedEffect, q: QueuedEffect[]): OpResult {
  const node = item.node;
  if (node.op !== 'recruit') return 'ok';
  const ctx = ctxFor(item);
  const fromZone: Zone = node.zone ?? 'library';
  const toZone: Zone = node.to ?? 'hand';
  const count = node.count === undefined ? 1 : Math.max(0, Math.floor(evalAmount(s, node.count, ctx)));

  const rng = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rng);
  commitRng(s, rng);

  for (const pid of players) {
    const p = s.players[pid];
    if (!p) continue;
    const source = zoneArrayFor(s, pid, fromZone);
    const found: InstanceId[] = [];
    for (const iid of source) {
      if (found.length >= count) break;
      if (matchesInstance(s, iid, node.filter)) found.push(iid);
    }
    for (const iid of found) {
      moveInstance(s, iid, toZone, { owner: pid });
      log(s, 'recruit', { iid, from: fromZone, to: toZone }, pid);
    }
    shuffleZone(s, pid, fromZone);
  }
  return 'ok';
}

function zoneArrayFor(s: GameState, player: string, zone: Zone): InstanceId[] {
  const p = s.players[player];
  if (!p) return [];
  if (zone === 'library') return p.library.slice();
  if (zone === 'hand') return p.hand.slice();
  if (zone === 'gy') return p.gy.slice();
  if (zone === 'play') return p.play.slice();
  const out: InstanceId[] = [];
  for (const iid of Object.keys(s.instances)) {
    const i = s.instances[iid];
    if (i && i.zone === zone && i.owner === player) out.push(iid);
  }
  return out;
}

function matchesInstance(s: GameState, iid: InstanceId, filter: Parameters<typeof matchesDefFilter>[1]): boolean {
  const i = s.instances[iid];
  if (!i) return false;
  const def = tryGetCard(i.defId);
  if (!def) return false;
  return matchesDefFilter(def, filter, s);
}

export function opShuffle(s: GameState, item: QueuedEffect, q: QueuedEffect[]): OpResult {
  const node = item.node;
  if (node.op !== 'shuffle') return 'ok';
  const zone: Zone = node.zone ?? 'library';
  const rng = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rng);
  commitRng(s, rng);
  for (const pid of players) {
    shuffleZone(s, pid, zone);
    log(s, 'shuffleZone', { zone }, pid);
    fireEvent(s, q, item, 'onShuffle', null, pid);
  }
  return 'ok';
}

export function opSortLibraryByCost(s: GameState, item: QueuedEffect): OpResult {
  const node = item.node;
  if (node.op !== 'sortLibraryByCost') return 'ok';
  const rng = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rng);
  commitRng(s, rng);
  for (const pid of players) sortLibraryByCost(s, pid, false);
  return 'ok';
}

export function opReveal(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'reveal') return 'ok';
  const targets = resolveTargets(s, item, q, node.target, pre, 'Reveal');
  if (targets === null) return 'suspend';
  const defIds: CardDefId[] = [];
  for (const iid of targets) {
    const i = s.instances[iid];
    if (!i) continue;
    defIds.push(i.defId);
    for (const pid of s.playerOrder) noteCodex(s, pid, i.defId);
  }
  if (defIds.length > 0) log(s, 'reveal', { iids: targets, defIds }, item.player);
  return 'ok';
}

export function pileIdsOf(s: GameState): PileId[] {
  return Object.keys(s.shop.piles);
}
