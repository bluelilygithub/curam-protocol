import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useProcessingStore, { runWithStepLog } from '../store/processingStore';
import useAuthStore from '../store/authStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import ConfirmModal from '../components/ConfirmModal';
import { startContractReviewTour, TOUR_KEY as CR_TOUR_KEY } from '../utils/tours/contractReviewTour';

const CARD = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

// Action styling tiers — "Run review", "Mark as executed", "Send to Tasks"
// etc previously rendered as plain text links indistinguishable from quiet
// metadata; a real UX review flagged that primary actions must read as
// unmistakably clickable. Focus ring uses the theme's own primary colour
// instead of the browser default (also flagged — the default outline read
// as an accidental heavy black box around the active tab).
const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-primary)]';
const BTN_PRIMARY_SM = { background: 'var(--color-primary)', color: '#fff', border: '1px solid var(--color-primary)' };
const BTN_SECONDARY_SM = { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const BTN_DESTRUCTIVE_SM = { background: 'transparent', borderColor: '#ef4444', color: '#ef4444' };

function PrimaryButton({ children, className = '', style, large = false, ...props }) {
  return (
    <button
      {...props}
      className={`rounded-md font-semibold hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed ${large ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'} ${FOCUS_RING} ${className}`}
      style={{ transition: 'opacity 200ms', ...BTN_PRIMARY_SM, ...style }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, className = '', style, ...props }) {
  return (
    <button
      {...props}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING} ${className}`}
      style={{ transition: 'opacity 200ms', ...BTN_SECONDARY_SM, ...style }}
    >
      {children}
    </button>
  );
}

function DestructiveButton({ children, className = '', style, ...props }) {
  return (
    <button
      {...props}
      className={`rounded-md border px-3 py-1.5 text-xs font-semibold hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING} ${className}`}
      style={{ transition: 'opacity 200ms', ...BTN_DESTRUCTIVE_SM, ...style }}
    >
      {children}
    </button>
  );
}

const RISK_BADGE = {
  risky: { text: 'Risky', bg: '#fee2e2', color: '#991b1b' },
  unclear: { text: 'Unclear', bg: '#fef3c7', color: '#92400e' },
  standard: { text: 'Standard', bg: '#dcfce7', color: '#166534' },
};

const VERIFY_BADGE = {
  verified_exact: { text: 'Verified', icon: 'shield-check', bg: '#dcfce7', color: '#166534' },
  verified_normalized: { text: 'Verified (approx.)', icon: 'shield-check', bg: '#e0f2fe', color: '#075985' },
  failed: { text: 'Unverified', icon: 'alert-triangle', bg: '#fef3c7', color: '#92400e' },
};

const COVERAGE_BADGE = {
  found: { text: 'Found', bg: '#dcfce7', color: '#166534' },
  not_found: { text: 'Not found', bg: '#fee2e2', color: '#991b1b' },
  could_not_assess: { text: 'Could not assess', bg: '#fef3c7', color: '#92400e' },
};

// Contract/document lifecycle status — previously a flat grey badge for
// every value ("draft", "complete", "base · v1", ...) with no colour or
// grouping to signal what each one actually means.
const CONTRACT_STATUS_BADGE = {
  draft: { text: 'Draft', bg: 'var(--color-bg)', color: 'var(--color-muted)' },
  executed: { text: 'Executed', bg: '#dcfce7', color: '#166534' },
  expired: { text: 'Expired', bg: '#fef3c7', color: '#92400e' },
  terminated: { text: 'Terminated', bg: '#fee2e2', color: '#991b1b' },
};
const DOCUMENT_STATUS_BADGE = {
  draft: { text: 'Draft', bg: 'var(--color-bg)', color: 'var(--color-muted)' },
  executed: { text: 'Executed', bg: '#dcfce7', color: '#166534' },
  superseded: { text: 'Superseded', bg: 'var(--color-bg)', color: 'var(--color-muted)' },
};

// "other" is a real enum value but reads as a non-answer in the UI —
// contractTypeRaw (the model's own free-text guess before it was mapped
// onto the fixed enum) is a clearer thing to show when available.
function contractTypeLabel(c) {
  if (c?.contractType && c.contractType !== 'other') return c.contractType.replace(/_/g, ' ');
  return c?.contractTypeRaw ? c.contractTypeRaw : 'Uncategorized contract';
}

// Mirrors server's contract_parties.role CHECK constraint (server/db.js's
// PARTY_ROLE_KEYS) — a small, rarely-changing v1 taxonomy, not worth a shared
// module for the one dropdown that needs it.
const ROLE_OPTIONS = [
  { value: 'vendor', label: 'Vendor' },
  { value: 'customer', label: 'Customer' },
  { value: 'employer', label: 'Employer' },
  { value: 'employee', label: 'Employee' },
  { value: 'licensor', label: 'Licensor' },
  { value: 'licensee', label: 'Licensee' },
  { value: 'landlord', label: 'Landlord' },
  { value: 'tenant', label: 'Tenant' },
  { value: 'lender', label: 'Lender' },
  { value: 'borrower', label: 'Borrower' },
  { value: 'guarantor', label: 'Guarantor' },
  { value: 'other', label: 'Other' },
];

function Badge({ bg, color, children }) {
  return (
    <span style={{ background: bg, color, fontSize: 12, padding: '3px 9px', borderRadius: 999, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

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

// At-a-glance summary shown above the clause list — risk counts, obligation
// counts, and major dates, so the user isn't forced to scroll the whole
// clause list just to know whether anything needs attention.
function ReviewSummaryBar({ contract, review, obligations, getIcon, onJumpToRisky }) {
  const clauses = review?.clauses || [];
  const counts = { risky: 0, unclear: 0, standard: 0 };
  for (const c of clauses) {
    if (c.isContextOnly) continue;
    if (counts[c.riskLevel] != null) counts[c.riskLevel] += 1;
  }
  const overdue = obligations.filter((o) => o.derivedStatus === 'overdue' && o.userState !== 'handled').length;
  const upcoming = obligations.filter((o) => o.derivedStatus === 'upcoming' && o.userState !== 'handled').length;

  const dateBits = [];
  if (contract?.effectiveDate) dateBits.push(`Effective ${new Date(contract.effectiveDate).toLocaleDateString()}`);
  if (contract?.termLengthMonths) dateBits.push(`${contract.termLengthMonths}-month term`);

  const recommendation = counts.risky > 0
    ? `Start with the ${counts.risky} risky clause${counts.risky === 1 ? '' : 's'} below.`
    : counts.unclear > 0
      ? `${counts.unclear} clause${counts.unclear === 1 ? ' needs' : 's need'} a closer look.`
      : overdue > 0
        ? `${overdue} obligation${overdue === 1 ? ' is' : 's are'} overdue — see the Obligations tab.`
        : 'No risky clauses flagged for your confirmed party.';

  const Stat = ({ label, value, color }) => (
    <div className="rounded-lg border px-3 py-2 text-center" style={FIELD}>
      <div className="text-xl font-semibold" style={{ color: color || 'var(--color-text)' }}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{label}</div>
    </div>
  );

  return (
    <div className="rounded-lg border p-4" style={CARD}>
      <h2 className="text-base font-semibold mb-3">At a glance</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Stat label="Risky" value={counts.risky} color={counts.risky ? '#991b1b' : undefined} />
        <Stat label="Unclear" value={counts.unclear} color={counts.unclear ? '#92400e' : undefined} />
        <Stat label="Standard" value={counts.standard} />
        <Stat label="Overdue / upcoming" value={`${overdue} / ${upcoming}`} color={overdue ? '#991b1b' : undefined} />
      </div>
      {dateBits.length > 0 && (
        <div className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>{dateBits.join(' · ')}</div>
      )}
      <div className="flex items-center gap-2 text-sm rounded-lg p-2" style={{ background: 'var(--color-bg)' }}>
        {getIcon('arrow-right', { size: 14, style: { color: 'var(--color-primary)', flexShrink: 0 } })}
        <span>{recommendation}</span>
        {counts.risky > 0 && (
          <button onClick={onJumpToRisky} className={`ml-auto text-xs font-medium hover:opacity-70 rounded ${FOCUS_RING}`} style={{ transition: 'opacity 200ms', color: 'var(--color-primary)' }}>
            Jump to risky clauses
          </button>
        )}
      </div>
    </div>
  );
}

// Drag-and-drop upload zone — a bare browser file input was visually
// disconnected from the rest of the interface and gave no indication of
// accepted types or size limit up front.
function UploadDropZone({ file, onFile, accept = '.pdf,.docx', maxLabel = '50MB max', hint = 'PDF or DOCX' }) {
  const getIcon = useIcon();
  const [dragOver, setDragOver] = useState(false);
  const inputId = React.useId();
  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors"
      style={{
        borderColor: dragOver ? 'var(--color-primary)' : 'var(--color-border)',
        background: dragOver ? 'var(--color-bg)' : 'transparent',
      }}
    >
      <span style={{ color: dragOver ? 'var(--color-primary)' : 'var(--color-muted)' }}>{getIcon('upload', { size: 22 })}</span>
      {file ? (
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{file.name}</span>
      ) : (
        <>
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Drop a file here, or click to browse</span>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{hint} · {maxLabel}</span>
        </>
      )}
      <input
        id={inputId} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
    </label>
  );
}

function NotLegalAdviceBanner() {
  return (
    <div style={{ background: '#fef3c7', color: '#92400e', padding: '8px 16px', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
      Informational only — not legal advice. Always confirm important decisions with a qualified lawyer.
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

function formatObligationTiming(o) {
  if (o.absoluteDate) return new Date(o.absoluteDate).toLocaleDateString();
  if (o.rrule) return `Recurring`;
  if (o.anchorEvent) {
    const anchorLabel = {
      effective_date: 'the effective date', renewal_date: 'renewal', invoice_date: 'invoice date',
      termination: 'termination', custom: o.anchorCustomLabel || 'a custom event',
    }[o.anchorEvent] || o.anchorEvent;
    if (o.offsetDays != null) {
      const days = Math.abs(o.offsetDays);
      const direction = o.offsetDays < 0 ? 'before' : 'after';
      return `${days} day${days === 1 ? '' : 's'} ${direction} ${anchorLabel}`;
    }
    return anchorLabel;
  }
  return 'No fixed date';
}

function ContractReviewHelp({ onClose, getIcon }) {
  const STAGES = [
    { stage: 'Extraction & segmentation', what: 'PDF/DOCX text pulled out and split into individually addressable clauses (numbered where possible).' },
    { stage: 'Type detection', what: "The contract's type (lease, employment, services, NDA, etc.) is identified to steer which checks apply." },
    { stage: 'Party extraction', what: 'Every named party is detected. Analysis pauses here until you confirm which one is you — see Part 2 below.' },
    { stage: 'Definitions', what: "Defined terms (\"Confidential Information\" etc.) are extracted and verified against the source text." },
    { stage: 'Clause classification & risk scoring', what: 'Each clause is scored Risky / Unclear / Standard specifically for your confirmed party — the same clause can score differently for the other side.' },
    { stage: 'Obligations', what: 'Dates, deadlines, and recurring duties are extracted with their trigger (absolute date, recurring rule, or an anchor event like "30 days after termination").' },
    { stage: 'Summary', what: 'A short plain-English summary of the whole document, each point tagged with how well it could be verified against the source text.' },
  ];

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col rounded-2xl border shadow-2xl mx-4 overflow-hidden"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', width: '100%', maxWidth: 720, maxHeight: '90dvh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            {getIcon('book', { size: 16 })}
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Contract Review — How it works</span>
          </div>
          <button
            onClick={onClose}
            style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
          >
            {getIcon('close', { size: 18 })}
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-6 py-5 space-y-6 text-sm" style={{ color: 'var(--color-text)' }}>
          <p style={{ color: 'var(--color-muted)' }}>
            Upload a contract and it runs through a fixed pipeline, then two things stay in your hands throughout: whose side the risk flags are scored for, and whether any given flag actually applies to your situation.
          </p>

          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>Part 1 — The analysis pipeline</h2>
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
                    <th className="text-left px-4 py-2.5 font-semibold border-b" style={{ borderColor: 'var(--color-border)', width: '32%' }}>Stage</th>
                    <th className="text-left px-4 py-2.5 font-semibold border-b" style={{ borderColor: 'var(--color-border)' }}>What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {STAGES.map((row, i) => (
                    <tr key={i} style={{ borderBottom: i < STAGES.length - 1 ? `1px solid var(--color-border)` : 'none' }}>
                      <td className="px-4 py-3 align-top font-medium" style={{ color: 'var(--color-text)' }}>{row.stage}</td>
                      <td className="px-4 py-3 align-top" style={{ color: 'var(--color-muted)' }}>{row.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>Part 2 — Why it asks "which party are you?"</h2>
            <p style={{ color: 'var(--color-muted)' }}>
              A termination clause that's risky for a tenant can be entirely standard for a landlord. Risk scoring can't be neutral, so analysis pauses after party extraction until you confirm your side — correcting a detected name or role right there if it's wrong, or adding yourself manually if nobody was detected at all. You can later run an independent review of the same document as a different party without disturbing this one.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>Part 3 — Verification badges</h2>
            <ul className="space-y-1 text-xs list-disc list-inside" style={{ color: 'var(--color-muted)' }}>
              <li><strong style={{ color: 'var(--color-text)' }}>Verified</strong> — the clause/quote text was matched back to the source document exactly.</li>
              <li><strong style={{ color: 'var(--color-text)' }}>Verified (approx.)</strong> — matched after normalizing whitespace/punctuation, not a byte-for-byte match.</li>
              <li><strong style={{ color: 'var(--color-text)' }}>Unverified</strong> — could not be confirmed against the source text. Treat with more caution than a verified flag.</li>
            </ul>
          </section>

          <section className="rounded-xl p-4 border-l-4" style={{ background: 'var(--color-bg)', borderLeftColor: 'var(--color-primary)', border: '1px solid var(--color-border)', borderLeft: '4px solid var(--color-primary)' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Suggested redlines are advisory only</p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Any suggested redline text is copy-paste-only wording for you to bring to a negotiation or a lawyer — it is never applied to the document automatically, and nothing here is legal advice.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t shrink-0 flex justify-end" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-70"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ContractReviewPage() {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const getIcon = useIcon();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const processing = useProcessingStore();
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const [searchParams] = useSearchParams();
  const crmClientIdFilter = searchParams.get('crmClientId') || null;

  const [view, setView] = useState('list'); // list | detail
  const [contracts, setContracts] = useState([]);
  const [error, setError] = useState('');
  const [selectedContractIds, setSelectedContractIds] = useState(new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState(null); // single-row inline confirm
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newFile, setNewFile] = useState(null);

  const [contract, setContract] = useState(null);
  const [review, setReview] = useState(null);
  const [obligations, setObligations] = useState([]);
  const [tab, setTab] = useState('overview'); // overview | review | obligations
  const [pickedPartyId, setPickedPartyId] = useState(null);
  const [manualPartyName, setManualPartyName] = useState('');
  const [manualPartyRole, setManualPartyRole] = useState('other');
  const [partyNameDrafts, setPartyNameDrafts] = useState({}); // partyId -> in-progress edit text
  const [correctionNote, setCorrectionNote] = useState({}); // clauseId -> note text
  const [clauseFilter, setClauseFilter] = useState('all'); // all | risky | unclear | standard | context
  const [clauseSort, setClauseSort] = useState('order'); // order | severity
  const [question, setQuestion] = useState('');
  const [qaHistory, setQaHistory] = useState([]); // [{question, answer, quote, answeredByContract}]
  const [qaLoading, setQaLoading] = useState(false);
  const [reportEmail, setReportEmail] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [crmClients, setCrmClients] = useState([]); // Finance's own client picker endpoint — canonical clients table
  const [titleDraft, setTitleDraft] = useState('');
  const [contractReviews, setContractReviews] = useState([]); // every review across every document under this contract
  const [reviewAsPartyId, setReviewAsPartyId] = useState({}); // documentId -> selected partyId for "Review as another party"
  const [revisionBusy, setRevisionBusy] = useState(null); // documentId currently uploading a revision
  const [compareFor, setCompareFor] = useState(null); // documentId currently showing a "What changed" view
  const [compareResult, setCompareResult] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // { kind: 'delete'|'expired'|'terminated', ... }
  const [obligationOwnerFilter, setObligationOwnerFilter] = useState('');
  const [obligationStatusFilter, setObligationStatusFilter] = useState('all'); // all | overdue | upcoming | recurring_or_relative | unverified | done

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags }); })
      .catch(() => {});
  }, []);

  // Optional link to an existing CRM contact/client — the canonical clients
  // listing (server/routes/clients.js), gated by the 'clients' feature flag
  // (not Finance's own picker-only wrapper, which sits behind the unrelated
  // 'finance' flag — a Contract Review user with CRM access but no Finance
  // access should still be able to link a contact).
  useEffect(() => {
    api.get('/api/clients')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setCrmClients(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const enabled = isAdmin || featureAccess.contractReview !== false;

  const loadContracts = useCallback(async () => {
    const qs = crmClientIdFilter ? `?crmClientId=${crmClientIdFilter}` : '';
    const res = await api.get(`/api/contract-review/contracts${qs}`);
    if (!res.ok) return;
    const data = await res.json();
    setContracts(data.contracts || []);
  }, [crmClientIdFilter]);

  useEffect(() => { loadContracts(); }, [loadContracts]);

  const toggleContractSelected = useCallback((id) => {
    setSelectedContractIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllContracts = useCallback(() => {
    setSelectedContractIds((prev) => (
      prev.size === contracts.length ? new Set() : new Set(contracts.map((c) => c.id))
    ));
  }, [contracts]);

  const deleteContractFromList = useCallback(async (id) => {
    await api.delete(`/api/contract-review/contracts/${id}`);
    setPendingDeleteId(null);
    setSelectedContractIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    await loadContracts();
  }, [loadContracts]);

  const deleteSelectedContracts = useCallback(async () => {
    await Promise.all([...selectedContractIds].map((id) => api.delete(`/api/contract-review/contracts/${id}`)));
    setPendingBulkDelete(false);
    setSelectedContractIds(new Set());
    await loadContracts();
  }, [selectedContractIds, loadContracts]);

  const loadContractReviews = useCallback(async (id) => {
    const res = await api.get(`/api/contract-review/contracts/${id}/reviews`);
    if (res.ok) setContractReviews((await res.json()).reviews || []);
  }, []);

  const openContract = useCallback(async (id) => {
    setError('');
    const res = await api.get(`/api/contract-review/contracts/${id}`);
    if (!res.ok) { setError('Could not load contract'); return; }
    const data = await res.json();
    setContract(data);
    setTitleDraft(data.title || '');
    setView('detail');
    setTab('overview');
    setQaHistory([]);
    setCompareFor(null);
    setCompareResult(null);
    await loadContractReviews(id);
    const latestDoc = (data.documents || [])[data.documents.length - 1];
    if (latestDoc) {
      const reviewsRes = await api.get(`/api/contract-review/documents/${latestDoc.id}/reviews`);
      if (reviewsRes.ok) {
        const { reviews } = await reviewsRes.json();
        if (reviews?.[0]) await openReview(reviews[0].id);
      }
    }
    const obRes = await api.get(`/api/contract-review/obligations?contractId=${id}`);
    if (obRes.ok) setObligations((await obRes.json()).obligations || []);
  }, [loadContractReviews]);

  const openReview = useCallback(async (reviewId) => {
    const res = await api.get(`/api/contract-review/reviews/${reviewId}`);
    if (res.ok) setReview(await res.json());
  }, []);

  const saveTitle = useCallback(async () => {
    const t = titleDraft.trim();
    if (!contract || !t || t === contract.title) return;
    const res = await api.post(`/api/contract-review/contracts/${contract.id}/title`, { title: t });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Could not save title'); return; }
    setError('');
    setContract((prev) => (prev ? { ...prev, title: t } : prev));
    await loadContracts();
  }, [contract, titleDraft, loadContracts]);

  const createContract = useCallback(async () => {
    if (!newTitle.trim() || !newFile) { setError('Title and a file are required'); return; }
    setError('');
    try {
      const result = await runWithStepLog(
        processing,
        'Uploading and reviewing contract…',
        'Extraction, segmentation, type detection, and party extraction run first — you may be asked to confirm your role before the rest of the analysis continues.',
        ['Creating contract', 'Uploading document', 'Extracting text', 'Detecting parties'],
        async () => {
          const createRes = await api.post('/api/contract-review/contracts', { title: newTitle.trim() });
          if (!createRes.ok) throw new Error((await createRes.json().catch(() => ({}))).error || 'Failed to create contract');
          const created = await createRes.json();

          const fd = new FormData();
          fd.append('file', newFile);
          const docRes = await api.postForm(`/api/contract-review/contracts/${created.id}/documents`, fd);
          if (!docRes.ok) throw new Error((await docRes.json().catch(() => ({}))).error || 'Failed to upload document');
          const doc = await docRes.json();

          const reviewRes = await api.post(`/api/contract-review/documents/${doc.id}/review`, {});
          if (!reviewRes.ok) throw new Error((await reviewRes.json().catch(() => ({}))).error || 'Failed to start review');
          return { contractId: created.id };
        },
        { stepIntervalMs: 900 }
      );
      setNewTitle(''); setNewFile(null);
      await loadContracts();
      await openContract(result.contractId);
    } catch (e) {
      setError(e.message || 'Failed to create contract review');
    }
  }, [newTitle, newFile, processing, loadContracts, openContract]);

  // Every review-starting/resuming call returns almost immediately — the
  // actual analysis runs in the background and can take several minutes
  // (several sequential LLM calls). This polls for the real terminal status
  // instead of awaiting one long-lived request, which previously hit an
  // infrastructure-level timeout before the server's own error response
  // could ever arrive — that's what surfaced as a generic "Failed to resume
  // review" with no real cause. Shared by confirmPartyIdAndResume,
  // reviewAsParty, and uploadRevision — all three start/resume a review and
  // must wait for it to actually finish before refreshing anything, not just
  // fire the request and read back whatever mid-flight stage happens to be
  // there (a real bug: "Review as another party" and "Upload new revision"
  // both originally skipped this and showed a stuck-looking stage name).
  const pollReviewUntilTerminal = useCallback(async (reviewId, label) => {
    const terminal = new Set(['complete', 'failed', 'not_supported']);
    const prefix = label ? `${label} — ` : '';
    for (let attempt = 0; attempt < 200; attempt += 1) { // ~200 * 3s = 10 min ceiling
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await api.get(`/api/contract-review/reviews/${reviewId}`);
      if (!pollRes.ok) continue;
      const polled = await pollRes.json();
      const sp = polled.stageProgress || {};
      let detail = `${prefix}Stage: ${String(sp.stage || polled.status).replace(/_/g, ' ')}`;
      if (sp.stage === 'scoring' && sp.total) {
        detail = `${prefix}Scoring clause ${sp.current || 0} of ${sp.total}`;
        if (sp.etaSeconds != null) {
          detail += sp.etaSeconds < 60 ? ` — about ${sp.etaSeconds}s remaining` : ` — about ${Math.round(sp.etaSeconds / 60)}m remaining`;
        }
      }
      processing.updateProcessingDetail(detail);
      if (terminal.has(polled.status)) return polled;
    }
    throw new Error(`${prefix}Analysis is taking longer than expected — check back on this contract shortly.`);
  }, [processing]);

  const confirmPartyIdAndResume = useCallback(async (partyId) => {
    if (!partyId || !contract) return;
    const res = await api.post(`/api/contract-review/contracts/${contract.id}/parties/${partyId}/confirm`, {});
    if (!res.ok) { setError('Could not confirm role'); return; }
    setError('');
    const docLabel = (contract.documents || []).find((d) => d.id === review?.documentId)?.filename || null;
    processing.startProcessing(
      docLabel ? `Continuing analysis of ${docLabel}…` : 'Continuing analysis…',
      'Definitions, clause classification, risk scoring, obligations, and summary. This can take a few minutes.'
    );
    try {
      const resumeRes = await api.post(`/api/contract-review/reviews/${review.id}/resume`, {});
      if (!resumeRes.ok) throw new Error((await resumeRes.json().catch(() => ({}))).error || 'Failed to resume review');
      const finalReview = await pollReviewUntilTerminal(review.id, docLabel);
      if (finalReview.status === 'failed') throw new Error(finalReview.errorMessage || 'Analysis failed');
      setReview(finalReview);
      const obRes = await api.get(`/api/contract-review/obligations?contractId=${contract.id}`);
      if (obRes.ok) setObligations((await obRes.json()).obligations || []);
    } catch (e) {
      setError(e.message || 'Failed to continue analysis');
    } finally {
      processing.stopProcessing();
    }
  }, [contract, review, processing, pollReviewUntilTerminal]);

  const confirmRole = useCallback(async () => {
    await confirmPartyIdAndResume(pickedPartyId);
  }, [pickedPartyId, confirmPartyIdAndResume]);

  // Corrections, not a direct edit — the model's own extraction stays in
  // contract_parties untouched; recordCorrection stores the override and
  // the server applies it as the effective name/role everywhere (getContract,
  // and the role the pipeline actually uses once confirmed).
  const savePartyField = useCallback(async (partyId, field, value) => {
    if (!contract || !review) return;
    const res = await api.post(`/api/contract-review/reviews/${review.id}/corrections`, {
      contractId: contract.id, partyId, field, userValue: value, action: 'edit',
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || `Could not save ${field}`); return; }
    setError('');
    setContract((prev) => (prev ? { ...prev, parties: prev.parties.map((p) => (p.id === partyId ? { ...p, [field]: value } : p)) } : prev));
  }, [contract, review]);

  const linkPartyClient = useCallback(async (partyId, clientId) => {
    if (!contract) return;
    await api.post(`/api/contract-review/contracts/${contract.id}/parties/${partyId}/link-client`, { clientId: clientId || null });
    setContract((prev) => (prev ? { ...prev, parties: prev.parties.map((p) => (p.id === partyId ? { ...p, crmClientId: clientId ? Number(clientId) : null } : p)) } : prev));
  }, [contract]);

  // Covers the case where party extraction found nobody at all (a real,
  // observed failure mode — see docs/contract-review-spec.md) — the radio
  // list above has nothing to show and must not leave the user stuck behind
  // a permanently disabled button. Creates a party row for the user's own
  // side of the agreement, confirms it, then continues exactly like picking
  // an existing party would.
  const addManualPartyAndConfirm = useCallback(async () => {
    if (!manualPartyName.trim() || !contract) return;
    setError('');
    const res = await api.post(`/api/contract-review/contracts/${contract.id}/parties`, {
      name: manualPartyName.trim(), role: manualPartyRole, isUser: true,
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Could not add party'); return; }
    const party = await res.json();
    setContract((prev) => (prev ? { ...prev, parties: [...(prev.parties || []), party] } : prev));
    setManualPartyName('');
    await confirmPartyIdAndResume(party.id);
  }, [manualPartyName, manualPartyRole, contract, confirmPartyIdAndResume]);

  const recordCorrection = useCallback(async (target, action) => {
    if (!contract) return;
    const note = correctionNote[target.clauseId || target.obligationId] || '';
    const res = await api.post(`/api/contract-review/reviews/${review.id}/corrections`, {
      contractId: contract.id, ...target, field: target.field || 'riskLevel', action, note,
    });
    if (res.ok) await openReview(review.id);
  }, [contract, review, correctionNote, openReview]);

  const addToTask = useCallback(async (obligation) => {
    const dueDate = obligation.absoluteDate || null;
    const taskRes = await api.post('/api/tasks', {
      title: `Contract obligation: ${obligation.description}`,
      notes: `From contract review. ${obligation.quotedText ? `Source: "${obligation.quotedText}"` : ''}`,
      dueDate,
      category: 'Contract Review',
    });
    if (!taskRes.ok) return;
    const task = await taskRes.json();
    await api.post(`/api/contract-review/obligations/${obligation.id}/task`, { taskId: task.id });
    const obRes = await api.get(`/api/contract-review/obligations?contractId=${contract.id}`);
    if (obRes.ok) setObligations((await obRes.json()).obligations || []);
  }, [contract]);

  const setObligationState = useCallback(async (obligationId, state) => {
    await api.post(`/api/contract-review/obligations/${obligationId}/state`, { state });
    const obRes = await api.get(`/api/contract-review/obligations?contractId=${contract.id}`);
    if (obRes.ok) setObligations((await obRes.json()).obligations || []);
  }, [contract]);

  const toggleHold = useCallback(async () => {
    if (!contract) return;
    await api.post(`/api/contract-review/contracts/${contract.id}/hold`, { hold: !contract.legalHold });
    await openContract(contract.id);
  }, [contract, openContract]);

  const markExecuted = useCallback(async (documentId) => {
    await api.post(`/api/contract-review/documents/${documentId}/execute`, {});
    await openContract(contract.id);
  }, [contract, openContract]);

  // Runs a NEW, independent review of this document from an explicitly
  // chosen party's perspective — never reuses or disturbs the contract's
  // own confirmedByUser/isUser party. A document can end up with several
  // reviews this way, each its own userPartyId (see the reviews list).
  const reviewAsParty = useCallback(async (documentId) => {
    const partyId = reviewAsPartyId[documentId];
    if (!partyId || !contract) return;
    setError('');
    const docLabel = (contract.documents || []).find((d) => d.id === documentId)?.filename || null;
    const partyLabel = (contract.parties || []).find((p) => p.id === partyId)?.name || null;
    const label = [docLabel, partyLabel ? `as ${partyLabel}` : null].filter(Boolean).join(' — ') || null;
    processing.startProcessing(
      label ? `Reviewing ${label}…` : 'Reviewing from that party\'s perspective…',
      'This runs a full, independent analysis of this document for the chosen party — it does not affect any other review. This can take a few minutes.'
    );
    try {
      const res = await api.post(`/api/contract-review/documents/${documentId}/review`, { asPartyId: partyId });
      const started = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(started.error || 'Failed to start review');
      if (started.status !== 'awaiting_role_confirmation' && started.status !== 'not_supported' && started.status !== 'failed') {
        const finalReview = await pollReviewUntilTerminal(started.reviewId, label);
        if (finalReview.status === 'failed') throw new Error(finalReview.errorMessage || 'Analysis failed');
      }
      await openContract(contract.id);
    } catch (e) {
      setError(e.message || 'Failed to start review');
    } finally {
      processing.stopProcessing();
    }
  }, [contract, reviewAsPartyId, processing, pollReviewUntilTerminal, openContract]);

  const runCompare = useCallback(async (documentId) => {
    setCompareFor(documentId);
    setCompareResult(null);
    setCompareLoading(true);
    setError('');
    try {
      const res = await api.get(`/api/contract-review/documents/${documentId}/compare`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not compare versions');
      setCompareResult(data);
    } catch (e) {
      setError(e.message || 'Could not compare versions');
      setCompareFor(null);
    } finally {
      setCompareLoading(false);
    }
  }, []);

  const uploadRevision = useCallback(async (documentId, file) => {
    if (!file || !contract) return;
    setRevisionBusy(documentId);
    setError('');
    processing.startProcessing(`Uploading and reviewing ${file.name}…`, 'Extraction, segmentation, and the full analysis pipeline run for this revision. This can take a few minutes.');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('parentDocumentId', String(documentId));
      const docRes = await api.postForm(`/api/contract-review/contracts/${contract.id}/documents`, fd);
      if (!docRes.ok) throw new Error((await docRes.json().catch(() => ({}))).error || 'Failed to upload revision');
      const doc = await docRes.json();
      const reviewRes = await api.post(`/api/contract-review/documents/${doc.id}/review`, {});
      const started = await reviewRes.json().catch(() => ({}));
      if (!reviewRes.ok) throw new Error(started.error || 'Failed to start review');
      // A revision reuses the contract's already-confirmed party (see
      // extractPartiesAndKeyTerms's reconciliation), so this normally skips
      // awaiting_role_confirmation entirely — but a genuinely new party
      // situation could still pause it, in which case there's nothing to
      // poll for yet.
      let reviewSucceeded = false;
      if (started.status !== 'awaiting_role_confirmation' && started.status !== 'not_supported' && started.status !== 'failed') {
        const finalReview = await pollReviewUntilTerminal(started.reviewId, file.name);
        if (finalReview.status === 'failed') throw new Error(finalReview.errorMessage || 'Analysis failed');
        reviewSucceeded = finalReview.status === 'complete';
      }
      await openContract(contract.id);
      // The whole point of uploading a revision is "what's different from
      // last time" — surface that automatically instead of making the user
      // find and click "What changed" themselves afterward.
      if (reviewSucceeded) {
        setTab('documents');
        await runCompare(doc.id);
      }
    } catch (e) {
      setError(e.message || 'Failed to upload revision');
    } finally {
      setRevisionBusy(null);
      processing.stopProcessing();
    }
  }, [contract, processing, pollReviewUntilTerminal, openContract, runCompare]);


  // These three previously fired immediately (setStatus via a bare
  // window.confirm, deleteContract with no confirmation at all) — a UX
  // review flagged all three as needing a real confirmation screen that
  // explains the consequence, matching the ConfirmModal convention used
  // elsewhere for high-stakes operations.
  const setStatus = useCallback(async (status) => {
    if (!contract) return;
    await api.post(`/api/contract-review/contracts/${contract.id}/status`, { status });
    setConfirmAction(null);
    await openContract(contract.id);
  }, [contract, openContract]);

  const deleteContract = useCallback(async () => {
    if (!contract) return;
    await api.delete(`/api/contract-review/contracts/${contract.id}`);
    setConfirmAction(null);
    setView('list');
    setContract(null);
    await loadContracts();
  }, [contract, loadContracts]);

  const exportIcs = useCallback(async () => {
    if (!contract) return;
    await api.download(`/api/contract-review/export.ics?contractId=${contract.id}`, `contract-${contract.id}.ics`);
  }, [contract]);

  const askQuestion = useCallback(async () => {
    const q = question.trim();
    if (!q || !contract) return;
    setQaLoading(true);
    setError('');
    try {
      const res = await api.post(`/api/contract-review/contracts/${contract.id}/ask`, { question: q });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not get an answer');
      setQaHistory((prev) => [{ question: q, ...data }, ...prev]);
      setQuestion('');
    } catch (e) {
      setError(e.message || 'Could not get an answer');
    } finally {
      setQaLoading(false);
    }
  }, [question, contract]);

  const downloadReport = useCallback(async () => {
    if (!contract) return;
    setReportBusy(true);
    setError('');
    try {
      const qs = review?.id ? `?reviewId=${review.id}` : '';
      await api.download(`/api/contract-review/contracts/${contract.id}/report/pdf${qs}`, `${contract.title || 'contract'}-review.pdf`);
    } catch (e) {
      setError(e.message || 'Could not generate report');
    } finally {
      setReportBusy(false);
    }
  }, [contract, review]);

  const emailReport = useCallback(async () => {
    if (!contract || !reportEmail.trim()) return;
    setReportBusy(true);
    setError('');
    try {
      const res = await api.post(`/api/contract-review/contracts/${contract.id}/report/email`, { reviewId: review?.id || null, to: reportEmail.trim() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send report');
      setReportEmail('');
    } catch (e) {
      setError(e.message || 'Could not send report');
    } finally {
      setReportBusy(false);
    }
  }, [contract, review, reportEmail]);

  const setObligationField = useCallback(async (obligation, field, value) => {
    if (!contract || !review) return;
    const res = await api.post(`/api/contract-review/reviews/${review.id}/corrections`, {
      contractId: contract.id, obligationId: obligation.id, field, userValue: value, action: 'edit',
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || `Could not save ${field}`); return; }
    setError('');
    const obRes = await api.get(`/api/contract-review/obligations?contractId=${contract.id}`);
    if (obRes.ok) setObligations((await obRes.json()).obligations || []);
  }, [contract, review]);

  if (!enabled) {
    return (
      <div className="p-6">
        <NotLegalAdviceBanner />
        <p style={{ color: 'var(--color-muted)' }} className="mt-4">Contract Review is not available for your account.</p>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--color-bg)', color: 'var(--color-text)', minHeight: '100dvh' }}>
      <NotLegalAdviceBanner />
      {helpOpen && <ContractReviewHelp onClose={() => setHelpOpen(false)} getIcon={getIcon} />}
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        {view === 'list' && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <h1 className="text-xl font-semibold">Contract Review</h1>
              <button
                onClick={() => { localStorage.removeItem(CR_TOUR_KEY); startContractReviewTour(navigate); }}
                title="Take the Contract Review tour"
                style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, transition: 'color 0.2s' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
              >
                {getIcon('compass', { size: 15 })}
              </button>
              <button
                onClick={() => setHelpOpen(true)}
                title="How this tool works"
                style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, transition: 'color 0.2s' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
              >
                {getIcon('info', { size: 15 })}
              </button>
            </div>
            {crmClientIdFilter && (
              <div className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
                Showing contracts linked to this CRM contact only. <Link to="/contract-review" style={{ color: 'var(--color-primary)' }}>Show all contracts</Link>
              </div>
            )}
            {error && <div style={{ color: '#991b1b' }} className="mb-3 text-sm">{error}</div>}

            <div className="rounded-lg border p-4 mb-6" style={CARD} data-tour="contract-review-upload">
              <h2 className="text-base font-semibold mb-3">New contract review</h2>
              <Tooltip text="A short label to find this contract again later — doesn't affect the analysis.">
                <input
                  type="text" placeholder="Contract title" value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className={`w-full rounded border px-3 py-2 text-sm mb-3 ${FOCUS_RING}`} style={FIELD}
                />
              </Tooltip>
              <Tooltip text="PDF or DOCX only. This kicks off extraction, segmentation, type detection, and party extraction.">
                <div className="mb-3">
                  <UploadDropZone file={newFile} onFile={setNewFile} />
                </div>
              </Tooltip>
              <PrimaryButton onClick={createContract} disabled={!newTitle.trim() || !newFile} large>
                Upload &amp; review
              </PrimaryButton>
            </div>

            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h2 className="text-base font-semibold">Your contracts</h2>
              {contracts.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-1 text-xs hover:opacity-70 cursor-pointer" style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}>
                    <input type="checkbox" checked={selectedContractIds.size === contracts.length} onChange={toggleSelectAllContracts} />
                    Select all
                  </label>
                  {selectedContractIds.size > 0 && (
                    pendingBulkDelete ? (
                      <span className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                        Delete {selectedContractIds.size} contract{selectedContractIds.size === 1 ? '' : 's'}?
                        <button onClick={deleteSelectedContracts} className="hover:opacity-70" style={{ transition: 'opacity 200ms', color: '#991b1b' }}>Yes</button>
                        <button onClick={() => setPendingBulkDelete(false)} className="hover:opacity-70" style={{ transition: 'opacity 200ms' }}>No</button>
                      </span>
                    ) : (
                      <button onClick={() => setPendingBulkDelete(true)} className="rounded border px-2 py-1 text-xs hover:opacity-70" style={{ transition: 'opacity 200ms', borderColor: '#991b1b', color: '#991b1b' }}>
                        Delete selected ({selectedContractIds.size})
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              {contracts.map((c) => (
                <div
                  key={c.id}
                  className="w-full rounded-lg border p-3 flex items-center gap-2 hover:opacity-70"
                  style={{ ...CARD, transition: 'opacity 200ms' }}
                >
                  <input
                    type="checkbox" checked={selectedContractIds.has(c.id)}
                    onChange={() => toggleContractSelected(c.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button onClick={() => openContract(c.id)} className={`flex-1 text-left flex items-center justify-between gap-2 rounded ${FOCUS_RING}`}>
                    <div>
                      <div className="text-sm font-medium">{c.title}</div>
                      <div className="text-xs flex items-center gap-1.5 mt-0.5" style={{ color: 'var(--color-muted)' }}>
                        <span className="capitalize">{contractTypeLabel(c)}</span>
                        <span>·</span>
                        <Badge bg={(CONTRACT_STATUS_BADGE[c.status] || {}).bg} color={(CONTRACT_STATUS_BADGE[c.status] || {}).color}>
                          {(CONTRACT_STATUS_BADGE[c.status] || {}).text || c.status}
                        </Badge>
                      </div>
                    </div>
                    {getIcon('chevron-right', { size: 16 })}
                  </button>
                  {pendingDeleteId === c.id ? (
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                      Delete?
                      <button onClick={() => deleteContractFromList(c.id)} className="hover:opacity-70" style={{ transition: 'opacity 200ms', color: '#991b1b' }}>Yes</button>
                      <button onClick={() => setPendingDeleteId(null)} className="hover:opacity-70" style={{ transition: 'opacity 200ms' }}>No</button>
                    </span>
                  ) : (
                    <button onClick={() => setPendingDeleteId(c.id)} className="text-xs hover:opacity-70" style={{ transition: 'opacity 200ms', color: '#991b1b' }}>Del</button>
                  )}
                </div>
              ))}
              {!contracts.length && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No contracts yet.</div>}
            </div>
          </>
        )}

        {view === 'detail' && contract && (
          <>
            <button onClick={() => { setView('list'); setContract(null); setReview(null); }} className="text-sm mb-3 hover:opacity-70" style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}>
              ← All contracts
            </button>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <Tooltip text="Click to rename this contract. Saves automatically when you click away.">
                <input
                  type="text" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={saveTitle} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                  className="text-lg font-semibold rounded border px-2 py-1 bg-transparent"
                  style={{ borderColor: 'transparent', minWidth: 200 }}
                  onFocus={(e) => { e.target.style.borderColor = 'var(--color-border)'; }}
                />
              </Tooltip>
              <div className="flex items-center gap-2">
                <Badge bg="var(--color-bg)" color="var(--color-muted)"><span className="capitalize">{contractTypeLabel(contract)}</span></Badge>
                <Badge bg={(CONTRACT_STATUS_BADGE[contract.status] || {}).bg} color={(CONTRACT_STATUS_BADGE[contract.status] || {}).color}>
                  {(CONTRACT_STATUS_BADGE[contract.status] || {}).text || contract.status}
                </Badge>
                {contract.legalHold && getIcon('lock', { size: 14, color: '#92400e' })}
              </div>
            </div>
            {error && <div style={{ color: '#991b1b' }} className="mb-3 text-sm">{error}</div>}

            <div className="flex gap-4 mb-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
              {[
                { key: 'overview', label: 'Overview' },
                { key: 'documents', label: 'Documents & Reviews' },
                { key: 'review', label: 'Review' },
                { key: 'obligations', label: 'Obligations' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`pb-2 text-sm hover:opacity-70 rounded-t ${FOCUS_RING}`}
                  style={{ transition: 'opacity 200ms', borderBottom: tab === key ? '2px solid var(--color-primary)' : '2px solid transparent', fontWeight: tab === key ? 600 : 400, color: tab === key ? 'var(--color-text)' : 'var(--color-muted)' }}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <div className="space-y-4">
                <div className="rounded-lg border p-4" style={CARD}>
                  <h2 className="text-base font-semibold mb-2">Parties</h2>
                  {(contract.parties || []).map((p) => (
                    <div key={p.id} className="flex items-center gap-2 py-1 flex-wrap">
                      <span className="text-sm">{p.name}</span>
                      <Badge bg="var(--color-bg)" color="var(--color-muted)">{p.role}</Badge>
                      {p.isUser && <Badge bg="#e0e7ff" color="#3730a3">You</Badge>}
                      {p.confirmedByUser && getIcon('check-circle', { size: 14, color: '#166534' })}
                      <Tooltip text="Link this party to an existing CRM contact — no effect on the analysis, just cross-references the two.">
                        <select
                          value={p.crmClientId || ''}
                          onChange={(e) => linkPartyClient(p.id, e.target.value)}
                          className="rounded border px-2 py-0.5 text-xs ml-auto" style={FIELD}
                        >
                          <option value="">No linked CRM contact</option>
                          {crmClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </Tooltip>
                    </div>
                  ))}
                  {!contract.parties?.length && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No parties extracted yet.</div>}
                </div>

                <div className="rounded-lg border p-4" style={CARD}>
                  <h2 className="text-base font-semibold mb-2">Actions</h2>
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton onClick={toggleHold}>
                      {contract.legalHold ? 'Release legal hold' : 'Set legal hold'}
                    </SecondaryButton>
                    <SecondaryButton onClick={() => setConfirmAction({ kind: 'expired' })}>Mark expired</SecondaryButton>
                    <SecondaryButton onClick={() => setConfirmAction({ kind: 'terminated' })}>Mark terminated</SecondaryButton>
                    <DestructiveButton onClick={() => setConfirmAction({ kind: 'delete' })}>Delete contract</DestructiveButton>
                  </div>
                  <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
                    Deletion removes everything under this contract. A contract on legal hold cannot be deleted.
                  </p>
                </div>

                {confirmAction?.kind === 'delete' && (
                  <ConfirmModal
                    title="Delete this contract?"
                    message="This removes every document, review, clause, obligation, and correction under this contract from view, and unlinks any Tasks created from its obligations. This cannot be undone from the app."
                    confirmLabel="Delete contract"
                    confirmText={contract.title}
                    danger
                    onConfirm={deleteContract}
                    onCancel={() => setConfirmAction(null)}
                  />
                )}
                {confirmAction?.kind === 'expired' && (
                  <ConfirmModal
                    title="Mark this contract as expired?"
                    message="Its term has ended. This is a status change, not a deletion — the contract, its documents, and its history all stay exactly as they are."
                    confirmLabel="Mark expired"
                    onConfirm={() => setStatus('expired')}
                    onCancel={() => setConfirmAction(null)}
                  />
                )}
                {confirmAction?.kind === 'terminated' && (
                  <ConfirmModal
                    title="Mark this contract as terminated?"
                    message="The agreement has been ended before its natural term. This is a status change, not a deletion — the contract, its documents, and its history all stay exactly as they are."
                    confirmLabel="Mark terminated"
                    onConfirm={() => setStatus('terminated')}
                    onCancel={() => setConfirmAction(null)}
                  />
                )}

                {review && (
                  <div className="rounded-lg border p-4" style={CARD}>
                    <h2 className="text-base font-semibold mb-2">Report</h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <Tooltip text="Banner, parties and role, every flag with its reason and redline, and obligations.">
                        <button onClick={downloadReport} disabled={reportBusy} className="rounded border px-3 py-1.5 text-xs hover:opacity-70 flex items-center gap-1" style={{ ...FIELD, transition: 'opacity 200ms', opacity: reportBusy ? 0.5 : 1 }}>
                          {getIcon('download', { size: 14 })} Download PDF
                        </button>
                      </Tooltip>
                      <Tooltip text="Sends the same PDF report to this address instead of downloading it.">
                        <input
                          type="email" value={reportEmail} onChange={(e) => setReportEmail(e.target.value)}
                          placeholder="Email address" className="rounded border px-2 py-1.5 text-sm" style={FIELD}
                        />
                      </Tooltip>
                      <button onClick={emailReport} disabled={reportBusy || !reportEmail.trim()} className="rounded border px-3 py-1.5 text-xs hover:opacity-70" style={{ ...FIELD, transition: 'opacity 200ms', opacity: reportBusy || !reportEmail.trim() ? 0.5 : 1 }}>
                        Send report
                      </button>
                    </div>
                    <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
                      Banner, parties and role, flags with reasons and redlines, and obligations.
                    </p>
                  </div>
                )}

                <div className="rounded-lg border p-4" style={CARD}>
                  <h2 className="text-base font-semibold mb-2">History</h2>
                  {(contract.events || []).map((ev) => (
                    <div key={ev.id} className="text-xs py-1" style={{ color: 'var(--color-muted)' }}>
                      {new Date(ev.occurredAt).toLocaleString()} — {ev.type.replace(/_/g, ' ')}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'documents' && (
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
                          <Tooltip text="Uploads a new version of this document and runs the full analysis pipeline on it again.">
                            <label className={`text-xs rounded border px-2.5 py-1 hover:opacity-80 cursor-pointer ${FOCUS_RING}`} style={{ transition: 'opacity 200ms', ...BTN_SECONDARY_SM }}>
                              {revisionBusy === d.id ? 'Uploading…' : 'Upload new revision'}
                              <input
                                type="file" accept=".pdf,.docx" className="hidden" disabled={revisionBusy === d.id}
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadRevision(d.id, f); e.target.value = ''; }}
                              />
                            </label>
                          </Tooltip>
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
                          onClick={() => { openReview(r.id); setTab('review'); }}
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
            )}

            {tab === 'review' && (
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
                  <div className="rounded-lg border p-4" style={{ ...CARD, borderColor: 'var(--color-primary)' }}>
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
                  <div className="rounded-lg border p-4" style={{ ...CARD, borderColor: 'var(--color-primary)' }}>
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

                {review && !['queued', 'extracting', 'segmenting', 'awaiting_role_confirmation', 'failed', 'not_supported'].includes(review.status) && (
                  <>
                    {(() => {
                      const reviewingAs = (contract.parties || []).find((p) => p.id === review.userPartyId);
                      return (
                        <div className="rounded-lg border p-3 text-sm flex items-center gap-2 flex-wrap" style={{ ...CARD, borderColor: 'var(--color-primary)' }}>
                          {reviewingAs ? (
                            <>
                              {getIcon('user', { size: 14, style: { color: 'var(--color-primary)' } })}
                              <span>Reviewing as <strong>{reviewingAs.name}</strong></span>
                              <Badge bg="var(--color-bg)" color="var(--color-muted)">{reviewingAs.role}</Badge>
                              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>— risk flags below are assessed for this party</span>
                            </>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>No perspective set for this review.</span>
                          )}
                          <div className="flex items-center gap-2 ml-auto">
                            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Review this same document as:</span>
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
                            <PrimaryButton onClick={() => reviewAsParty(review.documentId)} disabled={!reviewAsPartyId[review.documentId]}>
                              Run new review
                            </PrimaryButton>
                          </div>
                        </div>
                      );
                    })()}
                    {review.costUsd != null && (
                      <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        Analysis cost: ${Number(review.costUsd).toFixed(4)}
                      </div>
                    )}

                    {(review.clauses || []).length > 0 && (
                      <ReviewSummaryBar
                        contract={contract} review={review} obligations={obligations} getIcon={getIcon}
                        onJumpToRisky={() => { setClauseFilter('risky'); setClauseSort('order'); document.getElementById('cr-clauses-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                      />
                    )}

                    {review.coverageReport?.length > 0 && (
                      <div className="rounded-lg border p-4" style={CARD}>
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
                      <div className="rounded-lg border p-4" style={CARD}>
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

                    <div id="cr-clauses-card" className="rounded-lg border p-4 scroll-mt-4" style={CARD}>
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

                    <div className="rounded-lg border p-4" style={CARD}>
                      <h2 className="text-base font-semibold mb-2">Ask about this contract</h2>
                      <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>Searches every document and revision under this contract, not just the one currently open.</p>
                      <div className="flex gap-2 mb-3">
                        <Tooltip text="Answers are grounded in the actual clause text and quote the clause they're based on — searches every document and revision under this contract.">
                          <input
                            type="text" value={question} onChange={(e) => setQuestion(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !qaLoading) askQuestion(); }}
                            placeholder="e.g. How much notice do I need to give to terminate?"
                            className={`flex-1 rounded border px-3 py-2 text-sm ${FOCUS_RING}`} style={FIELD}
                          />
                        </Tooltip>
                        <PrimaryButton onClick={askQuestion} disabled={qaLoading || !question.trim()}>
                          {qaLoading ? 'Asking…' : 'Ask'}
                        </PrimaryButton>
                      </div>
                      <div className="space-y-3">
                        {qaHistory.map((h, i) => (
                          <div key={i} className="rounded border p-3" style={FIELD}>
                            <div className="text-xs font-semibold mb-1">{h.question}</div>
                            {h.answeredByContract ? (
                              <>
                                <p className="text-sm mb-1">{h.answer}</p>
                                {h.quote && (
                                  <div className="text-xs mt-1 rounded p-2 flex items-start gap-2" style={{ background: 'var(--color-bg)' }}>
                                    {getIcon((VERIFY_BADGE[h.quote.verificationStatus] || VERIFY_BADGE.failed).icon, { size: 12, style: { marginTop: 2, color: (VERIFY_BADGE[h.quote.verificationStatus] || VERIFY_BADGE.failed).color } })}
                                    <span>"{h.quote.text}"{h.documentVersion != null && ` — version ${h.documentVersion}`}</span>
                                  </div>
                                )}
                                {h.perspectiveNote && (
                                  <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Perspective: {h.perspectiveNote}</div>
                                )}
                              </>
                            ) : (
                              <p className="text-sm italic" style={{ color: 'var(--color-muted)' }}>{h.answer}</p>
                            )}
                          </div>
                        ))}
                        {!qaHistory.length && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>Ask a question about this contract — answers quote the clause they're based on.</div>}
                      </div>
                    </div>

                    {review.definitions?.length > 0 && (
                      <div className="rounded-lg border p-4" style={CARD}>
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
            )}

            {tab === 'obligations' && (
              <div className="rounded-lg border p-4" style={CARD}>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className="text-base font-semibold">What you need to do</h2>
                  <SecondaryButton onClick={exportIcs} className="flex items-center gap-1">
                    {getIcon('calendar-check', { size: 14 })} Export .ics
                  </SecondaryButton>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <Tooltip text="Show only obligations owed by one party.">
                    <select
                      value={obligationOwnerFilter}
                      onChange={(e) => setObligationOwnerFilter(e.target.value)}
                      className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}
                    >
                      <option value="">All owners</option>
                      <option value="unresolved">Obligor unresolved</option>
                      {(contract.parties || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Tooltip>
                  <Tooltip text="Filter by timing status — overdue, upcoming, unverified, or already marked done.">
                    <select
                      value={obligationStatusFilter}
                      onChange={(e) => setObligationStatusFilter(e.target.value)}
                      className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}
                    >
                      <option value="all">All statuses</option>
                      <option value="overdue">Overdue</option>
                      <option value="upcoming">Upcoming</option>
                      <option value="recurring_or_relative">Recurring / relative</option>
                      <option value="unverified">Unverified</option>
                      <option value="done">Done</option>
                    </select>
                  </Tooltip>
                  {(obligationOwnerFilter || obligationStatusFilter !== 'all') && (
                    <button
                      onClick={() => { setObligationOwnerFilter(''); setObligationStatusFilter('all'); }}
                      className={`text-xs hover:opacity-70 rounded ${FOCUS_RING}`} style={{ transition: 'opacity 200ms', color: 'var(--color-muted)' }}
                    >
                      Clear filters
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {obligations
                    .filter((o) => {
                      if (obligationOwnerFilter === 'unresolved' && o.obligorPartyId != null) return false;
                      if (obligationOwnerFilter && obligationOwnerFilter !== 'unresolved' && String(o.obligorPartyId) !== obligationOwnerFilter) return false;
                      if (obligationStatusFilter === 'done') return o.userState === 'handled';
                      if (obligationStatusFilter !== 'all' && obligationStatusFilter !== 'done') {
                        if (o.userState === 'handled') return false;
                        if (obligationStatusFilter === 'unverified') return o.derivedStatus === 'unverified';
                        return o.derivedStatus === obligationStatusFilter;
                      }
                      return true;
                    })
                    .map((o) => {
                    const unverified = o.derivedStatus === 'unverified';
                    const overdue = o.derivedStatus === 'overdue';
                    const done = o.userState === 'handled';
                    return (
                      <div key={o.id} className="rounded-lg border p-3" style={{ ...FIELD, opacity: done ? 0.6 : 1, borderLeft: overdue && !done ? '3px solid #991b1b' : undefined }}>
                        <div className="text-sm mb-2 font-medium" style={{ textDecoration: done ? 'line-through' : 'none' }}>{o.description}</div>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Tooltip text="Who owes this obligation. Correct it here if the extraction couldn't resolve it automatically.">
                            <select
                              value={o.obligorPartyId != null ? String(o.obligorPartyId) : ''}
                              onChange={(e) => setObligationField(o, 'obligorPartyId', e.target.value)}
                              className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}
                            >
                              <option value="">Obligor unresolved</option>
                              {(contract.parties || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </Tooltip>
                          <Tooltip text="Set or correct an exact due date — needed before this obligation can export to .ics or link to a Task with a due date.">
                            <input
                              type="date"
                              value={o.absoluteDate ? String(o.absoluteDate).slice(0, 10) : ''}
                              onChange={(e) => { if (e.target.value) setObligationField(o, 'absoluteDate', e.target.value); }}
                              className={`rounded border px-2 py-1 text-xs ${FOCUS_RING}`} style={FIELD}
                            />
                          </Tooltip>
                          {!o.absoluteDate && (
                            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>({formatObligationTiming(o)})</span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {o.documentStatus !== 'executed' && <Badge bg="#e0e7ff" color="#3730a3">Draft — not active</Badge>}
                          <Badge bg={overdue ? '#fee2e2' : 'var(--color-bg)'} color={overdue ? '#991b1b' : 'var(--color-muted)'}>{o.derivedStatus.replace(/_/g, ' ')}</Badge>
                          {unverified && <Badge bg="#fef3c7" color="#92400e">Unverified — not exported/linkable until confirmed</Badge>}
                          {o.userState && <Badge bg="#e0e7ff" color="#3730a3">{o.userState}</Badge>}
                          <div className="flex gap-2 ml-auto">
                            {!o.linkedTaskId && (
                              <PrimaryButton onClick={() => addToTask(o)}>Send to Tasks</PrimaryButton>
                            )}
                            {!done && (
                              <SecondaryButton onClick={() => setObligationState(o.id, 'handled')}>Mark done</SecondaryButton>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!obligations.length && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No obligations extracted for an active (executed) document yet.</div>}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
