import React from 'react';
import { PROOFING_PRESETS } from './proofingPresets';

export default function FontProofingText({ activePresetId, customText, onSelectPreset, onCustomTextChange }) {
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {PROOFING_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onSelectPreset(preset.id)}
            className="px-3 py-1.5 rounded text-sm hover:opacity-70 transition-all duration-200"
            style={{
              background: activePresetId === preset.id ? 'var(--color-primary)' : 'var(--color-surface)',
              color: activePresetId === preset.id ? '#fff' : 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}
          >
            {preset.label}
          </button>
        ))}
        <button
          onClick={() => onSelectPreset('custom')}
          className="px-3 py-1.5 rounded text-sm hover:opacity-70 transition-all duration-200"
          style={{
            background: activePresetId === 'custom' ? 'var(--color-primary)' : 'var(--color-surface)',
            color: activePresetId === 'custom' ? '#fff' : 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        >
          Custom
        </button>
      </div>
      {activePresetId === 'custom' && (
        <textarea
          value={customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
          rows={2}
          placeholder="Type your own proofing text…"
          className="w-full rounded px-3 py-2 text-sm"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
        />
      )}
    </div>
  );
}
