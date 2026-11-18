import React, { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { VoiceInput, VoiceInputProvider } from '../../components/voiceInput/VoiceInput';
import { mdComponents } from '../../utils/mdComponents';
import { Pill, SEV_COLOR, SEV_TIP, fmt, fmtWhen, scoreColor } from './shared';

// Code Map "Context" tab: a briefing about how Vault is built, for a Claude conversation that knows nothing about it (docs/code-map.md
// "Context"). One button builds it on the server (server/services/codeMap/briefing/, no AI call); the page shows it as a report and as
// Markdown to copy or download. Also the owner's notes for Claude, earlier briefings, and CLAUDE.md with the docs it links to.

const toast = (message, type = 'error') => useToastStore.getState().addToast(message, type);
const CARD = 'rounded-2xl border p-5 space-y-3';
const cardStyle = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const BTN = 'text-sm px-3.5 py-1.5 rounded-lg border flex items-center gap-1.5 hover:opacity-70 transition-opacity duration-200 disabled:opacity-50';
const btnStyle = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const PRIMARY = 'text-sm font-medium px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 hover:opacity-70 transition-opacity duration-200 disabled:opacity-50';
const primaryStyle = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
const STATUS = {
  ga: { color: '#16a34a', tip: 'Generally available: switched on for everyone by default.' },
  preview: { color: '#f59e0b', tip: 'Preview: a work in progress that ships switched off.' },
  parked: { color: 'var(--color-muted)', tip: 'Parked: switched off and not being worked on.' },
  admin: { color: 'var(--color-primary)', tip: 'Admin only.' },
};

async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`, 'success'); } catch { toast('Could not copy'); }
}
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const fileName = (b) => `vault-briefing-${String(b?.generatedAt || new Date().toISOString()).slice(0, 10)}.md`;
async function json(res, fallback) {
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || fallback);
  return d;
}

function Section({ title, tip, children, guide }) {
  return (
    <section className={CARD} style={cardStyle} data-guide={guide}>
      <h3 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
        {title}
        {tip && <Tooltip text={tip}><span tabIndex={0} className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>(?)</span></Tooltip>}
      </h3>
      {children}
    </section>
  );
}

/** The report: the briefing's sections drawn for reading. */
function Report({ sections }) {
  const get = (id) => sections.find((s) => s.id === id);
  const counts = get('architecture')?.data || {};
  const tools = get('tools')?.data?.tools || [];
  const state = get('state')?.data || {};
  const services = get('services')?.data?.services || [];
  const dir = get('direction')?.data || { recent: [], concerns: [] };
  const pattern = get('pattern')?.data;
  const notes = get('notes')?.body;
  const tiles = [
    ['Tools', fmt(counts.tools), `${counts.preview || 0} preview, ${counts.parked || 0} parked.`],
    ['API mounts', fmt(counts.mounts), `In ${fmt(counts.routeFiles)} route files.`],
    ['Server lines', fmt(counts.linesServer), 'Lines of server code (Code Map run).'],
    ['Client lines', fmt(counts.linesClient), 'Lines of client code (Code Map run).'],
    ['Test files', fmt(counts.testFiles), `${fmt(counts.linesTests)} lines of tests.`],
    ['Import cycles', fmt(counts.cycles), 'Files that import each other in a loop.'],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {tiles.map(([label, value, tip]) => (
          <Tooltip key={label} text={tip}>
            <div tabIndex={0} className="rounded-2xl border p-4 h-full" style={cardStyle}>
              <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</div>
              <div className="text-xl font-semibold mt-1" style={{ color: 'var(--color-text)' }}>{value}</div>
            </div>
          </Tooltip>
        ))}
      </div>

      <Section title="Existing tools" tip="Every tool in the menu, as the briefing describes it to Claude. Purpose is the first line of the tool's doc, else its menu name.">
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-xs">
            <thead style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
              <tr>{['Tool', 'Group', 'Status', 'Purpose', 'Lines', 'Tests', 'Score', 'Linked tools'].map((h) => <th key={h} className={`p-2 font-medium ${['Lines', 'Tests', 'Score'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.id} className="border-t align-top" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <td className="p-2 whitespace-nowrap font-medium">{t.name}</td>
                  <td className="p-2 whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>{t.group}</td>
                  <td className="p-2"><Pill color={STATUS[t.status]?.color} tip={STATUS[t.status]?.tip}>{t.status}</Pill></td>
                  <td className="p-2 min-w-[16rem]">{t.purpose}</td>
                  <td className="p-2 text-right">{fmt(t.lines)}</td>
                  <td className="p-2 text-right">{t.tests}</td>
                  <td className="p-2 text-right font-semibold" style={{ color: t.score == null ? 'var(--color-muted)' : scoreColor(t.score) }}>{t.score ?? '–'}</td>
                  <td className="p-2" style={{ color: 'var(--color-muted)' }}>{t.links.join(', ') || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-4">
        <Section title="Current state" tip="The top findings from the latest Code Map run, high first.">
          {state.findings?.length ? (
            <ul className="space-y-2">
              {state.findings.map((f, i) => (
                <li key={i} className="rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', borderLeft: `4px solid ${SEV_COLOR[f.severity]}` }}>
                  <div className="flex items-center gap-2"><Pill color={SEV_COLOR[f.severity]} tip={SEV_TIP[f.severity]}>{f.severity}</Pill><span style={{ color: 'var(--color-text)' }}>{f.title}</span></div>
                  {f.tools.length > 0 && <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{f.tools.join(', ')}</div>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No findings.</p>}
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {state.cycles} import cycles · hotspots {state.hotspots?.length ? state.hotspots.join(', ') : 'not available (no git history on the server)'}
          </p>
        </Section>

        <div className="space-y-4">
          <Section title="Outside services" tip="Whether each outside service is set up on this server: YES or NO only. Values are never read or shown.">
            <div className="flex flex-wrap gap-2">
              {services.map((x) => (
                <Tooltip key={x.service} text={x.usedFor}>
                  <span tabIndex={0} className="text-xs px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}>
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: x.configured ? '#16a34a' : 'var(--color-border)' }} />
                    {x.service} <strong>{x.configured ? 'YES' : 'NO'}</strong>
                  </span>
                </Tooltip>
              ))}
            </div>
          </Section>
          <Section title="Working pattern" tip="A 30-day summary from the Ponytail report, if there is any data.">
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              {pattern ? `${fmt(pattern.tasks)} tasks, $${pattern.cost.toFixed(2)} in all, average reuse ${pattern.avgReuse == null ? 'not measured' : `${Math.round(pattern.avgReuse)}%`}.` : 'No Ponytail data for the last 30 days.'}
            </p>
          </Section>
          <Section title="Your notes" tip="What the briefing passes on from the notes box below, as they were when it was built.">
            <p className="text-sm whitespace-pre-wrap" style={{ color: notes === 'None.' ? 'var(--color-muted)' : 'var(--color-text)' }}>{notes}</p>
          </Section>
        </div>
      </div>

      <Section title="Recent direction" tip="Changelog subjects from the period, and concerns still written against entries.">
        <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-4 text-xs">
          <div>
            <h4 className="font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Since {dir.fromDay} ({dir.recent.length})</h4>
            <ul className="space-y-1 max-h-80 overflow-y-auto pr-1">
              {dir.recent.map((e, i) => <li key={i} style={{ color: 'var(--color-text)' }}><span style={{ color: 'var(--color-muted)' }}>{e.date} · {e.area || 'General'} ·</span> {e.subject}</li>)}
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Open concerns ({dir.concerns.length})</h4>
            <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {dir.concerns.map((e, i) => <li key={i} style={{ color: 'var(--color-text)' }}><span style={{ color: 'var(--color-muted)' }}>{e.date} · {e.subject}:</span> {e.concerns.length > 300 ? `${e.concerns.slice(0, 300)}…` : e.concerns}</li>)}
            </ul>
          </div>
        </div>
      </Section>
    </div>
  );
}

/** CLAUDE.md read-only, with docs to copy alongside it. */
function ClaudeMd({ info }) {
  const getIcon = useIcon();
  const [picked, setPicked] = useState(() => new Set());
  const [showOthers, setShowOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!info) return <Skeleton lines={6} label="Loading CLAUDE.md" />;
  const toggle = (n) => setPicked((p) => { const x = new Set(p); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  const copyAll = async () => {
    setBusy(true);
    try {
      const docs = [];
      for (const name of [...info.linked, ...info.others].filter((n) => picked.has(n))) {
        const d = await json(await api.get(`/api/code-map/briefing/doc?name=${encodeURIComponent(name)}`), `Could not read ${name}`);
        docs.push(`## File: docs/${d.name}\n\n${d.text.trim()}`);
      }
      await copyText([`## File: CLAUDE.md\n\n${info.text.trim()}`, ...docs].join('\n\n'), docs.length ? `CLAUDE.md and ${docs.length} doc${docs.length === 1 ? '' : 's'}` : 'CLAUDE.md');
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  };
  const box = (n) => (
    <label key={n} className="inline-flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
      <input type="checkbox" checked={picked.has(n)} onChange={() => toggle(n)} style={{ accentColor: 'var(--color-primary)' }} />{n}
    </label>
  );
  return (
    <Section title="CLAUDE.md" guide="claude-md" tip="The rules Claude Code follows in this project, read-only. Tick docs to copy them with it as one block, each under its own heading.">
      <div className="flex flex-wrap items-center gap-3">
        <Tooltip text={picked.size ? `Copy CLAUDE.md and the ${picked.size} ticked doc${picked.size === 1 ? '' : 's'} as one block, each under "## File: ..."` : 'Copy CLAUDE.md. Tick docs below to add them to the same block.'}>
          <button type="button" onClick={copyAll} disabled={busy} className={BTN} style={btnStyle}>{getIcon('copy', { size: 14 })}{busy ? 'Copying…' : picked.size ? `Copy with ${picked.size} doc${picked.size === 1 ? '' : 's'}` : 'Copy'}</button>
        </Tooltip>
        {picked.size > 0 && (
          <Tooltip text="Untick every doc."><button type="button" onClick={() => setPicked(new Set())} className="text-xs hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }}>Clear</button></Tooltip>
        )}
      </div>
      <div className="space-y-2">
        <div className="text-xs" style={{ color: 'var(--color-muted)' }}>Docs CLAUDE.md links to:</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">{info.linked.map(box)}</div>
        <Tooltip text="Show every other doc in docs/, to add any of them too.">
          <button type="button" onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers} className="text-xs hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }}>
            {showOthers ? 'Hide other docs' : `Other docs (${info.others.length})`}
          </button>
        </Tooltip>
        {showOthers && <div className="flex flex-wrap gap-x-4 gap-y-1.5 max-h-48 overflow-y-auto">{info.others.map(box)}</div>}
      </div>
      <div className="rounded-xl border p-4 max-h-[36rem] overflow-y-auto text-sm prose-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{info.text}</ReactMarkdown>
      </div>
    </Section>
  );
}

export default function ContextView({ hasRun, onRunAnalysis, busy }) {
  const getIcon = useIcon();
  const [built, setBuilt] = useState(null); // { briefing, sections, stats, rulesStale }
  const [building, setBuilding] = useState(false);
  const [list, setList] = useState(null);
  const [notes, setNotes] = useState(null);
  const [savedNotes, setSavedNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [claude, setClaude] = useState(null);

  const loadList = useCallback(async () => {
    try { setList((await json(await api.get('/api/code-map/briefings'), 'Could not list briefings')).briefings); } catch (err) { toast(err.message); setList([]); }
  }, []);
  useEffect(() => {
    loadList();
    api.get('/api/code-map/briefing/notes').then((r) => json(r, 'Could not load your notes')).then((d) => { setNotes(d.notes); setSavedNotes(d.notes); }).catch((err) => { toast(err.message); setNotes(''); });
    api.get('/api/code-map/briefing/claude-md').then((r) => json(r, 'Could not load CLAUDE.md')).then(setClaude).catch((err) => toast(err.message));
  }, [loadList]);

  const build = async () => {
    setBuilding(true);
    try {
      if (notes !== null && notes !== savedNotes) await saveNotes(true);
      const d = await json(await api.post('/api/code-map/briefings', {}), 'Could not build the briefing');
      setBuilt(d);
      loadList();
      toast('Briefing built', 'success');
    } catch (err) { toast(err.message); } finally { setBuilding(false); }
  };

  const saveNotes = async (quiet = false) => {
    setSavingNotes(true);
    try {
      const res = await api.put('/api/code-map/briefing/notes', { notes: notes || '' });
      const d = await json(res, 'Could not save your notes');
      setSavedNotes(d.notes); setNotes(d.notes);
      if (!quiet) toast('Notes saved', 'success');
    } catch (err) { toast(err.message); throw err; } finally { setSavingNotes(false); }
  };

  const reCopy = async (b, how) => {
    try {
      const d = await json(await api.get(`/api/code-map/briefings/${b.id}`), 'That briefing is no longer here');
      if (how === 'download') download(d.briefing.markdown, fileName(d.briefing)); else await copyText(d.briefing.markdown, 'Briefing');
    } catch (err) { toast(err.message); }
  };

  const stale = (built?.rulesStale?.length ? built.rulesStale : claude?.rulesStale) || [];
  const md = built?.briefing?.markdown;

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="space-y-5" data-tour="cm-context" data-guide="context">
        {stale.length > 0 && (
          <p className="text-sm rounded-xl border px-4 py-3" role="status" style={{ background: '#fef3c7', borderColor: '#f59e0b', color: '#b45309' }}>
            The rules summary may be out of date: {stale.join(' and ')} {stale.length === 1 ? 'has' : 'have'} changed since it was written. Refresh <code>server/services/codeMap/briefing/rules.md</code> (see docs/code-map.md, Context).
          </p>
        )}

        <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-4">
          <Section title="Briefing for Claude" guide="build-briefing" tip="Builds a description of how Vault is built from the latest run, to paste into a new Claude conversation (or add to a Claude Project). No AI call; never includes what is in your tools.">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              Start a Claude conversation that knows nothing about Vault: build a briefing, copy it, and paste it as your first message (or add the .md file to a Claude Project).
            </p>
            {!hasRun ? (
              <EmptyState
                icon="code-map"
                title="Run analysis first"
                body="The briefing is built from the latest finished Code Map run."
                action={<Tooltip text="Read the code as it is now. Takes a few seconds."><button type="button" onClick={onRunAnalysis} disabled={busy} className={PRIMARY} style={primaryStyle}>{busy ? 'Running…' : 'Run analysis'}</button></Tooltip>}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip text="Build a new briefing from the latest run, your saved notes and the current changelog. It is kept, so you can copy it again later.">
                  <button type="button" onClick={build} disabled={building} className={PRIMARY} style={primaryStyle}>
                    {getIcon(building ? 'loader' : 'sparkles', { size: 14, className: building ? 'animate-spin' : undefined })}{building ? 'Building…' : 'Build briefing'}
                  </button>
                </Tooltip>
                {md && (
                  <>
                    <Tooltip text="Copy the Markdown briefing to paste into Claude."><button type="button" onClick={() => copyText(md, 'Briefing')} className={BTN} style={btnStyle}>{getIcon('copy', { size: 14 })}Copy for Claude</button></Tooltip>
                    <Tooltip text="Save the briefing as a .md file, for example to add to a Claude Project."><button type="button" onClick={() => download(md, fileName(built.briefing))} className={BTN} style={btnStyle}>{getIcon('download', { size: 14 })}Download .md</button></Tooltip>
                    <Tooltip text="Size of the briefing. Tokens are estimated as characters divided by 4.">
                      <span tabIndex={0} className="text-xs" style={{ color: 'var(--color-muted)' }}>{fmt(built.stats.chars)} characters · about {fmt(built.stats.tokens)} tokens{built.stats.trimmed ? ' · shortened to fit' : ''}</span>
                    </Tooltip>
                  </>
                )}
              </div>
            )}
            {md && (
              <pre className="rounded-xl border p-3 text-xs whitespace-pre-wrap break-words max-h-72 overflow-y-auto font-mono" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }} aria-label="Briefing Markdown">{md}</pre>
            )}
          </Section>

          <div className="space-y-4">
            <Section title="Your notes for Claude" guide="owner-notes" tip="Saved for your account and added to every briefing you build. Only what you type here goes in.">
              {notes === null ? <Skeleton lines={3} label="Loading your notes" /> : (
                <>
                  <VoiceInput
                    type="textarea" rows={6} append value={notes} onChange={setNotes} label="Your notes for Claude"
                    placeholder="Your notes for Claude: priorities, plans, things you've decided against, what you're unsure about"
                  />
                  <div className="flex items-center gap-3">
                    <Tooltip text="Keep these notes for your next briefing. Building a briefing also saves them.">
                      <button type="button" onClick={() => saveNotes().catch(() => {})} disabled={savingNotes || notes === savedNotes} className={BTN} style={btnStyle}>{savingNotes ? 'Saving…' : 'Save notes'}</button>
                    </Tooltip>
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{notes === savedNotes ? 'Saved' : 'Not saved yet'} · {fmt(notes.length)} / 20,000</span>
                  </div>
                </>
              )}
            </Section>
            <Section title="Earlier briefings" tip="The last 10 briefings you built, to copy or download again exactly as they were.">
              {list === null ? <Skeleton lines={3} label="Loading earlier briefings" /> : !list.length ? (
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>None yet. Build one above.</p>
              ) : (
                <ul className="space-y-1.5">
                  {list.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 text-sm rounded-xl border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                      <span className="flex-1 min-w-0" style={{ color: 'var(--color-text)' }}>
                        {fmtWhen(b.generatedAt)} <span className="text-xs" style={{ color: 'var(--color-muted)' }}>· {fmt(b.chars)} characters{b.commitHint ? ` · ${String(b.commitHint).slice(0, 8)}` : ''}</span>
                      </span>
                      <Tooltip text="Copy this briefing again."><button type="button" onClick={() => reCopy(b, 'copy')} aria-label="Copy this briefing" className="hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>{getIcon('copy', { size: 14 })}</button></Tooltip>
                      <Tooltip text="Download this briefing as a .md file."><button type="button" onClick={() => reCopy(b, 'download')} aria-label="Download this briefing" className="hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>{getIcon('download', { size: 14 })}</button></Tooltip>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>

        {built?.sections && <Report sections={built.sections} />}

        <ClaudeMd info={claude} />
      </div>
    </VoiceInputProvider>
  );
}
