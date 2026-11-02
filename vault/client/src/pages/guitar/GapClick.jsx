import React, { useState, useEffect, useRef, useCallback } from 'react';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';
import { GlossText } from './GlossaryTerm';
import { audioContextFrom } from './chordSound.js';
import { LEVELS, COUNT_IN, levelById, beatSeconds, totalBeats, audible, grade, clears } from './gapTiming.mjs';

const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const btnPrimary = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
const btnLine = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const small = 'text-xs px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity duration-200 disabled:opacity-30';
const KEY = 'vault:guitar:gapclick';
const LOOKAHEAD = 0.12;   // seconds of sound scheduled ahead of the clock

const saved = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

function tick(ctx, when, freq, gain) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(when); osc.stop(when + 0.09);
}

/**
 * The gap click: a metronome that goes silent on purpose. The player taps on every beat (the big button or the space bar) and keeps tapping
 * through the silence; gapTiming.mjs measures how far the taps wander from the tempo. Vault never listens to the guitar. The step reached,
 * the tempo and the steps cleared stay in this browser only.
 */
export default function GapClick() {
  const init = saved();
  const [levelId, setLevelId] = useState(levelById(init.levelId) ? init.levelId : LEVELS[0].id);
  const [bpm, setBpm] = useState(Math.min(140, Math.max(50, Number(init.bpm) || 80)));
  const [cleared, setCleared] = useState(() => (init.cleared && typeof init.cleared === 'object' ? Object.fromEntries(Object.entries(init.cleared).filter(([id]) => levelById(id))) : {}));
  const [running, setRunning] = useState(false);
  const [beatNow, setBeatNow] = useState(-1);
  const [flash, setFlash] = useState(false);
  const [result, setResult] = useState(null);

  const level = levelById(levelId);
  const index = LEVELS.findIndex(l => l.id === levelId);

  const ctxRef = useRef(null);
  const t0 = useRef(0);
  const nextN = useRef(0);
  const timer = useRef(null);
  const raf = useRef(null);
  const taps = useRef([]);
  const live = useRef({});
  live.current = { level, bpm, running };

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ levelId, bpm, cleared })); } catch { /* private window */ }
  }, [levelId, bpm, cleared]);

  const halt = useCallback(() => {
    clearInterval(timer.current); timer.current = null;
    cancelAnimationFrame(raf.current); raf.current = null;
    setRunning(false); setBeatNow(-1);
  }, []);
  useEffect(() => halt, [halt]);

  const finish = useCallback(() => {
    const { level: lv, bpm: tempo } = live.current;
    const r = grade(taps.current, lv, tempo);
    halt();
    setResult({ ...r, levelId: lv.id, bpm: tempo });
    if (clears(r)) setCleared(c => ({ ...c, [lv.id]: { bpm: tempo } }));
  }, [halt]);

  const schedule = useCallback(() => {
    const ctx = ctxRef.current;
    const { level: lv, bpm: tempo } = live.current;
    const beat = beatSeconds(tempo);
    while (nextN.current < totalBeats(lv) && t0.current + nextN.current * beat < ctx.currentTime + LOOKAHEAD) {
      const n = nextN.current;
      if (audible(lv, n)) tick(ctx, t0.current + n * beat, n % 4 === 0 ? 1500 : 1000, n % 4 === 0 ? 0.35 : 0.25);
      nextN.current += 1;
    }
  }, []);

  const frame = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { level: lv, bpm: tempo } = live.current;
    const beat = beatSeconds(tempo);
    const n = Math.floor((ctx.currentTime - t0.current) / beat);
    if (ctx.currentTime - t0.current > (totalBeats(lv) - 0.5) * beat) { finish(); return; }
    setBeatNow(prev => (prev === n ? prev : n));
    raf.current = requestAnimationFrame(frame);
  }, [finish]);

  const start = () => {
    const ctx = audioContextFrom(ctxRef);
    taps.current = [];
    setResult(null);
    t0.current = ctx.currentTime + 0.15;
    nextN.current = 0;
    setRunning(true);
    timer.current = setInterval(schedule, 25);
    raf.current = requestAnimationFrame(frame);
  };

  const tap = useCallback(() => {
    const ctx = ctxRef.current;
    if (!live.current.running || !ctx) return;
    taps.current.push(ctx.currentTime - t0.current);
    setFlash(true);
    setTimeout(() => setFlash(false), 90);
  }, []);

  // Space taps while a run is going (and never types into a field or presses a button)
  useEffect(() => {
    if (!running) return undefined;
    const onKey = (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
      e.preventDefault();
      tap();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, tap]);

  const choose = (id) => { if (running) halt(); setLevelId(id); setResult(null); };
  const beatInBar = beatNow >= 0 ? (beatNow % 4) + 1 : 0;
  const counting = running && beatNow >= 0 && beatNow < COUNT_IN;
  const clickOn = running && beatNow >= 0 && audible(level, beatNow);
  const done = result && result.levelId === levelId ? result : null;

  return (
    <section className="rounded-xl border p-4 flex flex-col gap-3" style={card} data-tour="guitar-gap">
      <div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Gap click</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          <GlossText text="A gap click is a metronome that goes quiet on purpose. Tap on every beat, with the big button or the space bar, and keep tapping when the click disappears. Your taps show whether your own sense of time holds steady or rushes or drags. Vault does not listen to your guitar, so it measures your taps only." />
        </p>
      </div>

      <div className="flex flex-col gap-1" role="radiogroup" aria-label="Steps of the gap click">
        {LEVELS.map((l, i) => (
          <Tooltip text={GT.gapLevel} key={l.id}>
            <button type="button" role="radio" aria-checked={l.id === levelId} onClick={() => choose(l.id)}
              className="w-full text-left text-sm px-3 py-2 rounded-lg border flex items-center gap-2 hover:opacity-70 transition-opacity duration-200"
              style={l.id === levelId ? { borderColor: 'var(--color-primary)', color: 'var(--color-text)' } : btnLine}>
              <span className="font-mono text-xs" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
              <span className="flex-1">{l.name}</span>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{cleared[l.id] ? `Steady ✓ at ${cleared[l.id].bpm} bpm` : ''}</span>
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="rounded-lg border p-3 flex flex-col gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
        <p className="text-xs" style={{ color: 'var(--color-text)' }}><GlossText text={level.what} /></p>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2" aria-hidden="true">
            {[1, 2, 3, 4].map(b => (
              <span key={b} className="w-6 h-6 rounded-full border-2 transition-colors duration-200"
                style={{ borderColor: 'var(--color-primary)', background: running && beatInBar === b ? (clickOn ? 'var(--color-primary)' : 'var(--color-border)') : 'transparent' }} />
            ))}
          </div>
          <p className="text-sm font-semibold min-h-[1.25rem]" style={{ color: 'var(--color-text)' }} aria-live="polite">
            {!running ? '' : beatNow < 0 ? 'Get ready' : counting ? 'Count-in: tap along' : clickOn ? 'Click on' : 'Click off: keep tapping'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Tooltip text={running ? GT.gapStop : GT.gapPlay}>
            <button onClick={running ? halt : start} className="px-4 py-2 text-sm rounded-lg font-medium hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>
              {running ? 'Stop' : 'Start'}
            </button>
          </Tooltip>
          <Tooltip text={GT.strumSlower}>
            <button className={small} style={btnLine} aria-label="Slower" disabled={running} onClick={() => setBpm(b => Math.max(50, b - 5))}>−</button>
          </Tooltip>
          <Tooltip text={GT.gapTempo}>
            <input type="range" min={50} max={140} step={1} value={bpm} disabled={running} aria-label="Tempo in beats a minute" onChange={e => setBpm(parseInt(e.target.value, 10))} />
          </Tooltip>
          <Tooltip text={GT.strumFaster}>
            <button className={small} style={btnLine} aria-label="Faster" disabled={running} onClick={() => setBpm(b => Math.min(140, b + 5))}>+</button>
          </Tooltip>
          <span className="text-sm font-mono w-20" style={{ color: 'var(--color-text)' }}>{bpm} bpm</span>
        </div>

        <Tooltip text={GT.gapTap}>
          <button type="button" disabled={!running} onPointerDown={(e) => { e.preventDefault(); tap(); }}
            onKeyDown={(e) => { if (e.code === 'Space') e.preventDefault(); }}
            className="w-full py-6 rounded-xl border-2 text-lg font-semibold transition-colors duration-200 disabled:opacity-40 select-none touch-manipulation"
            style={{ borderColor: 'var(--color-primary)', background: flash ? 'var(--color-primary)' : 'var(--color-surface)', color: flash ? 'var(--color-on-primary, #fff)' : 'var(--color-text)' }}>
            Tap on every beat {running ? '(or press the space bar)' : ''}
          </button>
        </Tooltip>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {running ? `Beat ${Math.max(0, beatNow - COUNT_IN + 1)} of ${totalBeats(level) - COUNT_IN} after the count-in.` : 'Press Start. One bar of clicks comes first, then the pattern. Your taps are not shown while it runs, so you cannot follow them by eye.'}
        </p>

        {done && (
          <div className="rounded-lg border p-3 flex flex-col gap-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} aria-live="polite">
            {done.ok ? (
              <>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{done.verdict === 'steady' ? 'Steady ✓' : done.verdict === 'close' ? 'Close' : 'Drifting'}</p>
                <p className="text-xs" style={{ color: 'var(--color-text)' }}>{done.text}</p>
                <p className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>
                  Silent beats tapped: {done.silentTaps} of {done.silentBeats}. Average distance from the beat: {Math.round(done.meanAbsMs)} ms. Worst: {Math.round(done.maxAbsMs)} ms.
                  {done.driftMsPerBeat != null ? ` Change on each silent beat: ${done.driftMsPerBeat > 0 ? '+' : ''}${done.driftMsPerBeat} ms.` : ''}
                </p>
                {done.biasKnown && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Your usual tap delay while the click was on, {done.bias} ms, has been taken off.</p>}
              </>
            ) : (
              <p className="text-xs" style={{ color: 'var(--color-text)' }}>{done.reason}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Tooltip text={GT.gapEasier}><button className={small} style={btnLine} disabled={index === 0 || running} onClick={() => choose(LEVELS[index - 1].id)}>Easier step</button></Tooltip>
        <Tooltip text={GT.gapHarder}><button className={small} style={btnLine} disabled={index >= LEVELS.length - 1 || running} onClick={() => choose(LEVELS[index + 1].id)}>Harder step</button></Tooltip>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        A step is cleared by one steady run. Tap a little early or late all the way through and that is fine: your usual delay is measured while the click is on and taken off. What counts is how the beat changes once the click is gone.
      </p>
    </section>
  );
}
