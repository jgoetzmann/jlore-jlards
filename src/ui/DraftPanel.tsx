/**
 * The Draft's pick panel (core/draft.ts).
 *
 * The Discover pattern, on the prompt panel's own classes so every generic fix
 * to the panel applies here too: it sits over the board region, shows one of
 * your slots at a time as real card faces, and one click (or its digit) is the
 * pick. Your slots come one after another; when they are all in, the panel
 * says who the table is still waiting on.
 */

import React from 'react';
import type { DraftSlotView, DraftView, GameAction, PlayerId } from '@engine/types';
import { Card } from './Card';
import { digitIndex, digitLabel } from './keys';
import './draft.css';

/** Your next slot that needs a decision: unpicked and holding cards. */
export function nextDraftSlot(draft: DraftView): DraftSlotView | null {
  return draft.slots.find((s) => s.pick === null && s.options.length > 0) ?? null;
}

const SHOP_NAME: Record<DraftSlotView['kind'], string> = { draft: 'Draft Shop', prophet: 'Prophet Shop' };

/** "Draft Shop · slot 2 of 5 — pick one", counted over your slots that are real choices. */
export function draftSlotTitle(draft: DraftView, slot: DraftSlotView): string {
  const choices = draft.slots.filter((s) => s.kind === slot.kind && s.options.length > 1);
  const at = choices.findIndex((s) => s.index === slot.index);
  const n = at >= 0 ? at + 1 : 1;
  return `${SHOP_NAME[slot.kind]} · slot ${n} of ${Math.max(choices.length, n)} — pick one`;
}

/** "You: 3 left · Ada: 5 left", seats in the order `remaining` lists them, you first. */
export function draftProgressText(draft: DraftView, me: PlayerId, names: Record<string, string>): string {
  const ids = Object.keys(draft.remaining);
  const ordered = [me, ...ids.filter((id) => id !== me)].filter((id) => id in draft.remaining);
  return ordered
    .map((id) => `${id === me ? 'You' : (names[id] ?? id)}: ${draft.remaining[id] ?? 0} left`)
    .join(' · ');
}

/** "Waiting for Ada to finish drafting", or null when nobody else is still picking. */
export function draftWaitingText(draft: DraftView, me: PlayerId, names: Record<string, string>): string | null {
  const who = Object.keys(draft.remaining)
    .filter((id) => id !== me && (draft.remaining[id] ?? 0) > 0)
    .map((id) => names[id] ?? id);
  if (who.length === 0) return null;
  const list = who.length === 1 ? who[0]! : `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]!}`;
  return `Waiting for ${list} to finish drafting`;
}

function editableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

export function DraftPanel({
  draft,
  playerId,
  names,
  onAction,
}: {
  draft: DraftView;
  playerId: PlayerId;
  names: Record<string, string>;
  onAction: (action: GameAction) => void;
}): JSX.Element {
  const slot = nextDraftSlot(draft);

  // One pick per view from this panel, however fast the presses come. A pick
  // renders the next slot in the same place, so the second half of a
  // double-click is dropped at the button (`detail > 1`), and two presses
  // inside one frame are held here until the view has moved on.
  const sentRef = React.useRef<DraftView | null>(null);
  const pick = React.useCallback(
    (index: number) => {
      if (!slot) return;
      const option = slot.options[index];
      if (!option || sentRef.current === draft) return;
      sentRef.current = draft;
      onAction({ type: 'draftPick', player: playerId, slot: slot.index, defId: option.defId });
    },
    [draft, slot, playerId, onAction],
  );

  // Digits pick, the way they answer a Discover. Only digits: every other key
  // stays with the table's own handler.
  const pickRef = React.useRef(pick);
  pickRef.current = pick;
  const countRef = React.useRef(slot ? slot.options.length : 0);
  countRef.current = slot ? slot.options.length : 0;
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (editableTarget(e.target)) return;
      const digit = digitIndex(e.key);
      if (digit === null || digit >= countRef.current) return;
      e.preventDefault();
      pickRef.current(digit);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const progress = draftProgressText(draft, playerId, names);
  const waiting = draftWaitingText(draft, playerId, names);

  return (
    <div className="prompt-panel-host draft-panel-host">
      <div
        className="prompt-panel prompt-type-discover prompt-draft"
        data-testid="draft-panel"
        data-slot={slot ? slot.index : ''}
        data-slot-kind={slot ? slot.kind : 'done'}
      >
        <div className="prompt-card">
          <p className="draft-eyebrow">The Draft</p>
          {slot ? (
            <>
              <h3 className="prompt-title" data-testid="draft-title">
                {draftSlotTitle(draft, slot)}
              </h3>
              <div className="prompt-meta">Pick one · it joins the shop everyone buys from</div>
              <div className="prompt-options">
                {slot.options.map((face, i) => {
                  const hint = digitLabel(i);
                  return (
                    <button
                      key={`${slot.index}:${face.defId}`}
                      type="button"
                      className="prompt-option prompt-option-card"
                      style={{ ['--i']: String(i) } as React.CSSProperties}
                      data-testid="draft-option"
                      data-option-def={face.defId}
                      data-slot={slot.index}
                      aria-label={`Pick ${face.name}`}
                      onClick={(e) => {
                        if (e.detail > 1) return;
                        pick(i);
                      }}
                    >
                      {hint !== null && (
                        <span className="prompt-option-key" aria-hidden="true">
                          {hint}
                        </span>
                      )}
                      <Card card={face} />
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <h3 className="prompt-title" data-testid="draft-title">
                Your picks are in
              </h3>
              <div className="prompt-meta draft-waiting" data-testid="draft-waiting" role="status">
                {waiting ?? 'Building the shops…'}
              </div>
            </>
          )}
          <div className="draft-progress" data-testid="draft-progress">
            {progress}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DraftPanel;
