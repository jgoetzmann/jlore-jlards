/**
 * S-QUEST — In Too Deep, the multi-floor Celestial Aura quest (Appendix B.4).
 *
 * One instance at a time. Progress persists across turns and shuffles.
 * Per-turn counters ("draw 20 cards in one turn") live alongside cumulative
 * ones under a `turn:` prefix and are wiped by `questStartOfTurn`; deck-state
 * floors ("have 5 Diamonds") are predicates re-evaluated every turn rather than
 * counters that anything increments.
 *
 * Descent is deterministic: a completed floor descends to the first room it
 * offers. A branch prompt would need a `pending` round trip for a reward the
 * player has already earned, so the room order in `leadsTo` is the choice.
 */

import type {
  CardDefId,
  EffectNode,
  GameState,
  PlayerId,
  QuestState,
} from '@engine/types';
import { getCard } from '@engine/registry';
import { resolveEffects } from '@engine/effects';
import { deckIidsOf, pushLog, withPlayer } from './util.js';

export const IN_TOO_DEEP_AURA_ID = 'in_too_deep';
export const TURN_PREFIX = 'turn:';

export type QuestPredicate = 'deckDiamonds' | 'deckUnique' | 'none';

export interface QuestFloor {
  id: string;
  quest: string;
  /** Counter read for completion. Prefixed `turn:` when it is per-turn. */
  counterKey: string;
  target: number;
  predicate: QuestPredicate;
  reward: EffectNode[];
  rewardText: string;
  leadsTo: string[];
}

/** Appendix B.4, floor for floor. */
export const questFloors: QuestFloor[] = [
  {
    id: '1',
    quest: 'Buy 2 cards',
    counterKey: 'buy',
    target: 2,
    predicate: 'none',
    reward: [
      { op: 'delayed', when: 'startOfNextTurn', effects: [{ op: 'gain', stat: 'money', amount: 2 }] },
    ],
    rewardText: '+2 Money next turn',
    leadsTo: ['2a', '2b'],
  },
  {
    id: '2a',
    quest: 'Play 5 cards',
    counterKey: 'play',
    target: 5,
    predicate: 'none',
    reward: [{ op: 'createCard', defId: 'truss', to: 'library', position: 'top' }],
    rewardText: 'Add 1 Truss to the top of your Library',
    leadsTo: ['3a', '3b'],
  },
  {
    id: '2b',
    quest: 'Trash 3 cards',
    counterKey: 'trash',
    target: 3,
    predicate: 'none',
    reward: [
      { op: 'createCard', defId: { pool: { catalog: 'book' } }, to: 'hand' },
      { op: 'gain', stat: 'actions', amount: 1 },
    ],
    rewardText: 'Add a Book to hand, +1 Action',
    leadsTo: ['3b', '3c'],
  },
  {
    id: '3a',
    quest: 'Draw 20 cards',
    counterKey: 'draw',
    target: 20,
    predicate: 'none',
    reward: [
      { op: 'moveTo', target: { who: 'self', zone: 'gy' }, zone: 'library' },
      { op: 'shuffle', zone: 'library' },
      { op: 'draw', amount: 4 },
      { op: 'gain', stat: 'actions', amount: 1 },
    ],
    rewardText: 'Shuffle GY into Library, then +4 Cards and +1 Action',
    leadsTo: ['4a', '4b'],
  },
  {
    id: '3b',
    quest: 'Buy a card costing (8)+',
    counterKey: 'buyCost8',
    target: 1,
    predicate: 'none',
    reward: [{ op: 'createCard', defId: 'gold', to: 'library', position: 'top' }],
    rewardText: 'Add 1 Gold to the top of your Library',
    leadsTo: ['4b', '4c'],
  },
  {
    id: '3c',
    quest: 'Buy a Diamond',
    counterKey: 'buyDiamond',
    target: 1,
    predicate: 'none',
    reward: [
      {
        op: 'discover',
        pool: { scope: 'opponentHand', who: 'chosenOpponent' },
        count: 3,
        pick: 1,
        prompt: 'Steal a card from an opponent hand',
        then: [{ op: 'moveTo', target: { who: 'chosenOpponent', zone: 'hand' }, zone: 'hand' }],
      },
    ],
    rewardText: 'Discover a card in an opponent hand and steal it',
    leadsTo: ['4c', '4d'],
  },
  {
    id: '4a',
    quest: 'Draw 20 cards in one turn',
    counterKey: `${TURN_PREFIX}draw`,
    target: 20,
    predicate: 'none',
    reward: [{ op: 'manifestAura', tier: 'celestial', auraId: 'undead_army' }],
    rewardText: 'Celestial Aura Undead Army',
    leadsTo: ['5'],
  },
  {
    id: '4b',
    quest: 'Have 5 Diamonds in your deck',
    counterKey: 'deckDiamonds',
    target: 5,
    predicate: 'deckDiamonds',
    reward: [{ op: 'manifestAura', tier: 'celestial', auraId: 'market_manipulation' }],
    rewardText: 'Celestial Aura Market Manipulation',
    leadsTo: ['5'],
  },
  {
    id: '4c',
    quest: 'End a turn with (12)+ unspent Money',
    counterKey: 'endTurnMoney12',
    target: 1,
    predicate: 'none',
    reward: [{ op: 'manifestAura', tier: 'celestial', auraId: 'double_header' }],
    rewardText: 'Celestial Aura Double Header',
    leadsTo: ['5'],
  },
  {
    id: '4d',
    quest: 'Have 16 unique cards in your deck',
    counterKey: 'deckUnique',
    target: 16,
    predicate: 'deckUnique',
    reward: [{ op: 'manifestAura', tier: 'celestial', auraId: 'yuyas_mythical_portal' }],
    rewardText: 'Celestial Aura Yuya Mythical Portal',
    leadsTo: ['5'],
  },
  {
    id: '5',
    quest: 'Win the game',
    counterKey: 'winGame',
    target: 1,
    predicate: 'none',
    // "+20% experience" is the progression layer, which is out of scope. The
    // floor still completes and logs, so the descent reaches its bottom.
    reward: [{ op: 'noop' }],
    rewardText: 'You made it to the bottom! Now how do we get back up...',
    leadsTo: [],
  },
];

const FLOOR_BY_ID: Record<string, QuestFloor> = (() => {
  const out: Record<string, QuestFloor> = {};
  for (const f of questFloors) out[f.id] = f;
  return out;
})();

export function getFloor(id: string): QuestFloor | null {
  return FLOOR_BY_ID[id] ?? null;
}

/** One instance at a time: starting a second quest is a no-op. */
export function startQuest(state: GameState, player: PlayerId): GameState {
  const p = state.players[player];
  if (!p) return state;
  if (p.quest !== null) return pushLog(state, 'questAlreadyRunning', { floor: p.quest.floor }, player);
  const quest: QuestState = { floor: '1', progress: {}, completedFloors: [] };
  const next = withPlayer(state, player, (q) => ({ ...q, quest }));
  return pushLog(next, 'questStarted', { floor: '1' }, player);
}

// ---------------------------------------------------------------------------
// Deck-state predicates
// ---------------------------------------------------------------------------

function defIdsInDeck(state: GameState, player: PlayerId): CardDefId[] {
  return deckIidsOf(state, player)
    .map((iid) => state.instances[iid]?.defId)
    .filter((d): d is CardDefId => typeof d === 'string');
}

export function deckDiamondCount(state: GameState, player: PlayerId): number {
  let n = 0;
  for (const defId of defIdsInDeck(state, player)) {
    if (defId === 'diamond') {
      n += 1;
      continue;
    }
    try {
      const def = getCard(defId);
      if (def.subtypes.includes('Diamond')) n += 1;
    } catch {
      /* unknown definition contributes nothing */
    }
  }
  return n;
}

export function deckUniqueCount(state: GameState, player: PlayerId): number {
  return new Set(defIdsInDeck(state, player)).size;
}

function predicateValue(state: GameState, player: PlayerId, predicate: QuestPredicate): number {
  if (predicate === 'deckDiamonds') return deckDiamondCount(state, player);
  if (predicate === 'deckUnique') return deckUniqueCount(state, player);
  return 0;
}

// ---------------------------------------------------------------------------
// Progress and completion
// ---------------------------------------------------------------------------

function currentFloor(state: GameState, player: PlayerId): QuestFloor | null {
  const q = state.players[player]?.quest;
  if (!q) return null;
  return getFloor(q.floor);
}

/**
 * Complete the current floor: bank the reward, record it, descend to the first
 * room offered. Loops so a descent that immediately satisfies the next floor
 * (a deck-state predicate) keeps going.
 */
function settleFloor(state: GameState, player: PlayerId): GameState {
  let next = state;
  for (let guard = 0; guard < questFloors.length + 1; guard += 1) {
    const q = next.players[player]?.quest;
    if (!q) return next;
    const floor = getFloor(q.floor);
    if (!floor) return next;

    const value =
      floor.predicate === 'none'
        ? q.progress[floor.counterKey] ?? 0
        : predicateValue(next, player, floor.predicate);

    if (value < floor.target) return next;

    next = withPlayer(next, player, (p) => ({
      ...p,
      quest: p.quest
        ? {
            floor: floor.leadsTo[0] ?? floor.id,
            progress: floor.leadsTo.length > 0 ? stripTurnKeys(p.quest.progress) : p.quest.progress,
            completedFloors: [...p.quest.completedFloors, floor.id],
          }
        : null,
    }));
    next = pushLog(
      next,
      'questFloorComplete',
      { floor: floor.id, reward: floor.rewardText, next: floor.leadsTo[0] ?? null },
      player,
    );

    if (floor.reward.length > 0) {
      next = resolveEffects(next, floor.reward, {
        player,
        sourceIid: null,
        depth: 0,
        multiplier: 1,
        vars: {},
      });
    }

    if (floor.leadsTo.length === 0) {
      next = withPlayer(next, player, (p) => ({ ...p, quest: p.quest ? { ...p.quest } : null }));
      return pushLog(next, 'questComplete', { floors: floor.id }, player);
    }
  }
  return next;
}

function stripTurnKeys(progress: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(progress)) {
    if (key.startsWith(TURN_PREFIX)) continue;
    out[key] = progress[key];
  }
  return out;
}

/**
 * S-QUEST surface. Every quest-relevant event routes through here: buys, plays,
 * trashes, draws. Each event bumps both a cumulative counter and a per-turn
 * counter, so "draw 20" (floor 3a) and "draw 20 in one turn" (floor 4a) read
 * different numbers from the same call.
 */
export function questProgress(
  state: GameState,
  player: PlayerId,
  key: string,
  amount: number,
): GameState {
  const p = state.players[player];
  if (!p || p.quest === null) return state;
  if (amount === 0) return state;

  const turnKey = key.startsWith(TURN_PREFIX) ? key : `${TURN_PREFIX}${key}`;
  const baseKey = key.startsWith(TURN_PREFIX) ? key.slice(TURN_PREFIX.length) : key;

  let next = withPlayer(state, player, (q) => {
    if (!q.quest) return q;
    const progress = { ...q.quest.progress };
    progress[baseKey] = (progress[baseKey] ?? 0) + amount;
    progress[turnKey] = (progress[turnKey] ?? 0) + amount;
    return { ...q, quest: { ...q.quest, progress } };
  });

  next = pushLog(next, 'questProgress', { key: baseKey, amount }, player);
  return settleFloor(next, player);
}

/** Wipe per-turn counters, then re-check the deck-state floors. */
export function questStartOfTurn(state: GameState, player: PlayerId): GameState {
  const p = state.players[player];
  if (!p || p.quest === null) return state;
  let next = withPlayer(state, player, (q) => ({
    ...q,
    quest: q.quest ? { ...q.quest, progress: stripTurnKeys(q.quest.progress) } : null,
  }));
  next = settleFloor(next, player);
  return next;
}

/** Floor 4c reads the money still in hand when the turn closes. */
export function questEndOfTurn(state: GameState, player: PlayerId): GameState {
  const p = state.players[player];
  if (!p || p.quest === null) return state;
  let next = state;
  if (p.money >= 12) next = questProgress(next, player, 'endTurnMoney12', 1);
  return settleFloor(next, player);
}

/** Floor 5 — the quest holder actually won. */
export function questOnWin(state: GameState, player: PlayerId): GameState {
  const p = state.players[player];
  if (!p || p.quest === null) return state;
  return questProgress(state, player, 'winGame', 1);
}

/** The floor a player is standing on, for the view layer. */
export function questSummary(
  state: GameState,
  player: PlayerId,
): { floor: string; quest: string; have: number; need: number } | null {
  const floor = currentFloor(state, player);
  const q = state.players[player]?.quest;
  if (!floor || !q) return null;
  const have =
    floor.predicate === 'none'
      ? q.progress[floor.counterKey] ?? 0
      : predicateValue(state, player, floor.predicate);
  return { floor: floor.id, quest: floor.quest, have, need: floor.target };
}
