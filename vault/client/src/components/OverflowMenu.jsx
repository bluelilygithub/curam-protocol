import React, { useState } from 'react';
import { useIcon } from '../providers/IconProvider';

/**
 * Standalone overflow (⋯) dropdown.
 *
 * actions — array of:
 *   { label, icon?, shortcut?, active?, danger?, disabled?, onClick, dataTour? }
 *   | { divider: true, key: string }
 */
export default function OverflowMenu({ actions, title = 'More actions', variant = 'default', className = '' }) {
  const getIcon = useIcon();
  const [open, setOpen] = useState(false);

  if (!actions || actions.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={
          variant === 'icon'
            ? `w-6 h-6 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity flex-shrink-0 ${className}`
            : `flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs hover:opacity-70 transition-opacity ${className}`
        }
        style={
          variant === 'icon'
            ? { color: open ? 'var(--color-primary)' : 'var(--color-muted)' }
            : {
              borderColor: open ? 'var(--color-primary)' : 'var(--color-border)',
              color: open ? 'var(--color-primary)' : 'var(--color-muted)',
            }
        }
        title={title}
      >
        {getIcon('more-horizontal', { size: variant === 'icon' ? 13 : 14 })}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 z-30 rounded-xl border shadow-xl overflow-hidden"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minWidth: 200 }}
          >
            {actions.map((action) => {
              if (action.divider) {
                return <div key={action.key} className="border-t" style={{ borderColor: 'var(--color-border)' }} />;
              }
              return (
                <button
                  key={action.label}
                  onClick={() => { if (!action.disabled) { action.onClick(); setOpen(false); } }}
                  disabled={action.disabled}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:opacity-70 transition-opacity"
                  style={{
                    color: action.danger ? '#ef4444' : action.active ? 'var(--color-primary)' : 'var(--color-text)',
                    background: action.active ? 'var(--color-primary)18' : 'transparent',
                    opacity: action.disabled ? 0.4 : 1,
                    cursor: action.disabled ? 'not-allowed' : 'pointer',
                  }}
                  {...(action.dataTour ? { 'data-tour': action.dataTour } : {})}
                >
                  <span style={{ color: action.danger ? '#ef4444' : action.active ? 'var(--color-primary)' : 'var(--color-muted)', flexShrink: 0 }}>
                    {action.icon && getIcon(action.icon, { size: 15 })}
                  </span>
                  <span className="flex-1">{action.label}</span>
                  {action.shortcut && (
                    <kbd
                      className="text-xs px-1.5 py-0.5 rounded font-mono"
                      style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                    >
                      {action.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
