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
 * SB-36: Time Flail divides `config.turnSeconds`. It is a timer modifier and
 * nothing else — no rule and no engine behavior changes, and the timer running
 * out does not end the turn on its own.
 */

import React from 'react';
import type { GameAction, GameView, PlayerId } from '@engine/types';

export const TIME_FLAIL_DIVISOR = 2.5;
export const DEFAULT_TURN_SECONDS = 90;

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

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------

export function TurnClock({
  view,
  turnSeconds = DEFAULT_TURN_SECONDS,
}: {
  view: GameView;
  turnSeconds?: number;
}): JSX.Element {
  const limit = effectiveTurnSeconds(turnSeconds, view.anomaly);
  const [remaining, setRemaining] = React.useState(limit);

  // Restart the clock whenever the turn or the active seat changes. The tick is
  // local to this component so it never re-renders the rest of the table.
  React.useEffect(() => {
    setRemaining(limit);
    const id = setInterval(() => {
      setRemaining((r) => (r <= 0 ? 0 : r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [view.turn, view.activePlayer, limit]);

  const low = remaining <= 10;

  return (
    <div className="turn-clock">
      <span className="turn-number">
        <span className="turn-label">Turn</span>
        <span className="turn-value" data-testid="turn-number">
          {view.turn}
        </span>
        <span className="round-value">round {view.round}</span>
      </span>
      <span className={`turn-timer${low ? ' turn-timer-low' : ''}`} title={`${limit}s per turn`}>
        {formatClock(remaining)}
        {isTimeFlail(view.anomaly) && <span className="flail-tag">Time Flail</span>}
      </span>
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

/** The anomaly as a topbar chip. Click to read the whole rule in place. */
export function AnomalyChip({ anomaly }: { anomaly: GameView['anomaly'] }): JSX.Element | null {
  const [open, setOpen] = React.useState(false);
  if (!anomaly) return null;
  return (
    <button
      type="button"
      className={`anomaly-banner anomaly-chip${open ? ' anomaly-open' : ''}`}
      data-testid="anomaly-banner"
      aria-expanded={open}
      title={`${anomaly.name}: ${anomaly.text}`}
      onClick={() => setOpen((v) => !v)}
    >
      <span className="anomaly-name">{anomaly.name}</span>
      <span className="anomaly-text">{anomaly.text}</span>
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
}: {
  label: string;
  value: number;
  hot?: boolean;
  minor?: boolean;
}): JSX.Element {
  const id = label.toLowerCase();
  return (
    <div className={`stat${hot ? ' stat-hot' : ''}${minor ? ' stat-minor' : ''}`} data-testid={`stat-${id}`}>
      <span className="stat-value" data-testid={`stat-${id}-value`}>
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
  /**
   * Play every plain Resource in hand. UI-2 wires it (one batch intent via
   * `session.sendMany`); until then no caller passes it and no button renders,
   * so nothing on the table advertises an action that does nothing.
   */
  onPlayMoney?: () => void;
  /** What Play money would add, for its label. */
  playMoneyTotal?: number;
}

export function StatCluster({
  view,
  playerId,
  yourTurn,
  onAction,
  onPlayMoney,
  playMoneyTotal = 0,
}: StatClusterProps): JSX.Element {
  const you = view.you;
  const canEnd = yourTurn && !view.ended && view.pending === null;
  return (
    <div className="cluster" data-testid="stat-cluster">
      <div className="cluster-stats">
        <Stat label="Money" value={you.money} hot={yourTurn && you.money > 0} />
        <Stat label="Buys" value={you.buys} />
        <Stat label="Actions" value={you.actions} />
      </div>
      <div className="cluster-minor">
        <Stat label="Prophet" value={you.prophet} minor />
        <Stat label="VP" value={you.vp} minor />
        <Stat label="Combo" value={you.combo} minor />
      </div>
      <div className="cluster-actions">
        {onPlayMoney && (
          <button
            type="button"
            className="play-money"
            data-testid="play-money"
            disabled={!yourTurn || playMoneyTotal <= 0 || view.pending !== null}
            onClick={onPlayMoney}
          >
            Play money (+{playMoneyTotal})
          </button>
        )}
        <button
          type="button"
          className="end-turn"
          data-testid="end-turn"
          disabled={!canEnd}
          title={
            !yourTurn ? 'Not your turn' : view.pending !== null ? 'Answer the open prompt first' : 'End your turn'
          }
          onClick={() => onAction({ type: 'endTurn', player: playerId })}
        >
          End turn
        </button>
      </div>
    </div>
  );
}
