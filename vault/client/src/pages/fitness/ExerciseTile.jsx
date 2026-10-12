import React from 'react';
import { useIcon } from '../../providers/IconProvider';

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
export function ExerciseTile({ name, detail, meta, onOpen, dim = false, compact = false, icon }) {
  const getIcon = useIcon();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${name}. Open how to do it.`}
      className={`w-full flex items-start gap-3 rounded-xl border text-left hover:opacity-70 transition-all duration-200 ${compact ? 'p-2.5' : 'p-3.5'}`}
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', opacity: dim ? 0.55 : 1 }}
    >
      {icon && (
        <span
          className={`flex-shrink-0 flex items-center justify-center rounded-lg ${compact ? 'w-7 h-7' : 'w-9 h-9'}`}
          style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
          aria-hidden="true"
        >
          {getIcon(icon, { size: compact ? 14 : 18 })}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug">{name}</span>
        {detail && <span className="block text-xs leading-snug mt-1" style={{ color: 'var(--color-text)' }}>{detail}</span>}
        {meta && <span className="block text-[11px] mt-1.5" style={{ color: 'var(--color-muted)' }}>{meta}</span>}
      </span>
    </button>
  );
}

/** A titled group of tiles, with an optional icon beside the title. */
export function TileGroup({ title, hint, children, icon, columns = 'sm:grid-cols-2 lg:grid-cols-3' }) {
  const getIcon = useIcon();
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        {icon && <span style={{ color: 'var(--color-muted)' }} aria-hidden="true">{getIcon(icon, { size: 15 })}</span>}
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
        {hint && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{hint}</span>}
      </div>
      <div className={`grid gap-2.5 grid-cols-1 ${columns}`}>{children}</div>
    </section>
  );
}
