import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { withProgress } from './withProgress';
import WorkflowBar from './WorkflowBar';
import useToastStore from '../../store/toastStore';
import { offerUndo } from '../../utils/binUndo';
import { useIcon } from '../../providers/IconProvider';
import { DRAFT_STEP_LABELS, costText, draftLine, formatDate } from './format.mjs';

// One article draft: a first draft built from a research brief, to edit. Each factual paragraph carries source numbers that match the Sources
// list; places the research could not fill are marked; a warning comes first if the draft repeats wording from a source or from the brief.
// Copy and download give the same Markdown the server writes. It is read-only: edit the copy where you write.
export default function DraftView({ draftId, onBack, onOpenDraft, onGoSearch, onGoResults }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await api.get(`/api/topic-research/drafts/${draftId}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load that draft.');
      setDraft(d.draft);
    } catch (e) { setError(e.message || 'Could not reach the server.'); } finally { setLoading(false); }
  }, [draftId]);
  useEffect(() => { setLoading(true); setDraft(null); setConfirmDelete(false); load(); }, [load]);

  const muted = { color: 'var(--color-muted)' };
  const text = { color: 'var(--color-text)' };

  if (loading) return <p className="text-sm" style={muted}>Loading…</p>;
  if (!draft) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => onBack(null)} className="text-sm hover:opacity-70 transition-opacity" style={muted}>← All topics</button>
        <p className="text-sm" style={{ color: '#ef4444' }}>{error || 'That draft could not be found.'}</p>
      </div>
    );
  }

  const c = draft.content;
  const numberOf = new Map(draft.sources.map((s, i) => [s.url, i + 1])); // the same numbers as the Sources list and the Markdown file
  const sourceOf = new Map(draft.sources.map((s) => [s.url, s]));

  const copy = async () => {
    try { await navigator.clipboard.writeText(draft.markdown); addToast('Copied as Markdown', 'success'); } catch { addToast('Could not copy. Use Download instead.', 'error'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([draft.markdown], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = draft.fileName || 'draft.md';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const another = async () => {
    try {
      const r = await withProgress({ title: 'Writing the draft…', detail: 'This can take up to a minute and a half.', steps: DRAFT_STEP_LABELS }, (opId) => api.post(`/api/topic-research/briefs/${draft.briefId}/draft`, { lengthChoice: draft.lengthChoice, steer: draft.steer, opId }));
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not write the draft.');
      onOpenDraft(d.draft.id);
    } catch (e) { setError(e.message || 'Could not reach the server.'); }
  };
  const remove = async () => {
    try {
      const r = await api.delete(`/api/topic-research/drafts/${draft.id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not delete.');
      const announce = () => window.dispatchEvent(new Event('topic-research:drafts-changed'));
      offerUndo({ message: 'Draft deleted', binIds: d.binId, after: announce });
      onBack(draft.briefId);
      setTimeout(announce, 300);
    } catch (e) { setError(e.message || 'Could not reach the server.'); }
  };

  const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border hover:opacity-70 transition-opacity';
  const btnStyle = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' };
  const gaps = draft.gapCount;

  return (
    <div className="space-y-2">
      <WorkflowBar view="draft" go={{ search: onGoSearch, sources: () => onGoResults(draft.topicId), brief: () => onBack(draft.briefId) }} />
      <button type="button" onClick={() => onBack(draft.briefId)} className="text-sm hover:opacity-70 transition-opacity" style={muted}>← Back to the brief</button>
      <h2 className="text-lg font-semibold break-words" style={text}>{c.title}</h2>
      <p className="text-xs" style={muted}>
        Draft made {formatDate(draft.createdAt)} for &ldquo;{draft.keyword}&rdquo; · {draftLine(draft)} · {draft.lengthChoice} · {draft.model}{costText(draft.costUsd) ? ` · ${costText(draft.costUsd)}` : ''}.
        {' '}A starting point built from your research brief, for you to edit. Check every fact against its sources before you publish.
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={copy} className={btn} style={btnStyle}>{getIcon('copy', { size: 14 })}Copy as Markdown</button>
        <button type="button" onClick={download} className={btn} style={btnStyle}>{getIcon('download', { size: 14 })}Download .md</button>
        <button type="button" onClick={another} className={btn} style={btnStyle} title="Writes a new draft from the same brief and keeps this one">{getIcon('refresh-cw', { size: 14 })}Write another</button>
        {confirmDelete ? (
          <span className="inline-flex items-center gap-2 text-sm" style={muted}>
            Delete this draft?
            <button type="button" onClick={remove} className="font-medium hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Yes</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="font-medium hover:opacity-70 transition-opacity" style={text}>No</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className={btn} style={btnStyle} title="Kept in the recycle bin for 30 days">{getIcon('trash', { size: 14 })}Delete</button>
        )}
      </div>
      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}

      {(gaps > 0 || draft.overlap.length > 0) && (
        <div className="rounded-xl border p-3 mt-3 space-y-1" style={{ borderColor: '#f59e0b', background: 'var(--color-surface)' }} role="alert">
          {gaps > 0 && <p className="text-sm font-medium" style={text}>{gaps} place{gaps === 1 ? '' : 's'} marked &ldquo;needs your input&rdquo; for you to fill.</p>}
          {draft.overlap.length > 0 && (
            <>
              <p className="text-sm font-medium" style={text}>Part of this draft repeats wording from a source or from the brief. Rewrite {draft.overlap.length === 1 ? 'it' : 'them'} in your own words.</p>
              {draft.overlap.map((o, i) => (
                <p key={`${o.field}-${i}`} className="text-xs break-words" style={muted}>
                  <strong style={text}>{o.field}</strong>: &ldquo;{o.excerpt}…&rdquo; ({o.words} words match {o.sourceUrl === 'brief' ? 'your research brief' : <a href={o.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">{o.sourceTitle || o.sourceUrl}</a>})
                </p>
              ))}
            </>
          )}
        </div>
      )}

      <div className="mt-4 space-y-5">
        {c.sections.map((s, i) => (
          <section key={i} className="space-y-2">
            {s.heading && <h3 className="text-base font-semibold" style={text}>{s.heading}</h3>}
            {s.paragraphs.map((p, j) => (p.kind === 'gap' ? (
              <p key={j} className="text-sm leading-relaxed rounded-lg border p-3" style={{ borderColor: '#f59e0b', borderStyle: 'dashed', color: 'var(--color-text)' }}>
                <strong style={{ color: '#b45309' }}>[needs your input]</strong> {p.text}
              </p>
            ) : (
              <p key={j} className="text-sm leading-relaxed" style={text}>
                {p.text}
                {p.sources.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noopener noreferrer" title={sourceOf.get(u)?.title || u} className="ml-1 text-xs underline hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>[{numberOf.get(u) ?? '?'}]</a>
                ))}
              </p>
            )))}
          </section>
        ))}
      </div>

      <h3 className="text-base font-semibold mt-6 mb-2" style={text}>Sources</h3>
      <ol className="list-decimal pl-5 space-y-1">
        {draft.sources.map((s) => (
          <li key={s.id} className="text-sm break-words" style={text}>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>{s.title || s.url}</a>
            <span style={muted}> · {s.domain}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
