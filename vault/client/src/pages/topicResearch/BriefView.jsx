import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { withProgress } from './withProgress';
import WorkflowBar from './WorkflowBar';
import PromptPanel from './PromptPanel';
import useToastStore from '../../store/toastStore';
import { offerUndo } from '../../utils/binUndo';
import { useIcon } from '../../providers/IconProvider';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { explainFailure, BRIEF_STEP_LABELS, DRAFT_LENGTHS, DRAFT_STEP_LABELS, costText, draftReadiness, draftLine, factLabel, formatDate, overlapWarning } from './format.mjs';

const H = ({ children }) => <h3 className="text-base font-semibold mt-5 mb-2" style={{ color: 'var(--color-text)' }}>{children}</h3>;

// One research brief: notes to write your own article from. Every fact says how many outlets back it and links to them; if the brief repeats
// wording from a source, a warning comes first. Copy and download give the same Markdown the server writes.
export default function BriefView({ briefId, onBack, onOpenBrief, onOpenDraft }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [brief, setBrief] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAngle, setShowAngle] = useState(false);
  const [angle, setAngle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lengthChoice, setLengthChoice] = useState('medium');
  const [steer, setSteer] = useState('');
  const [drafts, setDrafts] = useState([]); // drafts already written from this brief
  const [thin, setThin] = useState(null); // the readiness warning shown before a draft of a thin brief

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await api.get(`/api/topic-research/briefs/${briefId}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load that brief.');
      setBrief(d.brief);
    } catch (e) { setError(e.message || 'Could not reach the server.'); } finally { setLoading(false); }
  }, [briefId]);
  useEffect(() => { setLoading(true); setBrief(null); setShowAngle(false); setAngle(''); setConfirmDelete(false); setSteer(''); load(); }, [load]);
  // the drafts already written from this brief (a deleted or restored draft announces itself with this event)
  const loadDrafts = useCallback(async () => {
    try {
      const r = await api.get(`/api/topic-research/briefs/${briefId}/drafts`);
      const d = await r.json();
      if (r.ok && Array.isArray(d.drafts)) setDrafts(d.drafts);
    } catch { /* the list simply stays as it was */ }
  }, [briefId]);
  useEffect(() => {
    loadDrafts();
    window.addEventListener('topic-research:drafts-changed', loadDrafts);
    return () => window.removeEventListener('topic-research:drafts-changed', loadDrafts);
  }, [loadDrafts]);

  const muted = { color: 'var(--color-muted)' };
  const text = { color: 'var(--color-text)' };

  if (loading) return <p className="text-sm" style={muted}>Loading…</p>;
  if (!brief) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => onBack(null)} className="text-sm hover:opacity-70 transition-opacity" style={muted}>← All topics</button>
        <p className="text-sm" style={{ color: '#ef4444' }}>{error || 'That brief could not be found.'}</p>
      </div>
    );
  }

  const c = brief.content;
  const sourceOf = new Map(brief.sources.map((s) => [s.url, s]));
  const numberOf = new Map(brief.sources.map((s, i) => [s.url, i + 1])); // the same numbers as the Sources list and the Markdown file
  const warning = overlapWarning(brief.overlap);

  const copy = async () => {
    try { await navigator.clipboard.writeText(brief.markdown); addToast('Copied as Markdown', 'success'); } catch { addToast('Could not copy. Use Download instead.', 'error'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([brief.markdown], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = brief.fileName || 'research-brief.md';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const regenerate = async (chosen) => {
    const want = (chosen ?? angle).trim();
    if (!want) return;
    try {
      const r = await withProgress({ title: 'Writing the brief…', detail: 'This can take up to a minute and a half.', steps: BRIEF_STEP_LABELS }, (opId) => api.post(`/api/topic-research/runs/${brief.runId}/brief`, { articleIds: brief.sources.map((s) => s.id), angle: want, opId }));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(explainFailure(r, d, 'Could not write the brief.'));
      onOpenBrief(d.brief.id);
    } catch (e) { setError(e.message || 'Could not reach the server.'); }
  };
  // A brief with little to write from makes a draft that is mostly gaps: say so first, and let the person go ahead or not.
  const askDraft = () => {
    const r = draftReadiness(brief.content);
    if (r.level === 'thin') { setThin(r); return; }
    writeDraft();
  };
  const writeDraft = async () => {
    setThin(null);
    try {
      const r = await withProgress({ title: 'Writing the draft…', detail: 'This can take up to a minute and a half.', steps: DRAFT_STEP_LABELS }, (opId) => api.post(`/api/topic-research/briefs/${brief.id}/draft`, { lengthChoice, steer, opId }));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(explainFailure(r, d, 'Could not write the draft.'));
      onOpenDraft(d.draft.id);
    } catch (e) { setError(e.message || 'Could not reach the server.'); }
  };
  const remove = async () => {
    try {
      const r = await api.delete(`/api/topic-research/briefs/${brief.id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not delete.');
      // the Results page lists a search's briefs: tell it now (it is about to show) and again after an Undo
      const announce = () => window.dispatchEvent(new Event('topic-research:briefs-changed'));
      offerUndo({ message: 'Brief deleted', binIds: d.binId, after: announce });
      onBack(brief.topicId);
      setTimeout(announce, 300);
    } catch (e) { setError(e.message || 'Could not reach the server.'); }
  };

  const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border hover:opacity-70 transition-opacity';
  const btnStyle = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' };

  return (
    <div className="space-y-2">
      <WorkflowBar view="brief" go={{ search: () => onBack(null), sources: () => onBack(brief.topicId) }} />
      <button type="button" onClick={() => onBack(brief.topicId)} className="text-sm hover:opacity-70 transition-opacity" style={muted}>← Back to the results</button>
      <h2 className="text-lg font-semibold break-words" style={text}>Research brief: {brief.keyword}</h2>
      <p className="text-xs" style={muted}>
        Made {formatDate(brief.createdAt)} from {brief.sources.length} article{brief.sources.length === 1 ? '' : 's'} · {brief.model}{costText(brief.costUsd) ? ` · ${costText(brief.costUsd)}` : ''}.
        {' '}Notes for writing your own piece, not text to publish. Check each fact against its sources before you use it.
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={copy} className={btn} style={btnStyle}>{getIcon('copy', { size: 14 })}Copy as Markdown</button>
        <button type="button" onClick={download} className={btn} style={btnStyle}>{getIcon('download', { size: 14 })}Download .md</button>
        <button type="button" onClick={() => setShowAngle((v) => !v)} className={btn} style={btnStyle}>{getIcon('refresh-cw', { size: 14 })}Another angle, same articles</button>
        {confirmDelete ? (
          <span className="inline-flex items-center gap-2 text-sm" style={muted}>
            Delete this brief?
            <button type="button" onClick={remove} className="font-medium hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Yes</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="font-medium hover:opacity-70 transition-opacity" style={text}>No</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className={btn} style={btnStyle} title="Kept in the recycle bin for 30 days">{getIcon('trash', { size: 14 })}Delete</button>
        )}
      </div>
      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}

      {showAngle && (
        <div className="rounded-xl border p-4 space-y-3 mt-2" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <p className="text-sm" style={text}>Write the outline for another angle, from the same articles. This makes a new brief and keeps this one. It reads the same sources, so it cannot make up for a poor set of them: to find better sources, search again with different words.</p>
          <div className="flex flex-wrap gap-2">
            {c.suggestedAngles.filter((a) => a.title !== c.chosenAngle).map((a) => (
              <button key={a.title} type="button" onClick={() => regenerate(a.title)} className={btn} style={btnStyle} title={a.why}>{a.title}</button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={angle} onChange={(e) => setAngle(e.target.value)} maxLength={200} placeholder="Or type your own angle" aria-label="Your own angle"
              onKeyDown={(e) => { if (e.key === 'Enter') regenerate(); }}
              className="flex-1 px-3 py-2.5 rounded-xl border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            <button type="button" onClick={() => regenerate()} disabled={!angle.trim()} className="px-3.5 py-2 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>Write it</button>
          </div>
        </div>
      )}

      <div className="rounded-xl border p-4 space-y-3 mt-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} data-tour="tr-draft">
        <p className="text-sm font-semibold" style={text}>Draft article</p>
        <p className="text-xs leading-relaxed" style={muted}>
          Turn this brief into a first draft to edit. It is built from this brief only (not from the articles), with a source number on every factual paragraph and a clear marker where the research has gaps. It is a starting point, not a finished article: check every fact before you use it.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Length of the draft">
          {DRAFT_LENGTHS.map((l) => (
            <button
              key={l.id} type="button" aria-pressed={lengthChoice === l.id} onClick={() => setLengthChoice(l.id)} title={l.tip}
              className="px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity"
              style={lengthChoice === l.id ? { background: 'var(--color-primary)', color: '#fff' } : { border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
            >{l.label}</button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <VoiceInput value={steer} onChange={setSteer} label="A note about what to stress" placeholder="Anything to stress? (optional)" maxLength={200} />
          </div>
          <button type="button" onClick={askDraft} className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity" style={{ background: 'var(--color-primary)', color: '#fff' }}>
            {getIcon('sparkles', { size: 14 })}Draft article
          </button>
        </div>
        <p className="text-xs leading-relaxed" style={muted}>The note shapes what the draft emphasises. It cannot add facts the brief does not have.</p>
        {thin && (
          <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: '#f59e0b', background: 'var(--color-bg)' }} role="alert">
            <p className="text-sm" style={text}>{thin.message}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setThin(null)} className={btn} style={btnStyle}>Not yet</button>
              <button type="button" onClick={() => onBack(null)} className={btn} style={btnStyle} title="Back to the topic list, where you can search again with different words">Search again with different words</button>
              <button type="button" onClick={writeDraft} className="px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity" style={{ background: 'var(--color-primary)', color: '#fff' }}>Draft anyway</button>
            </div>
          </div>
        )}
        {drafts.length > 0 && (
          <div>
            <p className="text-xs font-semibold" style={text}>Drafts already written from this brief</p>
            <ul className="mt-1 space-y-1">
              {drafts.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => onOpenDraft(d.id)} className="text-xs underline hover:opacity-70 transition-opacity text-left" style={{ color: 'var(--color-primary)' }}>{d.title || 'Draft'}</button>
                  <span className="text-xs" style={muted}> · {draftLine(d)} · {formatDate(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {warning && (
        <div className="rounded-xl border p-3 mt-3 space-y-1" style={{ borderColor: '#f59e0b', background: 'var(--color-surface)' }} role="alert">
          <p className="text-sm font-medium" style={text}>{warning}</p>
          {brief.overlap.map((o, i) => (
            <p key={`${o.field}-${i}`} className="text-xs break-words" style={muted}>
              <strong style={text}>{o.field}</strong>: &ldquo;{o.excerpt}…&rdquo; ({o.words} words match <a href={o.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">{o.sourceTitle || o.sourceUrl}</a>)
            </p>
          ))}
        </div>
      )}

      <H>Summary</H>
      <p className="text-sm leading-relaxed" style={text}>{c.summary}</p>

      <H>Key facts</H>
      <ul className="space-y-3">
        {c.keyFacts.map((f, i) => (
          <li key={i} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <p className="text-sm leading-relaxed" style={text}>{f.fact}</p>
            <p className="text-xs mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1" style={muted}>
              <span className="font-semibold px-1.5 py-0.5 rounded" style={{ border: '1px solid var(--color-border)', color: f.singleSource ? '#b45309' : 'var(--color-text)' }}>{factLabel(f)}</span>
              {f.sources.map((u) => {
                const s = sourceOf.get(u);
                return <a key={u} href={u} target="_blank" rel="noopener noreferrer" title={s?.title || u} className="underline hover:opacity-70 transition-opacity">[{numberOf.get(u) ?? '?'}] {s?.domain || u}</a>;
              })}
            </p>
          </li>
        ))}
      </ul>

      {c.anglesTaken.length > 0 && (<><H>Angles taken</H><ul className="space-y-1">{c.anglesTaken.map((a, i) => <li key={i} className="text-sm" style={text}><strong>{a.outlet}:</strong> {a.framing}</li>)}</ul></>)}
      {c.gaps.length > 0 && (<><H>Gaps</H><ul className="list-disc pl-5 space-y-1">{c.gaps.map((g, i) => <li key={i} className="text-sm" style={text}>{g}</li>)}</ul></>)}

      <H>Suggested angles for your site</H>
      <ol className="list-decimal pl-5 space-y-1">
        {c.suggestedAngles.map((a) => <li key={a.title} className="text-sm" style={text}><strong>{a.title}</strong>{a.why ? <span style={muted}>: {a.why}</span> : null}</li>)}
      </ol>

      <H>Outline: {c.chosenAngle}</H>
      <div className="space-y-3">
        {c.outline.map((o, i) => (
          <div key={i} style={{ marginLeft: o.level === 3 ? '1.25rem' : 0 }}>
            <p className="text-sm font-semibold" style={text}><span className="text-xs font-medium mr-2" style={muted}>H{o.level}</span>{o.heading}</p>
            {o.notes.length > 0 && <ul className="list-disc pl-5 mt-1 space-y-0.5">{o.notes.map((n, j) => <li key={j} className="text-sm" style={muted}>{n}</li>)}</ul>}
          </div>
        ))}
      </div>

      <H>Keywords</H>
      <p className="text-sm" style={text}><strong>Main:</strong> {c.keywords.primary}</p>
      {c.keywords.related.length > 0 && <p className="text-sm" style={muted}>Related: {c.keywords.related.join(', ')}</p>}

      <H>Sources</H>
      <ol className="list-decimal pl-5 space-y-1">
        {brief.sources.map((s) => (
          <li key={s.id} className="text-sm break-words" style={text}>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>{s.title || s.url}</a>
            <span style={muted}> · {s.domain}</span>
          </li>
        ))}
      </ol>

      <PromptPanel prompt={brief.prompt} kept={!!brief.prompt} label="What the AI was asked to write this brief" />
    </div>
  );
}
