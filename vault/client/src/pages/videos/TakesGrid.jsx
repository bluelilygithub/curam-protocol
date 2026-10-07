import React from 'react';
import Tooltip from '../../components/Tooltip';

// Several takes of the same clip, side by side. Pick one and it becomes the Result below (download, save,
// take a frame from it, use it in other tools). Takes that failed or did not finish say so instead of
// disappearing.

export default function TakesGrid({ takes, chosen, onChoose }) {
  if (!takes || takes.length < 2) return null;
  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div>
        <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Pick the best take</p>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Same brief, rendered separately each time, so they differ. Watch them all, then choose one to keep working with.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {takes.map((take, i) => {
          const picked = chosen === i;
          return (
            <div
              key={take.requestId || i}
              className="rounded-xl border p-2 space-y-2"
              style={{ borderColor: picked ? 'var(--color-primary)' : 'var(--color-border)', borderWidth: picked ? 2 : 1 }}
            >
              {take.url ? (
                <video src={take.url} controls playsInline preload="metadata" className="w-full max-h-48 rounded-lg bg-black" />
              ) : (
                <div className="w-full aspect-video rounded-lg flex items-center justify-center text-center px-3" style={{ background: 'var(--color-surface)' }}>
                  <p className="text-xs" style={{ color: '#ef4444' }}>{take.error || 'This take did not finish.'}</p>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{take.label}</p>
                {take.url && (
                  <Tooltip text={picked ? 'This take is the Result below.' : 'Make this take the Result below.'}>
                    <button
                      type="button"
                      onClick={() => onChoose(i)}
                      disabled={picked}
                      className="px-3 py-1 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70 disabled:opacity-100"
                      style={picked
                        ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' }
                        : { borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      {picked ? 'Chosen' : 'Use this take'}
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
