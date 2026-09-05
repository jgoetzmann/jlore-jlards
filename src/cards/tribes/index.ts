/**
 * S8 — cards-tribes barrel.
 *
 * Appendix A.14 (Books), A.16 (Food, Distilled and Grapes), A.17 (Eggs),
 * A.18 (Plague), A.19 (Soul Shards), A.20 (Grubbing Goblins), A.21 (Truss),
 * A.22 (CN), plus the two shared tribe tokens from A.29.
 */
import type { CardDefinition } from '@engine/types';

import { cards as bookCards } from './books';
import { cards as cnCards } from './cn';
import { cards as eggCards } from './eggs';
import { cards as foodCards } from './food';
import { cards as goblinCards } from './goblins';
import { cards as plagueCards } from './plague';
import { cards as soulShardCards } from './soulshards';
import { cards as tokenCards } from './tokens';
import { cards as trussCards } from './truss';

export const cards: CardDefinition[] = [
  ...bookCards,
  ...foodCards,
  ...eggCards,
  ...plagueCards,
  ...soulShardCards,
  ...goblinCards,
  ...trussCards,
  ...cnCards,
  ...tokenCards,
];

export default cards;
