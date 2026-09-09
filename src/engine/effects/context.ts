/**
 * Builds the `vars` record the expression evaluator reads, from live state.
 *
 * Every name in EXPR_VARS is filled. `count:<name>` and `countIn:<zone>:<name>`
 * keys are filled only when the expression actually asks for them, because
 * they are the expensive half and almost no card uses them.
 */
import type { GameState, InstanceId, PlayerId, Zone } from '@engine/types';
import { EXPR_VARS } from '@engine/types';
import {
  defCost,
  instanceCost,
  opponentsOf,
  tryGetCard,
} from './runtime';
import { statOf } from '@engine/systems/index.js';
import { NAMED_FILTERS, matchesFilter, zoneIds } from './select';

const COUNT_ZONES: Zone[] = ['hand', 'library', 'gy', 'play', 'shop', 'trash'];

/** A player counter may never shadow one of the frozen expression variables. */
const FROZEN_VAR_NAMES: ReadonlySet<string> = new Set<string>(EXPR_VARS);

/**
 * Instance counters the engine keeps for itself. `selfCounter` is meant to be
 * "this card's own tally", so these must not be summed into it.
 */
const BOOKKEEPING_COUNTERS: ReadonlySet<string> = new Set([
  'playCount',
  'podChain',
  'trashSurvivals',
  'promptTurn',
  'promptsThisTurn',
  // Hand adjacency (§2.1) and the SB-7 pairing are engine bookkeeping written
  // on every play. `pointerPair` in particular is an instance sequence number,
  // so leaving it in made `selfCounter` read in the hundreds for any card that
  // had ever been Pointed to.
  'handIndex',
  'handSizeAtPlay',
  'handEdge',
  'sandwich',
  'pointerPair',
  'pointerPlaying',
  'wouldTrash',
  'trashSpared',
]);

function deckOf(state: GameState, player: PlayerId): InstanceId[] {
  const p = state.players[player];
  if (!p) return [];
  return p.library.concat(p.hand, p.gy, p.play);
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let total = 0;
  for (const x of xs) total += x;
  return total / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  let acc = 0;
  for (const x of xs) acc += (x - m) * (x - m);
  return Math.sqrt(acc / xs.length);
}

/**
 * The longest unbroken run of costs starting at 1 — Constellation's X. A deck
 * holding (1),(2),(3),(5) scores 3: the run stops at the missing (4).
 */
function longestCostRunIn(costs: number[]): number {
  const present = new Set(costs);
  let n = 0;
  while (present.has(n + 1)) n += 1;
  return n;
}

function meanAbsoluteDeviation(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  let acc = 0;
  for (const x of xs) acc += Math.abs(x - m);
  return acc / xs.length;
}

function emptyAndLocked(state: GameState): { empty: number; locked: number; both: number } {
  let empty = 0;
  let locked = 0;
  let both = 0;
  for (const pid of Object.keys(state.shop.piles)) {
    const pile = state.shop.piles[pid];
    if (!pile) continue;
    const isEmpty = pile.cards.length === 0;
    const isLocked = pile.locks.length > 0;
    if (isEmpty) empty += 1;
    if (isLocked) locked += 1;
    if (isEmpty || isLocked) both += 1;
  }
  return { empty, locked, both };
}

/**
 * The full variable record for `player`, with `sourceIid` supplying the
 * self-* family. `extra` (loop variables like `x`) wins over computed values.
 */
export function buildVars(
  state: GameState,
  player: PlayerId,
  sourceIid: InstanceId | null,
  extra?: Record<string, number>,
  withCounts?: boolean,
): Record<string, number> {
  const vars: Record<string, number> = {};
  for (const name of EXPR_VARS) vars[name] = 0;

  const p = state.players[player];
  if (!p) return Object.assign(vars, extra ?? {});

  const deck = deckOf(state, player);
  const costs = deck.map((iid) => instanceCost(state, iid));
  const defIds = new Set<string>();
  for (const iid of deck) {
    const i = state.instances[iid];
    if (i) defIds.add(i.defId);
  }

  let sumCosts = 0;
  for (const c of costs) sumCosts += c;

  const opponents = opponentsOf(state, player);
  const oppCosts: number[] = [];
  for (const oid of opponents) {
    for (const iid of deckOf(state, oid)) oppCosts.push(instanceCost(state, iid));
  }

  let bestOpponentVp = 0;
  let sawOpponent = false;
  for (const oid of opponents) {
    const o = state.players[oid];
    if (!o) continue;
    if (!sawOpponent || o.vp > bestOpponentVp) {
      bestOpponentVp = o.vp;
      sawOpponent = true;
    }
  }

  const piles = emptyAndLocked(state);

  vars.deckSize = deck.length;
  vars.uniqueCardsInDeck = defIds.size;
  vars.avgCostOfDeck = mean(costs);
  vars.sdOfDeckCost = stdev(costs);
  vars.sumOfDeckCosts = sumCosts;
  vars.madOfOpponentDeck = meanAbsoluteDeviation(oppCosts);
  vars.handSize = p.hand.length;
  vars.currentTurn = state.turn;
  vars.roundNumber = state.round;
  vars.playerCount = state.playerOrder.length;
  vars.buysRemaining = p.buys;
  vars.actionsRemaining = p.actions;
  vars.moneyUnspent = p.money;
  vars.comboCount = p.combo;
  vars.cardsPlayedThisTurn = p.playedThisTurn.length;
  vars.cardsGainedThisTurn = p.cardsGainedThisTurn;
  vars.libraryHeight = p.library.length;
  vars.gyHeight = p.gy.length;
  vars.prophet = p.prophet;
  vars.vp = p.vp;
  vars.vpLead = sawOpponent ? p.vp - bestOpponentVp : p.vp;
  vars.emptyPiles = piles.empty;
  vars.lockedPiles = piles.locked;
  vars.emptyOrLockedPiles = piles.both;
  // Constellation scores "the longest unbroken run of cards costing (1), (2),
  // ... (X)". That is a property of the deck's cost set, not a card count, so
  // no CardFilter can express it and `count(longestCostRun)` silently read 0.
  vars.longestCostRun = longestCostRunIn(costs);
  vars.buysUsedThisTurn = p.buysUsedThisTurn;

  // Opponent shape. `madOfOpponentDeck` is a cost dispersion, not a size, and
  // The Biggest The Largest was subtracting it from its own deck size — paying
  // out ~9 Money from a (1) card on turn one. These are the real comparisons.
  let largestOpponentDeck = 0;
  let tallestOpponentLibrary = 0;
  for (const oid of opponents) {
    const o = state.players[oid];
    if (!o) continue;
    const size = o.library.length + o.hand.length + o.gy.length + o.play.length;
    if (size > largestOpponentDeck) largestOpponentDeck = size;
    if (o.library.length > tallestOpponentLibrary) tallestOpponentLibrary = o.library.length;
  }
  vars.largestOpponentDeck = largestOpponentDeck;
  vars.tallestOpponentLibrary = tallestOpponentLibrary;

  // VP actually sitting in hand, printed plus accrued — the two terms final
  // scoring adds. No `count()` can express a sum, only a tally of cards.
  let vpInHand = 0;
  let cheapestInHand = 0;
  let sawHand = false;
  for (const iid of p.hand) {
    vpInHand += statOf(state, iid, 'vp') + (state.instances[iid]?.counters['vp'] ?? 0);
    const c = instanceCost(state, iid);
    if (!sawHand || c < cheapestInHand) {
      cheapestInHand = c;
      sawHand = true;
    }
  }
  vars.vpInHand = vpInHand;
  vars.cheapestInHand = cheapestInHand;

  // The deepest single Relic upgrade in the deck — Monumental Works pays the
  // highest, never the sum, so a total across Relics would double count.
  let maxRelicUpgrades = 0;
  for (const iid of deck) {
    const inst = state.instances[iid];
    if (!inst) continue;
    const def = tryGetCard(inst.defId);
    if (!def || def.types.indexOf('Relic') < 0) continue;
    const up = inst.counters['upgrades'] ?? 0;
    if (up > maxRelicUpgrades) maxRelicUpgrades = up;
  }
  vars.maxRelicUpgrades = maxRelicUpgrades;

  let draftTotal = 0;
  let draftSeen = 0;
  for (const pileId of state.shop.order.draft) {
    const pile = state.shop.piles[pileId];
    const top = pile?.cards[0];
    if (!top) continue;
    draftTotal += instanceCost(state, top);
    draftSeen += 1;
  }
  vars.avgDraftPileCost = draftSeen > 0 ? draftTotal / draftSeen : 0;

  if (sourceIid) {
    const src = state.instances[sourceIid];
    if (src) {
      const plays = p.playCounts[src.defId];
      vars.selfPlayCount = typeof plays === 'number' ? plays : 0;
      let counterTotal = 0;
      let named = 0;
      let sawNamed = false;
      for (const key of Object.keys(src.counters)) {
        const v = src.counters[key];
        if (typeof v !== 'number') continue;
        // The engine keeps its own bookkeeping on instances — playCount is
        // bumped before a card's body runs, trigger budgets live under `trg:`.
        // Summing those into `selfCounter` made Juhan Wet Market draw its own
        // play count and Plague Charger score it, while the card text printed
        // `{plague}` alone, so the printed and the paid numbers disagreed.
        if (BOOKKEEPING_COUNTERS.has(key) || key.startsWith('trg:')) continue;
        counterTotal += v;
        if (key === 'counter' || key === 'uses' || key === 'charges' || key === 'plague') {
          named = v;
          sawNamed = true;
        }
      }
      vars.selfCounter = sawNamed ? named : counterTotal;
      vars.selfCost = instanceCost(state, sourceIid);
      vars.selfPricePaid = src.counters['pricePaid'] ?? 0;
      vars.selfHandIndex = src.counters['handIndex'] ?? 0;
      vars.selfHandSizeAtPlay = src.counters['handSizeAtPlay'] ?? 0;
      vars.selfHandEdge = src.counters['handEdge'] ?? 0;
    }
  }

  // Player counters are readable by their own key, so a card that writes
  // `turn:ricochetUsed` can gate on `turn:ricochetUsed` — minus the colon,
  // which the expression grammar has no room for, so the prefix is dropped and
  // the name is what the card reads. A key that collides with a frozen var name
  // never wins.
  for (const key of Object.keys(p.counters)) {
    const name = key.startsWith('turn:') ? key.slice(5) : key;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    if (FROZEN_VAR_NAMES.has(name)) continue;
    const v = p.counters[key];
    if (typeof v === 'number' && Number.isFinite(v)) vars[name] = v;
  }

  vars.x = 0;

  if (withCounts) {
    const names = Object.keys(NAMED_FILTERS);
    for (const name of names) {
      const filter = NAMED_FILTERS[name];
      let deckCount = 0;
      for (const iid of deck) if (matchesFilter(state, iid, filter)) deckCount += 1;
      vars['count:' + name] = deckCount;
      vars['countIn:deck:' + name] = deckCount;
      for (const zone of COUNT_ZONES) {
        const ids = zone === 'shop' || zone === 'trash' ? zoneIds(state, null, zone) : zoneIds(state, player, zone);
        let n = 0;
        for (const iid of ids) if (matchesFilter(state, iid, filter)) n += 1;
        vars['countIn:' + zone + ':' + name] = n;
      }
    }
  }

  if (extra) {
    for (const k of Object.keys(extra)) {
      const v = extra[k];
      if (typeof v === 'number' && Number.isFinite(v)) vars[k] = v;
    }
  }

  return vars;
}

export { defCost };
