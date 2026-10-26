import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { withProgress } from './withProgress';
import PromptPanel from './PromptPanel';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import { explainFailure, REVIEW_STEP_LABELS, REVIEW_ACTION_LABELS, costText, formatDate } from './format.mjs';

// "Structure verdict": a second model's opinion on how to structure the essay, made from the brief and this draft's backbone (never the
// articles' text). Advice for the writer, not text to publish. Earlier verdicts are listed; the request can also be copied out and pasted into
// any other AI. `draftModel` is the model that wrote the draft: if the verdict came from the same one, say so.
export default function ReviewPanel({ draftId, draftModel }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [list, setList] = useState([]);
  const [current, setCurrent] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const open = useCallback(async (id) => {
    try {
      const r = await api.get(`/api/topic-research/reviews/${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load that verdict.');
      setCurrent(d.review);
    } catch (e) { setError(e.message || 'Could not reach the server.'); }
  }, []);
  const loadList = useCallback(async (openFirst) => {
    try {
      const r = await api.get(`/api/topic-research/drafts/${draftId}/reviews`);
      const d = await r.json();
      if (r.ok && Array.isArray(d.reviews)) {
        setList(d.reviews);
        if (openFirst && d.reviews[0]) await open(d.reviews[0].id);
      }
    } catch { /* the list simply stays as it was */ }
  }, [draftId, open]);
  useEffect(() => { setCurrent(null); setError(''); loadList(true); }, [draftId, loadList]);

  const make = async () => {
    setError(''); setBusy(true);
    try {
      const r = await withProgress({ title: 'Getting a second opinion…', detail: 'This can take up to a minute.', steps: REVIEW_STEP_LABELS }, (opId) => api.post(`/api/topic-research/drafts/${draftId}/review`, { opId }));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(explainFailure(r, d, 'Could not get a verdict.'));
      setCurrent(d.review);
      await loadList(false);
    } catch (e) { setError(e.message || 'Could not reach the server.'); } finally { setBusy(false); }
  };
  const copyRequest = async () => {
    try {
      const r = await api.get(`/api/topic-research/drafts/${draftId}/review-prompt`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not build the request.');
      await navigator.clipboard.writeText(d.text);
      addToast('Request copied. Paste it into any AI', 'success');
    } catch (e) { addToast(e.message || 'Could not copy.', 'error'); }
  };
  const copyVerdict = async () => {
    try { await navigator.clipboard.writeText(current.markdown); addToast('Copied as Markdown', 'success'); } catch { addToast('Could not copy.', 'error'); }
  };

  const muted = { color: 'var(--color-muted)' };
  const text = { color: 'var(--color-text)' };
  const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border hover:opacity-70 transition-opacity disabled:opacity-40';
  const btnStyle = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' };
  const c = current?.content;
  const srcOf = new Map((current?.sources || []).map((s) => [s.number, s]));
  const chips = (nums) => (nums || []).map((n) => (
    <span key={n} title={srcOf.get(n) ? `${srcOf.get(n).title} (${srcOf.get(n).domain})` : `Source ${n}`} className="text-xs px-1.5 py-0.5 rounded" style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>[{n}] {srcOf.get(n)?.domain || ''}</span>
  ));
  const H = ({ children }) => <h4 className="text-sm font-semibold mt-4 mb-1.5" style={text}>{children}</h4>;

  return (
    <section id="tr-review" className="rounded-xl border p-4 space-y-3 mt-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', scrollMarginTop: '9rem' }} data-guide="review">
      <h3 className="text-base font-semibold" style={text}>Structure verdict: a second opinion</h3>
      <p className="text-xs leading-relaxed" style={muted}>
        Another AI model reads your research brief and this draft&apos;s backbone (what is sourced, what still needs your input) and says how it would structure the essay. It never sees the articles&apos; text. It is advice for you to weigh, not text to publish, and it can be wrong. You choose the model in Settings; a different one from the model that wrote the draft gives a truer second opinion.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={make} disabled={busy} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>
          {getIcon('sparkles', { size: 14 })}{list.length ? 'Get another opinion' : 'Get a second opinion'}
        </button>
        <button type="button" onClick={copyRequest} className={btn} style={btnStyle} title="Copies the exact request (the rules and your brief and draft backbone) so you can paste it into any other AI yourself. No model is called.">
          {getIcon('copy', { size: 14 })}Copy the request for another AI
        </button>
      </div>
      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}

      {list.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Earlier verdicts">
          <span className="text-xs" style={muted}>Verdicts for this draft:</span>
          {list.map((v) => (
            <button key={v.id} type="button" aria-pressed={current?.id === v.id} onClick={() => open(v.id)} className="px-2.5 py-1 rounded-full text-xs font-medium hover:opacity-70 transition-opacity"
              style={current?.id === v.id ? { background: 'var(--color-primary)', color: '#fff' } : { border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{v.model || 'Verdict'} · {formatDate(v.createdAt)}</button>
          ))}
        </div>
      )}

      {c && (
        <div data-guide="review-result">
          <p className="text-xs" style={muted}>
            Made {formatDate(current.createdAt)} by {current.model}{costText(current.costUsd) ? ` · ${costText(current.costUsd)}` : ''}.
            {draftModel && current.model === draftModel ? ' This is the same model that wrote the draft: choose a different one in Settings for a real second opinion.' : ''}
          </p>
          <H>Verdict</H>
          <p className="text-sm leading-relaxed" style={text}>{c.verdict}</p>
          {c.thesis && <p className="text-sm mt-2" style={text}><strong>Thesis to argue:</strong> {c.thesis}</p>}
          {c.titleOptions.length > 0 && (<><H>Working titles</H><ul className="list-disc pl-5 space-y-0.5">{c.titleOptions.map((t) => <li key={t} className="text-sm" style={text}>{t}</li>)}</ul></>)}
          <H>Recommended structure</H>
          <ol className="space-y-2">
            {c.structure.map((s, i) => (
              <li key={`${i}-${s.heading}`} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="text-sm font-semibold" style={text}>{i + 1}. {s.heading}</p>
                {s.purpose && <p className="text-xs mt-0.5" style={muted}>{s.purpose}</p>}
                {s.contents && <p className="text-sm mt-1.5" style={text}>{s.contents}</p>}
                {s.sources.length > 0 && <p className="mt-1.5 flex flex-wrap gap-1.5">{chips(s.sources)}</p>}
                {s.writerInput && <p className="text-xs mt-1.5 px-2 py-1 rounded" style={{ border: '1px dashed #f59e0b', color: 'var(--color-text)' }}><strong>Needs your input:</strong> {s.writerInput}</p>}
              </li>
            ))}
          </ol>
          {c.moves.length > 0 && (<><H>Changes to the current draft</H><ul className="space-y-1">{c.moves.map((m, i) => <li key={i} className="text-sm" style={text}><span className="text-xs font-semibold px-1.5 py-0.5 rounded mr-2" style={{ border: '1px solid var(--color-border)' }}>{REVIEW_ACTION_LABELS[m.action] || m.action}</span>{m.detail}</li>)}</ul></>)}
          {c.missingEvidence.length > 0 && (<><H>Evidence still missing</H><ul className="list-disc pl-5 space-y-0.5">{c.missingEvidence.map((x, i) => <li key={i} className="text-sm" style={text}>{x}</li>)}</ul></>)}
          {c.risks.length > 0 && (<><H>Risks</H><ul className="list-disc pl-5 space-y-0.5">{c.risks.map((x, i) => <li key={i} className="text-sm" style={text}>{x}</li>)}</ul></>)}
          {(c.fromOutside || []).length > 0 && (
            <div className="mt-4 rounded-xl border p-3" style={{ borderColor: '#f59e0b', background: 'var(--color-bg)' }} data-guide="review-outside">
              <h4 className="text-sm font-semibold mb-1" style={text}>From the AI&apos;s own knowledge, not your sources</h4>
              <p className="text-xs mb-1.5" style={muted}>Nothing in your brief supports these. Check them yourself before you use them.</p>
              <ul className="list-disc pl-5 space-y-0.5">{c.fromOutside.map((x, i) => <li key={i} className="text-sm" style={text}>{x}</li>)}</ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-4">
            <button type="button" onClick={copyVerdict} className={btn} style={btnStyle}>{getIcon('copy', { size: 14 })}Copy verdict as Markdown</button>
          </div>
          <PromptPanel prompt={current.prompt} kept={!!current.prompt} label="What the AI was asked for this verdict" />
        </div>
      )}
    </section>
  );
}
