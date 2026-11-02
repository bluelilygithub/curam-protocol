import React from 'react';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';
import { NAMES, keyLabel } from './theory.mjs';

export const KIND_STYLE = {
  diatonic:  { color: 'var(--color-muted)', label: 'In the key' },
  borrowed:  { color: '#b45309', label: 'Borrowed' },
  secondary: { color: '#2563eb', label: 'Secondary dominant' },
  chromatic: { color: '#dc2626', label: 'Outside the key' },
};

/**
 * Key, Roman numerals and the capo suggestion for the open song.
 * theory comes from analyseSong(); keyChoice is 'auto' or 'Root|mode'.
 */
export default function TheoryPanel({
  theory, keyChoice, onKeyChoice, showNumerals, onShowNumerals, showShapes, onShowShapes, capoFret, onUseCapo,
}) {
  const select = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' };
  const btn = 'text-xs px-2 py-1 rounded border hover:opacity-70 transition-opacity duration-200';
  const bs = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };

  if (!theory) {
    return (
      <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Theory and capo</p>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Add some chords and this shows the key, Roman numerals and the easiest capo.</p>
      </div>
    );
  }

  const { key, keySource, advice, capo, flagged } = theory;
  const sourceText = { detected: 'detected from the audio', estimated: 'worked out from the chords', chosen: 'chosen by you' }[keySource];
  const best = capo?.best;
  const saved = capo && capo.baseline.barres - best.barres;

  return (
    <div className="rounded-xl border p-3 flex flex-col gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Theory and capo</p>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs" style={{ color: 'var(--color-text)' }}>Key: <strong>{keyLabel(key)}</strong></span>
          <Tooltip text={GT.keyChoice}>
            <select aria-label="Key for the numerals" value={keyChoice} onChange={e => onKeyChoice(e.target.value)}
              className="text-xs px-1 py-0.5 rounded border" style={select}>
              <option value="auto">Automatic</option>
              {NAMES.flatMap(n => ['major', 'minor'].map(m => (
                <option key={`${n}|${m}`} value={`${n}|${m}`}>{n} {m}</option>
              )))}
            </select>
          </Tooltip>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Key {sourceText}. Detection is a guess, so change it here if the numerals look wrong.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <Tooltip text={GT.showNumerals}>
            <input type="checkbox" checked={showNumerals} onChange={e => onShowNumerals(e.target.checked)} />
          </Tooltip>
          Roman numerals
        </label>
        <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <Tooltip text={GT.showShapes}>
            <input type="checkbox" checked={showShapes} onChange={e => onShowShapes(e.target.checked)} />
          </Tooltip>
          Capo shapes
        </label>
      </div>

      {flagged.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Chords outside the key</p>
          {flagged.map(f => (
            <p key={f.label} className="text-xs" style={{ color: 'var(--color-text)' }}>
              <span className="font-mono font-bold" style={{ color: KIND_STYLE[f.kind].color }}>{f.label}</span>
              {' '}<span className="font-mono">{f.numeral}</span>
              <span style={{ color: 'var(--color-muted)' }}> · {f.note}{f.count > 1 ? ` · ${f.count} times` : ''}</span>
            </p>
          ))}
        </div>
      )}

      {best && (
        <div className="flex flex-col gap-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Easiest capo</p>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{advice}</p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {best.barres === 0 ? 'No barre chords.' : `${best.barres} barre ${best.barres === 1 ? 'chord' : 'chords'}.`}
            {best.capo > 0 && saved > 0 ? ` Saves ${saved} compared with no capo.` : ''}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {best.shapes.map(s => (
              <Tooltip text={s.barre ? GT.shapeBarre : GT.shapeOpen} key={s.concert}>
                <span className="text-xs font-mono" style={{ color: s.barre ? '#b45309' : 'var(--color-text)' }}>
                  {s.concert}{best.capo > 0 ? ` → ${s.shape}` : ''}
                </span>
              </Tooltip>
            ))}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {best.capo !== capoFret && (
              <Tooltip text={GT.useCapo}>
                <button className={btn} style={bs} onClick={() => onUseCapo(best.capo)}>
                  {best.capo === 0 ? 'Remove capo' : `Use capo ${best.capo}`}
                </button>
              </Tooltip>
            )}
            {capo.options.filter(o => o.capo !== best.capo).slice(0, 2).map(o => (
              <Tooltip text={`Capo ${o.capo}: ${o.barres} barre ${o.barres === 1 ? 'chord' : 'chords'}.`} key={o.capo}>
                <button className={btn} style={bs} onClick={() => onUseCapo(o.capo)}>
                  Capo {o.capo} ({o.barres} barre)
                </button>
              </Tooltip>
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Chords stay in the sounding key on the chart. The shape is what you finger with the capo on.
          </p>
        </div>
      )}
    </div>
  );
}
