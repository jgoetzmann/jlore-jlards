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

export const TIME_FLAIL_DIVISOR = 2.5;
export const DEFAULT_TURN_SECONDS = 90;

export interface TurnBarProps {
  view: GameView;
  playerId: PlayerId;
  yourTurn: boolean;
  turnSeconds?: number;
  onAction: (action: GameAction) => void;
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

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

function Stat({ label, value, hot }: { label: string; value: number; hot?: boolean }): JSX.Element {
  return (
    <div className={`stat${hot ? ' stat-hot' : ''}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function TurnBar({
  view,
  playerId,
  yourTurn,
  turnSeconds = DEFAULT_TURN_SECONDS,
  onAction,
}: TurnBarProps): JSX.Element {
  const limit = effectiveTurnSeconds(turnSeconds, view.anomaly);
  const [remaining, setRemaining] = React.useState(limit);

  // Restart the clock whenever the turn or the active seat changes.
  React.useEffect(() => {
    setRemaining(limit);
    const id = setInterval(() => {
      setRemaining((r) => (r <= 0 ? 0 : r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [view.turn, view.activePlayer, limit]);

  const you = view.you;
  const low = remaining <= 10;

  return (
    <div className="turnbar">
      <div className="turnbar-left">
        <div className="turn-number">
          <span className="turn-label">Turn</span>
          <span className="turn-value">{view.turn}</span>
          <span className="round-value">round {view.round}</span>
        </div>
        <div className={`turn-timer${low ? ' turn-timer-low' : ''}`} title={`${limit}s per turn`}>
          ⏱ {formatClock(remaining)}
          {isTimeFlail(view.anomaly) && <span className="flail-tag">Time Flail</span>}
        </div>
      </div>

      <div className="turnbar-stats">
        <Stat label="Money" value={you.money} hot={yourTurn && you.money > 0} />
        <Stat label="Buys" value={you.buys} />
        <Stat label="Actions" value={you.actions} />
        <Stat label="Prophet" value={you.prophet} />
        <Stat label="VP" value={you.vp} />
        <Stat label="Combo" value={you.combo} />
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
          disabled={!yourTurn || view.ended || view.pending !== null}
          onClick={() => onAction({ type: 'endTurn', player: playerId })}
        >
          End turn
        </button>
      </div>

      {view.anomaly && (
        <div className="anomaly-banner">
          <span className="anomaly-name">{view.anomaly.name}</span>
          <span className="anomaly-text">{view.anomaly.text}</span>
        </div>
      )}
    </div>
  );
}

export default TurnBar;
