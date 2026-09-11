/**
 * A `CardView` built from a printed definition.
 *
 * Prompts are the reason this exists. A Discover ships `PromptOption`s carrying
 * a `defId` and a label, not card views — the engine has no reason to render a
 * card it is merely offering — so the picker had nothing to show but the label
 * and the raw id, and "temple_marketplace" is not a card you can evaluate
 * against your hand. Around 60 cards Discover, which made this the single most
 * common decision in the game and the worst-presented one.
 *
 * What this produces is a *printed* face: no instance counters, no per-instance
 * buffs, no live-templated text, because none of that exists for a card that is
 * still only an option. That is honest rather than lossy — the card you are
 * being offered is the printed one.
 */

import type { CardDefId, CardView } from '@engine/types';
import { getCard, hasCard } from '@engine/registry';

/** The sentinel `viewFor` writes when a log or option would name a hidden card. */
export const HIDDEN_DEF_ID = 'hidden';

/**
 * @param key the option key, used as a stand-in instance id so React and the
 *   FLIP group have something stable to key on.
 */
export function printedCardView(defId: CardDefId, key: string): CardView | null {
  if (!defId || defId === HIDDEN_DEF_ID) return null;
  if (!hasCard(defId)) return null;
  const def = getCard(defId);

  const view: CardView = {
    iid: `opt_${key}`,
    defId: def.id,
    name: def.name,
    cost: typeof def.cost.money === 'number' ? def.cost.money : null,
    prophetCost: def.cost.prophet ?? null,
    types: def.types,
    subtypes: def.subtypes,
    rarity: def.rarity,
    keywords: def.keywords,
    stats: def.stats,
    text: def.text,
    counters: {},
  };
  if (def.art) view.art = def.art;
  return view;
}

/** Display name for a definition id, falling back to the id itself. */
export function cardNameOf(defId: CardDefId): string {
  if (!defId) return 'a card';
  if (defId === HIDDEN_DEF_ID) return 'a hidden card';
  return hasCard(defId) ? getCard(defId).name : defId;
}
