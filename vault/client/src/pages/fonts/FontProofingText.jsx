import React from 'react';
import { PROOFING_PRESETS } from './proofingPresets';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';

const PRESET_TOOLTIPS = {
  'kerning-spacing': 'Exposes uneven letter spacing — watch the gaps between letter pairs as you adjust Kerning.',
  'ascenders-descenders': 'Shows how far letterforms extend above cap-height and below baseline — pairs with the Extend Ascenders/Descenders slider.',
  'counters-stems': 'Isolates round bowls (counters) and vertical strokes (stems) — pairs with Stem Thickness and Counter Width.',
};

export default function FontProofingText({ activePresetId, customText, onSelectPreset, onCustomTextChange }) {
  return (
    <div data-tour="fonts-proofing">
      <div className="flex flex-wrap gap-2 mb-2">
        {PROOFING_PRESETS.map((preset) => (
          <Tooltip key={preset.id} text={PRESET_TOOLTIPS[preset.id] || preset.label}>
            <button
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
          </Tooltip>
        ))}
        <Tooltip text="Type your own preview text instead of a proofing preset.">
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
        </Tooltip>
      </div>
      {activePresetId === 'custom' && (
        <VoiceInput
          type="textarea"
          append
          value={customText}
          onChange={onCustomTextChange}
          rows={2}
          placeholder="Type or say your own proofing text…"
          label="Your own proofing text"
        />
      )}
    </div>
  );
}
