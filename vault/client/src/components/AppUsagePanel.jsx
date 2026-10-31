import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../utils/apiClient';
import { APP_NAV_GROUPS } from '../config/appNavigation';
import Skeleton from './Skeleton';
import EmptyState from './EmptyState';

// Admin -> "Which tools get used": how often each part of Vault was opened in the last 90 days, and which were never opened. Counts only (the
// server keeps the section, the day and a number, nothing about what was on the page), so it is safe to look at and a good basis for deciding
// what stays in the menu. Everything not listed as used comes from the nav catalog, so a new tool appears here without extra work.
const DAY_CHOICES = [30, 90, 365];

export default function AppUsagePanel() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/admin/app-usage?days=${days}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load usage');
      setData(json);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const { used, unused } = useMemo(() => {
    const catalog = APP_NAV_GROUPS.flatMap((g) => g.items.filter((i) => !i.external).map((i) => ({ id: i.id, label: i.label, group: g.label })));
    const byKey = new Map((data?.items || []).map((r) => [r.key, r]));
    const known = new Set(catalog.map((c) => c.id));
    const usedRows = [
      ...catalog.filter((c) => byKey.has(c.id)).map((c) => ({ ...c, ...byKey.get(c.id) })),
      // sections that are in the menu bar rather than an Apps group (Tasks, Settings, Chat...) or were since renamed
      ...(data?.items || []).filter((r) => !known.has(r.key)).map((r) => ({ id: r.key, label: r.key, group: '', ...r })),
    ].sort((a, b) => b.visits - a.visits);
    const unusedRows = data ? catalog.filter((c) => !byKey.has(c.id)) : [];
    return { used: usedRows, unused: unusedRows };
  }, [data]);

  const max = used[0]?.visits || 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Which tools get used</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            How often each part of Vault was opened, by everyone. Counts only, nothing about what was on the page. Counting started when this was added, so a new tool needs a few weeks before it means anything.
          </p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Period">
          {DAY_CHOICES.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className="px-3 py-1.5 rounded-lg border text-xs font-medium hover:opacity-70 transition-opacity duration-200"
              style={{
                borderColor: 'var(--color-border)',
                background: days === d ? 'var(--color-primary)' : 'var(--color-surface)',
                color: days === d ? '#fff' : 'var(--color-muted)',
              }}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
      {!data && !error && <Skeleton lines={4} label="Loading tool usage" />}

      {data && (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          {used.length === 0 ? (
            <EmptyState icon="bar-chart" title="Nothing counted yet" body="Open a few tools and check back. Counting started when this panel was added." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-left" style={{ color: 'var(--color-muted)' }}>
                  <th className="px-4 py-2 font-semibold">Tool</th>
                  <th className="px-2 py-2 font-semibold w-1/3"><span className="sr-only">Opened</span></th>
                  <th className="px-2 py-2 font-semibold text-right">Opened</th>
                  <th className="px-2 py-2 font-semibold text-right">Days used</th>
                  <th className="px-4 py-2 font-semibold text-right">Last</th>
                </tr>
              </thead>
              <tbody>
                {used.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <td className="px-4 py-2">{r.label}{r.group && <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>{r.group}</span>}</td>
                    <td className="px-2 py-2" aria-hidden="true">
                      <div className="h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
                        <div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, (r.visits / max) * 100)}%`, background: 'var(--color-primary)' }} />
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.visits}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.days}</td>
                    <td className="px-4 py-2 text-right text-xs" style={{ color: 'var(--color-muted)' }}>{r.lastDay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {data && unused.length > 0 && (
        <details className="rounded-2xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <summary className="px-4 py-3 text-sm font-medium cursor-pointer" style={{ color: 'var(--color-text)' }}>
            Not opened in {data.days} days ({unused.length})
          </summary>
          <ul className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm" style={{ color: 'var(--color-muted)' }}>
            {unused.map((c) => <li key={c.id}>{c.label}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
