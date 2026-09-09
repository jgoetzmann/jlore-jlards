/**
 * Shared plumbing for the effect interpreter: the resolution context,
 * logging, seeded randomness, and the small def/instance
 * readers every op needs.
 *
 * All randomness comes from the seeded rng in `withRng` (B117).
 */
import type {
  CardDefinition,
  CardVariant,
  GameState,
  InstanceId,
  LogEntry,
  PlayerId,
  QueuedEffect,
  Who,
  EffectNode,
} from '@engine/types';
import { makeRng, type Rng } from '@engine/rng';
import { getCard } from '@engine/registry';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface EffectContext {
  player: PlayerId;
  sourceIid: InstanceId | null;
  depth: number;
  multiplier: number;
  vars: Record<string, number>;
}

export function contextOf(item: QueuedEffect): EffectContext {
  return {
    player: item.player,
    sourceIid: item.sourceIid,
    depth: item.depth,
    multiplier: item.multiplier,
    vars: item.vars,
  };
}

export function childItem(
  item: QueuedEffect,
  node: EffectNode,
  over?: Partial<QueuedEffect>,
): QueuedEffect {
  return {
    node,
    player: over && over.player !== undefined ? over.player : item.player,
    sourceIid: over && over.sourceIid !== undefined ? over.sourceIid : item.sourceIid,
    depth: over && over.depth !== undefined ? over.depth : item.depth + 1,
    multiplier: over && over.multiplier !== undefined ? over.multiplier : item.multiplier,
    vars: over && over.vars !== undefined ? over.vars : { ...item.vars },
  };
}

export function childItems(
  item: QueuedEffect,
  nodes: readonly EffectNode[],
  over?: Partial<QueuedEffect>,
): QueuedEffect[] {
  const out: QueuedEffect[] = [];
  for (const n of nodes) out.push(childItem(item, n, over));
  return out;
}

/** Sub-effects run before the caller's later siblings. */
export function pushFront(q: QueuedEffect[], items: QueuedEffect[]): void {
  if (items.length === 0) return;
  q.unshift(...items);
}

/** Triggers enqueue behind everything already waiting (gameplay doc §12.2.4). */
export function pushBack(q: QueuedEffect[], items: QueuedEffect[]): void {
  if (items.length === 0) return;
  q.push(...items);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export function log(
  s: GameState,
  kind: string,
  detail: Record<string, unknown>,
  player: PlayerId | null = null,
): LogEntry {
  s.logSeq = (s.logSeq ?? 0) + 1;
  const entry: LogEntry = { seq: s.logSeq, turn: s.turn, player, kind, detail };
  s.log.push(entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/** Borrow an rng, run `fn`, and write the advanced cursor back into state. */
export function withRng<T>(s: GameState, fn: (r: Rng) => T): T {
  const r = makeRng(s.seed, s.rngCursor);
  const out = fn(r);
  s.rngCursor = r.cursor();
  return out;
}

/** A read-only rng for pure query paths that must not advance the cursor. */
export function peekRng(s: GameState, salt: number): Rng {
  return makeRng(s.seed, s.rngCursor + salt);
}

// ---------------------------------------------------------------------------
// Definition / instance readers
// ---------------------------------------------------------------------------

export function tryGetCard(defId: string): CardDefinition | null {
  try {
    return getCard(defId);
  } catch {
    return null;
  }
}

export function defOfInstance(s: GameState, iid: InstanceId): CardDefinition | null {
  const i = s.instances[iid];
  if (!i) return null;
  return tryGetCard(i.defId);
}

export function variantOf(s: GameState, defId: string): CardVariant | null {
  const v = s.variants[defId];
  return v ?? null;
}

export function defCost(s: GameState, defId: string): number {
  const def = tryGetCard(defId);
  const base = def && typeof def.cost.money === 'number' ? def.cost.money : 0;
  const v = variantOf(s, defId);
  return base + (v ? v.costDelta : 0);
}

export function instanceCost(s: GameState, iid: InstanceId): number {
  const i = s.instances[iid];
  if (!i) return 0;
  if (i.zone === 'shop' && i.pileId) {
    const pile = s.shop.piles[i.pileId];
    if (pile && typeof pile.costOverride === 'number') return pile.costOverride;
  }
  return defCost(s, i.defId);
}

export function bumpCounter(s: GameState, iid: InstanceId, key: string, by: number): void {
  const i = s.instances[iid];
  if (!i) return;
  const cur = typeof i.counters[key] === 'number' ? i.counters[key] : 0;
  i.counters[key] = cur + by;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export function livePlayers(s: GameState): PlayerId[] {
  return s.playerOrder.filter((id) => {
    const p = s.players[id];
    return !!p && !p.eliminated;
  });
}

export function opponentsOf(s: GameState, player: PlayerId): PlayerId[] {
  return livePlayers(s).filter((id) => id !== player);
}

/** Resolve a `Who` to concrete player ids. `rng` may be null for pure reads. */
export function resolveWho(
  s: GameState,
  who: Who | undefined,
  player: PlayerId,
  rng: Rng | null,
  sourceIid?: InstanceId | null,
): PlayerId[] {
  switch (who) {
    case 'activePlayer':
      // Inside a trigger `self` is the instance's owner, so "the current
      // player" needs its own name — Recurring Felinor goes to the GY of
      // whoever is taking the turn, not of whoever owns the card.
      return [s.activePlayer];
    case 'nextPlayer': {
      const live = livePlayers(s);
      if (live.length === 0) return [];
      const at = live.indexOf(player);
      return [live[(at < 0 ? 0 : at + 1) % live.length] as PlayerId];
    }
    case 'owner': {
      const inst = sourceIid ? s.instances[sourceIid] : undefined;
      return [inst?.owner ?? player];
    }
    case 'eachOpponent':
      return opponentsOf(s, player);
    case 'randomOpponent': {
      const opps = opponentsOf(s, player);
      if (opps.length === 0) return [];
      if (!rng) return [opps[0]];
      return [rng.pick(opps)];
    }
    case 'chosenOpponent': {
      // Resolved as "the opponent with the most VP" when no prompt is attached;
      // the choosing form goes through the selectPlayer prompt in choices.ts.
      const opps = opponentsOf(s, player);
      if (opps.length === 0) return [];
      let best = opps[0];
      for (const id of opps) {
        const a = s.players[id];
        const b = s.players[best];
        if (a && b && a.vp > b.vp) best = id;
      }
      return [best];
    }
    case 'eachPlayer':
      return livePlayers(s);
    case 'self':
    default:
      return [player];
  }
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

export function uniq<T>(arr: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of arr) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
