/**
 * Lockstep: every browser runs the engine (SB-65).
 *
 * `reduce` is pure and seeded, B119 guarantees that replaying the same actions
 * reproduces the same state, and the relay's RPUSH order is a total order that
 * every reader sees identically. So nobody needs to be told what the state is:
 * every client folds the same list through the same reducer and arrives at the
 * same place. The host's only special job is to post the one `start` message
 * the fold begins from.
 *
 * What rides the list after the lobby:
 *
 *   snapshot  jlore-start/1   config, seed, players (names + codex), seat
 *                             bindings, and a checksum of the state it builds.
 *                             The first one in the room is the match.
 *   intent    {nonce, actions}  one press (or a batch, e.g. "play all money")
 *                             from a seat. The acting PlayerId comes from the
 *                             seat binding of the envelope's `from`, never from
 *                             the payload.
 *   hello     presence. After the start it only matters for a seat nobody is
 *                             bound to yet (a resumed match): the first hello
 *                             from an unbound seat claims the next open player.
 *   snapshot  jlore-check/1   the authority's checksum at a turn boundary.
 *   snapshot  jlore-resync/1  "my state disagrees, send me yours".
 *   snapshot  jlore-state/1   the authority's state, for one client that could
 *                             not rebuild its way back into agreement.
 *
 * Optimistic apply: `propose` reduces the action onto the predicted state right
 * away and returns the payload to post. When that intent comes back in order
 * with nothing foreign ahead of it, the already-computed state is adopted as
 * confirmed with no second reduce. If someone else's intent lands first, the
 * still-pending actions are refolded on top of the new confirmed state.
 *
 * Nothing here gates on legality: `reduce` rejects illegal actions itself, the
 * same way on every client, so a gate would only be a second rulebook to keep
 * in sync (it used to drop every reorderHand — HOST-1/TURN-5).
 */

import { createMatch, reduce as engineReduce } from '@engine/index';
import type {
  AnomalyId,
  CardDefId,
  GameAction,
  GameState,
  MatchConfig,
  PlayerId,
  RelayMessage,
} from '@engine/types';
import {
  isLobbyPayload,
  isLocalRelay,
  startPolling,
  LOBBY_HEARTBEAT_MS,
  type LobbyPayload,
  type PollLoop,
  type Relay,
} from './relay';

export const START_TAG = 'jlore-start/1';
export const CHECK_TAG = 'jlore-check/1';
export const RESYNC_TAG = 'jlore-resync/1';
export const STATE_TAG = 'jlore-state/1';

/** Longest batch a single intent may carry. Anything past it is ignored. */
export const MAX_BATCH = 64;

/** The relay caps a message at 256KB; a state we post must fit under it. */
const MAX_STATE_POST_CHARS = 240 * 1024;

export interface StartPlayer {
  id: PlayerId;
  name: string;
  codex: CardDefId[];
}

export interface StartPayload {
  tag: typeof START_TAG;
  /**
   * Seat tokens in seating order: `seats[i]` acts for the i-th player. May be
   * shorter than the player list (a resumed match with seats still open).
   */
  seats: string[];
  /** A fresh deal: every client runs `createMatch` on exactly these. */
  config?: MatchConfig;
  seed?: number;
  players?: StartPlayer[];
  /** Present only when the host picked the anomaly itself. */
  anomaly?: AnomalyId | null;
  /** A resumed match: the state itself, since no deal reproduces it. */
  state?: GameState;
  /** `stateChecksum` of the state this payload builds. */
  checksum: string;
}

export interface IntentPayload {
  nonce: string;
  actions: GameAction[];
}

export interface CheckPayload {
  tag: typeof CHECK_TAG;
  /** Relay seq of the intent after which the checksum was taken. */
  at: number;
  turn: number;
  sum: string;
}

export interface ResyncPayload {
  tag: typeof RESYNC_TAG;
  at: number;
}

export interface StatePayload {
  tag: typeof STATE_TAG;
  /** The state is the fold of every message with seq < at. */
  at: number;
  state: GameState;
}

// ---------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------

function canon(v: unknown, out: string[], depth: number): void {
  if (v === null || v === undefined || typeof v !== 'object') {
    // JSON's own rendering, so a state that went through JSON (a resumed or
    // adopted one) hashes the same as the one that never left memory.
    const s = JSON.stringify(v);
    out.push(s === undefined ? 'null' : s);
    return;
  }
  if (Array.isArray(v)) {
    out.push('[');
    for (const x of v) {
      canon(x, out, depth + 1);
      out.push(',');
    }
    out.push(']');
    return;
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  out.push('{');
  for (const k of keys) {
    // The log is display: nothing in the engine reads it back, and a state we
    // posted may have had it trimmed. `logSeq` still pins how far it got.
    if (depth === 0 && k === 'log') continue;
    const x = obj[k];
    if (x === undefined) continue;
    out.push(JSON.stringify(k), ':');
    canon(x, out, depth + 1);
    out.push(',');
  }
  out.push('}');
}

/** cyrb53: a fast 53-bit string hash. Not cryptographic; it catches drift. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A checksum of a canonical (key-sorted, log-less) serialization. */
export function stateChecksum(state: GameState): string {
  const out: string[] = [];
  canon(state, out, 0);
  return cyrb53(out.join(''));
}

export interface StartSpec {
  seats: string[];
  config?: MatchConfig;
  seed?: number;
  players?: StartPlayer[];
  anomaly?: AnomalyId | null;
  state?: GameState;
}

/** The state a start payload deals. Every client calls exactly this. */
export function buildStartState(p: StartSpec): GameState {
  if (p.state) return JSON.parse(JSON.stringify(p.state)) as GameState;
  if (!p.config || typeof p.seed !== 'number' || !Array.isArray(p.players)) {
    throw new Error('start payload has neither a deal nor a state');
  }
  const players = p.players.map((pl) => ({
    id: pl.id,
    name: pl.name,
    codex: Array.isArray(pl.codex) ? pl.codex.slice() : [],
  }));
  return 'anomaly' in p && p.anomaly !== undefined
    ? createMatch(p.config, players, p.seed, p.anomaly)
    : createMatch(p.config, players, p.seed);
}

/** Deal locally and describe the deal so every other client can repeat it. */
export function makeStart(spec: StartSpec): { payload: StartPayload; state: GameState } {
  const state = buildStartState(spec);
  const payload: StartPayload = {
    tag: START_TAG,
    seats: spec.seats.slice(),
    checksum: stateChecksum(state),
  };
  if (spec.state) {
    payload.state = trimForWire(state);
  } else {
    payload.config = spec.config;
    payload.seed = spec.seed;
    payload.players = spec.players;
    if ('anomaly' in spec && spec.anomaly !== undefined) payload.anomaly = spec.anomaly;
  }
  return { payload, state };
}

/** Only the tail of the log travels: the engine never reads it back. */
export function trimForWire(state: GameState, keep = 60): GameState {
  if (state.log.length <= keep) return state;
  return { ...state, log: state.log.slice(-keep) };
}

function tagOf(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const t = (payload as { tag?: unknown }).tag;
  return typeof t === 'string' ? t : null;
}

export function isStartPayload(payload: unknown): payload is StartPayload {
  if (tagOf(payload) !== START_TAG) return false;
  const p = payload as Partial<StartPayload>;
  return Array.isArray(p.seats) && typeof p.checksum === 'string';
}

function isAction(v: unknown): v is GameAction {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as { type?: unknown }).type === 'string' &&
    (v as { type: string }).type !== 'start'
  );
}

/** A single action or a batch; a bare GameAction (an older client) is a batch of one. */
export function parseIntent(payload: unknown): { nonce: string | null; actions: GameAction[] } | null {
  if (payload === null || typeof payload !== 'object') return null;
  const p = payload as { nonce?: unknown; actions?: unknown };
  if (Array.isArray(p.actions)) {
    const actions = p.actions.slice(0, MAX_BATCH).filter(isAction);
    if (actions.length === 0) return null;
    return { nonce: typeof p.nonce === 'string' ? p.nonce : null, actions };
  }
  if (isAction(payload)) return { nonce: null, actions: [payload] };
  return null;
}

type ReduceFn = (state: GameState, action: GameAction) => GameState;

function isRejected(prev: GameState, next: GameState): boolean {
  if (next.logSeq === prev.logSeq) return false;
  for (let i = next.log.length - 1; i >= 0; i--) {
    const e = next.log[i]!;
    if (e.seq <= prev.logSeq) break;
    if (e.kind === 'reject') return true;
  }
  return false;
}

/**
 * Fold a batch for one actor. It stops after the first action that is refused
 * or that opens a prompt: whatever came after it was chosen without knowing
 * that would happen, so it does not get to run.
 */
export function applyActions(
  state: GameState,
  actions: GameAction[],
  pid: PlayerId,
  reduce: ReduceFn = engineReduce,
): GameState {
  let s = state;
  for (const action of actions) {
    const bound = { ...(action as unknown as Record<string, unknown>), player: pid } as GameAction;
    const next = reduce(s, bound);
    const stop = isRejected(s, next) || next.pending !== null;
    s = next;
    if (stop) break;
  }
  return s;
}

// ---------------------------------------------------------------------------
// The core: list in, states out. No timers, no network.
// ---------------------------------------------------------------------------

export interface Outgoing {
  kind: 'snapshot';
  to?: string;
  payload: CheckPayload | ResyncPayload | StatePayload;
}

interface PendingEntry {
  nonce: string;
  seat: string;
  pid: PlayerId;
  actions: GameAction[];
  after: GameState;
}

interface LoggedIntent {
  seq: number;
  pid: PlayerId;
  actions: GameAction[];
}

export interface CoreOptions {
  /** Seat tokens this browser acts for. */
  localSeats: string[];
  /** Post checksums (as the authority) and answer resync requests. */
  checks?: boolean;
  /** Prefix for nonces; unique per session. */
  noncePrefix?: string;
  /** Injected for tests. */
  reduce?: ReduceFn;
  /** Where a loud desync report goes. Defaults to console.error. */
  report?: (message: string) => void;
}

const KEEP_SUMS = 64;

export class LockstepCore {
  private readonly reduceFn: ReduceFn;
  private readonly localSeats: Set<string>;
  private readonly checks: boolean;
  private readonly noncePrefix: string;
  private readonly report: (message: string) => void;

  private start: StartPayload | null = null;
  /** Relay seq of the start message, or 0 while it is only known locally. */
  private startSeq = 0;
  private initial: GameState | null = null;
  private confirmed: GameState | null = null;
  private pending: PendingEntry[] = [];
  private readonly bindings = new Map<string, PlayerId>();
  private readonly claimed = new Set<PlayerId>();
  private readonly seen = new Set<string>();
  private readonly log: LoggedIntent[] = [];
  /** Checksums of the confirmed state at turn boundaries, by relay seq. */
  private readonly sums = new Map<number, string>();
  /** Messages below this seq are folded into an adopted state. */
  private baseSeq = 0;
  /** Seq of the last message ingested. */
  private lastSeq = 0;
  private counter = 0;
  private desync = false;
  private awaitingState = false;
  /** Bumps whenever the predicted state changes. */
  version = 0;

  constructor(opts: CoreOptions) {
    this.reduceFn = opts.reduce ?? engineReduce;
    this.localSeats = new Set(opts.localSeats);
    this.checks = opts.checks === true;
    this.noncePrefix = opts.noncePrefix ?? Math.random().toString(36).slice(2, 8);
    this.report =
      opts.report ??
      ((m: string) => {
        console.error(m);
      });
  }

  // ---- reading ----

  started(): boolean {
    return this.confirmed !== null;
  }

  startPayload(): StartPayload | null {
    return this.start;
  }

  confirmedState(): GameState | null {
    return this.confirmed;
  }

  predicted(): GameState | null {
    if (this.pending.length > 0) return this.pending[this.pending.length - 1]!.after;
    return this.confirmed;
  }

  pendingCount(): number {
    return this.pending.length;
  }

  playerOf(seat: string): PlayerId | null {
    return this.bindings.get(seat) ?? null;
  }

  seatOf(pid: PlayerId): string | null {
    for (const [seat, p] of this.bindings) if (p === pid) return seat;
    return null;
  }

  /** Seats in `playerOrder`, bound or not (`null` for an open seat). */
  boundSeats(): string[] {
    return Array.from(this.bindings.keys());
  }

  hasOpenSeat(): boolean {
    const st = this.confirmed;
    if (!st) return false;
    return st.playerOrder.some((p) => !this.claimed.has(p));
  }

  isAuthority(): boolean {
    const first = this.start?.seats[0];
    return first !== undefined && this.localSeats.has(first);
  }

  desynced(): boolean {
    return this.desync;
  }

  // ---- starting ----

  /**
   * The host already knows the start it is about to post: apply it now, so its
   * own table appears without waiting for the round trip.
   */
  adoptLocalStart(payload: StartPayload, state: GameState): void {
    if (this.start) return;
    this.installStart(payload, state, 0);
  }

  private installStart(payload: StartPayload, state: GameState, seq: number): void {
    this.start = payload;
    this.startSeq = seq;
    this.initial = state;
    this.confirmed = state;
    this.pending = [];
    this.bindings.clear();
    this.claimed.clear();
    payload.seats.forEach((seat, i) => {
      const pid = state.playerOrder[i];
      if (typeof seat !== 'string' || seat.length === 0 || !pid) return;
      if (this.bindings.has(seat)) return;
      this.bindings.set(seat, pid);
      this.claimed.add(pid);
    });
    this.version++;
  }

  // ---- proposing ----

  /**
   * Apply a press locally and return the intent payload to post, or null if
   * this seat cannot act (no match yet, or not seated).
   */
  propose(seat: string, actions: GameAction[]): IntentPayload | null {
    const pid = this.bindings.get(seat);
    const base = this.predicted();
    if (!pid || !base) return null;
    const clean = actions.slice(0, MAX_BATCH).filter(isAction);
    if (clean.length === 0) return null;
    this.counter += 1;
    const nonce = `${this.noncePrefix}.${this.counter}`;
    const after = applyActions(base, clean, pid, this.reduceFn);
    this.pending.push({ nonce, seat, pid, actions: clean, after });
    this.version++;
    return { nonce, actions: clean };
  }

  /** The post for `nonce` failed for good. Take the prediction back. */
  drop(nonce: string): void {
    const i = this.pending.findIndex((p) => p.nonce === nonce);
    if (i < 0) return;
    this.pending.splice(i, 1);
    this.refold();
    this.version++;
  }

  private refold(): void {
    let s = this.confirmed;
    if (!s) return;
    for (const p of this.pending) {
      p.after = applyActions(s, p.actions, p.pid, this.reduceFn);
      s = p.after;
    }
  }

  // ---- ingesting the list ----

  /**
   * Process messages in relay order. Returns what this client must post in
   * response (checksums, resync requests, a state for someone else).
   */
  ingest(msgs: RelayMessage[]): Outgoing[] {
    const out: Outgoing[] = [];
    for (const msg of msgs) {
      if (!msg || typeof msg.seq !== 'number') continue;
      if (msg.seq <= this.lastSeq) continue;
      this.lastSeq = msg.seq;
      this.one(msg, out);
    }
    return out;
  }

  private one(msg: RelayMessage, out: Outgoing[]): void {
    if (msg.kind === 'snapshot') {
      this.snapshot(msg, out);
      return;
    }
    // Until our own start is back from the relay we cannot tell a message that
    // precedes the match from one inside it; nothing we care about can precede
    // it anyway, because our own posts leave in order behind the start.
    if (!this.confirmed || this.startSeq === 0 || msg.seq <= this.startSeq) return;

    if (msg.kind === 'hello') {
      this.claim(msg.from);
      return;
    }

    if (msg.kind !== 'intent') return;
    const pid = this.bindings.get(msg.from);
    if (!pid) return;
    const intent = parseIntent(msg.payload);
    if (!intent) return;
    if (intent.nonce !== null) {
      // A retried POST that had in fact landed the first time. Every client
      // sees both copies in the same order and skips the same one.
      const key = `${msg.from}|${intent.nonce}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    if (msg.seq <= this.baseSeq) return;

    this.log.push({ seq: msg.seq, pid, actions: intent.actions });
    const turnBefore = this.confirmed.turn;
    const head = this.pending[0];

    if (head && intent.nonce !== null && head.nonce === intent.nonce && head.seat === msg.from) {
      // Ours, in order, with nothing foreign ahead of it: the prediction was
      // computed on exactly this confirmed state. Adopt it; no second reduce.
      this.confirmed = head.after;
      this.pending.shift();
    } else {
      this.confirmed = applyActions(this.confirmed, intent.actions, pid, this.reduceFn);
      if (this.pending.length > 0) {
        const mine =
          intent.nonce !== null
            ? this.pending.findIndex((p) => p.nonce === intent.nonce && p.seat === msg.from)
            : -1;
        if (mine >= 0) this.pending.splice(mine, 1);
        this.refold();
      }
      this.version++;
    }

    if (this.confirmed.turn !== turnBefore) this.turnBoundary(msg.seq, out);
  }

  private claim(seat: string): void {
    if (!this.confirmed || typeof seat !== 'string' || seat.length === 0) return;
    if (this.bindings.has(seat)) return;
    const open = this.confirmed.playerOrder.find((p) => !this.claimed.has(p));
    if (!open) return;
    this.bindings.set(seat, open);
    this.claimed.add(open);
    this.version++;
  }

  private turnBoundary(seq: number, out: Outgoing[]): void {
    if (!this.confirmed) return;
    const sum = stateChecksum(this.confirmed);
    this.sums.set(seq, sum);
    if (this.sums.size > KEEP_SUMS) {
      const oldest = this.sums.keys().next().value;
      if (oldest !== undefined) this.sums.delete(oldest);
    }
    if (this.checks && this.isAuthority()) {
      out.push({
        kind: 'snapshot',
        payload: { tag: CHECK_TAG, at: seq, turn: this.confirmed.turn, sum },
      });
    }
  }

  private snapshot(msg: RelayMessage, out: Outgoing[]): void {
    const tag = tagOf(msg.payload);

    if (tag === START_TAG) {
      if (!isStartPayload(msg.payload)) return;
      const payload = msg.payload;
      if (this.start && this.startSeq > 0) return; // the first start is the match
      if (this.start && this.startSeq === 0 && this.start.checksum === payload.checksum) {
        // Our own start, back from the relay.
        this.startSeq = msg.seq;
        return;
      }
      let state: GameState;
      try {
        state = buildStartState(payload);
      } catch (err) {
        this.report(`lockstep: cannot build the match from its start message: ${String(err)}`);
        return;
      }
      this.installStart(payload, state, msg.seq);
      if (stateChecksum(state) !== payload.checksum) {
        this.report(
          'lockstep: the match this browser dealt differs from the host\'s (a different build?). Asking the host for its state.',
        );
        this.requestState(msg.seq, out);
      }
      return;
    }

    if (!this.start || !this.confirmed) return;
    const authority = this.start.seats[0];

    if (tag === CHECK_TAG) {
      if (msg.from !== authority || this.isAuthority()) return;
      const p = msg.payload as Partial<CheckPayload>;
      if (typeof p.at !== 'number' || typeof p.sum !== 'string') return;
      if (p.at <= this.baseSeq || p.at <= this.startSeq) return;
      const mine = this.sums.get(p.at);
      if (mine === p.sum) return;
      this.mismatch(p.at, p.sum, out);
      return;
    }

    if (tag === RESYNC_TAG) {
      if (!this.checks || !this.isAuthority() || msg.from === authority) return;
      // Our confirmed state is exactly the fold of everything below this seq.
      const state = trimForWire(this.confirmed);
      const payload: StatePayload = { tag: STATE_TAG, at: msg.seq, state };
      if (JSON.stringify(payload).length > MAX_STATE_POST_CHARS) {
        this.report('lockstep: a client asked for the full state, and it is too large to post.');
        return;
      }
      out.push({ kind: 'snapshot', to: msg.from, payload });
      return;
    }

    if (tag === STATE_TAG) {
      if (msg.from !== authority || this.isAuthority()) return;
      if (msg.to === undefined || !this.localSeats.has(msg.to)) return;
      if (!this.awaitingState) return;
      const p = msg.payload as Partial<StatePayload>;
      if (typeof p.at !== 'number' || !p.state || typeof p.state !== 'object') return;
      this.adoptState(p.at, p.state);
    }
  }

  /**
   * First a rebuild from the start and the full intent list — the cheap,
   * self-contained fix for a prediction that was folded wrongly. If that still
   * disagrees, the engine itself disagrees (a different build, a
   * float that rounds differently): say so loudly and take the host's state.
   */
  private mismatch(at: number, theirs: string, out: Outgoing[]): void {
    const rebuilt = this.rebuild();
    if (rebuilt && this.sums.get(at) === theirs) {
      console.warn(`lockstep: state drifted at seq ${at}; rebuilt from the intent list.`);
      return;
    }
    this.report(
      `lockstep: DESYNC at seq ${at}: this browser's state differs from the host's even after a full replay. Adopting the host's state.`,
    );
    this.requestState(at, out);
  }

  private requestState(at: number, out: Outgoing[]): void {
    this.desync = true;
    if (this.awaitingState) return;
    this.awaitingState = true;
    out.push({ kind: 'snapshot', payload: { tag: RESYNC_TAG, at } });
  }

  /** Refold the whole match from the start message. False if impossible. */
  rebuild(): boolean {
    if (!this.initial || this.baseSeq > 0) return false;
    let s = this.initial;
    this.sums.clear();
    for (const entry of this.log) {
      const before = s.turn;
      s = applyActions(s, entry.actions, entry.pid, this.reduceFn);
      if (s.turn !== before) this.sums.set(entry.seq, stateChecksum(s));
    }
    this.confirmed = s;
    this.refold();
    this.version++;
    return true;
  }

  private adoptState(at: number, state: GameState): void {
    let s = JSON.parse(JSON.stringify(state)) as GameState;
    this.sums.clear();
    for (const entry of this.log) {
      if (entry.seq < at) continue;
      const before = s.turn;
      s = applyActions(s, entry.actions, entry.pid, this.reduceFn);
      if (s.turn !== before) this.sums.set(entry.seq, stateChecksum(s));
    }
    this.baseSeq = at;
    this.confirmed = s;
    this.awaitingState = false;
    this.desync = false;
    this.refold();
    this.version++;
  }

  /** Test hook: pretend this client's state drifted. */
  corruptForTest(mutate: (s: GameState) => GameState): void {
    if (!this.confirmed) return;
    this.confirmed = mutate(this.confirmed);
    this.refold();
    this.version++;
  }
}

// ---------------------------------------------------------------------------
// A session: the core, driven by a relay
// ---------------------------------------------------------------------------

export interface HelloSpec {
  name: string;
  codex: CardDefId[];
}

export interface SessionOptions {
  /** Seat tokens this browser acts for (every seat, in hotseat). */
  localSeats: string[];
  /** Relay cursor to read from. 0 replays the room, which a rejoin needs. */
  since?: number;
  /** The host: the start it is about to post, applied at once. */
  start?: { payload: StartPayload; state: GameState } | null;
  /** Called whenever the predicted state (or a seat binding) changes. */
  onChange: () => void;
  /** Lobby rosters seen on the wire. */
  onLobby?: (roster: LobbyPayload) => void;
  /** Announce presence (lobby) and claim an open seat (resumed match). */
  hello?: HelloSpec | null;
  /** Checksums at turn boundaries. Defaults to on for a networked relay. */
  checks?: boolean;
  /** Tests. */
  reduce?: ReduceFn;
  heartbeatMs?: number;
}

export interface LockstepSession {
  readonly core: LockstepCore;
  stop(): void;
  /** Act as `seat`. Applied locally before this returns. */
  send(seat: string, action: GameAction): void;
  /** One intent carrying several actions, unrolled in order by every client. */
  sendMany(seat: string, actions: GameAction[]): void;
  /** Poll now (a no-op on a local relay). */
  kick(): void;
}

const POST_RETRIES = [300, 1000, 2500];

export function startSession(relay: Relay, opts: SessionOptions): LockstepSession {
  const local = isLocalRelay(relay);
  const core = new LockstepCore({
    localSeats: opts.localSeats,
    checks: opts.checks ?? !local,
    reduce: opts.reduce,
  });
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();
  let lastVersion = -1;
  const mySeat = opts.localSeats[0] ?? '';

  function changed(): void {
    if (stopped) return;
    if (core.version === lastVersion) return;
    lastVersion = core.version;
    opts.onChange();
  }

  /**
   * Posts leave in the order they were made: each waits for the previous one's
   * answer. Two quick clicks otherwise race each other to Redis and land in
   * whichever order the network felt like, which is a different game.
   */
  function enqueue(msg: Omit<RelayMessage, 'seq'>, onFail?: () => void): void {
    chain = chain.then(async () => {
      for (let attempt = 0; ; attempt++) {
        if (stopped) return;
        try {
          await relay.post(msg);
          if (!local) loop?.kick();
          return;
        } catch (err) {
          const wait = POST_RETRIES[attempt];
          if (wait === undefined) {
            console.warn(`lockstep: gave up posting a ${msg.kind}: ${String(err)}`);
            if (onFail) onFail();
            return;
          }
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    });
  }

  function flush(outgoing: Outgoing[]): void {
    for (const o of outgoing) {
      const env: Omit<RelayMessage, 'seq'> = { from: mySeat, kind: o.kind, payload: o.payload };
      if (o.to !== undefined) env.to = o.to;
      enqueue(env);
    }
  }

  // ---- presence ----
  let helloTimer: ReturnType<typeof setInterval> | null = null;
  let lastRoster: LobbyPayload | null = null;
  let helloSentAfterStart = false;

  function sayHello(withCodex: boolean): void {
    if (stopped || !opts.hello) return;
    const payload: { name: string; seat: string; codex?: CardDefId[] } = {
      name: opts.hello.name,
      seat: mySeat,
    };
    if (withCodex) payload.codex = opts.hello.codex;
    enqueue({ from: mySeat, kind: 'hello', payload });
  }

  function keepAnnouncing(): boolean {
    if (stopped || !opts.hello) return false;
    if (core.started()) return core.playerOf(mySeat) === null && core.hasOpenSeat();
    if (lastRoster && lastRoster.started && !lastRoster.seats.includes(mySeat)) return false;
    return true;
  }

  function handle(msgs: RelayMessage[]): void {
    if (stopped) return;
    const game: RelayMessage[] = [];
    for (const m of msgs) {
      if (m && m.kind === 'view' && isLobbyPayload(m.payload)) {
        lastRoster = m.payload;
        if (opts.onLobby) opts.onLobby(m.payload);
        continue;
      }
      game.push(m);
    }
    const out = core.ingest(game);
    flush(out);
    // A resumed match with an open seat: claim it now, not on the next beat.
    if (opts.hello && core.started() && !helloSentAfterStart && core.playerOf(mySeat) === null) {
      helloSentAfterStart = true;
      if (core.hasOpenSeat()) sayHello(false);
    }
    changed();
  }

  // ---- the feed ----
  let loop: PollLoop | null = null;
  let unsubscribe: (() => void) | null = null;

  if (opts.start) {
    core.adoptLocalStart(opts.start.payload, opts.start.state);
    enqueue({ from: mySeat, kind: 'snapshot', payload: opts.start.payload });
  }

  if (local) {
    const lr = relay;
    let cursor = opts.since ?? 0;
    let draining = false;
    let again = false;
    const drain = (): void => {
      if (stopped) return;
      if (draining) {
        again = true;
        return;
      }
      draining = true;
      try {
        do {
          again = false;
          const msgs = lr.read(cursor);
          if (msgs.length > 0) {
            cursor = msgs[msgs.length - 1]!.seq;
            handle(msgs);
          }
        } while (again && !stopped);
      } finally {
        draining = false;
      }
    };
    unsubscribe = lr.subscribe(drain);
    drain();
  } else {
    loop = startPolling(relay, opts.since ?? 0, handle, undefined, {
      live: () => core.started(),
    });
  }

  if (opts.hello) {
    sayHello(true);
    helloTimer = setInterval(() => {
      if (!keepAnnouncing()) {
        if (helloTimer) clearInterval(helloTimer);
        helloTimer = null;
        return;
      }
      sayHello(false);
    }, opts.heartbeatMs ?? LOBBY_HEARTBEAT_MS);
  }

  changed();

  function sendActions(seat: string, actions: GameAction[]): void {
    if (stopped) return;
    const payload = core.propose(seat, actions);
    if (!payload) return;
    // Render first. The post is bookkeeping as far as this player is concerned.
    changed();
    enqueue({ from: seat, kind: 'intent', payload }, () => {
      core.drop(payload.nonce);
      changed();
    });
  }

  return {
    core,
    stop() {
      stopped = true;
      if (helloTimer) clearInterval(helloTimer);
      helloTimer = null;
      if (unsubscribe) unsubscribe();
      if (loop) loop.stop();
    },
    send(seat, action) {
      sendActions(seat, [action]);
    },
    sendMany(seat, actions) {
      sendActions(seat, actions);
    },
    kick() {
      if (loop) loop.kick();
    },
  };
}
