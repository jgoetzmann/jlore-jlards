/**
 * Auras. Heroic gets an Activate (2) button, disabled once it has been used
 * this turn — one Heroic, unlimited Celestial, one Hypercelestial.
 *
 * `variant="strip"` is the dock form (SB-63): one chip per aura at the start of
 * the in-play strip, with the aura's text as its tooltip and the Activate
 * button inline. Activation spends Money, so it has to sit next to the hand and
 * the Money readout, not in a drawer.
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
  variant?: 'panel' | 'strip';
}

const TIER_ORDER: AuraTier[] = ['hypercelestial', 'heroic', 'celestial'];

function tierRank(tier: AuraTier): number {
  const i = TIER_ORDER.indexOf(tier);
  return i < 0 ? TIER_ORDER.length : i;
}

function activateTitle(usedThisTurn: boolean, money: number): string {
  if (usedThisTurn) return 'Already activated this turn';
  if (money < HEROIC_ACTIVATION_COST) return 'Costs 2 Money';
  return 'Activate this aura';
}

export function Field({
  field,
  playerId,
  money,
  yourTurn,
  onAction,
  variant = 'panel',
}: FieldProps): JSX.Element | null {
  const auras = field.slice().sort((a, b) => tierRank(a.tier) - tierRank(b.tier));

  function activate(auraId: AuraId): void {
    onAction({ type: 'activateAura', player: playerId, auraId });
  }

  if (variant === 'strip') {
    if (auras.length === 0) return null;
    return (
      <div className="field field-strip" data-testid="field">
        {auras.map((aura) => {
          const heroic = aura.tier === 'heroic';
          const canActivate =
            heroic && yourTurn && !aura.usedThisTurn && money >= HEROIC_ACTIVATION_COST;
          return (
            <span
              className={`aura-chip aura-${aura.tier}`}
              key={aura.auraId}
              title={`${aura.name} (${aura.tier}) — ${aura.text}`}
            >
              <span className="aura-name">{aura.name}</span>
              {heroic && (
                <button
                  type="button"
                  className="aura-activate"
                  disabled={!canActivate}
                  title={activateTitle(aura.usedThisTurn, money)}
                  onClick={() => activate(aura.auraId)}
                >
                  {aura.usedThisTurn ? 'used' : `Activate (${HEROIC_ACTIVATION_COST})`}
                </button>
              )}
            </span>
          );
        })}
      </div>
    );
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
                  title={activateTitle(aura.usedThisTurn, money)}
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
