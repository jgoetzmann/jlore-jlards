/**
 * Card registry barrel. Frozen at Phase 0 — no slice owns this file.
 *
 * Each card slice writes its own directory barrel exporting `cards`
 * (and, for advanced, `auras`). This file is the only place they meet.
 */
import type { CardDefinition, AuraDefinition } from '@engine/types';

import { cards as economyCards } from './economy';
import { cards as archetypeCards } from './archetypes';
import { cards as tribeCards } from './tribes';
import { cards as advancedCards } from './advanced';
import { auras as advancedAuras } from './advanced/auras';

export function allCardDefinitions(): CardDefinition[] {
  return [...economyCards, ...archetypeCards, ...tribeCards, ...advancedCards];
}

export function allAuraDefinitions(): AuraDefinition[] {
  return [...advancedAuras];
}
