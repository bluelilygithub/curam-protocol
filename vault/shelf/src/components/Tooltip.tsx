import { cloneElement, useCallback, useRef, useState, type ReactElement, type Ref } from 'react';
import { createPortal } from 'react-dom';

// The shelf's version of Vault's Tooltip (client/src/components/Tooltip.jsx): a themed card in place of the browser's plain `title`, 200 ms fade, shown on
// hover and on keyboard focus, always kept inside the window. It clones its one child (no wrapper element, so layout is untouched) and is drawn in a
// portal on the page body. Keep the wording in lib/tips.ts, not at the call site.
const EDGE = 8;
const maxWidthFor = (text: string) => (text.length > 110 ? 320 : 240);

interface Pos { top: number; left: number; above: boolean }

type Child = ReactElement<{ ref?: Ref<HTMLElement>; onMouseEnter?: (e: React.MouseEvent) => void; onMouseLeave?: (e: React.MouseEvent) => void; onFocus?: (e: React.FocusEvent) => void; onBlur?: (e: React.FocusEvent) => void }>;

export default function Tooltip({ text, children, side = 'top' }: { text: string | undefined; children: Child; side?: 'top' | 'bottom' }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const node = useRef<HTMLElement | null>(null);

  const place = useCallback(() => {
    const el = node.current;
    if (!el || !text) return;
    const r = el.getBoundingClientRect();
    const boxW = Math.min(maxWidthFor(text), window.innerWidth - EDGE * 2);
    let top = side === 'bottom' ? r.bottom + 8 : r.top - 8;
    let above = side !== 'bottom';
    if (above && top < 40) { top = r.bottom + 8; above = false; }
    const left = Math.min(Math.max(r.left + r.width / 2, EDGE + boxW / 2), window.innerWidth - EDGE - boxW / 2);
    setPos({ top, left, above });
  }, [side, text]);

  if (!text) return children;

  const props = children.props;
  const child = cloneElement(children, {
    ref: (el: HTMLElement | null) => {
      node.current = el;
      const inner = props.ref;
      if (typeof inner === 'function') inner(el); else if (inner && typeof inner === 'object') (inner as { current: HTMLElement | null }).current = el;
    },
    onMouseEnter: (e: React.MouseEvent) => { place(); setShow(true); props.onMouseEnter?.(e); },
    onMouseLeave: (e: React.MouseEvent) => { setShow(false); props.onMouseLeave?.(e); },
    onFocus: (e: React.FocusEvent) => { place(); setShow(true); props.onFocus?.(e); },
    onBlur: (e: React.FocusEvent) => { setShow(false); props.onBlur?.(e); },
  });

  return (
    <>
      {child}
      {show && pos && createPortal(
        <span
          role="tooltip"
          data-shelf-tooltip=""
          className="fixed pointer-events-none px-2.5 py-1.5 rounded-lg text-[11px] leading-snug shadow-lg border border-shelf-line bg-shelf-card text-shelf-text"
          style={{ top: pos.top, left: pos.left, transform: `translate(-50%, ${pos.above ? '-100%' : '0'})`, width: 'max-content', maxWidth: `min(${maxWidthFor(text)}px, calc(100vw - ${EDGE * 2}px))`, zIndex: 60 }}
        >
          {text}
        </span>,
        document.body,
      )}
    </>
  );
}
