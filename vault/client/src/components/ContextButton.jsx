import React from 'react';
import Tooltip from './Tooltip';

/**
 * A button that knows when it cannot be used. With a `reason` it is dimmed, does nothing when pressed, and its tooltip says what to do
 * first; without one it is an ordinary button with `tip` as its tooltip. (A real `disabled` button gets no mouse events, so its reason
 * could never be shown. This uses aria-disabled instead, which screen readers announce the same way.)
 *
 *   <ContextButton reason={reasons.undo} tip="Take back your last change." className="…" style={…} onClick={…}>Undo</ContextButton>
 *
 * Everything else passes straight to the <button>.
 */
export default function ContextButton({ reason, tip, onClick, className = '', style, children, ...rest }) {
  const blocked = !!reason;
  return (
    <Tooltip text={blocked ? reason : tip}>
      <button
        type="button"
        {...rest}
        aria-disabled={blocked || undefined}
        onClick={blocked ? (e) => e.preventDefault() : onClick}
        className={`${className}${blocked ? ' cursor-not-allowed' : ''}`}
        style={{ ...style, ...(blocked ? { opacity: 0.5 } : null) }}
      >
        {children}
      </button>
    </Tooltip>
  );
}
