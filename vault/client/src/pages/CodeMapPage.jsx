import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { useIcon } from '../providers/IconProvider';
import Tooltip from '../components/Tooltip';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { startCodeMapTour, TOUR_KEY as CODE_MAP_TOUR_KEY } from '../utils/tours/codeMapTour';
import Overview from './codeMap/Overview';
import ToolsView from './codeMap/ToolsView';
import ConventionsView from './codeMap/ConventionsView';
import StructureView from './codeMap/StructureView';
import ChangesView from './codeMap/ChangesView';
import ToolDetail from './codeMap/ToolDetail';
import CodeMapTutorChat from './codeMap/CodeMapTutorChat';
import { CODE_MAP_TOOLS, TOOL_TIPS, HOW_IT_WORKS, GUIDE_TOOLS } from './codeMap/codeMapTools.mjs';
import { fmtSecs, fmtWhen } from './codeMap/shared';

// Admin Code Map: a static read of Vault's own source. Every tool, the code it owns, how it follows the rules in CLAUDE.md, and a ranked
// list of what to improve. Runs are background jobs (server/services/codeMap/jobs.js); this page starts one and polls it every 1.5 seconds.
// API: server/routes/codeMap.js (admin only). Docs: docs/code-map.md. The selected tab is in the URL (?view=) so links work.

const DependencyMap = lazy(() => import('./codeMap/DependencyMap')); // the graph library loads only when the map tab opens

// the tabs are the page's "tools" in codeMapTools.mjs, shared with the guide
const VIEWS = CODE_MAP_TOOLS.map((t) => ({ id: t.id, label: t.label, tip: TOOL_TIPS[t.id] }));
const POLL_MS = 1500;
const toast = (message, type = 'error') => useToastStore.getState().addToast(message, type);
const isActive = (r) => r && (r.status === 'queued' || r.status === 'running');

export default function CodeMapPage() {
  const isAdmin = !!useAuthStore((s) => s.user?.isAdmin);
  const getIcon = useIcon();
  const info = useToolInfoModal('vault_code_map_info_seen');
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'overview';
  const [run, setRun] = useState(null); // the latest finished run, with its result
  const [runs, setRuns] = useState([]); // recent runs without results, newest first (for Changes)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null); // the run in progress: { id, status, stage, stageLabel, stageStep, stageCount }
  const [starting, setStarting] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const tabRefs = useRef({});

  const setView = useCallback((v) => {
    setParams((p) => { const next = new URLSearchParams(p); if (v === 'overview') next.delete('view'); else next.set('view', v); return next; }, { replace: true });
  }, [setParams]);

  const load = useCallback(async () => {
    try {
      const [lr, rr] = await Promise.all([api.get('/api/code-map/runs/latest'), api.get('/api/code-map/runs')]);
      const latest = await lr.json().catch(() => ({}));
      const list = await rr.json().catch(() => ({}));
      if (!lr.ok) throw new Error(latest.error || 'The Code Map could not be loaded.');
      setRun(latest.run || null);
      setRuns(list.runs || []);
      const going = (list.runs || []).find(isActive);
      if (going) setActive(going);
      setError(null);
    } catch (err) {
      setError(err.message || 'The Code Map could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  // poll the run in progress until it is done or failed
  const activeId = active?.id;
  useEffect(() => {
    if (!activeId) return undefined;
    let stop = false;
    let timer;
    const tick = async () => {
      try {
        const r = await api.get(`/api/code-map/runs/${activeId}`);
        const d = await r.json().catch(() => ({}));
        if (stop) return;
        if (!r.ok) throw new Error(d.error || 'Lost track of the run.');
        const x = d.run;
        if (isActive(x)) { setActive(x); timer = setTimeout(tick, POLL_MS); return; }
        setActive(null);
        // refresh the run list for Changes; not tied to `stop`, since clearing `active` below ends this effect before the list arrives
        api.get('/api/code-map/runs').then((lr) => (lr.ok ? lr.json() : null)).then((l) => { if (l) setRuns(l.runs || []); }).catch(() => {});
        if (x.status === 'done') {
          setRun(x);
          toast(`Analysis finished in ${fmtSecs(x.durationMs)}.`, 'success');
        } else {
          toast(x.error ? `The analysis failed: ${x.error}` : 'The analysis failed.');
        }
      } catch (err) {
        if (stop) return;
        setActive(null);
        toast(err.message || 'Lost track of the run.');
      }
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { stop = true; clearTimeout(timer); };
  }, [activeId]);

  const startRun = async () => {
    setStarting(true);
    try {
      const r = await api.post('/api/code-map/runs', {});
      const d = await r.json().catch(() => ({}));
      if (r.status === 202 && d.id) setActive({ id: d.id, status: 'queued', stage: 'queued', stageLabel: 'Waiting to start', stageStep: 0 });
      else if (r.status === 409 && d.runningId) { setActive({ id: d.runningId, status: 'running' }); toast('An analysis is already running; showing its progress.', 'warn'); }
      else toast(d.error || 'Could not start the analysis.');
    } catch (_) {
      toast('Could not start the analysis.');
    } finally {
      setStarting(false);
    }
  };

  // Settings or a link can open /code-map?tour=1
  useEffect(() => {
    if (!isAdmin || !params.get('tour')) return;
    const next = new URLSearchParams(params); next.delete('tour');
    setParams(next, { replace: true });
    setTimeout(() => startCodeMapTour(setView), 300);
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // the guide's Open button: show the tab, then scroll to the part marked data-guide="<id>" (codeMapTools.mjs GUIDE_TOOLS)
  const openGuideTarget = (id) => {
    const target = GUIDE_TOOLS.find((g) => g.id === id);
    if (!target) return;
    setDetailId(null);
    setView(target.tool);
    setTimeout(() => {
      const el = document.querySelector(`[data-guide="${id}"]`);
      let still = false;
      try { still = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { /* old browser */ }
      if (el) el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
    }, 350);
  };

  const startTour = () => {
    try { localStorage.removeItem(CODE_MAP_TOUR_KEY); } catch (_) { /* ignore */ }
    setDetailId(null);
    startCodeMapTour(setView);
  };

  const data = run?.result || null;
  const byId = useMemo(() => Object.fromEntries((data?.tools || []).map((t) => [t.id, t])), [data]);
  const rules = data?.rules || [];

  if (!isAdmin) return <Navigate to="/" replace />;

  const onTabKey = (e, i) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + VIEWS.length) % VIEWS.length;
    setView(VIEWS[j].id);
    tabRefs.current[VIEWS[j].id]?.focus();
  };

  const busy = starting || !!active;
  // stageStep: 0 while queued, then 1 (reading files) to stageCount (saving)
  const steps = active?.stageCount || 9;
  const step = active ? Math.min(active.stageStep ?? 0, steps) : 0;

  return (
    <div className="p-4 sm:p-6 max-w-[1700px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            Code Map
            <Tooltip text="What Code Map checks and how to read it.">
              <button type="button" onClick={info.open} aria-label="How Code Map works" className="hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)', lineHeight: 1 }}>
                {getIcon('info', { size: 14 })}
              </button>
            </Tooltip>
            <Tooltip text="A short guided tour of the page.">
              <button type="button" onClick={startTour} aria-label="Start the Code Map tour" className="hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)', lineHeight: 1 }}>
                {getIcon('compass', { size: 14 })}
              </button>
            </Tooltip>
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {run ? (
              <>Last run {fmtWhen(run.finishedAt || run.createdAt)} · took {fmtSecs(run.durationMs)}{run.commitHint ? <> · commit <code>{String(run.commitHint).slice(0, 8)}</code></> : ' · commit unknown (local)'}. </>
            ) : loading ? 'Loading… ' : 'Not run yet. '}Only admins can see this page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3" data-tour="cm-run" data-guide="run-analysis">
          {active && (
            <div className="min-w-[220px]" role="status" aria-live="polite">
              <div className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>
                {step ? `Step ${step} of ${steps}: ` : ''}{active.stageLabel || 'Working'}
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                <span className="block h-full transition-all duration-200" style={{ width: `${Math.max(4, (step / steps) * 100)}%`, background: 'var(--color-primary)' }} />
              </div>
            </div>
          )}
          <Tooltip text={busy ? 'An analysis is running. It takes a few seconds.' : 'Read the code as it is now on the server. Takes a few seconds; the page stays usable.'}>
            <button
              type="button" onClick={startRun} disabled={busy}
              className="text-sm font-medium px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 hover:opacity-70 transition-opacity duration-200 disabled:opacity-50"
              style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}
            >
              {getIcon(busy ? 'loader' : 'play', { size: 14, className: busy ? 'animate-spin' : undefined })}
              {busy ? 'Running…' : 'Run analysis'}
            </button>
          </Tooltip>
        </div>
      </div>

      {info.show && (
        <ToolInfoModal title="How Code Map Works" onClose={info.close}>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([head, text]) => (
              <p key={head} style={{ color: 'var(--color-text)' }}><strong>{head}.</strong> {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      <div role="tablist" aria-label="Code Map views" className="flex gap-1 overflow-x-auto border-b mb-5" style={{ borderColor: 'var(--color-border)' }}>
        {VIEWS.map((v, i) => (
          <Tooltip key={v.id} text={v.tip} side="bottom">
            <button
              ref={(el) => { tabRefs.current[v.id] = el; }}
              type="button" role="tab" id={`cm-tab-${v.id}`} aria-selected={view === v.id} aria-controls="cm-panel" tabIndex={view === v.id ? 0 : -1}
              onClick={() => setView(v.id)} onKeyDown={(e) => onTabKey(e, i)}
              className="px-3.5 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px hover:opacity-70 transition-opacity duration-200"
              style={{ borderColor: view === v.id ? 'var(--color-primary)' : 'transparent', color: view === v.id ? 'var(--color-text)' : 'var(--color-muted)' }}
            >
              {v.label}
            </button>
          </Tooltip>
        ))}
      </div>

      {error && <p className="text-xs mb-3 px-3 py-2 rounded-md" style={{ background: '#fff1f2', color: '#ef4444' }}>{error}</p>}

      <div id="cm-panel" role="tabpanel" aria-labelledby={`cm-tab-${view}`}>
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16" />)}</div>
            <Skeleton lines={6} className="h-10" label="Loading the Code Map" />
          </div>
        ) : !data ? (
          <EmptyState
            icon="code-map"
            title={active ? 'The first analysis is running' : 'No analysis yet'}
            body={active ? 'It takes a few seconds. The results appear here when it finishes.' : 'Run an analysis to see every tool, the code it owns and how it follows the rules in CLAUDE.md.'}
            action={!active && (
              <Tooltip text="Read the code as it is now. Takes a few seconds.">
                <button type="button" onClick={startRun} disabled={busy} className="text-sm font-medium px-3.5 py-1.5 rounded-lg hover:opacity-70 transition-opacity duration-200 disabled:opacity-50" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
                  Run analysis
                </button>
              </Tooltip>
            )}
          />
        ) : (
          <>
            {view === 'overview' && <Overview data={data} byId={byId} onOpenTool={setDetailId} runId={run?.id} />}
            {view === 'tools' && <ToolsView data={data} rules={rules} onOpenTool={setDetailId} />}
            {view === 'conventions' && <ConventionsView data={data} rules={rules} byId={byId} onOpenTool={setDetailId} />}
            {view === 'map' && (
              <Suspense fallback={<Skeleton className="h-[70vh]" label="Loading the map" />}>
                <DependencyMap data={data} onOpenTool={setDetailId} />
              </Suspense>
            )}
            {view === 'structure' && <StructureView data={data} />}
            {view === 'changes' && <ChangesView runs={runs} byId={byId} onOpenTool={setDetailId} />}
          </>
        )}
      </div>

      {detailId && byId[detailId] && (
        <ToolDetail key={detailId} tool={byId[detailId]} data={data} rules={rules} byId={byId} onOpenTool={setDetailId} onClose={() => setDetailId(null)} />
      )}

      <CodeMapTutorChat currentTool={view} onOpenTool={openGuideTarget} />
    </div>
  );
}
