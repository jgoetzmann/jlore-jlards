/**
 * The room before it is a match.
 *
 * Everything here is roster and waiting: no engine has run, no cards exist, and
 * the only decision on the screen is the host's. It is deliberately a place you
 * can look at for half a minute without irritation — the seats fill in front of
 * you, the empty ones breathe, and the invite link is one click away, because
 * the thirty seconds spent here are thirty seconds spent chasing a friend into
 * a Discord call.
 */

import React from 'react';
import type { LobbyInfo, LobbyMemberInfo } from './useGame';
import './lobby.css';

/** Stable per-seat hue, so the same person keeps the same colour all session. */
function hueOf(seat: string): number {
  let h = 0;
  for (let i = 0; i < seat.length; i++) h = (h * 31 + seat.charCodeAt(i)) % 360;
  return h;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const WAITING_LINES = [
  'Prophet never resets. Every point you bank is banked for the whole match.',
  'Roughly a third of matches roll an Anomaly that rewrites a rule for everyone.',
  'Auras sit in your Field and stay there. Celestial ones work without being asked.',
  'Your own library is a number, even to you. Nobody is dealt a look at it.',
  'The Prophet Shop is gated by thresholds, not by money.',
  'Hotseat needs no relay at all — two hands, one browser, no account.',
];

function SeatRow({ member }: { member: LobbyMemberInfo }): JSX.Element {
  const hue = hueOf(member.seat);
  return (
    <li
      className={`lobby-seat lobby-seat-taken${member.isYou ? ' lobby-seat-you' : ''}`}
      data-testid="lobby-player"
      data-player-name={member.name}
      data-player-host={member.isHost ? 'true' : 'false'}
      data-player-you={member.isYou ? 'true' : 'false'}
    >
      <span
        className="lobby-avatar"
        style={{
          background: `hsl(${hue} 48% 26%)`,
          borderColor: `hsl(${hue} 62% 52%)`,
          color: `hsl(${hue} 80% 82%)`,
        }}
        aria-hidden="true"
      >
        {initialsOf(member.name)}
      </span>
      <span className="lobby-name">{member.name}</span>
      {member.isHost && <span className="lobby-pill lobby-pill-host">Host</span>}
      {member.isYou && <span className="lobby-pill lobby-pill-you">You</span>}
      <span className="lobby-seat-state">ready</span>
    </li>
  );
}

function EmptySeat({ index }: { index: number }): JSX.Element {
  return (
    <li className="lobby-seat lobby-seat-open">
      <span className="lobby-avatar lobby-avatar-open" aria-hidden="true">
        {index + 1}
      </span>
      <span className="lobby-name lobby-name-open">Open seat</span>
      <span className="lobby-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </li>
  );
}

export function Lobby({
  info,
  onStart,
  onSeatCap,
  onLeave,
}: {
  info: LobbyInfo;
  onStart: () => void;
  onSeatCap: (cap: number) => void;
  onLeave: () => void;
}): JSX.Element {
  const [copied, setCopied] = React.useState(false);
  const [tip, setTip] = React.useState(0);

  React.useEffect(() => {
    const t = setInterval(() => setTip((n) => (n + 1) % WAITING_LINES.length), 7000);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const state = info.missed ? 'missed' : info.full ? 'full' : info.waiting ? 'waiting' : 'open';
  const here = info.members.length;
  const open = Math.max(0, info.seatCap - here);

  function copyLink(): void {
    try {
      void navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      /* clipboard is a nicety, and the code is on screen anyway */
    }
  }

  // The two dead ends. Both are honest about what happened rather than leaving
  // somebody on a spinner, which is the failure this whole screen exists to end.
  if (info.missed || info.full) {
    return (
      <div className="lobby" data-testid="lobby" data-lobby-state={state}>
        <div className="lobby-card lobby-card-shut">
          <h1 className="lobby-shut-title">
            {info.missed ? 'That match has already started' : 'This room is full'}
          </h1>
          <p className="lobby-shut-text">
            {info.missed
              ? `Room ${info.code} dealt its cards before you arrived, and a deck-builder cannot take a player mid-game. Ask them for the next one.`
              : `Room ${info.code} is holding all ${info.seatCap} of its seats. The host has been told you are out here — keep this tab open and you will be let in the moment they make room.`}
          </p>
          {info.full && (
            <p className="lobby-knocking">
              <span className="lobby-dots lobby-dots-inline" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              still knocking
            </p>
          )}
          <div className="lobby-shut-actions">
            <button type="button" className="primary" onClick={onLeave}>
              Back to the start
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby" data-testid="lobby" data-lobby-state={state}>
      <div className="lobby-card">
        <div className="lobby-head">
          <div>
            <p className="lobby-eyebrow">Room</p>
            <h1 className="lobby-code" data-testid="lobby-code">
              {info.code}
            </h1>
          </div>
          <button
            type="button"
            className="lobby-copy"
            data-testid="lobby-copy"
            onClick={copyLink}
          >
            {copied ? 'Link copied' : 'Copy invite link'}
          </button>
        </div>

        <p className="lobby-sub">
          Send that link to the people in your call. Nothing is dealt until the host
          starts, and the match is built for whoever is sitting here when they do.
        </p>

        <div className="lobby-roster-head">
          <span className="lobby-roster-title">
            In the room
            <span className="lobby-count" data-testid="lobby-count">
              {here} / {info.seatCap}
            </span>
          </span>
          {info.youAreHost && (
            <span className="lobby-caps">
              <span className="lobby-caps-label">Seats</span>
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`lobby-cap${info.seatCap === n ? ' lobby-cap-on' : ''}`}
                  data-testid="lobby-seat-cap"
                  data-cap={n}
                  disabled={n < here}
                  onClick={() => onSeatCap(n)}
                >
                  {n}
                </button>
              ))}
            </span>
          )}
        </div>

        <ul className="lobby-seats">
          {info.members.map((m) => (
            <SeatRow key={m.seat} member={m} />
          ))}
          {Array.from({ length: open }, (_, i) => (
            <EmptySeat key={`open-${i}`} index={here + i} />
          ))}
        </ul>

        {info.youAreHost && info.knocking > 0 && (
          <p className="lobby-knocking" data-testid="lobby-knocking">
            {info.knocking === 1 ? 'Somebody is' : `${info.knocking} people are`} waiting for a
            seat this room does not have.
            {info.seatCap < 4 && (
              <button
                type="button"
                className="lobby-knocking-add"
                onClick={() => onSeatCap(Math.min(4, info.seatCap + info.knocking))}
              >
                Make room
              </button>
            )}
          </p>
        )}

        {info.waiting && (
          <p className="lobby-connecting">
            <span className="prompt-spinner" aria-hidden="true" />
            Knocking on room {info.code}…
          </p>
        )}

        <div className="lobby-foot">
          {info.youAreHost ? (
            <>
              <button
                type="button"
                className="primary lobby-start"
                data-testid="lobby-start"
                onClick={onStart}
              >
                {here > 1 ? `Start with ${here} players` : 'Start on your own'}
              </button>
              <span className="lobby-foot-note">
                {here > 1
                  ? 'Deals a fresh match for exactly these seats.'
                  : 'Nobody else is here yet. Send them the link, or play solo.'}
              </span>
            </>
          ) : (
            <span className="lobby-waiting" data-testid="lobby-waiting">
              Waiting for the host to start
              <span className="lobby-dots lobby-dots-inline" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </span>
          )}
          <button type="button" className="ghost lobby-leave" onClick={onLeave}>
            Leave
          </button>
        </div>

        <p className="lobby-tip" key={tip}>
          {WAITING_LINES[tip]}
        </p>
      </div>
    </div>
  );
}

export default Lobby;
