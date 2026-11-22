import React, { useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Skeleton from '../../components/Skeleton';
import Tooltip from '../../components/Tooltip';
import {
  BTN_SECONDARY, CARD_STYLE, SECONDARY_STYLE, readJson, usePresentations,
} from './shared';

const DEBOUNCE_MS = 600; // wait until typing pauses, so the preview is not rebuilt on the server for every key

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
  const lastReload = useRef(0);
  const key = JSON.stringify(deck || {});

  useEffect(() => {
    if (!deck?.slides?.length) { setHtml(''); return undefined; }
    let live = true;
    const now = reload !== lastReload.current; // Refresh pressed: rebuild at once; an edit waits for typing to pause
    lastReload.current = reload;
    const timer = setTimeout(() => {
      setBusy(true);
      setError('');
      api.post('/api/presentations/preview', { deck, applyBrand })
        .then((res) => readJson(res, 'Could not build the preview.'))
        .then((data) => { if (live) setHtml(data.html || ''); })
        .catch((err) => { if (live) setError(err.message || 'Could not build the preview.'); })
        .finally(() => { if (live) setBusy(false); });
    }, now || !html ? 0 : DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
    // `key` changes only when the deck actually changes.
  }, [key, applyBrand, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!deck?.slides?.length) return null;
  const ratio = deck.aspect === '1:1' ? '1 / 1' : deck.aspect === '4:3' ? '4 / 3' : '16 / 9';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{busy ? 'Updating preview…' : 'Preview'}</span>
        <Tooltip text="Rebuild the preview from the current deck now. It also rebuilds by itself a moment after you stop typing.">
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            disabled={busy}
            className={BTN_SECONDARY}
            style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}
          >
            {getIcon('refresh-cw', { size: 12 })} Refresh
          </button>
        </Tooltip>
      </div>
      {error && <p className="text-xs" style={{ color: '#991b1b' }}>{error}</p>}
      <div
        className="relative w-full rounded-xl border overflow-hidden"
        style={{ ...CARD_STYLE, aspectRatio: compact ? undefined : ratio, height: compact ? 280 : undefined }}
      >
        {html ? (
          <iframe title="Deck preview" srcDoc={html} sandbox="allow-same-origin" className="w-full h-full border-0" />
        ) : (
          <Skeleton className="h-full w-full" label="Building the preview" />
        )}
      </div>
    </div>
  );
}
