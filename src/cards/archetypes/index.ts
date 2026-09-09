/**
 * Slice S7 — cards-archetypes barrel.
 *
 * Appendix A.10 through A.15: victory and scoring, PvP and attacks, the Warhero
 * Token archetype, the Felinor archetype, and the Relics. The Book generators
 * of A.14 live with the Books themselves in `tribes/books.ts`.
 */
import type { CardDefinition } from '@engine/types';

import { cards as victoryCards } from './victory.js';
import { cards as pvpCards } from './pvp.js';
import { cards as warheroCards } from './warhero.js';
import { cards as felinorCards } from './felinor.js';
import { cards as relicCards } from './relics.js';

export const cards: CardDefinition[] = [
  ...victoryCards,
  ...pvpCards,
  ...warheroCards,
  ...felinorCards,
  ...relicCards,
];

export default cards;
