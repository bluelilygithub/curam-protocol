import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { offerUndo } from '../utils/binUndo';
import Tooltip from '../components/Tooltip';
import ToolSidebar from '../components/ToolSidebar';
import EmptyState from '../components/EmptyState';
import { JobStart, JobBar, BackToJobs, stepIndex } from '../components/JobStart';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { startHtmlContentCheckTour, TOUR_KEY } from '../utils/tours/htmlContentCheckTour';
import HtmlContentCheckTutorChat from './htmlContentCheck/HtmlContentCheckTutorChat';
import { HCC_TOOLS, JOB_TOOL_IDS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, NOT_BUILT, HCC_GOALS, KIND_LABELS, STATUS_LABELS, HOW_IT_WORKS, GUIDE_TOOLS } from './htmlContentCheck/htmlContentCheckTools.mjs';
import { CARD, PrimaryButton, SecondaryButton, Badge, readJson } from './htmlContentCheck/shared';
import JobForm from './htmlContentCheck/JobForm';
import JobsView from './htmlContentCheck/JobsView';
import LinesView from './htmlContentCheck/LinesView';
import RoundsView from './htmlContentCheck/RoundsView';
import ChangesView from './htmlContentCheck/ChangesView';

/**
 * HTML Content Check (docs/html-content-check.md): was a requested set of edits made to a web page? Laid out like Contract Review and
 * DocCompare: the tool list on the left, the "What do you want to do?" job screen, and a job bar. This file owns the state and every
 * API call. Help follows the Video Tools conventions: a Tooltip on every control, the (i) box, the compass tour and the guide chat.
 */
const labelFor = (id) => HCC_TOOLS.find((t) => t.id === id)?.label || id;
const MENU = GROUPS.map((g) => ({
  label: g, tip: GROUP_TIPS[g],
  tools: HCC_TOOLS.filter((t) => t.group === g).map((t) => ({ ...t, tip: TOOL_TIPS[t.id], hint: NOT_BUILT[t.id] })),
}));
const newPage = () => ({ key: `n${Date.now()}${Math.random()}`, url: '', label: '', fetchMode: 'auto' });
const EMPTY_FORM = { kind: 'request', pages: [newPage()], name: '', requestText: '', previousText: '', clientId: '', ticketId: '' };
const formOf = (job) => ({
  kind: job.kind, pages: job.pages.map((pg) => ({ id: pg.id, url: pg.url, label: pg.label || '', fetchMode: pg.fetchMode })), name: job.name,
  requestText: job.requestText || '', previousText: job.previousText || '',
  clientId: job.clientId ? String(job.clientId) : '', ticketId: job.ticketId ? String(job.ticketId) : '', status: job.status,
});
const pagesBody = (pages) => pages.filter((pg) => pg.url.trim()).map((pg) => ({ ...(pg.id ? { id: pg.id } : {}), url: pg.url, label: pg.label, fetchMode: pg.fetchMode }));

export default function HtmlContentCheckPage() {
  const getIcon = useIcon();
  const info = useToolInfoModal('vault_html_content_check_info_seen');
  const [searchParams, setSearchParams] = useSearchParams();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [newFile, setNewFile] = useState(null); // a saved copy to use as round 0 instead of fetching
  const [changesRound, setChangesRound] = useState(null); // the round Changes shows (null: the latest)
  const [changesPage, setChangesPage] = useState(null); // the page Changes shows (null: the first with changes)
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
  useEffect(() => { setChangesRound(null); setChangesPage(null); }, [job?.id, job?.rounds?.length]); // another job, or a new round: Changes shows the latest

  const startGoal = (g) => {
    setGoal(g);
    if (g.kind) setNewForm((f) => ({ ...f, kind: g.kind }));
    setTool(g.steps[0].tool);
  };
  const backToStart = () => { setGoal(null); setTool('start'); };
  // the guided tour switches tools the same way the list does ('start' = the job screen)
  const startTour = () => {
    info.close();
    try { localStorage.removeItem(TOUR_KEY); } catch { /* ignore */ }
    startHtmlContentCheckTour((id) => { if (id === 'start') backToStart(); else setTool(id); });
  };
  // Settings -> HTML Content Check Tour opens /html-content-check?tour=1
  useEffect(() => {
    if (!searchParams.get('tour')) return;
    const next = new URLSearchParams(searchParams); next.delete('tour');
    setSearchParams(next, { replace: true });
    setTimeout(startTour, 400);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps
  // the guide's Open buttons: the (i) box and the tour are ours; otherwise show the tool and scroll to the part (data-guide="<id>")
  const openGuideTool = (id) => {
    if (id === 'info') { info.open(); return; }
    if (id === 'tour') { startTour(); return; }
    const target = GUIDE_TOOLS.find((g) => g.id === id);
    if (!target) return;
    setTool(target.tool);
    setTimeout(() => document.querySelector(`[data-guide="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  };
  const setNew = (k) => (v) => setNewForm((f) => ({ ...f, [k]: v }));
  const setEdit = (k) => (v) => setEditForm((f) => ({ ...f, [k]: v }));
  // After a job opens, a job flow moves on to its next step; otherwise the request lines (or details, for a comparison) come first.
  const afterOpen = (opened) => {
    let g = goalRef.current;
    // the person switched kind on the New job form: that job flow no longer fits (a comparison has no request lines)
    if (g?.kind && g.kind !== opened.kind) { g = null; setGoal(null); }
    const at = stepIndex(g, 'new');
    setTool(g && at >= 0 && g.steps[at + 1] ? g.steps[at + 1].tool : (opened.kind === 'request' ? 'lines' : 'rounds'));
  };

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const openJob = (id) => run(async () => {
    const j = await readJson(await api.get(`/api/html-content-check/jobs/${id}`));
    setJob(j);
    setTool(j.kind === 'request' ? 'lines' : 'rounds');
  });
  // Fetching can take a while (a real browser up to half a minute), so it runs behind the processing overlay.
  const fetchRound = (label, call) => run(async () => {
    startProcessing(label, 'The page is read as it is now and kept as a round.');
    try { return await call(); } finally { stopProcessing(); }
  });
  // a round is one row per page: say how many pages could not be read (each one's reason shows on Rounds)
  const roundToast = (round) => {
    const failed = round.pages.filter((pg) => pg.status === 'failed');
    if (!failed.length) addToast(`Round ${round.number} kept.`, 'success');
    else if (failed.length === round.pages.length) addToast(round.pages.length === 1 ? `Round ${round.number} failed: ${failed[0].error}` : `Round ${round.number}: no page could be read. The reasons are on Rounds.`, 'error');
    else addToast(`Round ${round.number} kept, but ${failed.length} of ${round.pages.length} pages could not be read. The reasons are on Rounds.`, 'error');
  };
  const createJob = () => fetchRound(newFile ? 'Reading the saved copy…' : 'Fetching the page…', async () => {
    let j = await readJson(await api.post('/api/html-content-check/jobs', { ...newForm, pages: pagesBody(newForm.pages), fetch: !newFile }));
    if (newFile) {
      const form = new FormData(); form.append('file', newFile);
      j = (await readJson(await api.postForm(`/api/html-content-check/jobs/${j.id}/rounds`, form))).job;
    }
    setJob(j); setNewForm(EMPTY_FORM); setNewFile(null); loadJobs();
    const r0 = j.rounds[0];
    const lines = j.kind === 'request' ? ` and the request split into ${j.items.length} line${j.items.length === 1 ? '' : 's'}` : '';
    if (r0?.status === 'failed') addToast(`Job created, but the page could not be read: ${r0.error}`, 'error');
    else addToast(`Job created: ${j.pages.length > 1 ? `${j.pages.length} pages were read` : "the page was read"}${lines}.`, 'success');
    afterOpen(j);
  });
  const checkAgain = () => fetchRound(job.pages.length > 1 ? `Reading all ${job.pages.length} pages again…` : 'Fetching the page again…', async () => {
    const d = await readJson(await api.post(`/api/html-content-check/jobs/${job.id}/rounds`, {}));
    setJob(d.job); loadJobs(); roundToast(d.round);
  });
  const loadRound = async (number) => readJson(await api.get(`/api/html-content-check/jobs/${job.id}/rounds/${number}`));
  const showChanges = (number, pageId = null) => { setChangesRound(number); setChangesPage(pageId); setTool('changes'); };
  // Match to request (the one AI call): returns the round's new links, or null when it failed (the error shows above the screen).
  const matchRound = async (number) => {
    let out = null;
    await run(async () => {
      startProcessing('Matching the request to the changes…', 'The AI suggests which changes answer each request line. You judge each edit.');
      try { out = await readJson(await api.post(`/api/html-content-check/jobs/${job.id}/rounds/${number}/match`, {})); } finally { stopProcessing(); }
      const n = out.lines.filter((l) => l.status === 'noChange' || l.status === 'unreadable').length;
      const pg = out.usage?.pages || 0;
      addToast(`Matched ${pg} page${pg === 1 ? '' : 's'}. ${n ? `${n} line${n === 1 ? '' : 's'} with no change found.` : 'Every line that was checked has a change linked.'}`, 'success');
    });
    return out;
  };
  const linkChanges = async (number, pageId, ref, changeIds) => {
    let out = null;
    await run(async () => { out = await readJson(await api.put(`/api/html-content-check/jobs/${job.id}/rounds/${number}/pages/${pageId}/matches/${encodeURIComponent(ref)}`, { changeIds })); });
    return out;
  };
  const uploadCopy = (file, pageId) => fetchRound('Reading the saved copy…', async () => {
    const form = new FormData(); if (pageId) form.append('pageId', String(pageId)); form.append('file', file);
    const d = await readJson(await api.postForm(`/api/html-content-check/jobs/${job.id}/rounds`, form));
    setJob(d.job); loadJobs(); roundToast(d.round);
  });
  const saveDetails = () => run(async () => {
    const { pages, kind, ...body } = editForm; // eslint-disable-line no-unused-vars
    const wanted = pagesBody(pages);
    if (JSON.stringify(wanted) !== JSON.stringify(pagesBody(formOf(job).pages))) await readJson(await api.put(`/api/html-content-check/jobs/${job.id}/pages`, { pages: wanted }));
    setJob(await readJson(await api.patch(`/api/html-content-check/jobs/${job.id}`, body)));
    loadJobs();
    addToast('Saved.', 'success');
  });
  const saveItems = (draft) => run(async () => {
    setJob(await readJson(await api.put(`/api/html-content-check/jobs/${job.id}/items`, { items: draft.map((d) => ({ ...(d.id ? { id: d.id } : {}), lineText: d.lineText, kind: d.kind, pageId: d.pageId, section: d.section })) })));
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
  const newValid = newForm.pages.some((pg) => pg.url.trim()) && (newForm.kind === 'compare' || newForm.requestText.trim());

  return (
    <div style={{ background: 'var(--color-bg)', color: 'var(--color-text)', minHeight: '100dvh' }}>
      <VoiceInputProvider lang="en-AU">
        <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-5rem)]">
          <ToolSidebar title="HTML Content Check" icon="list-checks" groups={MENU} current={tool} onSelect={setTool}
            onInfo={info.open} infoTip="How HTML Content Check works: rounds, how the page is read, what counts as a change, and what the AI does and does not do."
            onTour={startTour} tourTip="Take the guided tour of HTML Content Check: the jobs, each tool, matching and the guide.">
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
                    <button type="button" onClick={() => setTool(job.kind === 'request' ? 'lines' : 'rounds')} className="font-medium truncate flex-1 text-left transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-text)' }}>{job.name}</button>
                  </Tooltip>
                  <Tooltip text="Close this job and go back to Your jobs.">
                    <button type="button" aria-label="Close this job" onClick={() => { setJob(null); setTool('jobs'); }} className="transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 12 })}</button>
                  </Tooltip>
                </div>
              </div>
            )}
          </ToolSidebar>

          <div className="flex-1 min-w-0 p-4 sm:p-6" style={{ background: 'var(--color-bg)' }} data-tour="html-content-check-main">
            <div className="max-w-[1700px] space-y-4">
              {tool === 'start' && (
                <JobStart goals={HCC_GOALS} labelFor={labelFor} onPick={startGoal} appName="HTML Content Check" tourId="html-content-check-jobs"
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
                      {job.pages.length > 1 && <Badge>{job.pages.length} pages</Badge>}
                      <Tooltip text={job.pages.length > 1 ? 'Open page 1 in a new browser tab. Every page is listed in Job details.' : 'Open the page in a new browser tab.'}><a href={job.url} target="_blank" rel="noopener noreferrer" className="text-xs underline truncate max-w-full transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>{job.url}</a></Tooltip>
                    </div>
                  )}

                  {tool === 'new' && (
                    <div className="flex flex-col xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start gap-4">
                      <section className="rounded-2xl border p-6 space-y-4" style={CARD} data-guide="new">
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
                        <JobForm form={newForm} set={setNew} clients={clients} tickets={tickets} isNew getIcon={getIcon} />
                        <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }} data-guide="saved-copy">
                          <Tooltip text="For a staging site, a page behind a login, or one that refuses to be fetched: open it in your browser, save it with File > Save Page As (Webpage, HTML only), then choose the file. It becomes the starting point instead of fetching.">
                            <label className="px-3 py-1.5 rounded-lg border cursor-pointer transition-opacity duration-200 hover:opacity-70" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                              Use a saved copy instead
                              <input type="file" accept=".html,.htm,text/html" className="sr-only" aria-label="Saved copy of the page" onChange={(e) => { setNewFile(e.target.files?.[0] || null); e.target.value = ''; }} />
                            </label>
                          </Tooltip>
                          {newFile && (
                            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                              {newFile.name}
                              <Tooltip text="Fetch the page instead of using this file.">
                                <button type="button" aria-label="Remove the saved copy" onClick={() => setNewFile(null)} className="transition-opacity duration-200 hover:opacity-60">{getIcon('x', { size: 12 })}</button>
                              </Tooltip>
                            </span>
                          )}
                        </div>
                        <PrimaryButton tip={newValid ? 'Create the job: every page is read as its starting point (round 0), and a change request is split into numbered lines, each on the page its heading names.' : 'Enter at least one page address (and the change request, for a change-request job) first.'} disabled={!newValid || busy} onClick={createJob}>Create job</PrimaryButton>
                      </section>
                      <section className="rounded-2xl border p-6 space-y-2 text-sm leading-relaxed" style={{ ...CARD, color: 'var(--color-muted)' }}>
                        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>What happens</h2>
                        <p>The change request is split into numbered lines (R1, R2 ...). Check them on Request lines: split a line that asks for two things, join two that belong together.</p>
                        <p>The page is read now, as its starting point (round 0): everything a visitor can see, including the menu, sidebars, captions and footer. After the developer's changes, press Check again on Rounds.</p>
                        <p>Coming in the next updates: every difference between rounds shown against the request lines, and a fillable PDF report for the client.</p>
                        <p>The AI never decides an edit is done: the differences are worked out by code, and you judge them.</p>
                      </section>
                    </div>
                  )}

                  {tool === 'jobs' && <JobsView jobs={jobs} search={search} setSearch={setSearch} openJob={openJob} deleteJob={deleteJob} newJob={() => setTool('new')} />}

                  {tool === 'lines' && job && (job.kind === 'request'
                    ? <LinesView job={job} getIcon={getIcon} saveItems={saveItems} resplit={resplit} />
                    : <EmptyState icon="columns" title="This job has no request" body="It only compares the page over time, so there are no request lines." />)}

                  {tool === 'rounds' && job && <RoundsView job={job} busy={busy} checkAgain={checkAgain} uploadCopy={uploadCopy} onShowChanges={showChanges} />}

                  {tool === 'changes' && job && <ChangesView job={job} getIcon={getIcon} fetchRound={loadRound} roundNumber={changesRound} setRoundNumber={setChangesRound} pageId={changesPage} setPageId={setChangesPage} onAllRounds={() => setTool('rounds')} matchRound={matchRound} linkChanges={linkChanges} busy={busy} />}

                  {tool === 'details' && job && editForm && (
                    <div className="flex flex-col xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start gap-4">
                      <section className="rounded-2xl border p-6 space-y-4" style={CARD}>
                        <JobForm form={editForm} set={setEdit} clients={clients} tickets={tickets} getIcon={getIcon} readIds={new Set(job.rounds.filter((x) => x.status === 'ready').map((x) => x.pageId))} />
                        <PrimaryButton tip="Save the changes to this job." disabled={busy} onClick={saveDetails}>Save</PrimaryButton>
                      </section>
                      <section className="rounded-2xl border p-6 space-y-3 text-sm" style={CARD}>
                        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>About this job</h2>
                        <p style={{ color: 'var(--color-muted)' }}>
                          {job.kind === 'request' ? `${job.items.length} request line${job.items.length === 1 ? '' : 's'}. ` : ''}
                          {job.rounds.length ? `${job.rounds.length} round${job.rounds.length === 1 ? '' : 's'} kept.` : 'The page has not been read yet: press Check again on Rounds.'}
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
        <HtmlContentCheckTutorChat currentTool={tool === 'start' ? 'new' : tool} onOpenTool={openGuideTool} />
      </VoiceInputProvider>

      {info.show && (
        <ToolInfoModal title="How HTML Content Check Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Check that the edits a client asked for were made to a web page. Pick a job on the start screen or a tool in the list on the left; hover any tool for a plain explanation. Not sure where to start? Press the round button at the bottom right and tell the guide what you want to check.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}
    </div>
  );
}
