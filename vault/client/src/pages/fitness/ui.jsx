import React from 'react';
import { useIcon } from '../../providers/IconProvider';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import Tooltip from '../../components/Tooltip';

export const FIELD = {
  background: 'var(--color-bg)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};

/** Selected state for chips, rating buttons, tiles: neutral on purpose. The theme accent is only for primary action buttons. */
export function selectedStyle(active, idle = 'var(--color-bg)') {
  return active
    ? { borderColor: 'var(--color-text)', background: 'var(--color-text)', color: 'var(--color-bg)' }
    : { borderColor: 'var(--color-border)', background: idle, color: 'var(--color-text)' };
}

export const inputCls = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none transition-all duration-200 focus:border-[var(--color-text)]';

export function Card({ title, hint, children, className = '' }) {
  return (
    <section
      className={`rounded-2xl border p-6 space-y-4 ${className}`}
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      {(title || hint) && (
        <div>
          {title && <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>}
          {hint && <p className="text-sm leading-relaxed mt-1" style={{ color: 'var(--color-muted)' }}>{hint}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>{label}</span>
      {children}
      {hint && <span className="block text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{hint}</span>}
    </label>
  );
}

/**
 * Calm, non-alarming notice, theme colours only. Tone 'care' (health prompts) adds an icon and a thicker left bar
 * so it stands out without leaning on a status colour. Never red.
 */
export function Notice({ tone = 'info', children }) {
  const getIcon = useIcon();
  const care = tone === 'care';
  return (
    <div
      className="rounded-xl border p-4 text-sm leading-relaxed flex gap-3"
      role="note"
      style={{
        background: care ? 'var(--color-surface)' : 'var(--color-bg)',
        borderColor: 'var(--color-border)',
        borderLeft: care ? '4px solid var(--color-text)' : '1px solid var(--color-border)',
        color: 'var(--color-text)',
      }}
    >
      {care && <span className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text)' }}>{getIcon('info', { size: 16 })}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function PrimaryButton({ children, onClick, disabled, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-all duration-200 disabled:opacity-40"
      style={{ background: 'var(--color-primary)', color: '#fff' }}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="px-3.5 py-1.5 rounded-lg border text-sm hover:opacity-70 transition-all duration-200 disabled:opacity-40"
      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
    >
      {children}
    </button>
  );
}

/** Toggle chip (multi-select). */
export function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="px-3 py-1.5 rounded-lg border text-sm hover:opacity-70 transition-all duration-200"
      style={selectedStyle(active, 'transparent')}
    >
      {children}
    </button>
  );
}

/** Single-choice row of options. */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Chip key={o.id} active={value === o.id} onClick={() => onChange(o.id)}>{o.label}</Chip>
      ))}
    </div>
  );
}

/** 1-5 strip with the plain description of the chosen level underneath. `levels` = 5 descriptions. */
export function ScaleStrip({ value, onChange, levels, label }) {
  return (
    <div>
      <div role="radiogroup" aria-label={label} className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n;
          return (
            <Tooltip key={n} text={levels[n - 1]}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(n)}
                className="w-10 h-10 rounded-xl border text-sm font-medium hover:opacity-70 transition-all duration-200"
                style={selectedStyle(active)}
              >
                {n}
              </button>
            </Tooltip>
          );
        })}
      </div>
      <p className="text-xs leading-relaxed mt-1.5 min-h-[2.5em]" style={{ color: 'var(--color-muted)' }}>
        {value ? levels[value - 1] : 'Pick the level that fits best.'}
      </p>
    </div>
  );
}

/** Text or textarea with a microphone. Needs a VoiceInputProvider above (FitnessPage supplies one). */
export function Voice({ value, onChange, placeholder, rows = 3, label, onBlur }) {
  return (
    <VoiceInput
      type="textarea"
      rows={rows}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      label={label}
      append
      onBlur={onBlur}
    />
  );
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
