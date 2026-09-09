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

export interface PromptOverlayProps {
  pending: GameView['pending'];
  playerId: PlayerId;
  names: Record<string, string>;
  onAction: (action: GameAction) => void;
}

function isWaiting(p: GameView['pending']): p is { waitingOn: PlayerId } {
  return p !== null && typeof p === 'object' && 'waitingOn' in p;
}

function isPrompt(p: GameView['pending']): p is Prompt {
  return p !== null && typeof p === 'object' && 'id' in p && 'options' in p;
}

const ORDERING_TYPES = new Set<Prompt['type']>(['order']);

function OptionButton({
  option,
  selected,
  index,
  onToggle,
}: {
  option: PromptOption;
  selected: boolean;
  index: number;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`prompt-option${selected ? ' prompt-option-selected' : ''}`}
      data-testid="prompt-option"
      data-option-key={option.key}
      onClick={onToggle}
    >
      {selected && <span className="prompt-order-index">{index + 1}</span>}
      <span className="prompt-option-label">{option.label}</span>
      {option.defId && <span className="prompt-option-def">{option.defId}</span>}
      {option.pileId && <span className="prompt-option-pile">pile {option.pileId}</span>}
    </button>
  );
}

export function PromptOverlay({
  pending,
  playerId,
  names,
  onAction,
}: PromptOverlayProps): JSX.Element | null {
  const promptId = isPrompt(pending) ? pending.id : null;
  const [picked, setPicked] = React.useState<string[]>([]);

  React.useEffect(() => {
    setPicked([]);
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

  const ordering = ORDERING_TYPES.has(prompt.type);
  const min = typeof prompt.min === 'number' ? prompt.min : 1;
  const max = typeof prompt.max === 'number' ? prompt.max : Math.max(min, 1);
  const required = ordering ? prompt.options.length : min;
  const ready = picked.length >= required && picked.length <= Math.max(max, required);

  function toggle(key: string): void {
    setPicked((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (!ordering && prev.length >= max && max > 0) {
        // Single-pick prompts swap rather than refusing the click.
        if (max === 1) return [key];
        return prev;
      }
      return [...prev, key];
    });
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
        </div>

        <div className="prompt-options">
          {prompt.options.map((opt) => (
            <OptionButton
              key={opt.key}
              option={opt}
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
