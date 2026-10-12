import React from 'react';

export const PATTERN_LABELS = {
  squat: 'Squat', hinge: 'Hinge', lunge: 'Lunge', push: 'Push', pull: 'Pull', core: 'Core', carry: 'Carry',
  cardio: 'Cardio', balance: 'Balance', mobility: 'Mobility',
};
export const LEVEL_LABELS = ['', 'Gentle', 'Moderate', 'Challenging', 'Advanced'];
export const BLOCK_LABELS = { warmup: 'Warm-up', main: 'Main work', cooldown: 'Cool-down' };

/**
 * One exercise as a tile. The whole tile is the control: it opens the exercise's page (how to do it, common mistakes,
 * why form matters). Neutral colours only.
 */
export function ExerciseTile({ name, detail, meta, onOpen, dim = false, compact = false }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${name}. Open how to do it.`}
      className={`w-full rounded-xl border text-left hover:opacity-70 transition-all duration-200 ${compact ? 'p-2.5' : 'p-3.5'}`}
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', opacity: dim ? 0.55 : 1 }}
    >
      <span className="block text-sm font-medium leading-snug">{name}</span>
      {detail && <span className="block text-xs leading-snug mt-1" style={{ color: 'var(--color-text)' }}>{detail}</span>}
      {meta && <span className="block text-[11px] mt-1.5" style={{ color: 'var(--color-muted)' }}>{meta}</span>}
    </button>
  );
}

/** A titled group of tiles. */
export function TileGroup({ title, hint, children, columns = 'sm:grid-cols-2 lg:grid-cols-3' }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
        {hint && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{hint}</span>}
      </div>
      <div className={`grid gap-2.5 grid-cols-1 ${columns}`}>{children}</div>
    </section>
  );
}
