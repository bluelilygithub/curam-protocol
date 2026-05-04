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
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <span className="truncate max-w-[200px]" style={{ color: 'var(--color-muted)' }}>{s}</span>
              <span style={{ color: 'var(--color-border)' }}>·</span>
              <button
                onClick={() => { setPendingIdx(null); onSelect(s); }}
                className="font-medium hover:opacity-70 transition-opacity flex-shrink-0"
                style={{ color: 'var(--color-primary)' }}
              >
                Ask here
              </button>
              {canBranch && (
                <>
                  <span style={{ color: 'var(--color-border)' }}>·</span>
                  <button
                    onClick={() => { setPendingIdx(null); onBranch(s); }}
                    disabled={isBranching}
                    className="font-medium hover:opacity-70 transition-opacity flex-shrink-0"
                    style={{ color: 'var(--color-text)', opacity: isBranching ? 0.5 : undefined }}
                  >
                    {isBranching ? 'Creating…' : 'New chat'}
                  </button>
                </>
              )}
              <button
                onClick={() => setPendingIdx(null)}
                className="hover:opacity-60 transition-opacity flex-shrink-0 ml-0.5"
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
