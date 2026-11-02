import React, { useState, useEffect, useRef, useCallback } from 'react';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';
import { audioContextFrom } from './chordSound.js';
import {
  PATTERNS, SLOTS, swings, ladder, slotMs, slotAt, describe,
} from './strumming.mjs';

const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const btnPrimary = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
const btnLine = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const small = 'text-xs px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity duration-200 disabled:opacity-30';
const KEY = 'vault:guitar:strum';
const BARS = [2, 4, 8];
const LOOKAHEAD = 0.12;   // seconds of sound scheduled ahead of the clock
const COUNT_IN = SLOTS;   // one bar of clicks before the arrows start

const saved = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

/** A short tick: a click on the beat, or a softer, shorter tone for a strum that hits. */
function tick(ctx, when, freq, gain, len = 0.05) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, when + len);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(when); osc.stop(when + len + 0.03);
}

/**
 * Strumming arrows that move with the beat, and a ladder from "down on every beat" to the full pattern. The beat is scheduled on the
 * audio clock (not on a timer), so the arrows and the click stay together. songs: [{ id, title, bpm }] for "match a song's tempo".
 */
export default function StrumTrainer({ songs = [] }) {
  const init = saved();
  const [patternId, setPatternId] = useState(PATTERNS.some(p => p.id === init.patternId) ? init.patternId : 'old-faithful');
  const [bpm, setBpm] = useState(Math.min(160, Math.max(40, Number(init.bpm) || 70)));
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState({ slot: -1, bar: -1 }); // bar 0 is the count-in
  const [useLadder, setUseLadder] = useState(true);
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(false);
  const [bars, setBars] = useState(4);
  const [clickOn, setClickOn] = useState(true);
  const [soundOn, setSoundOn] = useState(true);

  const target = PATTERNS.find(p => p.id === patternId) || PATTERNS[2];
  const rungs = ladder(target.pattern);
  const safeStep = Math.min(step, rungs.length - 1);
  const shown = useLadder ? rungs[safeStep].pattern : target.pattern;

  // Everything the scheduler reads lives in refs, so changing the pattern or tempo mid-run needs no restart
  const ctxRef = useRef(null);
  const t0 = useRef(0);          // audio time the count-in began
  const nextN = useRef(0);       // next swing to schedule, counted from the start of the count-in
  const timer = useRef(null);
  const raf = useRef(null);
  const live = useRef({});
  live.current = { shown, bpm, clickOn, soundOn };

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ patternId, bpm })); } catch { /* private window */ } }, [patternId, bpm]);

  const stop = useCallback(() => {
    clearInterval(timer.current); timer.current = null;
    cancelAnimationFrame(raf.current); raf.current = null;
    setRunning(false); setPosition({ slot: -1, bar: -1 });
  }, []);
  useEffect(() => stop, [stop]);

  const schedule = useCallback(() => {
    const ctx = ctxRef.current;
    const stepSec = slotMs(live.current.bpm) / 1000;
    while (t0.current + nextN.current * stepSec < ctx.currentTime + LOOKAHEAD) {
      const n = nextN.current;
      const when = t0.current + n * stepSec;
      const slot = n % SLOTS;
      const counting = n < COUNT_IN;
      if (live.current.clickOn || counting) { if (slot % 2 === 0) tick(ctx, when, slot === 0 ? 1500 : 1000, slot === 0 ? 0.35 : 0.22); }
      if (!counting && live.current.soundOn && live.current.shown[slot] !== '-') tick(ctx, when, slot % 2 === 0 ? 330 : 520, 0.16, 0.09);
      nextN.current += 1;
    }
  }, []);

  const frame = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const p = slotAt(ctx.currentTime, t0.current, live.current.bpm);
    setPosition(prev => (prev.slot === p.slot && prev.bar === p.bar ? prev : p));
    raf.current = requestAnimationFrame(frame);
  }, []);

  const start = () => {
    const ctx = audioContextFrom(ctxRef);
    t0.current = ctx.currentTime + 0.1;
    nextN.current = 0;
    setRunning(true);
    timer.current = setInterval(schedule, 25);
    raf.current = requestAnimationFrame(frame);
  };

  // A tempo change while playing keeps the same place in the bar
  const changeBpm = (next) => {
    const value = Math.min(160, Math.max(40, Math.round(next)));
    if (running && ctxRef.current) {
      const ctx = ctxRef.current;
      const pos = (ctx.currentTime - t0.current) / (slotMs(bpm) / 1000);
      t0.current = ctx.currentTime - pos * (slotMs(value) / 1000);
    }
    setBpm(value);
  };

  // Climb a rung after a set number of bars on the current one (bar 0 is the count-in and does not count). The count starts again
  // whenever the step, the pattern or the settings change, so "4 bars on each step" is true after a manual move too.
  const barNow = useRef(0);
  const stepStart = useRef(1);
  barNow.current = position.bar;
  useEffect(() => { stepStart.current = Math.max(1, barNow.current); }, [step, auto, bars, patternId, useLadder, running]);
  useEffect(() => {
    if (!running || !useLadder || !auto || position.bar < 1) return;
    if (position.bar - stepStart.current >= bars && safeStep < rungs.length - 1) setStep(s => Math.min(rungs.length - 1, s + 1));
  }, [position.bar, running, useLadder, auto, bars, rungs.length, safeStep]);

  const pickPattern = (id) => { setPatternId(id); setStep(0); };
  const counting = running && position.bar === 0;
  const sw = swings(shown);

  return (
    <div className="flex flex-col gap-4" data-tour="guitar-strum">
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        Your strumming arm never stops: it goes down on every beat and up in between. A pattern is just which swings hit the strings.
        The solid arrows hit; the faint ones are air swings.
      </p>

      <section className="rounded-xl border p-4 flex flex-col gap-3" style={card}>
        <div className="flex flex-wrap gap-2">
          {PATTERNS.map(p => (
            <Tooltip text={p.tip} key={p.id}>
              <button type="button" role="radio" aria-checked={patternId === p.id} onClick={() => pickPattern(p.id)}
                className="text-sm px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200"
                style={patternId === p.id ? { ...btnPrimary, borderColor: 'var(--color-primary)' } : btnLine}>{p.name}</button>
            </Tooltip>
          ))}
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{target.name}: {describe(target.pattern)}.</p>

        {/* The arrows */}
        <div className="grid grid-cols-8 gap-1 sm:gap-2" role="group" aria-label={`Strumming pattern: ${describe(shown)}`}>
          {sw.map(s => {
            const on = running && !counting && position.slot === s.slot;
            return (
              <div key={s.slot} className="flex flex-col items-center gap-1">
                <div aria-label={`${s.label} ${s.dir} ${s.hit ? 'strum' : 'air swing'}`}
                  className="w-full aspect-square max-w-[64px] rounded-xl flex items-center justify-center transition-colors duration-200"
                  style={{
                    fontSize: '1.8rem', fontWeight: 700, lineHeight: 1,
                    border: s.hit ? '2px solid var(--color-primary)' : '2px dashed var(--color-border)',
                    background: on ? (s.hit ? 'var(--color-primary)' : 'var(--color-border)') : (s.hit ? 'var(--color-bg)' : 'transparent'),
                    color: on && s.hit ? 'var(--color-on-primary, #fff)' : (s.hit ? 'var(--color-primary)' : 'var(--color-muted)'),
                    opacity: s.hit ? 1 : 0.55,
                  }}>{s.dir === 'down' ? '↓' : '↑'}</div>
                <span className="text-xs font-mono" style={{ color: s.slot % 2 === 0 ? 'var(--color-text)' : 'var(--color-muted)', fontWeight: s.slot % 2 === 0 ? 700 : 400 }}>{s.label}</span>
              </div>
            );
          })}
        </div>
        <p className="text-sm min-h-[1.25rem]" style={{ color: 'var(--color-text)' }} aria-live="polite">
          {counting ? 'Get ready: one bar of clicks, then strum.' : running ? `Bar ${position.bar}` : ''}
        </p>

        {/* Play and tempo */}
        <div className="flex items-center gap-2 flex-wrap">
          <Tooltip text={running ? GT.strumStop : GT.strumPlay}>
            <button onClick={running ? stop : start} className="px-4 py-2 text-sm rounded-lg font-medium hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>
              {running ? 'Stop' : 'Start'}
            </button>
          </Tooltip>
          <Tooltip text={GT.strumSlower}>
            <button className={small} style={btnLine} aria-label="Slower" onClick={() => changeBpm(bpm - 5)}>−</button>
          </Tooltip>
          <Tooltip text={GT.strumTempo}>
            <input type="range" min={40} max={160} step={1} value={bpm} aria-label="Tempo in beats a minute" onChange={e => changeBpm(parseInt(e.target.value, 10))} />
          </Tooltip>
          <Tooltip text={GT.strumFaster}>
            <button className={small} style={btnLine} aria-label="Faster" onClick={() => changeBpm(bpm + 5)}>+</button>
          </Tooltip>
          <span className="text-sm font-mono w-20" style={{ color: 'var(--color-text)' }}>{bpm} bpm</span>
          {songs.some(s => s.bpm) && (
            <Tooltip text={GT.strumSong}>
              <select value="" aria-label="Match the tempo of a song" onChange={e => { const s = songs.find(x => String(x.id) === e.target.value); if (s) changeBpm(s.bpm); }}
                className="text-xs px-2 py-1 rounded-lg border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value="">Match a song…</option>
                {songs.filter(s => s.bpm).map(s => <option key={s.id} value={s.id}>{s.title} ({s.bpm})</option>)}
              </select>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <Tooltip text={GT.strumClick}>
            <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={clickOn} onChange={e => setClickOn(e.target.checked)} /> Click on the beat
            </label>
          </Tooltip>
          <Tooltip text={GT.strumSound}>
            <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={soundOn} onChange={e => setSoundOn(e.target.checked)} /> Hear the strums
            </label>
          </Tooltip>
        </div>
      </section>

      <section className="rounded-xl border p-4 flex flex-col gap-3" style={card}>
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Pattern ladder</h2>
          <Tooltip text={GT.strumLadder}>
            <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={useLadder} onChange={e => setUseLadder(e.target.checked)} /> Climb to the pattern one step at a time
            </label>
          </Tooltip>
        </div>
        {useLadder ? (
          <>
            <ol className="flex flex-col gap-1">
              {rungs.map((r, i) => (
                <li key={r.pattern + i} className="flex items-start gap-2 text-xs rounded-lg px-2 py-1"
                  style={{ background: i === safeStep ? 'var(--color-bg)' : 'transparent', border: i === safeStep ? '1px solid var(--color-primary)' : '1px solid transparent', color: 'var(--color-text)' }}>
                  <span className="w-5 text-right" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
                  <span className="font-mono">{r.pattern.replace(/-/g, '·')}</span>
                  <span style={{ color: i === safeStep ? 'var(--color-text)' : 'var(--color-muted)' }}>{i === safeStep ? r.text : describe(r.pattern)}</span>
                </li>
              ))}
            </ol>
            <div className="flex items-center gap-2 flex-wrap">
              <Tooltip text={GT.strumEasier}><button className={small} style={btnLine} disabled={safeStep === 0} onClick={() => setStep(safeStep - 1)}>Easier step</button></Tooltip>
              <Tooltip text={GT.strumHarder}><button className={small} style={btnLine} disabled={safeStep >= rungs.length - 1} onClick={() => setStep(safeStep + 1)}>Harder step</button></Tooltip>
              <Tooltip text={GT.strumFull}><button className={small} style={btnLine} disabled={safeStep >= rungs.length - 1} onClick={() => setStep(rungs.length - 1)}>Jump to the full pattern</button></Tooltip>
              <Tooltip text={GT.strumAuto}>
                <label className="flex items-center gap-1 text-xs cursor-pointer ml-2" style={{ color: 'var(--color-text)' }}>
                  <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Climb by itself every
                </label>
              </Tooltip>
              <Tooltip text={GT.strumBars}>
                <select value={bars} onChange={e => setBars(parseInt(e.target.value, 10))} aria-label="Bars on each step" disabled={!auto}
                  className="text-xs px-1 py-0.5 rounded border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  {BARS.map(b => <option key={b} value={b}>{b} bars</option>)}
                </select>
              </Tooltip>
            </div>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Stay on a step until it feels easy, then move up. Slowing the tempo down is always fine.
            </p>
          </>
        ) : (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Showing the full pattern straight away.</p>
        )}
      </section>
    </div>
  );
}
