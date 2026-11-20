import { useEffect, useRef, useState } from 'react';
import { diffCanvases, renderPage, VIEW_SCALE, type LayoutPage, type PdfPair } from '../compare/layout';

/** Side-by-side page pairs with a pixel-diff overlay on the edited page. */
export function PageViewer({ pair, pages, start, threshold, onClose }: { pair: PdfPair; pages: LayoutPage[]; start: number; threshold: number; onClose: () => void }) {
  const [i, setI] = useState(() => Math.max(0, pages.findIndex((p) => p.a === start || p.b === start)));
  const [overlay, setOverlay] = useState(true);
  const [changedOnly, setChangedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const cur = pages[i];

  useEffect(() => { dialog.current?.focus(); }, []);

  useEffect(() => {
    if (!cur) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [ca, cb] = await Promise.all([cur.a ? renderPage(pair.a, cur.a, VIEW_SCALE) : undefined, cur.b ? renderPage(pair.b, cur.b, VIEW_SCALE) : undefined]);
      if (cancelled) return;
      left.current?.replaceChildren(...(ca ? [ca] : []));
      right.current?.replaceChildren(...(cb ? [cb] : []));
      if (ca && cb && overlay) {
        const { diff } = diffCanvases(ca, cb, true);
        diff.className = 'overlay';
        right.current?.appendChild(diff);
      }
      setLoading(false);
    })().catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [cur, overlay, pair]);

  const step = (d: 1 | -1) => {
    for (let j = i + d; j >= 0 && j < pages.length; j += d) {
      if (!changedOnly || pages[j].ratio > threshold) { setI(j); return; }
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal viewer" role="dialog" aria-modal="true" aria-label="Page viewer" tabIndex={-1} ref={dialog} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); }}>
        <div className="viewer-bar">
          <button className="btn" onClick={() => step(-1)} aria-label="Previous page" title="Previous page (or the left arrow key).">◀</button>
          <span>
            Original p.{cur?.a ?? '—'} · Edited p.{cur?.b ?? '—'}
            {cur && cur.a && cur.b ? ` · ${(cur.ratio * 100).toFixed(1)}% changed` : cur ? ' · page only in one file' : ''}
            {cur && cur.ratio > threshold ? ' ⚑' : ''}
          </span>
          <button className="btn" onClick={() => step(1)} aria-label="Next page" title="Next page (or the right arrow key).">▶</button>
          <label className="inline" title="Show the changed pixels in red over the edited page."><input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> Diff overlay</label>
          <label className="inline" title="Skip pages that did not change when moving with the arrows."><input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} /> Changed pages only</label>
          {loading && <span className="spinner" role="status" aria-label="Rendering" />}
          <button className="btn ghost close" onClick={onClose} aria-label="Close page viewer" title="Close the page viewer (Esc).">✕</button>
        </div>
        <div className="viewer-pages">
          <figure><figcaption>Original</figcaption><div className="page" ref={left} /></figure>
          <figure><figcaption>Edited{overlay ? ' (changes in red)' : ''}</figcaption><div className="page" ref={right} /></figure>
        </div>
      </div>
    </div>
  );
}
