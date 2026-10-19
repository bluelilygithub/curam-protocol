import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';

export default function FontPresetsPanel({ presets, onSave, onApply, onDelete }) {
  const getIcon = useIcon();
  const [name, setName] = useState('');

  const save = () => {
    if (!name.trim()) return;
    onSave(name.trim());
    setName('');
  };

  return (
    <div className="space-y-3" data-tour="fonts-presets-panel">
      <div className="flex items-center gap-2">
        <Tooltip text="Name this combination of Transforms + Kerning settings so you can reapply it later, to this or any other font. You can say the name with the microphone.">
          <div className="flex-1 min-w-0">
            <VoiceInput value={name} onChange={setName} placeholder="e.g. Display Heavy" label="Name for these settings" onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
          </div>
        </Tooltip>
        <button
          onClick={save}
          className="text-sm px-3 py-1.5 rounded hover:opacity-70 transition-all duration-200"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          Save preset
        </button>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        Saves the current transform + kerning recipe, not a rendered result — reapply it to any loaded font.
      </p>

      {presets.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No saved presets yet.</p>
      ) : (
        <div className="space-y-1.5">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="flex items-center justify-between rounded px-3 py-2"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            >
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{preset.name}</span>
              <div className="flex items-center gap-3">
                <Tooltip text="Load this preset's Transforms + Kerning values into the sliders, replacing your current settings.">
                  <button onClick={() => onApply(preset)} className="text-xs hover:opacity-70 transition-all duration-200" style={{ color: 'var(--color-primary)' }}>
                    Apply
                  </button>
                </Tooltip>
                <Tooltip text="Delete this saved preset — cannot be undone.">
                  <button onClick={() => onDelete(preset.id)} className="hover:opacity-70 transition-all duration-200" style={{ color: 'var(--color-muted)' }}>
                    {getIcon('trash', { size: 14 })}
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
