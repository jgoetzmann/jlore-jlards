/**
 * npm run cards:validate
 *
 * The QA net for adding cards without reading engine code. Every failure prints
 * one line naming the card and the problem; a non-empty failure list exits 1.
 *
 * Covers B95, B96, B97, B99, B102, B103, B104 and the token rule from B62.
 */

import type { AuraDefinition, CardDefinition, Complexity } from '@engine/types';
import { allAuraDefinitions, allCardDefinitions } from '@cards/index';
import { NAMED_FILTERS } from '@engine/effects';
import { PROPHET_SHOP_CARD_IDS } from '@engine/shop/prophet';
import { bootstrap } from './bootstrap';

/**
 * `$discovered` and `$selected` stand in for the card the player picked, and
 * are swapped for a real defId at resolve time (substituteDefId in
 * effects/ops/choices.ts). They are legal wherever a defId is, and are not
 * catalog entries.
 */
function isSentinel(ref: string): boolean {
  return ref === '$discovered' || ref === '$selected';
}

/** Every filter name used by a `count(x)` / `countIn(zone, x)` in an expression. */
export function filterNamesIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (!v || typeof v !== 'object') return;
    const obj = v as Record<string, unknown>;
    const expr = obj.expr;
    if (typeof expr === 'string') {
      const re = /\bcount(?:In)?\s*\(\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\s*,\s*)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/g;
      let m = re.exec(expr);
      while (m !== null) {
        out.add(m[1]);
        m = re.exec(expr);
      }
    }
    for (const key of Object.keys(obj)) visit(obj[key]);
  };
  visit(value);
  return out;
}

/**
 * Every `op` in the EffectNode union in src/engine/types.ts. A type union has no
 * runtime form, so this list is the runtime mirror of it — when the union grows,
 * this grows with it, and until then a typo in card data is caught here.
 */
export const KNOWN_OPS: string[] = [
  'gain',
  'draw',
  'mill',
  'discard',
  'discardDownTo',
  'trash',
  'moveTo',
  'createCard',
  'gainCard',
  'copyCard',
  'transform',
  'recruit',
  'fuse',
  'shuffle',
  'sortLibraryByCost',
  'reveal',
  'discover',
  'choose',
  'selectCards',
  'lockPile',
  'unlockPile',
  'modifyCost',
  'replenishPile',
  'trashPile',
  'swapPileCosts',
  'addToPileTop',
  'mergePiles',
  'manifestAura',
  'activateAura',
  'buff',
  'nerf',
  'upgradeRelic',
  'delayed',
  'nextCardModifier',
  'endTurn',
  'extraTurn',
  'conditional',
  'repeat',
  'forEach',
  'random',
  'sequence',
  'playCard',
  'replayPlayedThisTurn',
  'multiplyNext',
  'plague',
  'removePlague',
  'addCounter',
  'scoreOnCard',
  'setKeyword',
  'resetCombo',
  'endGame',
  'incDoomsday',
  'questProgress',
  'noop',
];

const OP_SET: Record<string, boolean> = {};
for (const op of KNOWN_OPS) OP_SET[op] = true;

const COMPLEXITIES: Record<string, boolean> = { T1: true, T2: true, T3: true, T4: true };

interface Node {
  op: string;
  raw: Record<string, unknown>;
}

/**
 * Deep-walk anything and collect every object carrying a string `op`.
 * This catches nested `then`, `else`, `effects`, `branches[].effects`,
 * `options[].effects` and `nextCardModifier.mod.appendEffects` in one pass,
 * without hard-coding the shape of every container.
 */
export function collectNodes(value: unknown, seen: Set<unknown>, out: Node[]): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, seen, out);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.op === 'string') out.push({ op: obj.op, raw: obj });
  for (const key of Object.keys(obj)) collectNodes(obj[key], seen, out);
}

function nodesOf(card: CardDefinition | AuraDefinition): Node[] {
  const out: Node[] = [];
  const seen = new Set<unknown>();
  collectNodes(card.effects, seen, out);
  collectNodes(card.triggers, seen, out);
  return out;
}

function isToken(card: CardDefinition): boolean {
  if (card.rarity === 'token') return true;
  return Array.isArray(card.types) && card.types.indexOf('Token') >= 0;
}

function main(): void {
  // Validate the *authored* catalog, not the registry's view of it. The
  // registry is keyed by id, so it silently drops a second definition of the
  // same card — asking it for duplicates can never find any. Reading the
  // barrels directly is what makes the uniqueness checks below able to fail.
  bootstrap();
  const cards = allCardDefinitions();
  const auras = allAuraDefinitions();
  const problems: string[] = [];
  const fail = (id: string, msg: string): void => {
    problems.push(id + ': ' + msg);
  };

  if (cards.length === 0) fail('registry', 'no card definitions registered');

  const byId: Record<string, number> = {};
  const byName: Record<string, string[]> = {};
  const byArtKey: Record<string, string[]> = {};
  const known: Record<string, boolean> = {};
  const knownAuras: Record<string, boolean> = {};
  for (const c of cards) known[c.id] = true;
  for (const a of auras) knownAuras[a.id] = true;

  for (const card of cards) {
    const id = card.id ? card.id : '<missing id>';

    // --- identity (B95, B103) ---
    if (!card.id) fail('<unnamed>', 'card has no id');
    byId[id] = (byId[id] === undefined ? 0 : byId[id]) + 1;
    if (!card.name || card.name.trim() === '') fail(id, 'name is empty');
    else {
      if (!byName[card.name]) byName[card.name] = [];
      byName[card.name].push(id);
    }
    if (!card.rarity) fail(id, 'rarity is missing');
    if (!Array.isArray(card.types) || card.types.length === 0) fail(id, 'has no types');

    // --- authoring metadata (B102, B104) ---
    if (!Array.isArray(card.subsystems) || card.subsystems.length === 0) fail(id, 'subsystems is empty');
    if (!card.complexity || !COMPLEXITIES[card.complexity as Complexity]) {
      fail(id, 'complexity "' + String(card.complexity) + '" is not one of T1..T4');
    }
    if (!card.art || !card.art.key || card.art.key.trim() === '') fail(id, 'has no art.key');
    else {
      if (!byArtKey[card.art.key]) byArtKey[card.art.key] = [];
      byArtKey[card.art.key].push(id);
      if (card.art.status !== 'placeholder' && card.art.status !== 'sketch' && card.art.status !== 'final') {
        fail(id, 'art.status "' + String(card.art.status) + '" is not placeholder|sketch|final');
      }
    }

    // --- prophet gating (B99) ---
    const prophet = card.cost ? card.cost.prophet : undefined;
    if (prophet) {
      if (typeof prophet.threshold !== 'number') fail(id, 'prophet cost has no numeric threshold');
      if (typeof prophet.drain !== 'number') fail(id, 'prophet cost has no numeric drain');
      if (card.shop !== 'prophet') fail(id, 'has a prophet cost but shop is "' + String(card.shop) + '"');
    }

    // --- tokens (B62) ---
    if (isToken(card)) {
      if (!card.notPurchasable) fail(id, 'is a Token but is not marked notPurchasable');
      if (card.shop) fail(id, 'is a Token but belongs to shop "' + card.shop + '"');
    }
    if (card.notPurchasable && card.shop) fail(id, 'is notPurchasable but belongs to shop "' + card.shop + '"');

    // --- effects (B96, B97) ---
    for (const node of nodesOf(card)) {
      if (!OP_SET[node.op]) {
        fail(id, 'uses unknown op "' + node.op + '"');
        continue;
      }
      if (node.op === 'createCard' || node.op === 'addToPileTop') {
        const ref = node.raw.defId;
        if (typeof ref === 'string' && !isSentinel(ref) && !known[ref]) {
          fail(id, node.op + ' references unknown defId "' + ref + '"');
        }
      }
      if (node.op === 'transform') {
        const into = node.raw.into;
        if (typeof into === 'string' && !isSentinel(into) && into !== 'upgrade' && into !== 'downgrade' && !known[into]) {
          fail(id, 'transform references unknown defId "' + into + '"');
        }
      }
      if (node.op === 'manifestAura') {
        const auraId = node.raw.auraId;
        if (typeof auraId === 'string' && !knownAuras[auraId]) {
          fail(id, 'manifestAura references unknown auraId "' + auraId + '"');
        }
      }
    }
  }

  for (const id of Object.keys(byId)) {
    if (byId[id] > 1) fail(id, 'duplicate id, defined ' + byId[id] + ' times');
  }
  for (const name of Object.keys(byName)) {
    if (byName[name].length > 1) fail(byName[name].join(','), 'share the name "' + name + '"');
  }
  for (const key of Object.keys(byArtKey)) {
    if (byArtKey[key].length > 1) fail(byArtKey[key].join(','), 'share the art key "' + key + '"');
  }

  // Auras get the op check too: they run through the same interpreter.
  const auraIds: Record<string, number> = {};
  for (const aura of auras) {
    const id = aura.id ? aura.id : '<missing aura id>';
    auraIds[id] = (auraIds[id] === undefined ? 0 : auraIds[id]) + 1;
    if (!aura.name || aura.name.trim() === '') fail(id, 'aura name is empty');
    if (aura.tier !== 'heroic' && aura.tier !== 'celestial' && aura.tier !== 'hypercelestial') {
      fail(id, 'aura tier "' + String(aura.tier) + '" is not heroic|celestial|hypercelestial');
    }
    for (const node of nodesOf(aura)) {
      if (!OP_SET[node.op]) fail(id, 'aura uses unknown op "' + node.op + '"');
      if (node.op === 'createCard') {
        const ref = node.raw.defId;
        if (typeof ref === 'string' && !isSentinel(ref) && !known[ref]) {
          fail(id, 'aura createCard references unknown defId "' + ref + '"');
        }
      }
    }
  }
  for (const id of Object.keys(auraIds)) {
    if (auraIds[id] > 1) fail(id, 'duplicate aura id, defined ' + auraIds[id] + ' times');
  }

  // --- shop wiring ---
  // buildShop resolves PROPHET_SHOP_CARD_IDS through safeGetCard, which
  // swallows the registry's throw and `continue`s. A typo there therefore does
  // not crash — it silently drops a card out of every match. Tnack Trav was
  // missing this way. Counting `shop === 'prophet'` definitions cannot catch
  // it, because the definition is fine; it is the id list that is wrong.
  for (const defId of PROPHET_SHOP_CARD_IDS) {
    if (!known[defId]) {
      fail('prophet-shop', 'PROPHET_SHOP_CARD_IDS names "' + defId + '", which is not a card');
    }
  }

  // --- expression filter names ---
  // `count(x)` / `countIn(zone, x)` resolve x through NAMED_FILTERS, and an
  // unregistered name reads as 0 instead of raising. That makes a typo a card
  // that silently scores nothing, which is the worst failure this catalog has:
  // the suite stays green and the card looks fine. Check every name up front.
  for (const { id, holder } of [
    ...cards.map((c) => ({ id: c.id, holder: c as unknown })),
    ...auras.map((a) => ({ id: 'aura:' + a.id, holder: a as unknown })),
  ]) {
    for (const name of filterNamesIn(holder)) {
      if (!NAMED_FILTERS[name]) {
        fail(id, 'expression references unregistered filter "' + name + '" (reads as 0)');
      }
    }
  }

  process.stdout.write('cards:validate — ' + cards.length + ' cards, ' + auras.length + ' auras\n');
  if (problems.length === 0) {
    process.stdout.write('OK: no problems found\n');
    process.exit(0);
  }
  for (const p of problems) process.stdout.write('FAIL ' + p + '\n');
  process.stdout.write('\n' + problems.length + ' problem(s)\n');
  process.exit(1);
}

main();
