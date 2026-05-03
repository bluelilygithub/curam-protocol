import React from 'react';
import { useIcon } from '../providers/IconProvider';

function BranchSuggestions({ branches, onSelect }) {
  const getIcon = useIcon();
  if (!branches || branches.length === 0) return null;

  return (
    <div className="mt-4 ml-10 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-xs mb-0.5" style={{ color: 'var(--color-muted)' }}>
        {getIcon('git-branch', { size: 12 })}
        <span>Explore deeper</span>
      </div>
      {branches.map((b, i) => (
        <button
          key={i}
          onClick={() => onSelect(b)}
          className="px-3 py-1.5 rounded-xl border text-xs transition-all hover:opacity-70 text-left"
          style={{
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
          {b.title}
        </button>
      ))}
    </div>
  );
}

export default BranchSuggestions;
