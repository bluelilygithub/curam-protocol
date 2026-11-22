import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';

// Contract Review's shared look: card and field styles, the three button tiers, the status badges, the upload drop zone and the
// not-legal-advice banner. Used by every screen in this folder (one file per tool in the page's tool list).


export const CARD = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
export const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

// Action styling tiers — "Run review", "Mark as executed", "Send to Tasks"
// etc previously rendered as plain text links indistinguishable from quiet
// metadata; a real UX review flagged that primary actions must read as
// unmistakably clickable. Focus ring uses the theme's own primary colour
// instead of the browser default (also flagged — the default outline read
// as an accidental heavy black box around the active tab).
export const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-primary)]';
export const BTN_PRIMARY_SM = { background: 'var(--color-primary)', color: '#fff', border: '1px solid var(--color-primary)' };
export const BTN_SECONDARY_SM = { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
export const BTN_DESTRUCTIVE_SM = { background: 'transparent', borderColor: '#ef4444', color: '#ef4444' };

export function PrimaryButton({ children, className = '', style, large = false, ...props }) {
  return (
    <button
      {...props}
      className={`rounded-md font-semibold hover:opacity-70 disabled:opacity-50 disabled:cursor-not-allowed ${large ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'} ${FOCUS_RING} ${className}`}
      style={{ transition: 'opacity 200ms', ...BTN_PRIMARY_SM, ...style }}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, className = '', style, ...props }) {
  return (
    <button
      {...props}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium hover:opacity-70 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING} ${className}`}
      style={{ transition: 'opacity 200ms', ...BTN_SECONDARY_SM, ...style }}
    >
      {children}
    </button>
  );
}

export function DestructiveButton({ children, className = '', style, ...props }) {
  return (
    <button
      {...props}
      className={`rounded-md border px-3 py-1.5 text-xs font-semibold hover:opacity-70 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING} ${className}`}
      style={{ transition: 'opacity 200ms', ...BTN_DESTRUCTIVE_SM, ...style }}
    >
      {children}
    </button>
  );
}

export const RISK_BADGE = {
  risky: { text: 'Risky', bg: '#fee2e2', color: '#991b1b' },
  unclear: { text: 'Unclear', bg: '#fef3c7', color: '#92400e' },
  standard: { text: 'Standard', bg: '#dcfce7', color: '#166534' },
};

export const VERIFY_BADGE = {
  verified_exact: { text: 'Verified', icon: 'shield-check', bg: '#dcfce7', color: '#166534' },
  verified_normalized: { text: 'Verified (approx.)', icon: 'shield-check', bg: '#e0f2fe', color: '#075985' },
  failed: { text: 'Unverified', icon: 'alert-triangle', bg: '#fef3c7', color: '#92400e' },
};

export const COVERAGE_BADGE = {
  found: { text: 'Found', bg: '#dcfce7', color: '#166534' },
  not_found: { text: 'Not found', bg: '#fee2e2', color: '#991b1b' },
  could_not_assess: { text: 'Could not assess', bg: '#fef3c7', color: '#92400e' },
};

// riskImpact is computed deterministically server-side from the two
// already-scored riskLevels (see compareReviews.js's computeRiskImpact) —
// never re-derived by an LLM. recommendedAction/partyImpact are the
// genuinely interpretive fields, advisory only, same convention as
// suggestedRedline elsewhere in this feature.
export const RISK_IMPACT_BADGE = {
  improved: { text: 'Risk reduced', bg: '#dcfce7', color: '#166534' },
  worsened: { text: 'Risk increased', bg: '#fee2e2', color: '#991b1b' },
  new_risk: { text: 'New risk', bg: '#fee2e2', color: '#991b1b' },
  unchanged: { text: 'Risk unchanged', bg: 'var(--color-bg)', color: 'var(--color-muted)' },
};
export const RECOMMENDED_ACTION_BADGE = {
  accept: { text: 'Accept', bg: '#dcfce7', color: '#166534' },
  negotiate: { text: 'Negotiate', bg: '#fef3c7', color: '#92400e' },
  investigate: { text: 'Investigate', bg: '#fee2e2', color: '#991b1b' },
};

// Contract/document lifecycle status — previously a flat grey badge for
// every value ("draft", "complete", "base · v1", ...) with no colour or
// grouping to signal what each one actually means.
export const CONTRACT_STATUS_BADGE = {
  draft: { text: 'Draft', bg: 'var(--color-bg)', color: 'var(--color-muted)' },
  executed: { text: 'Executed', bg: '#dcfce7', color: '#166534' },
  expired: { text: 'Expired', bg: '#fef3c7', color: '#92400e' },
  terminated: { text: 'Terminated', bg: '#fee2e2', color: '#991b1b' },
};
export const DOCUMENT_STATUS_BADGE = {
  draft: { text: 'Draft', bg: 'var(--color-bg)', color: 'var(--color-muted)' },
  executed: { text: 'Executed', bg: '#dcfce7', color: '#166534' },
  superseded: { text: 'Superseded', bg: 'var(--color-bg)', color: 'var(--color-muted)' },
};


// "other" is a real enum value but reads as a non-answer in the UI —
// contractTypeRaw (the model's own free-text guess before it was mapped
// onto the fixed enum) is a clearer thing to show when available.
export function contractTypeLabel(c) {
  if (c?.contractType && c.contractType !== 'other') return c.contractType.replace(/_/g, ' ');
  return c?.contractTypeRaw ? c.contractTypeRaw : 'Uncategorized contract';
}

// Mirrors server's contract_parties.role CHECK constraint (server/db.js's
// PARTY_ROLE_KEYS) — a small, rarely-changing v1 taxonomy, not worth a shared
// module for the one dropdown that needs it.
export const ROLE_OPTIONS = [
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

export function Badge({ bg, color, children }) {
  return (
    <span style={{ background: bg, color, fontSize: 12, padding: '3px 9px', borderRadius: 999, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// Drag-and-drop upload zone — a bare browser file input was visually
// disconnected from the rest of the interface and gave no indication of
// accepted types or size limit up front. `compact` is a single-line inline
// variant for per-row use (e.g. uploading a document revision) where the
// full-size card would be too bulky to show per document.
export function UploadDropZone({ file, onFile, accept = '.pdf,.docx', maxLabel = '50MB max', hint = 'PDF or DOCX', compact = false }) {
  const getIcon = useIcon();
  const [dragOver, setDragOver] = useState(false);
  const inputId = React.useId();
  const dragHandlers = {
    onDragOver: (e) => { e.preventDefault(); setDragOver(true); },
    onDragLeave: () => setDragOver(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onFile(f);
    },
  };
  const borderStyle = {
    borderColor: dragOver ? 'var(--color-primary)' : 'var(--color-border)',
    background: dragOver ? 'var(--color-bg)' : 'transparent',
  };

  if (compact) {
    return (
      <label
        htmlFor={inputId} {...dragHandlers}
        className={`flex items-center gap-2 rounded-lg border-2 border-dashed px-3 py-2 cursor-pointer transition-colors ${FOCUS_RING}`}
        style={borderStyle}
      >
        <span style={{ color: dragOver ? 'var(--color-primary)' : 'var(--color-muted)', flexShrink: 0 }}>{getIcon('upload', { size: 16 })}</span>
        <span className="text-xs" style={{ color: file ? 'var(--color-text)' : 'var(--color-muted)' }}>
          {file ? file.name : `Drop a file, or click to browse — ${hint} · ${maxLabel}`}
        </span>
        <input
          id={inputId} type="file" accept={accept} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        />
      </label>
    );
  }

  return (
    <label
      htmlFor={inputId} {...dragHandlers}
      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors"
      style={borderStyle}
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

export function NotLegalAdviceBanner() {
  return (
    <div style={{ background: '#fef3c7', color: '#92400e', padding: '8px 16px', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
      Informational only — not legal advice. Always confirm important decisions with a qualified lawyer.
    </div>
  );
}

// Shared by ReviewProgressCard and pollReviewUntilTerminal's own detail
// text — one place for the "how much longer" phrasing so the two progress
// surfaces can't drift apart.
export function formatEtaRemaining(etaSeconds) {
  if (etaSeconds == null) return '';
  return etaSeconds < 60 ? ` — about ${etaSeconds}s remaining` : ` — about ${Math.round(etaSeconds / 60)}m remaining`;
}

export function formatObligationTiming(o) {
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
