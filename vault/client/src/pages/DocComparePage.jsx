import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ToolSidebar from '../components/ToolSidebar';
import { startDocCompareTour, TOUR_KEY as DOC_COMPARE_TOUR_KEY } from '../utils/tours/docCompareTour';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import Tooltip from '../components/Tooltip';
import { JobStart, JobBar, BackToJobs, stepIndex } from '../components/JobStart';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { useIcon } from '../providers/IconProvider';
import DocCompareTutorChat from './docCompare/DocCompareTutorChat';
import {
  DOC_COMPARE_TOOLS, DOC_COMPARE_GOALS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS,
  OPEN_TYPE, VIEW_TYPE, CONTEXT_TYPE,
} from './docCompare/docCompareTools.mjs';

/**
 * DocCompare, laid out like Graphics and Video Tools: the tool list on the left (ToolSidebar), the "What do you want to do?" job screen
 * (JobStart), and each tool in the main area. The tools themselves run in their own app (vault/doc-compare/, Vite + React + pdf.js), built into
 * dist/doc-compare-app/ and shown in a frame that stays loaded while you switch, so chosen files and results survive. The app reads and compares
 * both files inside the browser and calls no API; only the guide chat talks to the server, and it never sees the files.
 * Messages to and from the frame (same origin only): docCompareTools.mjs (VIEW_TYPE, OPEN_TYPE, CONTEXT_TYPE).
 */
const APP_URL = '/doc-compare-app/';
const TOOL_IDS = DOC_COMPARE_TOOLS.map((t) => t.id);
const KNOWN = new Set(GUIDE_TOOLS.map((t) => t.id));
const OPEN_ON_LAST_KEY = 'vault:doc-compare:openOnLast';
const LAST_TOOL_KEY = 'vault:doc-compare:lastTool';
const readLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const labelFor = (id) => DOC_COMPARE_TOOLS.find((t) => t.id === id)?.label || id;
// "Check a document" is the large panel above the jobs; the rest are the job cards
const CHECK_GOAL = DOC_COMPARE_GOALS.find((g) => g.id === 'check');
const OTHER_GOALS = DOC_COMPARE_GOALS.filter((g) => g.id !== 'check');

export default function DocComparePage() {
  const getIcon = useIcon();
  // 'checking' | 'ok' | 'missing': a failed doc-compare build must show a clear notice, not Vault's own page inside the frame
  const [state, setState] = useState('checking');
  const frameRef = useRef(null);
  const ready = useRef(false); // the app has said hello (its first context message), so messages to it are not lost
  const pendingFilter = useRef(null);
  const [openOnLast, setOpenOnLast] = useState(() => readLocal(OPEN_ON_LAST_KEY) === '1');
  // 'start' is the job screen (not a tool); every other value is a tool id from DOC_COMPARE_TOOLS
  const [tool, setTool] = useState(() => {
    const last = readLocal(LAST_TOOL_KEY);
    return readLocal(OPEN_ON_LAST_KEY) === '1' && TOOL_IDS.includes(last) ? last : 'start';
  });
  const [goal, setGoal] = useState(null);
  const [guideTool, setGuideTool] = useState('compare');
  const [app, setApp] = useState({ results: false, pdf: false });
  const info = useToolInfoModal('vault_doc_compare_info_seen');

  const post = useCallback((msg) => frameRef.current?.contentWindow?.postMessage(msg, window.location.origin), []);

  useEffect(() => { if (tool !== 'start') writeLocal(LAST_TOOL_KEY, tool); }, [tool]);
  const toggleOpenOnLast = (on) => { setOpenOnLast(on); writeLocal(OPEN_ON_LAST_KEY, on ? '1' : '0'); };

  // the tool list, a job step or Back: tell the app which view to show (with a job step's filter, once)
  const openTool = useCallback((id, filter = null) => { pendingFilter.current = filter; setTool(id); }, []);
  useEffect(() => {
    if (tool === 'start' || !ready.current) return;
    post({ type: VIEW_TYPE, view: tool, filter: pendingFilter.current || undefined });
    pendingFilter.current = null;
  }, [tool, post]);
  const stepTo = (id) => openTool(id, goal?.steps.find((s) => s.tool === id)?.filter || null);
  const startGoal = (g) => { setGoal(g); openTool(g.steps[0].tool, g.steps[0].filter || null); };
  const backToStart = () => { setGoal(null); setTool('start'); };

  // messages from the app: where the person is, whether there are results; follow the app when it changed view by itself
  const goalRef = useRef(goal); goalRef.current = goal;
  const toolRef = useRef(tool); toolRef.current = tool;
  const hadResults = useRef(false);
  useEffect(() => {
    const onMessage = (ev) => {
      if (ev.origin !== window.location.origin || ev.source !== frameRef.current?.contentWindow) return;
      const d = ev.data;
      if (!d || d.type !== CONTEXT_TYPE) return;
      if (!ready.current) {
        ready.current = true;
        if (toolRef.current !== 'start') post({ type: VIEW_TYPE, view: toolRef.current, filter: pendingFilter.current || undefined });
        pendingFilter.current = null;
      }
      if (typeof d.tool === 'string' && KNOWN.has(d.tool)) setGuideTool(d.tool);
      setApp({ results: !!d.results, pdf: !!d.pdf });
      if (d.cause === 'self' && TOOL_IDS.includes(d.view) && toolRef.current !== 'start') setTool(d.view);
      // once Compare has finished: a job moves on to its next step; without a job, the verdict comes first (addendum §6)
      const g = goalRef.current;
      if (d.results && !hadResults.current && g && toolRef.current === g.steps[0].tool && g.steps[1]) {
        pendingFilter.current = g.steps[1].filter || null;
        setTool(g.steps[1].tool);
      } else if (d.results && !hadResults.current && !g && toolRef.current === 'compare') {
        setTool('review');
      }
      hadResults.current = !!d.results;
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post]);

  // the guided tour: it switches tools the same way the list does ('start' = the job screen)
  const goTool = useCallback((id) => { if (id === 'start') { setGoal(null); setTool('start'); } else openTool(id); }, [openTool]);
  const startTour = useCallback(() => {
    info.close();
    try { localStorage.removeItem(DOC_COMPARE_TOUR_KEY); } catch { /* ignore */ }
    startDocCompareTour(goTool);
  }, [goTool, info]);
  // Settings -> DocCompare Tour opens /doc-compare?tour=1
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!params.get('tour') || state !== 'ok') return;
    const next = new URLSearchParams(params); next.delete('tour');
    setParams(next, { replace: true });
    setTimeout(startTour, 400);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // the guide's Open buttons: the (i) box and the tour are ours; everything else is shown by the app (it switches view itself and tells us)
  const openGuideTool = (id) => {
    if (id === 'info') { info.open(); return; }
    if (id === 'tour') { startTour(); return; }
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    if (!target) return;
    const wasStart = toolRef.current === 'start';
    setTool(target.tool);
    // from the job screen the frame is hidden: let it show before the app scrolls to the part
    setTimeout(() => post({ type: OPEN_TYPE, id }), wasStart ? 120 : 0);
  };

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

  const hintFor = (id) => {
    if (id === 'compare' || id === 'settings') return undefined;
    if (!app.results) return 'Compare two files first';
    if (id === 'pages' && !app.pdf) return 'PDF files only';
    return undefined;
  };
  const MENU = GROUPS.map((label) => ({
    label,
    tip: GROUP_TIPS[label],
    tools: DOC_COMPARE_TOOLS.filter((t) => t.group === label).map((t) => ({ ...t, tip: TOOL_TIPS[t.id], hint: hintFor(t.id) })),
  }));

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        <ToolSidebar
          title="DocCompare"
          icon="compare"
          groups={MENU}
          current={tool}
          onSelect={(id) => openTool(id)}
          onInfo={info.open}
          infoTip="How DocCompare works: what it checks, how to read the results, and what it cannot do."
          onTour={startTour}
          tourTip="Take the guided tour of DocCompare: the jobs, each tool, the review for the author and the guide."
        >
          <Tooltip text="Go back to the list of jobs (check nothing was left out, check numbers and dates, and so on).">
            <button
              type="button"
              onClick={backToStart}
              className="w-full flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: tool === 'start' ? 'var(--color-primary)' : 'var(--color-border)', color: tool === 'start' ? 'var(--color-primary)' : 'var(--color-text)', background: 'var(--color-bg)' }}
            >
              {getIcon('layout-grid', { size: 13 })}
              What do you want to do?
            </button>
          </Tooltip>
        </ToolSidebar>

        <main className="flex-1 min-w-0 flex flex-col p-6 gap-4" style={{ background: 'var(--color-bg)' }}>
          {tool === 'start' && (
            <div className="max-w-5xl space-y-6">
              <section className="rounded-2xl border p-6 flex flex-col sm:flex-row sm:items-center gap-4" data-tour="doc-compare-check" style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}>
                <div className="flex-1">
                  <h2 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                    <span style={{ color: 'var(--color-primary)' }}>{getIcon('shield', { size: 20 })}</span>
                    Is it ready to submit?
                  </h2>
                  <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                    Compare the LLM-edited version with your original. You get a verdict, and a card for each change that matters: restore it, accept it, or fix it later.
                  </p>
                  <div className="flex flex-wrap gap-4">
                    <Tooltip text="Documents you check draft after draft: open one and add its latest version as the next round.">
                      <button type="button" onClick={() => openTool('projects')} className="text-sm mt-2 underline transition-opacity hover:opacity-60" style={{ color: 'var(--color-primary)' }}>
                        Or open a project
                      </button>
                    </Tooltip>
                    <Tooltip text="Every one-off check you run is saved in this browser with its label. Find one, open it again, rename it or delete it.">
                      <button type="button" onClick={() => openTool('saved')} className="text-sm mt-2 underline transition-opacity hover:opacity-60" style={{ color: 'var(--color-primary)' }}>
                        Or open a saved check
                      </button>
                    </Tooltip>
                  </div>
                </div>
                <Tooltip text="Choose your original and the edited version, compare them, and see the verdict and the changes to decide.">
                  <button type="button" onClick={() => startGoal(CHECK_GOAL)} className="px-6 py-3 rounded-xl text-base font-semibold transition-opacity hover:opacity-80"
                    style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
                    Check a document
                  </button>
                </Tooltip>
              </section>
              <JobStart
                goals={OTHER_GOALS}
                intro="Pick a job and DocCompare walks you through it, or choose a tool on the left. Your files are compared in this browser and never leave your computer."
                onPick={startGoal}
                labelFor={labelFor}
                openOnLast={openOnLast}
                onToggleOpenOnLast={toggleOpenOnLast}
                appName="DocCompare"
                tourId="doc-compare-jobs"
              />
            </div>
          )}
          {tool !== 'start' && (
            <div className="space-y-3">
              <BackToJobs onBack={backToStart} toolLabel={labelFor(tool)} goal={stepIndex(goal, tool) >= 0 ? goal : null} />
              <JobBar goal={goal} mode={tool} onStep={stepTo} labelFor={labelFor} carry="go to" />
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS[tool]}</p>
            </div>
          )}
          {state === 'ok' && (
            // stays loaded (only hidden on the job screen) so chosen files and results survive switching tools
            <iframe
              ref={frameRef}
              src={`${APP_URL}?embedded=1`}
              title="DocCompare"
              data-tour="doc-compare-app"
              className="w-full border-0 flex-1 rounded-xl"
              style={{ display: tool === 'start' ? 'none' : 'block', minHeight: '70vh', background: 'var(--color-bg)' }}
            />
          )}
        </main>
      </div>

      {info.show && (
        <ToolInfoModal title="How DocCompare Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Compare an original document with the version an AI edited, and see everything that changed. Pick a job on the start screen or a tool in the list on the left; hover any tool for a plain explanation. Not sure where to start? Press the round button at the bottom right and tell the guide what you want to check.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      {state === 'ok' && <DocCompareTutorChat currentTool={tool === 'start' ? 'compare' : guideTool} onOpenTool={openGuideTool} />}
    </VoiceInputProvider>
  );
}
