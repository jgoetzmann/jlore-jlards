/**
 * Loads the card catalog into the engine registry exactly once per page. The
 * host needs a populated registry before `createMatch`; the client does not,
 * but it costs nothing and makes hotseat and join the same code path.
 */

import { registerCards, registerAuras } from '@engine/registry';
import { allCardDefinitions, allAuraDefinitions } from '@cards/index';

let loaded = false;

export function ensureRegistry(): void {
  if (loaded) return;
  loaded = true;
  registerCards(allCardDefinitions());
  registerAuras(allAuraDefinitions());
}
