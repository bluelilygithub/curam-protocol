import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/apiClient';

// The one short list of things waiting on you (overdue invoices and tasks, due note reminders, invoices to review, today's tasks, new
// suggestions), worst first. Built by the server (GET /api/attention). Shows nothing while loading, when it fails, or when nothing is waiting,
// so it never adds noise to the page it sits on.
const DOT = { high: '#ef4444', normal: '#f59e0b', low: 'var(--color-muted)' };

export default function NeedsAttention({ className = '' }) {
  const [items, setItems] = useState([]);

  const load = useCallback(() => {
    api.get('/api/attention')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  if (!items.length) return null;

  return (
    <section
      aria-label="Needs attention"
      className={`rounded-xl border ${className}`}
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <h2 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>Needs attention</h2>
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <Link
              to={it.to}
              className="flex items-start gap-3 px-4 py-2.5 hover:opacity-70 transition-opacity duration-200"
              style={{ color: 'var(--color-text)' }}
            >
              <span
                aria-hidden="true"
                className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: DOT[it.severity] || DOT.low }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{it.title}</span>
                {it.detail && <span className="block text-xs mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>{it.detail}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
