import React, { useState, useEffect } from 'react';
import Tooltip from '../../components/Tooltip';
import api from '../../utils/apiClient';
import { GT } from './guitarTips.mjs';
import { NAMES, DRUM_STYLES, BASS_STYLES, PROGRESSIONS, loopFromSong } from './band.mjs';

const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const select = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' };

/**
 * The backing band's controls: drums, bass and the chords the bass follows (a well-known progression in a key you choose, or the chords of
 * one of your songs, a bar each). `band` is { on, drums, bass, vol, source, tonic, progId, songId }; `loop` is the chords that result;
 * `current` is the index of the chord playing now (or -1). onSongLoop is called with the song's loop once it has loaded.
 */
export default function BandPanel({ band, onChange, loop, current, songs, onSongLoop }) {
  const [loading, setLoading] = useState(false);
  const set = (patch) => onChange({ ...band, ...patch });

  // A song's own chords, fetched when it is chosen
  useEffect(() => {
    if (band.source !== 'song' || !band.songId) { onSongLoop([]); return undefined; }
    let cancelled = false;
    setLoading(true);
    api.get(`/api/guitar/songs/${band.songId}/chords`).then(r => r.json())
      .then(d => { if (!cancelled) onSongLoop(loopFromSong(Array.isArray(d) ? d : [])); })
      .catch(() => { if (!cancelled) onSongLoop([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [band.source, band.songId]); // eslint-disable-line react-hooks/exhaustive-deps

  const usable = songs.filter(s => s.status === 'done');

  return (
    <section className="rounded-xl border p-4 flex flex-col gap-3" style={card} data-tour="guitar-band">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Backing band</h2>
        <Tooltip text={GT.bandOn}>
          <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
            <input type="checkbox" checked={band.on} onChange={e => set({ on: e.target.checked })} /> Play drums and bass
          </label>
        </Tooltip>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        Drums and a bass play along with the arrows, so you strum with a band instead of a click. The bass follows a chord a bar; change chords with the band.
      </p>

      <div className={`flex items-center gap-3 flex-wrap ${band.on ? '' : 'opacity-50'}`}>
        <Tooltip text={GT.bandDrums}>
          <select value={band.drums} onChange={e => set({ drums: e.target.value })} aria-label="Drums" disabled={!band.on} className="text-xs px-2 py-1 rounded-lg border" style={select}>
            {DRUM_STYLES.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Tooltip>
        <Tooltip text={GT.bandBass}>
          <select value={band.bass} onChange={e => set({ bass: e.target.value })} aria-label="Bass" disabled={!band.on} className="text-xs px-2 py-1 rounded-lg border" style={select}>
            {BASS_STYLES.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Tooltip>
        <Tooltip text={GT.bandVolume}>
          <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text)' }}>
            Volume
            <input type="range" min={0} max={100} step={5} value={Math.round(band.vol * 100)} aria-label="Band volume" disabled={!band.on}
              onChange={e => set({ vol: parseInt(e.target.value, 10) / 100 })} />
          </label>
        </Tooltip>
      </div>

      <div className={`flex flex-col gap-2 ${band.on ? '' : 'opacity-50'}`}>
        <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>The chords, one a bar</p>
        <div className="flex items-center gap-2 flex-wrap" role="radiogroup" aria-label="Where the chords come from">
          <Tooltip text={GT.bandFromProgression}>
            <button type="button" role="radio" aria-checked={band.source === 'progression'} onClick={() => set({ source: 'progression' })} disabled={!band.on}
              className="text-xs px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity duration-200"
              style={band.source === 'progression' ? { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderColor: 'var(--color-primary)' } : { borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>A progression</button>
          </Tooltip>
          <Tooltip text={GT.bandFromSong}>
            <button type="button" role="radio" aria-checked={band.source === 'song'} onClick={() => set({ source: 'song' })} disabled={!band.on || usable.length === 0}
              className="text-xs px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity duration-200 disabled:opacity-40"
              style={band.source === 'song' ? { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderColor: 'var(--color-primary)' } : { borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>The chords of a song</button>
          </Tooltip>
        </div>

        {band.source === 'progression' ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Tooltip text={GT.bandKey}>
              <select value={band.tonic} onChange={e => set({ tonic: parseInt(e.target.value, 10) })} aria-label="Key" disabled={!band.on} className="text-xs px-2 py-1 rounded-lg border" style={select}>
                {NAMES.map((n, i) => <option key={n} value={i}>Key of {n}</option>)}
              </select>
            </Tooltip>
            <Tooltip text={GT.bandProgression}>
              <select value={band.progId} onChange={e => set({ progId: e.target.value })} aria-label="Progression" disabled={!band.on} className="text-xs px-2 py-1 rounded-lg border" style={select}>
                <optgroup label="Major">{PROGRESSIONS.filter(p => p.mode === 'major').map(p => <option key={p.id} value={p.id}>{p.name} ({p.numerals})</option>)}</optgroup>
                <optgroup label="Minor">{PROGRESSIONS.filter(p => p.mode === 'minor').map(p => <option key={p.id} value={p.id}>{p.name} ({p.numerals})</option>)}</optgroup>
              </select>
            </Tooltip>
          </div>
        ) : (
          <Tooltip text={GT.bandSong}>
            <select value={band.songId || ''} onChange={e => set({ songId: e.target.value ? parseInt(e.target.value, 10) : null })} aria-label="Song" disabled={!band.on}
              className="text-xs px-2 py-1 rounded-lg border self-start max-w-full" style={select}>
              <option value="">Choose a song…</option>
              {usable.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </Tooltip>
        )}

        <div className="flex items-center gap-1 flex-wrap" aria-label="The chord loop">
          {loop.map((c, i) => (
            <span key={`${c.name}-${i}`} className="text-sm font-mono font-semibold px-2.5 py-1 rounded-lg"
              style={{ border: '1px solid var(--color-border)', background: i === current ? 'var(--color-primary)' : 'transparent', color: i === current ? 'var(--color-on-primary, #fff)' : 'var(--color-text)' }}>{c.name}</span>
          ))}
          {loop.length === 0 && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{loading ? 'Loading the chords…' : band.source === 'song' ? 'Choose a song with chords to play along with.' : ''}</span>}
        </div>
      </div>
    </section>
  );
}
