import React, { useState } from 'react';
import Tooltip from '../../components/Tooltip';
import { KERNING_PAIR_GROUPS, SUGGESTED_ADVANCED_PAIRS } from './fontKerningClasses';

export default function FontKerningPanel({ kerning, onChange }) {
  const [newPairInput, setNewPairInput] = useState('');

  const toggleGroup = (id) => {
    const enabled = kerning.enabledGroupIds.includes(id);
    onChange({
      ...kerning,
      enabledGroupIds: enabled
        ? kerning.enabledGroupIds.filter((g) => g !== id)
        : [...kerning.enabledGroupIds, id],
    });
  };

  const setAdvancedPair = (pair, value) => {
    const next = { ...kerning.advancedPairs };
    if (value === '' || Number.isNaN(Number(value))) delete next[pair];
    else next[pair] = Number(value);
    onChange({ ...kerning, advancedPairs: next });
  };

  const addPairRow = () => {
    const pair = newPairInput.trim();
    if (pair.length !== 2) return;
    onChange({ ...kerning, advancedPairs: { ...kerning.advancedPairs, [pair]: 0 } });
    setNewPairInput('');
  };

  const activeAdvancedPairs = Object.keys(kerning.advancedPairs || {});

  return (
    <div className="space-y-5">
      <div>
        <Tooltip text="Class-based kerning: adjusts groups of classically-loose letter pairs together (e.g. A next to V/W/Y) rather than one pair at a time.">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Visual Balance &amp; Rhythm</span>
        </Tooltip>
        <div className="flex items-center gap-2 mt-1">
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={kerning.balance}
            onChange={(e) => onChange({ ...kerning, balance: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="text-xs w-10 text-right" style={{ color: 'var(--color-muted)' }}>{kerning.balance}</span>
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          Negative tightens, positive loosens — only pairs in the groups checked below are affected.
        </p>
      </div>

      <div className="space-y-2">
        {KERNING_PAIR_GROUPS.map((group) => (
          <label key={group.id} className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={kerning.enabledGroupIds.includes(group.id)}
              onChange={() => toggleGroup(group.id)}
              className="mt-0.5"
            />
            <span>
              <span style={{ color: 'var(--color-text)' }}>{group.label}</span>
              <br />
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {group.description} · pairs: {group.pairs.join(', ')}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div>
        <Tooltip text="Manual overrides for specific letter pairs, added on top of the font's own kerning and the class-based adjustment above. In px, at the current preview font size.">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Advanced Pairs</span>
        </Tooltip>
        <div className="mt-2 space-y-1.5">
          {activeAdvancedPairs.map((pair) => (
            <div key={pair} className="flex items-center gap-2">
              <span className="text-sm w-12" style={{ color: 'var(--color-text)' }}>{pair}</span>
              <input
                type="number"
                value={kerning.advancedPairs[pair]}
                onChange={(e) => setAdvancedPair(pair, e.target.value)}
                className="w-20 rounded px-2 py-1 text-sm"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              />
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>px</span>
              <button
                onClick={() => setAdvancedPair(pair, '')}
                className="text-xs hover:opacity-70 transition-all duration-200 ml-1"
                style={{ color: 'var(--color-muted)' }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <input
            value={newPairInput}
            onChange={(e) => setNewPairInput(e.target.value)}
            placeholder="e.g. AV"
            maxLength={2}
            className="w-20 rounded px-2 py-1 text-sm"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
          <button
            onClick={addPairRow}
            className="text-xs px-2 py-1 rounded hover:opacity-70 transition-all duration-200"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          >
            Add pair
          </button>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Try: {SUGGESTED_ADVANCED_PAIRS.filter((p) => !activeAdvancedPairs.includes(p)).slice(0, 4).join(', ')}
          </span>
        </div>
      </div>
    </div>
  );
}

export const DEFAULT_KERNING = { enabledGroupIds: [], balance: 0, advancedPairs: {} };
