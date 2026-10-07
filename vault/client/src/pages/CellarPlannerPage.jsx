import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Cellar Planner lives in its own app (vault/cellar-planner/, Vite + React 19 + Konva) and is built into
 * dist/cellar-planner-app/ by the root build. This page hosts it in the Vault shell, same pattern as ThemeBuilderPage.

 */
const APP_URL = '/cellar-planner-app/';

export default function CellarPlannerPage() {
  // Settings → Cellar Planner Tour opens the page with ?tour=1; the planner (inside the frame) then runs its own tour
  const wantsTour = new URLSearchParams(useLocation().search).has('tour');
  // 'checking' | 'ok' | 'missing' — a failed cellar-planner build must show a clear notice, not Vault's own page inside the frame
  const [state, setState] = useState('checking');

  useEffect(() => {
    let cancelled = false;
    // In production an unbuilt app falls through to Vault's own index.html (SPA catch-all), so a 200 is not proof:
    // look for the marker tag that only the planner's index.html carries.
    fetch(APP_URL)
      .then(async (r) => {
        const body = r.ok ? await r.text() : '';
        if (!cancelled) setState(body.includes('name="cellar-planner-app"') ? 'ok' : 'missing');
      })
      .catch(() => { if (!cancelled) setState('missing'); });
    return () => { cancelled = true; };
  }, []);

  if (state === 'missing') {
    return (
      <div className="flex flex-col flex-1 min-h-0 items-center justify-center p-6 text-center" style={{ color: 'var(--color-muted)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Cellar Planner is not available in this build.</p>
        <p className="text-xs mt-2 max-w-md">
          It is built separately from the rest of Vault. Run <code>npm run build</code> (or <code>npm run dev</code> inside <code>cellar-planner/</code> locally) and reload.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" style={{ height: '100%' }}>
      {state === 'ok' && (
        <iframe
          src={`${APP_URL}?embedded=1${wantsTour ? '&tour=1' : ''}`}
          title="Cellar Planner"
          allow="fullscreen"
          allowFullScreen
          className="flex-1 w-full border-0 min-h-0"
          style={{ flex: 1, minHeight: 0, height: '100%', background: 'var(--color-bg)' }}
        />
      )}
    </div>
  );
}
