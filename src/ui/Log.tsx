/**
 * The action log. Newest first, because the interesting entry is always the
 * one that just happened.
 *
 * The sentences come from `logtext.ts`. This file is only the frame: the log is
 * the sole record of what an opponent did on a turn you were not watching, so
 * it is worth reading rather than decoding.
 */

import React from 'react';
import type { LogEntry } from '@engine/types';
import { describeLog, type LogNaming } from './logtext';
import { cardNameOf } from './cardview';

export interface LogProps {
  log: LogEntry[];
  names: Record<string, string>;
  limit?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Kept exported: the raw shape is still what an unknown entry falls back to. */
export function describeDetail(detail: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail ?? {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      parts.push(`${key}=${Array.isArray(value) ? `[${value.length}]` : '{…}'}`);
      continue;
    }
    parts.push(`${key}=${String(value)}`);
  }
  return parts.join(' ');
}

export function Log({ log, names, limit = 120, open, onOpenChange }: LogProps): JSX.Element {
  const [ownOpen, setOwnOpen] = React.useState(true);
  const isOpen = open === undefined ? ownOpen : open;

  function setOpen(next: boolean): void {
    if (onOpenChange) onOpenChange(next);
    if (open === undefined) setOwnOpen(next);
  }

  const naming = React.useMemo<LogNaming>(
    () => ({
      player: (id) => names[id] ?? id,
      card: cardNameOf,
    }),
    [names],
  );

  const lines = React.useMemo(
    () => describeLog(log, naming, limit),
    [log, naming, limit],
  );

  return (
    <div className={`log${isOpen ? '' : ' log-collapsed'}`} data-testid="log">
      <div className="log-head">
        <h3>Log</h3>
        <button
          type="button"
          className="log-toggle"
          data-testid="log-toggle"
          onClick={() => setOpen(!isOpen)}
        >
          {isOpen ? 'hide' : 'show'}
        </button>
      </div>
      {isOpen && (
        <ol className="log-list">
          {lines.length === 0 && <li className="log-empty">nothing yet</li>}
          {lines.map((line) => (
            <li className={`log-entry log-tone-${line.tone}`} key={line.seq} data-testid="log-entry">
              <span className="log-turn">T{line.turn}</span>
              {line.who && <span className="log-player">{line.who}</span>}
              <span className="log-text">{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default Log;
