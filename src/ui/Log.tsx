/**
 * The action log. Newest first, because the interesting entry is always the
 * one that just happened.
 *
 * The sentences come from `logtext.ts` (LAY-8): the log is the sole record of
 * what an opponent did on a turn you were not watching, so it is worth reading
 * rather than decoding. It lives in the table's drawer.
 *
 * Render cost (RENDER-1): only the newest `LOG_PAGE` lines are drawn, with a
 * button for older ones; runs of the same line ("draws a card" ×5) collapse
 * into one; and each row is memoised on its content, so a new entry adds one
 * row instead of re-rendering the whole list.
 */

import React from 'react';
import type { LogEntry } from '@engine/types';
import { describeLog, type LogNaming } from './logtext';
import { cardNameOf } from './cardview';

/** Lines drawn before "show older". */
export const LOG_PAGE = 50;

export interface LogProps {
  log: LogEntry[];
  names: Record<string, string>;
  limit?: number;
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

export interface LogLineLike {
  seq: number;
  turn: number;
  who: string | null;
  text: string;
  tone: string;
}

export type CollapsedLine<T extends LogLineLike> = T & { times: number };

/**
 * Merge adjacent lines that say the same thing in the same turn by the same
 * player. The merged line keeps the first line's seq, so its React key is
 * stable while the run grows at the top.
 */
export function collapseLines<T extends LogLineLike>(lines: readonly T[]): CollapsedLine<T>[] {
  const out: CollapsedLine<T>[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && prev.turn === line.turn && prev.who === line.who && prev.text === line.text && prev.tone === line.tone) {
      prev.times += 1;
      continue;
    }
    out.push({ ...line, times: 1 });
  }
  return out;
}

const LogRow = React.memo(
  function LogRow({ line }: { line: CollapsedLine<LogLineLike> }): JSX.Element {
    return (
      <li className={`log-entry log-tone-${line.tone}`} data-testid="log-entry">
        <span className="log-turn">T{line.turn}</span>
        {line.who && <span className="log-player">{line.who}</span>}
        <span className="log-text">{line.text}</span>
        {line.times > 1 && <span className="log-times">×{line.times}</span>}
      </li>
    );
  },
  (a, b) =>
    a.line.seq === b.line.seq &&
    a.line.times === b.line.times &&
    a.line.text === b.line.text &&
    a.line.who === b.line.who &&
    a.line.tone === b.line.tone &&
    a.line.turn === b.line.turn,
);

function LogImpl({ log, names, limit }: LogProps): JSX.Element {
  const [shown, setShown] = React.useState(limit ?? LOG_PAGE);
  const naming = React.useMemo<LogNaming>(
    () => ({
      player: (id) => names[id] ?? id,
      card: cardNameOf,
    }),
    [names],
  );

  // Describe a few more raw entries than we draw: collapsing runs eats some.
  const lines = React.useMemo(() => {
    const described = describeLog(log, naming, shown * 3) as unknown as LogLineLike[];
    return collapseLines(described);
  }, [log, naming, shown]);
  const visible = lines.slice(0, shown);
  const more = lines.length > shown || log.length > shown * 3;

  return (
    <div className="log" data-testid="log">
      <h3 className="log-head">Log</h3>
      <ol className="log-list">
        {visible.length === 0 && <li className="log-empty">nothing yet</li>}
        {visible.map((line) => (
          <LogRow line={line} key={line.seq} />
        ))}
      </ol>
      {more && (
        <button type="button" className="log-more" onClick={() => setShown((n) => n + LOG_PAGE * 2)}>
          Show older
        </button>
      )}
    </div>
  );
}

export const Log = React.memo(LogImpl);

export default Log;
