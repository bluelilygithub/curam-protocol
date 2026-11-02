import React from 'react';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';
import { summarise } from './simplify.mjs';
import { GlossText } from './GlossaryTerm';

const MODES = [
  ['off', 'As written', 'simplifyOff'],
  ['exact', 'Same sound', 'simplifyExact'],
  ['easier', 'Easier chords', 'simplifyEasier'],
];

/**
 * "Make it easier": shows the chart with the chords to finger instead of the written ones.
 * Same sound moves only the capo; Easier chords also swaps hard chords for easy ones and says what changes in the sound.
 * plans: { exact, easier } from simplifySong(); mode: 'off' | 'exact' | 'easier'.
 */
export default function SimplifyPanel({ mode, onMode, plans, canThin, fewer, onFewer, skipped }) {
  const plan = mode === 'off' ? null : plans[mode];
  const swapped = plan ? plan.chords.filter(c => c.play !== c.shape) : [];
  const barres = plan ? plan.chords.filter(c => c.kind === 'barre') : [];

  return (
    <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-tour="guitar-simplify">
      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Make it easier</p>
      <div className="flex gap-1 flex-wrap" role="radiogroup" aria-label="How to show the chords">
        {MODES.map(([id, label, tip]) => (
          <Tooltip text={GT[tip]} key={id}>
            <button type="button" role="radio" aria-checked={mode === id} onClick={() => onMode(id)}
              className="text-xs px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity duration-200"
              style={mode === id
                ? { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderColor: 'var(--color-primary)' }
                : { borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>{label}</button>
          </Tooltip>
        ))}
      </div>

      {!plan && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          <GlossText text="Show the chart with the shapes to play instead of the written chords. Same sound only moves the capo; Easier chords swaps hard chords for easy ones." />
        </p>
      )}

      {plan && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{summarise(plan)}</p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            <GlossText text="The capo is set for you. The chart now shows what to finger; the chord it sounds as is underneath." />
          </p>
          {swapped.length > 0 && (
            <ul className="flex flex-col gap-1">
              {swapped.map(c => (
                <li key={c.concert} className="text-xs" style={{ color: 'var(--color-text)' }}>
                  <span className="font-mono font-bold">{c.concert}</span> → <span className="font-mono font-bold">{c.play}</span>
                  {c.note && <span style={{ color: 'var(--color-muted)' }}> · <GlossText text={c.note} /></span>}
                </li>
              ))}
            </ul>
          )}
          {barres.length > 0 && (
            <p className="text-xs" style={{ color: '#b45309' }}>
              <GlossText text={`Still needs a barre: ${barres.map(c => c.play).join(', ')}.`} />
            </p>
          )}
          {mode === 'easier' && swapped.length === 0 && barres.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}><GlossText text="No chord needed swapping: the capo alone makes this easy." /></p>
          )}
        </div>
      )}

      {canThin && (
        <Tooltip text={GT.simplifyFewer}>
          <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
            <input type="checkbox" checked={fewer} onChange={e => onFewer(e.target.checked)} />
            Skip chords that change too fast{fewer && skipped > 0 ? ` (${skipped} dimmed)` : ''}
          </label>
        </Tooltip>
      )}
    </div>
  );
}
