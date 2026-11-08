import React from 'react';
import Tooltip from '../../components/Tooltip';

const CHIP = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';

/** Pencil / Pen / Coloured in, with the pen colours when Pen is chosen. Used when describing a new picture and when changing a look. */
export default function LookPicker({ options, style, penColor, onStyle, onPenColor, disabled = false, active = null }) {
  if (!options) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Drawing style">
        {options.styles.map((s) => {
          const on = style === s.id;
          return (
            <Tooltip key={s.id} text={s.tip}>
              <button
                type="button" disabled={disabled} aria-pressed={on} onClick={() => onStyle(s.id)} className={CHIP}
                style={on
                  ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }
                  : { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {s.label}{active === s.id ? ' (now)' : ''}
              </button>
            </Tooltip>
          );
        })}
      </div>
      {style === 'pen' && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Pen colour">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Pen colour</span>
          {options.penColors.map((c) => {
            const on = penColor === c.id;
            return (
              <Tooltip key={c.id} text={`${c.label} ink.`}>
                <button
                  type="button" disabled={disabled} aria-pressed={on} aria-label={`${c.label} pen`} onClick={() => onPenColor(c.id)}
                  className="w-6 h-6 rounded-full border-2 transition-opacity duration-200 hover:opacity-60 disabled:opacity-40"
                  style={{ background: c.hex, borderColor: on ? 'var(--color-primary)' : 'var(--color-border)', boxShadow: on ? '0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-primary)' : 'none' }}
                />
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}
