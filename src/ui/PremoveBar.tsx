/**
 * The premove bar in the dock strip (SB-68).
 *
 *   off, available   [Premove]                       premove-toggle
 *   on               Premoving your next turn · N queued  [Watch live] [Clear]
 *                                                    premove-bar, premove-live, premove-clear
 *   after a rollback "A premove was undone — the turn changed it"   premove-rolled-back
 *
 * It sits in the strip's own row, which scrolls sideways, so it never adds
 * height to the dock (SB-63). The notice says only that something was undone:
 * never which card, and never what the undone preview showed.
 */

import React from 'react';
import './premove.css';

export const PREMOVE_NOTICE_MS = 4000;

export interface PremoveBarProps {
  available: boolean;
  active: boolean;
  /** The table is showing the premove branch (not paused on a prompt or the like). */
  showing: boolean;
  count: number;
  rolledBack: number;
  onActive: (on: boolean) => void;
  onClear: () => void;
}

export function PremoveBar({
  available,
  active,
  showing,
  count,
  rolledBack,
  onActive,
  onClear,
}: PremoveBarProps): JSX.Element | null {
  const [notice, setNotice] = React.useState(false);
  const seen = React.useRef(rolledBack);
  React.useEffect(() => {
    if (seen.current === rolledBack) return;
    seen.current = rolledBack;
    setNotice(true);
    const t = setTimeout(() => setNotice(false), PREMOVE_NOTICE_MS);
    return () => clearTimeout(t);
  }, [rolledBack]);

  const undone = notice ? (
    <span className="premove-undone" data-testid="premove-rolled-back" role="status">
      A premove was undone — the turn changed it
    </span>
  ) : null;

  if (active) {
    return (
      <div
        className="premove-bar"
        data-testid="premove-bar"
        data-count={count}
        data-showing={showing ? 'true' : 'false'}
      >
        <span className="premove-label">
          {showing ? 'Premoving your next turn' : 'Premove paused — the table is waiting on a choice'}
        </span>
        <span className="premove-count">
          <b>{count}</b> queued
        </span>
        <button type="button" className="premove-btn" data-testid="premove-live" onClick={() => onActive(false)}>
          Watch live
        </button>
        <button
          type="button"
          className="premove-btn"
          data-testid="premove-clear"
          disabled={count === 0}
          onClick={onClear}
        >
          Clear
        </button>
        {undone}
      </div>
    );
  }

  if (!available && count === 0) return undone;

  return (
    <>
      <button
        type="button"
        className="premove-toggle"
        data-testid="premove-toggle"
        data-count={count}
        disabled={!available}
        title="Queue your next turn's plays and buys while you wait"
        onClick={() => onActive(true)}
      >
        Premove{count > 0 ? ` · ${count} queued` : ''}
      </button>
      {undone}
    </>
  );
}

export default PremoveBar;
