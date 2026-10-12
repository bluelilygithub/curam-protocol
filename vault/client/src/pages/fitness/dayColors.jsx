import React from 'react';
import { useIcon } from '../../providers/IconProvider';

/**
 * How a day looks once things are logged. These are the planner's status colours (outside the theme, like warning colours):
 * green = done, amber = some done, calm blue = rest, teal = something extra, neutral grey = planned / not logged / "didn't do it".
 * Colour never stands alone: every state also has an icon and a word.
 */
export const DAY_STATES = {
  done: { label: 'Done', icon: 'check', color: '#16a34a' },
  partial: { label: 'Some done', icon: 'circle-dot', color: '#d97706' },
  planned: { label: 'Planned', icon: 'clock', color: null },
  skipped: { label: "Didn't do it", icon: 'circle-dashed', color: null },
  rest: { label: 'Rest', icon: 'moon', color: '#3b82f6' },
  extra: { label: 'Something extra', icon: 'plus', color: '#0d9488' },
  none: { label: '', icon: null, color: null },
};

export const LEGEND = ['done', 'partial', 'rest', 'extra', 'planned', 'skipped'];

/** Background and border for a day card in a given state; a soft tint so text stays readable in every theme. */
export function dayStyle(state, base = 'var(--color-surface)') {
  const c = DAY_STATES[state]?.color;
  if (!c) return { background: base, borderColor: 'var(--color-border)' };
  return {
    background: `color-mix(in srgb, ${c} 14%, ${base})`,
    borderColor: `color-mix(in srgb, ${c} 55%, var(--color-border))`,
  };
}

/** The state as an icon and a word. */
export function DayBadge({ state, size = 13, showLabel = true }) {
  const getIcon = useIcon();
  const s = DAY_STATES[state];
  if (!s || !s.icon) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--color-text)' }} title={s.label}>
      <span style={{ color: s.color || 'var(--color-muted)' }}>{getIcon(s.icon, { size })}</span>
      {showLabel && s.label}
    </span>
  );
}
