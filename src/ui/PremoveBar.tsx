/**
 * The premove bar in the dock strip (SB-68).
 *
 *   off, available   [Premove]                       premove-toggle
 *   on               Premoving your next turn · N queued  [Watch live] [Clear]
 *                                                    premove-bar, premove-live, premove-clear
 *   committed        "N committed — they showed you cards, so they can't be cleared"
 *                                                    premove-committed (Clear only drops the rest)
 *   after a rollback "A premove was undone — the turn changed it"   premove-rolled-back
 *   after a refusal  "Can't premove that — it would show another player's cards"
 *                                                    premove-refused
 *
 * It sits in the strip's own row, which scrolls sideways, so it never adds
 * height to the dock (SB-63). The notices never name a card, and never say what
 * an undone preview showed.
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
  /** Of `count`, the premoves Clear cannot remove (their previews showed hidden information). */
  committed?: number;
  rolledBack: number;
  /** Bumps when a premove was refused because it would show another player's hidden cards. */
  refused?: number;
  onActive: (on: boolean) => void;
  onClear: () => void;
}

/** True for PREMOVE_NOTICE_MS after `counter` changes. */
function useNotice(counter: number): boolean {
  const [on, setOn] = React.useState(false);
  const seen = React.useRef(counter);
  React.useEffect(() => {
    if (seen.current === counter) return;
    seen.current = counter;
    setOn(true);
    const t = setTimeout(() => setOn(false), PREMOVE_NOTICE_MS);
    return () => clearTimeout(t);
  }, [counter]);
  return on;
}

export function PremoveBar({
  available,
  active,
  showing,
  count,
  committed = 0,
  rolledBack,
  refused = 0,
  onActive,
  onClear,
}: PremoveBarProps): JSX.Element | null {
  const undoneOn = useNotice(rolledBack);
  const refusedOn = useNotice(refused);

  const notices = (
    <>
      {refusedOn && (
        <span className="premove-undone" data-testid="premove-refused" role="status">
          Can't premove that — it would show another player's cards
        </span>
      )}
      {undoneOn && (
        <span className="premove-undone" data-testid="premove-rolled-back" role="status">
          A premove was undone — the turn changed it
        </span>
      )}
    </>
  );

  if (active) {
    const kept = Math.min(Math.max(0, committed), count);
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
        {kept > 0 && (
          <span className="premove-committed" data-testid="premove-committed" data-committed={kept}>
            {kept} committed — they showed you cards, so they can't be cleared
          </span>
        )}
        <button type="button" className="premove-btn" data-testid="premove-live" onClick={() => onActive(false)}>
          Watch live
        </button>
        <button
          type="button"
          className="premove-btn"
          data-testid="premove-clear"
          disabled={count - kept === 0}
          onClick={onClear}
        >
          Clear
        </button>
        {notices}
      </div>
    );
  }

  if (!available && count === 0) return notices;

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
      {notices}
    </>
  );
}

export default PremoveBar;
