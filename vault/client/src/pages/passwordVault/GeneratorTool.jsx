import React, { useEffect, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { MAX_LENGTH, MIN_LENGTH, generatePassword, generatedBits } from '../../utils/passwordGen.mjs';
import { BTN, BTN_OUTLINE, BTN_PRIMARY, CARD, CARD_STYLE, StrengthMeter, copySecret, loadGenOptions, saveGenOptions } from './shared';

const KINDS = [
  ['lower', 'Lower case (abc)', 'Include small letters.'],
  ['upper', 'Upper case (ABC)', 'Include capital letters.'],
  ['digits', 'Numbers (123)', 'Include digits.'],
  ['symbols', 'Symbols (!@#)', 'Include punctuation. Untick it for sites that refuse symbols.'],
];

/** Works without unlocking: it saves nothing. `onUse(password)` carries the result into a new login. */
export default function GeneratorTool({ onUse }) {
  const getIcon = useIcon();
  const [opts, setOpts] = useState(loadGenOptions);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const make = (o = opts) => {
    try { setPassword(generatePassword(o)); setError(''); } catch (e) { setPassword(''); setError(e.message); }
  };
  useEffect(() => { make(opts); saveGenOptions(opts); }, [opts]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setOpts((o) => ({ ...o, ...patch }));
  const onlyOne = KINDS.filter(([k]) => opts[k]).length === 1;

  return (
    <div className={CARD} style={CARD_STYLE} data-guide="generator">
      <div className="rounded-xl border p-4 flex items-center gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
        <output className="flex-1 min-w-0 font-mono text-lg break-all leading-snug" style={{ color: 'var(--color-text)' }} aria-label="Generated password">{password || ' '}</output>
        <Tooltip text="Make a different one with the same settings.">
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
      </div>

      <div className="flex flex-wrap gap-2">
        <Tooltip text="Copy it. It is cleared from the clipboard after 30 seconds.">
          <button type="button" onClick={() => password && copySecret(password)} disabled={!password} className={BTN} style={BTN_PRIMARY}>{getIcon('copy', { size: 14 })}Copy</button>
        </Tooltip>
        <Tooltip text="Start a new login with this password already filled in. You will be asked for your master password if the vault is locked.">
          <button type="button" onClick={() => password && onUse(password)} disabled={!password} className={BTN} style={BTN_OUTLINE}>{getIcon('key-round', { size: 14 })}Put it in a new login</button>
        </Tooltip>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>Made on this device with your browser's secure random numbers. Nothing is sent or saved until you put it in a login. Your length and character choices are remembered on this browser only.</p>
    </div>
  );
}
