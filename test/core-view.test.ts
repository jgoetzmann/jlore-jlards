/**
 * T1 - core rules and determinism.
 * Behaviors covered here: B21, B22, B23, B24, B120.
 *
 * These are the leak tests. The pattern is: plant a marker that exists in
 * exactly one hidden place, serialize the view, and assert the marker is not
 * in the string.
 */
import { describe, expect, test } from 'vitest';
import { createMatch } from '@engine/index';
import { renderCardText, viewFor } from '@engine/view';
import { getCard, registerCards } from '@engine/registry';
import type {
  CardDefId,
  CardDefinition,
  EffectNode,
  GameState,
  InstanceId,
  MatchConfig,
  PlayerId,
  PlayerState,
  Prompt,
  Zone,
} from '@engine/types';

// --------------------------------------------------------------------------
// inline fixtures
// --------------------------------------------------------------------------

function makeConfig(over: Partial<MatchConfig> = {}): MatchConfig {
  return {
    playerCount: 2,
    draftPileCount: 10,
    anomalyChance: 0,
    winCondition: {
      kind: 'standard',
      emptyPileFraction: 0.4,
      emptyPileAbsolute: 4,
      x: null,
    },
    pileSizeScale: 1,
    effectNodeBudget: 500,
    recursionDepth: 8,
    turnSeconds: 60,
    seedCodexWithCommons: true,
    ...over,
  };
}

function makePlayers(count: number): { id: PlayerId; name: string; codex: CardDefId[] }[] {
  const names = ['Ada', 'Bo', 'Cyd'];
  const out: { id: PlayerId; name: string; codex: CardDefId[] }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ id: `p${i + 1}`, name: names[i] ?? `P${i + 1}`, codex: [] });
  }
  return out;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function newMatch(playerCount = 2, seed = 20250905): GameState {
  return clone(createMatch(makeConfig({ playerCount }), makePlayers(playerCount), seed, null));
}

function P(state: GameState, id: PlayerId): PlayerState {
  const player = state.players[id];
  if (!player) throw new Error(`no such player: ${id}`);
  return player;
}

function otherPlayer(state: GameState, id: PlayerId): PlayerId {
  const other = state.playerOrder.find((p) => p !== id);
  if (!other) throw new Error('match has only one player');
  return other;
}

let testCardSeq = 0;

function markerDef(id: CardDefId, over: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: id,
    cost: { money: 2 },
    types: ['Resource'],
    subtypes: [],
    tags: [],
    rarity: 'common',
    keywords: [],
    stats: {},
    effects: [],
    triggers: [],
    text: 'A test card that does nothing.',
    complexity: 'T1',
    subsystems: ['test'],
    notPurchasable: true,
    excludeFromPools: true,
    ...over,
  } as CardDefinition;
}

function mint(state: GameState, def: CardDefinition, owner: PlayerId, zone: Zone): InstanceId {
  registerCards([def]);
  const iid: InstanceId = `t_${def.id}_${testCardSeq++}`;
  state.instances[iid] = {
    iid,
    defId: def.id,
    owner,
    zone,
    addedKeywords: [],
    removedKeywords: [],
    counters: {},
    statDelta: {},
    extraEffects: [],
    playedOnTurn: null,
  };
  const p = P(state, owner);
  if (zone === 'hand') p.hand.push(iid);
  else if (zone === 'library') p.library.push(iid);
  else if (zone === 'gy') p.gy.push(iid);
  else if (zone === 'play') p.play.push(iid);
  else throw new Error(`mint does not handle zone ${zone}`);
  return iid;
}

function collectRandomBranches(
  nodes: EffectNode[],
): { weight: number; effects: EffectNode[]; displayAs?: string }[] {
  const out: { weight: number; effects: EffectNode[]; displayAs?: string }[] = [];
  const walk = (list: EffectNode[]): void => {
    for (const node of list) {
      const bag = node as unknown as Record<string, unknown>;
      if (bag.op === 'random' && Array.isArray(bag.branches)) {
        for (const branch of bag.branches as {
          weight: number;
          effects: EffectNode[];
          displayAs?: string;
        }[]) {
          out.push(branch);
          walk(branch.effects ?? []);
        }
        continue;
      }
      for (const value of Object.values(bag)) {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
          walk(value as EffectNode[]);
        }
      }
    }
  };
  walk(nodes);
  return out;
}

// --------------------------------------------------------------------------
// B21 - libraries are never exposed
// --------------------------------------------------------------------------

describe('B21 - viewFor never exposes a library card identity', () => {
  test('B21: a defId that exists only in the viewer own library never reaches their view', () => {
    const state = newMatch();
    const viewer = state.activePlayer;
    const marker = 'test_leak_own_library_zq7x';
    mint(state, markerDef(marker), viewer, 'library');

    const serialized = JSON.stringify(viewFor(state, viewer));

    expect(serialized).not.toContain(marker);
  });

  test('B21: a defId that exists only in an opponent library never reaches any view', () => {
    const state = newMatch();
    const viewer = state.activePlayer;
    const opponent = otherPlayer(state, viewer);
    const marker = 'test_leak_opponent_library_kd41';
    mint(state, markerDef(marker), opponent, 'library');

    expect(JSON.stringify(viewFor(state, viewer))).not.toContain(marker);
    expect(JSON.stringify(viewFor(state, opponent))).not.toContain(marker);
  });

  test('B21: a serialized view contains no instance id that lives in any player library', () => {
    const state = newMatch();
    for (const viewer of state.playerOrder) {
      const serialized = JSON.stringify(viewFor(state, viewer));
      for (const owner of state.playerOrder) {
        for (const iid of P(state, owner).library) {
          expect(serialized).not.toContain(iid);
        }
      }
    }
  });

  test('B21: the viewer own library appears only as a count', () => {
    const state = newMatch();
    const viewer = state.activePlayer;

    const view = viewFor(state, viewer);

    expect(view.you.libraryCount).toBe(P(state, viewer).library.length);
    expect((view.you as unknown as Record<string, unknown>).library).toBeUndefined();
  });

  test('B21: an opponent library appears only as a count', () => {
    const state = newMatch();
    const viewer = state.activePlayer;
    const opponent = otherPlayer(state, viewer);

    const view = viewFor(state, viewer);
    const seat = view.others.find((o) => o.id === opponent);

    expect(seat).toBeDefined();
    expect(seat!.libraryCount).toBe(P(state, opponent).library.length);
    expect((seat as unknown as Record<string, unknown>).library).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// B22 - opponent hands are a count only
// --------------------------------------------------------------------------

describe('B22 - viewFor reports opponent hands as a count only', () => {
  test('B22: a defId that exists only in an opponent hand never reaches the viewer view', () => {
    const state = newMatch();
    const viewer = state.activePlayer;
    const opponent = otherPlayer(state, viewer);
    const marker = 'test_leak_opponent_hand_m88v';
    mint(state, markerDef(marker), opponent, 'hand');

    expect(JSON.stringify(viewFor(state, viewer))).not.toContain(marker);
  });

  test('B22: an instance id that lives in an opponent hand never reaches the viewer view', () => {
    const state = newMatch();
    const viewer = state.activePlayer;
    const opponent = otherPlayer(state, viewer);

    const serialized = JSON.stringify(viewFor(state, viewer));

    for (const iid of P(state, opponent).hand) {
      expect(serialized).not.toContain(iid);
    }
  });

  test('B22: the opponent seat carries a handCount and no hand array', () => {
    const state = newMatch();
    const viewer = state.activePlayer;
    const opponent = otherPlayer(state, viewer);
    mint(state, markerDef('test_hand_count_extra_c19'), opponent, 'hand');

    const seat = viewFor(state, viewer).others.find((o) => o.id === opponent);

    expect(seat).toBeDefined();
    expect(seat!.handCount).toBe(P(state, opponent).hand.length);
    expect((seat as unknown as Record<string, unknown>).hand).toBeUndefined();
  });

  test('B22: the viewer still sees their own hand identities', () => {
    const state = newMatch();
    const viewer = state.activePlayer;

    const view = viewFor(state, viewer);

    expect(view.you.hand.map((c) => c.iid)).toEqual(P(state, viewer).hand);
  });
});

// --------------------------------------------------------------------------
// B23 - pending prompts reach only the chooser
// --------------------------------------------------------------------------

describe('B23 - a pending prompt ships options only to the chooser', () => {
  const promptFor = (chooser: PlayerId): Prompt => ({
    id: 'prompt_under_test',
    type: 'choose',
    player: chooser,
    prompt: 'Pick one',
    options: [
      { key: 'k1', label: 'Secret Option Alpha' },
      { key: 'k2', label: 'Secret Option Beta' },
    ],
    min: 1,
    max: 1,
    then: [],
    ctx: {},
    defaultKeys: ['k1'],
  });

  test('B23: the player who must choose receives the full prompt with its options', () => {
    const state = newMatch();
    const chooser = state.activePlayer;
    state.pending = promptFor(chooser);

    const pending = viewFor(state, chooser).pending;

    expect(pending).not.toBeNull();
    const asPrompt = pending as Prompt;
    expect(asPrompt.id).toBe('prompt_under_test');
    expect(asPrompt.options.map((o) => o.key)).toEqual(['k1', 'k2']);
  });

  test('B23: every other player sees only waitingOn', () => {
    const state = newMatch();
    const chooser = state.activePlayer;
    const bystander = otherPlayer(state, chooser);
    state.pending = promptFor(chooser);

    const pending = viewFor(state, bystander).pending;

    expect(pending).not.toBeNull();
    expect(pending).toEqual({ waitingOn: chooser });
  });

  test('B23: a bystander view never carries the prompt option labels', () => {
    const state = newMatch();
    const chooser = state.activePlayer;
    const bystander = otherPlayer(state, chooser);
    state.pending = promptFor(chooser);

    const serialized = JSON.stringify(viewFor(state, bystander));

    expect(serialized).not.toContain('Secret Option Alpha');
    expect(serialized).not.toContain('Secret Option Beta');
    expect(serialized).not.toContain('prompt_under_test');
  });

  test('B23: a prompt owned by an opponent does not become the viewer own prompt', () => {
    const state = newMatch();
    const chooser = otherPlayer(state, state.activePlayer);
    const viewer = state.activePlayer;
    state.pending = promptFor(chooser);

    const pending = viewFor(state, viewer).pending;

    expect((pending as unknown as Record<string, unknown>).options).toBeUndefined();
    expect((pending as { waitingOn: PlayerId }).waitingOn).toBe(chooser);
  });

  test('B23: with no pending prompt every view reports pending as null', () => {
    const state = newMatch();

    for (const viewer of state.playerOrder) {
      expect(viewFor(state, viewer).pending).toBeNull();
    }
  });
});

// --------------------------------------------------------------------------
// B24 - secrets belong to the owner
// --------------------------------------------------------------------------

describe('B24 - instance secrets appear only in the owner view', () => {
  test('B24: a secret on a card in play does not reach an opponent view', () => {
    const state = newMatch();
    const owner = state.activePlayer;
    const opponent = otherPlayer(state, owner);
    const iid = mint(state, markerDef('test_secret_host_p1'), owner, 'play');
    state.instances[iid]!.secret = { hiddenTestScore: 987654 };

    const serialized = JSON.stringify(viewFor(state, opponent));

    expect(serialized).not.toContain('hiddenTestScore');
    expect(serialized).not.toContain('987654');
  });

  test('B24: a secret on a card in the GY does not reach an opponent view', () => {
    const state = newMatch();
    const owner = state.activePlayer;
    const opponent = otherPlayer(state, owner);
    const iid = mint(state, markerDef('test_secret_host_gy'), owner, 'gy');
    state.instances[iid]!.secret = { hiddenGyScore: 135791 };

    const serialized = JSON.stringify(viewFor(state, opponent));

    expect(serialized).not.toContain('hiddenGyScore');
    expect(serialized).not.toContain('135791');
  });

  test('B24: a secret on a card in hand does not reach an opponent view', () => {
    const state = newMatch();
    const owner = state.activePlayer;
    const opponent = otherPlayer(state, owner);
    const iid = mint(state, markerDef('test_secret_host_hand'), owner, 'hand');
    state.instances[iid]!.secret = { hiddenHandScore: 246810 };

    const serialized = JSON.stringify(viewFor(state, opponent));

    expect(serialized).not.toContain('hiddenHandScore');
    expect(serialized).not.toContain('246810');
  });

  test('B24: a secret belonging to one opponent does not reach a third player view', () => {
    const state = newMatch(3);
    const owner = state.activePlayer;
    const third = state.playerOrder.filter((p) => p !== owner)[1]!;
    const iid = mint(state, markerDef('test_secret_host_third'), owner, 'play');
    state.instances[iid]!.secret = { hiddenThirdScore: 1029384 };

    const serialized = JSON.stringify(viewFor(state, third));

    expect(serialized).not.toContain('hiddenThirdScore');
    expect(serialized).not.toContain('1029384');
  });

  test('B24: a public counter on the same card is still visible to the opponent', () => {
    const state = newMatch();
    const owner = state.activePlayer;
    const opponent = otherPlayer(state, owner);
    const iid = mint(state, markerDef('test_secret_public_counter'), owner, 'play');
    state.instances[iid]!.counters = { publicTestCounter: 4 };
    state.instances[iid]!.secret = { hiddenAlongside: 555111 };

    const view = viewFor(state, opponent);
    const seat = view.others.find((o) => o.id === owner);
    const card = seat?.play.find((c) => c.iid === iid);

    expect(card).toBeDefined();
    expect(card!.counters.publicTestCounter).toBe(4);
    expect(JSON.stringify(view)).not.toContain('555111');
  });
});

// --------------------------------------------------------------------------
// B120 - the Chaos catalog shared display string
// --------------------------------------------------------------------------

describe('B120 - a shared display string hides four different real effects', () => {
  test('B120: four Chaos branches share one display string', () => {
    const branches = collectRandomBranches(getCard('call_to_chaos').effects);
    expect(branches.length).toBeGreaterThan(0);

    const byDisplay = new Map<string, typeof branches>();
    for (const branch of branches) {
      if (typeof branch.displayAs !== 'string') continue;
      const bucket = byDisplay.get(branch.displayAs) ?? [];
      bucket.push(branch);
      byDisplay.set(branch.displayAs, bucket);
    }
    const shared = [...byDisplay.values()].filter((bucket) => bucket.length >= 4);

    expect(shared.length).toBeGreaterThanOrEqual(1);
    expect(shared[0]!.length).toBeGreaterThanOrEqual(4);
  });

  test('B120: the branches behind the shared display string do not share a real effect', () => {
    const branches = collectRandomBranches(getCard('call_to_chaos').effects);

    const byDisplay = new Map<string, typeof branches>();
    for (const branch of branches) {
      if (typeof branch.displayAs !== 'string') continue;
      const bucket = byDisplay.get(branch.displayAs) ?? [];
      bucket.push(branch);
      byDisplay.set(branch.displayAs, bucket);
    }
    const shared = [...byDisplay.values()].filter((bucket) => bucket.length >= 4)[0];

    expect(shared).toBeDefined();
    const bodies = shared!.map((b) => JSON.stringify(b.effects));
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  test('B120: a display text override is what renderCardText returns, for every viewer', () => {
    const state = newMatch();
    const owner = state.activePlayer;
    const opponent = otherPlayer(state, owner);
    const def = markerDef('test_display_override_card', {
      text: 'The real and very specific effect text.',
    });
    const iid = mint(state, def, owner, 'play');
    state.instances[iid]!.displayTextOverride = 'Something chaotic happens.';

    expect(renderCardText(state, iid, owner)).toBe('Something chaotic happens.');
    expect(renderCardText(state, iid, opponent)).toBe('Something chaotic happens.');
  });

  test('B120: the printed text behind a display override never reaches renderCardText or the view', () => {
    const state = newMatch();
    const owner = state.activePlayer;
    const opponent = otherPlayer(state, owner);
    const def = markerDef('test_display_override_hidden', {
      text: 'Trash every card in every opponent library.',
    });
    const iid = mint(state, def, owner, 'play');
    state.instances[iid]!.displayTextOverride = 'Something chaotic happens.';

    expect(renderCardText(state, iid, owner)).not.toContain('Trash every card');
    expect(JSON.stringify(viewFor(state, owner))).not.toContain('Trash every card');
    expect(JSON.stringify(viewFor(state, opponent))).not.toContain('Trash every card');
  });

  test('B120: the display override is the text carried on the card view', () => {
    const state = newMatch();
    const owner = state.activePlayer;
    const def = markerDef('test_display_override_view', {
      text: 'The real and very specific effect text.',
    });
    const iid = mint(state, def, owner, 'play');
    state.instances[iid]!.displayTextOverride = 'Something chaotic happens.';

    const card = viewFor(state, owner).you.play.find((c) => c.iid === iid);

    expect(card).toBeDefined();
    expect(card!.text).toBe('Something chaotic happens.');
  });
});
