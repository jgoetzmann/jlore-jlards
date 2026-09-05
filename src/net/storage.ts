/**
 * The three storage tiers from ARCHITECTURE.md §7, and the split matters.
 *
 *  - Cookie: seat token + room code only, ~100 bytes. It rides along on every
 *    relay request, so nothing bigger goes here.
 *  - localStorage: codex, settings, last snapshot. Persistent, per-device, and
 *    never sent anywhere.
 *  - Memory: live game state, rebuilt from the host each time.
 */

import type { CardDefId, GameState } from '@engine/types';

export const SEAT_COOKIE = 'jlore_seat';
export const ROOM_COOKIE = 'jlore_room';
export const CODEX_KEY = 'jlore_codex';
export const SETTINGS_KEY = 'jlore_settings';
export const SNAPSHOT_KEY = 'jlore_snapshot';
export const SEAT_MAX_AGE_SECONDS = 60 * 60 * 8;

export interface Settings {
  playerName: string;
  showLog: boolean;
  animate: boolean;
}

export interface Snapshot {
  code: string;
  seq: number;
  state: GameState;
  savedTurn: number;
}

const DEFAULT_SETTINGS: Settings = { playerName: 'Player', showLog: true, animate: true };

// ---------------------------------------------------------------------------
// Tier 1 — cookie. Identity only.
// ---------------------------------------------------------------------------

function hasDocument(): boolean {
  return typeof document !== 'undefined' && typeof document.cookie === 'string';
}

export function readCookie(name: string): string | null {
  if (!hasDocument()) return null;
  const parts = document.cookie ? document.cookie.split(';') : [];
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) {
      try {
        return decodeURIComponent(trimmed.slice(eq + 1));
      } catch {
        return trimmed.slice(eq + 1);
      }
    }
  }
  return null;
}

export function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (!hasDocument()) return;
  const v = encodeURIComponent(value);
  document.cookie = `${name}=${v}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
}

export function newSeatId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const rand2 = Math.random().toString(36).slice(2, 6);
  return `s_${rand}${rand2}`;
}

/** Reads the seat token from the cookie, minting and storing one if absent. */
export function getSeatId(): string {
  const existing = readCookie(SEAT_COOKIE);
  if (existing && existing.length > 2 && existing.length <= 64) {
    // Refresh the 8h window on every read so an active session never expires.
    writeCookie(SEAT_COOKIE, existing, SEAT_MAX_AGE_SECONDS);
    return existing;
  }
  const fresh = newSeatId();
  setSeatId(fresh);
  return fresh;
}

export function setSeatId(seatId: string): void {
  writeCookie(SEAT_COOKIE, seatId, SEAT_MAX_AGE_SECONDS);
}

export function setRoomCode(code: string): void {
  writeCookie(ROOM_COOKIE, code, SEAT_MAX_AGE_SECONDS);
}

// ---------------------------------------------------------------------------
// Tier 2 — localStorage. Data, and it never leaves the device on its own.
// ---------------------------------------------------------------------------

function store(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string, fallback: T): T {
  const ls = store();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  const ls = store();
  if (!ls) return;
  try {
    ls.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode; the codex is a convenience, not a requirement */
  }
}

/** The set of card ids this device has ever seen. Feeds Known Universe pools. */
export function getCodex(): CardDefId[] {
  const raw = readJson<unknown>(CODEX_KEY, []);
  if (!Array.isArray(raw)) return [];
  const out: CardDefId[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function addToCodex(ids: CardDefId | CardDefId[]): CardDefId[] {
  const incoming = Array.isArray(ids) ? ids : [ids];
  const current = getCodex();
  const seen = new Set(current);
  let changed = false;
  for (const id of incoming) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    current.push(id);
    changed = true;
  }
  if (changed) writeJson(CODEX_KEY, current);
  return current;
}

export function getSettings(): Settings {
  const raw = readJson<Partial<Settings>>(SETTINGS_KEY, {});
  return {
    playerName: typeof raw.playerName === 'string' ? raw.playerName : DEFAULT_SETTINGS.playerName,
    showLog: typeof raw.showLog === 'boolean' ? raw.showLog : DEFAULT_SETTINGS.showLog,
    animate: typeof raw.animate === 'boolean' ? raw.animate : DEFAULT_SETTINGS.animate,
  };
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  writeJson(SETTINGS_KEY, next);
  return next;
}

/**
 * The host's last snapshot. Full state, so it lives on the host's device only
 * and never rides a cookie.
 */
export function saveSnapshot(code: string, seq: number, state: GameState): void {
  writeJson(SNAPSHOT_KEY, { code, seq, state, savedTurn: state.turn } satisfies Snapshot);
}

export function loadSnapshot(): Snapshot | null {
  const raw = readJson<Partial<Snapshot> | null>(SNAPSHOT_KEY, null);
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.code !== 'string' || !raw.state || typeof raw.state !== 'object') return null;
  return {
    code: raw.code,
    seq: typeof raw.seq === 'number' ? raw.seq : 0,
    state: raw.state as GameState,
    savedTurn: typeof raw.savedTurn === 'number' ? raw.savedTurn : 0,
  };
}

export function clearSnapshot(): void {
  const ls = store();
  if (!ls) return;
  try {
    ls.removeItem(SNAPSHOT_KEY);
  } catch {
    /* nothing to do */
  }
}

// ---------------------------------------------------------------------------
// Tier 3 — memory. Live view state, rebuilt from the host.
// ---------------------------------------------------------------------------

const memory = new Map<string, unknown>();
