/**
 * The one hover-preview layer (LAY-6). See `preview.ts` for why it is shaped
 * this way. `pointer-events: none` is load-bearing: `document.elementFromPoint`
 * and real clicks both go straight through it.
 *
 * It is also where the table's touch affordances mount, since both are
 * overlays with no layout of their own: the preview **sheet** a long-press or a
 * tap opens (touch.ts), and the tap-to-read bubble for `title` tooltips
 * (TapTip.tsx).
 */

import React from 'react';
import type { CardView } from '@engine/types';
import { Card } from './Card';
import { closePreviewSheet, getPreview, getServerPreview, subscribePreview } from './preview';
import { TapTip } from './TapTip';
import { followMention } from './touch';

/**
 * The whole card as a dismissable dialog. Pure, so the unit suite can render
 * it. The backdrop closes only on a tap that also *started* on the backdrop:
 * the long press that opened the sheet lifts over it, and that lift must not
 * close it again.
 */
export function PreviewSheet({ card, onClose }: { card: CardView; onClose: () => void }): JSX.Element {
  const downOnBackdrop = React.useRef(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="card-preview-sheet"
      data-testid="card-preview-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={card.name}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div className="card-preview-sheet-body">
        <Card card={card} variant="preview" testId="card-preview" onMention={(defId) => followMention(card, defId)} />
        <button
          type="button"
          ref={closeRef}
          className="card-preview-close"
          data-testid="card-preview-close"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}

export function CardPreview(): JSX.Element {
  const state = React.useSyncExternalStore(subscribePreview, getPreview, getServerPreview);
  let layer: JSX.Element | null = null;
  if (state && state.mode === 'sheet') {
    layer = <PreviewSheet card={state.card} onClose={closePreviewSheet} />;
  } else if (state) {
    const style: React.CSSProperties = {
      ...(state.side === 'left' ? { left: 12 } : { right: 12 }),
      top: state.top,
      maxHeight: `calc(100dvh - ${Math.round(state.top) + 12}px)`,
    };
    layer = (
      // `card-preview-layer`, not `card-preview`: the inner Card's `preview`
      // variant already carries `card-preview`, and sharing the class made the
      // face itself `position: fixed`.
      <div className={`card-preview-layer card-preview-${state.side}`} aria-hidden="true" style={style}>
        <Card card={state.card} variant="preview" testId="card-preview" />
      </div>
    );
  }
  return (
    <>
      {layer}
      <TapTip />
    </>
  );
}

export default CardPreview;
