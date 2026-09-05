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
  const done = trashInstance(s, iid);
  if (done) fireEvent(s, q, item, 'onTrash', iid, owner);
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
