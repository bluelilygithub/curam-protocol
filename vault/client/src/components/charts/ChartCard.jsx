import React from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../Tooltip';

// The card every chart sits in (replaces Shares' ChartSection). Generic: nothing tool-specific.
//   title, subtitle (one line), info (long explanation behind an (i)), badge (only for cards the page's range does not drive),
//   actions (toggles, right of the title), span (full width from xl in a two-column grid).
export default function ChartCard({ title, subtitle, info, badge, actions, span = false, children, className = '', ...rest }) {
  const getIcon = useIcon();
  return (
    <section
      className={`rounded-2xl border p-6 space-y-4 min-w-0 ${span ? 'xl:col-span-2' : ''} ${className}`}
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      {...rest}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
            {info && (
              <Tooltip text={info}>
                <button type="button" aria-label={`About ${title}`} className="hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
                  {getIcon('info', { size: 15 })}
                </button>
              </Tooltip>
            )}
            {badge && (
              <span className="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>{badge}</span>
            )}
          </div>
          {subtitle && <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
