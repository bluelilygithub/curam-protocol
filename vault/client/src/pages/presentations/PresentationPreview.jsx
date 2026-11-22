import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { CARD_STYLE, readJson, usePresentations } from './shared';

/**
 * Renders the canonical deck as HTML from POST /api/presentations/preview in an iframe. The server uses the same
 * renderer for PDF and PNG export, so what is seen here is what is downloaded. No scripts are needed in the iframe.
 */
export default function PresentationPreview({ deck, compact = false }) {
  const { applyBrand } = usePresentations();
  const getIcon = useIcon();
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const key = JSON.stringify(deck || {});

  useEffect(() => {
    if (!deck?.slides?.length) { setHtml(''); return undefined; }
    let live = true;
    setBusy(true);
    setError('');
    api.post('/api/presentations/preview', { deck, applyBrand })
      .then((res) => readJson(res, 'Could not build the preview.'))
      .then((data) => { if (live) setHtml(data.html || ''); })
      .catch((err) => { if (live) setError(err.message || 'Could not build the preview.'); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
    // `key` changes only when the deck actually changes.
  }, [key, applyBrand, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!deck?.slides?.length) return null;
  const ratio = deck.aspect === '1:1' ? '1 / 1' : deck.aspect === '4:3' ? '4 / 3' : '16 / 9';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Preview</span>
        <Tooltip text="Rebuild the preview from the current deck.">
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border hover:opacity-70 disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
          >
            {getIcon('refresh-cw', { size: 12 })} Refresh
          </button>
        </Tooltip>
      </div>
      {error && <p className="text-xs" style={{ color: '#991b1b' }}>{error}</p>}
      <div
        className="w-full rounded-xl border overflow-hidden"
        style={{ ...CARD_STYLE, aspectRatio: compact ? undefined : ratio, minHeight: compact ? 220 : undefined, height: compact ? 260 : undefined }}
      >
        <iframe
          title="Deck preview"
          srcDoc={html || '<p style="font-family:system-ui;padding:2rem;color:#888">Building preview…</p>'}
          sandbox="allow-same-origin"
          className="w-full h-full border-0"
        />
      </div>
    </div>
  );
}
