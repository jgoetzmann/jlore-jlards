/**
 * The turn's shortcuts, as pure functions of a `GameView` (TURN-2, 7, 9, 10).
 *
 *   - `playMoneyPlan`: what "Play money (+N)" would send, or why it won't.
 *   - `isInertPlay`: a card whose play only adds combo (a Tix), so it is not
 *     counted as "playable" and does not glow — but stays clickable (B71).
 *   - `turnDone`: nothing left to do but End turn.
 *   - `submitsOnPick`: a prompt that is answered by the click itself.
 *
 * Every rule here is UI-only. None of it changes what the engine allows.
 */

import type { CardView, GameView, InstanceId, Prompt } from '@engine/types';
import { getCard, hasCard } from '@engine/registry';
import { canAfford } from './Board';
import { HEROIC_ACTIVATION_COST } from './Field';

// ---------------------------------------------------------------------------
// Play money
// ---------------------------------------------------------------------------

/**
 * Actions that consume Resources from your hand (src/cards/economy/resources.ts).
 * Playing every Resource first would take away the very cards they need.
 */
export const RESOURCE_CONSUMERS: ReadonlySet<string> = new Set([
  'simple_refining',
  'advanced_refining',
  'pennymelting',
  'currency_cremator',
]);

/** Auras whose effect depends on the order cards are played in. */
export const ORDER_SENSITIVE_AURAS: ReadonlySet<string> = new Set(['symphony_of_3']);

/**
 * Anomalies that make play order matter. Dongfang Youxi Sheji is the "five
 * elements" rule: each play's multiplier depends on the element played before
 * it (`elementMultiplierFor` / `lastElement` in core/play.ts).
 */
export const ORDER_SENSITIVE_ANOMALIES: ReadonlySet<string> = new Set(['dongfang_youxi_sheji']);

/**
 * A Resource whose play is nothing but its stat line: no keywords, no effects,
 * no triggers. Only these are safe to play in bulk — Copper, Silver, Gold and
 * the rest of the plain money.
 */
export function isPlainResource(card: CardView): boolean {
  if (!card.types.includes('Resource')) return false;
  if (card.keywords.length > 0) return false;
  if (typeof card.stats.money !== 'number' || card.stats.money <= 0) return false;
  if (!hasCard(card.defId)) return false;
  const def = getCard(card.defId);
  return def.effects.length === 0 && def.triggers.length === 0 && def.keywords.length === 0;
}

export interface PlayMoneyPlan {
  /** The cards to play, highest Money first. Empty when blocked. */
  iids: InstanceId[];
  /** What the Money readout would gain. */
  total: number;
  /** Why the button is disabled, or null when it can be pressed. */
  blocked: string | null;
}

/**
 * One `play` per plain Resource in hand, highest Money first, so a "your next
 * Resource gets +N" buff (consumePlayMods) lands on the biggest card. Ties keep
 * hand order.
 */
export function playMoneyPlan(view: GameView): PlayMoneyPlan {
  const you = view.you;
  const plain = you.hand
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => card.playable !== false && isPlainResource(card));
  plain.sort((a, b) => (b.card.stats.money ?? 0) - (a.card.stats.money ?? 0) || a.index - b.index);
  const iids = plain.map((p) => p.card.iid);
  const total = plain.reduce((sum, p) => sum + (p.card.stats.money ?? 0), 0);

  let blocked: string | null = null;
  if (view.ended) blocked = 'The game is over';
  else if (view.activePlayer !== you.id) blocked = 'Not your turn';
  else if (view.pending !== null && view.pending !== undefined) blocked = 'Answer the open prompt first';
  else if (iids.length === 0) blocked = 'No plain money in hand';
  else if (you.hand.some((c) => RESOURCE_CONSUMERS.has(c.defId))) {
    blocked = 'An Action in your hand uses Resources — play money by hand';
  } else if (you.field.some((a) => ORDER_SENSITIVE_AURAS.has(a.auraId))) {
    blocked = 'An aura counts your plays — play money by hand';
  } else if (view.anomaly && ORDER_SENSITIVE_ANOMALIES.has(view.anomaly.id)) {
    blocked = 'This anomaly makes play order matter — play money by hand';
  }

  return blocked === null ? { iids, total, blocked } : { iids: [], total, blocked };
}

// ---------------------------------------------------------------------------
// Inert plays (TURN-9)
// ---------------------------------------------------------------------------

/**
 * A non-Action card whose play gives nothing but +1 combo — no Money, Cards,
 * Actions, Buys or Prophet, no keywords, no effects. Tix is the common one.
 *
 * Not "useless": the play still counts toward combo (B71), a "play 5 cards"
 * quest and Symphony of 3, and it takes the card out of the hand. So these
 * stay clickable; they just aren't advertised as playable.
 */
export function isInertPlay(card: CardView): boolean {
  if (card.types.includes('Action')) return false;
  const s = card.stats;
  for (const k of ['money', 'cards', 'actions', 'buys', 'prophet'] as const) {
    const v = s[k];
    if (typeof v === 'number' && v !== 0) return false;
  }
  if (card.keywords.length > 0) return false;
  if (!hasCard(card.defId)) return false;
  const def = getCard(card.defId);
  return def.effects.length === 0 && def.triggers.length === 0;
}

/** Playable, and worth advertising as such. */
export function isUsefulPlay(card: CardView, yourTurn: boolean): boolean {
  return yourTurn && card.playable !== false && !isInertPlay(card);
}

// ---------------------------------------------------------------------------
// Turn done (TURN-10)
// ---------------------------------------------------------------------------

/**
 * Nothing left but End turn: no useful play in hand, nothing buyable, no Heroic
 * aura you can still activate, no prompt open. Auto-ending stays off — a
 * Points card is always playable, and End turn can't be undone.
 */
export function turnDone(view: GameView): boolean {
  const you = view.you;
  if (view.ended || view.activePlayer !== you.id) return false;
  if (view.pending !== null && view.pending !== undefined) return false;
  if (you.hand.some((c) => isUsefulPlay(c, true))) return false;
  const piles = [...view.shop.resource, ...view.shop.points, ...view.shop.prophet, ...view.shop.draft];
  for (const p of piles) {
    if (p.count <= 0 || p.top === null) continue;
    if (!p.prophetCost && you.buys <= 0) continue;
    if (canAfford(p, you.money, you.prophet)) return false;
  }
  if (you.field.some((a) => a.tier === 'heroic' && !a.usedThisTurn && you.money >= HEROIC_ACTIVATION_COST)) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Prompts (TURN-7)
// ---------------------------------------------------------------------------

/**
 * One click answers it: a Discover or choose-one with exactly one pick. Every
 * other prompt keeps Confirm — multi-selects, orderings, and anything that
 * selects your own cards (a trash or discard, where a misclick costs a card).
 */
export function submitsOnPick(prompt: Pick<Prompt, 'type' | 'min' | 'max'>): boolean {
  if (prompt.type !== 'discover' && prompt.type !== 'choose') return false;
  const min = typeof prompt.min === 'number' ? prompt.min : 1;
  const max = typeof prompt.max === 'number' ? prompt.max : Math.max(min, 1);
  return min === 1 && max === 1;
}
