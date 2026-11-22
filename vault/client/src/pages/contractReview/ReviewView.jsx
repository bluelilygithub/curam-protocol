import React from 'react';
import Tooltip from '../../components/Tooltip';
import { CARD, FIELD, FOCUS_RING, PrimaryButton, SecondaryButton, RISK_BADGE, VERIFY_BADGE, COVERAGE_BADGE, ROLE_OPTIONS, Badge, formatEtaRemaining } from './shared';
import { useContractReview } from './context';
import { reviewVerdict } from './verdict.mjs';

// A clause's source text, risk status and explanation previously sat in one
// dense paragraph with no separation — a UX review specifically asked for
// faster access to "what's wrong / why it matters / what to do". Only risky
// and unclear clauses get the full Finding/Impact/Action treatment; standard
// clauses and context-only headings stay compact since there's nothing to
// act on.
function ClauseCard({ c, getIcon, onDismiss, onOverride, indent = false }) {
  const risk = RISK_BADGE[c.riskLevel] || null;
  const verify = VERIFY_BADGE[c.verificationStatus] || null;
  const style = indent ? { ...FIELD, marginLeft: 20 } : FIELD;
  const flagged = c.riskLevel === 'risky' || c.riskLevel === 'unclear';

  if (c.isContextOnly) {
    return (
      <div className="rounded-lg border p-3" style={{ ...style, opacity: 0.75 }}>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {c.numberLabel && <span className="text-xs font-semibold">{c.numberLabel}</span>}
          <Badge bg="var(--color-bg)" color="var(--color-muted)">Context only — not risk-scored</Badge>
        </div>
        <p className="text-sm mb-1">{c.text.slice(0, 500)}{c.text.length > 500 ? '…' : ''}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-3" style={{ ...style, borderLeft: flagged ? `3px solid ${risk?.color || 'var(--color-border)'}` : style.borderColor ? `1px solid ${style.borderColor}` : undefined }}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {c.numberLabel && <span className="text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>{c.numberLabel}</span>}
        {risk && <Badge bg={risk.bg} color={risk.color}>{risk.text}</Badge>}
        {verify && <Badge bg={verify.bg} color={verify.color}>{verify.text}</Badge>}
      </div>

      {flagged ? (
        <div className="space-y-2">
          {c.whyItMatters && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: risk?.color || 'var(--color-muted)' }}>Why it matters</p>
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>{c.whyItMatters}</p>
            </div>
          )}
          {c.suggestedRedline && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-muted)' }}>Suggested action (advisory, copy-paste only)</p>
              <p className="text-sm rounded p-2" style={{ background: 'var(--color-bg)' }}>{c.suggestedRedline}</p>
            </div>
          )}
          <details>
            <summary className="text-xs cursor-pointer select-none" style={{ color: 'var(--color-muted)' }}>Show source clause text</summary>
            <p className="text-sm mt-1.5" style={{ color: 'var(--color-muted)' }}>{c.text.slice(0, 500)}{c.text.length > 500 ? '…' : ''}</p>
          </details>
        </div>
      ) : (
        <p className="text-sm mb-1">{c.text.slice(0, 500)}{c.text.length > 500 ? '…' : ''}</p>
      )}

      {(c.crossReferences || []).length > 0 && (
        <div className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>
          References: {c.crossReferences.map((r) => r.label).join(', ')}
        </div>
      )}
      {c.riskLevel === 'risky' && (
        <div className="flex gap-3 mt-2.5">
          <button onClick={onDismiss} className={`text-xs hover:opacity-70 rounded ${FOCUS_RING}`} style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}>Dismiss</button>
          <button onClick={onOverride} className={`text-xs hover:opacity-70 rounded ${FOCUS_RING}`} style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}>Not risky for me</button>
        </div>
      )}
    </div>
  );
}

// The verdict, first on Risk review (like DocCompare's "Is it ready to submit?"): a headline for the reviewed party, what to do
// first, then the counts. Worked out in verdict.mjs from what the review returned; it never says the contract is safe.
const VERDICT_LOOK = {
  risky: { color: '#991b1b', bg: '#fee2e2', icon: 'alert-triangle' },
  unclear: { color: '#92400e', bg: '#fef3c7', icon: 'alert-triangle' },
  clear: { color: 'var(--color-primary)', bg: 'var(--color-bg)', icon: 'shield-check' },
};

function VerdictCard({ contract, review, obligations, getIcon, onShow, onTool }) {
  const party = (contract.parties || []).find((p) => p.id === review.userPartyId);
  const v = reviewVerdict({ clauses: review.clauses || [], obligations, coverageReport: review.coverageReport || [], partyName: party?.name });
  const look = VERDICT_LOOK[v.level];
  const dateBits = [];
  if (contract?.effectiveDate) dateBits.push(`Effective ${new Date(contract.effectiveDate).toLocaleDateString()}`);
  if (contract?.termLengthMonths) dateBits.push(`${contract.termLengthMonths}-month term`);

  const Stat = ({ label, value, color }) => (
    <div className="rounded-lg border px-3 py-2 text-center" style={FIELD}>
      <div className="text-xl font-semibold" style={{ color: color || 'var(--color-text)' }}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{label}</div>
    </div>
  );
  const link = `text-xs font-medium hover:opacity-70 rounded underline ${FOCUS_RING}`;

  return (
    <section className="rounded-2xl border p-5 space-y-3" style={{ ...CARD, borderColor: look.color, borderWidth: 2 }} data-tour="contract-review-verdict" data-guide="verdict" aria-label="Verdict">
      <div className="flex items-start gap-3">
        <span className="rounded-full p-2 shrink-0" style={{ background: look.bg, color: look.color }}>{getIcon(look.icon, { size: 20 })}</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold" style={{ color: look.color }}>{v.title}</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text)' }}>{v.sentence}</p>
          <div className="flex flex-wrap gap-3 mt-2">
            {v.counts.risky > 0 && <button type="button" onClick={() => onShow('risky')} className={link} style={{ color: 'var(--color-primary)' }}>Show the risky clauses</button>}
            {v.counts.unclear > 0 && <button type="button" onClick={() => onShow('unclear')} className={link} style={{ color: 'var(--color-primary)' }}>Show the unclear clauses</button>}
            <button type="button" onClick={() => onTool('obligations')} className={link} style={{ color: 'var(--color-primary)' }}>What you would have to do</button>
          </div>
        </div>
      </div>
      {v.notes.length > 0 && (
        <ul className="text-sm space-y-1 pl-1">
          {v.notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2">
              {getIcon('arrow-right', { size: 14, style: { color: look.color, marginTop: 3, flexShrink: 0 } })}
              <span>{n.text}{n.tool && <> <button type="button" onClick={() => onTool(n.tool)} className={link} style={{ color: 'var(--color-primary)' }}>Open Obligations</button></>}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Risky" value={v.counts.risky} color={v.counts.risky ? '#991b1b' : undefined} />
        <Stat label="Unclear" value={v.counts.unclear} color={v.counts.unclear ? '#92400e' : undefined} />
        <Stat label="Standard" value={v.counts.standard} />
        <Stat label="Overdue / upcoming" value={`${v.overdue} / ${v.upcoming}`} color={v.overdue ? '#991b1b' : undefined} />
      </div>
      {dateBits.length > 0 && <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{dateBits.join(' · ')}</div>}
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Counts what the review flagged for this party. Informational only, not legal advice.</p>
    </section>
  );
}

// Mirrors contract_reviews.status (server/db.js) in pipeline order — used to
// compute a rough percent-complete for the persistent progress bar below.
// 'awaiting_role_confirmation'/'failed'/'not_supported'/'complete' are
// terminal-ish states handled by their own dedicated blocks, not this one.
const REVIEW_STAGE_ORDER = [
  'queued', 'extracting', 'segmenting', 'detecting_type', 'awaiting_role_confirmation',
  'extracting_definitions', 'classifying', 'scoring', 'extracting_obligations',
  'summarizing', 'verifying', 'complete',
];
const REVIEW_STAGE_LABELS = {
  queued: 'Queued', extracting: 'Extracting text', segmenting: 'Splitting into clauses',
  detecting_type: 'Detecting contract type', awaiting_role_confirmation: 'Waiting for your role',
  extracting_definitions: 'Extracting definitions', classifying: 'Classifying clauses',
  scoring: 'Scoring risk', extracting_obligations: 'Extracting obligations',
  summarizing: 'Writing summary', verifying: 'Verifying against source', complete: 'Complete',
};

// A review whose ingest/analysis now runs entirely in the background (see
// startReview/resumeReview) has no guaranteed active ProcessingModal watching
// it — reloading the page or navigating here fresh needs its own persistent,
// self-updating indicator rather than a one-off toast. Backed by the polling
// effect in the main component (keyed on review.id/status).
function ReviewProgressCard({ review, party }) {
  const idx = REVIEW_STAGE_ORDER.indexOf(review.status);
  const pct = idx >= 0 ? Math.round((idx / (REVIEW_STAGE_ORDER.length - 1)) * 100) : 5;
  const sp = review.stageProgress || {};
  const stageLabel = REVIEW_STAGE_LABELS[review.status] || String(review.status).replace(/_/g, ' ');
  let subDetail = null;
  if (review.status === 'scoring' && sp.total) {
    subDetail = `Clause ${sp.current || 0} of ${sp.total}` + formatEtaRemaining(sp.etaSeconds);
  }
  return (
    <div className="rounded-lg border p-4" style={CARD}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-base font-semibold">Analysis in progress</h2>
        {party && <Badge bg="var(--color-bg)" color="var(--color-muted)">Reviewing as {party.name}</Badge>}
      </div>
      <div className="w-full h-2 rounded-full overflow-hidden mb-2" style={{ background: 'var(--color-bg)' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 5)}%`, background: 'var(--color-primary)', transition: 'width 200ms' }} />
      </div>
      <div className="text-sm font-medium">{stageLabel}</div>
      {subDetail && <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{subDetail}</div>}
      <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>This updates automatically — no need to refresh.</p>
    </div>
  );
}

const SEVERITY_RANK = { risky: 0, unclear: 1, standard: 2 };

// Filters/sorts the flat clause list. Severity sort or any non-"all" filter
// switches to a flat list — grouping (see groupClauses) only makes sense for
// the default, unsorted, unfiltered order view.
function getVisibleClauses(clauses, filter, sort) {
  let list = clauses || [];
  if (filter === 'context') list = list.filter((c) => c.isContextOnly);
  else if (filter !== 'all') list = list.filter((c) => c.riskLevel === filter);
  if (sort === 'severity') {
    list = [...list].sort((a, b) => (SEVERITY_RANK[a.riskLevel] ?? 3) - (SEVERITY_RANK[b.riskLevel] ?? 3));
  }
  return list;
}

// A bare-heading clause ("11." — see segmentation.js's isGroupHeading) is a
// group label for its own dotted subclauses ("11.1", "11.2", ...), not a
// clause with its own content — grouped here so the client can render it as
// a section header with its subclauses nested underneath, instead of one
// more flat card in the list.
function groupClauses(clauses) {
  const groups = [];
  let current = null;
  for (const c of clauses) {
    if (c.isGroupHeading) {
      current = { heading: c, children: [] };
      groups.push(current);
      continue;
    }
    const majorPrefix = current?.heading?.numberLabel ? `${current.heading.numberLabel.replace(/\.$/, '')}.` : null;
    if (current && majorPrefix && c.numberLabel?.startsWith(majorPrefix)) {
      current.children.push(c);
    } else {
      groups.push({ heading: null, children: [c] });
      current = null;
    }
  }
  return groups;
}

// Risk review: which party you are, progress, then the summary, clauses and definitions of the open review.
export default function ReviewView() {
  const { getIcon, setTool, contract, review, obligations, pickedPartyId, setPickedPartyId, manualPartyName, setManualPartyName, manualPartyRole, setManualPartyRole, partyNameDrafts, setPartyNameDrafts, clauseFilter, setClauseFilter, clauseSort, setClauseSort, contractReviews, reviewAsPartyId, setReviewAsPartyId, switchPerspectiveOpen, setSwitchPerspectiveOpen, openReview, confirmRole, savePartyField, addManualPartyAndConfirm, recordCorrection, reviewAsParty } = useContractReview();

  return (
    <div className="space-y-4">
    {contractReviews.length > 1 && (
      <div className="rounded-lg border p-3" style={CARD}>
        <div className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
          This contract has {contractReviews.length} reviews — showing one at a time:
        </div>
        <div className="space-y-1">
          {contractReviews.map((r) => (
            <button
              key={r.id}
              onClick={() => openReview(r.id)}
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
        </div>
      </div>
    )}

    {!review && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No review yet.</div>}

    {review?.status === 'awaiting_role_confirmation' && (contract.parties || []).length > 0 && (
      <div className="rounded-lg border p-4" style={{ ...CARD, borderColor: 'var(--color-primary)' }} data-guide="party">
        <h2 className="text-base font-semibold mb-2">Which party are you?</h2>
        <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
          Confirming unblocks risk scoring for your side of the agreement. Fix a name or role below if the extraction got it wrong — your edit is what the review uses.
        </p>
        <div className="space-y-2 mb-3">
          {contract.parties.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-sm">
              <Tooltip text="Select this party as you — risk flags for the rest of the review are scored for your confirmed side.">
                <input type="radio" name="userParty" checked={pickedPartyId === p.id} onChange={() => setPickedPartyId(p.id)} />
              </Tooltip>
              <Tooltip text="Fix the detected name if it's wrong — your edit is what the review uses from here on.">
                <input
                  type="text"
                  value={partyNameDrafts[p.id] ?? p.name}
                  onChange={(e) => setPartyNameDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== p.name) savePartyField(p.id, 'name', v);
                  }}
                  className="rounded border px-2 py-1 text-sm flex-1"
                  style={FIELD}
                />
              </Tooltip>
              <Tooltip text="Fix the detected role if it's wrong — this affects how risk is scored once confirmed.">
                <select
                  value={p.role}
                  onChange={(e) => savePartyField(p.id, 'role', e.target.value)}
                  className="rounded border px-2 py-1 text-sm"
                  style={FIELD}
                >
                  {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Tooltip>
            </div>
          ))}
        </div>
        <PrimaryButton onClick={confirmRole} disabled={!pickedPartyId} large>
          Confirm and continue analysis
        </PrimaryButton>
      </div>
    )}

    {review?.status === 'awaiting_role_confirmation' && (contract.parties || []).length === 0 && (
      <div className="rounded-lg border p-4" style={{ ...CARD, borderColor: 'var(--color-primary)' }} data-guide="party">
        <h2 className="text-base font-semibold mb-2">Which party are you?</h2>
        <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
          No parties could be automatically detected in this document. Enter your own name and role to continue — the rest of the parties can still be identified later from the clauses themselves.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <Tooltip text="Your own name or organization — becomes a party on this contract, confirmed as you.">
            <input
              type="text" value={manualPartyName} onChange={(e) => setManualPartyName(e.target.value)}
              placeholder="Your name or organization" className="rounded border px-2 py-1.5 text-sm flex-1" style={FIELD}
            />
          </Tooltip>
          <Tooltip text="Your role in this agreement — used to score risk flags for your side.">
            <select value={manualPartyRole} onChange={(e) => setManualPartyRole(e.target.value)} className="rounded border px-2 py-1.5 text-sm" style={FIELD}>
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Tooltip>
        </div>
        <PrimaryButton onClick={addManualPartyAndConfirm} disabled={!manualPartyName.trim()} large>
          Add and continue analysis
        </PrimaryButton>
      </div>
    )}

    {review?.status === 'failed' && (
      <div className="rounded-lg border p-4" style={{ background: '#fee2e2', borderColor: '#991b1b' }}>
        <h2 className="text-base font-semibold mb-1" style={{ color: '#991b1b' }}>Analysis failed</h2>
        <p className="text-xs" style={{ color: '#991b1b' }}>{review.errorMessage || 'An unexpected error occurred during analysis.'}</p>
      </div>
    )}

    {review?.status === 'not_supported' && (
      <div className="rounded-lg border p-4" style={{ background: '#fef3c7', borderColor: '#92400e' }}>
        <h2 className="text-base font-semibold mb-1" style={{ color: '#92400e' }}>Document not supported</h2>
        <p className="text-xs" style={{ color: '#92400e' }}>{review.errorMessage || 'This document could not be analyzed.'}</p>
      </div>
    )}

    {review && !['awaiting_role_confirmation', 'failed', 'not_supported', 'complete'].includes(review.status) && (
      <ReviewProgressCard review={review} party={(contract.parties || []).find((p) => p.id === review.userPartyId)} />
    )}

    {review?.status === 'complete' && (
      <>
        <VerdictCard
          contract={contract} review={review} obligations={obligations} getIcon={getIcon} onTool={setTool}
          onShow={(level) => { setClauseFilter(level); setClauseSort('order'); document.getElementById('cr-clauses-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
        />
        {(() => {
          const reviewingAs = (contract.parties || []).find((p) => p.id === review.userPartyId);
          return (
            <div className="rounded-lg p-4" style={{ background: 'var(--color-surface)', border: '2px solid var(--color-primary)' }} data-guide="perspective">
              <div className="flex items-center gap-3 flex-wrap">
                {getIcon('user', { size: 20, style: { color: 'var(--color-primary)', flexShrink: 0 } })}
                <div className="flex-1 min-w-0">
                  {reviewingAs ? (
                    <>
                      <div className="text-base font-semibold">
                        Reviewing as {reviewingAs.name} <span className="font-normal text-sm" style={{ color: 'var(--color-muted)' }}>({reviewingAs.role})</span>
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                        Every risk flag and recommendation below is scored specifically for this party.
                      </div>
                    </>
                  ) : (
                    <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No perspective set for this review.</div>
                  )}
                </div>
                {!switchPerspectiveOpen && (
                  <SecondaryButton onClick={() => setSwitchPerspectiveOpen(true)}>Review as a different party</SecondaryButton>
                )}
              </div>
              {switchPerspectiveOpen && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Start a NEW, independent review as:</span>
                  <Tooltip text="Starts a brand new, independent review of this document for the chosen party — never affects the review you're currently viewing.">
                    <select
                      value={reviewAsPartyId[review.documentId] || ''}
                      onChange={(e) => setReviewAsPartyId((prev) => ({ ...prev, [review.documentId]: e.target.value ? Number(e.target.value) : null }))}
                      className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}
                    >
                      <option value="">Choose a party…</option>
                      {(contract.parties || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
                    </select>
                  </Tooltip>
                  <PrimaryButton
                    onClick={() => { reviewAsParty(review.documentId); setSwitchPerspectiveOpen(false); }}
                    disabled={!reviewAsPartyId[review.documentId]}
                  >
                    Run new review
                  </PrimaryButton>
                  <button onClick={() => setSwitchPerspectiveOpen(false)} className={`text-xs hover:opacity-70 rounded ${FOCUS_RING}`} style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })()}
        {review.costUsd != null && (
          <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Analysis cost: ${Number(review.costUsd).toFixed(4)}
          </div>
        )}

        {review.coverageReport?.length > 0 && (
          <div className="rounded-lg border p-4" style={CARD} data-guide="coverage">
            <h2 className="text-base font-semibold mb-2">Coverage report</h2>
            {review.coverageReport.map((c) => {
              const b = COVERAGE_BADGE[c.status] || COVERAGE_BADGE.could_not_assess;
              return (
                <div key={c.clauseType} className="text-sm flex items-center gap-2 py-1">
                  <Badge bg={b.bg} color={b.color}>{b.text}</Badge>
                  <span className="capitalize">{c.clauseType.replace(/_/g, ' ')}</span>
                </div>
              );
            })}
          </div>
        )}

        {review.summaryPoints?.length > 0 && (
          <div className="rounded-lg border p-4" style={CARD} data-guide="summary">
            <h2 className="text-base font-semibold mb-2">Summary</h2>
            <ul className="space-y-2">
              {review.summaryPoints.map((p, i) => {
                const b = VERIFY_BADGE[p.verificationStatus] || VERIFY_BADGE.failed;
                return (
                  <li key={i} className="text-sm flex items-start gap-2">
                    {getIcon(b.icon, { size: 14, style: { marginTop: 2, color: b.color } })}
                    <span>{p.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div id="cr-clauses-card" data-guide="clauses" className="rounded-lg border p-4 scroll-mt-4" style={CARD}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-base font-semibold">Clauses</h2>
            <div className="flex items-center gap-2">
              <Tooltip text="Show only clauses of one risk level, or context-only clauses that weren't risk-scored at all.">
                <select value={clauseFilter} onChange={(e) => setClauseFilter(e.target.value)} className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}>
                  <option value="all">All</option>
                  <option value="risky">Risky</option>
                  <option value="unclear">Unclear</option>
                  <option value="standard">Standard</option>
                  <option value="context">Context only</option>
                </select>
              </Tooltip>
              <Tooltip text="Clause order follows the document; Severity groups the riskiest clauses first.">
                <select value={clauseSort} onChange={(e) => setClauseSort(e.target.value)} className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}>
                  <option value="order">Clause order</option>
                  <option value="severity">Severity</option>
                </select>
              </Tooltip>
            </div>
          </div>
          <div className="space-y-3">
            {clauseFilter === 'all' && clauseSort === 'order' ? (
              groupClauses(review.clauses || []).map((g, gi) => (
                <div key={g.heading?.id || `flat-${gi}`}>
                  {g.heading && (
                    <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>
                      {g.heading.numberLabel} {g.heading.text.replace(/^[\d.]+\s*/, '').trim()}
                    </div>
                  )}
                  <div className="space-y-3">
                    {g.children.map((c) => (
                      <ClauseCard
                        key={c.id} c={c} getIcon={getIcon} indent={!!g.heading}
                        onDismiss={() => recordCorrection({ clauseId: c.id, field: 'riskLevel', userValue: 'standard' }, 'dismiss')}
                        onOverride={() => recordCorrection({ clauseId: c.id, field: 'riskLevel', userValue: 'standard' }, 'override')}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              getVisibleClauses(review.clauses || [], clauseFilter, clauseSort).map((c) => (
                <ClauseCard
                  key={c.id} c={c} getIcon={getIcon}
                  onDismiss={() => recordCorrection({ clauseId: c.id, field: 'riskLevel', userValue: 'standard' }, 'dismiss')}
                  onOverride={() => recordCorrection({ clauseId: c.id, field: 'riskLevel', userValue: 'standard' }, 'override')}
                />
              ))
            )}
            {!(review.clauses || []).length && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No clauses.</div>}
          </div>
        </div>

    {review.definitions?.length > 0 && (
      <div className="rounded-lg border p-4" style={CARD} data-guide="definitions">
        <h2 className="text-base font-semibold mb-2">Definitions</h2>
        {review.definitions.map((d) => {
          const b = VERIFY_BADGE[d.verificationStatus] || VERIFY_BADGE.failed;
          return (
            <div key={d.id} className="text-sm py-1 flex items-start gap-2">
              {getIcon(b.icon, { size: 14, style: { marginTop: 2, color: b.color } })}
              <span><strong>{d.term}</strong> — {d.definition}</span>
            </div>
          );
        })}
      </div>
    )}
  </>
)}
    </div>
  );
}
