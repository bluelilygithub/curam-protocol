import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useToastStore from '../store/toastStore';
import { offerUndo } from '../utils/binUndo';
import Tooltip from '../components/Tooltip';
import ToolSidebar from '../components/ToolSidebar';
import EmptyState from '../components/EmptyState';
import { JobStart, JobBar, BackToJobs, stepIndex } from '../components/JobStart';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { HCC_TOOLS, JOB_TOOL_IDS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, NOT_BUILT, HCC_GOALS, KIND_LABELS, STATUS_LABELS } from './htmlContentCheck/htmlContentCheckTools.mjs';
import { CARD, PrimaryButton, SecondaryButton, Badge, readJson } from './htmlContentCheck/shared';
import JobForm from './htmlContentCheck/JobForm';
import JobsView from './htmlContentCheck/JobsView';
import LinesView from './htmlContentCheck/LinesView';

/**
 * HTML Content Check (docs/html-content-check.md): was a requested set of edits made to a web page? Laid out like Contract Review and
 * DocCompare: the tool list on the left, the "What do you want to do?" job screen, and a job bar. This file owns the state and every
 * API call. Built milestone by milestone: milestone 1 has jobs and their request lines; fetching the page comes next.
 */
const labelFor = (id) => HCC_TOOLS.find((t) => t.id === id)?.label || id;
const MENU = GROUPS.map((g) => ({
  label: g, tip: GROUP_TIPS[g],
  tools: HCC_TOOLS.filter((t) => t.group === g).map((t) => ({ ...t, tip: TOOL_TIPS[t.id], hint: NOT_BUILT[t.id] })),
}));
const EMPTY_FORM = { kind: 'request', url: '', name: '', requestText: '', previousText: '', clientId: '', ticketId: '', fetchMode: 'auto' };
const formOf = (job) => ({
  kind: job.kind, url: job.url, name: job.name, requestText: job.requestText || '', previousText: job.previousText || '',
  clientId: job.clientId ? String(job.clientId) : '', ticketId: job.ticketId ? String(job.ticketId) : '', status: job.status, fetchMode: job.fetchMode,
});

export default function HtmlContentCheckPage() {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [tool, setTool] = useState('start'); // 'start' is the job screen; every other value is a tool id
  const [goal, setGoal] = useState(null);
  const [jobs, setJobs] = useState(null); // null while loading
  const [search, setSearch] = useState('');
  const [job, setJob] = useState(null); // the open job, with its items and round summaries
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newForm, setNewForm] = useState(EMPTY_FORM);
  const [editForm, setEditForm] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [clients, setClients] = useState(null);
  const [tickets, setTickets] = useState(null);
  const goalRef = useRef(goal); goalRef.current = goal;

  const loadJobs = useCallback(async (q = search) => {
    try { setJobs((await readJson(await api.get(`/api/html-content-check/jobs?q=${encodeURIComponent(q.trim())}`))).jobs); } catch (e) { setJobs([]); setError(e.message); }
  }, [search]);
  useEffect(() => { const t = setTimeout(() => loadJobs(search), 250); return () => clearTimeout(t); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  // The optional pickers: left out when the person has no CRM or Tickets (the call is refused).
  useEffect(() => {
    api.get('/api/clients').then((r) => (r.ok ? r.json() : null)).then((d) => setClients(Array.isArray(d) ? d : null)).catch(() => setClients(null));
    api.get('/api/tickets').then((r) => (r.ok ? r.json() : null)).then((d) => setTickets(Array.isArray(d?.tickets) ? d.tickets : null)).catch(() => setTickets(null));
  }, []);
  useEffect(() => { setEditForm(job ? formOf(job) : null); setConfirmDelete(false); }, [job]);

  const startGoal = (g) => {
    setGoal(g);
    if (g.kind) setNewForm((f) => ({ ...f, kind: g.kind }));
    setTool(g.steps[0].tool);
  };
  const backToStart = () => { setGoal(null); setTool('start'); };
  const setNew = (k) => (v) => setNewForm((f) => ({ ...f, [k]: v }));
  const setEdit = (k) => (v) => setEditForm((f) => ({ ...f, [k]: v }));
  // After a job opens, a job flow moves on to its next step; otherwise the request lines (or details, for a comparison) come first.
  const afterOpen = (opened) => {
    const g = goalRef.current;
    const at = stepIndex(g, 'new');
    setTool(g && at >= 0 && g.steps[at + 1] ? g.steps[at + 1].tool : (opened.kind === 'request' ? 'lines' : 'details'));
  };

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const openJob = (id) => run(async () => {
    const j = await readJson(await api.get(`/api/html-content-check/jobs/${id}`));
    setJob(j);
    setTool(j.kind === 'request' ? 'lines' : 'details');
  });
  const createJob = () => run(async () => {
    const j = await readJson(await api.post('/api/html-content-check/jobs', newForm));
    setJob(j); setNewForm(EMPTY_FORM); loadJobs();
    addToast(j.kind === 'request' ? `Job created: the request was split into ${j.items.length} line${j.items.length === 1 ? '' : 's'}.` : 'Job created.', 'success');
    afterOpen(j);
  });
  const saveDetails = () => run(async () => {
    const body = { ...editForm };
    if (job.rounds.length) delete body.url;
    setJob(await readJson(await api.patch(`/api/html-content-check/jobs/${job.id}`, body)));
    loadJobs();
    addToast('Saved.', 'success');
  });
  const saveItems = (draft) => run(async () => {
    setJob(await readJson(await api.put(`/api/html-content-check/jobs/${job.id}/items`, { items: draft.map((d) => (d.id ? { id: d.id, lineText: d.lineText } : { lineText: d.lineText })) })));
    loadJobs();
    addToast('Request lines saved.', 'success');
  });
  const resplit = () => run(async () => {
    setJob(await readJson(await api.put(`/api/html-content-check/jobs/${job.id}/items`, { resplit: true })));
    addToast('The request was split again.', 'success');
  });
  const deleteJob = (j) => run(async () => {
    const d = await readJson(await api.delete(`/api/html-content-check/jobs/${j.id}`));
    if (job?.id === j.id) { setJob(null); setTool('jobs'); }
    loadJobs();
    offerUndo({ message: `"${j.name}" deleted. It stays in the recycle bin for ${d.retentionDays} days.`, binIds: d.binId, after: () => loadJobs() });
  });

  const needsJob = JOB_TOOL_IDS.includes(tool);
  const newValid = newForm.url.trim() && (newForm.kind === 'compare' || newForm.requestText.trim());

  return (
    <div style={{ background: 'var(--color-bg)', color: 'var(--color-text)', minHeight: '100dvh' }}>
      <VoiceInputProvider lang="en-AU">
        <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-5rem)]">
          <ToolSidebar title="HTML Content Check" icon="list-checks" groups={MENU} current={tool} onSelect={setTool}>
            <Tooltip text="Go back to the list of jobs (check a change request, just compare a page, read a returned report).">
              <button type="button" onClick={backToStart}
                className="w-full flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: tool === 'start' ? 'var(--color-primary)' : 'var(--color-border)', color: tool === 'start' ? 'var(--color-primary)' : 'var(--color-text)', background: 'var(--color-bg)' }}>
                {getIcon('layout-grid', { size: 13 })}
                What do you want to do?
              </button>
            </Tooltip>
            {job && (
              <div className="rounded-lg border px-2.5 py-2 text-xs" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div style={{ color: 'var(--color-muted)' }}>Open job</div>
                <div className="flex items-center gap-1">
                  <Tooltip text={`Show this job: ${job.name}`}>
                    <button type="button" onClick={() => setTool(job.kind === 'request' ? 'lines' : 'details')} className="font-medium truncate flex-1 text-left transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-text)' }}>{job.name}</button>
                  </Tooltip>
                  <Tooltip text="Close this job and go back to Your jobs.">
                    <button type="button" aria-label="Close this job" onClick={() => { setJob(null); setTool('jobs'); }} className="transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 12 })}</button>
                  </Tooltip>
                </div>
              </div>
            )}
          </ToolSidebar>

          <div className="flex-1 min-w-0 p-4 sm:p-6" style={{ background: 'var(--color-bg)' }}>
            <div className="max-w-[1700px] space-y-4">
              {tool === 'start' && (
                <JobStart goals={HCC_GOALS} labelFor={labelFor} onPick={startGoal} appName="HTML Content Check"
                  intro="Check that the edits a client asked for were made to a web page. Pick a job and it walks you through, or choose a tool on the left." />
              )}

              {tool !== 'start' && (
                <>
                  <div className="space-y-3">
                    <BackToJobs onBack={backToStart} toolLabel={labelFor(tool)} goal={stepIndex(goal, tool) >= 0 ? goal : null} />
                    <JobBar goal={goal} mode={tool} onStep={setTool} labelFor={labelFor} carry="go to" />
                    <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS[tool]}</p>
                  </div>
                  {error && <div role="alert" className="text-sm rounded-xl border p-3" style={{ color: '#991b1b', borderColor: '#fca5a5', background: '#fff1f2' }}>{error}</div>}

                  {needsJob && !job && (
                    <EmptyState icon="list-checks" title={`${labelFor(tool)} works on one job`} body="Open one of your jobs, or start a new one."
                      action={<div className="flex gap-2 justify-center"><PrimaryButton tip="Open a job you started before." onClick={() => setTool('jobs')}>Your jobs</PrimaryButton><SecondaryButton tip="Start a new job." onClick={() => setTool('new')}>New job</SecondaryButton></div>} />
                  )}
                  {needsJob && job && (
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold mr-1" style={{ color: 'var(--color-text)' }}>{job.name}</h2>
                      <Badge>{KIND_LABELS[job.kind]}</Badge>
                      <Badge>{STATUS_LABELS[job.status]}</Badge>
                      <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-xs underline truncate max-w-full transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>{job.url}</a>
                    </div>
                  )}

                  {tool === 'new' && (
                    <div className="flex flex-col xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start gap-4">
                      <section className="rounded-2xl border p-6 space-y-4" style={CARD}>
                        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind of job">
                          {[['request', 'Check a change request', 'You have a list of edits to check on the page.'], ['compare', 'Just compare the page', 'No request: keep the page and see what changes between checks.']].map(([k, label, tip]) => (
                            <Tooltip key={k} text={tip}>
                              <button type="button" role="radio" aria-checked={newForm.kind === k} onClick={() => setNew('kind')(k)}
                                className="px-3 py-1.5 rounded-lg border text-sm font-medium transition-opacity duration-200 hover:opacity-70"
                                style={newForm.kind === k ? { background: 'var(--color-primary)', color: 'var(--color-on-primary)', borderColor: 'var(--color-primary)' } : { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}>
                                {label}
                              </button>
                            </Tooltip>
                          ))}
                        </div>
                        <JobForm form={newForm} set={setNew} clients={clients} tickets={tickets} isNew />
                        <PrimaryButton tip={newValid ? 'Create the job. A change request is split into numbered lines you can check next.' : 'Enter the page address (and the change request, for a change-request job) first.'} disabled={!newValid || busy} onClick={createJob}>Create job</PrimaryButton>
                      </section>
                      <section className="rounded-2xl border p-6 space-y-2 text-sm leading-relaxed" style={{ ...CARD, color: 'var(--color-muted)' }}>
                        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>What happens</h2>
                        <p>The change request is split into numbered lines (R1, R2 ...). Check them on Request lines: split a line that asks for two things, join two that belong together.</p>
                        <p>Coming in the next updates: the page is fetched as its starting point, fetched again after the developer's changes, and every difference is shown against the request lines, ready for a fillable PDF report to the client.</p>
                        <p>The AI never decides an edit is done: the differences are worked out by code, and you judge them.</p>
                      </section>
                    </div>
                  )}

                  {tool === 'jobs' && <JobsView jobs={jobs} search={search} setSearch={setSearch} openJob={openJob} deleteJob={deleteJob} newJob={() => setTool('new')} />}

                  {tool === 'lines' && job && (job.kind === 'request'
                    ? <LinesView job={job} getIcon={getIcon} saveItems={saveItems} resplit={resplit} />
                    : <EmptyState icon="columns" title="This job has no request" body="It only compares the page over time, so there are no request lines." />)}

                  {tool === 'details' && job && editForm && (
                    <div className="flex flex-col xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start gap-4">
                      <section className="rounded-2xl border p-6 space-y-4" style={CARD}>
                        <JobForm form={editForm} set={setEdit} clients={clients} tickets={tickets} urlLocked={job.rounds.length > 0} />
                        <PrimaryButton tip="Save the changes to this job." disabled={busy} onClick={saveDetails}>Save</PrimaryButton>
                      </section>
                      <section className="rounded-2xl border p-6 space-y-3 text-sm" style={CARD}>
                        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>About this job</h2>
                        <p style={{ color: 'var(--color-muted)' }}>
                          {job.kind === 'request' ? `${job.items.length} request line${job.items.length === 1 ? '' : 's'}. ` : ''}
                          {job.rounds.length ? `${job.rounds.length} round${job.rounds.length === 1 ? '' : 's'} fetched.` : 'The page has not been fetched yet: fetching arrives in the next update.'}
                          {job.clientName ? ` Client: ${job.clientName}.` : ''}{job.ticketTitle ? ` Ticket: T-${job.ticketId} ${job.ticketTitle}.` : ''}
                        </p>
                        {confirmDelete ? (
                          <div className="flex flex-wrap items-center gap-2">
                            Delete this job?
                            <SecondaryButton tip="Yes: delete it with its request lines and rounds. It stays in the recycle bin for 30 days." danger onClick={() => deleteJob(job)}>Yes</SecondaryButton>
                            <SecondaryButton tip="No: keep it." onClick={() => setConfirmDelete(false)}>No</SecondaryButton>
                          </div>
                        ) : (
                          <SecondaryButton tip="Delete this job with its request lines and rounds. It stays in the recycle bin for 30 days." onClick={() => setConfirmDelete(true)}>Delete job</SecondaryButton>
                        )}
                      </section>
                    </div>
                  )}

                  {tool === 'returns' && (
                    <EmptyState icon="inbox" title="Not built yet" body="Reading a report your client filled in and sent back comes in a later update. The report itself (a fillable PDF) comes first." />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </VoiceInputProvider>
    </div>
  );
}
