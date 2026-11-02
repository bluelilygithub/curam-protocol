import React, { useState, useEffect, useRef, useCallback } from 'react';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import {
  MIN_SPEED, MAX_SPEED, START_SPEED, DEFAULT_CLEAN_TARGET,
  clampSpeed, afterCleanPass, afterMessyPass, beatSeconds, dailyBest, progressLine,
} from './trainerRules.mjs';

/** Metronome click (WebAudio). `accent` marks the first beat of a count-in. */
function playClick(ctx, when, accent) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1500 : 1000;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.4, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.08);
}

/** Small line graph of the fastest speed cleared each day. */
function SpeedGraph({ points }) {
  if (points.length < 2) return null;
  const W = 220, H = 56, P = 6;
  const vals = points.map(p => p.bpm ?? p.speedPct);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const xy = (v, i) => [P + (i / (points.length - 1)) * (W - 2 * P), H - P - ((v - lo) / span) * (H - 2 * P)];
  const path = vals.map((v, i) => xy(v, i).join(',')).join(' ');
  const [lx, ly] = xy(vals[vals.length - 1], vals.length - 1);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Speed cleared per day" style={{ maxWidth: W }}>
      <polyline points={path} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3" fill="var(--color-primary)" />
    </svg>
  );
}

/**
 * Tempo trainer for the active loop: slow it down without changing pitch, ramp the speed up after clean passes,
 * count in and click at the song's tempo, and chart the speed cleared over time.
 * onSpeed(pct) applies the speed to the player and returns the percent it really ran at (YouTube only has fixed rates).
 */
export default function TempoTrainer({ loop, song, passes, onSpeed, onPlay, onPause, onSeek }) {
  const addToast = useToastStore(s => s.addToast);
  const [speed, setSpeed] = useState(100);
  const [ramp, setRamp] = useState(false);
  const [target, setTarget] = useState(DEFAULT_CLEAN_TARGET);
  const [clean, setClean] = useState(0);
  const [click, setClick] = useState(false);
  const [counting, setCounting] = useState(false);
  const [runs, setRuns] = useState([]);
  const ctxRef = useRef(null);
  const speedRef = useRef(100);

  const audioCtx = () => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume();
    return ctxRef.current;
  };

  const applySpeed = useCallback((pct) => {
    const real = onSpeed(clampSpeed(pct));
    speedRef.current = real;
    setSpeed(real);
    return real;
  }, [onSpeed]);

  const loadRuns = useCallback(() => {
    api.get(`/api/guitar/loop-runs/${loop.id}`).then(r => r.json()).then(d => setRuns(Array.isArray(d) ? d : [])).catch(() => {});
  }, [loop.id]);

  // A new loop starts at full speed with the ramp off; leaving the loop puts the player back to normal speed
  useEffect(() => {
    setRamp(false);
    setClean(0);
    setRuns([]);
    applySpeed(100);
    loadRuns();
    return () => { try { onSpeed(100); } catch (_) { /* player already gone */ } };
  }, [loop.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const logRun = useCallback(async (pct, cleanPasses) => {
    try {
      const res = await api.post('/api/guitar/loop-runs', { loopId: loop.id, speedPct: pct, cleanPasses });
      if (!res.ok) throw new Error((await res.json()).error);
      loadRuns();
    } catch (e) { addToast(e.message, 'error'); }
  }, [loop.id, loadRuns, addToast]);

  const mark = (isClean) => {
    const next = isClean
      ? afterCleanPass({ speed: speedRef.current, clean, target })
      : afterMessyPass({ speed: speedRef.current });
    setClean(next.clean);
    if (next.cleared != null) {
      logRun(next.cleared, target);
      const now = applySpeed(next.speed);
      addToast(`Cleared ${next.cleared}%. Now ${now}%`, 'success');
    }
  };

  const startTrainer = () => {
    setRamp(true);
    setClean(0);
    applySpeed(START_SPEED);
    onSeek();
    onPlay();
  };

  // Free-running click at the song's tempo for the chosen speed. It is not locked to the recording.
  useEffect(() => {
    const beat = beatSeconds(song.bpm, speed);
    if (!click || !beat) return undefined;
    const id = setInterval(() => { const c = audioCtx(); playClick(c, c.currentTime + 0.02, false); }, beat * 1000);
    return () => clearInterval(id);
  }, [click, song.bpm, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  const countIn = () => {
    if (counting) return;
    const beat = beatSeconds(song.bpm || 90, speed);
    const c = audioCtx();
    const t0 = c.currentTime + 0.1;
    onPause();
    onSeek();
    setCounting(true);
    for (let i = 0; i < 4; i++) playClick(c, t0 + i * beat, i === 0);
    setTimeout(() => { setCounting(false); onPlay(); }, (0.1 + 4 * beat) * 1000);
  };

  const points = dailyBest(runs);
  const line = progressLine(points);
  const btn = 'text-xs px-2 py-1 rounded border hover:opacity-70 transition-opacity duration-200';
  const bs = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };

  return (
    <div className="mt-3 pt-3 border-t flex flex-col gap-2" style={{ borderColor: 'var(--color-border)' }}>
      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Tempo trainer · {loop.name}</p>
      <div className="flex items-center gap-1">
        <Tooltip text={GT.slower}>
          <button className={btn} style={bs} aria-label="Slower" onClick={() => applySpeed(speed - 5)}>−</button>
        </Tooltip>
        <Tooltip text={GT.speed}>
          <input type="range" min={MIN_SPEED} max={MAX_SPEED} step="5" value={speed} aria-label="Playback speed"
            onChange={e => applySpeed(parseInt(e.target.value, 10))} className="flex-1" />
        </Tooltip>
        <Tooltip text={GT.faster}>
          <button className={btn} style={bs} aria-label="Faster" onClick={() => applySpeed(speed + 5)}>+</button>
        </Tooltip>
        <span className="text-xs font-mono w-24 text-right" style={{ color: 'var(--color-text)' }}>
          {speed}%{song.bpm ? ` · ${Math.round(song.bpm * speed / 100)} bpm` : ''}
        </span>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Pitch stays the same when you slow it down.</p>

      <div className="flex items-center gap-1 flex-wrap">
        {!ramp ? (
          <Tooltip text={GT.startRamp}>
            <button className={btn} style={bs} onClick={startTrainer}>Start at {START_SPEED}%</button>
          </Tooltip>
        ) : (
          <Tooltip text={GT.stopRamp}>
            <button className={btn} style={bs} onClick={() => { setRamp(false); setClean(0); }}>Stop ramp</button>
          </Tooltip>
        )}
        <Tooltip text={GT.countIn}>
          <button className={btn} style={bs} onClick={countIn} disabled={counting}>{counting ? 'Counting…' : 'Count in & play'}</button>
        </Tooltip>
        {song.bpm ? (
          <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
            <Tooltip text={GT.click}>
              <input type="checkbox" checked={click} onChange={e => setClick(e.target.checked)} />
            </Tooltip>
            Click
          </label>
        ) : null}
        <Tooltip text={GT.logSpeed}>
          <button className={btn} style={bs} onClick={() => logRun(speed, ramp ? clean : null)}>Log this speed</button>
        </Tooltip>
      </div>
      {click && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>The click keeps the song's tempo but is not locked to the recording.</p>}

      {ramp && (
        <div className="rounded-lg border p-2 flex flex-col gap-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <p className="text-xs" style={{ color: 'var(--color-text)' }}>
            Passes: {passes} · clean in a row: {clean} of {target}. Tap Clean after a pass you played cleanly; at {target} the speed goes up 5%.
          </p>
          <div className="flex items-center gap-1">
            <Tooltip text={GT.cleanPass}>
              <button className={btn} style={{ ...bs, borderColor: 'var(--color-primary)' }} onClick={() => mark(true)}>Clean</button>
            </Tooltip>
            <Tooltip text={GT.messyPass}>
              <button className={btn} style={bs} onClick={() => mark(false)}>Messy</button>
            </Tooltip>
            <label className="flex items-center gap-1 text-xs ml-auto" style={{ color: 'var(--color-muted)' }}>
              Clean passes to step up
              <Tooltip text={GT.cleanTarget}>
                <select value={target} onChange={e => { setTarget(parseInt(e.target.value, 10)); setClean(0); }}
                  className="text-xs px-1 py-0.5 rounded border"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </Tooltip>
            </label>
          </div>
        </div>
      )}

      {line && <p className="text-xs" style={{ color: 'var(--color-text)' }}>Progress on this loop: {line}</p>}
      <SpeedGraph points={points} />
    </div>
  );
}
