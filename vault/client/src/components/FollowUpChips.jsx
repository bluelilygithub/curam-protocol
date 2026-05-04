import React, { useState } from 'react';

function FollowUpChips({ suggestions, onSelect, onBranch, canBranch, isBranching }) {
  const [pendingIdx, setPendingIdx] = useState(null);

  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-3 ml-10">
      {suggestions.map((s, i) => (
        <div key={i}>
          {pendingIdx === i ? (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-primary)' }}
            >
              <span className="truncate max-w-[180px]" style={{ color: 'var(--color-muted)' }}>{s}</span>
              <button
                onClick={() => { setPendingIdx(null); onSelect(s); }}
                className="flex-shrink-0 px-2 py-0.5 rounded-lg font-medium transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-primary)', color: '#fff' }}
              >
                Ask here
              </button>
              {canBranch && (
                <button
                  onClick={() => { setPendingIdx(null); onBranch(s); }}
                  disabled={isBranching}
                  className="flex-shrink-0 px-2 py-0.5 rounded-lg font-medium border transition-opacity hover:opacity-80"
                  style={{
                    borderColor: 'var(--color-primary)',
                    color: 'var(--color-primary)',
                    background: 'transparent',
                    opacity: isBranching ? 0.5 : undefined,
                  }}
                >
                  New chat
                </button>
              )}
              <button
                onClick={() => setPendingIdx(null)}
                className="flex-shrink-0 hover:opacity-60 transition-opacity"
                style={{ color: 'var(--color-muted)' }}
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setPendingIdx(i)}
              className="px-3 py-1.5 rounded-xl border text-xs transition-all hover:opacity-80 text-left"
              style={{
                background: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              {s}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default FollowUpChips;
