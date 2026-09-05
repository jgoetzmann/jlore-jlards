/**
 * Auras. Heroic gets an Activate (2) button, disabled once it has been used
 * this turn — one Heroic, unlimited Celestial, one Hypercelestial.
 */

import React from 'react';
import type { AuraId, AuraTier, GameAction, PlayerId, SelfView } from '@engine/types';

export const HEROIC_ACTIVATION_COST = 2;

export interface FieldProps {
  field: SelfView['field'];
  playerId: PlayerId;
  money: number;
  yourTurn: boolean;
  onAction: (action: GameAction) => void;
}

const TIER_ORDER: AuraTier[] = ['hypercelestial', 'heroic', 'celestial'];

function tierRank(tier: AuraTier): number {
  const i = TIER_ORDER.indexOf(tier);
  return i < 0 ? TIER_ORDER.length : i;
}

export function Field({ field, playerId, money, yourTurn, onAction }: FieldProps): JSX.Element {
  const auras = field.slice().sort((a, b) => tierRank(a.tier) - tierRank(b.tier));

  function activate(auraId: AuraId): void {
    onAction({ type: 'activateAura', player: playerId, auraId });
  }

  return (
    <div className="field">
      <div className="field-head">
        <h3>Field</h3>
        <span className="field-count">{auras.length} aura{auras.length === 1 ? '' : 's'}</span>
      </div>

      {auras.length === 0 && <div className="field-empty">no auras</div>}

      <div className="field-list">
        {auras.map((aura) => {
          const heroic = aura.tier === 'heroic';
          const canActivate =
            heroic && yourTurn && !aura.usedThisTurn && money >= HEROIC_ACTIVATION_COST;
          return (
            <div className={`aura aura-${aura.tier}`} key={aura.auraId}>
              <div className="aura-head">
                <span className="aura-name">{aura.name}</span>
                <span className="aura-tier">{aura.tier}</span>
              </div>
              <div className="aura-text">{aura.text}</div>
              {heroic && (
                <button
                  type="button"
                  className="aura-activate"
                  disabled={!canActivate}
                  onClick={() => activate(aura.auraId)}
                  title={
                    aura.usedThisTurn
                      ? 'Already activated this turn'
                      : money < HEROIC_ACTIVATION_COST
                        ? 'Costs 2 Money'
                        : 'Activate this aura'
                  }
                >
                  Activate ({HEROIC_ACTIVATION_COST})
                  {aura.usedThisTurn ? ' — used' : ''}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Field;
