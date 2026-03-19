import React, { useState, useEffect } from 'react';

export default function ModelAdvisorModal({
  isOpen,
  currentModelName,
  reason,
  needsImage,
  suggestedModels,
  onSwitch,
  onConfirm,
  onDismiss,
}) {
  const [selected, setSelected] = useState(null);

  // Pre-select the first suggested model whenever the modal opens
  useEffect(() => {
    if (isOpen && suggestedModels?.length > 0) {
      setSelected(suggestedModels[0].id);
    } else if (isOpen) {
      setSelected(null);
    }
  }, [isOpen, suggestedModels]);

  // Escape key dismisses
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onDismiss]);

  if (!isOpen) return null;

  const canSwitch = !needsImage && selected !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 space-y-4"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg select-none">🤖</span>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
              Model Advisor
            </h2>
          </div>
          <button
            onClick={onDismiss}
            aria-label="Close"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sm opacity-50 hover:opacity-100 transition-opacity"
            style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* Reason */}
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          {reason}
        </p>

        {/* Current model chip */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
          style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
        >
          <span>Current model:</span>
          <span className="font-medium" style={{ color: 'var(--color-text)' }}>{currentModelName}</span>
        </div>

        {/* Image generation notice */}
        {needsImage && (
          <div
            className="flex items-start gap-2 px-3 py-2.5 rounded-xl border text-sm"
            style={{ background: '#f59e0b11', borderColor: '#f59e0b44', color: '#f59e0b' }}
          >
            <span className="flex-shrink-0 mt-0.5">⚠️</span>
            <span>
              Image generation requires AI Studio — open it externally at{' '}
              <a
                href="https://aistudio.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline opacity-90 hover:opacity-100"
              >
                aistudio.google.com
              </a>
            </span>
          </div>
        )}

        {/* Suggested model cards */}
        {!needsImage && suggestedModels.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
              Suggested
            </p>
            {suggestedModels.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelected(m.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left"
                style={{
                  background: selected === m.id ? 'var(--color-primary)18' : 'var(--color-bg)',
                  borderColor: selected === m.id ? 'var(--color-primary)' : 'var(--color-border)',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                <span className="text-lg flex-shrink-0 select-none">{m.emoji}</span>
                <span className="text-sm font-medium flex-1">{m.name}</span>
                {selected === m.id && (
                  <span className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>✓</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 pt-1">
          {canSwitch && (
            <button
              onClick={() => onSwitch(selected)}
              className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: 'var(--color-primary)', border: 'none', cursor: 'pointer' }}
            >
              Switch &amp; Send
            </button>
          )}
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-medium border transition-all hover:opacity-80"
            style={{
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            Keep &amp; Send
          </button>
        </div>
      </div>
    </div>
  );
}
