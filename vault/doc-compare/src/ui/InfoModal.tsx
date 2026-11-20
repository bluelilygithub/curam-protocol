import { useEffect, useRef } from 'react';
import { HOW_IT_WORKS } from '@vault-client/pages/docCompare/docCompareTools.mjs';

export const INFO_KEY = 'doc-compare:info-seen';

/** The (i) "How DocCompare works" box. Opens by itself on the first visit (per browser) and from the (i) button; the text is shared with the guide. */
export function InfoModal({ onClose }: { onClose: () => void }) {
  const gotIt = useRef<HTMLButtonElement>(null);
  const close = () => {
    try { localStorage.setItem(INFO_KEY, '1'); } catch { /* it simply opens again next visit */ }
    onClose();
  };
  // focus goes into the box, Esc closes it, focus goes back to where it was
  useEffect(() => {
    const before = document.activeElement;
    gotIt.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); if (before instanceof HTMLElement) before.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-backdrop center" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal info" role="dialog" aria-modal="true" aria-labelledby="info-title" data-testid="info-modal">
        <div className="drawer-head">
          <h2 id="info-title">How DocCompare works</h2>
          <button className="btn ghost" onClick={close} aria-label="Close" title="Close this guide. The (i) button opens it again.">✕</button>
        </div>
        <div className="info-body" tabIndex={0} role="region" aria-label="Guide text">
          {HOW_IT_WORKS.map(([h, p]) => (
            <section key={h}><h3>{h}</h3><p>{p}</p></section>
          ))}
          <p className="muted">Hover any button or box for a short explanation. The round guide button at the bottom right (in Vault) answers questions about this page.</p>
        </div>
        <div className="row end"><button ref={gotIt} className="btn primary" onClick={close} title="Close the guide. You can open it again with the (i) button.">Got it</button></div>
      </div>
    </div>
  );
}

export function infoSeen(): boolean {
  try { return !!localStorage.getItem(INFO_KEY); } catch { return true; } // no storage: don't pop up on every load
}
