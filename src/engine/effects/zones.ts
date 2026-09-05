/**
 * Zone mechanics used by the effect ops.
 *
 * Deliberately local to this slice (fullsend rule 5). `@engine/core` owns the
 * turn loop's version of the same moves; reconcile picks a winner. Everything
 * here keeps the invariants the spec names: reshuffle pulls the GY into the
 * Library (B8) while holding aside cards played this turn (B9), Temporary is
 * trashed on discard (B11), and Indestructible beats every trash source (B40).
 */
import type {
  CardInstance,
  GameState,
  InstanceId,
  Keyword,
  PileId,
  PlayerId,
  QueuedEffect,
  Stats,
  Zone,
} from '@engine/types';
import type { Rng } from '@engine/rng';
import {
  hasKeyword,
  log,
  pushBack,
  tryGetCard,
  withRng,
  type EffectContext,
} from './runtime';
import { fireEvent } from './triggers';

export type Position = 'top' | 'bottom' | 'random' | { index: number };

function ownedList(s: GameState, player: PlayerId, zone: Zone): InstanceId[] | null {
  const p = s.players[player];
  if (!p) return null;
  if (zone === 'library') return p.library;
  if (zone === 'hand') return p.hand;
  if (zone === 'gy') return p.gy;
  if (zone === 'play') return p.play;
  return null;
}

/** Detach an instance from whichever ordered list currently holds it. */
export function detach(s: GameState, iid: InstanceId): void {
  const i = s.instances[iid];
  if (!i) return;
  if (i.zone === 'shop') {
    const pid = i.pileId;
    if (pid) {
      const pile = s.shop.piles[pid];
      if (pile) {
        const at = pile.cards.indexOf(iid);
        if (at >= 0) pile.cards.splice(at, 1);
      }
    }
    return;
  }
  if (!i.owner) return;
  const list = ownedList(s, i.owner, i.zone);
  if (!list) return;
  const at = list.indexOf(iid);
  if (at >= 0) list.splice(at, 1);
}

function insertAt(list: InstanceId[], iid: InstanceId, position: Position | undefined, s: GameState): void {
  if (position === 'top') {
    list.unshift(iid);
    return;
  }
  if (position === 'random') {
    const idx = withRng(s, (r) => r.int(list.length + 1));
    list.splice(idx, 0, iid);
    return;
  }
  if (position && typeof position === 'object' && typeof position.index === 'number') {
    const idx = Math.max(0, Math.min(list.length, Math.floor(position.index)));
    list.splice(idx, 0, iid);
    return;
  }
  list.push(iid);
}

export interface MoveOpts {
  owner?: PlayerId | null;
  position?: Position;
  pileId?: PileId;
}

/** Move an instance to a zone. Returns false when the instance is unknown. */
export function moveInstance(s: GameState, iid: InstanceId, zone: Zone, opts?: MoveOpts): boolean {
  const i = s.instances[iid];
  if (!i) return false;
  detach(s, iid);

  const nextOwner = opts && opts.owner !== undefined ? opts.owner : i.owner;
  i.owner = nextOwner;
  i.zone = zone;

  if (zone === 'shop') {
    const pid = opts && opts.pileId ? opts.pileId : i.pileId;
    i.pileId = pid;
    i.owner = null;
    if (pid) {
      const pile = s.shop.piles[pid];
      if (pile) insertAt(pile.cards, iid, opts ? opts.position : undefined, s);
    }
    return true;
  }

  i.pileId = undefined;

  if (zone === 'library' || zone === 'hand' || zone === 'gy' || zone === 'play') {
    if (!nextOwner) return false;
    const list = ownedList(s, nextOwner, zone);
    if (!list) return false;
    insertAt(list, iid, opts ? opts.position : undefined, s);
  }
  // trash / field / aside carry no ordered list; the instance's zone field is
  // the whole record.
  return true;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function nextIid(s: GameState): InstanceId {
  const seq = s.nextInstanceSeq;
  s.nextInstanceSeq = seq + 1;
  const padded = String(seq).length >= 4 ? String(seq) : ('0000' + String(seq)).slice(-4);
  return 'i_' + padded;
}

export interface CreateOpts {
  keywords?: Keyword[];
  counters?: Record<string, number>;
  statDelta?: Stats;
  position?: Position;
  pileId?: PileId;
}

export function createInstance(
  s: GameState,
  defId: string,
  owner: PlayerId | null,
  zone: Zone,
  opts?: CreateOpts,
): InstanceId {
  const iid = nextIid(s);
  const card: CardInstance = {
    iid,
    defId,
    owner,
    zone: 'aside',
    addedKeywords: opts && opts.keywords ? opts.keywords.slice() : [],
    removedKeywords: [],
    counters: opts && opts.counters ? { ...opts.counters } : {},
    statDelta: opts && opts.statDelta ? { ...opts.statDelta } : {},
    extraEffects: [],
    playedOnTurn: null,
  };
  s.instances[iid] = card;
  if (s.defsInMatch.indexOf(defId) < 0) s.defsInMatch.push(defId);
  moveInstance(s, iid, zone, {
    owner,
    position: opts ? opts.position : undefined,
    pileId: opts ? opts.pileId : undefined,
  });
  return iid;
}

/** Add a defId to a player's codex the first time they meet it (B92). */
export function noteCodex(s: GameState, player: PlayerId, defId: string): void {
  const p = s.players[player];
  if (!p) return;
  if (p.codex.indexOf(defId) < 0) p.codex.push(defId);
}

// ---------------------------------------------------------------------------
// Shuffling and reshuffle
// ---------------------------------------------------------------------------

export function shuffleZone(s: GameState, player: PlayerId, zone: Zone): void {
  const list = ownedList(s, player, zone);
  if (!list || list.length < 2) return;
  const shuffled = withRng(s, (r: Rng) => r.shuffle(list));
  list.length = 0;
  for (const iid of shuffled) list.push(iid);
}

/**
 * Pull the GY into the Library, holding aside anything played this turn (B9).
 * Returns the number of cards that moved.
 */
export function reshuffleGraveyard(
  s: GameState,
  player: PlayerId,
  q?: QueuedEffect[],
  parent?: QueuedEffect,
): number {
  const p = s.players[player];
  if (!p) return 0;
  if (p.gy.length === 0) return 0;

  const aside: InstanceId[] = [];
  const moving: InstanceId[] = [];
  for (const iid of p.gy) {
    const i = s.instances[iid];
    if (i && i.playedOnTurn === s.turn) aside.push(iid);
    else moving.push(iid);
  }
  if (moving.length === 0) return 0;

  const shuffled = withRng(s, (r: Rng) => r.shuffle(moving));
  p.gy = aside;
  for (const iid of shuffled) {
    const i = s.instances[iid];
    if (i) i.zone = 'library';
    p.library.push(iid);
  }
  log(s, 'shuffle', { player, count: shuffled.length, heldAside: aside.length }, player);
  if (q && parent) fireEvent(s, q, parent, 'onShuffle', null, player);
  return shuffled.length;
}

// ---------------------------------------------------------------------------
// Draw / mill
// ---------------------------------------------------------------------------

/** Draw up to `n`, stopping when Library and GY are both empty (B29 / SB-37). */
export function drawCards(
  s: GameState,
  player: PlayerId,
  n: number,
  q?: QueuedEffect[],
  parent?: QueuedEffect,
): InstanceId[] {
  const p = s.players[player];
  if (!p) return [];
  const drawn: InstanceId[] = [];
  for (let k = 0; k < n; k += 1) {
    if (p.library.length === 0) reshuffleGraveyard(s, player, q, parent);
    if (p.library.length === 0) break;
    const iid = p.library.shift() as InstanceId;
    const i = s.instances[iid];
    if (i) {
      i.zone = 'hand';
      i.owner = player;
      i.pileId = undefined;
    }
    p.hand.push(iid);
    drawn.push(iid);
    if (q && parent) {
      fireEvent(s, q, parent, 'onDraw', iid, player);
      if (hasKeyword(s, iid, 'PlayOnDraw')) {
        pushBack(q, [
          {
            node: { op: 'playCard', target: { self: true } },
            player,
            sourceIid: iid,
            depth: parent.depth + 1,
            multiplier: 1,
            vars: {},
          },
        ]);
      }
    }
  }
  if (drawn.length > 0) log(s, 'draw', { player, count: drawn.length }, player);
  return drawn;
}

/** Move the top `n` of the Library straight to the GY. */
export function millCards(
  s: GameState,
  player: PlayerId,
  n: number,
  q?: QueuedEffect[],
  parent?: QueuedEffect,
): InstanceId[] {
  const p = s.players[player];
  if (!p) return [];
  const milled: InstanceId[] = [];
  for (let k = 0; k < n; k += 1) {
    if (p.library.length === 0) reshuffleGraveyard(s, player, q, parent);
    if (p.library.length === 0) break;
    const iid = p.library.shift() as InstanceId;
    const i = s.instances[iid];
    if (i) {
      i.zone = 'gy';
      i.owner = player;
    }
    p.gy.push(iid);
    milled.push(iid);
  }
  if (milled.length > 0) log(s, 'mill', { player, count: milled.length }, player);
  return milled;
}

// ---------------------------------------------------------------------------
// Discard / trash
// ---------------------------------------------------------------------------

/** Indestructible beats every trash source (B12 / B40). */
export function trashInstance(
  s: GameState,
  iid: InstanceId,
  q?: QueuedEffect[],
  parent?: QueuedEffect,
): boolean {
  const i = s.instances[iid];
  if (!i) return false;
  if (hasKeyword(s, iid, 'Indestructible')) {
    const cur = typeof i.counters.trashSurvivals === 'number' ? i.counters.trashSurvivals : 0;
    i.counters.trashSurvivals = cur + 1;
    log(s, 'trashResisted', { iid, defId: i.defId }, i.owner);
    return false;
  }
  const owner = i.owner;
  moveInstance(s, iid, 'trash', { owner });
  log(s, 'trash', { iid, defId: i.defId }, owner);
  if (q && parent) fireEvent(s, q, parent, 'onTrash', iid, owner ?? parent.player);
  return true;
}

/** Discard to GY. Temporary is trashed instead (B11). */
export function discardInstance(
  s: GameState,
  iid: InstanceId,
  q?: QueuedEffect[],
  parent?: QueuedEffect,
): boolean {
  const i = s.instances[iid];
  if (!i) return false;
  const owner = i.owner;
  if (hasKeyword(s, iid, 'Temporary')) {
    log(s, 'discard', { iid, defId: i.defId, temporary: true }, owner);
    if (q && parent) fireEvent(s, q, parent, 'onDiscard', iid, owner ?? parent.player);
    trashInstance(s, iid, q, parent);
    return true;
  }
  moveInstance(s, iid, 'gy', { owner });
  log(s, 'discard', { iid, defId: i.defId }, owner);
  if (q && parent) fireEvent(s, q, parent, 'onDiscard', iid, owner ?? parent.player);
  return true;
}

// ---------------------------------------------------------------------------
// Library ordering
// ---------------------------------------------------------------------------

export function sortLibraryByCost(s: GameState, player: PlayerId, descending: boolean): void {
  const p = s.players[player];
  if (!p) return;
  const costOf = (iid: InstanceId): number => {
    const i = s.instances[iid];
    if (!i) return 0;
    const def = tryGetCard(i.defId);
    const base = def && typeof def.cost.money === 'number' ? def.cost.money : 0;
    const v = s.variants[i.defId];
    return base + (v ? v.costDelta : 0);
  };
  p.library = p.library.slice().sort((a, b) => (descending ? costOf(b) - costOf(a) : costOf(a) - costOf(b)));
  log(s, 'sortLibrary', { player, descending }, player);
}

export function ctxOf(item: QueuedEffect): EffectContext {
  return {
    player: item.player,
    sourceIid: item.sourceIid,
    depth: item.depth,
    multiplier: item.multiplier,
    vars: item.vars,
  };
}
