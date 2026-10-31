import React from 'react';

// Grey placeholder shapes shown while something loads, so a page keeps its shape instead of popping in piece by piece.
//   <Skeleton lines={3} />            three text-height bars (the last one shorter)
//   <Skeleton className="h-24" />     one block of any size
// Marked busy for screen readers; `label` is what they hear. Respects reduced-motion (index.css stops the pulse).
export default function Skeleton({ lines = 0, className = 'h-4', label = 'Loading' }) {
  const bar = (key, extra = '') => (
    <div key={key} className={`rounded animate-pulse ${className} ${extra}`} style={{ background: 'var(--color-border)' }} />
  );
  return (
    <div role="status" aria-busy="true" aria-label={label} className={lines > 0 ? 'space-y-2' : ''}>
      {lines > 0 ? Array.from({ length: lines }, (_, i) => bar(i, i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')) : bar('one', 'w-full')}
    </div>
  );
}
