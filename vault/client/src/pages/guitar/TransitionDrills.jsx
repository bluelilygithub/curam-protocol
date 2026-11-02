import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { suggestProgressions, explainPair, pairSummary } from './progressions.mjs';
import { GlossText } from './GlossaryTerm';
import FingerMoves from './FingerMoves';
import MajorMinorPairs from './MajorMinorPairs';
import BarreLadder from './BarreLadder';
import { describeChange } from './fingering.mjs';

const DRILL_SECONDS = 60;
const COUNTDOWN_SECONDS = 3;
const SHOWN_AT_FIRST = 4;

const loopText = (chords) => `${chords.join(' → ')} → back to ${chords[0]}`;

/**
 * The one-minute drill. Choose what to practise (just the two chords, or a progression that goes between them), then go round it for a
 * minute tapping each clean change. The score is saved against the pair at the end.
 */
function DrillRunner({ pair, best: bestNow, known, onClose, onSaved }) {
  const addToast = useToastStore(s => s.addToast);
  const ideas = useMemo(() => suggestProgressions(pair.a, pair.b, known), [pair.a, pair.b, known]);
  const [choice, setChoice] = useState('pair');            // 'pair' or a suggestion id
  const [showAll, setShowAll] = useState(false);
  const [showFingers, setShowFingers] = useState(true);
  const [phase, setPhase] = useState('ready');             // ready | countdown | running | saved
  const [left, setLeft] = useState(DRILL_SECONDS);
  const [count, setCount] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const countRef = useRef(0);
  const timerRef = useRef(null);
  // The best before this minute started: the list refreshes the moment the score is saved, so comparing with the live value would always say "level"
  const bestBefore = useRef(bestNow);
  const best = phase === 'ready' ? bestNow : bestBefore.current;

  const picked = ideas.items.find(i => i.id === choice) || null;
  const sequence = picked ? picked.chords : [pair.a, pair.b];

  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  useEffect(() => stopTimer, []);

  const finish = useCallback(async () => {
    stopTimer();
    const changes = countRef.current;
    setPhase('saved');
    try {
      const body = { a: pair.a, b: pair.b, changes, seconds: DRILL_SECONDS };
      if (sequence.length > 2 || sequence.join() !== [pair.a, pair.b].join()) body.progression = sequence;
      const res = await api.post('/api/guitar/transitions/score', body);
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(changes);
    } catch (e) { addToast(e.message, 'error'); }
  }, [pair.a, pair.b, sequence, onSaved, addToast]);

  const start = () => {
    bestBefore.current = bestNow;
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

  const n = sequence.length;
  const from = sequence[count % n];
  const target = sequence[(count + 1) % n];
  const beat = best != null && count > best;
  const hintFor = useMemo(() => Object.fromEntries(sequence.map((c, i) => [`${c}>${sequence[(i + 1) % sequence.length]}`, describeChange(c, sequence[(i + 1) % sequence.length])])), [sequence]);
  const step = hintFor[`${from}>${target}`];
  const hint = step && step.ok ? step.hint : '';
  const shown = showAll ? ideas.items : ideas.items.slice(0, SHOWN_AT_FIRST);
  const why = explainPair(pair.a, pair.b);

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
            Choose what to practise for the minute. Tap the big button (or press Space) each time you land the next chord cleanly.
            {best != null ? ` Your best for this pair is ${best} a minute.` : ''}
          </p>

          <div className="flex flex-col gap-2" role="radiogroup" aria-label="What to practise">
            <Tooltip text={GT.drillJustPair}>
              <button type="button" role="radio" aria-checked={choice === 'pair'} onClick={() => setChoice('pair')}
                className="text-left rounded-lg border px-3 py-2 hover:opacity-70 transition-opacity duration-200"
                style={{ borderColor: choice === 'pair' ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
                <span className="text-sm font-medium">Just {pair.a} and {pair.b}</span>
                <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>Back and forth: {pair.a} → {pair.b} → back to {pair.a}.</span>
              </button>
            </Tooltip>
          </div>

          {ideas.items.length > 0 ? (
            <>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                Or get from {pair.a} to {pair.b} through other chords
              </p>
              {why && <p className="text-xs" style={{ color: 'var(--color-muted)' }}><GlossText text={`${why} These are well-known progressions in that key that contain both chords.`} /></p>}
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Progressions between the two chords">
                {shown.map(i => (
                  <Tooltip text={GT.drillProgression} key={i.id}>
                    <button type="button" role="radio" aria-checked={choice === i.id} onClick={() => setChoice(i.id)}
                      className="text-left rounded-lg border px-3 py-2 hover:opacity-70 transition-opacity duration-200"
                      style={{ borderColor: choice === i.id ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
                      <span className="text-sm font-mono font-semibold">{loopText(i.chords)}</span>
                      <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                        {i.name}, {i.numerals} in {i.key}.{' '}
                        {i.newChords.length === 0 ? 'You can play all of these.' : `New to learn: ${i.newChords.join(', ')}.`}
                      </span>
                    </button>
                  </Tooltip>
                ))}
              </div>
              {ideas.items.length > SHOWN_AT_FIRST && (
                <Tooltip text={GT.drillMore}>
                  <button onClick={() => setShowAll(s => !s)} className="text-xs px-2.5 py-1 rounded-lg border self-start hover:opacity-70 transition-opacity duration-200"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    {showAll ? 'Show fewer ideas' : `Show ${ideas.items.length - SHOWN_AT_FIRST} more ideas`}
                  </button>
                </Tooltip>
              )}
            </>
          ) : (
            ideas.reason && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{ideas.reason}</p>
          )}

          <Tooltip text={GT.fingerShow}>
            <button onClick={() => setShowFingers(s => !s)} aria-expanded={showFingers}
              className="text-xs px-2.5 py-1 rounded-lg border self-start hover:opacity-70 transition-opacity duration-200" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              {showFingers ? 'Hide finger moves' : 'Show finger moves for this practice'}
            </button>
          </Tooltip>
          {showFingers && <FingerMoves sequence={sequence} />}

          <Tooltip text={GT.startMinute}>
            <button onClick={start} className="px-4 py-2 text-sm rounded-lg font-medium hover:opacity-70 transition-opacity duration-200 self-start"
              style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>Start the minute</button>
          </Tooltip>
        </>
      )}

      {phase === 'countdown' && (
        <>
          <p className="text-center font-bold" style={{ fontSize: '4rem', color: 'var(--color-primary)' }} aria-live="polite">{countdown}</p>
          <p className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>Get your fingers on {sequence[0]}. Going round: {loopText(sequence)}.</p>
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
          {n > 2 && (
            <div className="flex items-center gap-1 justify-center flex-wrap" aria-hidden="true">
              {sequence.map((c, i) => (
                <span key={i} className="text-xs font-mono px-2 py-0.5 rounded"
                  style={{ background: i === (count + 1) % n ? 'var(--color-primary)' : 'transparent', color: i === (count + 1) % n ? 'var(--color-on-primary, #fff)' : 'var(--color-muted)', border: '1px solid var(--color-border)' }}>{c}</span>
              ))}
            </div>
          )}
          <Tooltip text={GT.countChange}>
            <button onClick={tap} aria-label={`Count a clean change to ${target}`}
              className="rounded-xl py-8 flex flex-col items-center gap-1 hover:opacity-70 transition-opacity duration-200"
              style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
              <span className="text-xs opacity-80">{from} to</span>
              <span className="font-bold" style={{ fontSize: '2.5rem', lineHeight: 1 }}>{target}</span>
              <span className="font-mono text-lg" aria-live="off">{count}{beat ? ' · new best' : ''}</span>
            </button>
          </Tooltip>
          {hint && <p className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>{from} to {target}: {hint}</p>}
          <Tooltip text={GT.stopDrill}>
            <button onClick={cancel} className="text-xs px-2 py-1 rounded border self-center hover:opacity-70 transition-opacity duration-200"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Stop without saving</button>
          </Tooltip>
        </>
      )}

      {phase === 'saved' && (
        <>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            <strong>{count}</strong> clean changes in a minute{n > 2 ? `, going round ${sequence.join(' → ')}` : ''}.
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
export default function TransitionDrills({ initialPair, onChanged, onOpenEar }) {
  const [rows, setRows] = useState(null);
  const [pair, setPair] = useState(initialPair || null);
  const [known, setKnown] = useState(() => new Set());
  const [savedTick, setSavedTick] = useState(0);   // bumps when a score is saved, so the pairs card shows the new best

  const load = useCallback(() => {
    api.get('/api/guitar/transitions').then(r => r.json()).then(d => setRows(Array.isArray(d) ? d : [])).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (initialPair) setPair(initialPair); }, [initialPair]);
  // The chords you have ticked as playable, so a suggestion can say which chords are new to you
  useEffect(() => {
    api.get('/api/guitar-play/my-chords').then(r => r.json()).then(d => setKnown(new Set(Array.isArray(d.known) ? d.known : []))).catch(() => {});
  }, []);

  if (!rows) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  const best = pair ? rows.find(r => r.a === pair.a && r.b === pair.b)?.bestRate ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        These are the chord changes your own songs ask for most, with the ones you are slowest at first. Press Drill to practise a change for a minute,
        either just the two chords or a progression that goes between them through other chords. At 30 clean changes in a minute a pair drops out of Today.
      </p>
      {pair && (
        <DrillRunner key={`${pair.a}|${pair.b}`} pair={pair} best={best} known={known} onClose={() => setPair(null)}
          onSaved={() => { load(); setSavedTick(t => t + 1); onChanged?.(); }} />
      )}
      <MajorMinorPairs onDrill={setPair} onOpenEar={onOpenEar} refreshKey={savedTick} />
      <BarreLadder />
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
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{pairSummary(r)}</p>
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
