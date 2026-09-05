/**
 * S9 — cards-advanced barrel.
 *
 * A.23-A.29 plus Appendix B (Miracles, Chaos, Craft a Card, In Too Deep).
 * Auras are exported separately from `./auras`, which `src/cards/index.ts`
 * imports directly.
 */
import type { CardDefinition } from '@engine/types';

import { cards as comboCards } from './combo';
import { cards as recursionCards } from './recursion';
import { cards as discoveryCards } from './discovery';
import { cards as mutationCards } from './mutation';
import { cards as cosmicCards } from './cosmic';
import { cards as metaCards } from './meta';
import { cards as tokenCards } from './tokens';
import { cards as miracleCards } from './miracles';
import { cards as chaosCards } from './chaos';
import { cards as craftCards } from './craft';

export const cards: CardDefinition[] = [
  ...comboCards,
  ...recursionCards,
  ...discoveryCards,
  ...mutationCards,
  ...cosmicCards,
  ...metaCards,
  ...tokenCards,
  ...miracleCards,
  ...chaosCards,
  ...craftCards,
];

export { auras } from './auras';

export default cards;
