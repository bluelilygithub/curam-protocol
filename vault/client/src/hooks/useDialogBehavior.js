import { useEffect, useRef } from 'react';
import { FOCUSABLE_SELECTOR, nextFocusIndex, createDialogStack } from '../utils/dialogFocus.mjs';

// What every dialog should do, whatever its look: move focus in when it opens (unless something inside already took it, such as an
// autoFocus input), keep Tab inside it, close on Escape (only the newest open dialog), stop the page behind from scrolling, and give focus
// back to whatever opened it. Put the returned ref on the dialog panel together with role="dialog" aria-modal="true" and a name
// (aria-labelledby or aria-label). `components/Dialog.jsx` does all of that for you; use this hook to upgrade a hand-built modal.

const stack = createDialogStack();
let scrollLocks = 0;
let savedOverflow = '';
let nextId = 0;

const tabbable = (panel) =>
  Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => el.getClientRects().length > 0);

// `active`: pass false while a modal that is always mounted is closed (so the effect runs again when it opens).
export default function useDialogBehavior({ onClose, closeOnEscape = true, active = true } = {}) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Remember what had focus before the dialog appeared. Read while rendering, because an autoFocus input inside the dialog takes focus
  // as soon as it is added, before any effect runs.
  const openerRef = useRef(null);
  if (!active) openerRef.current = null;
  else if (!openerRef.current && typeof document !== 'undefined') openerRef.current = document.activeElement;

  useEffect(() => {
    const panel = panelRef.current;
    if (!active || !panel) return undefined;
    const id = ++nextId;
    const opener = openerRef.current;
    stack.push(id);

    if (scrollLocks++ === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    if (!panel.contains(document.activeElement)) {
      const first = tabbable(panel)[0];
      if (first) first.focus();
      else { panel.setAttribute('tabindex', '-1'); panel.focus(); }
    }

    const onKeyDown = (e) => {
      if (!stack.isTop(id)) return;
      if (e.key === 'Escape' && closeOnEscape && closeRef.current) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const list = tabbable(panel);
        if (list.length === 0) { e.preventDefault(); return; }
        const target = nextFocusIndex(list.length, list.indexOf(document.activeElement), e.shiftKey);
        if (target !== null) { e.preventDefault(); list[target].focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      stack.remove(id);
      if (--scrollLocks === 0) document.body.style.overflow = savedOverflow;
      try { if (opener && opener.isConnected) opener.focus(); } catch (_) { /* opener is gone */ }
    };
  }, [closeOnEscape, active]);

  return panelRef;
}
