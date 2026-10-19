import React from 'react';
import { useIcon } from '../../providers/IconProvider';
import { TOOL_HELP } from './musicTools.mjs';

// Tool title with a (?) that opens that tool's help, same pattern as Video Tools.
export function ToolHeader({ id, label, onHelp }) {
  const getIcon = useIcon();
  return (
    <div className="flex items-center gap-1.5">
      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{label}</h2>
      <button
        type="button"
        aria-label={`Help: ${label}`}
        onClick={() => onHelp(id)}
        className="hover:opacity-60 transition-opacity duration-200 flex-shrink-0"
        style={{ color: 'var(--color-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        {getIcon('help-circle', { size: 13 })}
      </button>
    </div>
  );
}

export function ToolHelpModal({ toolId, onClose }) {
  const getIcon = useIcon();
  const help = TOOL_HELP[toolId];
  if (!help) return null;
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl p-6 max-w-md w-full shadow-xl"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', border: '1px solid' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{help.title}</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="hover:opacity-60 transition-opacity duration-200"
            style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {getIcon('x', { size: 18 })}
          </button>
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>{help.what}</p>
        <ul className="space-y-2">
          {help.features.map((feat) => (
            <li key={feat} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
              <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary)' }}>{getIcon('check', { size: 14 })}</span>
              {feat}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
