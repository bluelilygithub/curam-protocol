import React, { useState, useEffect, useRef, useCallback } from 'react';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';

const DRILL_SECONDS = 60;
const COUNTDOWN_SECONDS = 3;

function ago(iso) {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? 'today' : `${days}d ago`;
}

/** The one-minute drill: switch between two chords, tap for every clean change, the score is saved at the end. */
function DrillRunner({ pair, best, onClose, onSaved }) {
  const addToast = useToastStore(s => s.addToast);
  const [phase, setPhase] = useState('ready');   // ready | countdown | running | saved
  const [left, setLeft] = useState(DRILL_SECONDS);
  const [count, setCount] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const countRef = useRef(0);
  const timerRef = useRef(null);

  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  useEffect(() => stopTimer, []);

  const finish = useCallback(async () => {
    stopTimer();
    const changes = countRef.current;
    setPhase('saved');
    try {
      const res = await api.post('/api/guitar/transitions/score', { a: pair.a, b: pair.b, changes, seconds: DRILL_SECONDS });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(changes);
    } catch (e) { addToast(e.message, 'error'); }
  }, [pair.a, pair.b, onSaved, addToast]);

  const start = () => {
    countRef.current = 0;
    setCount(0);
    setLeft(DRILL_SECONDS);
    setCountdown(COUNTDOWN_SECONDS);
    setPhase('countdown');
    const t0 = performance.now();
    timerRef.current = setInterval(() => {
      const s = (performance.now() - t0) / 1000;
      if (s < COUNTDOWN_SECONDS) { setCountdown(Math.ceil(COUNTDOWN_SECONDS - s)); return; }
      const run = s - COUNTDOWN_SECONDS;
      setPhase('running');
      if (run >= DRILL_SECONDS) { setLeft(0); finish(); return; }
      setLeft(Math.ceil(DRILL_SECONDS - run));
    }, 100);
  };

  const cancel = () => { stopTimer(); setPhase('ready'); };

  const tap = useCallback(() => {
    if (phase !== 'running') return;
    countRef.current += 1;
    setCount(countRef.current);
  }, [phase]);

  // Space also counts a change, so the hands can stay on the guitar and one finger on the keyboard
  useEffect(() => {
    if (phase !== 'running') return undefined;
    const onKey = (e) => { if (e.code === 'Space') { e.preventDefault(); tap(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, tap]);

  const target = count % 2 === 0 ? pair.b : pair.a; // the chord to change to next
  const from = count % 2 === 0 ? pair.a : pair.b;
  const beat = best != null && count > best;

  return (
    <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{pair.a} ↔ {pair.b}</p>
        <Tooltip text={GT.closeDrill}>
          <button onClick={() => { stopTimer(); onClose(); }} className="text-xs px-2 py-1 rounded border hover:opacity-70 transition-opacity duration-200"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Close</button>
        </Tooltip>
      </div>

      {phase === 'ready' && (
        <>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            One minute. Switch between {pair.a} and {pair.b}. Tap the big button (or press Space) each time you land the new chord cleanly.
            {best != null ? ` Your best is ${best} a minute.` : ''}
          </p>
          <Tooltip text={GT.startMinute}>
            <button onClick={start} className="px-4 py-2 text-sm rounded-lg font-medium hover:opacity-70 transition-opacity duration-200 self-start"
              style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>Start the minute</button>
          </Tooltip>
        </>
      )}

      {phase === 'countdown' && (
        <>
          <p className="text-center font-bold" style={{ fontSize: '4rem', color: 'var(--color-primary)' }} aria-live="polite">{countdown}</p>
          <p className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>Get your fingers on {pair.a}.</p>
          <Tooltip text={GT.cancelDrill}>
            <button onClick={cancel} className="text-xs px-2 py-1 rounded border self-center hover:opacity-70 transition-opacity duration-200"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
          </Tooltip>
        </>
      )}

      {phase === 'running' && (
        <>
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-muted)' }}>
            <span>{left}s left</span>
            <span>{best != null ? `Best ${best}` : 'First try'}</span>
          </div>
          <Tooltip text={GT.countChange}>
            <button onClick={tap} aria-label={`Count a clean change to ${target}`}
              className="rounded-xl py-8 flex flex-col items-center gap-1 hover:opacity-70 transition-opacity duration-200"
              style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
              <span className="text-xs opacity-80">{from} to</span>
              <span className="font-bold" style={{ fontSize: '2.5rem', lineHeight: 1 }}>{target}</span>
              <span className="font-mono text-lg" aria-live="off">{count}{beat ? ' · new best' : ''}</span>
            </button>
          </Tooltip>
          <Tooltip text={GT.stopDrill}>
            <button onClick={cancel} className="text-xs px-2 py-1 rounded border self-center hover:opacity-70 transition-opacity duration-200"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Stop without saving</button>
          </Tooltip>
        </>
      )}

      {phase === 'saved' && (
        <>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            <strong>{count}</strong> clean changes in a minute.
            {best == null ? ' That is your first score.' : count > best ? ` New best, up from ${best}.` : count === best ? ' Level with your best.' : ` Your best is ${best}.`}
          </p>
          <Tooltip text={GT.againDrill}>
            <button onClick={() => setPhase('ready')} className="text-xs px-3 py-1.5 rounded-lg border self-start hover:opacity-70 transition-opacity duration-200"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Go again</button>
          </Tooltip>
        </>
      )}
    </div>
  );
}

/** Drills tab: the chord changes your own songs use most, worst first, and the one-minute drill. */
export default function TransitionDrills({ initialPair, onChanged }) {
  const [rows, setRows] = useState(null);
  const [pair, setPair] = useState(initialPair || null);

  const load = useCallback(() => {
    api.get('/api/guitar/transitions').then(r => r.json()).then(d => setRows(Array.isArray(d) ? d : [])).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (initialPair) setPair(initialPair); }, [initialPair]);

  if (!rows) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  const best = pair ? rows.find(r => r.a === pair.a && r.b === pair.b)?.bestRate ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        These are the chord changes your own songs ask for most, with the ones you are slowest at first. Aim for 30 clean changes in a minute,
        then a pair drops out of Today.
      </p>
      {pair && (
        <DrillRunner key={`${pair.a}|${pair.b}`} pair={pair} best={best} onClose={() => setPair(null)}
          onSaved={() => { load(); onChanged?.(); }} />
      )}
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          No repeated chord changes yet. Add songs with chords and the changes they use most will show up here.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(r => (
            <div key={`${r.a}|${r.b}`} className="rounded-xl border p-3 flex items-center gap-3 flex-wrap"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{r.a} ↔ {r.b}</p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {r.count} {r.count === 1 ? 'change' : 'changes'} across {r.songCount} {r.songCount === 1 ? 'song' : 'songs'}
                  {r.lastRate != null
                    ? ` · last ${r.lastRate} a minute (best ${r.bestRate}) · ${ago(r.lastPlayedAt)}`
                    : ' · not drilled yet'}
                </p>
              </div>
              <Tooltip text={GT.drill}>
                <button onClick={() => setPair({ a: r.a, b: r.b })}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200"
                  style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>Drill</button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
