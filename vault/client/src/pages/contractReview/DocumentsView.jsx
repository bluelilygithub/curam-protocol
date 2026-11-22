import React from 'react';
import Tooltip from '../../components/Tooltip';
import { CARD, FIELD, FOCUS_RING, PrimaryButton, SecondaryButton, DOCUMENT_STATUS_BADGE, Badge, UploadDropZone } from './shared';
import { useContractReview } from './context';

// Documents & reviews: every document and revision under the contract, and every review run against them.
export default function DocumentsView() {
  const { setTool, contract, review, contractReviews, reviewAsPartyId, setReviewAsPartyId, revisionBusy, compareFor, setCompareFor, compareResult, setCompareResult, compareLoading, revisionUploadOpenFor, setRevisionUploadOpenFor, openReview, markExecuted, reviewAsParty, runCompare, uploadRevision } = useContractReview();

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-base font-semibold mb-1">Documents &amp; revisions</h2>
        <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
          Every document uploaded under this contract, and every revision of each. Upload a new revision, mark a draft as executed, or run a review as a specific party from here.
        </p>
        <div className="rounded-lg border p-4" style={CARD}>
        <div className="space-y-2">
          {[...(contract.documents || [])].sort((a, b) => a.version - b.version).map((d) => (
            <div key={d.id} className="rounded-lg border p-3" style={FIELD}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
                  {d.filename}
                  <Badge bg="var(--color-bg)" color="var(--color-muted)">{d.kind} · v{d.version}</Badge>
                  <Badge bg={(DOCUMENT_STATUS_BADGE[d.status] || {}).bg} color={(DOCUMENT_STATUS_BADGE[d.status] || {}).color}>
                    {(DOCUMENT_STATUS_BADGE[d.status] || {}).text || d.status}
                  </Badge>
                </span>
                <div className="flex items-center gap-2">
                  {d.status === 'draft' && (
                    <PrimaryButton onClick={() => markExecuted(d.id)}>Mark as executed</PrimaryButton>
                  )}
                  {d.parentDocumentId && (
                    <SecondaryButton onClick={() => runCompare(d.id)}>What changed</SecondaryButton>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                {revisionUploadOpenFor === d.id ? (
                  <div className="flex items-center gap-2">
                    <Tooltip text="Uploads a new version of this document and runs the full analysis pipeline on it again.">
                      <UploadDropZone
                        compact
                        file={null}
                        onFile={(f) => { setRevisionUploadOpenFor(null); uploadRevision(d.id, f); }}
                      />
                    </Tooltip>
                    <button onClick={() => setRevisionUploadOpenFor(null)} className={`text-xs hover:opacity-70 rounded ${FOCUS_RING}`} style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <Tooltip text="Uploads a new version of this document and runs the full analysis pipeline on it again.">
                    <SecondaryButton onClick={() => setRevisionUploadOpenFor(d.id)} disabled={revisionBusy === d.id}>
                      {revisionBusy === d.id ? 'Uploading…' : 'Upload new revision'}
                    </SecondaryButton>
                  </Tooltip>
                )}
                <Tooltip text="Runs a new, independent review of this same document from another party's perspective.">
                  <select
                    value={reviewAsPartyId[d.id] || ''}
                    onChange={(e) => setReviewAsPartyId((prev) => ({ ...prev, [d.id]: e.target.value ? Number(e.target.value) : null }))}
                    className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}
                  >
                    <option value="">Review as…</option>
                    {(contract.parties || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
                  </select>
                </Tooltip>
                <PrimaryButton onClick={() => reviewAsParty(d.id)} disabled={!reviewAsPartyId[d.id]}>
                  Run review
                </PrimaryButton>
              </div>
            </div>
          ))}
        </div>
        </div>

        {compareFor && (
          <div className="rounded-lg border p-4 mt-3" style={{ ...CARD, borderColor: 'var(--color-primary)' }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">What changed</h3>
              <button onClick={() => { setCompareFor(null); setCompareResult(null); }} className="text-xs hover:opacity-70" style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}>Close</button>
            </div>
            {compareLoading && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>Comparing…</div>}
            {compareResult && (
              <>
                {compareResult.summary && (
                  <p className="text-sm mb-3 rounded p-2" style={{ background: 'var(--color-bg)' }}>{compareResult.summary}</p>
                )}
                <div className="space-y-2">
                  {compareResult.diffItems.filter((d) => d.status !== 'unchanged').map((d, i) => (
                    <div key={i} className="rounded border p-2" style={FIELD}>
                      <div className="flex items-center gap-2 mb-1">
                        {d.numberLabel && <span className="text-xs font-semibold">{d.numberLabel}</span>}
                        <Badge
                          bg={d.status === 'added' ? '#dcfce7' : d.status === 'removed' ? '#fee2e2' : '#e0f2fe'}
                          color={d.status === 'added' ? '#166534' : d.status === 'removed' ? '#991b1b' : '#075985'}
                        >
                          {d.status}
                        </Badge>
                        {d.oldRiskLevel && d.oldRiskLevel !== d.newRiskLevel && (
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{d.oldRiskLevel} → {d.newRiskLevel || 'unscored'}</span>
                        )}
                      </div>
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
                  ))}
                  {!compareResult.diffItems.some((d) => d.status !== 'unchanged') && (
                    <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No clauses changed between these two versions.</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <hr style={{ borderColor: 'var(--color-border)' }} />

      <section>
        <h2 className="text-base font-semibold mb-1">Reviews</h2>
        <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
          Every review run against any document in this contract, each its own party perspective. Select one to open it on the Review tab.
        </p>
        <div className="rounded-lg border p-4" style={CARD}>
          <div className="space-y-1">
            {contractReviews.map((r) => (
              <button
                key={r.id}
                onClick={() => { openReview(r.id); setTool('review'); }}
                className="w-full text-left rounded border p-2 flex items-center justify-between gap-2 hover:opacity-70 flex-wrap"
                style={{ ...FIELD, transition: 'opacity 200ms', borderColor: review?.id === r.id ? 'var(--color-primary)' : 'var(--color-border)' }}
              >
                <span className="text-sm">{r.filename} <Badge bg="var(--color-bg)" color="var(--color-muted)">v{r.version}</Badge></span>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {r.partyName ? `${r.partyName} (${r.partyRole})` : 'No perspective set'} · {new Date(r.createdAt).toLocaleDateString()}
                </span>
                <Badge bg="var(--color-bg)" color="var(--color-muted)">{r.status}</Badge>
              </button>
            ))}
            {!contractReviews.length && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No reviews yet.</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
