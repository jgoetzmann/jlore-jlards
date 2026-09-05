/**
 * The view filter - the only security in the system.
 *
 * B21  Libraries are counts only, for every player, including the viewer's own.
 *      No library instance's defId ever reaches a view.
 * B22  Opponents' hands are counts only, with no card identities.
 * B23  A pending prompt ships its options only to the player who must choose;
 *      everyone else gets `{ waitingOn }`.
 * B24  An instance's `secret` values appear only in the owner's view.
 * B111 A serialized view never contains an instance id that lives in another
 *      player's library or hand - the log is scrubbed for those ids too.
 * B120 `displayTextOverride` replaces a card's text in every view.
 */

import type {
  AnomalyId,
  CardDefinition,
  CardInstance,
  CardView,
  GameState,
  GameView,
  InstanceId,
  LogEntry,
  OpponentView,
  PileId,
  PileView,
  PlayerId,
  Prompt,
  PromptOption,
  SelfView,
  Stats,
} from '@engine/types';
import * as Meta from '@engine/meta';
import { isLocked } from '@engine/shop';
import { canPlayCard } from './core/play.js';
import { canBuyPile, priceFor } from './core/buy.js';
import { effectiveKeywords, effectiveStats } from '@engine/systems';
import { safeDef, topOfPile } from './core/zones.js';
import { getAura, hasAura } from './registry.js';

const MAX_LOG_ENTRIES = 250;
const INTERNAL_COUNTER_PREFIXES = ['trg:', 'podChain'];

// ---------------------------------------------------------------------------
// Card text
// ---------------------------------------------------------------------------

function publicCounters(inst: CardInstance): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(inst.counters)) {
    if (INTERNAL_COUNTER_PREFIXES.some((p) => key.startsWith(p))) continue;
    out[key] = inst.counters[key] as number;
  }
  return out;
}

/**
 * Substitutes `{token}` placeholders against live instance state. Counters win,
 * then per-instance stat deltas, then the effective stat line. Secrets resolve
 * only for the owner (B24); everyone else sees `?`.
 */
export function renderCardText(state: GameState, iid: InstanceId, viewer: PlayerId): string {
  const inst = state.instances[iid];
  if (!inst) return '';
  // B120: the display string is what reaches the view, whatever the effect does.
  if (inst.displayTextOverride) return inst.displayTextOverride;

  const def = safeDef(inst.defId);
  const template = def.text ?? '';
  if (!template.includes('{')) return template;

  const stats = effectiveStats(state, iid);
  const isOwner = inst.owner === viewer;

  return template.replace(/\{([A-Za-z0-9_.]+)\}/g, (whole, rawKey: string) => {
    const key = rawKey;

    if (key === 'name') return def.name;
    if (key === 'cost') return String(def.cost.money ?? 0);
    if (key === 'plague') return String(inst.counters['plague'] ?? 0);

    if (Object.prototype.hasOwnProperty.call(inst.counters, key)) {
      if (INTERNAL_COUNTER_PREFIXES.some((p) => key.startsWith(p))) return '0';
      return String(inst.counters[key]);
    }
    if (inst.secret && Object.prototype.hasOwnProperty.call(inst.secret, key)) {
      return isOwner ? String(inst.secret[key]) : '?';
    }
    if (Object.prototype.hasOwnProperty.call(inst.statDelta, key)) {
      return String(inst.statDelta[key as keyof Stats] ?? 0);
    }
    if (Object.prototype.hasOwnProperty.call(stats, key)) {
      return String(stats[key as keyof Stats] ?? 0);
    }
    const playCount = state.players[inst.owner ?? '']?.playCounts[inst.defId];
    if (key === 'playCount' || key === 'selfPlayCount') return String(playCount ?? 0);
    if (key === 'turn') return String(state.turn);
    return '0';
  });
}

// ---------------------------------------------------------------------------
// Card views
// ---------------------------------------------------------------------------

function baseCostOf(state: GameState, def: CardDefinition): number | null {
  if (def.cost.money === undefined) return null;
  const variant = state.variants[def.id];
  return def.cost.money + (variant?.costDelta ?? 0);
}

export function cardView(
  state: GameState,
  iid: InstanceId,
  viewer: PlayerId,
  extra?: { playable?: boolean; affordable?: boolean; cost?: number | null },
): CardView {
  const inst = state.instances[iid];
  const def = safeDef(inst ? inst.defId : iid);
  const counters = inst ? publicCounters(inst) : {};

  // B24: secrets fold into the owner's counters and nobody else's.
  if (inst && inst.secret && inst.owner === viewer) {
    for (const key of Object.keys(inst.secret)) {
      counters[`secret:${key}`] = inst.secret[key] as number;
    }
  }

  const view: CardView = {
    iid,
    defId: def.id,
    name: def.name,
    cost: extra?.cost !== undefined ? extra.cost : baseCostOf(state, def),
    prophetCost: def.cost.prophet ?? null,
    types: [...def.types],
    subtypes: [...def.subtypes],
    rarity: def.rarity,
    keywords: inst ? effectiveKeywords(state, iid) : [...def.keywords],
    stats: inst ? effectiveStats(state, iid) : { ...def.stats },
    text: inst ? renderCardText(state, iid, viewer) : def.text,
    counters,
  };
  if (def.art) view.art = def.art;
  if (extra?.playable !== undefined) view.playable = extra.playable;
  if (extra?.affordable !== undefined) view.affordable = extra.affordable;
  return view;
}

function cardViews(state: GameState, iids: InstanceId[], viewer: PlayerId): CardView[] {
  return iids.map((iid) => cardView(state, iid, viewer));
}

// ---------------------------------------------------------------------------
// Piles
// ---------------------------------------------------------------------------

function pileLockedUntil(state: GameState, pileId: PileId): number | null {
  const pile = state.shop.piles[pileId];
  if (!pile || pile.locks.length === 0) return null;
  let latest: number | null = null;
  for (const lock of pile.locks) {
    if (lock.expiresOnTurn === null) return null;
    latest = latest === null ? lock.expiresOnTurn : Math.max(latest, lock.expiresOnTurn);
  }
  return latest;
}

export function pileView(state: GameState, pileId: PileId, viewer: PlayerId): PileView {
  const pile = state.shop.piles[pileId];
  const topIid = topOfPile(state, pileId);
  let locked = false;
  try {
    locked = isLocked(state, pileId);
  } catch {
    locked = (pile?.locks.length ?? 0) > 0;
  }
  const cost = topIid ? priceFor(state, pileId, viewer) : null;
  const topDef = topIid ? safeDef(state.instances[topIid]!.defId) : null;
  const affordable = topIid ? canBuyPile(state, viewer, pileId) : false;

  return {
    id: pileId,
    shop: pile?.shop ?? 'draft',
    top: topIid ? cardView(state, topIid, viewer, { cost, affordable }) : null,
    count: pile?.cards.length ?? 0,
    cost,
    prophetCost: topDef?.cost.prophet ?? null,
    locked,
    lockedUntil: pileLockedUntil(state, pileId),
  };
}

function pileViews(state: GameState, ids: PileId[], viewer: PlayerId): PileView[] {
  return ids.filter((id) => !!state.shop.piles[id]).map((id) => pileView(state, id, viewer));
}

// ---------------------------------------------------------------------------
// Hidden-id scrubbing (B111)
// ---------------------------------------------------------------------------

function hiddenIids(state: GameState, viewer: PlayerId): Set<InstanceId> {
  const hidden = new Set<InstanceId>();
  for (const pid of state.playerOrder) {
    const p = state.players[pid];
    if (!p) continue;
    for (const iid of p.library) hidden.add(iid); // B21: every library, always
    if (pid !== viewer) for (const iid of p.hand) hidden.add(iid); // B22
  }
  return hidden;
}

function scrubValue(value: unknown, hidden: Set<InstanceId>): unknown {
  if (typeof value === 'string') return hidden.has(value) ? 'hidden' : value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, hidden));
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let sawHidden = false;
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (typeof v === 'string' && hidden.has(v)) sawHidden = true;
      out[k] = scrubValue(v, hidden);
    }
    // A log line about a hidden card must not leak what it was.
    if (sawHidden && typeof out['defId'] === 'string') out['defId'] = 'hidden';
    return out;
  }
  return value;
}

function scrubLog(state: GameState, viewer: PlayerId, hidden: Set<InstanceId>): LogEntry[] {
  const tail = state.log.slice(-MAX_LOG_ENTRIES);
  return tail.map((entry) => ({
    seq: entry.seq,
    turn: entry.turn,
    player: entry.player,
    kind: entry.kind,
    detail: scrubValue(entry.detail, hidden) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/** B23: the full prompt for its owner, `{ waitingOn }` for everybody else. */
function pendingView(
  state: GameState,
  viewer: PlayerId,
  hidden: Set<InstanceId>,
): Prompt | { waitingOn: PlayerId } | null {
  const prompt = state.pending;
  if (!prompt) return null;
  if (prompt.player !== viewer) return { waitingOn: prompt.player };

  // Even in your own prompt, an option must never name a card in somebody
  // else's library or hand.
  const options: PromptOption[] = prompt.options.map((o) => {
    if (o.iid && hidden.has(o.iid)) {
      const stripped: PromptOption = { key: o.key, label: o.label };
      if (o.pileId) stripped.pileId = o.pileId;
      return stripped;
    }
    return { ...o };
  });

  return {
    id: prompt.id,
    type: prompt.type,
    player: prompt.player,
    prompt: prompt.prompt,
    options,
    min: prompt.min,
    max: prompt.max,
    then: [],
    ctx: {},
    defaultKeys: [...prompt.defaultKeys],
  };
}

// ---------------------------------------------------------------------------
// Anomaly
// ---------------------------------------------------------------------------

function titleCase(id: string): string {
  return id
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function anomalyView(anomalyId: AnomalyId | null): { id: AnomalyId; name: string; text: string } | null {
  if (!anomalyId) return null;
  const lookup = (Meta as unknown as Record<string, unknown>)['getAnomaly'];
  if (typeof lookup === 'function') {
    try {
      const def = (lookup as (id: AnomalyId) => { name?: string; text?: string } | null)(anomalyId);
      if (def) {
        return { id: anomalyId, name: def.name ?? titleCase(anomalyId), text: def.text ?? '' };
      }
    } catch {
      /* fall through to the derived name */
    }
  }
  return { id: anomalyId, name: titleCase(anomalyId), text: '' };
}

// ---------------------------------------------------------------------------
// viewFor
// ---------------------------------------------------------------------------

function auraLine(auraId: string): { name: string; tier: 'heroic' | 'celestial' | 'hypercelestial'; text: string } {
  if (hasAura(auraId)) {
    const def = getAura(auraId);
    return { name: def.name, tier: def.tier, text: def.text };
  }
  return { name: titleCase(auraId), tier: 'celestial', text: '' };
}

export function viewFor(state: GameState, playerId: PlayerId): GameView {
  const hidden = hiddenIids(state, playerId);
  const me = state.players[playerId];

  const you: SelfView = me
    ? {
        id: me.id,
        name: me.name,
        hand: me.hand.map((iid) =>
          cardView(state, iid, playerId, { playable: canPlayCard(state, playerId, iid) }),
        ),
        play: cardViews(state, me.play, playerId),
        gy: cardViews(state, me.gy, playerId),
        field: me.field.map((a) => {
          const line = auraLine(a.auraId);
          return {
            auraId: a.auraId,
            name: line.name,
            tier: line.tier,
            text: line.text,
            usedThisTurn: a.usedThisTurn,
          };
        }),
        // B21: your own library is a count too.
        libraryCount: me.library.length,
        money: me.money,
        buys: me.buys,
        actions: me.actions,
        prophet: me.prophet,
        vp: me.vp,
        combo: me.combo,
        delayedCount: me.delayed.length,
        quest: me.quest,
      }
    : {
        id: playerId,
        name: playerId,
        hand: [],
        play: [],
        gy: [],
        field: [],
        libraryCount: 0,
        money: 0,
        buys: 0,
        actions: 0,
        prophet: 0,
        vp: 0,
        combo: 0,
        delayedCount: 0,
        quest: null,
      };

  const others: OpponentView[] = [];
  for (const pid of state.playerOrder) {
    if (pid === playerId) continue;
    const p = state.players[pid];
    if (!p) continue;
    others.push({
      id: p.id,
      name: p.name,
      // B22: a count, never identities.
      handCount: p.hand.length,
      libraryCount: p.library.length,
      gy: cardViews(state, p.gy, playerId),
      play: cardViews(state, p.play, playerId),
      field: p.field.map((a) => {
        const line = auraLine(a.auraId);
        return { auraId: a.auraId, name: line.name, tier: line.tier, text: line.text };
      }),
      vp: p.vp,
      prophet: p.prophet,
      eliminated: p.eliminated,
    });
  }

  return {
    you,
    others,
    shop: {
      resource: pileViews(state, state.shop.order.resource, playerId),
      points: pileViews(state, state.shop.order.points, playerId),
      prophet: pileViews(state, state.shop.order.prophet, playerId),
      draft: pileViews(state, state.shop.order.draft, playerId),
    },
    turn: state.turn,
    round: state.round,
    activePlayer: state.activePlayer,
    anomaly: anomalyView(state.anomaly),
    pending: pendingView(state, playerId, hidden),
    ended: state.ended,
    winners: state.winners,
    endReason: state.endReason,
    log: scrubLog(state, playerId, hidden),
    doomsdayCounter: state.doomsdayCounter,
    hardEndTurn: state.hardEndTurn,
  };
}
