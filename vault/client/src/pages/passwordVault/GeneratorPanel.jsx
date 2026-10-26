import React, { useEffect, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { MAX_EXCLUDE, MAX_LENGTH, MIN_LENGTH, generatePassword, generatedBits, normaliseOptions } from '../../utils/passwordGen.mjs';
import { FIELD, FIELD_STYLE, StrengthMeter } from './shared';

const KINDS = [
  ['lower', 'Lower case (abc)', 'Include small letters.'],
  ['upper', 'Upper case (ABC)', 'Include capital letters.'],
  ['digits', 'Numbers (123)', 'Include digits.'],
  ['symbols', 'Symbols (!@#)', 'Include punctuation. Untick it for sites that refuse symbols.'],
];

/** One line saying what a set of rules means, e.g. "20 characters: a-z, A-Z, 0-9, symbols, not & ?". */
export function describeRules(options) {
  const o = normaliseOptions(options);
  const kinds = [o.lower && 'a-z', o.upper && 'A-Z', o.digits && '0-9', o.symbols && 'symbols'].filter(Boolean).join(', ');
  return `${o.length} characters: ${kinds}${o.exclude ? `, never ${o.exclude.split('').join(' ')}` : ''}`;
}

/**
 * The generator's controls and its preview: length, kinds of character, look-alikes, characters to leave out. Used by the Password
 * generator tool and by the "rules for this login" window, so both always offer exactly the same options. It makes a new password
 * whenever a rule changes; `onChange(options, password)` reports both. `startOptions` is read once.
 */
export default function GeneratorPanel({ startOptions, onChange }) {
  const getIcon = useIcon();
  const [opts, setOpts] = useState(() => normaliseOptions(startOptions));
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const make = (o = opts) => {
    let pw = '';
    let err = '';
    try { pw = generatePassword(o); } catch (e) { err = e.message; }
    setPassword(pw); setError(err);
    onChange?.(normaliseOptions(o), pw);
  };
  useEffect(() => { make(opts); }, [opts]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setOpts((o) => normaliseOptions({ ...o, ...patch }));
  const onlyOne = KINDS.filter(([k]) => opts[k]).length === 1;

  return (
    <div className="space-y-4" data-guide="generator">
      <div className="rounded-xl border p-4 flex items-center gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
        <output className="flex-1 min-w-0 font-mono text-lg break-all leading-snug" style={{ color: 'var(--color-text)' }} aria-label="Generated password">{password || ' '}</output>
        <Tooltip text="Make a different one with the same rules.">
          <button type="button" onClick={() => make()} aria-label="Make another" className="p-2 rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>{getIcon('refresh-cw', { size: 18 })}</button>
        </Tooltip>
      </div>
      <StrengthMeter password={password} />
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>About {generatedBits(opts)} bits of randomness. More than 80 is very hard to guess.</p>
      {error && <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{error}</p>}

      <div className="space-y-3" data-guide="generator-options">
        <label className="flex items-center gap-3 text-sm" style={{ color: 'var(--color-text)' }}>
          <span className="w-16 shrink-0">Length</span>
          <Tooltip text={`How many characters, from ${MIN_LENGTH} to ${MAX_LENGTH}. Longer is stronger.`}>
            <input type="range" min={MIN_LENGTH} max={MAX_LENGTH} value={opts.length} onChange={(e) => set({ length: Number(e.target.value) })} className="flex-1" aria-label="Password length" />
          </Tooltip>
          <span className="w-8 text-right tabular-nums">{opts.length}</span>
        </label>
        <div className="grid sm:grid-cols-2 gap-2">
          {KINDS.map(([k, label, tip]) => (
            <Tooltip key={k} text={tip}>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={opts[k]} disabled={opts[k] && onlyOne} onChange={(e) => set({ [k]: e.target.checked })} />{label}
              </label>
            </Tooltip>
          ))}
          <Tooltip text="Leave out characters that look alike in many fonts: l, I, 1, O, 0 and o. Handy if you ever read it out or type it by hand.">
            <label className="flex items-center gap-2 text-sm cursor-pointer sm:col-span-2" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={opts.avoidAmbiguous} onChange={(e) => set({ avoidAmbiguous: e.target.checked })} />Leave out look-alike characters (l I 1 O 0 o)
            </label>
          </Tooltip>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Never use these characters (optional)</span>
          <Tooltip text="For a site that rejects certain characters, such as & or ?. Type every character to avoid, with no spaces.">
            <input className={`${FIELD} w-full font-mono`} style={FIELD_STYLE} value={opts.exclude} maxLength={MAX_EXCLUDE} onChange={(e) => set({ exclude: e.target.value })} placeholder="e.g. &?#" aria-label="Characters never to use" autoComplete="off" spellCheck={false} />
          </Tooltip>
        </label>
      </div>
    </div>
  );
}
