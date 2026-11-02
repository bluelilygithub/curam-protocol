import React, { useState, useEffect, useRef, useCallback } from 'react';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';
import { GlossText } from './GlossaryTerm';
import ChordDiagram from './ChordDiagram';
import { shapeFor, STRING_NAMES } from './fingering.mjs';
import { audioContextFrom, playPluck } from './chordSound.js';
import { slotMs, slotAt } from './strumming.mjs';
import { STAGES, PICK_CHORD_NAMES, SLOTS, COUNT_LABELS, barFor, fingerLine, fingerWords, stageById, locate } from './pickPatterns.mjs';

const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const btnPrimary = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
const btnLine = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const small = 'text-xs px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity duration-200 disabled:opacity-30';
const KEY = 'vault:guitar:fingerpick';
const LOOKAHEAD = 0.12;   // seconds of sound scheduled ahead of the clock
const COUNT_IN = SLOTS;   // one bar of clicks before the notes start
const TAB_NAMES = ['e', 'B', 'G', 'D', 'A', 'E'];   // top line first

const saved = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

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
 * The fingerpicking ladder: six steps from the thumb alone up to Travis picking, shown as a small tab for the chosen chord that lights up in
 * time with a click. The strings and frets come from the checked table in pickPatterns.mjs. Nothing is saved on the server: the rung, the
 * chord, the tempo and the steps ticked as comfortable stay in this browser.
 */
export default function FingerpickLadder() {
  const init = saved();
  const [stageId, setStageId] = useState(stageById(init.stageId) ? init.stageId : STAGES[0].id);
  const [chord, setChord] = useState(PICK_CHORD_NAMES.includes(init.chord) ? init.chord : 'C');
  const [bpm, setBpm] = useState(Math.min(120, Math.max(40, Number(init.bpm) || 60)));
  const [comfy, setComfy] = useState(() => (Array.isArray(init.comfy) ? init.comfy.filter(id => stageById(id)) : []));
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState({ slot: -1, bar: -1 });
  const [clickOn, setClickOn] = useState(true);
  const [soundOn, setSoundOn] = useState(true);

  const stage = stageById(stageId);
  const index = STAGES.findIndex(s => s.id === stageId);
  const bar = barFor(chord, stage);
  const shape = shapeFor(chord);

  const ctxRef = useRef(null);
  const t0 = useRef(0);
  const nextN = useRef(0);
  const timer = useRef(null);
  const raf = useRef(null);
  const live = useRef({});
  live.current = { bar, bpm, clickOn, soundOn };

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ stageId, chord, bpm, comfy })); } catch { /* private window */ }
  }, [stageId, chord, bpm, comfy]);

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
      if ((live.current.clickOn || counting) && slot % 2 === 0) tick(ctx, when, slot === 0 ? 1500 : 1000, slot === 0 ? 0.35 : 0.22);
      if (!counting && live.current.soundOn && live.current.bar) {
        for (const note of live.current.bar[slot].notes) playPluck(ctx, note.midi, when, note.finger === 'p' ? 0.22 : 0.16);
      }
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
    const value = Math.min(120, Math.max(40, Math.round(next)));
    if (running && ctxRef.current) {
      const ctx = ctxRef.current;
      const pos = (ctx.currentTime - t0.current) / (slotMs(bpm) / 1000);
      t0.current = ctx.currentTime - pos * (slotMs(value) / 1000);
    }
    setBpm(value);
  };

  const toggleComfy = () => setComfy(list => (list.includes(stageId) ? list.filter(id => id !== stageId) : [...list, stageId]));
  const counting = running && position.bar === 0;
  const bass = locate(chord, 'R');
  const alt = locate(chord, 'A');

  return (
    <section className="rounded-xl border p-4 flex flex-col gap-3" style={card} data-tour="guitar-fingerpick">
      <div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Fingerpicking ladder</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          <GlossText text="Instead of strumming, pluck one string at a time. Your thumb (p) takes the bass strings, your index (i) the G string, your middle finger (m) the B string and your ring finger (a) the high E. Hold the chord with your other hand, climb one step at a time, and stay on a step until it feels easy." />
        </p>
      </div>

      <div className="flex flex-col gap-1" role="radiogroup" aria-label="Steps of the fingerpicking ladder">
        {STAGES.map((st, i) => (
          <Tooltip text={GT.pickRung} key={st.id}>
            <button type="button" role="radio" aria-checked={st.id === stageId} onClick={() => setStageId(st.id)}
              className="w-full text-left text-sm px-3 py-2 rounded-lg border flex items-center gap-2 hover:opacity-70 transition-opacity duration-200"
              style={st.id === stageId ? { borderColor: 'var(--color-primary)', color: 'var(--color-text)' } : btnLine}>
              <span className="font-mono text-xs" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
              <span className="flex-1">{st.name}</span>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{comfy.includes(st.id) ? 'Comfortable ✓' : ''}</span>
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="rounded-lg border p-3 flex flex-col gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex flex-col items-center gap-1">
            <Tooltip text={GT.pickChord}>
              <select value={chord} onChange={e => setChord(e.target.value)} aria-label="Chord to pick" disabled={running}
                className="text-xs px-1 py-0.5 rounded border disabled:opacity-50" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                {PICK_CHORD_NAMES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Tooltip>
            <ChordDiagram shape={shape} />
          </div>
          <div className="flex-1 min-w-[200px] flex flex-col gap-1">
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{stage.name}</p>
            <p className="text-xs" style={{ color: 'var(--color-text)' }}><GlossText text={stage.what} /></p>
            <p className="text-xs" style={{ color: 'var(--color-text)' }}><strong>Tip:</strong> <GlossText text={stage.tip} /></p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Fingers used: {fingerWords(stage).toLowerCase()}. In {chord} the root note is on the {STRING_NAMES[bass.string]} string{bass.fret ? ` (fret ${bass.fret})` : ' (open)'} and the other bass note is on the {STRING_NAMES[alt.string]} string{alt.fret ? ` (fret ${alt.fret})` : ' (open)'}.
            </p>
          </div>
        </div>

        {/* The tab: high e on top. A column lights up as its slot sounds. */}
        <div className="overflow-x-auto">
          <div className="inline-grid font-mono text-xs gap-y-0.5" style={{ gridTemplateColumns: `1.5rem repeat(${SLOTS}, 2.4rem)`, color: 'var(--color-text)' }}
            role="img" aria-label={`Tab for ${chord}, ${stage.name}: ${fingerLine(stage)}`}>
            {[5, 4, 3, 2, 1, 0].map(s => (
              <React.Fragment key={s}>
                <span style={{ color: 'var(--color-muted)' }}>{TAB_NAMES[5 - s]}</span>
                {bar.map(col => {
                  const hit = col.notes.find(n => n.string === s);
                  const on = running && !counting && position.slot === col.slot;
                  return (
                    <span key={col.slot} className="text-center rounded transition-colors duration-200"
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        background: on ? (hit ? 'var(--color-primary)' : 'var(--color-border)') : 'transparent',
                        color: on && hit ? 'var(--color-on-primary, #fff)' : hit ? 'var(--color-primary)' : 'var(--color-muted)',
                        fontWeight: hit ? 700 : 400,
                      }}>{hit ? hit.fret : '·'}</span>
                  );
                })}
              </React.Fragment>
            ))}
            <span />
            {bar.map(col => (
              <span key={col.slot} className="text-center" style={{ color: col.slot % 2 === 0 ? 'var(--color-text)' : 'var(--color-muted)', fontWeight: col.slot % 2 === 0 ? 700 : 400 }}>
                {col.notes.length ? [...new Set(col.notes.map(n => n.finger))].join('') : ' '}
              </span>
            ))}
            <span />
            {COUNT_LABELS.map((l, i) => (
              <span key={i} className="text-center" style={{ color: i % 2 === 0 ? 'var(--color-text)' : 'var(--color-muted)', fontWeight: i % 2 === 0 ? 700 : 400 }}>{l}</span>
            ))}
          </div>
        </div>
        <p className="text-sm min-h-[1.25rem]" style={{ color: 'var(--color-text)' }} aria-live="polite">
          {counting ? 'Get ready: one bar of clicks, then pick.' : running ? `Bar ${position.bar}` : ''}
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          <Tooltip text={running ? GT.pickStop : GT.pickPlay}>
            <button onClick={running ? stop : start} className="px-4 py-2 text-sm rounded-lg font-medium hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>
              {running ? 'Stop' : 'Start'}
            </button>
          </Tooltip>
          <Tooltip text={GT.strumSlower}>
            <button className={small} style={btnLine} aria-label="Slower" onClick={() => changeBpm(bpm - 5)}>−</button>
          </Tooltip>
          <Tooltip text={GT.pickTempo}>
            <input type="range" min={40} max={120} step={1} value={bpm} aria-label="Tempo in beats a minute" onChange={e => changeBpm(parseInt(e.target.value, 10))} />
          </Tooltip>
          <Tooltip text={GT.strumFaster}>
            <button className={small} style={btnLine} aria-label="Faster" onClick={() => changeBpm(bpm + 5)}>+</button>
          </Tooltip>
          <span className="text-sm font-mono w-20" style={{ color: 'var(--color-text)' }}>{bpm} bpm</span>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <Tooltip text={GT.strumClick}>
            <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={clickOn} onChange={e => setClickOn(e.target.checked)} /> Click on the beat
            </label>
          </Tooltip>
          <Tooltip text={GT.pickSound}>
            <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={soundOn} onChange={e => setSoundOn(e.target.checked)} /> Hear the notes
            </label>
          </Tooltip>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Tooltip text={GT.pickEasier}><button className={small} style={btnLine} disabled={index === 0} onClick={() => setStageId(STAGES[index - 1].id)}>Easier step</button></Tooltip>
        <Tooltip text={GT.pickHarder}><button className={small} style={btnLine} disabled={index >= STAGES.length - 1} onClick={() => setStageId(STAGES[index + 1].id)}>Harder step</button></Tooltip>
        <Tooltip text={GT.pickComfy}>
          <button className={small} style={comfy.includes(stageId) ? { ...btnPrimary, borderColor: 'var(--color-primary)' } : btnLine} aria-pressed={comfy.includes(stageId)} onClick={toggleComfy}>
            {comfy.includes(stageId) ? 'Comfortable ✓' : 'This feels comfortable'}
          </button>
        </Tooltip>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        Vault cannot hear you pluck, so you decide when a step is comfortable. The tab shows which string and fret each note is on, with the finger under it.
      </p>
    </section>
  );
}
