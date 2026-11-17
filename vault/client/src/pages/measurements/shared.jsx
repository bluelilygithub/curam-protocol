import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';

export const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-primary)]';

export function Card({ children, className = '', style, ...rest }) {
  return (
    <section className={`rounded-2xl border p-4 sm:p-6 space-y-4 ${className}`} style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', ...style }} {...rest}>
      {children}
    </section>
  );
}

export function Label({ children, hint }) {
  return (
    <div className="mb-1">
      <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{children}</span>
      {hint && <span className="text-[11px] ml-2" style={{ color: 'var(--color-muted)' }}>{hint}</span>}
    </div>
  );
}

export function PrimaryButton({ children, className = '', style, ...props }) {
  return (
    <button type="button" {...props} className={`rounded-xl font-medium text-white hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity duration-200 px-3.5 py-1.5 text-sm ${FOCUS_RING} ${className}`} style={{ background: 'var(--color-primary)', ...style }}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, className = '', style, ...props }) {
  return (
    <button type="button" {...props} className={`rounded-lg border font-medium hover:opacity-70 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity duration-200 px-3 py-1.5 text-xs inline-flex items-center ${FOCUS_RING} ${className}`} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent', ...style }}>
      {children}
    </button>
  );
}

/** Segmented control. options: [{ id, label, tip }] */
export function Segmented({ value, onChange, options, label, size = 'sm' }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
      {options.map((o) => {
        const active = o.id === value;
        const btn = (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={`${size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'} font-medium transition-all duration-200 hover:opacity-70 ${FOCUS_RING}`}
            style={{ background: active ? 'var(--color-primary)' : 'transparent', color: active ? '#fff' : 'var(--color-text)' }}
          >
            {o.label}
          </button>
        );
        return o.tip ? <Tooltip key={o.id} text={o.tip}>{btn}</Tooltip> : btn;
      })}
    </div>
  );
}

export const CONF_STYLE = {
  high: { bg: '#dcfce7', fg: '#166534', label: 'High' },
  medium: { bg: '#fef3c7', fg: '#b45309', label: 'Medium' },
  low: { bg: '#fff1f2', fg: '#991b1b', label: 'Low' },
};

export function Badge({ children, bg = 'var(--color-bg)', fg = 'var(--color-muted)', title }) {
  return (
    <span title={title} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap" style={{ background: bg, color: fg, border: '1px solid var(--color-border)' }}>
      {children}
    </span>
  );
}

/**
 * Searchable picker with a mic in its search box.
 * items: [{ id, label, hint?, section?, keywords? }]. speak(text) → id | null resolves a spoken name.
 * Typing a letter on the closed picker opens it with that letter already in the search box (typeahead). With `prefixFirst`, items
 * whose label (or a keyword) starts with what is typed come before ones that only contain it (used by Live TV's country picker).
 * `searchHint={false}` leaves the grey hint (e.g. "24 channels") out of the search.
 */
export function Combobox({ items, value, onChange, speak, placeholder = 'Search…', label, selectedLabel, className = '', tip, dataTour, prefixFirst = false, searchHint = true }) {
  const getIcon = useIcon();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const filtered = useMemo(() => {
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return items;
    const hits = items.filter((it) => {
      const hay = `${it.label} ${searchHint ? it.hint || '' : ''} ${it.keywords || ''}`.toLowerCase();
      return toks.every((t) => hay.includes(t));
    });
    if (!prefixFirst) return hits;
    const typed = q.trim().toLowerCase();
    const words = (it) => [it.label, ...String(it.keywords || '').split(/\s+/)].map((w) => String(w).toLowerCase());
    // an exact keyword (a country code such as "ca") first, then names or keywords that start with it, then the rest
    const rank = (it) => (words(it).slice(1).includes(typed) ? 0 : words(it).some((w) => w.startsWith(typed)) ? 1 : 2);
    return hits.map((it, i) => [rank(it), i, it]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
  }, [items, q, prefixFirst, searchHint]);

  useEffect(() => { setActive(0); }, [q, open]);
  useEffect(() => { if (!open) setQ(''); }, [open]);

  const choose = (id) => { onChange(id); setOpen(false); setQ(''); btnRef.current?.focus(); };
  const current = items.find((i) => i.id === value);

  let lastSection = null;
  return (
    <div ref={wrapRef} className={`relative ${className}`} data-tour={dataTour}>
      <Tooltip text={tip || label}>
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            // typeahead: a letter or number opens the picker with it already typed
            // (and keys that land here before the search box has focus are added to it, so fast typing loses nothing)
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (open || /\S/.test(e.key))) {
              e.preventDefault();
              if (open) setQ((cur) => cur + e.key); else { setQ(e.key); setOpen(true); }
            }
            else if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); }
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={label}
          className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-sm text-left transition-all duration-200 hover:opacity-80 ${FOCUS_RING}`}
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <span className="truncate">{selectedLabel || current?.label || 'Choose…'}</span>
          <span style={{ color: 'var(--color-muted)' }} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">{getIcon('chevron-down', { size: 14 })}</span>
        </button>
      </Tooltip>
      {open && (
        <div className="absolute z-20 mt-1 left-0 w-full min-w-[17rem] rounded-xl border shadow-lg p-2" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <VoiceInput
            value={q}
            onChange={setQ}
            placeholder={placeholder}
            label={`Search ${label || 'list'}`}
            autoFocus
            mic={false}
            onFocus={(e) => { const n = e.target.value.length; try { e.target.setSelectionRange(n, n); } catch { /* not a text box */ } }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) choose(filtered[active].id); }
            }}
          />
          <ul role="listbox" aria-label={label} className="mt-2 max-h-64 overflow-y-auto">
            {filtered.length === 0 && <li className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>Nothing matches “{q}”.</li>}
            {filtered.map((it, idx) => {
              const header = it.section && it.section !== lastSection ? it.section : null;
              lastSection = it.section || lastSection;
              return (
                <React.Fragment key={it.id}>
                  {header && <li className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{header}</li>}
                  <li
                    role="option"
                    aria-selected={it.id === value}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => choose(it.id)}
                    className="px-3 py-2 rounded-lg text-sm cursor-pointer flex items-center justify-between gap-2"
                    style={{ background: idx === active ? 'var(--color-bg)' : 'transparent', color: 'var(--color-text)', fontWeight: it.id === value ? 600 : 400 }}
                  >
                    <span className="truncate">{it.label}</span>
                    {it.hint && <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{it.hint}</span>}
                  </li>
                </React.Fragment>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
