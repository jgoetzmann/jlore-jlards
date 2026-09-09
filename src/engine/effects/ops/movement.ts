/**
 * Movement and creation ops.
 */
import type {
  CardDefId,
  CardDefinition,
  GameState,
  InstanceId,
  PoolSpec,
  QueuedEffect,
  Zone,
} from '@engine/types';
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
import { createInstance, moveInstance, type Position } from '@engine/core/zones';
import { fireEvent, shuffleWithTrigger } from '../triggers';
import { poolCandidates, resolveDefIdSpec, sampleOne } from '../pools';
import { matchesDefFilter } from '../select';
import { downgradedDefId, upgradedDefId } from '@engine/systems/upgrade.js';
import { fusedDefinition } from '@engine/systems/fuse.js';
import { registerCards } from '@engine/registry';
import resolveEffects from '../index';

const OWNED: Zone[] = ['library', 'hand', 'gy', 'play'];

/** Add a defId to a player's codex the first time they meet it (B92). */
function noteCodex(s: GameState, player: string, defId: CardDefId): void {
  const p = s.players[player];
  if (!p) return;
  if (p.codex.indexOf(defId) < 0) p.codex.push(defId);
}

function sortLibraryByCost(s: GameState, player: string, descending: boolean): void {
  const p = s.players[player];
  if (!p) return;
  const priceOf = (iid: InstanceId): number => {
    const i = s.instances[iid];
    return i ? defCost(s, i.defId) : 0;
  };
  p.library = p.library
    .slice()
    .sort((a, b) => (descending ? priceOf(b) - priceOf(a) : priceOf(a) - priceOf(b)));
  log(s, 'sortLibrary', { player, descending }, player);
}

export function opMoveTo(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'moveTo') return 'ok';
  const targets = resolveTargets(s, item, q, node.target, pre, 'Move a card');
  if (targets === null) return 'suspend';

  // A `who` names the owner the card ends up with. Without one a card keeps its
  // current owner, so moving an opponent's card to "hand" returns it to THEIR
  // hand — every steal written as a bare moveTo was a no-op.
  let destOwner: string | null | undefined;
  if (node.who) {
    const rng = takeRng(s);
    const picked = resolveWho(s, node.who, item.player, rng, item.sourceIid);
    commitRng(s, rng);
    destOwner = picked.length > 0 ? picked[0] : undefined;
  }

  for (const iid of targets) {
    const i = s.instances[iid];
    if (!i) continue;
    const owner =
      OWNED.indexOf(node.zone) >= 0 ? destOwner ?? i.owner ?? item.player : destOwner ?? i.owner;
    moveInstance(s, iid, owner, node.zone, node.position as Position | undefined);
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
  const players = resolveWho(s, node.who, item.player, rng, item.sourceIid);

  for (const pid of players) {
    for (let k = 0; k < count; k += 1) {
      const defId = resolveDefIdSpec(s, node.defId, { ...ctx, player: pid }, rng);
      if (!defId) continue;
      const made = createInstance(s, defId, OWNED.indexOf(node.to) >= 0 ? pid : null, node.to);
      const iid = made.iid;
      if (node.keywords) made.addedKeywords = [...node.keywords];
      if (node.counters) made.counters = { ...node.counters };
      if (node.statDelta) made.statDelta = { ...node.statDelta };
      if (node.position) moveInstance(s, iid, made.owner, node.to, node.position as Position);
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

/**
 * §A.24 Homebrew: "permanently add its effect to this card". The absorbed
 * definition is never gained — only its printed effects are, and they land in
 * `extraEffects`, which survives zone changes, shuffles and `transform`
 * (SB-33), so "permanently" and "then upgrade it" hold in one breath.
 *
 * The deferred form of this is `NextCardMod.absorbInto`, which waits for the
 * absorbed card to be played (Hivemind). A row with no play in the middle had
 * no door at all before this op: nothing else in the effect DSL writes
 * `extraEffects`.
 */
export function opAbsorb(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'absorb') return 'ok';

  const targets = resolveTargets(s, item, q, node.target, pre, 'Absorb into');
  if (targets === null) return 'suspend';
  if (targets.length === 0) return 'ok';

  const ctx = ctxFor(item);
  const rng = takeRng(s);
  const defId = resolveDefIdSpec(s, node.defId, ctx, rng);
  commitRng(s, rng);
  if (!defId) return 'ok';

  const source: CardDefinition | null = tryGetCard(defId);
  if (!source || source.effects.length === 0) {
    // Absorbing a card whose whole output is a printed stat line would add
    // nothing — say so in the log rather than silently doing nothing.
    log(s, 'absorbEmpty', { defId }, item.player);
    return 'ok';
  }

  for (const iid of targets) {
    const inst = s.instances[iid];
    if (!inst) continue;
    inst.extraEffects.push(...source.effects);
    noteCodex(s, inst.owner ?? item.player, defId);
    log(s, 'absorb', { iid, defId, clauses: source.effects.length }, inst.owner ?? item.player);
  }
  return 'ok';
}

export function opGainCard(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'gainCard') return 'ok';
  const ctx = ctxFor(item);
  const count = node.count === undefined ? 1 : Math.max(0, Math.floor(evalAmount(s, node.count, ctx)));
  if (count === 0) return 'ok';

  const rngWho = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rngWho, item.sourceIid);
  commitRng(s, rngWho);

  const isPool = !!node.from && typeof node.from === 'object' && 'pool' in node.from;

  if (isPool) {
    const rng = takeRng(s);
    for (const pid of players) {
      for (let k = 0; k < count; k += 1) {
        const defId = sampleOne(s, (node.from as { pool: PoolSpec }).pool, { ...ctx, player: pid }, rng);
        if (!defId) continue;
        const iid = createInstance(s, defId, OWNED.indexOf(node.to) >= 0 ? pid : null, node.to).iid;
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

      moveInstance(s, iid, OWNED.indexOf(node.to) >= 0 ? pid : null, node.to);
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
  const players = resolveWho(s, node.who, item.player, rng, item.sourceIid);
  commitRng(s, rng);
  const owner = players.length > 0 ? players[0] : item.player;

  for (const iid of targets) {
    const src = s.instances[iid];
    if (!src) continue;
    const keywords = src.addedKeywords.concat(node.keywords ?? []);
    const copy = createInstance(s, src.defId, OWNED.indexOf(node.to) >= 0 ? owner : null, node.to);
    const copyIid = copy.iid;
    copy.addedKeywords = uniq(keywords);
    copy.statDelta = { ...src.statDelta };
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
      // 3.2 defines Upgrade on a Resource as the next rung of the ladder —
      // Copper to Silver to Gold to Diamond — not "a random card costing one
      // more". `upgradedDefId`/`downgradedDefId` already implement the ladder,
      // including "Diamond stays a Diamond", so a Resource takes that route and
      // everything else keeps the cost-delta approximation.
      // `upgradedDefId` returns the SAME id at the top rung, and the
      // `nextDefId === oldDefId` guard below turns that into the no-op the doc
      // asks for ("Diamond stays a Diamond"). null means "not a Resource",
      // which is the only case that falls back to the cost approximation.
      const rung =
        node.into === 'upgrade' ? upgradedDefId(oldDefId) : downgradedDefId(oldDefId);
      nextDefId =
        rung ?? pickByCostDelta(s, ctx, oldDefId, node.into === 'upgrade' ? 1 : -1, rng);
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
  const players = resolveWho(s, node.who, item.player, rng, item.sourceIid);
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
      moveInstance(s, iid, pid, toZone);
      log(s, 'recruit', { iid, from: fromZone, to: toZone }, pid);
    }
    // B42: the source zone is shuffled afterwards, and that shuffle is a real
    // shuffle event (C1).
    shuffleWithTrigger(s, item, q, pid, fromZone);
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
  const players = resolveWho(s, node.who, item.player, rng, item.sourceIid);
  commitRng(s, rng);
  for (const pid of players) {
    shuffleWithTrigger(s, item, q, pid, zone);
    log(s, 'shuffleZone', { zone }, pid);
  }
  return 'ok';
}

export function opSortLibraryByCost(s: GameState, item: QueuedEffect): OpResult {
  const node = item.node;
  if (node.op !== 'sortLibraryByCost') return 'ok';
  const rng = takeRng(s);
  const players = resolveWho(s, node.who, item.player, rng, item.sourceIid);
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

/**
 * §3.1 Fused — merge two or more cards into one composite.
 *
 * The composite definition is built by `fusedDefinition` (which already
 * implements SB-13's arithmetic: summed cost capped at 20, unioned types, the
 * max rarity, concatenated effects) and registered under a generated id so the
 * result is a real card that can be copied, Discovered and Buffed like any
 * other. The components are consumed.
 *
 * Each component sees an `onFuse` trigger first. That is the hook Chopped Chuzz
 * needs — "when this attempts to Fuse, trash it instead" — and any component
 * that has left its zone by the time the triggers finish is simply dropped from
 * the merge rather than silently fused anyway.
 */
export function opFuse(s: GameState, item: QueuedEffect, q: QueuedEffect[], pre?: Pre): OpResult {
  const node = item.node;
  if (node.op !== 'fuse') return 'ok';
  const targets = resolveTargets(s, item, q, node.target, pre, 'Fuse cards');
  if (targets === null) return 'suspend';
  if (targets.length < 2) return 'ok';

  const zoneBefore = new Map<InstanceId, Zone>();
  for (const iid of targets) {
    const i = s.instances[iid];
    if (i) zoneBefore.set(iid, i.zone);
  }
  // `onFuse` is a VETO, so it has to resolve before the merge is decided.
  // `fireEvent` only enqueues, and the queue drains long after this op returns —
  // a refusal would have landed after the composite was already built, and if
  // the refuser happened to be component 0 it would have destroyed the finished
  // fusion instead of excusing itself. Resolved inline here instead.
  for (const iid of targets) {
    const inst = s.instances[iid];
    if (!inst) continue;
    const def = tryGetCard(inst.defId);
    if (!def) continue;
    for (const trig of def.triggers) {
      if (trig.on !== 'onFuse') continue;
      const ctx = { ...ctxFor(item), sourceIid: iid };
      const after = resolveEffects(s, trig.effects, ctx);
      Object.assign(s, after);
    }
  }

  // Anything that moved (Chopped Chuzz trashing itself) is out of the merge.
  const live = targets.filter((iid) => {
    const i = s.instances[iid];
    return !!i && i.zone === zoneBefore.get(iid);
  });
  if (live.length < 2) {
    log(s, 'fuseAborted', { attempted: targets, live }, item.player);
    return 'ok';
  }

  const defs: CardDefinition[] = [];
  for (const iid of live) {
    const def = tryGetCard(s.instances[iid]!.defId);
    if (def) defs.push(def);
  }
  if (defs.length < 2) return 'ok';

  const fused = fusedDefinition(defs);
  registerCards([fused]);
  if (s.defsInMatch.indexOf(fused.id) < 0) s.defsInMatch.push(fused.id);

  // The first component becomes the composite in place, so a fusion inside a
  // Library stays in the Library at its position. The rest are consumed.
  const hostIid = live[0] as InstanceId;
  const host = s.instances[hostIid]!;
  host.defId = fused.id;
  host.fusedFrom = defs.map((d) => d.id);
  for (let k = 1; k < live.length; k += 1) {
    moveInstance(s, live[k] as InstanceId, null, 'trash');
  }
  if (node.to && node.to !== host.zone) {
    moveInstance(s, hostIid, OWNED.indexOf(node.to) >= 0 ? item.player : null, node.to);
  }
  if (host.owner) noteCodex(s, host.owner, fused.id);
  log(s, 'fuse', { iid: hostIid, defId: fused.id, from: host.fusedFrom }, item.player);
  return 'ok';
}
