/**
 * The turn's readouts, split between the two places they belong (SB-63):
 *
 *   - `TurnClock` and `AnomalyChip` sit in the topbar: turn, round, timer,
 *     Doomsday, the hard end, and the anomaly.
 *   - `StatCluster` sits in the dock beside the hand: Money / Buys / Actions,
 *     the smaller Prophet / VP / Combo, Play money, and End turn. The numbers
 *     you spend and the button you end on live next to the cards you play.
 *
 * Every `stat-*` test id exists exactly once on the table; nothing else may
 * render a `Stat`.
 *
 * SB-36: Time Flail divides `config.turnSeconds` once, in the engine at setup.
 * The clock shows that number as it stands and must not divide it again: it
 * used to, and a 36s Time Flail turn read 14s. SB-67: when the clock runs out
 * the turn passes. `useGame` does that, from the browser that controls the
 * seat; the clock itself only shows the time. `turnSeconds` 0 means no timer.
 */

import React from 'react';
import type { GameAction, GameView, PlayerId } from '@engine/types';
import { useOneShot, usePulse } from './useMotion';
import { timerLimitSeconds } from './turntimer';

export const DEFAULT_TURN_SECONDS = 90;

export function isTimeFlail(anomaly: GameView['anomaly']): boolean {
  if (!anomaly) return false;
  return anomaly.id === 'time_flail' || /time\s*flail/i.test(anomaly.name ?? '');
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------

export function TurnClock({
  view,
  turnSeconds = DEFAULT_TURN_SECONDS,
  endsAt,
}: {
  view: GameView;
  turnSeconds?: number;
  /**
   * When this turn runs out (epoch ms), from the session, so the countdown and
   * the moment the turn passes agree. Absent, the clock counts down on its
   * own: the fixtures and the unit tests have no session.
   */
  endsAt?: number | null;
}): JSX.Element {
  const limit = view.ended ? 0 : timerLimitSeconds(turnSeconds);
  const [remaining, setRemaining] = React.useState(limit);

  // Restart whenever the turn, the active seat or the deadline changes. The tick
  // is local to this component so it never re-renders the rest of the table,
  // and it stops at 0:00 rather than ticking a no-op for the rest of the turn.
  React.useEffect(() => {
    if (limit <= 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let local = limit;
    const read = (): number =>
      endsAt !== undefined && endsAt !== null ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : local;
    const tick = (): void => {
      const left = read();
      setRemaining(left);
      if (left <= 0) return;
      timer = setTimeout(() => {
        local -= 1;
        tick();
      }, 1000);
    };
    tick();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [view.turn, view.activePlayer, limit, endsAt]);

  const low = remaining <= 10;
  const out = limit > 0 && remaining <= 0;

  return (
    <div className="turn-clock">
      <span className="turn-number">
        <span className="turn-label">Turn</span>
        <span className="turn-value" data-testid="turn-number">
          {view.turn}
        </span>
        <span className="round-value">round {view.round}</span>
      </span>
      {limit > 0 && (
        <span
          className={`turn-timer${low ? ' turn-timer-low' : ''}${out ? ' turn-timer-out' : ''}`}
          data-testid="turn-timer"
          title={out ? 'Out of time: the turn passes' : `${limit}s per turn`}
        >
          {formatClock(remaining)}
          {isTimeFlail(view.anomaly) && <span className="flail-tag">Time Flail</span>}
        </span>
      )}
      {view.doomsdayCounter > 0 && (
        <span className="doomsday" title="Doomsday counter">
          ☠ {view.doomsdayCounter}
        </span>
      )}
      {view.hardEndTurn !== null && view.hardEndTurn !== undefined && (
        <span className="hard-end">ends T{view.hardEndTurn}</span>
      )}
    </div>
  );
}

/**
 * The anomaly as a topbar chip. The rule is too long for the bar, so the chip is
 * the trigger: it opens the whole rule in a panel over the board, which costs
 * the topbar nothing (SB-63). It used to wrap in place, which nobody found and
 * which grew the topbar 13px on the longest rules. `title` keeps the full text
 * too: the native tooltip is a second way to read it, and
 * e2e/interaction.spec.ts reads it to spot Fading Blossom.
 */
export function AnomalyChip({
  anomaly,
  open = false,
  onToggle,
}: {
  anomaly: GameView['anomaly'];
  open?: boolean;
  onToggle?: () => void;
}): JSX.Element | null {
  if (!anomaly) return null;
  return (
    <button
      type="button"
      className={`anomaly-banner anomaly-chip${open ? ' anomaly-open' : ''}`}
      data-testid="anomaly-banner"
      aria-expanded={open}
      aria-haspopup="dialog"
      title={`${anomaly.name}: ${anomaly.text}`}
      onClick={onToggle}
    >
      <span className="anomaly-name">{anomaly.name}</span>
      <span className="anomaly-text">{anomaly.text}</span>
      <span className="anomaly-more" aria-hidden="true">
        Read ›
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Dock
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  hot,
  minor,
  scope,
}: {
  label: string;
  value: number;
  hot?: boolean;
  minor?: boolean;
  /** Whose number this is; a hotseat seat swap adopts the new value without a tick. */
  scope: string;
}): JSX.Element {
  const id = label.toLowerCase();
  const ref = React.useRef<HTMLSpanElement>(null);
  usePulse(value, ref, scope);
  return (
    <div className={`stat${hot ? ' stat-hot' : ''}${minor ? ' stat-minor' : ''}`} data-testid={`stat-${id}`}>
      <span className="stat-value" data-testid={`stat-${id}-value`} ref={ref}>
        {value}
      </span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export interface StatClusterProps {
  view: GameView;
  playerId: PlayerId;
  yourTurn: boolean;
  onAction: (action: GameAction) => void;
  /** Play every plain Resource in hand (TURN-2). No button renders without it. */
  onPlayMoney?: () => void;
  /** What Play money would add, for its label. */
  playMoneyTotal?: number;
  /** Why Play money can't be pressed, or null when it can. */
  playMoneyBlocked?: string | null;
  /** Nothing left to do but End turn (TURN-10): one cue, then it stays lit. */
  done?: boolean;
  /**
   * Ending the turn, guarded against a double-click that would end the NEXT
   * player's turn as well (SEAM-1). Without it the button sends the action
   * itself, which is what the unit tests render.
   */
  onEndTurn?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export function StatCluster({
  view,
  playerId,
  yourTurn,
  onAction,
  onPlayMoney,
  playMoneyTotal = 0,
  playMoneyBlocked = null,
  done = false,
  onEndTurn,
}: StatClusterProps): JSX.Element {
  const you = view.you;
  const canEnd = yourTurn && !view.ended && view.pending === null;
  const endRef = React.useRef<HTMLButtonElement>(null);
  const ready = done && canEnd;
  // One cue when the turn runs out of things to do — never an infinite pulse
  // (MOT-10). The button then just stays highlighted.
  useOneShot(
    ready ? `${you.id}:${view.turn}` : null,
    endRef,
    [{ transform: 'none' }, { transform: 'scale(1.06)' }, { transform: 'none' }, { transform: 'scale(1.04)' }, { transform: 'none' }],
    { duration: 600, easing: 'ease-out' },
    (v) => v !== null,
  );
  const moneyDisabled = playMoneyBlocked !== null || !yourTurn || view.pending !== null;
  return (
    <div className="cluster" data-testid="stat-cluster">
      <div className="cluster-stats">
        <Stat label="Money" value={you.money} hot={yourTurn && you.money > 0} scope={you.id} />
        <Stat label="Buys" value={you.buys} scope={you.id} />
        <Stat label="Actions" value={you.actions} scope={you.id} />
      </div>
      <div className="cluster-minor">
        <Stat label="Prophet" value={you.prophet} minor scope={you.id} />
        <Stat label="VP" value={you.vp} minor scope={you.id} />
        <Stat label="Combo" value={you.combo} minor scope={you.id} />
      </div>
      <div className="cluster-actions">
        {onPlayMoney && (
          <button
            type="button"
            className="play-money"
            data-testid="play-money"
            data-total={playMoneyTotal}
            disabled={moneyDisabled}
            title={playMoneyBlocked ?? 'Play every plain Resource in your hand, biggest first (M)'}
            onClick={onPlayMoney}
          >
            Play money (+{playMoneyTotal}) <kbd>M</kbd>
          </button>
        )}
        <button
          type="button"
          ref={endRef}
          className={`end-turn${ready ? ' end-turn-done' : ''}`}
          data-testid="end-turn"
          data-done={ready ? 'true' : 'false'}
          disabled={!canEnd}
          title={
            !yourTurn
              ? 'Not your turn'
              : view.pending !== null
                ? 'Answer the open prompt first'
                : ready
                  ? 'Nothing left to do — end your turn (E)'
                  : 'End your turn (E)'
          }
          onClick={(e) => {
            if (onEndTurn) onEndTurn(e);
            else onAction({ type: 'endTurn', player: playerId });
          }}
        >
          <span className="end-turn-label">
            End turn <kbd>E</kbd>
          </span>
          {ready && <span className="end-turn-sub">nothing left to do</span>}
        </button>
      </div>
    </div>
  );
}
