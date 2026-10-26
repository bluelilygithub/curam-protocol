import React, { useEffect, useRef, useState } from 'react';

// The bar that stays at the top of a brief or draft while the page scrolls: where you are, and the things you do next, always in reach.
// It bleeds out over the page padding so scrolled text never shows beside it. Wide content scrolls sideways on a phone rather than wrapping.
export default function ActionBar({ children }) {
  return (
    <div
      className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-3 pb-2 mb-2 border-b space-y-2"
      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }} data-guide="actionbar"
    >
      {children}
    </div>
  );
}

/** The row of buttons: one line, sideways scroll if it does not fit. */
export function ActionRow({ children }) {
  return <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-0.5" style={{ scrollbarWidth: 'thin' }}>{children}</div>;
}

/** "More" with a small menu; closes on a choice or a click elsewhere. `items` = [{ label, onClick, danger? }] */
export function MoreMenu({ items, btn, btnStyle }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, right: 0 }); // the menu is placed against the window, because the button row scrolls sideways and would clip it
  useEffect(() => {
    const close = (e) => { if (ref.current && ref.current.open && !ref.current.contains(e.target)) ref.current.open = false; };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <details ref={ref} className="inline-block" onToggle={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }); }}>
      <summary className={`${btn} cursor-pointer list-none select-none`} style={btnStyle}>More ▾</summary>
      <div className="fixed z-20 min-w-[11rem] rounded-xl border p-1 shadow-lg" style={{ top: pos.top, right: pos.right, background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        {items.map((it) => (
          <button
            key={it.label} type="button" title={it.title}
            onClick={() => { if (ref.current) ref.current.open = false; it.onClick(); }}
            className="block w-full text-left px-3 py-2 rounded-lg text-sm hover:opacity-70 transition-opacity"
            style={{ color: it.danger ? '#ef4444' : 'var(--color-text)' }}
          >{it.label}</button>
        ))}
      </div>
    </details>
  );
}
