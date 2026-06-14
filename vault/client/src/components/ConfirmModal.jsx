import React, { useState } from 'react';

function ConfirmModal({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, confirmText, onConfirm, onCancel }) {
  const [typed, setTyped] = useState('');
  const canConfirm = confirmText ? typed === confirmText : true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6 space-y-4"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</p>
        <div className="text-sm" style={{ color: 'var(--color-muted)' }}>{message}</div>
        {confirmText && (
          <div>
            <p className="text-xs mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Type <strong style={{ color: 'var(--color-text)' }}>{confirmText}</strong> to confirm
            </p>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
              placeholder={confirmText}
              autoFocus
            />
          </div>
        )}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={canConfirm ? onConfirm : undefined}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{
              background: canConfirm ? (danger ? '#ef4444' : 'var(--color-primary)') : 'var(--color-border)',
              color: canConfirm ? '#fff' : 'var(--color-muted)',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
