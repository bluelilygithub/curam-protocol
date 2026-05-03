import React, { useState } from 'react';
import { useIcon } from '../providers/IconProvider';

/**
 * Shared page-level toolbar. Four zones:
 *   [title] [view-controls] [children*] → [overflow-actions] [shortcuts?] [primary-CTA?]
 *
 * Props
 *   title            — page heading
 *   views            — [{ mode, icon, label, shortcut?, dataTour? }]
 *   viewsGroupTour   — data-tour on the views container div
 *   activeView       — active mode string
 *   onViewChange     — (mode) => void
 *   overflowActions  — [{ label, icon, shortcut?, active?, onClick, dataTour? }]
 *   primaryAction    — { label, icon?, onClick, dataTour? }
 *   onShortcuts      — () => void — omit to hide the ? button
 *   children         — contextual slot rendered after views (e.g. active timer)
 */
export default function PageToolbar({
  title,
  views,
  viewsGroupTour,
  activeView,
  onViewChange,
  overflowActions,
  primaryAction,
  onShortcuts,
  children,
}) {
  const getIcon = useIcon();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const hasOverflow = overflowActions && overflowActions.length > 0;

  return (
    <div
      className="flex-shrink-0 flex items-center gap-2 px-6 py-3 border-b"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      {/* Zone 1 — title */}
      <h1 className="text-xl font-semibold mr-1" style={{ color: 'var(--color-text)' }}>
        {title}
      </h1>

      {/* Zone 2 — view controls */}
      {views && views.length > 0 && (
        <div
          className="flex rounded-lg border overflow-hidden"
          style={{ borderColor: 'var(--color-border)' }}
          {...(viewsGroupTour ? { 'data-tour': viewsGroupTour } : {})}
        >
          {views.map((v) => {
            const isActive = activeView === v.mode;
            return (
              <button
                key={v.mode}
                onClick={() => onViewChange(v.mode)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-all border-l first:border-l-0"
                style={{
                  background: isActive ? 'var(--color-primary)' : 'transparent',
                  color: isActive ? '#fff' : 'var(--color-muted)',
                  borderColor: 'var(--color-border)',
                }}
                title={`${v.label}${v.shortcut ? ` (${v.shortcut})` : ''}`}
                {...(v.dataTour ? { 'data-tour': v.dataTour } : {})}
              >
                {getIcon(v.icon, { size: 13 })}
                <span className="hidden sm:inline">{v.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Zone 3 — contextual slot */}
      {children}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Zone 4a — overflow menu */}
      {hasOverflow && (
        <div className="relative">
          <button
            onClick={() => setOverflowOpen((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs hover:opacity-70 transition-opacity"
            style={{
              borderColor: overflowOpen ? 'var(--color-primary)' : 'var(--color-border)',
              color: overflowOpen ? 'var(--color-primary)' : 'var(--color-muted)',
            }}
            title="More actions"
          >
            {getIcon('more-horizontal', { size: 14 })}
          </button>

          {overflowOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setOverflowOpen(false)} />
              <div
                className="absolute right-0 top-full mt-1 z-30 rounded-xl border shadow-xl overflow-hidden"
                style={{
                  background: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                  minWidth: 200,
                }}
              >
                {overflowActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => { action.onClick(); setOverflowOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:opacity-70 transition-opacity"
                    style={{
                      color: action.active ? 'var(--color-primary)' : 'var(--color-text)',
                      background: action.active ? 'var(--color-primary)18' : 'transparent',
                    }}
                    {...(action.dataTour ? { 'data-tour': action.dataTour } : {})}
                  >
                    <span style={{ color: action.active ? 'var(--color-primary)' : 'var(--color-muted)', flexShrink: 0 }}>
                      {action.icon && getIcon(action.icon, { size: 15 })}
                    </span>
                    <span className="flex-1">{action.label}</span>
                    {action.shortcut && (
                      <kbd
                        className="text-xs px-1.5 py-0.5 rounded font-mono"
                        style={{
                          background: 'var(--color-bg)',
                          color: 'var(--color-muted)',
                          border: '1px solid var(--color-border)',
                        }}
                      >
                        {action.shortcut}
                      </kbd>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Zone 4b — keyboard shortcuts button */}
      {onShortcuts && (
        <button
          onClick={onShortcuts}
          className="w-8 h-8 flex items-center justify-center rounded-lg border text-xs font-bold hover:opacity-70 transition-opacity"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          title="Keyboard shortcuts (?)"
        >
          ?
        </button>
      )}

      {/* Zone 4c — primary CTA */}
      {primaryAction && (
        <button
          onClick={primaryAction.onClick}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
          {...(primaryAction.dataTour ? { 'data-tour': primaryAction.dataTour } : {})}
        >
          {primaryAction.icon && getIcon(primaryAction.icon, { size: 13, color: '#fff' })}
          {primaryAction.label}
        </button>
      )}
    </div>
  );
}
