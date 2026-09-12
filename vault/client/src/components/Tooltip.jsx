import { useState, useRef, useCallback, cloneElement } from 'react';
import { createPortal } from 'react-dom';

// Lightweight hover-popover tooltip. Replaces native `title=` attributes with
// a themed floating card (200ms fade, matches app hover/transition conventions).
// Clones the single child and attaches hover/focus handlers + a ref directly
// to it (no wrapper DOM node), so it never affects layout/width/flex of the
// control it decorates. The popover itself is portaled to <body> and
// position:fixed, so it escapes any overflow/stacking context of its parent.
//
// z-index: 30 — above dropdowns (z-20) but below modals (z-50) and
// ProcessingModal (z-[9998]); a tooltip should never need to outrank a modal.
//
// Usage: <Tooltip text="...">{children}</Tooltip> — wraps a single element
// that accepts a ref (DOM elements only — input/button/select/div/etc).
// Hover-only by design; simply doesn't show on touch (no tap variant).
export default function Tooltip({ text, children, side = 'top' }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let top = side === 'bottom' ? r.bottom + 8 : r.top - 8;
    let above = side !== 'bottom';
    if (above && top < 40) { top = r.bottom + 8; above = false; }
    let left = r.left + r.width / 2;
    left = Math.min(Math.max(left, 80), window.innerWidth - 80);
    setPos({ top, left, above });
  }, [side]);

  if (!text) return children;

  const child = cloneElement(children, {
    ref: (node) => {
      ref.current = node;
      const { ref: childRef } = children;
      if (typeof childRef === 'function') childRef(node);
      else if (childRef && typeof childRef === 'object') childRef.current = node;
    },
    onMouseEnter: (e) => { place(); setShow(true); children.props.onMouseEnter?.(e); },
    onMouseLeave: (e) => { setShow(false); children.props.onMouseLeave?.(e); },
    onFocus: (e) => { place(); setShow(true); children.props.onFocus?.(e); },
    onBlur: (e) => { setShow(false); children.props.onBlur?.(e); },
  });

  return (
    <>
      {child}
      {show && pos && createPortal(
        <span
          role="tooltip"
          className="fixed pointer-events-none px-2.5 py-1.5 rounded-lg text-[11px] leading-snug shadow-lg border transition-opacity duration-200"
          style={{
            top: pos.top,
            left: pos.left,
            transform: `translate(-50%, ${pos.above ? '-100%' : '0'})`,
            maxWidth: 240,
            zIndex: 30,
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text)',
            opacity: 1,
          }}
        >
          {text}
        </span>,
        document.body
      )}
    </>
  );
}
