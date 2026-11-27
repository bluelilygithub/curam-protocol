import React from 'react';
import Tooltip from '../Tooltip';

// A row of mutually exclusive buttons. options: [{ value, label, tip }]. Active segment: primary fill, --color-on-primary text.
export default function SegmentedToggle({ options, value, onChange, disabled = false, label, size = 'sm' }) {
  const pad = size === 'xs' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs';
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1 p-1 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      {options.map((o) => {
        const active = o.value === value;
        const btn = (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`${pad} rounded-lg font-medium hover:opacity-70 transition-opacity duration-200 disabled:opacity-60`}
            style={{ background: active ? 'var(--color-primary)' : 'transparent', color: active ? 'var(--color-on-primary)' : 'var(--color-muted)' }}
          >
            {o.label}
          </button>
        );
        return o.tip ? <Tooltip key={o.value} text={o.tip}>{btn}</Tooltip> : btn;
      })}
    </div>
  );
}
