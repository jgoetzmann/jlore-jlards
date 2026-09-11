/**
 * Renders `view.pending` (LAY-4, MOT-11).
 *
 *   - Somebody else's decision: a small, non-blocking chip for the topbar
 *     (`prompt-waiting`). It never covers anything. In hotseat it reads "Pass to
 *     <name>" and carries a button that switches the screen to that seat.
 *   - Your own prompt, placed by `promptPlacement`:
 *       `hand`  — a slim bar in the dock; the hand cards themselves toggle.
 *       `board` — the same bar; the matching piles light up and toggle.
 *       `panel` — a panel over the board region only (never the hand or the
 *                 topbar) with real card faces for card options.
 *
 * Every placement answers with `{type:'resolve', promptId, keys}` and keeps the
 * `prompt`, `prompt-option`, `prompt-confirm`, `prompt-skip` and
 * `prompt-default` test ids.
 */

import React from 'react';
import type { GameAction, GameView, InstanceId, PlayerId, Prompt, PromptOption } from '@engine/types';
import { Card } from './Card';
import { printedCardView } from './cardview';
import { digitLabel } from './keys';
import { submitsOnPick } from './turnflow';
import {
  isPrompt,
  isWaiting,
  promptBounds,
  promptReady,
  togglePick,
  type PromptPlacement,
} from './prompt';

// Kept re-exported so existing importers of this module still find them.
export { promptBounds, promptReady, togglePick, ORDERING_TYPES } from './prompt';
export type { PromptBounds } from './prompt';

export interface PromptOverlayProps {
  pending: GameView['pending'];
  playerId: PlayerId;
  names: Record<string, string>;
  onAction: (action: GameAction) => void;
  /** Controlled selection, shared with the hand and board toggles. */
  picked?: readonly string[];
  onPickedChange?: (next: string[]) => void;
  /** Where your own prompt is being drawn. Defaults to `panel`. */
  placement?: PromptPlacement;
  /** Hotseat only: switch the screen to the seat that has to answer. */
  onPass?: (() => void) | null;
  /** Your hand's order, so a hand option can say which slot it is. */
  handOrder?: readonly InstanceId[];
}

function OptionButton({
  option,
  selected,
  index,
  slot,
  faces,
  handSlot,
  keyHint,
  onToggle,
}: {
  option: PromptOption;
  selected: boolean;
  /** Position in the picked list, for ordering prompts. */
  index: number;
  /** Position in the option list, for the staggered entrance. */
  slot: number;
  /** Render card options as card faces (the panel) rather than chips (the bar). */
  faces: boolean;
  /** 1-based hand position for a hand option, so two Coppers can be told apart. */
  handSlot: number | null;
  /** The digit that picks this option from the keyboard. */
  keyHint: string | null;
  onToggle: () => void;
}): JSX.Element {
  const face = faces && option.defId ? printedCardView(option.defId, option.key) : null;
  const classes = ['prompt-option'];
  if (selected) classes.push('prompt-option-selected');
  if (face) classes.push('prompt-option-card');
  return (
    <button
      type="button"
      className={classes.join(' ')}
      style={{ ['--i']: String(slot) } as React.CSSProperties}
      data-testid="prompt-option"
      data-option-key={option.key}
      data-option-def={option.defId}
      aria-pressed={selected}
      onClick={onToggle}
    >
      {selected && <span className="prompt-order-index">{index + 1}</span>}
      {keyHint !== null && !selected && (
        <span className="prompt-option-key" aria-hidden="true">
          {keyHint}
        </span>
      )}
      {face ? (
        <>
          <Card card={face} selected={selected} />
          {option.label && option.label !== face.name && (
            <span className="prompt-option-label">{option.label}</span>
          )}
        </>
      ) : (
        <>
          <span className="prompt-option-label">{option.label}</span>
          {handSlot !== null && <span className="prompt-option-slot">#{handSlot}</span>}
        </>
      )}
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
  placement = 'panel',
  onPass = null,
  handOrder,
}: PromptOverlayProps): JSX.Element | null {
  const promptId = isPrompt(pending) ? pending.id : null;
  const [own, setOwn] = React.useState<{ id: string | null; keys: string[] }>({ id: null, keys: [] });
  const controlled = controlledPicked !== undefined;
  const picked: readonly string[] = controlled ? controlledPicked : own.id === promptId ? own.keys : [];

  function setPicked(next: string[]): void {
    if (onPickedChange) onPickedChange(next);
    if (!controlled) setOwn({ id: promptId, keys: next });
  }

  if (pending === null || pending === undefined) return null;

  const waitingOn = isWaiting(pending)
    ? pending.waitingOn
    : isPrompt(pending) && pending.player !== playerId
      ? pending.player
      : null;

  if (waitingOn !== null) {
    const who = names[waitingOn] ?? waitingOn;
    return (
      <div
        className={`prompt-waiting${onPass ? ' prompt-pass' : ''}`}
        data-testid="prompt-waiting"
        role="status"
      >
        <span className="prompt-waiting-dot" aria-hidden="true" />
        {onPass ? (
          <>
            <span>
              Pass to <strong>{who}</strong>
            </span>
            <button type="button" className="prompt-pass-btn" data-testid="prompt-pass" onClick={onPass}>
              Show {who}
            </button>
          </>
        ) : (
          <span>
            Waiting on <strong>{who}</strong>
          </span>
        )}
      </div>
    );
  }

  if (!isPrompt(pending)) return null;

  // The union is narrowed once, into a const, so every closure below sees a Prompt.
  const prompt: Prompt = pending;
  const bounds = promptBounds(prompt);
  const { ordering, min, max } = bounds;
  const ready = promptReady(prompt, picked);

  function submit(keys: readonly string[]): void {
    onAction({ type: 'resolve', player: playerId, promptId: prompt.id, keys: [...keys] });
  }

  // TURN-7: a one-of-N Discover or choose is answered by the click itself.
  // Multi-selects, orderings and card selections (a trash, a discard) keep
  // Confirm, because a misclick there costs a card.
  const oneClick = submitsOnPick(prompt);

  function toggle(key: string): void {
    if (oneClick) {
      submit([key]);
      return;
    }
    setPicked(togglePick(picked, key, { ordering, max }));
  }

  const meta = oneClick
    ? 'Click one to choose'
    : ordering
      ? `Click all ${prompt.options.length} in order`
      : min === max
        ? `Pick ${min}`
        : `Pick ${min}–${max}`;

  const faces = placement === 'panel';
  const handIndex = new Map<string, number>();
  (handOrder ?? []).forEach((iid, i) => handIndex.set(iid, i + 1));

  const options = prompt.options.map((opt, i) => (
    <OptionButton
      key={opt.key}
      option={opt}
      slot={i}
      index={picked.indexOf(opt.key)}
      selected={picked.includes(opt.key)}
      faces={faces}
      handSlot={placement === 'hand' && opt.iid ? (handIndex.get(opt.iid) ?? null) : null}
      keyHint={digitLabel(i)}
      onToggle={() => toggle(opt.key)}
    />
  ));

  const actions = (
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
      {picked.length > 0 && (
        <button type="button" className="prompt-clear" onClick={() => setPicked([])}>
          Clear
        </button>
      )}
    </div>
  );

  const title = prompt.prompt || promptTitle(prompt.type);

  if (placement !== 'panel') {
    return (
      <div
        className={`prompt-bar prompt-bar-${placement}`}
        data-testid="prompt"
        data-prompt-type={prompt.type}
        data-placement={placement}
      >
        <span className="prompt-title" title={title}>
          {title}
        </span>
        <span className="prompt-meta">
          {meta}
          {placement === 'hand' ? ' · click cards in your hand' : ' · click the lit piles'}
        </span>
        <div className="prompt-options">
          {options}
          {prompt.options.length === 0 && <span className="prompt-none">no options</span>}
        </div>
        {actions}
      </div>
    );
  }

  return (
    <div
      className={`prompt-panel prompt-type-${prompt.type}`}
      data-testid="prompt"
      data-prompt-type={prompt.type}
      data-placement="panel"
      data-one-click={oneClick ? 'true' : 'false'}
    >
      <div className="prompt-card">
        <h3 className="prompt-title">{title}</h3>
        <div className="prompt-meta">{meta}</div>
        <div className="prompt-options">
          {options}
          {prompt.options.length === 0 && (
            <div className="prompt-none">no options — confirm to continue</div>
          )}
        </div>
        {actions}
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
