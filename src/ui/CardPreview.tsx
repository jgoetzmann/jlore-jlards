/**
 * The one hover-preview layer (LAY-6). See `preview.ts` for why it is shaped
 * this way. `pointer-events: none` is load-bearing: `document.elementFromPoint`
 * and real clicks both go straight through it.
 */

import React from 'react';
import { Card } from './Card';
import { getPreview, getServerPreview, subscribePreview } from './preview';

export function CardPreview(): JSX.Element | null {
  const state = React.useSyncExternalStore(subscribePreview, getPreview, getServerPreview);
  if (!state) return null;
  const style: React.CSSProperties = {
    ...(state.side === 'left' ? { left: 12 } : { right: 12 }),
    top: state.top,
    maxHeight: `calc(100dvh - ${Math.round(state.top) + 12}px)`,
  };
  return (
    <div className={`card-preview card-preview-${state.side}`} aria-hidden="true" style={style}>
      <Card card={state.card} variant="preview" testId="card-preview" />
    </div>
  );
}

export default CardPreview;
