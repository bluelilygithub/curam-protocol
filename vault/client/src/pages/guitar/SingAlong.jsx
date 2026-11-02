import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import { GlossText } from './GlossaryTerm';
import { GT } from './guitarTips.mjs';
import { keyLabel } from './theory.mjs';
import { NOTE_CHOICES, VOICE_PRESETS, noteName, checkRange, suggestKey, MELODY_BELOW, MELODY_ABOVE } from './singRange.mjs';
import { playToneMidi, audioContextFrom } from './chordSound.js';

const SETTING = 'guitar_vocal_range';
const select = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' };
const btnLine = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const btnPrimary = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
const mod12 = (n) => ((n % 12) + 12) % 12;

/**
 * Sing it in your range: the person says the lowest and highest notes they can sing comfortably (picked from a list, with a button to hear each
 * note; no microphone), and for the open song this says which key suits them and offers to move the song there. `theory` is analyseSong();
 * `adviceFor(t)` gives the capo advice the song would have at transpose `t`; `onUse(t)` sets the transpose.
 */
export default function SingAlong({ theory, transpose, adviceFor, onUse }) {
  const addToast = useToastStore(s => s.addToast);
  const [range, setRange] = useState(undefined);        // undefined = loading, null = not set, { low, high }
  const [editing, setEditing] = useState(false);
  const [low, setLow] = useState(52);                   // E3
  const [high, setHigh] = useState(69);                 // A4
  const ctxRef = useRef(null);

  useEffect(() => {
    api.get('/api/settings').then(r => r.json()).then(all => {
      try {
        const saved = all && all[SETTING] ? JSON.parse(all[SETTING]) : null;
        const ok = saved && checkRange(saved.low, saved.high);
        setRange(ok && ok.ok ? ok.value : null);
        if (ok && ok.ok) { setLow(ok.value.low); setHigh(ok.value.high); }
      } catch (_) { setRange(null); }
    }).catch(() => setRange(null));
  }, []);

  const hear = useCallback((midi) => {
    try { playToneMidi(audioContextFrom(ctxRef), midi); } catch (_) { addToast('Sound is not available in this browser', 'error'); }
  }, [addToast]);

  const check = checkRange(low, high);
  const save = async () => {
    if (!check.ok) return;
    try {
      const res = await api.post('/api/settings', { key: SETTING, value: JSON.stringify(check.value) });
      if (!res.ok) throw new Error('Could not save your range');
      setRange(check.value);
      setEditing(false);
    } catch (e) { addToast(e.message, 'error'); }
  };
  const clear = async () => {
    try { await api.post('/api/settings', { key: SETTING, value: '' }); } catch (_) { /* keep going: the range is only a convenience */ }
    setRange(null); setEditing(false);
  };

  if (range === undefined) return null;
  const showEditor = editing || !range;
  const result = range && theory ? suggestKey({ range, playedTonic: theory.playedKey.tonic, transpose }) : null;
  const newKey = result && result.ok ? { tonic: mod12(theory.playedKey.tonic + result.shift), mode: theory.playedKey.mode } : null;
  const newAdvice = result && result.ok && !result.already ? adviceFor(result.transpose) : null;

  const picker = (label, value, set, tip, aria) => (
    <div className="flex items-center gap-1">
      <Tooltip text={tip}>
        <select aria-label={aria} value={value} onChange={e => set(parseInt(e.target.value, 10))} className="text-xs px-1 py-0.5 rounded border" style={select}>
          {NOTE_CHOICES.map(n => <option key={n.midi} value={n.midi}>{n.name}</option>)}
        </select>
      </Tooltip>
      <Tooltip text={GT.singHear}>
        <button type="button" onClick={() => hear(value)} aria-label={`Hear ${label}`} className="text-xs px-2 py-0.5 rounded border hover:opacity-70 transition-opacity duration-200" style={btnLine}>Hear</button>
      </Tooltip>
    </div>
  );

  return (
    <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-tour="guitar-sing">
      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Sing it in your range</p>

      {showEditor ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            <GlossText text="Tell Vault the lowest and highest notes you can sing comfortably, not straining. Press Hear to play a note, hum along and move up or down until it is your limit. Not sure? Start from the nearest voice below." />
          </p>
          <div className="flex items-center gap-1 flex-wrap">
            {VOICE_PRESETS.map(p => (
              <Tooltip text={GT.singPreset} key={p.id}>
                <button type="button" onClick={() => { setLow(p.low); setHigh(p.high); }} className="text-xs px-2 py-1 rounded border hover:opacity-70 transition-opacity duration-200" style={btnLine}>
                  {p.name} <span style={{ color: 'var(--color-muted)' }}>({p.note})</span>
                </button>
              </Tooltip>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs" style={{ color: 'var(--color-text)' }}>Lowest</span>
            {picker('the lowest note', low, setLow, GT.singLow, 'Lowest comfortable note')}
            <span className="text-xs" style={{ color: 'var(--color-text)' }}>Highest</span>
            {picker('the highest note', high, setHigh, GT.singHigh, 'Highest comfortable note')}
          </div>
          {!check.ok && <p className="text-xs" style={{ color: '#b45309' }}>{check.error}</p>}
          <div className="flex items-center gap-2">
            <Tooltip text={GT.singSave}>
              <button type="button" onClick={save} disabled={!check.ok} className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200 disabled:opacity-40" style={btnPrimary}>Save my range</button>
            </Tooltip>
            {range && (
              <Tooltip text={GT.singCancel}>
                <button type="button" onClick={() => { setEditing(false); setLow(range.low); setHigh(range.high); }} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={btnLine}>Cancel</button>
              </Tooltip>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs" style={{ color: 'var(--color-text)' }}>Your range: <strong>{noteName(range.low)} to {noteName(range.high)}</strong></span>
          <Tooltip text={GT.singChange}>
            <button type="button" onClick={() => setEditing(true)} className="text-xs px-2 py-0.5 rounded border hover:opacity-70 transition-opacity duration-200" style={btnLine}>Change</button>
          </Tooltip>
          <Tooltip text={GT.singClear}>
            <button type="button" onClick={clear} className="text-xs px-2 py-0.5 rounded border hover:opacity-70 transition-opacity duration-200" style={btnLine}>Clear</button>
          </Tooltip>
        </div>
      )}

      {range && !showEditor && !theory && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Add some chords to this song and it will say which key suits your voice.</p>
      )}
      {result && !showEditor && !result.ok && <p className="text-xs" style={{ color: '#b45309' }}>{result.error}</p>}
      {result && !showEditor && result.ok && (
        <div className="flex flex-col gap-1">
          {result.already ? (
            <p className="text-xs" style={{ color: 'var(--color-text)' }}>
              {result.current.overflow === 0
                ? <>In <strong>{keyLabel(theory.playedKey)}</strong> a typical tune for this song fits your range. Leave the key as it is.</>
                : <>No other key suits your range better than <strong>{keyLabel(theory.playedKey)}</strong>. A typical tune would stick out by about {result.current.overflow} {result.current.overflow === 1 ? 'note' : 'notes'}, so you may need to drop an octave on a few phrases.</>}
            </p>
          ) : (
            <>
              <p className="text-xs" style={{ color: 'var(--color-text)' }}>
                You will probably sing this song more easily in <strong>{keyLabel(newKey)}</strong>: move it {result.shift > 0 ? 'up' : 'down'} {Math.abs(result.shift)} {Math.abs(result.shift) === 1 ? 'semitone' : 'semitones'} from {keyLabel(theory.playedKey)}.
                {result.best.fit.overflow > 0 ? ` Even then a typical tune sticks out by about ${result.best.fit.overflow} ${result.best.fit.overflow === 1 ? 'note' : 'notes'}.` : ''}
              </p>
              {newAdvice && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>In that key: {newAdvice}.</p>}
              <Tooltip text={GT.singUse}>
                <button type="button" onClick={() => onUse(result.transpose)} className="self-start text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>
                  Use {keyLabel(newKey)}
                </button>
              </Tooltip>
            </>
          )}
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Vault does not know this song&apos;s melody. It assumes a typical tune, from a fifth below the key note ({MELODY_BELOW} semitones) to a sixth above it ({MELODY_ABOVE} semitones), so treat this as a good first try and adjust by ear.
          </p>
        </div>
      )}
    </div>
  );
}
