/**
 * The action log. Newest first, because the interesting entry is always the
 * one that just happened.
 */

import React from 'react';
import type { LogEntry } from '@engine/types';

export interface LogProps {
  log: LogEntry[];
  names: Record<string, string>;
  limit?: number;
}

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

export function Log({ log, names, limit = 120 }: LogProps): JSX.Element {
  const [open, setOpen] = React.useState(true);
  const entries = log.slice(-limit).reverse();

  return (
    <div className={`log${open ? '' : ' log-collapsed'}`}>
      <div className="log-head">
        <h3>Log</h3>
        <button type="button" className="log-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? 'hide' : 'show'}
        </button>
      </div>
      {open && (
        <ol className="log-list">
          {entries.length === 0 && <li className="log-empty">nothing yet</li>}
          {entries.map((e) => (
            <li className={`log-entry log-kind-${e.kind}`} key={e.seq}>
              <span className="log-seq">{e.seq}</span>
              <span className="log-turn">T{e.turn}</span>
              <span className="log-player">{e.player ? (names[e.player] ?? e.player) : '—'}</span>
              <span className="log-what">{e.kind}</span>
              <span className="log-detail">{describeDetail(e.detail)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default Log;
