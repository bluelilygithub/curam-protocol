import React from 'react';
import Tooltip from '../../components/Tooltip';
import { CARD, FIELD, FOCUS_RING, PrimaryButton, SecondaryButton, RISK_IMPACT_BADGE, RECOMMENDED_ACTION_BADGE, Badge } from './shared';
import { useContractReview } from './context';

// One changed/added/removed clause in the Compare-revisions tab's condensed
// view — risk impact (deterministic), party impact + recommended action
// (advisory), wording change collapsed behind a details toggle so the
// judgment fields are what's visible first.
function CompareChangeCard({ d }) {
  const impact = RISK_IMPACT_BADGE[d.riskImpact] || null;
  const action = RECOMMENDED_ACTION_BADGE[d.recommendedAction] || null;
  const flagged = d.riskImpact === 'worsened' || d.riskImpact === 'new_risk';
  return (
    <div className="rounded-lg border p-3" style={{ ...FIELD, borderLeft: flagged ? `3px solid ${impact.color}` : undefined }}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {d.numberLabel && <span className="text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>{d.numberLabel}</span>}
        <Badge
          bg={d.status === 'added' ? '#dcfce7' : d.status === 'removed' ? '#fee2e2' : '#e0f2fe'}
          color={d.status === 'added' ? '#166534' : d.status === 'removed' ? '#991b1b' : '#075985'}
        >
          {d.status}
        </Badge>
        {impact && <Badge bg={impact.bg} color={impact.color}>{impact.text}</Badge>}
        {action && <Badge bg={action.bg} color={action.color}>{action.text}</Badge>}
      </div>
      {d.partyImpact && <p className="text-sm mb-1">{d.partyImpact}</p>}
      {d.recommendedActionNote && <p className="text-xs mb-1.5" style={{ color: 'var(--color-muted)' }}>{d.recommendedActionNote}</p>}
      <details>
        <summary className="text-xs cursor-pointer select-none" style={{ color: 'var(--color-muted)' }}>Show wording change</summary>
        <div className="mt-1.5">
          {d.status === 'changed' && d.diff ? (
            <p className="text-sm">
              {d.diff.map((op, j) => op.type === 'equal' ? (
                <span key={j}>{op.text}</span>
              ) : op.type === 'remove' ? (
                <span key={j} style={{ background: '#fee2e2', textDecoration: 'line-through', color: '#991b1b' }}>{op.text}</span>
              ) : (
                <span key={j} style={{ background: '#dcfce7', color: '#166534' }}>{op.text}</span>
              ))}
            </p>
          ) : (
            <p className="text-sm">{d.newText || d.oldText}</p>
          )}
        </div>
      </details>
    </div>
  );
}

// Compare revisions: pick a perspective, then any two reviewed versions.
export default function CompareView() {
  const { getIcon, contract, review, comparePartyId, setComparePartyId, compareOldReviewId, setCompareOldReviewId, compareNewReviewId, setCompareNewReviewId, compareViewMode, setCompareViewMode, compareFullResult, compareFullLoading, compareFullError, compareVersionsForParty, reviewAsParty, runFullCompare } = useContractReview();
  const missingCount = compareVersionsForParty.filter((v) => !v.review).length;
  const perspectiveParty = (contract.parties || []).find((p) => p.id === comparePartyId);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4" style={CARD} data-guide="compare">
        <h2 className="text-base font-semibold mb-1">Compare revisions</h2>
        <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
          Pick a perspective, then any two versions — risk changes, who's affected, and what to do about it, side by side.
        </p>

        <div className="mb-3">
          <label className="text-xs font-semibold uppercase tracking-wide block mb-1" style={{ color: 'var(--color-muted)' }}>Review for</label>
          <Tooltip text="Risk ratings and recommendations below are scored for this party — the underlying document differences never change, only how they're assessed.">
            <select
              value={comparePartyId || ''}
              onChange={(e) => setComparePartyId(e.target.value ? Number(e.target.value) : null)}
              className={`rounded border px-2 py-1.5 text-sm ${FOCUS_RING}`} style={FIELD}
            >
              {(contract.parties || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
            </select>
          </Tooltip>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide block mb-1" style={{ color: 'var(--color-muted)' }}>Original</label>
            <select
              value={compareOldReviewId || ''}
              onChange={(e) => setCompareOldReviewId(e.target.value ? Number(e.target.value) : null)}
              className={`w-full rounded border px-2 py-1.5 text-sm ${FOCUS_RING}`} style={FIELD}
            >
              <option value="">Choose a version…</option>
              {compareVersionsForParty.filter((v) => v.review).map((v) => (
                <option key={v.document.id} value={v.review.id}>{v.document.filename} · v{v.document.version}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide block mb-1" style={{ color: 'var(--color-muted)' }}>Revised</label>
            <select
              value={compareNewReviewId || ''}
              onChange={(e) => setCompareNewReviewId(e.target.value ? Number(e.target.value) : null)}
              className={`w-full rounded border px-2 py-1.5 text-sm ${FOCUS_RING}`} style={FIELD}
            >
              <option value="">Choose a version…</option>
              {compareVersionsForParty.filter((v) => v.review).map((v) => (
                <option key={v.document.id} value={v.review.id}>{v.document.filename} · v{v.document.version}</option>
              ))}
            </select>
          </div>
        </div>

        {missingCount > 0 && (
          <div className="rounded-lg p-3 mb-3 text-xs" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
            {missingCount} version{missingCount === 1 ? ' has' : 's have'} no review yet for {perspectiveParty?.name || 'this party'}:
            <div className="flex flex-wrap gap-2 mt-1.5">
              {compareVersionsForParty.filter((v) => !v.review).map((v) => (
                <SecondaryButton key={v.document.id} onClick={() => reviewAsParty(v.document.id, comparePartyId, { preserveTab: 'compare' })}>
                  Run review for v{v.document.version}
                </SecondaryButton>
              ))}
            </div>
          </div>
        )}

        <PrimaryButton
          onClick={runFullCompare}
          disabled={!compareOldReviewId || !compareNewReviewId || compareOldReviewId === compareNewReviewId || compareFullLoading}
          large
        >
          {compareFullLoading ? 'Comparing…' : 'Compare'}
        </PrimaryButton>
        {compareOldReviewId && compareOldReviewId === compareNewReviewId && (
          <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>Choose two different versions.</span>
        )}
      </div>

      {compareFullError && <div style={{ color: '#991b1b' }} className="text-sm">{compareFullError}</div>}

      {compareFullResult && (
        <div className="rounded-lg border p-4" style={CARD}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-sm">
              <strong>Comparing v{compareFullResult.oldReview.version} → v{compareFullResult.newReview.version}</strong>
              <span style={{ color: 'var(--color-muted)' }}> · Viewed for {compareFullResult.newReview.partyName || 'no perspective'}{compareFullResult.newReview.partyRole ? ` (${compareFullResult.newReview.partyRole})` : ''}</span>
            </div>
            <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--color-border)' }}>
              {[{ key: 'condensed', label: 'list' }, { key: 'sideBySide', label: 'columns' }].map((v) => (
                <button
                  key={v.key}
                  onClick={() => setCompareViewMode(v.key)}
                  title={v.key === 'condensed' ? 'Condensed change list' : 'Side-by-side documents'}
                  className={`rounded-md px-2 py-1 hover:opacity-70 ${FOCUS_RING}`}
                  style={{ transition: 'opacity 200ms', background: compareViewMode === v.key ? 'var(--color-primary)' : 'transparent', color: compareViewMode === v.key ? '#fff' : 'var(--color-muted)' }}
                >
                  {getIcon(v.label, { size: 14 })}
                </button>
              ))}
            </div>
          </div>

          {compareFullResult.perspectiveMismatch && (
            <div className="text-xs rounded-lg p-2 mb-3" style={{ background: '#fef3c7', color: '#92400e' }}>
              These two reviews weren't run for the same party — risk changes below may reflect a perspective switch, not just wording changes.
            </div>
          )}
          {compareFullResult.summary && (
            <p className="text-sm mb-3 rounded-lg p-2.5" style={{ background: 'var(--color-bg)' }}>{compareFullResult.summary}</p>
          )}

          {compareViewMode === 'condensed' ? (
            <div className="space-y-2.5">
              {compareFullResult.diffItems.filter((d) => d.status !== 'unchanged').map((d, i) => (
                <CompareChangeCard key={i} d={d} />
              ))}
              {!compareFullResult.diffItems.some((d) => d.status !== 'unchanged') && (
                <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No clauses changed between these two versions.</div>
              )}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Original — v{compareFullResult.oldReview.version}</div>
                {(compareFullResult.diffItemsDocumentOrder || compareFullResult.diffItems).map((d, i) => (
                  <div key={i} className="rounded-lg border p-2.5 text-sm" style={{ ...FIELD, opacity: d.status === 'added' ? 0.4 : 1 }}>
                    {d.numberLabel && <div className="text-xs font-semibold mb-0.5" style={{ color: 'var(--color-muted)' }}>{d.numberLabel}</div>}
                    {d.status === 'added' ? <em style={{ color: 'var(--color-muted)' }}>(not present in this version)</em> : (d.oldText || d.text)}
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Revised — v{compareFullResult.newReview.version}</div>
                {(compareFullResult.diffItemsDocumentOrder || compareFullResult.diffItems).map((d, i) => {
                  const impact = RISK_IMPACT_BADGE[d.riskImpact];
                  return (
                    <div key={i} className="rounded-lg border p-2.5 text-sm" style={{ ...FIELD, opacity: d.status === 'removed' ? 0.4 : 1, borderLeft: d.status !== 'unchanged' && impact ? `3px solid ${impact.color}` : undefined }}>
                      {d.numberLabel && <div className="text-xs font-semibold mb-0.5" style={{ color: 'var(--color-muted)' }}>{d.numberLabel}</div>}
                      {d.status === 'removed' ? <em style={{ color: 'var(--color-muted)' }}>(removed in this version)</em> : (d.newText || d.text)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
