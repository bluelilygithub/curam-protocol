import React from 'react';
import Tooltip from '../../components/Tooltip';
import { statusOf, typeOf, priorityOf } from './ticketLogic.mjs';

// Small pieces shared by the Tickets list, form and ticket page. They copy the look of the CRM page (pages/ClientsPage.jsx), whose own
// versions are private to that file, so Tickets reads as part of the same app.

export const FIELD_CLASS = 'text-sm px-3 py-2 rounded-lg border w-full outline-none';
export const FIELD_STYLE = { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
export const MUTED = { color: 'var(--color-muted)' };

export function Btn({ onClick, disabled, variant = 'primary', children, className = '', type = 'button', title }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} aria-label={title}
      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-40 ${className}`}
      style={{
        background: variant === 'primary' ? 'var(--color-primary)' : 'transparent',
        color: variant === 'primary' ? '#fff' : variant === 'danger' ? '#ef4444' : 'var(--color-text)',
        border: variant === 'secondary' ? '1px solid var(--color-border)' : variant === 'danger' ? '1px solid #fca5a5' : 'none',
      }}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={MUTED}>{label}</label>
      {children}
      {hint && <p className="text-xs" style={MUTED}>{hint}</p>}
    </div>
  );
}

export function Sel({ value, onChange, children, label, disabled }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} disabled={disabled} className="text-sm px-3 py-2 rounded-lg border w-full" style={FIELD_STYLE}>
      {children}
    </select>
  );
}

export function StatusBadge({ status }) {
  const s = statusOf(status);
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

export function TypeTag({ type }) {
  const t = typeOf(type);
  return (
    <Tooltip text={t.tip}>
      <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: 'var(--color-border)', color: 'var(--color-text)' }}>{t.label}</span>
    </Tooltip>
  );
}

export function PriorityDot({ priority }) {
  const p = priorityOf(priority);
  return (
    <Tooltip text={`${p.label} priority`}>
      <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} aria-label={`${p.label} priority`} />
    </Tooltip>
  );
}

/** A filter chip, as on the CRM page. */
export function Chip({ on, onClick, children, tip }) {
  const chip = (
    <button type="button" onClick={onClick} aria-pressed={on} className="px-3 py-1 text-xs rounded-full font-medium transition-colors"
      style={{ background: on ? 'var(--color-primary)' : 'var(--color-surface)', color: on ? '#fff' : 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
      {children}
    </button>
  );
  return tip ? <Tooltip text={tip}>{chip}</Tooltip> : chip;
}
