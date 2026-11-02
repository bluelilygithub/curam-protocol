import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../utils/apiClient';
import Dialog from '../../components/Dialog';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';
import { chordName, rootSemi } from './theory.mjs';
import {
  FONT_STEPS, DEFAULT_FONT_STEP, BEATS_OPTIONS, clampBpm, chordMs, groupChart, keyAction, clampIndex,
} from './gigPlay.mjs';

const btn = 'text-sm px-3 py-2 rounded-lg border hover:opacity-70 transition-opacity duration-200 disabled:opacity-30';
const line = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };

/**
 * Play mode: a big chart for performing. It moves along at the song's tempo (a set number of beats on each chord), or one chord at a time
 * from the keyboard. Foot pedals and Bluetooth page turners send arrow and Page keys, so they work without any setup.
 * queue: the songs to play in order (one song, or a whole set list). Each: { id, title, artist, bpm, transposeOffset, capoOverride }.
 */
export default function GigMode({ queue, startIndex = 0, onClose }) {
  const [songIdx, setSongIdx] = useState(clampIndex(startIndex, queue.length));
  const song = queue[songIdx];
  const [chords, setChords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(clampBpm(song.bpm));
  const [beats, setBeats] = useState(4);
  const [fontStep, setFontStep] = useState(DEFAULT_FONT_STEP);
  const cursorRef = useRef(0);
  const countRef = useRef(0);
  const scrollRef = useRef(null);

  const goTo = useCallback((i) => { const n = clampIndex(i, countRef.current); cursorRef.current = n; setCursor(n); }, []);

  // Load the song's chords whenever the song changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setPlaying(false); setChords([]); countRef.current = 0; cursorRef.current = 0; setCursor(0); setBpm(clampBpm(song.bpm));
    api.get(`/api/guitar/songs/${song.id}/chords`).then(r => r.json()).then(d => {
      if (cancelled) return;
      const list = Array.isArray(d) ? d : [];
      countRef.current = list.length;
      setChords(list);
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [song.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move along at the tempo while playing; stop on the last chord
  useEffect(() => {
    if (!playing || !chords.length) return undefined;
    const id = setInterval(() => {
      if (cursorRef.current >= countRef.current - 1) { setPlaying(false); return; }
      goTo(cursorRef.current + 1);
    }, chordMs(bpm, beats));
    return () => clearInterval(id);
  }, [playing, bpm, beats, chords.length, goTo]);

  // Keep the current chord in the middle of the screen
  useEffect(() => {
    scrollRef.current?.querySelector(`[data-gig-idx="${cursor}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [cursor, chords.length, fontStep]);

  // Keep the screen awake while performing (not every browser has this)
  useEffect(() => {
    let lock = null;
    (async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch (_) { /* not allowed */ } })();
    return () => { try { lock?.release(); } catch (_) { /* already released */ } };
  }, []);

  const changeSong = useCallback((delta) => {
    setSongIdx(i => clampIndex(i + delta, queue.length));
  }, [queue.length]);

  const act = useCallback((action) => {
    switch (action) {
      case 'toggle': setPlaying(p => !p); break;
      case 'next': goTo(cursorRef.current + 1); break;
      case 'prev': goTo(cursorRef.current - 1); break;
      case 'bigger': setFontStep(s => Math.min(FONT_STEPS.length - 1, s + 1)); break;
      case 'smaller': setFontStep(s => Math.max(0, s - 1)); break;
      case 'faster': setBpm(b => clampBpm(b + 5)); break;
      case 'slower': setBpm(b => clampBpm(b - 5)); break;
      case 'nextSong': changeSong(1); break;
      case 'prevSong': changeSong(-1); break;
      default: break;
    }
  }, [goTo, changeSong]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return;
      const action = keyAction(e.key);
      if (!action) return;
      e.preventDefault();
      act(action);
    };
    // A focused button would also "click" on Space; the key already did its job
    const onUp = (e) => { if (e.key === ' ' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  }, [act]);

  const transpose = song.transposeOffset || 0;
  const label = (ev) => { const r = rootSemi(ev.chordRoot); return r === null ? ev.chordRoot : chordName(r + transpose, ev.chordQuality || ''); };
  const size = FONT_STEPS[fontStep];
  const sections = groupChart(chords);
  const capo = song.capoOverride || 0;

  return (
    <Dialog raw onClose={onClose}
      overlayClassName="fixed inset-0 z-[44] flex"
      overlayStyle={{ background: 'var(--color-bg)' }}
      panelClassName="flex flex-col w-full h-full"
      panelStyle={{ background: 'var(--color-bg)' }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold truncate" style={{ color: 'var(--color-text)' }}>{song.title}</h2>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {song.artist ? `${song.artist} · ` : ''}
            {queue.length > 1 ? `Song ${songIdx + 1} of ${queue.length} · ` : ''}
            {capo > 0 ? `Capo ${capo} · ` : ''}{transpose ? `Transposed ${transpose > 0 ? '+' : ''}${transpose} · ` : ''}
            {chords.length ? `Chord ${cursor + 1} of ${chords.length}` : ''}
          </p>
        </div>
        {queue.length > 1 && (
          <>
            <Tooltip text={GT.gigPrevSong}>
              <button className={btn} style={line} disabled={songIdx === 0} onClick={() => act('prevSong')}>Previous song</button>
            </Tooltip>
            <Tooltip text={GT.gigNextSong}>
              <button className={btn} style={line} disabled={songIdx >= queue.length - 1} onClick={() => act('nextSong')}>Next song</button>
            </Tooltip>
          </>
        )}
        <Tooltip text={GT.gigClose}>
          <button className={btn} style={line} onClick={onClose}>Close</button>
        </Tooltip>
      </div>

      {/* The chart */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        {loading && <p className="text-lg" style={{ color: 'var(--color-muted)' }}>Loading the chart…</p>}
        {!loading && chords.length === 0 && <p className="text-lg" style={{ color: 'var(--color-muted)' }}>This song has no chords yet. Add some in the Player first.</p>}
        {sections.map((sec, si) => (
          <div key={si} className="mb-8">
            {sec.name && <p className="font-bold uppercase tracking-widest mb-2" style={{ fontSize: '0.9rem', color: 'var(--color-primary)' }}>{sec.name}</p>}
            {sec.lines.map((ln, li) => (
              <div key={li} className="mb-5">
                <div className="flex flex-wrap gap-3">
                  {ln.evs.map(({ ev, flatIdx }) => {
                    const on = flatIdx === cursor;
                    return (
                      <span key={ev.id ?? flatIdx} data-gig-idx={flatIdx}
                        style={{
                          fontFamily: 'monospace', fontWeight: 700, fontSize: `${size}rem`, lineHeight: 1.1, padding: '0.1em 0.35em', borderRadius: 10,
                          background: on ? 'var(--color-primary)' : 'transparent', color: on ? 'var(--color-on-primary, #fff)' : 'var(--color-text)',
                          border: `2px solid ${on ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        }}>{label(ev)}</span>
                    );
                  })}
                </div>
                {ln.lyric && <p style={{ fontSize: `${Math.max(1, size * 0.5)}rem`, color: 'var(--color-text)', margin: '0.3rem 0 0', lineHeight: 1.4 }}>{ln.lyric}</p>}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="px-4 py-3 border-t flex items-center gap-2 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
        <Tooltip text={GT.gigPrev}>
          <button className={btn} style={line} onClick={() => act('prev')} disabled={cursor === 0}>Back</button>
        </Tooltip>
        <Tooltip text={GT.gigToggle}>
          <button className={`${btn} font-semibold`} style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderColor: 'var(--color-primary)' }}
            onClick={() => act('toggle')} disabled={!chords.length}>{playing ? 'Pause' : 'Play'}</button>
        </Tooltip>
        <Tooltip text={GT.gigNext}>
          <button className={btn} style={line} onClick={() => act('next')} disabled={cursor >= chords.length - 1}>On</button>
        </Tooltip>
        <span className="mx-2" aria-hidden="true" />
        <Tooltip text={GT.gigSlower}>
          <button className={btn} style={line} onClick={() => act('slower')} aria-label="Slower">−</button>
        </Tooltip>
        <span className="text-sm font-mono w-20 text-center" style={{ color: 'var(--color-text)' }}>{bpm} bpm</span>
        <Tooltip text={GT.gigFaster}>
          <button className={btn} style={line} onClick={() => act('faster')} aria-label="Faster">+</button>
        </Tooltip>
        <Tooltip text={GT.gigBeats}>
          <select value={beats} onChange={e => setBeats(parseInt(e.target.value, 10))} aria-label="Beats on each chord"
            className="text-sm px-2 py-2 rounded-lg border" style={line}>
            {BEATS_OPTIONS.map(b => <option key={b} value={b}>{b} beats a chord</option>)}
          </select>
        </Tooltip>
        <span className="mx-2" aria-hidden="true" />
        <Tooltip text={GT.gigSmaller}>
          <button className={btn} style={line} onClick={() => act('smaller')} disabled={fontStep === 0} aria-label="Smaller text">A−</button>
        </Tooltip>
        <Tooltip text={GT.gigBigger}>
          <button className={btn} style={line} onClick={() => act('bigger')} disabled={fontStep === FONT_STEPS.length - 1} aria-label="Bigger text">A+</button>
        </Tooltip>
        <p className="text-xs ml-auto" style={{ color: 'var(--color-muted)' }}>
          Space play · arrows or Page keys move · N next song · Esc close
        </p>
      </div>
    </Dialog>
  );
}
