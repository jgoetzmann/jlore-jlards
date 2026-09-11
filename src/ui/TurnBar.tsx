/**
 * Money / Buys / Actions / Prophet / VP, the turn number, the anomaly banner,
 * the Doomsday counter, and the turn timer.
 *
 * SB-36: Time Flail divides `config.turnSeconds`. It is a timer modifier and
 * nothing else — no rule and no engine behavior changes, and the timer running
 * out does not end the turn on its own.
 */

import React from 'react';
import type { GameAction, GameView, PlayerId } from '@engine/types';
import type { TickStat } from './motion';

export const TIME_FLAIL_DIVISOR = 2.5;
export const DEFAULT_TURN_SECONDS = 90;

export interface TurnBarProps {
  view: GameView;
  playerId: PlayerId;
  yourTurn: boolean;
  turnSeconds?: number;
  onAction: (action: GameAction) => void;
  /** Signed deltas from the last view, for the tick and the floating number. */
  pulses?: Partial<Record<TickStat, number>>;
}

export function isTimeFlail(anomaly: GameView['anomaly']): boolean {
  if (!anomaly) return false;
  return anomaly.id === 'time_flail' || /time\s*flail/i.test(anomaly.name ?? '');
}

/** The only thing Time Flail touches. */
export function effectiveTurnSeconds(base: number, anomaly: GameView['anomaly']): number {
  const seconds = base > 0 ? base : DEFAULT_TURN_SECONDS;
  return isTimeFlail(anomaly) ? Math.max(5, Math.round(seconds / TIME_FLAIL_DIVISOR)) : seconds;
}

/**
 * Seconds left, from a deadline rather than an accumulator.
 *
 * The previous timer subtracted 1 from a counter once per `setInterval` tick,
 * which loses time on every frame the browser is busy and stops entirely in a
 * background tab — so a player coming back to the table saw a clock that
 * claimed more time than they had. Reading the deadline against the wall clock
 * is drift-free by construction and self-corrects after a throttled tab.
 */
export function remainingSeconds(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

function Stat({
  label,
  value,
  hot,
  pulse = 0,
}: {
  label: string;
  value: number;
  hot?: boolean;
  pulse?: number;
}): JSX.Element {
  const key = label.toLowerCase();
  const cls = ['stat'];
  if (hot) cls.push('stat-hot');
  if (pulse > 0) cls.push('stat-pulse-up');
  if (pulse < 0) cls.push('stat-pulse-down');

  // Keyed on the pulse so a second change of the same size restarts the
  // animation instead of leaving the first one to finish silently.
  return (
    <div className={cls.join(' ')} data-testid={`stat-${key}`} data-pulse={pulse || undefined}>
      <span className="stat-value" data-testid={`stat-${key}-value`}>
        {value}
      </span>
      <span className="stat-label">{label}</span>
      {pulse !== 0 && (
        <span
          key={`${value}:${pulse}`}
          className={`stat-delta ${pulse > 0 ? 'stat-delta-up' : 'stat-delta-down'}`}
          aria-hidden="true"
        >
          {pulse > 0 ? `+${pulse}` : pulse}
        </span>
      )}
    </div>
  );
}

export function TurnBar({
  view,
  playerId,
  yourTurn,
  turnSeconds = DEFAULT_TURN_SECONDS,
  onAction,
  pulses = {},
}: TurnBarProps): JSX.Element {
  const limit = effectiveTurnSeconds(turnSeconds, view.anomaly);
  const [remaining, setRemaining] = React.useState(limit);

  // Restart the clock whenever the turn or the active seat changes. Ticking at
  // 250ms rather than 1000ms is not about precision — it is so the digit is
  // right within a quarter second of a throttled tab waking up.
  React.useEffect(() => {
    const deadline = Date.now() + limit * 1000;
    const tick = (): void => setRemaining(remainingSeconds(deadline, Date.now()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [view.turn, view.activePlayer, limit]);

  const you = view.you;
  const low = remaining <= 10;

  return (
    <div className="turnbar">
      <div className="turnbar-left">
        <div className="turn-number">
          <span className="turn-label">Turn</span>
          <span className="turn-value" data-testid="turn-number">{view.turn}</span>
          <span className="round-value">round {view.round}</span>
        </div>
        <div className={`turn-timer${low ? ' turn-timer-low' : ''}`} title={`${limit}s per turn`}>
          ⏱ {formatClock(remaining)}
          {isTimeFlail(view.anomaly) && <span className="flail-tag">Time Flail</span>}
        </div>
      </div>

      <div className="turnbar-stats">
        <Stat
          label="Money"
          value={you.money}
          hot={yourTurn && you.money > 0}
          pulse={pulses.money ?? 0}
        />
        <Stat label="Buys" value={you.buys} pulse={pulses.buys ?? 0} />
        <Stat label="Actions" value={you.actions} pulse={pulses.actions ?? 0} />
        <Stat label="Prophet" value={you.prophet} pulse={pulses.prophet ?? 0} />
        <Stat label="VP" value={you.vp} pulse={pulses.vp ?? 0} />
        <Stat label="Combo" value={you.combo} pulse={pulses.combo ?? 0} />
      </div>

      <div className="turnbar-right">
        {view.doomsdayCounter > 0 && (
          <div className="doomsday" title="Doomsday counter">
            ☠ Doomsday {view.doomsdayCounter}
          </div>
        )}
        {view.hardEndTurn !== null && view.hardEndTurn !== undefined && (
          <div className="hard-end">ends T{view.hardEndTurn}</div>
        )}
        <button
          type="button"
          className="end-turn"
          data-testid="end-turn"
          disabled={!yourTurn || view.ended || view.pending !== null}
          onClick={() => onAction({ type: 'endTurn', player: playerId })}
        >
          End turn
        </button>
      </div>

      {view.anomaly && (
        <div className="anomaly-banner" data-testid="anomaly-banner">
          <span className="anomaly-name">{view.anomaly.name}</span>
          <span className="anomaly-text">{view.anomaly.text}</span>
        </div>
      )}
    </div>
  );
}

export default TurnBar;
