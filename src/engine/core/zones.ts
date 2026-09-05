/**
 * Zone machinery: the single place that moves an instance and keeps
 * `instance.zone`, `instance.owner`, `instance.pileId` and the ordered arrays
 * on PlayerState / Pile in sync.
 *
 * Covers B8 (empty Library reshuffles GY), B9 (cards played this turn are held
 * aside during that reshuffle and returned to GY), B10/B11/B12 (Flimsy,
 * Temporary, Indestructible), and B63 (counters survive every move).
 */

import type {
  CardDefinition,
  CardInstance,
  GameState,
  InstanceId,
  PileId,
  PlayerId,
  Zone,
} from '@engine/types';
import { getCard, hasCard } from '@engine/registry';
import { makeRng } from '@engine/rng';
import { hasKeyword } from '@engine/systems/keywords.js';
import { appendLog } from './log.js';

export type Position = 'top' | 'bottom' | 'random' | { index: number };

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** A definition that never throws, for view rendering and defensive paths. */
export function safeDef(defId: string): CardDefinition {
  if (hasCard(defId)) return getCard(defId);
  return {
    id: defId,
    name: defId,
    cost: {},
    types: ['Token'],
    subtypes: [],
    tags: [],
    rarity: 'token',
    keywords: [],
    stats: {},
    effects: [],
    triggers: [],
    text: '',
    complexity: 'T1',
    subsystems: ['unknown'],
    notPurchasable: true,
    excludeFromPools: true,
  };
}

export function instOf(state: GameState, iid: InstanceId): CardInstance | null {
  return state.instances[iid] ?? null;
}

export function defOfInstance(state: GameState, iid: InstanceId): CardDefinition {
  const inst = state.instances[iid];
  return safeDef(inst ? inst.defId : iid);
}

export function zoneList(state: GameState, owner: PlayerId | null, zone: Zone): InstanceId[] | null {
  if (!owner) return null;
  const p = state.players[owner];
  if (!p) return null;
  if (zone === 'library') return p.library;
  if (zone === 'hand') return p.hand;
  if (zone === 'gy') return p.gy;
  if (zone === 'play') return p.play;
  return null;
}

/** Library + Hand + GY + play area - every "cards in your deck" reader. */
export function deckOf(state: GameState, player: PlayerId): InstanceId[] {
  const p = state.players[player];
  if (!p) return [];
  return [...p.library, ...p.hand, ...p.gy, ...p.play];
}

// ---------------------------------------------------------------------------
// Instance creation
// ---------------------------------------------------------------------------

export function nextInstanceId(state: GameState): InstanceId {
  const n = state.nextInstanceSeq;
  state.nextInstanceSeq = n + 1;
  return `i_${String(n).padStart(4, '0')}`;
}

export function createInstance(
  state: GameState,
  defId: string,
  owner: PlayerId | null,
  zone: Zone,
): CardInstance {
  const iid = nextInstanceId(state);
  const inst: CardInstance = {
    iid,
    defId,
    owner,
    zone,
    addedKeywords: [],
    removedKeywords: [],
    counters: {},
    statDelta: {},
    extraEffects: [],
    playedOnTurn: null,
  };
  state.instances[iid] = inst;
  if (!state.defsInMatch.includes(defId)) state.defsInMatch.push(defId);
  const arr = zoneList(state, owner, zone);
  if (arr) arr.push(iid);
  return inst;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Yank an instance out of whatever ordered array currently holds it. */
export function detach(state: GameState, iid: InstanceId): void {
  const inst = state.instances[iid];
  for (const pid of state.playerOrder) {
    const p = state.players[pid];
    if (!p) continue;
    for (const arr of [p.library, p.hand, p.gy, p.play]) {
      const i = arr.indexOf(iid);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  for (const pileId of Object.keys(state.shop.piles)) {
    const pile = state.shop.piles[pileId];
    if (!pile) continue;
    const i = pile.cards.indexOf(iid);
    if (i >= 0) pile.cards.splice(i, 1);
  }
  if (inst) inst.pileId = undefined;
}

function insertAt(state: GameState, arr: InstanceId[], iid: InstanceId, pos: Position): void {
  if (pos === 'top') {
    arr.unshift(iid);
    return;
  }
  if (pos === 'bottom') {
    arr.push(iid);
    return;
  }
  if (pos === 'random') {
    const rng = makeRng(state.seed, state.rngCursor);
    const idx = rng.int(arr.length + 1);
    state.rngCursor = rng.cursor();
    arr.splice(idx, 0, iid);
    return;
  }
  const idx = Math.max(0, Math.min(arr.length, Math.floor(pos.index)));
  arr.splice(idx, 0, iid);
}

/**
 * Move an instance to a zone. For `library` the "top" is index 0. For `hand`
 * order is preserved and meaningful (B13, adjacency-reading cards).
 */
export function moveInstance(
  state: GameState,
  iid: InstanceId,
  owner: PlayerId | null,
  zone: Zone,
  pos: Position = 'bottom',
): void {
  const inst = state.instances[iid];
  if (!inst) return;
  detach(state, iid);
  inst.owner = owner;
  inst.zone = zone;
  const arr = zoneList(state, owner, zone);
  if (arr) insertAt(state, arr, iid, pos);
}

export function moveToPile(
  state: GameState,
  iid: InstanceId,
  pileId: PileId,
  pos: 'top' | 'bottom' = 'top',
): void {
  const inst = state.instances[iid];
  const pile = state.shop.piles[pileId];
  if (!inst || !pile) return;
  detach(state, iid);
  inst.owner = null;
  inst.zone = 'shop';
  inst.pileId = pileId;
  if (pos === 'top') pile.cards.unshift(iid);
  else pile.cards.push(iid);
}

// ---------------------------------------------------------------------------
// Trash / discard
// ---------------------------------------------------------------------------

/**
 * B12 / B40: Indestructible beats every trash source. The instance stays where
 * it is and the function reports that nothing happened.
 */
export function trashInstance(state: GameState, iid: InstanceId): boolean {
  const inst = state.instances[iid];
  if (!inst) return false;
  if (hasKeyword(state, iid, 'Indestructible')) {
    inst.counters.trashSurvivals = (inst.counters.trashSurvivals ?? 0) + 1;
    appendLog(state, 'trashBlocked', inst.owner, {
      iid,
      defId: inst.defId,
      reason: 'indestructible',
    });
    return false;
  }
  const owner = inst.owner;
  moveInstance(state, iid, owner, 'trash');
  appendLog(state, 'trash', owner, { iid, defId: inst.defId });
  return true;
}

/**
 * B11: a Temporary card is trashed when discarded, unless it is Indestructible
 * (B12), in which case it goes to GY like anything else.
 */
export function discardInstance(state: GameState, iid: InstanceId): void {
  const inst = state.instances[iid];
  if (!inst) return;
  const owner = inst.owner;
  if (hasKeyword(state, iid, 'Temporary') && !hasKeyword(state, iid, 'Indestructible')) {
    appendLog(state, 'discard', owner, { iid, defId: inst.defId, then: 'trashedTemporary' });
    trashInstance(state, iid);
    return;
  }
  moveInstance(state, iid, owner, 'gy');
  appendLog(state, 'discard', owner, { iid, defId: inst.defId });
}

// ---------------------------------------------------------------------------
// Draw / mill / reshuffle
// ---------------------------------------------------------------------------

/**
 * B8 + B9. Instances whose `playedOnTurn === state.turn` are held aside and
 * returned to GY afterwards, so a card played this turn cannot be drawn again
 * this turn.
 */
export function reshuffleGyIntoLibrary(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  if (!p || p.gy.length === 0) return 0;

  const held: InstanceId[] = [];
  const pool: InstanceId[] = [];
  for (const iid of p.gy) {
    const inst = state.instances[iid];
    if (inst && inst.playedOnTurn !== null && inst.playedOnTurn === state.turn) held.push(iid);
    else pool.push(iid);
  }
  if (pool.length === 0) return 0;

  const rng = makeRng(state.seed, state.rngCursor);
  const shuffled = rng.shuffle(pool);
  state.rngCursor = rng.cursor();

  for (const iid of shuffled) {
    const inst = state.instances[iid];
    if (inst) inst.zone = 'library';
  }
  p.gy = held;
  p.library = shuffled.concat(p.library);
  appendLog(state, 'shuffle', player, { shuffled: shuffled.length, heldAside: held.length });
  return shuffled.length;
}

export function shuffleLibrary(state: GameState, player: PlayerId): void {
  const p = state.players[player];
  if (!p || p.library.length < 2) return;
  const rng = makeRng(state.seed, state.rngCursor);
  p.library = rng.shuffle(p.library);
  state.rngCursor = rng.cursor();
  appendLog(state, 'shuffle', player, { zone: 'library', count: p.library.length });
}

export function shuffleZone(state: GameState, player: PlayerId, zone: Zone): void {
  if (zone === 'library') {
    shuffleLibrary(state, player);
    return;
  }
  const arr = zoneList(state, player, zone);
  if (!arr || arr.length < 2) return;
  const rng = makeRng(state.seed, state.rngCursor);
  const shuffled = rng.shuffle(arr);
  state.rngCursor = rng.cursor();
  arr.length = 0;
  for (const iid of shuffled) arr.push(iid);
  appendLog(state, 'shuffle', player, { zone, count: arr.length });
}

/** Draw one. Reshuffles first if needed. Returns null when nothing is left (SB-37). */
export function drawOne(state: GameState, player: PlayerId): InstanceId | null {
  const p = state.players[player];
  if (!p) return null;
  if (p.library.length === 0) reshuffleGyIntoLibrary(state, player);
  if (p.library.length === 0) return null;
  const iid = p.library[0] as InstanceId;
  moveInstance(state, iid, player, 'hand', 'bottom');
  appendLog(state, 'draw', player, { iid });
  return iid;
}

/** B29 / SB-37: draw as many as possible, then stop. No penalty. */
export function drawCards(state: GameState, player: PlayerId, n: number): InstanceId[] {
  const out: InstanceId[] = [];
  const count = Math.max(0, Math.floor(n));
  for (let i = 0; i < count; i++) {
    const iid = drawOne(state, player);
    if (!iid) break;
    out.push(iid);
  }
  return out;
}

export function millCards(state: GameState, player: PlayerId, n: number): InstanceId[] {
  const p = state.players[player];
  if (!p) return [];
  const out: InstanceId[] = [];
  const count = Math.max(0, Math.floor(n));
  for (let i = 0; i < count; i++) {
    if (p.library.length === 0) reshuffleGyIntoLibrary(state, player);
    if (p.library.length === 0) break;
    const iid = p.library[0] as InstanceId;
    moveInstance(state, iid, player, 'gy');
    out.push(iid);
  }
  if (out.length) appendLog(state, 'mill', player, { count: out.length });
  return out;
}

export function topOfPile(state: GameState, pileId: PileId): InstanceId | null {
  const pile = state.shop.piles[pileId];
  if (!pile || pile.cards.length === 0) return null;
  return pile.cards[0] as InstanceId;
}
