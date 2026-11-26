import React from 'react';
import Tooltip from '../../components/Tooltip';

// Small pieces the HTML Content Check screens share. Colours come from the theme variables only.
export const CARD = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
export const FIELD_CLASS = 'w-full px-3 py-2.5 rounded-xl border text-sm focus:border-[var(--color-primary)]';
export const FIELD_INLINE = FIELD_CLASS.replace('w-full', 'w-auto'); // a select that sits in a row, sized to its words
export const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

/** Reads an apiClient response; throws the server's plain message when it failed. */
export async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

export function PrimaryButton({ tip, children, disabled, onClick, type = 'button' }) {
  return (
    <Tooltip text={tip}>
      <button type={type} onClick={onClick} disabled={disabled}
        className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
        style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
        {children}
      </button>
    </Tooltip>
  );
}

export function SecondaryButton({ tip, children, disabled, onClick, danger = false }) {
  return (
    <Tooltip text={tip}>
      <button type="button" onClick={onClick} disabled={disabled}
        className="px-3 py-1.5 rounded-lg border text-sm transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
        style={{ borderColor: danger ? '#fca5a5' : 'var(--color-border)', color: danger ? '#991b1b' : 'var(--color-text)', background: 'var(--color-bg)' }}>
        {children}
      </button>
    </Tooltip>
  );
}

/** A small square icon button with a tooltip and an aria-label. */
export function IconButton({ tip, label, icon, onClick, disabled }) {
  return (
    <Tooltip text={tip}>
      <button type="button" aria-label={label} onClick={onClick} disabled={disabled}
        className="p-1.5 rounded-lg border transition-opacity duration-200 hover:opacity-60 disabled:opacity-30"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>
        {icon}
      </button>
    </Tooltip>
  );
}

export function Label({ children, hint }) {
  return (
    <div className="mb-1">
      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{children}</span>
      {hint && <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>{hint}</span>}
    </div>
  );
}

export function Badge({ children }) {
  return <span className="text-[11px] px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>{children}</span>;
}

export const formatDate = (d) => (d ? new Date(d).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
