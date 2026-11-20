import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { ExportButton, Pill, card, fmt, fmtSecs, fmtWhen } from './shared';
import { aiReviewCsv, aiReviewMd, datedName } from './exportRun.mjs';

// Code Map "AI review" tab: where the server calls a model and whether plain code would do the job (server/services/codeMap/aiReview.js).
// Runs only when the admin presses Run review (inline confirm with the number of model calls); polls the running review every 3 seconds.

const POLL_MS = 3000;
const toast = (message, type = 'error') => useToastStore.getState().addToast(message, type);
export const VERDICT = {
  replace: { color: '#ef4444', label: 'Replace', tip: 'Plain code would do this as well or better: cheaper, faster and predictable.' },
  hybrid: { color: '#f59e0b', label: 'Hybrid', tip: 'Plain code for the common cases, the model only for the rest.' },
  unclear: { color: 'var(--color-muted)', label: 'Unclear', tip: 'The review could not tell from the code it saw (for example the prompt is built in another file).' },
  keep: { color: '#16a34a', label: 'Keep', tip: 'The task needs the model: open-ended writing, summaries or judgement on messy text.' },
};
const ORDER = ['replace', 'hybrid', 'unclear', 'keep'];
const RANK = { high: 0, medium: 1, low: 2 };
const BTN = 'text-sm font-medium px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 hover:opacity-70 transition-opacity duration-200 disabled:opacity-50';

async function json(res, fallback) {
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error || fallback), { status: res.status, body: d });
  return d;
}

export default function AiReviewView({ byId, onOpenTool }) {
  const getIcon = useIcon();
  const [review, setReview] = useState(undefined); // latest finished review (null before the first)
  const [estimate, setEstimate] = useState(null);
  const [active, setActive] = useState(null); // { id, progress }
  const [confirm, setConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const [lastFailed, setLastFailed] = useState(null);
  const [show, setShow] = useState('replace');

  const load = useCallback(async () => {
    try {
      const [l, list, e] = await Promise.all([
        api.get('/api/code-map/ai-reviews/latest').then((r) => json(r, 'Could not load the AI review.')),
        api.get('/api/code-map/ai-reviews').then((r) => json(r, 'Could not load the AI reviews.')),
        api.get('/api/code-map/ai-reviews/estimate').then((r) => json(r, 'Could not count the call sites.')),
      ]);
      setReview(l.review || null);
      setEstimate(e);
      const newest = (list.reviews || [])[0];
      if (newest && newest.status === 'running') setActive({ id: newest.id, progress: newest.progress });
      setLastFailed(newest && newest.status === 'failed' ? newest : null);
    } catch (err) {
      setReview((r) => (r === undefined ? null : r));
      toast(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const activeId = active?.id;
  useEffect(() => {
    if (!activeId) return undefined;
    let stop = false;
    let timer;
    const tick = async () => {
      try {
        const { review: r } = await json(await api.get(`/api/code-map/ai-reviews/${activeId}`), 'Lost track of the review.');
        if (stop) return;
        if (r.status === 'running') { setActive({ id: r.id, progress: r.progress }); timer = setTimeout(tick, POLL_MS); return; }
        setActive(null);
        if (r.status === 'done') toast(`AI review finished: ${r.summary?.replace || 0} to replace, ${r.summary?.hybrid || 0} hybrid.`, 'success');
        else toast(r.error ? `The AI review failed: ${r.error}` : 'The AI review failed.');
        load();
      } catch (err) {
        if (!stop) { setActive(null); toast(err.message); }
      }
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { stop = true; clearTimeout(timer); };
  }, [activeId, load]);

  const start = async () => {
    setConfirm(false);
    setStarting(true);
    try {
      const r = await api.post('/api/code-map/ai-reviews', {});
      const d = await r.json().catch(() => ({}));
      if (r.status === 202) setActive({ id: d.id, progress: null });
      else if (r.status === 409 && d.runningId) { setActive({ id: d.runningId, progress: null }); toast('A review is already running; showing its progress.', 'warn'); }
      else toast(d.error || 'Could not start the review.');
    } catch (_) {
      toast('Could not start the review.');
    } finally {
      setStarting(false);
    }
  };

  const sites = useMemo(() => (review?.result?.files || []).flatMap((f) => f.sites.map((s) => ({ ...s, tool: f.tool }))), [review]);
  const shown = useMemo(() => sites.filter((s) => s.verdict === show)
    .sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || RANK[a.saving] - RANK[b.saving] || a.file.localeCompare(b.file) || a.line - b.line), [sites, show]);
  const failedFiles = (review?.result?.files || []).filter((f) => f.error);
  const s = review?.summary || {};
  const busy = starting || !!active;
  const p = active?.progress;

  if (review === undefined) return <Skeleton lines={6} className="h-10" label="Loading the AI review" />;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border p-5 space-y-3" style={card} data-guide="run-ai-review">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-3xl">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Where plain code would beat a model call</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
              Every place the server calls an AI model, judged by the standard model in Settings: replace with plain code, a hybrid, or keep. It runs only when you press the button. Files that have not changed since the last review keep their verdicts and cost nothing.
            </p>
            <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
              {review
                ? <>Last run {fmtWhen(review.finishedAt)} · {review.model} · {fmt(s.sites)} call sites in {fmt(s.files)} files · {fmt(review.result?.modelCalls)} model calls ({fmt(s.reusedFiles)} files reused) · {fmt((review.inputTokens || 0) + (review.outputTokens || 0))} tokens{review.costUsd != null ? ` · about US$${review.costUsd.toFixed(2)}` : ''} · took {fmtSecs(review.durationMs)}</>
                : 'Not run yet.'}
              {estimate ? <> · now: {fmt(estimate.sites)} call sites, {fmt(estimate.toReview)} files changed since the last review</> : null}
            </p>
            {lastFailed && !active && <p className="text-xs mt-1" style={{ color: '#ef4444' }}>The last attempt ({fmtWhen(lastFailed.finishedAt || lastFailed.createdAt)}) failed: {lastFailed.error || 'unknown error'}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {active ? (
              <div className="min-w-[220px]" role="status" aria-live="polite">
                <div className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>{p?.total ? `File ${p.done} of ${p.total}` : 'Starting'}… the page stays usable</div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                  <span className="block h-full transition-all duration-200" style={{ width: `${Math.max(4, p?.total ? (p.done / p.total) * 100 : 0)}%`, background: 'var(--color-primary)' }} />
                </div>
              </div>
            ) : confirm ? (
              <span className="text-sm flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                {estimate?.calls ? `About ${fmt(estimate.calls)} model call${estimate.calls === 1 ? '' : 's'}. Run?` : 'Nothing has changed, so no model calls. Run?'}
                <button type="button" onClick={start} className={BTN} style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>Yes</button>
                <button type="button" onClick={() => setConfirm(false)} className="text-sm px-2 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>No</button>
              </span>
            ) : (
              <Tooltip text={estimate ? `Reviews the ${fmt(estimate.toReview)} changed files: about ${fmt(estimate.calls)} model calls, counted in Usage as code_map_ai_review.` : 'Review every AI call site.'}>
                <button type="button" onClick={() => setConfirm(true)} disabled={busy} className={BTN} style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
                  {getIcon(busy ? 'loader' : 'sparkles', { size: 14, className: busy ? 'animate-spin' : undefined })}{busy ? 'Running…' : 'Run review'}
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </section>

      {!review ? (
        <EmptyState icon="code-map" title="No AI review yet" body="Run review checks each AI call site once. Later runs only check files that changed." />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Verdict" className="flex flex-wrap gap-1.5">
              {ORDER.map((v) => (
                <Tooltip key={v} text={VERDICT[v].tip}>
                  <button
                    type="button" onClick={() => setShow(v)} aria-pressed={show === v}
                    className="text-xs px-3 py-1 rounded-full border hover:opacity-70 transition-opacity duration-200"
                    style={show === v
                      ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }
                      : { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    {VERDICT[v].label} ({fmt(s[v] || 0)})
                  </button>
                </Tooltip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <ExportButton label="Copy review" what="AI review" getText={() => aiReviewMd(review)} tip="Copy every verdict, grouped replace, hybrid, unclear, keep, as Markdown." />
              <ExportButton kind="download" label="Download CSV" name={datedName('vault-ai-review', 'csv', review.finishedAt)} type="text/csv" getText={() => aiReviewCsv(review)} tip="Every call site and its verdict as a spreadsheet file." />
            </div>
          </div>

          {!shown.length ? (
            <EmptyState icon="check" title={`No "${VERDICT[show].label}" verdicts`} body="Pick another verdict above." />
          ) : (
            <ul className="space-y-3">
              {shown.map((x) => {
                const tool = x.tool && byId[x.tool];
                return (
                  <li key={`${x.file}:${x.line}`} className="rounded-xl border p-4 space-y-1.5" style={{ ...card, borderLeft: `4px solid ${VERDICT[x.verdict].color}` }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill color={VERDICT[x.verdict].color} tip={VERDICT[x.verdict].tip}>{VERDICT[x.verdict].label}</Pill>
                      <Pill tip="How sure the review is.">{x.confidence} confidence</Pill>
                      {x.verdict !== 'keep' && <Pill tip="How much cost and delay replacing it would save.">{x.saving} saving</Pill>}
                      {tool ? (
                        <Tooltip text={`Open ${tool.label} in the Code Map.`}>
                          <button type="button" onClick={() => onOpenTool(tool.id)} className="text-xs hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }}>{tool.label}</button>
                        </Tooltip>
                      ) : <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{x.tool === 'shared' ? 'shared code' : 'no single tool'}</span>}
                    </div>
                    <div className="font-mono text-xs break-all" style={{ color: 'var(--color-primary)' }}>{x.file}:{x.line} <span style={{ color: 'var(--color-muted)' }}>{x.text}</span></div>
                    {x.does && <p className="text-sm" style={{ color: 'var(--color-text)' }}>{x.does}</p>}
                    {x.why && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{x.why}</p>}
                    {x.alternative && <p className="text-sm" style={{ color: 'var(--color-text)' }}><strong>Instead:</strong> {x.alternative}</p>}
                  </li>
                );
              })}
            </ul>
          )}

          {failedFiles.length > 0 && (
            <p className="text-xs" style={{ color: '#ef4444' }}>
              {failedFiles.length} file{failedFiles.length === 1 ? '' : 's'} could not be reviewed (their sites show as Unclear and are tried again next run): {failedFiles.map((f) => `${f.file} (${f.error})`).join('; ')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
