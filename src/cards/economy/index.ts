/**
 * S6 cards-economy — barrel.
 *
 * Appendix A.1 through A.9: the Basic shops, the whole Prophet Shop, Prophet
 * generation, core economy and money, resource refining, draw and hand
 * sculpting, trashing, and shop manipulation.
 */
import type { CardDefinition } from '@engine/types';

import { cards as basics } from './basics';
import { cards as prophetShop } from './prophet-shop';
import { cards as prophetGen } from './prophet-gen';
import { cards as economy } from './economy';
import { cards as resources } from './resources';
import { cards as draw } from './draw';
import { cards as trashing } from './trashing';
import { cards as shopManip } from './shop-manip';

export const cards: CardDefinition[] = [
  ...basics,
  ...prophetShop,
  ...prophetGen,
  ...economy,
  ...resources,
  ...draw,
  ...trashing,
  ...shopManip,
];

export default cards;
