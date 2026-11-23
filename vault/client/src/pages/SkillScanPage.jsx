import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { useIcon } from '../providers/IconProvider';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { offerUndo } from '../utils/binUndo';
import { startSkillScanTour, TOUR_KEY as SKILL_SCAN_TOUR_KEY } from '../utils/tours/skillScanTour';
import SkillScanTutorChat from './skillScan/SkillScanTutorChat';
import { HOW_IT_WORKS, TOOL_TIPS, GUIDE_TOOLS, GITHUB_URL_RE } from './skillScan/skillScanTools.mjs';

/**
 * Skill Scanner (admin): check an AI agent skill or plugin with NVIDIA SkillSpector before installing it. A public github.com link or a
 * zip in; a verdict, score and findings out. Scans run in the background (POST /api/skill-scan/scans, poll /jobs/:id). See docs/skill-scan.md.
 */

const SEVERITY = {
  CRITICAL: { label: 'Critical', color: '#b91c1c' },
  HIGH: { label: 'High', color: '#ef4444' },
  MEDIUM: { label: 'Medium', color: '#f59e0b' },
  LOW: { label: 'Low', color: '#64748b' },
};
// Status colours are deliberately outside the theme (see client/DESIGN.md).
const VERDICT = {
  SAFE: { label: 'Safe', color: '#16a34a', tip: 'No known risky pattern was found. Not a guarantee: read what the skill asks for.' },
  CAUTION: { label: 'Caution', color: '#f59e0b', tip: 'Some risk found, or the scan could not read everything. Read the findings before installing.' },
  DO_NOT_INSTALL: { label: 'Do not install', color: '#ef4444', tip: 'Serious risks found (score 51 or more).' },
};
const dateOf = (v) => (v ? new Date(v).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const SEV_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

async function json(res, fallback = 'That request did not work.') {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

function VerdictPill({ recommendation, status, small }) {
  if (status === 'running') return <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Running…</span>;
  if (status === 'failed') return <span className={`${small ? 'text-[11px]' : 'text-xs'} px-2 py-0.5 rounded-full border`} style={{ color: '#ef4444', borderColor: '#ef4444' }}>Failed</span>;
  const v = VERDICT[recommendation];
  if (!v) return null;
  return (
    <Tooltip text={v.tip}>
      <span className={`${small ? 'text-[11px]' : 'text-sm font-semibold'} px-2 py-0.5 rounded-full border`} style={{ color: v.color, borderColor: v.color }}>{v.label}</span>
    </Tooltip>
  );
}

function Issue({ issue }) {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY[issue.severity] || SEVERITY.LOW;
  return (
    <div className="rounded-lg border-l-4 border p-3 space-y-1" style={{ borderColor: 'var(--color-border)', borderLeftColor: sev.color, background: 'var(--color-bg)' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full text-left flex flex-wrap items-center gap-2" aria-expanded={open}>
        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ color: '#fff', background: sev.color }}>{sev.label}</span>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{issue.pattern || issue.category || issue.id}</span>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{issue.id}{issue.file ? ` · ${issue.file}${issue.line ? `:${issue.line}` : ''}` : ''}{issue.occurrences > 1 ? ` · ${issue.occurrences} places` : ''}</span>
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

function SkillSection({ skill, multi }) {
  const issues = [...(skill.issues || [])].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  return (
    <div className="space-y-2">
      {multi && (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{skill.name}</h4>
          {skill.error ? <span className="text-xs" style={{ color: '#ef4444' }}>Could not scan: {skill.error}</span> : <VerdictPill recommendation={skill.recommendation} small />}
          {skill.score != null && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>score {skill.score}/100 · {skill.issues.length} findings</span>}
        </div>
      )}
      {!skill.error && skill.complete === false && (
        <p className="text-xs" style={{ color: '#f59e0b' }}>Not everything could be read{skill.coverage != null ? ` (${skill.coverage}% covered)` : ''}{skill.limitations?.length ? `: ${skill.limitations.join('; ')}` : '.'}</p>
      )}
      {skill.llm?.requested && (skill.llm.degraded || skill.llm.available === false) && (
        <p className="text-xs" style={{ color: '#f59e0b' }}>The AI part of the deep scan did not complete{skill.llm.error ? `: ${skill.llm.error}` : ''}. The static findings below still stand.</p>
      )}
      {!skill.error && !issues.length && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No findings.</p>}
      {issues.map((i, n) => <Issue key={`${i.id}-${n}`} issue={i} />)}
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
  const [recursive, setRecursive] = useState(false);
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [scans, setScans] = useState(null);
  const [scan, setScan] = useState(null);
  const [currentTool, setCurrentTool] = useState('scan');
  const fileRef = useRef(null);

  const loadList = useCallback(() => api.get('/api/skill-scan/scans').then((r) => json(r)).then((d) => setScans(d.scans || [])).catch((err) => { setScans([]); addToast(err.message, 'error'); }), [addToast]);
  const openScan = useCallback(async (id) => {
    try {
      const d = await json(await api.get(`/api/skill-scan/scans/${id}`));
      setScan(d.scan);
      setCurrentTool('report');
      setTimeout(() => document.querySelector('[data-tour="skill-scan-report"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
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

  const startTour = useCallback(() => {
    info.close();
    try { localStorage.removeItem(SKILL_SCAN_TOUR_KEY); } catch (_) { /* ignore */ }
    startSkillScanTour((tool) => setCurrentTool(tool));
  }, [info]);
  useEffect(() => {
    if (!params.get('tour')) return;
    const next = new URLSearchParams(params); next.delete('tour');
    setParams(next, { replace: true });
    setTimeout(startTour, 300);
  }, [params, setParams, startTour]);

  if (!isAdmin) return <Navigate to="/" replace />;

  const urlOk = !url.trim() || GITHUB_URL_RE.test(url.trim());
  const canScan = config?.installed && !busy && !jobId && (file || (url.trim() && urlOk));

  const scanNow = async () => {
    if (!canScan) return;
    setBusy(true);
    try {
      const form = new FormData();
      if (file) form.append('file', file);
      else form.append('url', url.trim());
      form.append('deep', String(!!deep));
      form.append('recursive', String(!!recursive));
      const d = await json(await api.postForm('/api/skill-scan/scans', form), 'The scan could not be started.');
      setJobId(d.jobId);
      setJob({ status: 'running', label: 'Starting the scan', elapsedSec: 0 });
      loadList();
    } catch (err) { setBusy(false); addToast(err.message, 'error'); }
  };

  const remove = async (s) => {
    if (!window.confirm(`Delete the scan of ${s.fileName || s.source}? It goes to the recycle bin for 30 days.`)) return;
    try {
      const d = await json(await api.delete(`/api/skill-scan/scans/${s.id}`));
      setScans((list) => (list || []).filter((x) => x.id !== s.id));
      if (scan?.id === s.id) setScan(null);
      offerUndo({ message: 'Scan moved to the recycle bin.', binIds: d.binId, after: loadList });
    } catch (err) { addToast(err.message, 'error'); }
  };

  const openGuideTool = (id) => {
    const t = GUIDE_TOOLS.find((g) => g.id === id);
    if (!t) return;
    setCurrentTool(t.tool);
    const selector = { scan: 'skill-scan-scan', deep: 'skill-scan-scan', report: 'skill-scan-report', history: 'skill-scan-history' }[t.tool];
    document.querySelector(`[data-tour="${selector}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const button = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40';
  const panel = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
  const muted = { color: 'var(--color-muted)' };
  const report = scan?.report;

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
        <div className="w-full max-w-5xl mx-auto space-y-5">
          <div>
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--color-primary)' }}>{getIcon('shield-check', { size: 20 })}</span>
              <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Skill Scanner</h1>
              <Tooltip text="How Skill Scanner works"><button type="button" aria-label="How Skill Scanner works" onClick={info.open} className="opacity-60 hover:opacity-100" style={muted}>{getIcon('info', { size: 16 })}</button></Tooltip>
              <Tooltip text="Take the guided tour of Skill Scanner"><button type="button" aria-label="Take the guided tour of Skill Scanner" onClick={startTour} className="opacity-60 hover:opacity-100" style={muted}>{getIcon('compass', { size: 16 })}</button></Tooltip>
            </div>
            <p className="text-sm" style={muted}>Check an AI agent skill or plugin for security risks before you install it, with NVIDIA’s SkillSpector. Admins only.</p>
          </div>

          {config && !config.installed && (
            <div className="rounded-xl border p-3 text-sm" style={{ borderColor: '#f59e0b', color: 'var(--color-text)' }}>
              SkillSpector is not installed on this server yet. It arrives with the next base image (built on GitHub after a change to Dockerfile.base), then the following deploy.
            </div>
          )}

          <section className="rounded-2xl border p-5 space-y-3" style={panel} data-tour="skill-scan-scan">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Scan a skill</h2>
            <Tooltip text={TOOL_TIPS.scan}>
              <div>
                <VoiceInput value={url} onChange={(v) => { setUrl(v); if (v) setFile(null); }} label="GitHub link" placeholder="https://github.com/owner/repo  (or a /tree/main/folder link)" mic />
              </div>
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
            <div className="flex flex-wrap gap-4 text-sm" style={{ color: 'var(--color-text)' }}>
              <Tooltip text="For a repository or plugin with several skills: scan each one on its own (up to 32) and show a verdict for each.">
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} /> Scan each skill separately</label>
              </Tooltip>
              <Tooltip text={config?.deepAvailable ? TOOL_TIPS.deep : (config?.deepReason || TOOL_TIPS.deep)}>
                <label className="flex items-center gap-2 cursor-pointer" style={{ opacity: config?.deepAvailable ? 1 : 0.5 }}>
                  <input type="checkbox" checked={deep} disabled={!config?.deepAvailable} onChange={(e) => setDeep(e.target.checked)} /> Deep scan (AI{config?.model ? `: ${config.model}` : ''})
                </label>
              </Tooltip>
            </div>
            {deep && <p className="text-xs" style={{ color: '#f59e0b' }}>A deep scan sends the skill’s files to Anthropic and costs a little. It can take up to about 20 minutes.</p>}
            <Tooltip text="Start the scan. It runs in the background; the report opens when it finishes.">
              <button type="button" className={button} disabled={!canScan} onClick={scanNow} style={{ background: 'var(--color-primary)', color: '#fff' }}>
                {getIcon('shield', { size: 14 })} {busy || jobId ? 'Scanning…' : 'Scan'}
              </button>
            </Tooltip>
            {job && (jobId || job.status === 'running') && (
              <p className="text-sm" style={muted}>{job.label || 'Scanning'}… {job.elapsedSec || 0}s</p>
            )}
          </section>

          <section className="rounded-2xl border p-5 space-y-3" style={panel} data-tour="skill-scan-report">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Report</h2>
            {!scan && <p className="text-sm" style={muted}>Run a scan, or open one from Saved scans below.</p>}
            {scan && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <VerdictPill recommendation={scan.recommendation} status={scan.status} />
                  {scan.score != null && <span className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{scan.score}<span className="text-sm" style={muted}>/100</span></span>}
                  <span className="text-sm break-all" style={{ color: 'var(--color-text)' }}>{scan.fileName || scan.source}</span>
                  {scan.sourceType === 'github' && <a href={scan.source} target="_blank" rel="noreferrer" className="text-xs underline" style={{ color: 'var(--color-primary)' }}>open on GitHub</a>}
                </div>
                <p className="text-xs" style={muted}>
                  {scan.mode === 'deep' ? `Deep scan (${scan.model || 'AI'})` : 'Static scan'}{scan.recursive ? ', each skill separately' : ''} · {dateOf(scan.finishedAt || scan.createdAt)}{report?.version ? ` · SkillSpector ${report.version}` : ''}
                </p>
                {scan.status === 'failed' && <p className="text-sm" style={{ color: '#ef4444' }}>{scan.error}</p>}
                {report && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {SEV_ORDER.map((s) => (
                        <span key={s} className="text-xs px-2 py-1 rounded-lg border" style={{ borderColor: SEVERITY[s].color, color: SEVERITY[s].color }}>{SEVERITY[s].label}: {report.counts?.[s] || 0}</span>
                      ))}
                      {report.multi && <span className="text-xs px-2 py-1" style={muted}>{report.skillCount} skills{report.skillsOmitted ? ` (${report.skillsOmitted} not shown)` : ''}</span>}
                    </div>
                    {report.complete === false && <p className="text-xs" style={{ color: '#f59e0b' }}>The scan could not read everything, so a Safe result is shown as Caution.</p>}
                    {report.skills.map((s, i) => <SkillSection key={`${s.name}-${i}`} skill={s} multi={report.multi} />)}
                    <p className="text-xs" style={muted}>A Safe verdict means SkillSpector found no known risky pattern, not that the skill is harmless. Read what it asks for before you install it.</p>
                  </>
                )}
              </>
            )}
          </section>

          <section className="space-y-2" data-tour="skill-scan-history">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Saved scans</h2>
            {scans === null && <p className="text-sm" style={muted}>Loading…</p>}
            {scans?.length === 0 && <p className="text-sm" style={muted}>No scans yet.</p>}
            {scans?.map((s) => (
              <div key={s.id} className="rounded-xl border p-3 flex flex-wrap items-center justify-between gap-3" style={{ ...panel, borderColor: scan?.id === s.id ? 'var(--color-primary)' : 'var(--color-border)' }}>
                <div className="min-w-0">
                  <p className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{s.fileName || s.source}</p>
                  <p className="text-xs" style={muted}>{dateOf(s.createdAt)} · {s.mode}{s.recursive ? ', each skill' : ''}{s.score != null ? ` · score ${s.score}` : ''}{s.issueCount != null ? ` · ${s.issueCount} findings` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <VerdictPill recommendation={s.recommendation} status={s.status} small />
                  <Tooltip text="Open this scan's report."><button type="button" className={button} disabled={s.status === 'running'} onClick={() => openScan(s.id)} style={{ border: '1px solid var(--color-border)', color: 'var(--color-primary)' }}>Open</button></Tooltip>
                  <Tooltip text="Move this scan to the recycle bin (30 days, with Undo)."><button type="button" aria-label="Delete this scan" disabled={s.status === 'running'} onClick={() => remove(s)} className="p-1.5 rounded-lg hover:opacity-70 disabled:opacity-40" style={{ color: '#ef4444' }}>{getIcon('trash', { size: 14 })}</button></Tooltip>
                </div>
              </div>
            ))}
          </section>
        </div>

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

        <SkillScanTutorChat currentTool={currentTool} onOpenTool={openGuideTool} />
      </div>
    </VoiceInputProvider>
  );
}
