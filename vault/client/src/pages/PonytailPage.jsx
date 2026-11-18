import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { useIcon } from '../providers/IconProvider';
import Tooltip from '../components/Tooltip';
import EmptyState from '../components/EmptyState';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import SummaryTiles from './ponytail/SummaryTiles';
import PonytailCharts from './ponytail/PonytailCharts';
import TasksTable from './ponytail/TasksTable';
import CodeWrittenPanel from './ponytail/CodeWrittenPanel';
import SetupPanel from './ponytail/SetupPanel';
import { RANGES, brisbaneDay, addDays, fillDays } from './ponytail/ponytailFormat.mjs';

// Ponytail report (admin): what the Ponytail plugin in Claude Code reports per task (cost, tokens, reuse, tests), next to the code
// written per day from the Changelog. Server: routes/ponytail.js. Docs: docs/ponytail-report.md.

const FIELD = 'px-3 py-2 rounded-xl border text-sm transition-all duration-200';
const fieldStyle = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The filters live in the address, so a view can be linked. */
function readFilters(sp) {
  const today = brisbaneDay();
  const range = sp.get('range') || '30';
  const preset = RANGES.find((r) => r.id === range);
  const from = preset ? addDays(today, -(preset.days - 1)) : (DAY_RE.test(sp.get('from') || '') ? sp.get('from') : addDays(today, -29));
  const to = preset ? today : (DAY_RE.test(sp.get('to') || '') ? sp.get('to') : today);
  return {
    range: preset ? range : 'custom', from, to: to < from ? from : to,
    project: sp.get('project') || '', model: sp.get('model') || '',
    sort: sp.get('sort') || 'started', dir: sp.get('dir') === 'asc' ? 'asc' : 'desc', page: Math.max(1, Number(sp.get('page')) || 1),
  };
}

const query = (f, extra = {}) => new URLSearchParams(Object.fromEntries(Object.entries({ from: f.from, to: f.to, project: f.project, model: f.model, ...extra }).filter(([, v]) => v !== '' && v !== undefined))).toString();

export default function PonytailPage() {
  const { user } = useAuthStore();
  const isAdmin = !!user?.isAdmin;
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const info = useToolInfoModal('vault_ponytail_info_seen');
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => readFilters(sp), [sp]);

  const [summary, setSummary] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [code, setCode] = useState(null);
  const [reload, setReload] = useState(0);

  const set = (patch) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v === '' || v === undefined || v === null) next.delete(k); else next.set(k, String(v)); });
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };

  const getJson = useCallback(async (url) => {
    const res = await api.get(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not load the report');
    return data;
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    setSummary(null); setCode(null);
    Promise.all([getJson(`/api/ponytail/summary?${query(f)}`), getJson(`/api/ponytail/code-written?${query(f, { project: '', model: '' })}`)])
      .then(([s, c]) => { if (live) { setSummary(s); setCode(c.days); } })
      .catch((err) => { if (live) { addToast(err.message, 'error'); setSummary({ totals: null, days: [], projects: [], models: [], allTasks: 0, failed: true }); setCode([]); } });
    return () => { live = false; };
  }, [isAdmin, f.from, f.to, f.project, f.model, reload, getJson, addToast]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    setTasks(null);
    getJson(`/api/ponytail/tasks?${query(f, { sort: f.sort, dir: f.dir, page: f.page })}`)
      .then((d) => { if (live) setTasks(d); })
      .catch((err) => { if (live) { addToast(err.message, 'error'); setTasks({ tasks: [], total: 0, page: 1, pageSize: 50 }); } });
    return () => { live = false; };
  }, [isAdmin, f.from, f.to, f.project, f.model, f.sort, f.dir, f.page, reload, getJson, addToast]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin) return <Navigate to="/" replace />;

  const days = summary?.days ? fillDays(summary.days, f.from, f.to) : null;
  const nothingYet = summary && !summary.failed && summary.allTasks === 0;
  const onSort = (col) => set({ sort: col, dir: f.sort === col && f.dir === 'desc' ? 'asc' : 'desc' });
  const onDelete = async (t) => {
    const res = await api.delete(`/api/ponytail/tasks/${t.id}`);
    if (!res.ok) { addToast((await res.json().catch(() => ({}))).error || 'Could not delete', 'error'); return; }
    addToast('Moved to the recycle bin for 30 days', 'success');
    setReload((n) => n + 1);
  };

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[1700px] mx-auto p-4 sm:p-6 space-y-5">
          <header className="flex flex-wrap items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}>{getIcon('gauge', { size: 18 })}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Ponytail</h1>
                <Tooltip text="What this page shows, where the figures come from, and what they cannot tell you.">
                  <button type="button" onClick={info.open} aria-label="How the Ponytail report works" className="transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-muted)' }}>{getIcon('info', { size: 14 })}</button>
                </Tooltip>
              </div>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>What each Claude Code task cost, how much it reused, and how much code was written those days.</p>
            </div>
            <Tooltip text="Jump to the setup: make a key, copy the webhook address, or import the CSV.">
              <a href="#ponytail-setup" className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity duration-200 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Setup</a>
            </Tooltip>
          </header>

          {info.show && (
            <ToolInfoModal title="How the Ponytail report works" onClose={info.close}>
              <div className="text-sm space-y-2" style={{ color: 'var(--color-text)' }}>
                <p><strong>Where it comes from.</strong> The Ponytail plugin in Claude Code sends one row per task after every turn: its cost so far, turns, minutes Claude worked, tokens, how many functions it reused or wrote, and the last test result. A task is one session, or the part of one after a /clear. The row is replaced on every turn, so a task shows its latest figures.</p>
                <p><strong>Reuse</strong> is the share of functions a task used that already existed, out of all it used or wrote. Tasks that touched fewer than 3 functions have no share.</p>
                <p><strong>Code written</strong> puts commits per day (from the Changelog) next to that day&rsquo;s Ponytail cost and reuse. They are matched by day, not linked one to one, so read it as a trend, not proof.</p>
                <p><strong>Days</strong> are Brisbane days. Each task counts on the day it started.</p>
                <p><strong>Older tasks</strong> can be added from Ponytail&rsquo;s CSV file in Setup. Those rows only know the token total and output, not the cache split.</p>
              </div>
            </ToolInfoModal>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <Tooltip text="The days to show (Brisbane time), by the day each task started.">
              <label className="text-xs space-y-1 block" style={{ color: 'var(--color-muted)' }}>
                <span className="block">Range</span>
                <select value={f.range} onChange={(e) => (e.target.value === 'custom' ? set({ range: 'custom', from: f.from, to: f.to }) : set({ range: e.target.value, from: '', to: '' }))} className={FIELD} style={fieldStyle}>
                  {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  <option value="custom">Choose dates</option>
                </select>
              </label>
            </Tooltip>
            {f.range === 'custom' && (
              <>
                <Tooltip text="First day to show.">
                  <label className="text-xs space-y-1 block" style={{ color: 'var(--color-muted)' }}><span className="block">From</span>
                    <input type="date" value={f.from} max={f.to} onChange={(e) => set({ range: 'custom', from: e.target.value, to: f.to })} className={FIELD} style={fieldStyle} />
                  </label>
                </Tooltip>
                <Tooltip text="Last day to show.">
                  <label className="text-xs space-y-1 block" style={{ color: 'var(--color-muted)' }}><span className="block">To</span>
                    <input type="date" value={f.to} min={f.from} onChange={(e) => set({ range: 'custom', from: f.from, to: e.target.value })} className={FIELD} style={fieldStyle} />
                  </label>
                </Tooltip>
              </>
            )}
            <Tooltip text="Only tasks from one project (the folder Claude Code was working in).">
              <label className="text-xs space-y-1 block" style={{ color: 'var(--color-muted)' }}><span className="block">Project</span>
                <select value={f.project} onChange={(e) => set({ project: e.target.value })} className={FIELD} style={fieldStyle}>
                  <option value="">All projects</option>
                  {(summary?.projects || []).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </Tooltip>
            <Tooltip text="Only tasks where this model wrote most of the replies.">
              <label className="text-xs space-y-1 block" style={{ color: 'var(--color-muted)' }}><span className="block">Model</span>
                <select value={f.model} onChange={(e) => set({ model: e.target.value })} className={FIELD} style={fieldStyle}>
                  <option value="">All models</option>
                  {(summary?.models || []).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </Tooltip>
            {(f.project || f.model) && (
              <Tooltip text="Show every project and model again.">
                <button type="button" onClick={() => set({ project: '', model: '' })} className="text-xs pb-2.5 transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-primary)' }}>Clear filters</button>
              </Tooltip>
            )}
          </div>

          {nothingYet ? (
            <section className="rounded-2xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <EmptyState
                icon="gauge"
                title="Nothing from Ponytail yet"
                body="Make a key in Setup below, paste it and the webhook address into Ponytail in Claude Code, and the next turn of any task shows up here. To add older tasks, import Ponytail's CSV file."
                action={<a href="#ponytail-setup" className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-80" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>Go to Setup</a>}
              />
            </section>
          ) : (
            <>
              <SummaryTiles totals={summary?.totals} />
              <PonytailCharts days={days} loading={!summary} />
              <section className="rounded-2xl border p-5 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <div>
                  <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Tasks</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Click a heading to sort, a row to see every figure and when it was first and last updated.</p>
                </div>
                {tasks && tasks.total === 0 ? <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No tasks match these filters.</p> : (
                  <TasksTable data={tasks} sort={f.sort} dir={f.dir} onSort={onSort} page={f.page} onPage={(p) => set({ page: p })} onDelete={onDelete} />
                )}
              </section>
              <CodeWrittenPanel days={code} />
            </>
          )}

          <SetupPanel onImported={() => setReload((n) => n + 1)} />
        </div>
      </div>
    </VoiceInputProvider>
  );
}
