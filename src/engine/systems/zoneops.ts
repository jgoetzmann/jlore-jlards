/**
 * Local zone plumbing for the systems slice.
 *
 * `@engine/core/zones` owns the canonical version of this for the core turn
 * loop; this is the systems slice's own copy so plague spread, steal, fusion
 * and delayed effects never depend on another slice's argument order.
 *
 * Every move preserves the instance's counters, keywords, statDelta and
 * extraEffects, which is exactly what B63 requires.
 */

import type { GameState, InstanceId, PileId, PlayerId, Zone } from '@engine/types';
import { copyInstance, copyPlayer } from './internal';

type PlayerZone = 'library' | 'hand' | 'gy' | 'play';

const PLAYER_ZONES: readonly PlayerZone[] = ['library', 'hand', 'gy', 'play'];

function isPlayerZone(z: Zone): z is PlayerZone {
  return (PLAYER_ZONES as readonly string[]).includes(z);
}

/** Strip an instance id out of every zone array and every pile it might sit in. */
export function detach(state: GameState, iid: InstanceId): GameState {
  const inst = state.instances[iid];
  if (!inst) return state;

  let next = state;

  if (inst.owner && isPlayerZone(inst.zone)) {
    const p = next.players[inst.owner];
    if (p) {
      const copy = copyPlayer(p);
      copy[inst.zone] = copy[inst.zone].filter((x) => x !== iid);
      next = { ...next, players: { ...next.players, [inst.owner]: copy } };
    }
  } else if (inst.owner) {
    // aside / trash / field-adjacent zones are not tracked as arrays; still
    // sweep the four ordered zones in case of a stale reference.
    const p = next.players[inst.owner];
    if (p) {
      const copy = copyPlayer(p);
      let changed = false;
      for (const z of PLAYER_ZONES) {
        if (copy[z].includes(iid)) {
          copy[z] = copy[z].filter((x) => x !== iid);
          changed = true;
        }
      }
      if (changed) next = { ...next, players: { ...next.players, [inst.owner]: copy } };
    }
  }

  if (inst.pileId && next.shop.piles[inst.pileId]) {
    const pile = next.shop.piles[inst.pileId];
    if (pile.cards.includes(iid)) {
      next = {
        ...next,
        shop: {
          ...next.shop,
          piles: {
            ...next.shop.piles,
            [inst.pileId]: { ...pile, cards: pile.cards.filter((x) => x !== iid) },
          },
        },
      };
    }
  }

  return next;
}

/** Put an already-detached instance into a player zone at a position. */
export function attach(
  state: GameState,
  iid: InstanceId,
  owner: PlayerId | null,
  zone: Zone,
  position: 'top' | 'bottom' = 'top',
): GameState {
  const inst = state.instances[iid];
  if (!inst) return state;

  const moved = copyInstance(inst);
  moved.owner = owner;
  moved.zone = zone;
  if (zone !== 'shop') delete moved.pileId;

  let next: GameState = { ...state, instances: { ...state.instances, [iid]: moved } };

  if (owner && isPlayerZone(zone)) {
    const p = next.players[owner];
    if (p) {
      const copy = copyPlayer(p);
      const arr = copy[zone].filter((x) => x !== iid);
      if (position === 'top') arr.unshift(iid);
      else arr.push(iid);
      copy[zone] = arr;
      next = { ...next, players: { ...next.players, [owner]: copy } };
    }
  }

  return next;
}

/**
 * Move one instance to a new owner/zone. Counters, granted keywords, instance
 * stat deltas and absorbed effects all ride along untouched (B63, B65).
 */
export function moveInstance(
  state: GameState,
  iid: InstanceId,
  owner: PlayerId | null,
  zone: Zone,
  position: 'top' | 'bottom' = 'top',
): GameState {
  if (!state.instances[iid]) return state;
  return attach(detach(state, iid), iid, owner, zone, position);
}

/** Push an instance onto a pile. `position` 'top' is what the next buyer gets (B49). */
export function attachToPile(
  state: GameState,
  iid: InstanceId,
  pileId: PileId,
  position: 'top' | 'bottom' = 'top',
): GameState {
  const pile = state.shop.piles[pileId];
  if (!pile || !state.instances[iid]) return state;

  const stripped = detach(state, iid);
  const inst = copyInstance(stripped.instances[iid]);
  inst.owner = null;
  inst.zone = 'shop';
  inst.pileId = pileId;

  const cards = pile.cards.filter((x) => x !== iid);
  if (position === 'top') cards.unshift(iid);
  else cards.push(iid);

  return {
    ...stripped,
    instances: { ...stripped.instances, [iid]: inst },
    shop: {
      ...stripped.shop,
      piles: { ...stripped.shop.piles, [pileId]: { ...pile, cards } },
    },
  };
}

/** Every instance a player holds across library + hand + gy + play. */
export function wholeDeck(state: GameState, playerId: PlayerId): InstanceId[] {
  const p = state.players[playerId];
  if (!p) return [];
  return [...p.library, ...p.hand, ...p.gy, ...p.play];
}
