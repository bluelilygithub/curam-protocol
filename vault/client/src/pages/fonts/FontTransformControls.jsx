import React from 'react';
import Tooltip from '../../components/Tooltip';

const CONTROLS = [
  {
    key: 'stemThickness',
    label: 'Stem Thickness',
    tooltip: 'Stroke-contrast approximation — thickens strokes for preview via an extra outline stroke. Real emboldening happens at export via fontTools.',
    min: -50,
    max: 100,
    step: 1,
    default: 0,
  },
  {
    key: 'proportionalWidth',
    label: 'Proportional Width',
    tooltip: 'Horizontal scale of every glyph and its advance width — a wider or narrower cut of the same letterforms.',
    min: 60,
    max: 140,
    step: 1,
    default: 100,
  },
  {
    key: 'extendAscDesc',
    label: 'Extend Ascenders/Descenders',
    tooltip: 'Stretches only the parts of letters above cap-height and below the baseline (b/d/h ascenders, g/y/p descenders) — the x-height body stays put.',
    min: -50,
    max: 100,
    step: 1,
    default: 0,
  },
  {
    key: 'counterWidth',
    label: 'Counter Width',
    tooltip: 'Widens or narrows the bowl interiors (the "holes" in o, e, a, g) around their own centre, independent of the outer letterform width.',
    min: -50,
    max: 50,
    step: 1,
    default: 0,
  },
];

export default function FontTransformControls({ transforms, onChange }) {
  return (
    <div className="space-y-4" data-tour="fonts-transforms-panel">
      {CONTROLS.map((c) => (
        <div key={c.key}>
          <div className="flex items-center justify-between mb-1">
            <Tooltip text={c.tooltip}>
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{c.label}</span>
            </Tooltip>
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{transforms[c.key]}</span>
          </div>
          <input
            type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={transforms[c.key]}
            onChange={(e) => onChange({ ...transforms, [c.key]: Number(e.target.value) })}
            className="w-full"
          />
        </div>
      ))}
      <button
        onClick={() => onChange(Object.fromEntries(CONTROLS.map((c) => [c.key, c.default])))}
        className="text-xs hover:opacity-70 transition-all duration-200"
        style={{ color: 'var(--color-muted)' }}
      >
        Reset transforms
      </button>
    </div>
  );
}

export const DEFAULT_TRANSFORMS = Object.fromEntries(CONTROLS.map((c) => [c.key, c.default]));
