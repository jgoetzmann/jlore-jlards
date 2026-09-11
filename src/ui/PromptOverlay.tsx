/**
 * Renders `view.pending` when it is yours: Discover pickers, choose-one menus,
 * pile selection, card selection and ordering. Sends back
 * `{type:'resolve', promptId, keys}`.
 *
 * When `pending` is `{waitingOn}` the options are not in this browser at all —
 * the view filter never shipped them — so all there is to show is who the
 * table is waiting for.
 */

import React from 'react';
import type { GameAction, GameView, PlayerId, Prompt, PromptOption } from '@engine/types';
import { Card } from './Card';
import { printedCardView } from './cardview';
import { promptBounds, promptReady, togglePick } from './prompt';

export interface PromptOverlayProps {
  pending: GameView['pending'];
  playerId: PlayerId;
  names: Record<string, string>;
  onAction: (action: GameAction) => void;
  /**
   * Controlled selection. Supplied by the table so the keyboard can drive the
   * same state the mouse does; left undefined the overlay keeps its own.
   */
  picked?: string[];
  onPickedChange?: (next: string[]) => void;
}

function isWaiting(p: GameView['pending']): p is { waitingOn: PlayerId } {
  return p !== null && typeof p === 'object' && 'waitingOn' in p;
}

function isPrompt(p: GameView['pending']): p is Prompt {
  return p !== null && typeof p === 'object' && 'id' in p && 'options' in p;
}

// The selection rules live in `prompt.ts`, pure and DOM-free, because the table
// drives the same prompt from the keyboard and both must agree exactly. Kept
// re-exported here so existing importers of this module still find them.
export { promptBounds, promptReady, togglePick, ORDERING_TYPES } from './prompt';
export type { PromptBounds } from './prompt';

function OptionButton({
  option,
  selected,
  index,
  slot,
  onToggle,
}: {
  option: PromptOption;
  selected: boolean;
  index: number;
  /** Position in the list, for the digit hint and the staggered entrance. */
  slot: number;
  onToggle: () => void;
}): JSX.Element {
  // A card-bearing option renders as the card. Everything else — "choose one"
  // clauses, pile picks, player picks — keeps the label, which is all there is.
  const face = option.defId ? printedCardView(option.defId, option.key) : null;
  const digit = slot < 9 ? String(slot + 1) : slot === 9 ? '0' : null;

  return (
    <button
      type="button"
      className={`prompt-option${selected ? ' prompt-option-selected' : ''}${
        face ? ' prompt-option-card' : ''
      }`}
      style={{ ['--i']: String(slot) } as React.CSSProperties}
      data-testid="prompt-option"
      data-option-key={option.key}
      data-option-def={option.defId}
      onClick={onToggle}
    >
      {selected && <span className="prompt-order-index">{index + 1}</span>}
      {digit && (
        <span className="prompt-option-key" aria-hidden="true">
          {digit}
        </span>
      )}
      {face ? (
        <>
          <Card card={face} compact={false} selected={selected} />
          {option.label && option.label !== face.name && (
            <span className="prompt-option-label">{option.label}</span>
          )}
        </>
      ) : (
        <>
          <span className="prompt-option-label">{option.label}</span>
          {option.defId && <span className="prompt-option-def">{option.defId}</span>}
        </>
      )}
      {option.pileId && <span className="prompt-option-pile">pile {option.pileId}</span>}
    </button>
  );
}

export function PromptOverlay({
  pending,
  playerId,
  names,
  onAction,
  picked: controlledPicked,
  onPickedChange,
}: PromptOverlayProps): JSX.Element | null {
  const promptId = isPrompt(pending) ? pending.id : null;
  const [ownPicked, setOwnPicked] = React.useState<string[]>([]);
  const controlled = controlledPicked !== undefined;
  const picked = controlled ? controlledPicked : ownPicked;

  const setPicked = React.useCallback(
    (next: string[]) => {
      if (onPickedChange) onPickedChange(next);
      if (!controlled) setOwnPicked(next);
    },
    [controlled, onPickedChange],
  );

  React.useEffect(() => {
    if (!controlled) setOwnPicked([]);
    // The table clears the controlled copy when the prompt id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptId]);

  if (pending === null || pending === undefined) return null;

  if (isWaiting(pending)) {
    const who = names[pending.waitingOn] ?? pending.waitingOn;
    return (
      <div className="prompt-overlay prompt-waiting" data-testid="prompt-waiting">
        <div className="prompt-card">
          <div className="prompt-spinner" aria-hidden="true" />
          <h3>Waiting on {who}</h3>
          <p className="prompt-note">Their choice is not in this browser.</p>
        </div>
      </div>
    );
  }

  if (!isPrompt(pending)) return null;
  if (pending.player !== playerId) {
    const who = names[pending.player] ?? pending.player;
    return (
      <div className="prompt-overlay prompt-waiting" data-testid="prompt-waiting">
        <div className="prompt-card">
          <div className="prompt-spinner" aria-hidden="true" />
          <h3>Waiting on {who}</h3>
        </div>
      </div>
    );
  }

  // The union is narrowed once, into a const, so every closure below sees a Prompt.
  const prompt: Prompt = pending;

  const { ordering, min, max } = promptBounds(prompt);
  const ready = promptReady(prompt, picked);

  function toggle(key: string): void {
    setPicked(togglePick(picked, key, { ordering, max }));
  }

  function submit(keys: string[]): void {
    onAction({ type: 'resolve', player: playerId, promptId: prompt.id, keys });
  }

  return (
    <div className={`prompt-overlay prompt-type-${prompt.type}`} data-testid="prompt" data-prompt-type={prompt.type}>
      <div className="prompt-card">
        <h3 className="prompt-title">{prompt.prompt || promptTitle(prompt.type)}</h3>
        <div className="prompt-meta">
          {ordering
            ? `Click all ${prompt.options.length} in order`
            : min === max
              ? `Pick ${min}`
              : `Pick ${min}–${max}`}
          {prompt.options.length > 0 && (
            <span className="prompt-keyhint">
              {' '}
              · press <kbd>1</kbd>–<kbd>{Math.min(prompt.options.length, 9)}</kbd> to pick,{' '}
              <kbd>Enter</kbd> to confirm
            </span>
          )}
        </div>

        <div className="prompt-options">
          {prompt.options.map((opt, slot) => (
            <OptionButton
              key={opt.key}
              option={opt}
              slot={slot}
              index={picked.indexOf(opt.key)}
              selected={picked.includes(opt.key)}
              onToggle={() => toggle(opt.key)}
            />
          ))}
          {prompt.options.length === 0 && (
            <div className="prompt-none">no options — confirm to continue</div>
          )}
        </div>

        <div className="prompt-actions">
          <button
            type="button"
            className="prompt-confirm"
            data-testid="prompt-confirm"
            disabled={prompt.options.length > 0 && !ready}
            onClick={() => submit(picked)}
          >
            Confirm
          </button>
          {min === 0 && (
            <button type="button" className="prompt-skip" data-testid="prompt-skip" onClick={() => submit([])}>
              Skip
            </button>
          )}
          {prompt.defaultKeys.length > 0 && (
            <button
              type="button"
              className="prompt-default"
              data-testid="prompt-default"
              onClick={() => submit(prompt.defaultKeys)}
            >
              Take default
            </button>
          )}
          <button type="button" className="prompt-clear" onClick={() => setPicked([])}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

function promptTitle(type: Prompt['type']): string {
  switch (type) {
    case 'discover':
      return 'Discover';
    case 'choose':
      return 'Choose one';
    case 'selectCards':
      return 'Select cards';
    case 'selectPile':
      return 'Select a pile';
    case 'selectPlayer':
      return 'Select a player';
    case 'order':
      return 'Put these in order';
    case 'auction':
      return 'Bid';
    case 'confirm':
      return 'Confirm';
    default:
      return 'Choose';
  }
}

export default PromptOverlay;
