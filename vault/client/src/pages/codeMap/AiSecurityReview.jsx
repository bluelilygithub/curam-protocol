import React, { useMemo, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { ExportButton, Pill, SEV_COLOR, card, fmt, fmtSecs, fmtWhen } from './shared';
import { aiSecurityCsv, aiSecurityMd, datedName } from './exportRun.mjs';
import useReviewJob from './useReviewJob';

// Security tab, layer 2: the AI security review (server/services/codeMap/aiReview.js kind "security"). The standard model reads every route
// file in 500-line parts and reports concrete problems (access, injection, SSRF, uploads, XSS, secrets, validation). Button only, with an
// inline confirm showing the model calls and the code size; unchanged files keep their findings at no cost. Advice to check, not proof.

const SEVS = ['high', 'medium', 'low'];
const RANK = { high: 0, medium: 1, low: 2 };
const CATEGORY = {
  access: 'Access', injection: 'Injection', ssrf: 'SSRF', upload: 'Upload', xss: 'XSS', secrets: 'Secrets', validation: 'Validation', other: 'Other',
};
const BTN = 'text-sm font-medium px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 hover:opacity-70 transition-opacity duration-200 disabled:opacity-50';
const doneMessage = (r) => `AI security review finished: ${r.summary?.high || 0} high, ${r.summary?.medium || 0} medium, ${r.summary?.low || 0} low.`;

export default function AiSecurityReview({ byId, onOpenTool }) {
  const getIcon = useIcon();
  const job = useReviewJob('security', { doneMessage });
  const { review, estimate, active, lastFailed, busy } = job;
  const [confirm, setConfirm] = useState(false);
  const [show, setShow] = useState('high');
  const start = () => { setConfirm(false); job.start(); };

  const all = useMemo(() => (review?.result?.files || []).flatMap((f) => f.sites.map((x) => ({ ...x, tool: f.tool }))), [review]);
  const shown = useMemo(() => all.filter((x) => x.severity === show)
    .sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || a.file.localeCompare(b.file) || a.line - b.line), [all, show]);
  const failedFiles = (review?.result?.files || []).filter((f) => f.error);
  const s = review?.summary || {};
  const p = active?.progress;

  return (
    <section className="space-y-3" data-guide="ai-security-review">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>AI security review</h2>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            The standard model in Settings reads every route file and reports concrete problems the pattern checks cannot judge: one user reaching another's data, missing admin checks, injection, unsafe uploads, SSRF, leaked secrets. It runs only when you press the button and costs model calls; files unchanged since the last review keep their findings for free. Findings are a model's reading of the code: check each one.
          </p>
          <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
            {review === undefined ? 'Loading…' : review
              ? <>Last run {fmtWhen(review.finishedAt)} · {review.model} · {fmt(s.files)} route files · {fmt(review.result?.modelCalls)} model calls ({fmt(s.reusedFiles)} files reused) · {fmt((review.inputTokens || 0) + (review.outputTokens || 0))} tokens{review.costUsd != null ? ` · about US$${review.costUsd.toFixed(2)}` : ''} · took {fmtSecs(review.durationMs)}</>
              : 'Not run yet.'}
            {estimate ? <> · now: {fmt(estimate.toReview)} of {fmt(estimate.files)} files changed since the last review</> : null}
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
            <span className="text-sm flex flex-wrap items-center gap-2" style={{ color: 'var(--color-text)' }}>
              {estimate?.calls ? `About ${fmt(estimate.calls)} model calls over roughly ${fmt(estimate.approxInputTokens)} tokens of code. Run?` : 'Nothing has changed, so no model calls. Run?'}
              <button type="button" onClick={start} className={BTN} style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>Yes</button>
              <button type="button" onClick={() => setConfirm(false)} className="text-sm px-2 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>No</button>
            </span>
          ) : (
            <Tooltip text={estimate ? `Reviews the ${fmt(estimate.toReview)} changed route files: about ${fmt(estimate.calls)} model calls, counted in Usage as code_map_ai_security. Only one AI review runs at a time.` : 'Review every route file.'}>
              <button type="button" onClick={() => setConfirm(true)} disabled={busy || review === undefined} className={BTN} style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
                {getIcon(busy ? 'loader' : 'sparkles', { size: 14, className: busy ? 'animate-spin' : undefined })}{busy ? 'Reviewing…' : 'Run AI security review'}
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {review === undefined ? <Skeleton lines={3} label="Loading the AI security review" /> : review && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Severity" className="flex flex-wrap gap-1.5">
              {SEVS.map((v) => (
                <Tooltip key={v} text={`Show the ${v}-severity findings, surest first.`}>
                  <button
                    type="button" onClick={() => setShow(v)} aria-pressed={show === v}
                    className="text-xs px-3 py-1 rounded-full border hover:opacity-70 transition-opacity duration-200"
                    style={show === v
                      ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }
                      : { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    {v[0].toUpperCase() + v.slice(1)} ({fmt(s[v] || 0)})
                  </button>
                </Tooltip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <ExportButton label="Copy findings" what="AI security review" getText={() => aiSecurityMd(review)} tip="Copy every finding, high first, as Markdown." />
              <ExportButton kind="download" label="Download CSV" name={datedName('vault-ai-security', 'csv', review.finishedAt)} type="text/csv" getText={() => aiSecurityCsv(review)} tip="Every finding as a spreadsheet file." />
            </div>
          </div>

          {!shown.length ? (
            <EmptyState icon="check" title={`No ${show}-severity findings`} body="Pick another severity above." />
          ) : (
            <ul className="space-y-3">
              {shown.map((x) => {
                const tool = x.tool && byId[x.tool];
                return (
                  <li key={x.key || `${x.file}:${x.line}:${x.title}`} className="rounded-xl border p-4 space-y-1.5" style={{ ...card, borderLeft: `4px solid ${SEV_COLOR[x.severity]}` }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill color={SEV_COLOR[x.severity]} tip="How bad it would be if real.">{x.severity}</Pill>
                      <Pill tip="The kind of problem.">{CATEGORY[x.category] || x.category}</Pill>
                      <Pill tip="How sure the review is. Low often means the check may be in a helper it could not see.">{x.confidence} confidence</Pill>
                      {tool && (
                        <Tooltip text={`Open ${tool.label} in the Code Map.`}>
                          <button type="button" onClick={() => onOpenTool(tool.id)} className="text-xs hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }}>{tool.label}</button>
                        </Tooltip>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{x.title}</h3>
                    <div className="font-mono text-xs break-all" style={{ color: 'var(--color-primary)' }}>{x.file}:{x.line} <span style={{ color: 'var(--color-muted)' }}>{x.text}</span></div>
                    {x.why && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{x.why}</p>}
                    {x.fix && <p className="text-sm" style={{ color: 'var(--color-text)' }}><strong>Fix:</strong> {x.fix}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          {failedFiles.length > 0 && (
            <p className="text-xs" style={{ color: '#ef4444' }}>
              {failedFiles.length} file{failedFiles.length === 1 ? '' : 's'} could not be reviewed and will be tried again next run: {failedFiles.map((f) => `${f.file} (${f.error})`).join('; ')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
