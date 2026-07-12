import React from 'react';

export default function ProductScoutModeToggle({ mode, onChange }) {
  const tabs = [
    { id: 'scout', label: 'Quick scout' },
    { id: 'guide', label: 'Buy guide' },
  ];

  return (
    <div
      className="inline-flex rounded-xl border p-1 gap-1"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      {tabs.map((tab) => {
        const active = mode === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-70"
            style={{
              background: active ? 'var(--color-primary)' : 'transparent',
              color: active ? '#fff' : 'var(--color-muted)',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
