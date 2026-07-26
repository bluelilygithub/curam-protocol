import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Side-by-side (and optional three-way) compare with synced scroll.
 * Pass colors: local (blue) vs frontier (pink).
 */
export default function DocumentRedactionCompare({
  compare,
  coherence,
  frontierAnalysis,
  frontierInstructions,
  onFrontierInstructionsChange,
  onRunFrontier,
  onRunCoherence,
  onRetryPdf,
  onFixLeftovers,
  onApproveFrontier,
  onApproveFinal,
  onDownload,
  onChangeStyle,
  onBackToReview,
  onReviewFrontierSuggestions,
  onApplyFrontier,
  briefSummary,
  briefFull,
  briefIntents,
  lastStyleLabel,
}) {
  const paneRefs = useRef([]);
  const syncing = useRef(false);
  const [focusRow, setFocusRow] = useState(null);
  const threeWay = Boolean(compare?.threeWay?.available && compare.threeWay.rows?.length);
  const [layout, setLayout] = useState(threeWay ? 'three' : 'two');

  useEffect(() => {
    if (threeWay) setLayout('three');
  }, [threeWay]);

  function syncScroll(source) {
    if (!source || syncing.current) return;
    syncing.current = true;
    const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
    for (const el of paneRefs.current) {
      if (!el || el === source) continue;
      el.scrollTop = ratio * Math.max(0, el.scrollHeight - el.clientHeight);
    }
    requestAnimationFrame(() => { syncing.current = false; });
  }

  useEffect(() => {
    const panes = paneRefs.current.filter(Boolean);
    if (!panes.length) return undefined;
    const handlers = panes.map((el) => {
      const fn = () => syncScroll(el);
      el.addEventListener('scroll', fn);
      return { el, fn };
    });
    return () => {
      handlers.forEach(({ el, fn }) => el.removeEventListener('scroll', fn));
    };
  }, [compare?.rows?.length, compare?.threeWay?.rows?.length, layout]);

  useEffect(() => {
    if (focusRow == null) return undefined;
    const el = paneRefs.current[paneRefs.current.length - 1]?.querySelector(`[data-row-index="${focusRow}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '2px solid #ef4444';
      const t = setTimeout(() => { el.style.outline = ''; }, 1600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [focusRow]);

  const pdfReady = Boolean(compare?.pdfReady);
  const leftoversOutstanding = Boolean(compare?.leftoversOutstanding || compare?.leftovers?.length);
  const approved = Boolean(compare?.job?.frontierApprovedAt);
  const finalApproved = Boolean(compare?.job?.finalApprovedAt);
  const canApprove = Boolean(compare?.canApproveForFrontier) && !leftoversOutstanding && pdfReady;
  const canApproveFinal = Boolean(compare?.canApproveFinal);
  const showThree = layout === 'three' && threeWay;
  const rows = showThree ? (compare.threeWay.rows || []) : (compare?.rows || []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="shrink-0 px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {showThree ? 'Three-way compare — original / local / final' : 'Compare — local redaction pass'}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
            {showThree
              ? `${compare.threeWay.stats?.changedLocal ?? 0} local changes · ${compare.threeWay.stats?.changedFinal ?? 0} frontier deltas`
              : `${compare?.stats?.changedParagraphs ?? 0} changed paragraphs · ${compare?.stats?.highlightSpans ?? 0} substitutions highlighted`}
            {compare?.stats?.leftoverRealValueHits ? ` · ${compare.stats.leftoverRealValueHits} possible leftover(s)` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {threeWay && (
            <button
              type="button"
              onClick={() => setLayout(layout === 'three' ? 'two' : 'three')}
              className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              {layout === 'three' ? 'Two-way view' : 'Three-way view'}
            </button>
          )}
          <button type="button" onClick={onBackToReview} className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            Back to candidates
          </button>
          {onChangeStyle && (
            <button type="button" onClick={onChangeStyle} className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              Change style{lastStyleLabel ? ` (${lastStyleLabel})` : ''}
            </button>
          )}
          <button type="button" onClick={onRunCoherence} className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            Run coherence check
          </button>
          {onDownload && (
            <button type="button" onClick={() => onDownload('redacted.docx')} className="px-2.5 py-1 rounded-lg text-xs font-medium text-white transition-opacity duration-200 hover:opacity-80" style={{ background: 'var(--color-primary)' }}>
              Download .docx
            </button>
          )}
          {onDownload && (
            <button type="button" onClick={() => onDownload('sanitized.pdf')} className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              {pdfReady ? 'Download .pdf' : 'Get .pdf'}
            </button>
          )}
        </div>
      </div>

      {(briefSummary || briefFull) && (
        <div className="shrink-0 mx-4 mt-3 px-3 py-2 rounded-xl text-xs space-y-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
            Redaction brief
          </p>
          {briefSummary && (
            <p className="font-medium" style={{ color: 'var(--color-text)' }}>{briefSummary}</p>
          )}
          {briefFull && briefFull !== briefSummary && (
            <p className="leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>{briefFull}</p>
          )}
          {Array.isArray(briefIntents) && briefIntents.length > 0 && (
            <p style={{ color: 'var(--color-muted)' }}>Intent tags: {briefIntents.join(' · ')}</p>
          )}
        </div>
      )}

      {!pdfReady && (
        <div className="shrink-0 mx-4 mt-3 px-3 py-2 rounded-xl text-xs flex flex-wrap items-center justify-between gap-2" style={{ background: '#FFFBEB', color: '#92400e' }}>
          <span>
            DOCX compare available — server PDF conversion is pending. Download the .docx, or click Download .pdf (retries conversion; may use a text PDF if LibreOffice is down). You can also use{' '}
            <Link to="/pdf" className="underline transition-opacity duration-200 hover:opacity-70">PDF Tools</Link>
            . Frontier / final approval needs sanitized.pdf.
          </span>
          <button type="button" onClick={onRetryPdf} className="px-2.5 py-1 rounded-lg text-xs font-medium text-white transition-opacity duration-200 hover:opacity-80" style={{ background: 'var(--color-primary)' }}>
            Retry PDF conversion
          </button>
        </div>
      )}

      {pdfReady && !leftoversOutstanding && !approved && !finalApproved && (
        <div className="shrink-0 mx-4 mt-3 px-3 py-2 rounded-xl text-xs flex flex-wrap items-center justify-between gap-2" style={{ background: '#ecfdf5', color: '#065f46' }}>
          <span>PDF ready and no leftover leaks. Review the side-by-side, then approve before any frontier analysis.</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => onDownload?.('sanitized.pdf')} className="underline transition-opacity duration-200 hover:opacity-70">Download .pdf</button>
            <button
              type="button"
              onClick={onApproveFrontier}
              disabled={!canApprove}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-white transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              Approve for frontier analysis
            </button>
          </div>
        </div>
      )}

      {(!canApprove || leftoversOutstanding || !pdfReady) && !approved && !finalApproved && (
        <div className="shrink-0 mx-4 mt-2 px-3 py-2 rounded-xl text-xs opacity-90" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          <strong style={{ color: 'var(--color-text)' }}>Approve for frontier analysis</strong>
          {' — '}
          {compare?.approveBlockedReason || 'Blocked until PDF is ready and leftovers are cleared.'}
        </div>
      )}

      {approved && !finalApproved && (
        <div className="shrink-0 mx-4 mt-3 px-3 py-2 rounded-xl text-xs space-y-2" style={{ background: '#ecfdf5', color: '#065f46' }}>
          <p>
            Approved for frontier at {new Date(compare.job.frontierApprovedAt).toLocaleString()}.
            Sanitized PDF only will be sent — never the original or entity map.
          </p>
          <textarea
            value={frontierInstructions || ''}
            onChange={(e) => onFrontierInstructionsChange?.(e.target.value)}
            rows={3}
            placeholder="Optional analysis instructions for the frontier model…"
            className="w-full px-2 py-1.5 rounded-lg border text-xs outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRunFrontier}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-white transition-opacity duration-200 hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              Run frontier analysis
            </button>
            {frontierAnalysis?.suggestionCount > 0 && onReviewFrontierSuggestions && (
              <button
                type="button"
                onClick={onReviewFrontierSuggestions}
                className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Review {frontierAnalysis.suggestionCount} frontier suggestion(s)
              </button>
            )}
            {onApplyFrontier && (
              <button
                type="button"
                onClick={onApplyFrontier}
                className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Apply approved frontier suggestions
              </button>
            )}
          </div>
        </div>
      )}

      {frontierAnalysis?.analysis && (
        <div className="shrink-0 mx-4 mt-2 px-3 py-2 rounded-xl text-xs space-y-1 max-h-48 overflow-auto" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          <p className="font-medium" style={{ color: 'var(--color-muted)' }}>
            Frontier analysis{frontierAnalysis.modelId ? ` · ${frontierAnalysis.modelId}` : ''}
            {frontierAnalysis.ranAt ? ` · ${new Date(frontierAnalysis.ranAt).toLocaleString()}` : ''}
            {frontierAnalysis.suggestionCount != null ? ` · ${frontierAnalysis.suggestionCount} suggestion(s)` : ''}
          </p>
          {frontierAnalysis.parseError && (
            <p style={{ color: '#92400e' }}>Parse note: {frontierAnalysis.parseError} (raw analysis shown)</p>
          )}
          <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed m-0">{frontierAnalysis.analysis}</pre>
        </div>
      )}

      {canApproveFinal && !finalApproved && (
        <div className="shrink-0 mx-4 mt-3 px-3 py-2 rounded-xl text-xs flex flex-wrap items-center justify-between gap-2" style={{ background: '#eff6ff', color: '#1e3a8a' }}>
          <span>
            Frontier suggestions applied. Review the three-way compare, then approve the final document to unlock the finished export package (including INTERNAL-ONLY audit trail).
          </span>
          <button
            type="button"
            onClick={onApproveFinal}
            className="px-2.5 py-1 rounded-lg text-xs font-medium text-white transition-opacity duration-200 hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            Approve final document
          </button>
        </div>
      )}

      {!canApproveFinal && !finalApproved && compare?.finalApproveBlockedReason && compare?.job?.lastApplyPass === 'frontier' && (
        <div className="shrink-0 mx-4 mt-2 px-3 py-2 rounded-xl text-xs" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          <strong style={{ color: 'var(--color-text)' }}>Final approval</strong>
          {' — '}
          {compare.finalApproveBlockedReason}
        </div>
      )}

      {finalApproved && (
        <div className="shrink-0 mx-4 mt-3 px-3 py-2 rounded-xl text-xs space-y-2" style={{ background: '#ecfdf5', color: '#065f46' }}>
          <p>
            Final document approved at {new Date(compare.job.finalApprovedAt).toLocaleString()}. Export the finished package below.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onDownload?.('redacted.docx')} className="px-2.5 py-1 rounded-lg text-xs font-medium text-white transition-opacity duration-200 hover:opacity-80" style={{ background: 'var(--color-primary)' }}>
              Export .docx
            </button>
            <button type="button" onClick={() => onDownload?.('sanitized.pdf')} className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              Export .pdf
            </button>
            <button
              type="button"
              onClick={() => onDownload?.('INTERNAL-ONLY-audit-trail.json')}
              className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70"
              style={{ borderColor: '#fca5a5', color: '#991b1b', background: '#fff1f2' }}
              title="Contains original values — do not share outside the trusted boundary"
            >
              INTERNAL-ONLY audit trail
            </button>
          </div>
        </div>
      )}

      {(coherence || compare?.job?.coherence) && (
        <div className="shrink-0 mx-4 mt-2 px-3 py-2 rounded-xl text-xs space-y-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p style={{ color: 'var(--color-text)' }}>
            Coherence: {(coherence || compare.job.coherence).summary}
            {(coherence || compare.job.coherence).error ? ` (error: ${(coherence || compare.job.coherence).error})` : ''}
          </p>
          {((coherence || compare.job.coherence).flags || []).slice(0, 8).map((f, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setFocusRow(Number(f.paragraphIndex))}
              className="block text-left w-full transition-opacity duration-200 hover:opacity-70"
              style={{ color: f.severity === 'high' ? '#991b1b' : 'var(--color-muted)' }}
            >
              ¶{f.paragraphIndex}: {f.issue}
              {f.severity ? ` (${f.severity})` : ''}
            </button>
          ))}
        </div>
      )}

      {compare?.leftovers?.length > 0 && (
        <div className="shrink-0 mx-4 mt-2 px-3 py-2 rounded-xl text-xs space-y-1.5" style={{ background: '#fff1f2', color: '#991b1b' }}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium">
              {compare.leftovers.length} leftover leak(s) — apply missed these spans in redacted.docx (blocks frontier / final). Highlighted in red below.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onFixLeftovers}
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-white transition-opacity duration-200 hover:opacity-80"
                style={{ background: '#991b1b' }}
              >
                Fix leftovers
              </button>
              <button
                type="button"
                onClick={onBackToReview}
                className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: '#fecaca', color: '#991b1b' }}
              >
                Back to candidates
              </button>
            </div>
          </div>
          {compare.leftovers.slice(0, 12).map((l, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setFocusRow(l.paragraphIndex)}
              className="block text-left w-full transition-opacity duration-200 hover:opacity-70"
            >
              ¶{l.paragraphIndex}
              {l.paragraphId ? ` (${l.paragraphId})` : ''}
              {' · '}
              <span className="font-medium">{l.categoryLabel}</span>
              {l.expectedSynthetic ? ` · should be “${l.expectedSynthetic}”` : ''}
              {l.context ? ` · …${l.context}…` : ''}
            </button>
          ))}
        </div>
      )}

      {(showThree ? compare.threeWay.passLegend : compare?.legend)?.length > 0 && (
        <div className="shrink-0 px-4 py-2 flex flex-wrap gap-3 text-[10px]" style={{ color: 'var(--color-muted)' }}>
          {showThree
            ? compare.threeWay.passLegend.map((l) => (
              <span key={l.pass} className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: l.bg, border: `1px solid ${l.color}` }} />
                {l.label || l.pass}
              </span>
            ))
            : compare.legend.map((l) => (
              <span key={l.categoryLabel} className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: l.color.bg, border: `1px solid ${l.color.color}` }} />
                {l.categoryLabel}
              </span>
            ))}
        </div>
      )}

      {showThree ? (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-0 border-t" style={{ borderColor: 'var(--color-border)' }}>
          {[
            { key: 'original', title: 'Original', getText: (r) => r.original?.text, getHl: () => [], changed: (r) => r.changedLocal },
            { key: 'local', title: 'Local pass', getText: (r) => r.local?.text, getHl: (r) => r.local?.highlights || [], changed: (r) => r.changedLocal },
            { key: 'final', title: 'Final (after frontier)', getText: (r) => r.final?.text, getHl: (r) => r.final?.highlights || [], changed: (r) => r.changedFinal },
          ].map((col, colIdx) => (
            <div
              key={col.key}
              className={`flex flex-col min-h-0 border-b lg:border-b-0 ${colIdx < 2 ? 'lg:border-r' : ''}`}
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div className="shrink-0 px-4 py-1.5 text-xs font-semibold" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>{col.title}</div>
              <div
                ref={(el) => { paneRefs.current[colIdx] = el; }}
                className="flex-1 overflow-auto p-4 space-y-2 text-sm leading-relaxed"
                style={{ color: 'var(--color-text)', background: 'var(--color-bg)' }}
              >
                {rows.map((row) => (
                  <p
                    key={`${col.key}-${row.index}`}
                    data-row-index={row.index}
                    className="rounded-lg px-2 py-1"
                    style={{
                      background: col.changed(row) ? 'var(--color-surface)' : 'transparent',
                      opacity: col.getText(row) != null ? 1 : 0.4,
                    }}
                  >
                    {col.key === 'original'
                      ? (col.getText(row) || '—')
                      : renderHighlighted(col.getText(row) || '—', col.getHl(row))}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-0 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <div className="shrink-0 px-4 py-1.5 text-xs font-semibold" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>Original</div>
            <div ref={(el) => { paneRefs.current[0] = el; }} className="flex-1 overflow-auto p-4 space-y-2 text-sm leading-relaxed" style={{ color: 'var(--color-text)', background: 'var(--color-bg)' }}>
              {rows.map((row) => (
                <p
                  key={`o-${row.index}`}
                  data-row-index={row.index}
                  className="rounded-lg px-2 py-1"
                  style={{
                    background: row.changed ? 'var(--color-surface)' : 'transparent',
                    opacity: row.original ? 1 : 0.4,
                  }}
                >
                  {row.original?.text || '—'}
                </p>
              ))}
            </div>
          </div>
          <div className="flex flex-col min-h-0">
            <div className="shrink-0 px-4 py-1.5 text-xs font-semibold" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>Redacted</div>
            <div ref={(el) => { paneRefs.current[1] = el; }} className="flex-1 overflow-auto p-4 space-y-2 text-sm leading-relaxed" style={{ color: 'var(--color-text)', background: 'var(--color-bg)' }}>
              {rows.map((row) => (
                <p
                  key={`r-${row.index}`}
                  data-row-index={row.index}
                  className="rounded-lg px-2 py-1"
                  style={{
                    background: row.changed ? 'var(--color-surface)' : 'transparent',
                    opacity: row.redacted ? 1 : 0.4,
                  }}
                >
                  {renderHighlighted(row.redacted?.text || '—', row.redacted?.highlights || [])}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function renderHighlighted(text, highlights) {
  if (!highlights?.length) return text;
  const sorted = [...highlights].sort((a, b) => {
    if (a.startOffset !== b.startOffset) return a.startOffset - b.startOffset;
    if (a.kind === 'leftover' && b.kind !== 'leftover') return -1;
    if (b.kind === 'leftover' && a.kind !== 'leftover') return 1;
    return (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset);
  });
  const picked = [];
  let cursor = 0;
  for (const h of sorted) {
    if (h.startOffset < cursor) continue;
    picked.push(h);
    cursor = h.endOffset;
  }
  const parts = [];
  let i = 0;
  let key = 0;
  for (const h of picked) {
    if (h.startOffset > i) parts.push(<React.Fragment key={key++}>{text.slice(i, h.startOffset)}</React.Fragment>);
    const title = h.kind === 'leftover'
      ? `Leftover ${h.categoryLabel} — still the real value`
      : `${h.pass === 'frontier' ? 'Frontier' : 'Local'}: ${h.categoryLabel || ''}`;
    parts.push(
      <mark
        key={key++}
        title={title}
        style={{
          background: h.color?.bg || '#fef3c7',
          color: h.color?.color || 'inherit',
          borderRadius: 2,
          padding: '0 1px',
          outline: h.kind === 'leftover'
            ? '1px solid #ef4444'
            : (h.pass === 'frontier' ? '1px solid #9d174d' : undefined),
        }}
      >
        {text.slice(h.startOffset, h.endOffset)}
      </mark>,
    );
    i = h.endOffset;
  }
  if (i < text.length) parts.push(<React.Fragment key={key++}>{text.slice(i)}</React.Fragment>);
  return parts;
}
