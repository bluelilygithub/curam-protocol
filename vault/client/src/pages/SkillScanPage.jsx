import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { useIcon } from '../providers/IconProvider';
import Tooltip from '../components/Tooltip';
import ConfirmModal from '../components/ConfirmModal';
import ToolSidebar from '../components/ToolSidebar';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { JobStart, JobBar, BackToJobs, stepIndex } from '../components/JobStart';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { offerUndo } from '../utils/binUndo';
import { ExportButton } from './codeMap/shared';
import { startSkillScanTour, TOUR_KEY as SKILL_SCAN_TOUR_KEY } from '../utils/tours/skillScanTour';
import SkillScanTutorChat from './skillScan/SkillScanTutorChat';
import { SKILL_SCAN_GOALS } from './skillScan/skillScanGoals.mjs';
import { reportMarkdown, reportJson, exportName, READING_LABEL, ASSESSMENT_LABEL } from './skillScan/exportReport.mjs';
import { SKILL_SCAN_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS, GITHUB_URL_RE } from './skillScan/skillScanTools.mjs';

/**
 * Skill Scanner (admin), laid out like Graphics: the tool list on the left (ToolSidebar), "What do you want to do?" job tiles and the
 * latest scans on the start screen, and one tool at a time in the main area. Scans run in the background (POST /api/skill-scan/scans,
 * poll /jobs/:id); after each, AI explains the findings in context (services/skillScan/summary.js). See docs/skill-scan.md.
 */

// Status colours are deliberately outside the theme (see client/DESIGN.md).
const SEVERITY = {
  CRITICAL: { label: 'Critical', color: '#b91c1c' },
  HIGH: { label: 'High', color: '#ef4444' },
  MEDIUM: { label: 'Medium', color: '#f59e0b' },
  LOW: { label: 'Low', color: '#64748b' },
};
const VERDICT = {
  SAFE: { label: 'Safe', color: '#16a34a', tip: 'No known risky pattern was found. Not a guarantee: read what the skill asks for.' },
  CAUTION: { label: 'Caution', color: '#f59e0b', tip: 'Some risk found, or the scan could not read everything. Read the findings before installing.' },
  DO_NOT_INSTALL: { label: 'Do not install', color: '#ef4444', tip: 'Score 51 or more. The score adds points per finding and stops at 100, so read the explanation: routine findings add up too.' },
};
const READING_COLOR = { likely_fine: '#16a34a', review_first: '#f59e0b', do_not_install: '#ef4444' };
const ASSESSMENT_COLOR = { expected: '#16a34a', check: '#f59e0b', concerning: '#ef4444' };
const SEV_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const OPEN_ON_LAST_KEY = 'vault:skill-scan:openOnLast';
const LAST_TOOL_KEY = 'vault:skill-scan:lastTool';
const readLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const TOOL_IDS = SKILL_SCAN_TOOLS.map((t) => t.id);
const labelFor = (id) => SKILL_SCAN_TOOLS.find((t) => t.id === id)?.label || id;
const dateOf = (v) => (v ? new Date(v).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

async function json(res, fallback = 'That request did not work.') {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

function Pill({ label, color, tip, small }) {
  const el = <span className={`${small ? 'text-[11px]' : 'text-sm font-semibold'} px-2 py-0.5 rounded-full border whitespace-nowrap`} style={{ color, borderColor: color }}>{label}</span>;
  return tip ? <Tooltip text={tip}>{el}</Tooltip> : el;
}

function VerdictPill({ recommendation, status, small }) {
  if (status === 'running') return <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Running…</span>;
  if (status === 'failed') return <Pill label="Failed" color="#ef4444" small={small} />;
  const v = VERDICT[recommendation];
  return v ? <Pill label={v.label} color={v.color} tip={v.tip} small={small} /> : null;
}

function Issue({ issue }) {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY[issue.severity] || SEVERITY.LOW;
  return (
    <div className="rounded-lg border-l-4 border p-3 space-y-1" style={{ borderColor: 'var(--color-border)', borderLeftColor: sev.color, background: 'var(--color-bg)' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full text-left flex flex-wrap items-center gap-2" aria-expanded={open}>
        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ color: '#fff', background: sev.color }}>{sev.label}</span>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{issue.pattern || issue.category || issue.id}</span>
        <span className="text-xs break-all" style={{ color: 'var(--color-muted)' }}>{issue.id}{issue.file ? ` · ${issue.file}${issue.line ? `:${issue.line}` : ''}` : ''}{issue.occurrences > 1 ? ` · ${issue.occurrences} places` : ''}</span>
      </button>
      {open && (
        <div className="space-y-2 pt-1 text-sm" style={{ color: 'var(--color-text)' }}>
          {issue.explanation && <p>{issue.explanation}</p>}
          {issue.snippet && <pre className="text-xs p-2 rounded overflow-x-auto whitespace-pre-wrap break-all" style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>{issue.snippet}</pre>}
          {issue.remediation && <p className="text-xs"><strong>Fix:</strong> {issue.remediation}</p>}
          {issue.category && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Category: {issue.category}{issue.confidence != null ? ` · confidence ${Math.round(issue.confidence * 100)}%` : ''}</p>}
        </div>
      )}
    </div>
  );
}

const PHASE_LABEL = { queued: 'Starting', download: 'Downloading from GitHub', unpack: 'Unpacking', scan: 'Scanning', summary: 'Writing the explanation' };
const minutes = (sec) => (sec == null ? null : sec < 60 ? 'under a minute' : `about ${Math.round(sec / 60)} min`);
const dollars = (usd) => (usd == null ? null : usd < 0.01 ? 'under US$0.01' : `about US$${usd < 10 ? usd.toFixed(2) : Math.round(usd)}`);

/**
 * Where a running scan is. The scanning stage is a true count ("Skill 12 of 68") from SkillSpector's own "[i/N] Scanning" lines, with time
 * left from the skills finished so far; before the first skill it uses the estimate from earlier scans (estimateSec) when there is one.
 * A folder with a single skill prints no count, so that bar follows the estimate (never past 95%) or just shows elapsed time.
 */
function ScanProgress({ job }) {
  const p = job?.progress || {};
  const elapsed = job?.elapsedSec || 0;
  let pct = 2;
  if (p.phase === 'download') pct = 3;
  else if (p.phase === 'unpack') pct = 6;
  else if (p.phase === 'scan') {
    if (p.total && p.current) pct = 8 + 86 * ((p.current - 1) / p.total);
    else if (p.estimateSec) pct = 8 + 86 * Math.min(0.95, elapsed / p.estimateSec);
    else pct = 8;
  } else if (p.phase === 'summary') pct = 96;
  const where = p.phase === 'scan' && p.current ? `Skill ${p.current} of ${p.total}${p.module ? `: ${p.module}` : ''}`
    : p.phase === 'scan' && p.total > 1 ? `${p.total} skills found` : PHASE_LABEL[p.phase] || 'Working';
  const timeText = p.phase === 'summary' ? 'nearly done'
    : p.etaSec != null ? `${minutes(p.etaSec)} left`
      : p.estimateSec ? `estimated ${minutes(p.estimateSec)} (from your earlier scans)`
        : p.phase === 'scan' ? 'no estimate yet (it learns from each scan)' : '';
  const cost = p.estimateCost != null ? `tokens ${dollars(p.estimateCost)} (estimate)` : p.costFloor != null ? `tokens at least ${dollars(p.costFloor)} (first deep scan)` : '';
  return (
    <div className="space-y-1.5" role="status" aria-live="polite">
      <div className="flex flex-wrap justify-between gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
        <span className="min-w-0 truncate">{p.phase === 'scan' ? 'Scanning · ' : ''}{where}</span>
        <span style={{ color: 'var(--color-muted)' }}>{elapsed}s{timeText ? ` · ${timeText}` : ''}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
        <div className="h-full transition-all duration-500" style={{ width: `${Math.round(pct)}%`, background: 'var(--color-primary)' }} />
      </div>
      {p.phase === 'scan' && (p.files || p.timeoutMin) && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{[p.files ? `${p.files} files` : '', cost, p.timeoutMin ? `stops after ${p.timeoutMin} min if not finished` : ''].filter(Boolean).join(' · ')}</p>
      )}
    </div>
  );
}

/** One row per rule: severity, count, where, and the explanation's judgment of it. */
function RuleGroup({ group, assessed }) {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY[group.severity] || SEVERITY.LOW;
  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full text-left flex flex-wrap items-center gap-2" aria-expanded={open}>
        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ color: '#fff', background: sev.color }}>{sev.label}</span>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{group.title}</span>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{group.id} · {group.count} finding{group.count === 1 ? '' : 's'} in {group.fileCount} file{group.fileCount === 1 ? '' : 's'}{group.skillCount ? ` · ${group.skillCount} skill${group.skillCount === 1 ? '' : 's'}` : ''}</span>
        {assessed && <Pill small label={ASSESSMENT_LABEL[assessed.assessment]} color={ASSESSMENT_COLOR[assessed.assessment]} />}
      </button>
      {assessed?.explanation && <p className="text-sm" style={{ color: 'var(--color-text)' }}>{assessed.explanation}</p>}
      {open && (
        <div className="space-y-2">
          {group.samples?.map((s, i) => (
            <div key={i} className="text-xs space-y-1">
              <p style={{ color: 'var(--color-muted)' }} className="break-all">{s.file}{s.line ? `:${s.line}` : ''}{s.explanation ? ` — ${s.explanation}` : ''}</p>
              {s.snippet && <pre className="p-2 rounded whitespace-pre-wrap break-all" style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>{s.snippet}</pre>}
            </div>
          ))}
          {group.skills?.length > 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Skills: {group.skills.join(', ')}</p>}
        </div>
      )}
    </div>
  );
}

export default function SkillScanPage() {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const info = useToolInfoModal('vault_skill_scan_info_seen');
  const [params, setParams] = useSearchParams();

  const [config, setConfig] = useState(null);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [scans, setScans] = useState(null);
  const [scan, setScan] = useState(null);
  const [explaining, setExplaining] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [openOnLast, setOpenOnLast] = useState(() => readLocal(OPEN_ON_LAST_KEY) === '1');
  // 'start' is the job-tile screen (not a tool); every other value is a tool id from SKILL_SCAN_TOOLS
  const [tool, setTool] = useState(() => {
    const last = readLocal(LAST_TOOL_KEY);
    return readLocal(OPEN_ON_LAST_KEY) === '1' && TOOL_IDS.includes(last) && last !== 'report' ? last : 'start';
  });
  const [goal, setGoal] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => { if (tool !== 'start') writeLocal(LAST_TOOL_KEY, tool); }, [tool]);
  useEffect(() => { if (tool === 'deep' && config?.deepAvailable) setDeep(true); }, [tool, config]);
  const toggleOpenOnLast = (on) => { setOpenOnLast(on); writeLocal(OPEN_ON_LAST_KEY, on ? '1' : '0'); };

  const loadList = useCallback(() => api.get('/api/skill-scan/scans').then((r) => json(r)).then((d) => setScans(d.scans || [])).catch((err) => { setScans([]); addToast(err.message, 'error'); }), [addToast]);
  const openScan = useCallback(async (id) => {
    try {
      const d = await json(await api.get(`/api/skill-scan/scans/${id}`));
      setScan(d.scan);
      setShowAll(false);
      setTool('report');
    } catch (err) { addToast(err.message, 'error'); }
  }, [addToast]);

  useEffect(() => {
    if (!isAdmin) return;
    api.get('/api/skill-scan/config').then((r) => json(r)).then(setConfig).catch(() => setConfig({ installed: false, deepAvailable: false }));
    loadList();
  }, [isAdmin, loadList]);
  useEffect(() => { const id = params.get('scan'); if (isAdmin && id && /^\d+$/.test(id)) openScan(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll the background job every 2.5s, like Business Profiler and Video Tools.
  useEffect(() => {
    if (!jobId) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const d = await json(await api.get(`/api/skill-scan/jobs/${encodeURIComponent(jobId)}`));
        if (!active) return;
        setJob(d.job);
        if (d.job.status === 'done' || d.job.status === 'error') {
          setJobId(null);
          setBusy(false);
          await loadList();
          if (d.job.status === 'error') addToast(d.job.error || 'The scan failed.', 'error');
          if (d.job.result?.scanId) openScan(d.job.result.scanId);
        }
      } catch (err) { if (active) { setJobId(null); setBusy(false); addToast(err.message, 'error'); } }
    };
    poll();
    const t = setInterval(poll, 2500);
    return () => { active = false; clearInterval(t); };
  }, [jobId, loadList, openScan, addToast]);

  const startGoal = (g) => { setGoal(g); setTool(g.steps[0].tool); };
  const backToStart = () => { setGoal(null); setTool('start'); };
  const goTool = useCallback((id) => { if (id === 'start') { setGoal(null); setTool('start'); } else setTool(id); }, []);
  const startTour = useCallback(() => {
    info.close();
    try { localStorage.removeItem(SKILL_SCAN_TOUR_KEY); } catch (_) { /* ignore */ }
    startSkillScanTour(goTool);
  }, [goTool, info]);
  useEffect(() => {
    if (!params.get('tour')) return;
    const next = new URLSearchParams(params); next.delete('tour');
    setParams(next, { replace: true });
    setTimeout(startTour, 300);
  }, [params, setParams, startTour]);

  const menu = useMemo(() => GROUPS.map((label) => ({
    label, tip: GROUP_TIPS[label],
    tools: SKILL_SCAN_TOOLS.filter((t) => t.group === label).map((t) => ({
      ...t, tip: TOOL_TIPS[t.id],
      hint: t.id === 'report' && !scan ? 'Open a scan first' : t.id === 'deep' && config && !config.deepAvailable ? 'Not available here' : undefined,
    })),
  })), [scan, config]);

  if (!isAdmin) return <Navigate to="/" replace />;

  const urlOk = !url.trim() || GITHUB_URL_RE.test(url.trim());
  const canScan = config?.installed && !busy && !jobId && (file || (url.trim() && urlOk));
  const scanNow = async () => {
    if (!canScan) return;
    setBusy(true);
    try {
      const form = new FormData();
      if (file) form.append('file', file); else form.append('url', url.trim());
      form.append('deep', String(!!deep));
      const d = await json(await api.postForm('/api/skill-scan/scans', form), 'The scan could not be started.');
      setJobId(d.jobId);
      setJob({ status: 'running', label: 'Starting the scan', elapsedSec: 0 });
      loadList();
    } catch (err) { setBusy(false); addToast(err.message, 'error'); }
  };
  const explain = async () => {
    if (!scan) return;
    setExplaining(true);
    try {
      const d = await json(await api.post(`/api/skill-scan/scans/${scan.id}/summary`), 'The explanation could not be written.');
      setScan((s) => ({ ...s, summary: d.summary }));
    } catch (err) { addToast(err.message, 'error'); }
    finally { setExplaining(false); }
  };
  const remove = (s) => setConfirmDelete(s);
  const reallyRemove = async (s) => {
    setConfirmDelete(null);
    try {
      const d = await json(await api.delete(`/api/skill-scan/scans/${s.id}`));
      setScans((list) => (list || []).filter((x) => x.id !== s.id));
      if (scan?.id === s.id) setScan(null);
      offerUndo({ message: 'Scan moved to the recycle bin.', binIds: d.binId, after: loadList });
    } catch (err) { addToast(err.message, 'error'); }
  };
  const openGuideTool = (id) => { const t = GUIDE_TOOLS.find((g) => g.id === id); if (t) setTool(t.tool); };

  const button = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40';
  const panel = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
  const muted = { color: 'var(--color-muted)' };
  const report = scan?.report;
  const summary = scan?.summary;
  const assessedById = Object.fromEntries((summary?.groups || []).map((g) => [g.id, g]));
  const running = job && (jobId || job.status === 'running');

  const notInstalled = config && !config.installed && (
    <div className="rounded-xl border p-3 text-sm" style={{ borderColor: '#f59e0b', color: 'var(--color-text)' }}>
      SkillSpector is not installed on this server yet. It arrives with the next base image (built on GitHub after a change to Dockerfile.base), then the following deploy.
    </div>
  );

  const scanRow = (s) => (
    <div key={s.id} className="rounded-xl border p-3 flex flex-wrap items-center justify-between gap-3" style={{ ...panel, borderColor: scan?.id === s.id ? 'var(--color-primary)' : 'var(--color-border)' }}>
      <div className="min-w-0">
        <p className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{s.fileName || s.source}</p>
        <p className="text-xs" style={muted}>{dateOf(s.createdAt)} · {s.mode}{s.skillCount ? ` · ${s.skillCount} skill${s.skillCount === 1 ? '' : 's'}` : ''}{s.durationMs ? ` · took ${minutes(s.durationMs / 1000)}` : ''}{s.costUsd != null ? ` · tokens ${dollars(s.costUsd)}` : ''}{s.score != null ? ` · score ${s.score}` : ''}{s.issueCount != null ? ` · ${s.issueCount} findings` : ''}</p>
      </div>
      <div className="flex items-center gap-2">
        <VerdictPill recommendation={s.recommendation} status={s.status} small />
        <Tooltip text="Open this scan's report."><button type="button" className={button} disabled={s.status === 'running'} onClick={() => openScan(s.id)} style={{ border: '1px solid var(--color-border)', color: 'var(--color-primary)' }}>Open</button></Tooltip>
        <Tooltip text="Move this scan to the recycle bin (30 days, with Undo)."><button type="button" aria-label="Delete this scan" disabled={s.status === 'running'} onClick={() => remove(s)} className="p-1.5 rounded-lg hover:opacity-70 disabled:opacity-40" style={{ color: '#ef4444' }}>{getIcon('trash', { size: 14 })}</button></Tooltip>
      </div>
    </div>
  );

  // ── tools ──────────────────────────────────────────────────────────────
  const scanTool = (
    <section className="rounded-2xl border p-5 space-y-3" style={panel} data-tour="skill-scan-scan">
      {notInstalled}
      <Tooltip text={TOOL_TIPS.scan}>
        <div><VoiceInput value={url} onChange={(v) => { setUrl(v); if (v) setFile(null); }} label="GitHub link" placeholder="https://github.com/owner/repo  (or a /tree/main/folder link)" mic /></div>
      </Tooltip>
      {!urlOk && <p className="text-xs" style={{ color: '#ef4444' }}>Only public github.com links, e.g. https://github.com/owner/repo or https://github.com/owner/repo/tree/main/skills/my-skill.</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm" style={muted}>
        <span>or</span>
        <Tooltip text={`Upload a zip of the skill or plugin folder (up to ${config?.maxZipMb || 20} MB). Use this for a plugin on your own computer.`}>
          <button type="button" className={button} onClick={() => fileRef.current?.click()} style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            {getIcon('upload', { size: 14 })} {file ? file.name : 'Upload a zip'}
          </button>
        </Tooltip>
        <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" aria-label="Zip of the skill or plugin"
          onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); if (f) setUrl(''); e.target.value = ''; }} />
        {file && <Tooltip text="Remove the uploaded zip."><button type="button" className="underline text-xs" onClick={() => setFile(null)} style={{ color: 'var(--color-primary)' }}>remove</button></Tooltip>}
      </div>
      <p className="text-xs" style={muted}>Every scan goes skill by skill (up to 100 skills), with a verdict for each. A single skill is scanned as itself. Big collections take a few minutes; the progress bar shows which skill it is on.</p>
      <div className="flex flex-wrap gap-4 text-sm" style={{ color: 'var(--color-text)' }}>
        <Tooltip text={config?.deepAvailable ? TOOL_TIPS.deep : (config?.deepReason || TOOL_TIPS.deep)}>
          <label className="flex items-center gap-2 cursor-pointer" style={{ opacity: config?.deepAvailable ? 1 : 0.5 }}>
            <input type="checkbox" checked={deep} disabled={!config?.deepAvailable} onChange={(e) => setDeep(e.target.checked)} /> Deep scan (AI{config?.model ? `: ${config.model}` : ''})
          </label>
        </Tooltip>
      </div>
      {deep && <p className="text-xs" style={{ color: '#f59e0b' }}>A deep scan sends the skill’s files to Anthropic and costs a little. It can take up to about 20 minutes.</p>}
      <p className="text-xs" style={config?.model && !config.modelIsAnthropic ? { color: '#f59e0b' } : muted}>After the scan, {config?.model || 'AI'} explains the findings in context; that sends the findings (with short code examples) to its provider.{config?.model && !config.modelIsAnthropic ? ' An Anthropic (Claude) model is recommended for this job: choose one under Settings → AI & Chat → Skill Scanner model.' : ''}</p>
      <Tooltip text="Start the scan. It runs in the background; the report opens when it finishes.">
        <button type="button" className={button} disabled={!canScan} onClick={scanNow} style={{ background: 'var(--color-primary)', color: '#fff' }}>
          {getIcon('shield', { size: 14 })} {busy || jobId ? 'Scanning…' : 'Scan'}
        </button>
      </Tooltip>
      {running && <ScanProgress job={job} />}
    </section>
  );

  const reportTool = !scan ? (
    <section className="rounded-2xl border p-6 space-y-3" style={panel} data-tour="skill-scan-report">
      <p className="text-sm" style={{ color: 'var(--color-text)' }}>Open a scan first: run one, or pick one from Saved scans.</p>
      <div className="flex gap-2">
        <button type="button" className={button} onClick={() => setTool('scan')} style={{ background: 'var(--color-primary)', color: '#fff' }}>{getIcon('shield', { size: 14 })} Scan a skill</button>
        <button type="button" className={button} onClick={() => setTool('history')} style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{getIcon('list', { size: 14 })} Saved scans</button>
      </div>
    </section>
  ) : (
    <div className="space-y-4" data-tour="skill-scan-report">
      <section className="rounded-2xl border p-5 space-y-3" style={panel}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <VerdictPill recommendation={scan.recommendation} status={scan.status} />
            {scan.score != null && <span className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{scan.score}<span className="text-sm" style={muted}>/100</span></span>}
            {summary && <Pill label={`AI reading: ${READING_LABEL[summary.reading]}`} color={READING_COLOR[summary.reading]} tip={summary.readingReason || 'AI’s reading of the findings in context, shown next to SkillSpector’s verdict.'} />}
          </div>
          {report && (
            <div className="flex flex-wrap gap-2">
              <ExportButton kind="copy" label="Copy" what="Report" tip="Copy the whole report as Markdown, for a note or a message." getText={() => reportMarkdown(scan)} />
              <ExportButton kind="download" label=".md" tip="Download the report as a Markdown file." name={`${exportName(scan)}.md`} getText={() => reportMarkdown(scan)} />
              <ExportButton kind="download" label=".json" tip="Download everything Vault saved for this scan as JSON." name={`${exportName(scan)}.json`} type="application/json" getText={() => reportJson(scan)} />
            </div>
          )}
        </div>
        <p className="text-sm break-all" style={{ color: 'var(--color-text)' }}>{scan.fileName || scan.source}{scan.sourceType === 'github' && <> · <a href={scan.source} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--color-primary)' }}>open on GitHub</a></>}</p>
        <p className="text-xs" style={muted}>{scan.mode === 'deep' ? `Deep scan (${scan.model || 'AI'})` : 'Static scan'}{scan.recursive ? ', skill by skill' : ', one bundle (an older scan)'}{scan.skillCount ? ` · ${scan.skillCount} skills` : ''}{scan.durationMs ? ` · took ${minutes(scan.durationMs / 1000)}` : ''}{scan.costUsd != null ? ` · tokens ${dollars(scan.costUsd)}` : ''} · {dateOf(scan.finishedAt || scan.createdAt)}{report?.version ? ` · SkillSpector ${report.version}` : ''}</p>
        {scan.status === 'failed' && <p className="text-sm" style={{ color: '#ef4444' }}>{scan.error}</p>}
        {report && (
          <div className="flex flex-wrap gap-2">
            {SEV_ORDER.map((s) => <span key={s} className="text-xs px-2 py-1 rounded-lg border" style={{ borderColor: SEVERITY[s].color, color: SEVERITY[s].color }}>{SEVERITY[s].label}: {report.counts?.[s] || 0}</span>)}
            {report.multi && <span className="text-xs px-2 py-1" style={muted}>{report.skillCount} skills{report.skillsOmitted ? ` (${report.skillsOmitted} not shown)` : ''}</span>}
          </div>
        )}
        {report?.leftOutFiles > 0 && <p className="text-xs" style={muted}>{report.leftOutFiles} files outside the skill folders (such as the README and tests) were not scanned, because each skill is scanned on its own.</p>}
        {report?.complete === false && <p className="text-xs" style={{ color: '#f59e0b' }}>The scan could not read everything{!scan.recursive ? '; scanning each skill separately usually reads more' : ''}. A Safe result is shown as Caution.</p>}
      </section>

      {report && (
        <section className="rounded-2xl border p-5 space-y-3" style={panel}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>{getIcon('file-text', { size: 15 })} What the findings mean</h3>
            <Tooltip text={`Write the explanation again from this scan's findings. One AI call with ${config?.model || 'the model chosen in Settings'}; the findings are sent to its provider.`}>
              <button type="button" className={button} disabled={explaining} onClick={explain} style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                {getIcon('refresh-cw', { size: 13 })} {explaining ? 'Writing…' : summary ? 'Regenerate' : 'Explain the findings'}
              </button>
            </Tooltip>
          </div>
          {summary ? (
            <>
              {summary.overview.split(/\n\s*\n/).map((p, i) => <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{p}</p>)}
              {summary.nextSteps?.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-1" style={muted}>What to do next</p>
                  <ul className="list-disc pl-5 space-y-0.5">{summary.nextSteps.map((n, i) => <li key={i} className="text-sm" style={{ color: 'var(--color-text)' }}>{n}</li>)}</ul>
                </div>
              )}
              <p className="text-xs" style={muted}>Written by AI ({summary.model}) on {dateOf(summary.generatedAt)} from the findings only. SkillSpector’s verdict above is unchanged. Text inside a skill can be written to mislead an AI, so the findings below stay the record.</p>
            </>
          ) : (
            <p className="text-sm" style={muted}>No explanation yet. Press Explain the findings to have AI say which findings are normal for what this skill does and which need a look.</p>
          )}
        </section>
      )}

      {scan.groups?.length > 0 && (
        <section className="rounded-2xl border p-5 space-y-2" style={panel}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Findings by rule ({scan.groups.length})</h3>
          <p className="text-xs" style={muted}>Click a rule for examples. The marks come from the explanation above.</p>
          {scan.groups.map((g) => <RuleGroup key={g.id} group={g} assessed={assessedById[g.id]} />)}
        </section>
      )}

      {report && (
        <section className="rounded-2xl border p-5 space-y-2" style={panel}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>All findings ({report.issueCount})</h3>
            <Tooltip text="Show or hide every individual finding.">
              <button type="button" className="text-xs underline" onClick={() => setShowAll((v) => !v)} style={{ color: 'var(--color-primary)' }}>{showAll ? 'Hide' : 'Show'}</button>
            </Tooltip>
          </div>
          {showAll && report.skills.map((sk, n) => (
            <div key={`${sk.name}-${n}`} className="space-y-2">
              {report.multi && (
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{sk.name}</h4>
                  {sk.error ? <span className="text-xs" style={{ color: '#ef4444' }}>Could not scan: {sk.error}</span> : <VerdictPill recommendation={sk.recommendation} small />}
                  {sk.score != null && <span className="text-xs" style={muted}>score {sk.score}/100 · {sk.issues.length} findings</span>}
                </div>
              )}
              {!sk.error && sk.complete === false && <p className="text-xs" style={{ color: '#f59e0b' }}>Not everything could be read{sk.coverage != null ? ` (${sk.coverage}% covered)` : ''}{sk.limitations?.length ? `: ${sk.limitations.join('; ')}` : '.'}</p>}
              {sk.llm?.requested && (sk.llm.degraded || sk.llm.available === false) && <p className="text-xs" style={{ color: '#f59e0b' }}>The AI part of the deep scan did not complete{sk.llm.error ? `: ${sk.llm.error}` : ''}.</p>}
              {[...(sk.issues || [])].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)).map((i, k) => <Issue key={`${i.id}-${k}`} issue={i} />)}
            </div>
          ))}
          <p className="text-xs" style={muted}>A Safe verdict means SkillSpector found no known risky pattern, not that the skill is harmless.</p>
        </section>
      )}
    </div>
  );

  const historyTool = (
    <section className="space-y-2" data-tour="skill-scan-history">
      {scans === null && <p className="text-sm" style={muted}>Loading…</p>}
      {scans?.length === 0 && <p className="text-sm" style={muted}>No scans yet.</p>}
      {scans?.map(scanRow)}
    </section>
  );

  const TOOLS = { scan: scanTool, deep: scanTool, report: reportTool, history: historyTool };

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        <ToolSidebar
          title="Skill Scanner"
          icon="shield-check"
          groups={menu}
          current={tool}
          onSelect={(id) => setTool(id)}
          onInfo={info.open}
          infoTip="How Skill Scanner works: what it checks, why a score of 100 is not always as bad as it looks, and what it cannot do."
          onTour={startTour}
          tourTip="Take the guided tour of Skill Scanner."
        >
          <Tooltip text="Go back to the job tiles (check from GitHub, check a plugin on my computer, get a deeper check, keep or share a report).">
            <button type="button" onClick={backToStart}
              className="w-full flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: tool === 'start' ? 'var(--color-primary)' : 'var(--color-border)', color: tool === 'start' ? 'var(--color-primary)' : 'var(--color-text)', background: 'var(--color-bg)' }}>
              {getIcon('layout-grid', { size: 13 })}
              What do you want to do?
            </button>
          </Tooltip>
        </ToolSidebar>

        <main className="flex-1 min-w-0 overflow-y-auto p-6 space-y-4 max-w-5xl" style={{ background: 'var(--color-bg)' }}>
          {tool === 'start' && (
            <>
              {notInstalled}
              <JobStart
                goals={SKILL_SCAN_GOALS}
                appName="Skill Scanner"
                tourId="skill-scan-jobs"
                intro="Check an AI agent skill or plugin for security risks before you install it. Pick a job, choose a tool on the left, or ask the guide (round button, bottom right)."
                onPick={startGoal}
                labelFor={labelFor}
                openOnLast={openOnLast}
                onToggleOpenOnLast={toggleOpenOnLast}
              />
              {scans?.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Latest scans</h2>
                    {scans.length > 5 && <button type="button" onClick={() => setTool('history')} className="text-sm underline" style={{ color: 'var(--color-primary)' }}>All {scans.length} scans</button>}
                  </div>
                  {scans.slice(0, 5).map(scanRow)}
                </section>
              )}
              {running && <ScanProgress job={job} />}
            </>
          )}
          {tool !== 'start' && (
            <div className="space-y-3">
              <BackToJobs onBack={backToStart} toolLabel={labelFor(tool)} goal={stepIndex(goal, tool) >= 0 ? goal : null} />
              <JobBar goal={goal} mode={tool} onStep={(id) => setTool(id)} labelFor={labelFor} carry="go to" />
              <p className="text-sm" style={muted}>{TOOL_BLURBS[tool]}</p>
            </div>
          )}
          {tool !== 'start' && TOOLS[tool]}
        </main>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Delete this scan?"
          message={`The scan of ${confirmDelete.fileName || confirmDelete.source} moves to the recycle bin, where you can restore it for 30 days.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => reallyRemove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {info.show && (
        <ToolInfoModal title="How Skill Scanner works" onClose={info.close}>
          {HOW_IT_WORKS.map(([title, body]) => (
            <div key={title}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
              <p className="text-sm leading-relaxed" style={muted}>{body}</p>
            </div>
          ))}
        </ToolInfoModal>
      )}

      <SkillScanTutorChat currentTool={tool === 'start' ? 'scan' : tool} onOpenTool={openGuideTool} />
    </VoiceInputProvider>
  );
}
