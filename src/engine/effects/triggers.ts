/**
 * Trigger dispatch. Triggers enqueue *behind* whatever is already waiting, so
 * the card that caused them finishes first (gameplay doc §12.2.4).
 */
import type {
  GameState,
  InstanceId,
  PlayerId,
  QueuedEffect,
  TriggerEvent,
  Zone,
} from '@engine/types';
import {
  childItems,
  log,
  pushBack,
  tryGetCard,
  type EffectContext,
} from './runtime';
import { evalCondition } from './evaluate';
import resolveEffects from './index';
import { getAura, hasAura } from '@engine/registry';
import { discardInstance, shuffleZone, trashInstance } from '@engine/core/zones';

/** Events that only ever fire on the instance they happened to. */
const SELF_EVENTS: ReadonlySet<TriggerEvent> = new Set<TriggerEvent>([
  'onPlay',
  'onBuy',
  'onGain',
  'onDraw',
  'onDiscard',
  'onTrash',
  'onBuff',
  'onPlagueAdded',
]);

const DEFAULT_TRIGGER_ZONES: Zone[] = ['play', 'hand', 'field'];

function triggerAllowed(zone: Zone, allowed: Zone[] | undefined): boolean {
  if (allowed && allowed.length > 0) return allowed.indexOf(zone) >= 0;
  return DEFAULT_TRIGGER_ZONES.indexOf(zone) >= 0;
}

function budgetKey(event: TriggerEvent, turn: number): string {
  return 'trg:' + event + ':' + String(turn);
}

/**
 * Collect and enqueue every trigger that answers `event`.
 *
 * `subject` is the instance the event happened to (null for table-wide events
 * like a shuffle). `actor` is the player whose action caused it.
 */
export function fireEvent(
  s: GameState,
  q: QueuedEffect[],
  parent: QueuedEffect,
  event: TriggerEvent,
  subject: InstanceId | null,
  actor: PlayerId,
): void {
  const candidates: InstanceId[] = [];

  if (SELF_EVENTS.has(event)) {
    if (!subject) return;
    candidates.push(subject);
  } else {
    for (const iid of Object.keys(s.instances)) candidates.push(iid);
  }

  for (const iid of candidates) {
    const i = s.instances[iid];
    if (!i) continue;
    const def = tryGetCard(i.defId);
    if (!def || def.triggers.length === 0) continue;

    if (!SELF_EVENTS.has(event)) {
      if (!triggerAllowed(i.zone, undefined) && !def.triggers.some((t) => !!t.zones)) continue;
    }

    const owner = i.owner ?? actor;

    if (event === 'onOpponentBuy' || event === 'onOpponentPlay') {
      if (owner === actor) continue;
    }

    for (const trig of def.triggers) {
      if (trig.on !== event) continue;
      if (!SELF_EVENTS.has(event) && !triggerAllowed(i.zone, trig.zones)) continue;
      if (SELF_EVENTS.has(event) && trig.zones && trig.zones.indexOf(i.zone) < 0) continue;

      if (typeof trig.maxPerTurn === 'number' && trig.maxPerTurn > 0) {
        const key = budgetKey(event, s.turn);
        const used = typeof i.counters[key] === 'number' ? i.counters[key] : 0;
        if (used >= trig.maxPerTurn) continue;
        i.counters[key] = used + 1;
      }

      const ctx: EffectContext = {
        player: owner,
        sourceIid: iid,
        depth: parent.depth + 1,
        multiplier: 1,
        vars: {},
      };

      if (trig.condition && !evalCondition(s, trig.condition, ctx)) continue;
      if (trig.effects.length === 0) continue;

      pushBack(
        q,
        childItems(parent, trig.effects, {
          player: owner,
          sourceIid: iid,
          depth: parent.depth + 1,
          multiplier: 1,
          vars: {},
        }),
      );

      log(s, 'trigger', { event, iid, defId: i.defId }, owner);
    }
  }

  // Auras live in the Field and are not instances, so the loop above cannot see
  // them. Without this, an aura's onTrash / onDraw trigger never fires. A
  // self-event belongs to the player it happened to; a table-wide event reaches
  // every field.
  const fieldOwners = SELF_EVENTS.has(event)
    ? [subject ? s.instances[subject]?.owner ?? actor : actor]
    : s.playerOrder;
  for (const pid of fieldOwners) {
    const p = pid ? s.players[pid] : undefined;
    if (!p) continue;
    if ((event === 'onOpponentBuy' || event === 'onOpponentPlay') && pid === actor) continue;
    for (const aura of p.field) {
      const def = hasAura(aura.auraId) ? getAura(aura.auraId) : null;
      if (!def) continue;
      for (const trig of def.triggers) {
        if (trig.on !== event) continue;
        if (typeof trig.maxPerTurn === 'number' && trig.maxPerTurn > 0) {
          const key = budgetKey(event, s.turn);
          const used = typeof aura.counters[key] === 'number' ? aura.counters[key] : 0;
          if (used >= trig.maxPerTurn) continue;
          aura.counters[key] = used + 1;
        }
        const ctx: EffectContext = {
          player: pid,
          sourceIid: null,
          depth: parent.depth + 1,
          multiplier: 1,
          vars: {},
        };
        if (trig.condition && !evalCondition(s, trig.condition, ctx)) continue;
        if (trig.effects.length === 0) continue;
        pushBack(q, childItems(parent, trig.effects, ctx));
        log(s, 'auraTrigger', { event, auraId: aura.auraId }, pid);
      }
    }
  }
}


// ---------------------------------------------------------------------------
// Zone events (reconcile cluster C1)
// ---------------------------------------------------------------------------
//
// The surviving `core/zones.ts` moves an instance without firing anything, so
// the effects side wraps its own calls into it. These are the only places the
// interpreter trashes, discards or shuffles, which is what keeps CN Developer,
// Potato, Grapevine, Garlic, Chonker and the rest of the onTrash / onDiscard
// cards alive on the effects path.

/**
 * The window before a trash, in which a card may intervene.
 *
 * `onTrash` fires after the card is already in the trash, which is too late for
 * Safety Net ("the next card of yours trashed this turn goes to GY instead")
 * and The Fall Guy ("this leaps from your deck to take the fall"). Both need to
 * act while the card is still where it was.
 *
 * The subject is marked with `wouldTrash` so a trigger can NAME it — a trigger
 * body has no other handle on the card the event is about, and
 * `filter:{counter:{key:'wouldTrash',gte:1}}` is that handle. A responder
 * spares it by stamping `trashSpared` on it. Resolved inline, because a queued
 * response would run after the trash had already happened.
 *
 * Returns true when the trash should still go ahead.
 */
function offerTrashWindow(
  s: GameState,
  item: QueuedEffect,
  iid: InstanceId,
  owner: PlayerId,
): boolean {
  const subject = s.instances[iid];
  if (!subject) return true;
  const p = s.players[owner];
  if (!p) return true;

  const watchers: InstanceId[] = [...p.play, ...p.hand, ...p.gy, ...p.library].filter((other) => {
    const oi = s.instances[other];
    if (!oi) return false;
    return (tryGetCard(oi.defId)?.triggers ?? []).some((t) => t.on === 'onWouldTrash');
  });
  if (watchers.length === 0) return true;

  subject.counters['wouldTrash'] = 1;
  for (const watcher of watchers) {
    const wi = s.instances[watcher];
    if (!wi) continue;
    const def = tryGetCard(wi.defId);
    if (!def) continue;
    for (const trig of def.triggers) {
      if (trig.on !== 'onWouldTrash') continue;
      if (trig.zones && trig.zones.length && !trig.zones.includes(wi.zone)) continue;
      const ctx: EffectContext = {
        player: owner,
        sourceIid: watcher,
        depth: item.depth + 1,
        multiplier: 1,
        vars: {},
      };
      if (trig.condition && !evalCondition(s, trig.condition, ctx)) continue;
      Object.assign(s, resolveEffects(s, trig.effects, ctx));
    }
  }

  const after = s.instances[iid];
  const spared = !!after && (after.counters['trashSpared'] ?? 0) > 0;
  if (after) {
    delete after.counters['wouldTrash'];
    if (spared) delete after.counters['trashSpared'];
  }
  if (spared) {
    log(s, 'trashSpared', { iid, defId: after?.defId ?? null }, owner);
    // "Goes to GY instead" — the card survives, it just does not go to trash.
    if (after && after.zone !== 'trash') discardInstance(s, iid);
    return false;
  }
  return true;
}

/** Trash, then fire `onTrash` — only when the trash actually happened (B40). */
export function trashWithTrigger(
  s: GameState,
  item: QueuedEffect,
  q: QueuedEffect[],
  iid: InstanceId,
  actor?: PlayerId,
): boolean {
  const before = s.instances[iid];
  const owner = actor ?? before?.owner ?? item.player;
  if (!offerTrashWindow(s, item, iid, owner)) return false;
  const pair = before?.counters['pointerPair'] ?? 0;
  const done = trashInstance(s, iid);
  if (done) fireEvent(s, q, item, 'onTrash', iid, owner);

  // SB-7 Mutilate: a Pointer binding dies together. The partner carries the
  // same pair id, and the id is cleared on both so a rescued half cannot drag
  // its partner down twice.
  if (done && pair > 0) {
    for (const other of Object.keys(s.instances)) {
      if (other === iid) continue;
      const oi = s.instances[other];
      if (!oi || (oi.counters['pointerPair'] ?? 0) !== pair) continue;
      oi.counters['pointerPair'] = 0;
      const partnerOwner = oi.owner ?? owner;
      if (trashInstance(s, other)) {
        log(s, 'mutilate', { iid: other, defId: oi.defId, pair }, partnerOwner);
        fireEvent(s, q, item, 'onTrash', other, partnerOwner);
      }
    }
    const self = s.instances[iid];
    if (self) self.counters['pointerPair'] = 0;
  }
  return done;
}

/**
 * Discard, then fire `onDiscard`. A Temporary card is trashed by the discard
 * (B11), so `onTrash` fires as well when the card ended up in the trash.
 */
export function discardWithTrigger(
  s: GameState,
  item: QueuedEffect,
  q: QueuedEffect[],
  iid: InstanceId,
  actor?: PlayerId,
): void {
  const before = s.instances[iid];
  if (!before) return;
  const owner = actor ?? before.owner ?? item.player;
  discardInstance(s, iid);
  fireEvent(s, q, item, 'onDiscard', iid, owner);
  const after = s.instances[iid];
  if (after && after.zone === 'trash') fireEvent(s, q, item, 'onTrash', iid, owner);
}

/** Shuffle a zone, then fire the table-wide `onShuffle`. */
export function shuffleWithTrigger(
  s: GameState,
  item: QueuedEffect,
  q: QueuedEffect[],
  player: PlayerId,
  zone: Zone,
): void {
  shuffleZone(s, player, zone);
  fireEvent(s, q, item, 'onShuffle', null, player);
}
