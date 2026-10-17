import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import CellarTutorChat from './cellar/CellarTutorChat';
import CellarLiteSettings from '../components/CellarLiteSettings';
import useAuthStore from '../store/authStore';

/**
 * Cellar Planner lives in its own app (vault/cellar-planner/, Vite + React 19 + Konva) and is built into
 * dist/cellar-planner-app/ by the root build. This page hosts it in the Vault shell, same pattern as the other planner pages.

 */
const APP_URL = '/cellar-planner-app/';

export default function CellarPlannerPage() {
  // Cellar Planner → Settings Tour opens the page with ?tour=1; the planner (inside the frame) then runs its own tour
  const search = new URLSearchParams(useLocation().search);
  const wantsTour = search.has('tour');
  // A CRM deal made from a website enquiry links to /cellar-planner?lead=ID; the planner (inside the frame) opens that enquiry's design.
  // Only a plain positive whole number is passed on.
  const leadParam = search.get('lead');
  const leadId = /^[1-9]\d{0,9}$/.test(leadParam || '') ? leadParam : null;
  // 'checking' | 'ok' | 'missing' — a failed cellar-planner build must show a clear notice, not Vault's own page inside the frame
  const [state, setState] = useState('checking');
  // The guide chat: the planner (inside the frame) tells us which screen the person is on, and the guide's Open buttons ask it to open one.
  // Same origin only; the ids are listed in cellar-planner/src/app/guideTools.ts.
  const isAdmin = !!useAuthStore((st) => st.user?.isAdmin);
  // admins also get the owner's Settings here (rack types, prices, features, quote wording, website help chat); it used to be a tab in Vault's Settings
  const [view, setView] = useState(search.get('view') === 'settings' ? 'settings' : 'planner');
  const settingsDirty = useRef(false);
  const onSettingsDirty = useCallback((d) => { settingsDirty.current = d; }, []);
  const showView = (v) => {
    if (v === view) return;
    if (view === 'settings' && settingsDirty.current && !window.confirm('You have unsaved Cellar Planner settings. Leave without saving?')) return;
    settingsDirty.current = false;
    setView(v);
  };
  const frameRef = useRef(null);
  const [tool, setTool] = useState('plan');
  useEffect(() => {
    const onMessage = (ev) => {
      if (ev.origin !== window.location.origin || ev.source !== frameRef.current?.contentWindow) return;
      const d = ev.data;
      if (d && d.type === 'cellar-planner:context' && typeof d.tool === 'string') setTool(d.tool.slice(0, 40));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const openTool = (id) => frameRef.current?.contentWindow?.postMessage({ type: 'cellar-planner:open', id }, window.location.origin);

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

  const missing = state === 'missing' && (
    <div className="flex flex-col flex-1 min-h-0 items-center justify-center p-6 text-center" style={{ color: 'var(--color-muted)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Cellar Planner is not available in this build.</p>
        <p className="text-xs mt-2 max-w-md">
          It is built separately from the rest of Vault. Run <code>npm run build</code> (or <code>npm run dev</code> inside <code>cellar-planner/</code> locally) and reload.
        </p>
      </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0" style={{ height: '100%' }}>
      {isAdmin && (
        <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} role="tablist" aria-label="Cellar Planner">
          {[['planner', 'Planner'], ['settings', 'Settings']].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={view === id}
              onClick={() => showView(id)}
              className="text-sm px-3 py-1 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: view === id ? 'var(--color-primary)' : 'var(--color-border)', color: view === id ? 'var(--color-primary)' : 'var(--color-muted)', background: 'transparent', transitionDuration: '200ms' }}
              data-testid={`cellar-view-${id}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {isAdmin && view === 'settings' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6" data-testid="cellar-settings-view">
          <div className="max-w-4xl mx-auto">
            <CellarLiteSettings onDirtyChange={onSettingsDirty} />
          </div>
        </div>
      )}
      {missing && !(isAdmin && view === 'settings') && missing}
      {state === 'ok' && (
        <iframe
          ref={frameRef}
          src={`${APP_URL}?embedded=1${wantsTour ? '&tour=1' : ''}${leadId ? `&lead=${leadId}` : ''}`}
          title="Cellar Planner"
          allow="fullscreen"
          allowFullScreen
          className="flex-1 w-full border-0 min-h-0"
          style={{ flex: 1, minHeight: 0, height: '100%', background: 'var(--color-bg)', display: view === 'settings' && isAdmin ? 'none' : undefined }}
        />
      )}
      {state === 'ok' && !(isAdmin && view === 'settings') && <CellarTutorChat currentTool={tool} onOpenTool={openTool} />}
    </div>
  );
}
