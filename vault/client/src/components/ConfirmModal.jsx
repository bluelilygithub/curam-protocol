import React from 'react';

function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
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
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: danger ? '#ef4444' : 'var(--color-primary)' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
