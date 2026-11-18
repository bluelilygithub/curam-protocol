import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import Tooltip from '../components/Tooltip';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import { VoiceInput } from '../components/voiceInput/VoiceInput';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { GROUPINGS, groupEntries, hasConcern } from './changelog/groupEntries.mjs';
import { parseFilters, filtersToParams, filterEntries, areaOptions, searchTerms, highlightParts, isFiltered } from './changelog/filterEntries.mjs';
import AskChangelog from './changelog/AskChangelog';

// Admin changelog: what each commit did, which code it touched, the goal, the benefit and any concerns. Grouped by day, week, month or
// year; click an update to open its details. Search and filters run in the browser over the loaded entries and live in the URL
// (changelog/filterEntries.mjs). "Ask the changelog" sends a question to POST /api/changelog/ask (changelog/AskChangelog.jsx).
// Server: routes/changelog.js (admin only). Docs: docs/changelog.md.

const GROUP_KEY = 'vault:changelogGrouping';
const GROUP_LABEL = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' };
const GROUP_TIP = {
  day: 'One heading per day.',
  week: 'One heading per week, weeks starting on Monday.',
  month: 'One heading per calendar month.',
  year: 'One heading per year.',
};
const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

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

/** Text with the search matches marked. */
function Hl({ text, terms }) {
  if (!terms.length) return <>{text}</>;
  return (
    <>
      {highlightParts(text, terms).map((p, i) => (p.hit
        ? <mark key={i} className="rounded-sm" style={{ background: 'rgba(245, 158, 11, 0.35)', color: 'inherit' }}>{p.text}</mark>
        : <React.Fragment key={i}>{p.text}</React.Fragment>))}
    </>
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
  const [scrollTo, setScrollTo] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

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

  const areas = useMemo(() => areaOptions(entries), [entries]);
  const shown = useMemo(() => filterEntries(entries, filters), [entries, filters]);
  const groups = useMemo(() => groupEntries(shown, mode), [shown, mode]);
  const terms = useMemo(() => searchTerms(filters.q), [filters.q]);
  const filtered = isFiltered(filters);

  // after a citation is clicked: scroll to the entry once it is on the page
  useEffect(() => {
    if (!scrollTo) return;
    const el = document.getElementById(`changelog-${scrollTo}`);
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el.querySelector('button')?.focus({ preventScroll: true });
    setScrollTo(null);
  }, [scrollTo, groups]);

  if (!isAdmin) return <Navigate to="/" replace />;

  const chooseMode = (m) => {
    setMode(m);
    try { localStorage.setItem(GROUP_KEY, m); } catch (_) { /* ignore */ }
  };
  const setFilter = (patch) => setSearchParams(filtersToParams({ ...filters, ...patch }), { replace: true });
  const clearFilters = () => setSearchParams({}, { replace: true });
  const toggle = (id) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allOpen = shown.length > 0 && shown.every((e) => open.has(e.id));
  const toggleAll = () => setOpen((prev) => {
    const next = new Set(prev);
    for (const e of shown) { if (allOpen) next.delete(e.id); else next.add(e.id); }
    return next;
  });

  // a [hash] in an answer: open that entry and scroll to it (clearing the filters when they hide it)
  const openCommit = (hash) => {
    const e = entries.find((x) => x.commit === hash);
    if (!e) return;
    if (!shown.some((x) => x.id === e.id)) clearFilters();
    setOpen((prev) => new Set(prev).add(e.id));
    setScrollTo(e.id);
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1100px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            Changelog
            <Tooltip text="How the changelog works, how to search it and what Ask can see.">
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
          <Tooltip text={allOpen ? 'Close the details of every update shown.' : 'Open the details of every update shown at once.'}>
            <button type="button" onClick={toggleAll} disabled={!shown.length} className="text-sm px-3 py-1.5 rounded-md border hover:opacity-70 transition-opacity duration-200 disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
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
            <p style={{ color: 'var(--color-text)' }}><strong>Search and filters</strong> narrow the list: words (all must match) across the subject, area, goal, what changed, benefit, concerns and commit hash; an area; a date range; only updates with concerns; or a file (any part of a path, such as db.js). They stay in the address, so you can bookmark or share a filtered view.</p>
            <p style={{ color: 'var(--color-text)' }}><strong>Ask</strong> sends your question to the AI model set in Settings with the matching updates only (dates read in Brisbane time, area and file names, keywords; at most 40). It answers from those entries alone and cites each claim with a commit hash you can click. It cannot see the code, git or anything outside the changelog.</p>
            <p style={{ color: 'var(--color-text)' }}>Use <strong>Day, Week, Month or Year</strong> to change the headings; weeks start on Monday. Your choice is remembered in this browser.</p>
            <p style={{ color: 'var(--color-text)' }}>The entries are written by Claude from each commit's message, file list and size; the date, author and line counts come straight from git. They describe what the commit says it did, so they are a guide, not proof that it works.</p>
          </div>
        </ToolInfoModal>
      )}

      {error && <p className="text-xs mb-3 px-3 py-2 rounded-md" style={{ background: 'var(--color-surface)', color: '#ef4444' }}>{error}</p>}

      <AskChangelog onOpen={openCommit} disabled={loading || !entries.length} />

      <div role="search" aria-label="Search and filter updates" className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex-1 min-w-[220px]">
          <Tooltip text="Words to find in the subject, area, goal, what changed, benefit, concerns or commit hash. Every word must match; put a phrase in quotes.">
            <div>
              <VoiceInput value={filters.q} onChange={(v) => setFilter({ q: v })} label="Search updates" placeholder="Search updates…" />
            </div>
          </Tooltip>
        </div>
        <Tooltip text="Only updates in this area.">
          <select value={filters.area} onChange={(e) => setFilter({ area: e.target.value })} aria-label="Area" className="px-2 py-2.5 rounded-xl border text-sm" style={FIELD}>
            <option value="">All areas</option>
            {filters.area && !areas.includes(filters.area) && <option value={filters.area}>{filters.area}</option>}
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Tooltip>
        <Tooltip text="Only updates on or after this day.">
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} aria-label="From date" className="px-2 py-2 rounded-xl border text-sm" style={FIELD} />
        </Tooltip>
        <Tooltip text="Only updates on or before this day.">
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} aria-label="To date" className="px-2 py-2 rounded-xl border text-sm" style={FIELD} />
        </Tooltip>
        <div className="w-[180px]">
          <Tooltip text="Only updates that touched a file whose path contains this, for example db.js or server/routes/.">
            <div>
              <VoiceInput value={filters.file} onChange={(v) => setFilter({ file: v })} label="File" placeholder="File, e.g. db.js" mic={false} />
            </div>
          </Tooltip>
        </div>
        <Tooltip text="Only updates with a concern written down (not empty and not None noted).">
          <button
            type="button" onClick={() => setFilter({ concerns: !filters.concerns })} aria-pressed={filters.concerns}
            className="text-sm px-3 py-2.5 rounded-xl border flex items-center gap-1 hover:opacity-70 transition-opacity duration-200"
            style={{ borderColor: filters.concerns ? '#f59e0b' : 'var(--color-border)', color: filters.concerns ? '#f59e0b' : 'var(--color-text)', background: 'var(--color-bg)' }}
          >
            {getIcon('alert-triangle', { size: 14 })} Has concerns
          </button>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4 text-xs" style={{ color: 'var(--color-muted)' }} aria-live="polite">
        <span>{filtered ? `${shown.length} of ${entries.length} update${entries.length === 1 ? '' : 's'} match` : `${entries.length} update${entries.length === 1 ? '' : 's'}`}</span>
        {filtered && (
          <Tooltip text="Remove the search and every filter.">
            <button type="button" onClick={clearFilters} className="flex items-center gap-1 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }}>
              {getIcon('x', { size: 12 })} Clear filters
            </button>
          </Tooltip>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" label="Loading the changelog" />)}</div>
      ) : !entries.length ? (
        <EmptyState icon="history" title="No updates recorded yet" body="Entries appear here once they have been added to the changelog." />
      ) : !shown.length ? (
        <EmptyState
          icon="search" title="No updates match" body="Try fewer words, a wider date range or another area."
          action={<button type="button" onClick={clearFilters} className="text-sm px-3 py-1.5 rounded-md border hover:opacity-70 transition-opacity duration-200" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Clear filters</button>}
        />
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
                    <li key={e.id} id={`changelog-${e.id}`} className="rounded-xl border scroll-mt-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                      <button
                        type="button" onClick={() => toggle(e.id)} aria-expanded={isOpen}
                        className="w-full text-left px-3 py-2.5 flex items-start gap-2 hover:opacity-70 transition-opacity duration-200"
                      >
                        <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon(isOpen ? 'chevron-down' : 'chevron-right', { size: 14 })}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium" style={{ color: 'var(--color-text)' }}><Hl text={e.subject} terms={terms} /></span>
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                            <span>{fmtTime(e.committedAt)}</span>
                            {e.area && <span className="px-1.5 py-0.5 rounded-full border" style={{ borderColor: 'var(--color-border)' }}><Hl text={e.area} terms={terms} /></span>}
                            <span className="font-mono"><Hl text={e.commit} terms={terms} /></span>
                            {e.filesChanged != null && <span>{e.filesChanged} file{e.filesChanged === 1 ? '' : 's'} · +{e.insertions ?? 0} −{e.deletions ?? 0}</span>}
                            {concern && <span className="px-1.5 py-0.5 rounded-full border" style={{ color: '#f59e0b', borderColor: '#f59e0b' }}>Concerns</span>}
                          </span>
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 pt-1 space-y-3 text-sm" style={{ color: 'var(--color-text)' }}>
                          <Section title="What changed"><p><Hl text={e.whatChanged} terms={terms} /></p></Section>
                          <Section title="Code impacted">
                            <ul className="space-y-0.5 text-xs font-mono" style={{ color: 'var(--color-text)' }}>
                              {(e.filesImpacted || []).map((f, i) => <li key={i}><Hl text={f} terms={filters.file ? [filters.file.toLowerCase()] : []} /></li>)}
                            </ul>
                          </Section>
                          <Section title="Goal"><p><Hl text={e.goal} terms={terms} /></p></Section>
                          <Section title="Benefit"><p><Hl text={e.benefit} terms={terms} /></p></Section>
                          <Section title="Concerns" tone={concern ? '#f59e0b' : undefined}><p><Hl text={e.concerns || 'None noted.'} terms={terms} /></p></Section>
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
