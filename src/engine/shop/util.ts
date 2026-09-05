/**
 * Shop slice internals: state cloning, logging, instance ids, pile identity.
 *
 * Everything in the shop slice treats GameState as immutable. These helpers do
 * the shallow copy-on-write dance once so the rest of the slice can stay
 * readable.
 */

import type {
  CardDefId,
  CardDefinition,
  GameState,
  InstanceId,
  LogEntry,
  Pile,
  PileId,
  PlayerId,
  ShopState,
} from '@engine/types';
import { getCard } from '@engine/registry';

/** Pile ids are built as `<shop>:<defId>`. Nothing outside this slice parses them. */
export const PILE_ID_SEP = ':';

export function makePileId(shop: 'resource' | 'points' | 'prophet' | 'draft', defId: CardDefId): PileId {
  return `${shop}${PILE_ID_SEP}${defId}`;
}

/**
 * The definition a pile sells. Prefers the top card so a pile whose contents
 * were transformed still reports truthfully; falls back to the id encoding so
 * an emptied pile still knows what it was.
 */
export function pileDefId(state: GameState, pileId: PileId): CardDefId | null {
  const pile = state.shop.piles[pileId];
  if (pile) {
    for (const iid of pile.cards) {
      const inst = state.instances[iid];
      if (inst) return inst.defId;
    }
  }
  const cut = pileId.indexOf(PILE_ID_SEP);
  if (cut >= 0 && cut < pileId.length - 1) return pileId.slice(cut + 1);
  return null;
}

/** getCard throws on unknown ids; shop construction should skip, not explode. */
export function safeGetCard(defId: CardDefId): CardDefinition | null {
  try {
    return getCard(defId);
  } catch {
    return null;
  }
}

export function nextIid(seq: number): InstanceId {
  return `i_${String(seq).padStart(4, '0')}`;
}

/** Shallow clone with a fresh shop container. Piles themselves are shared until written. */
export function cloneState(state: GameState): GameState {
  const shop: ShopState = {
    piles: { ...state.shop.piles },
    order: {
      resource: [...state.shop.order.resource],
      points: [...state.shop.order.points],
      prophet: [...state.shop.order.prophet],
      draft: [...state.shop.order.draft],
    },
    globalCostMods: [...state.shop.globalCostMods],
  };
  return { ...state, shop };
}

export function clonePile(pile: Pile): Pile {
  return {
    ...pile,
    cards: [...pile.cards],
    locks: pile.locks.map((l) => ({ ...l })),
    costMods: pile.costMods.map((m) => ({ ...m })),
  };
}

/** Copy-on-write a single pile into a cloned state. */
export function withPile(state: GameState, pileId: PileId, mutate: (pile: Pile) => void): GameState {
  const existing = state.shop.piles[pileId];
  if (!existing) return state;
  const next = cloneState(state);
  const pile = clonePile(existing);
  mutate(pile);
  next.shop.piles[pileId] = pile;
  return next;
}

export function appendLog(
  state: GameState,
  kind: string,
  detail: Record<string, unknown>,
  player: PlayerId | null = null,
): GameState {
  const seq = state.logSeq + 1;
  const entry: LogEntry = { seq, turn: state.turn, player, kind, detail };
  return { ...state, log: [...state.log, entry], logSeq: seq };
}

export function roundInt(n: number): number {
  return Math.round(n);
}

export function playerCountOf(state: GameState): number {
  if (state.playerOrder.length > 0) return state.playerOrder.length;
  return Math.max(1, state.config.playerCount);
}
