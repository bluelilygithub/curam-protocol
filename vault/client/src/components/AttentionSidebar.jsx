import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';

const DOT = { high: '#ef4444', normal: '#f59e0b', low: 'var(--color-muted)' };

/**
 * The Home page sidebar: what needs attention in Tasks, Notes, Plans, Invoices, Tickets and Emails, one box each (GET /api/attention/summary,
 * built by services/attention.js). An app this person cannot use has no box; an area with nothing waiting says so. Refreshes when the tab
 * comes back into view and every five minutes.
 */
export default function AttentionSidebar() {
  const getIcon = useIcon();
  const [areas, setAreas] = useState(null); // null while loading
  const load = useCallback(() => {
    api.get('/api/attention/summary').then((r) => (r.ok ? r.json() : { areas: [] })).then((d) => setAreas(Array.isArray(d.areas) ? d.areas : []))
      .catch(() => setAreas((a) => a || []));
  }, []);
  useEffect(() => {
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(timer); };
  }, [load]);

  const total = (areas || []).reduce((n, a) => n + a.total, 0);
  return (
    <aside aria-label="Needs attention" className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
        Needs attention{areas && total === 0 ? ' · all clear' : ''}
      </h2>
      {areas === null && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
      {(areas || []).map((a) => {
        const urgent = a.lines.some((l) => l.severity === 'high');
        return (
          <section key={a.id} className="rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <Link to={a.to} className="flex items-center gap-2 px-4 pt-3 pb-1 hover:opacity-70 transition-opacity" style={{ color: 'var(--color-text)' }}>
              <span style={{ color: 'var(--color-primary)' }}>{getIcon(a.icon, { size: 15 })}</span>
              <span className="text-sm font-semibold flex-1">{a.label}</span>
              {a.total > 0 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={urgent ? { background: '#fee2e2', color: '#b91c1c' } : { background: 'var(--color-bg)', color: 'var(--color-muted)' }}>{a.total}</span>
              )}
            </Link>
            {a.lines.length === 0 ? (
              <p className="px-4 pb-3 pt-0.5 text-xs" style={{ color: 'var(--color-muted)' }}>Nothing waiting</p>
            ) : (
              <ul className="pb-1.5">
                {a.lines.map((l) => (
                  <li key={l.id}>
                    <Link to={l.to} className="flex items-start gap-2.5 px-4 py-1.5 hover:opacity-70 transition-opacity" style={{ color: 'var(--color-text)' }}>
                      <span aria-hidden="true" className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" style={{ background: DOT[l.severity] || DOT.low }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm">{l.text}</span>
                        {l.detail && <span className="block text-xs mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>{l.detail}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </aside>
  );
}
