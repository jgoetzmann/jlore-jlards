/**
 * npm run cards:export
 *
 * Emits dist-cards/cards.json and dist-cards/auras.json for art tooling and
 * anything else that lives outside the type system. Plain data, no engine types
 * required to read it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AuraDefinition, CardDefinition } from '@engine/types';
import { bootstrap } from './bootstrap';

function cardRecord(c: CardDefinition): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    cost: c.cost ? (c.cost.money === undefined ? null : c.cost.money) : null,
    prophetCost: c.cost && c.cost.prophet ? c.cost.prophet : null,
    types: c.types,
    subtypes: c.subtypes,
    tags: c.tags,
    rarity: c.rarity,
    keywords: c.keywords,
    stats: c.stats,
    text: c.text,
    flavor: c.flavor === undefined ? null : c.flavor,
    complexity: c.complexity,
    subsystems: c.subsystems,
    notPurchasable: c.notPurchasable === true,
    excludeFromPools: c.excludeFromPools === true,
    shop: c.shop === undefined ? null : c.shop,
    bigAction: c.bigAction === undefined ? 1 : c.bigAction,
    wordCount: c.wordCount === undefined ? null : c.wordCount,
    art: c.art
      ? {
          key: c.art.key,
          status: c.art.status,
          artist: c.art.artist === undefined ? null : c.art.artist,
          anim: c.art.anim === undefined ? null : c.art.anim,
        }
      : null,
    effects: c.effects,
    triggers: c.triggers,
  };
}

function auraRecord(a: AuraDefinition): Record<string, unknown> {
  return {
    id: a.id,
    name: a.name,
    tier: a.tier,
    text: a.text,
    activationCost: a.activationCost === undefined ? null : a.activationCost,
    art: a.art
      ? {
          key: a.art.key,
          status: a.art.status,
          artist: a.art.artist === undefined ? null : a.art.artist,
          anim: a.art.anim === undefined ? null : a.art.anim,
        }
      : null,
    effects: a.effects,
    triggers: a.triggers,
  };
}

function main(): void {
  const { cards, auras } = bootstrap();
  const dir = resolve(process.cwd(), 'dist-cards');
  mkdirSync(dir, { recursive: true });

  const sortedCards = cards.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sortedAuras = auras.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const cardsPath = resolve(dir, 'cards.json');
  const aurasPath = resolve(dir, 'auras.json');

  writeFileSync(
    cardsPath,
    JSON.stringify({ count: sortedCards.length, cards: sortedCards.map(cardRecord) }, null, 2),
    'utf8',
  );
  writeFileSync(
    aurasPath,
    JSON.stringify({ count: sortedAuras.length, auras: sortedAuras.map(auraRecord) }, null, 2),
    'utf8',
  );

  process.stdout.write('wrote ' + cardsPath + ' (' + sortedCards.length + ' cards)\n');
  process.stdout.write('wrote ' + aurasPath + ' (' + sortedAuras.length + ' auras)\n');
}

main();
