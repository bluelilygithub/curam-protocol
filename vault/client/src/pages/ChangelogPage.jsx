import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import Tooltip from '../components/Tooltip';
import EmptyState from '../components/EmptyState';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { GROUPINGS, groupEntries, hasConcern } from './changelog/groupEntries.mjs';

// Admin changelog: what each commit did, which code it touched, the goal, the benefit and any concerns. Grouped by day, week, month or
// year; click an update to open its details. Server: routes/changelog.js (admin only, read-only). Docs: docs/changelog.md.

const GROUP_KEY = 'vault:changelogGrouping';
const GROUP_LABEL = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' };
const GROUP_TIP = {
  day: 'One heading per day.',
  week: 'One heading per week, weeks starting on Monday.',
  month: 'One heading per calendar month.',
  year: 'One heading per year.',
};

const fmtTime = (iso) => {
  try { return new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return String(iso).slice(0, 16); }
};

function Section({ title, children, tone }) {
  return (
    <div>
      <p className="text-xs font-semibold mb-0.5" style={{ color: tone || 'var(--color-muted)' }}>{title}</p>
      {children}
    </div>
  );
}

export default function ChangelogPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = !!user?.isAdmin;
  const getIcon = useIcon();
  const info = useToolInfoModal('vault_changelog_info_seen');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(() => {
    try { const v = localStorage.getItem(GROUP_KEY); return GROUPINGS.includes(v) ? v : 'day'; } catch { return 'day'; }
  });
  const [open, setOpen] = useState(() => new Set());

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/changelog');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The changelog could not be loaded');
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setError(null);
    } catch (err) {
      setError(err.message || 'The changelog could not be loaded');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const groups = useMemo(() => groupEntries(entries, mode), [entries, mode]);

  if (!isAdmin) return <Navigate to="/" replace />;

  const chooseMode = (m) => {
    setMode(m);
    try { localStorage.setItem(GROUP_KEY, m); } catch (_) { /* ignore */ }
  };
  const toggle = (id) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allOpen = entries.length > 0 && open.size === entries.length;
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(entries.map((e) => e.id)));

  return (
    <div className="p-4 sm:p-6 max-w-[1100px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            Changelog
            <Tooltip text="How the changelog works and where its entries come from.">
              <button type="button" onClick={info.open} aria-label="How the changelog works" className="hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                {getIcon('info', { size: 14 })}
              </button>
            </Tooltip>
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>What each update did, what code it touched, why, what it gained and what to keep an eye on. Only you can see this page.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Group updates by" className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            {GROUPINGS.map((g) => (
              <Tooltip key={g} text={GROUP_TIP[g]}>
                <button
                  type="button" onClick={() => chooseMode(g)} aria-pressed={mode === g}
                  className="text-sm px-3 py-1.5 hover:opacity-70 transition-opacity duration-200"
                  style={{ background: mode === g ? 'var(--color-primary)' : 'var(--color-surface)', color: mode === g ? 'var(--color-on-primary, #fff)' : 'var(--color-text)' }}
                >
                  {GROUP_LABEL[g]}
                </button>
              </Tooltip>
            ))}
          </div>
          <Tooltip text={allOpen ? 'Close the details of every update.' : 'Open the details of every update at once.'}>
            <button type="button" onClick={toggleAll} disabled={!entries.length} className="text-sm px-3 py-1.5 rounded-md border hover:opacity-70 transition-opacity duration-200 disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          </Tooltip>
        </div>
      </div>

      {info.show && (
        <ToolInfoModal title="How the Changelog Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>One entry per commit, newest first. Click an entry to open it.</p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p style={{ color: 'var(--color-text)' }}><strong>What changed</strong> and <strong>Code impacted</strong> say what the update did and which files it touched. <strong>Goal</strong> is why it was made, <strong>Benefit</strong> what it gained, and <strong>Concerns</strong> anything to keep an eye on (a "Concerns" tag shows on the row when there is one).</p>
            <p style={{ color: 'var(--color-text)' }}>Use <strong>Day, Week, Month or Year</strong> to change the headings; weeks start on Monday. Your choice is remembered in this browser.</p>
            <p style={{ color: 'var(--color-text)' }}>The entries are written by Claude from each commit's message, file list and size; the date, author and line counts come straight from git. They describe what the commit says it did, so they are a guide, not proof that it works. The first 25 were added on 2026-11-07; newer ones are added when asked.</p>
          </div>
        </ToolInfoModal>
      )}

      {error && <p className="text-xs mb-3 px-3 py-2 rounded-md" style={{ background: '#fff1f2', color: '#ef4444' }}>{error}</p>}

      {loading ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'var(--color-surface)' }} />)}</div>
      ) : !entries.length ? (
        <EmptyState icon="history" title="No updates recorded yet" body="Entries appear here once they have been added to the changelog." />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="text-sm font-semibold mb-2 flex items-baseline gap-2" style={{ color: 'var(--color-text)' }}>
                {g.label}
                <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>{g.entries.length} update{g.entries.length === 1 ? '' : 's'}</span>
              </h2>
              <ul className="space-y-2">
                {g.entries.map((e) => {
                  const isOpen = open.has(e.id);
                  const concern = hasConcern(e);
                  return (
                    <li key={e.id} className="rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                      <button
                        type="button" onClick={() => toggle(e.id)} aria-expanded={isOpen}
                        className="w-full text-left px-3 py-2.5 flex items-start gap-2 hover:opacity-70 transition-opacity duration-200"
                      >
                        <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon(isOpen ? 'chevron-down' : 'chevron-right', { size: 14 })}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium" style={{ color: 'var(--color-text)' }}>{e.subject}</span>
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                            <span>{fmtTime(e.committedAt)}</span>
                            {e.area && <span className="px-1.5 py-0.5 rounded-full border" style={{ borderColor: 'var(--color-border)' }}>{e.area}</span>}
                            <span className="font-mono">{e.commit}</span>
                            {e.filesChanged != null && <span>{e.filesChanged} file{e.filesChanged === 1 ? '' : 's'} · +{e.insertions ?? 0} −{e.deletions ?? 0}</span>}
                            {concern && <span className="px-1.5 py-0.5 rounded-full border" style={{ color: '#f59e0b', borderColor: '#f59e0b' }}>Concerns</span>}
                          </span>
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 pt-1 space-y-3 text-sm" style={{ color: 'var(--color-text)' }}>
                          <Section title="What changed"><p>{e.whatChanged}</p></Section>
                          <Section title="Code impacted">
                            <ul className="space-y-0.5 text-xs font-mono" style={{ color: 'var(--color-text)' }}>
                              {(e.filesImpacted || []).map((f, i) => <li key={i}>{f}</li>)}
                            </ul>
                          </Section>
                          <Section title="Goal"><p>{e.goal}</p></Section>
                          <Section title="Benefit"><p>{e.benefit}</p></Section>
                          <Section title="Concerns" tone={concern ? '#f59e0b' : undefined}><p>{e.concerns || 'None noted.'}</p></Section>
                          {e.author && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Committed by {e.author} · {e.fullHash}</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
