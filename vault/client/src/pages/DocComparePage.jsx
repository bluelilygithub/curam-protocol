import React, { useEffect, useRef, useState } from 'react';
import DocCompareTutorChat from './docCompare/DocCompareTutorChat';
import { CONTEXT_TYPE, GUIDE_TOOLS, OPEN_TYPE } from './docCompare/docCompareTools.mjs';

/**
 * DocCompare lives in its own app (vault/doc-compare/, Vite + React + pdf.js) and is built into dist/doc-compare-app/ by the root build. This page
 * hosts it in the Vault shell, same pattern as Route Tracer. The app reads and compares both files inside the browser and calls no API; only the
 * guide chat (outside the frame) talks to the server, and it never sees the files.
 */
const APP_URL = '/doc-compare-app/';
const KNOWN = new Set(GUIDE_TOOLS.map((t) => t.id));

export default function DocComparePage() {
  // 'checking' | 'ok' | 'missing': a failed doc-compare build must show a clear notice, not Vault's own page inside the frame
  const [state, setState] = useState('checking');
  const frameRef = useRef(null);
  const [tool, setTool] = useState('files');

  useEffect(() => {
    const onMessage = (ev) => {
      if (ev.origin !== window.location.origin || ev.source !== frameRef.current?.contentWindow) return;
      const d = ev.data;
      if (d && d.type === CONTEXT_TYPE && typeof d.tool === 'string' && KNOWN.has(d.tool)) setTool(d.tool);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const openTool = (id) => frameRef.current?.contentWindow?.postMessage({ type: OPEN_TYPE, id }, window.location.origin);

  useEffect(() => {
    let cancelled = false;
    // In production an unbuilt app falls through to Vault's own index.html (SPA catch-all), so a 200 is not proof:
    // look for the marker tag that only the app's index.html carries.
    fetch(APP_URL)
      .then(async (r) => {
        const body = r.ok ? await r.text() : '';
        if (!cancelled) setState(body.includes('name="doc-compare-app"') ? 'ok' : 'missing');
      })
      .catch(() => { if (!cancelled) setState('missing'); });
    return () => { cancelled = true; };
  }, []);

  if (state === 'missing') {
    return (
      <div className="flex flex-col flex-1 min-h-0 items-center justify-center p-6 text-center" style={{ color: 'var(--color-muted)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>DocCompare is not available in this build.</p>
        <p className="text-xs mt-2 max-w-md">
          It is built separately from the rest of Vault. Run <code>npm run build</code> (or <code>npm run dev</code> inside <code>doc-compare/</code> locally) and reload.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" style={{ height: '100%' }}>
      {state === 'ok' && (
        <iframe
          ref={frameRef}
          src={`${APP_URL}?embedded=1`}
          title="DocCompare"
          className="flex-1 w-full border-0 min-h-0"
          style={{ flex: 1, minHeight: 0, height: '100%', background: 'var(--color-bg)' }}
        />
      )}
      {state === 'ok' && <DocCompareTutorChat currentTool={tool} onOpenTool={openTool} />}
    </div>
  );
}
