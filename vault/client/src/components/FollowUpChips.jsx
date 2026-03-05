import React from 'react';

function FollowUpChips({ suggestions, onSelect }) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-3 ml-10">
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onSelect(s)}
          className="px-3 py-1.5 rounded-xl border text-xs transition-all hover:opacity-80 text-left"
          style={{
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export default FollowUpChips;
