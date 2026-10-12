import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

/**
 * Explanation popover. Opens on hover or keyboard focus, and pins open on click/tap, so it works with a mouse, a keyboard
 * and a phone. Closes on Escape or a click elsewhere. `trigger="text"` shows the question itself as the control.
 *   <InfoTip tip={TIPS.move} />   <InfoTip tip={TIPS.timeOfDay} trigger="text" />
 */
export function InfoTip({ tip, trigger = 'icon' }) {
  const getIcon = useIcon();
  const btn = useRef(null);
  const pop = useRef(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState(null);
  const open = hover || pinned;
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !btn.current) { setPos(null); return; }
    const r = btn.current.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, 8), window.innerWidth - width - 8);
    const below = r.bottom + 8;
    const h = pop.current ? pop.current.offsetHeight : 160;
    const top = below + h > window.innerHeight - 8 && r.top - h - 8 > 8 ? r.top - h - 8 : below;
    setPos({ left, top, width });
  }, [open]);

  useEffect(() => {
    if (!pinned) return undefined;
    const away = (e) => { if (!btn.current?.contains(e.target) && !pop.current?.contains(e.target)) setPinned(false); };
    const esc = (e) => { if (e.key === 'Escape') { setPinned(false); setHover(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [pinned]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={tip.title}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((v) => !v)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className={`inline-flex items-center gap-1 align-middle hover:opacity-60 transition-opacity duration-200 ${trigger === 'text' ? 'text-xs underline decoration-dotted underline-offset-2' : 'w-5 h-5 justify-center rounded-full'}`}
        style={{ color: 'var(--color-muted)' }}
      >
        {trigger === 'text' ? tip.title : null}
        {getIcon('info', { size: trigger === 'text' ? 12 : 14 })}
      </button>
      {open && createPortal(
        <div
          ref={pop}
          id={id}
          role="tooltip"
          className="fixed z-30 rounded-xl border p-3 shadow-lg text-sm leading-relaxed"
          style={{
            left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: pos?.width ?? 320,
            background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)',
          }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <p className="font-semibold mb-1">{tip.title}</p>
          <p style={{ color: 'var(--color-muted)' }}>{tip.body}</p>
        </div>,
        document.body,
      )}
    </>
  );
}
