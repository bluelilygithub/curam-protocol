import React, { useMemo, useState } from 'react';
import { extractVariables, fillVariables, labelFor } from '../utils/promptVariables';
import { useIcon } from '../providers/IconProvider';

/**
 * Modal for filling in {{variable}} placeholders before inserting a prompt.
 *
 * Props:
 *   content  — the raw prompt template string
 *   onInsert — called with the fully resolved string when the user clicks Insert
 *   onClose  — called when the modal should be dismissed without inserting
 */
export default function PromptVariableModal({ content, onInsert, onClose }) {
  const getIcon = useIcon();
  const variables = useMemo(() => extractVariables(content), [content]);
  const [values, setValues] = useState(() =>
    Object.fromEntries(variables.map(v => [v, '']))
  );

  const preview = fillVariables(content, values);
  const allFilled = variables.every(v => values[v].trim() !== '');

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && allFilled) { e.preventDefault(); onInsert(preview); }
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Fill in variables</span>
          <button onClick={onClose} className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>
            {getIcon('x', { size: 15 })}
          </button>
        </div>

        {/* Variable inputs */}
        <div className="px-5 py-4 space-y-3">
          {variables.map((v, i) => (
            <div key={v}>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
                {labelFor(v)}
              </label>
              <input
                autoFocus={i === 0}
                value={values[v]}
                onChange={e => setValues(prev => ({ ...prev, [v]: e.target.value }))}
                onKeyDown={handleKeyDown}
                placeholder={labelFor(v)}
                className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
          ))}

          {/* Live preview */}
          <div>
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Preview</p>
            <div
              className="px-3 py-2 rounded-xl border text-xs leading-relaxed overflow-y-auto"
              style={{
                background: 'var(--color-bg)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)',
                whiteSpace: 'pre-wrap',
                maxHeight: '120px',
              }}
            >
              {preview}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 pb-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => onInsert(preview)}
            disabled={!allFilled}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-40"
            style={{ background: 'var(--color-primary)' }}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
