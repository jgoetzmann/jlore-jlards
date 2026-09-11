/**
 * What the other players are doing.
 *
 * Extracted from App.tsx so it can be worked on without colliding with the
 * lobby. Everything here reads `GameView.others`, which the view filter has
 * already stripped of hidden information: hands and libraries arrive as counts,
 * never as cards.
 */

import React from 'react';
import type { GameView } from '@engine/types';
import { Card } from './Card';

export function Opponents({ view }: { view: GameView }): JSX.Element {
  return (
    <div className="opponents" data-testid="opponents">
      {view.others.map((o) => (
        <div
          className={`opponent${o.eliminated ? ' opponent-out' : ''}`}
          data-testid="opponent"
          data-opponent-id={o.id}
          data-hand-count={o.handCount}
          data-library-count={o.libraryCount}
          key={o.id}
        >
          <div className="opponent-head">
            <span className="opponent-name">{o.name}</span>
            {view.activePlayer === o.id && <span className="opponent-turn">to move</span>}
            {o.eliminated && <span className="opponent-elim">eliminated</span>}
          </div>
          <div className="opponent-stats">
            <span title="cards in hand">✋ {o.handCount}</span>
            <span title="cards in library">📚 {o.libraryCount}</span>
            <span title="victory points">★ {o.vp}</span>
            <span title="banked prophet">◈ {o.prophet}</span>
          </div>
          {o.field.length > 0 && (
            <div className="opponent-auras">
              {o.field.map((a) => (
                <span className={`aura-chip aura-${a.tier}`} key={a.auraId} title={a.text}>
                  {a.name}
                </span>
              ))}
            </div>
          )}
          {o.play.length > 0 && (
            <div className="opponent-play">
              {o.play.map((c) => (
                <Card key={c.iid} card={c} compact />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default Opponents;
