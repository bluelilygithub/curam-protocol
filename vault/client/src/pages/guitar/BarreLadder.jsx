import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import ChordDiagram from './ChordDiagram';
import { GlossText } from './GlossaryTerm';
import { GT } from './guitarTips.mjs';
import { STAGES, HOLD_SECONDS, CLEAR_AT, ladder, slideStep } from './barreStages.mjs';
import { STRING_NAMES } from './fingering.mjs';

const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const btnPrimary = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
const btnLine = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };

/**
 * The barre chord ladder: five rungs from two strings pressed flat up to sliding a full barre chord along the neck. A rung is cleared by
 * holding the shape for ten seconds with every string ringing, three times. Holds are saved; stopping early saves nothing.
 */
export default function BarreLadder() {
  const addToast = useToastStore(s => s.addToast);
  const [data, setData] = useState(null);                // { stages: { id: { clean, total, cleared } } }
  const [selected, setSelected] = useState(null);
  const [phase, setPhase] = useState('ready');           // ready | holding | judge
  const [left, setLeft] = useState(HOLD_SECONDS);
  const [slideFret, setSlideFret] = useState(1);
  const [message, setMessage] = useState('');
  const timerRef = useRef(null);
  const startedRef = useRef(0);

  const load = useCallback(() => {
    api.get('/api/guitar-play/barre').then(r => r.json()).then(d => setData(d && d.stages ? d : { stages: {} })).catch(() => setData({ stages: {} }));
  }, []);
  useEffect(() => { load(); }, [load]);
  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  useEffect(() => stopTimer, []);

  // The ladder from the saved holds: stageStatus works on a list of holds, so rebuild one from the counts
  const rungs = useMemo(() => {
    const holds = [];
    for (const [stage, s] of Object.entries(data?.stages || {})) {
      for (let i = 0; i < s.clean; i++) holds.push({ stage, clean: true });
      for (let i = 0; i < s.total - s.clean; i++) holds.push({ stage, clean: false });
    }
    return ladder(holds);
  }, [data]);

  if (!data) return null;
  const nextRung = rungs.find(r => r.next);
  const current = STAGES.find(s => s.id === (selected || nextRung?.stage.id)) || STAGES[0];
  const status = rungs.find(r => r.stage.id === current.id).status;
  const slide = current.slide ? slideStep(slideFret) : null;
  const shape = slide ? slide.shape : current.shape;
  const chord = slide ? slide.chord : current.chord;

  const choose = (id) => { if (phase === 'holding') return; setSelected(id); setPhase('ready'); setMessage(''); };

  const startHold = () => {
    setMessage('');
    setPhase('holding');
    setLeft(HOLD_SECONDS);
    startedRef.current = Date.now();
    stopTimer();
    timerRef.current = setInterval(() => {
      const remaining = HOLD_SECONDS - (Date.now() - startedRef.current) / 1000;
      if (remaining <= 0) { stopTimer(); setLeft(0); setPhase('judge'); } else setLeft(remaining);
    }, 100);
  };
  const stopHold = () => { stopTimer(); setPhase('ready'); setLeft(HOLD_SECONDS); };

  const judge = async (clean) => {
    setPhase('ready');
    setLeft(HOLD_SECONDS);
    const wasCleared = status.cleared;
    try {
      const res = await api.post('/api/guitar-play/barre/holds', { stage: current.id, clean, seconds: HOLD_SECONDS });
      if (!res.ok) throw new Error((await res.json()).error);
      const after = clean ? status.clean + 1 : status.clean;
      if (clean && after >= CLEAR_AT && !wasCleared) {
        const idx = STAGES.findIndex(s => s.id === current.id);
        const nextStage = STAGES[idx + 1];
        setMessage(`Step cleared: ${current.name}.${nextStage ? ` Next up: ${nextStage.name}.` : ' That is the whole ladder.'}`);
        if (nextStage) setSelected(nextStage.id);
      } else if (clean) {
        setMessage(`A clean hold. ${Math.max(0, CLEAR_AT - after)} more to clear this step.`);
      } else {
        setMessage('Not clean this time, and that is normal. Pluck each string one at a time to find the one that buzzes, then adjust that finger and try again.');
      }
      load();
    } catch (e) { addToast(e.message, 'error'); }
  };

  return (
    <section className="rounded-xl border p-4 flex flex-col gap-3" style={card} data-tour="guitar-barre">
      <div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Barre chord ladder</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          <GlossText text={`A barre chord is the hardest early step, so it is taken in small steps: two strings, four, then all six, then a new shape, then sliding it along the neck. To clear a step, hold the shape for ${HOLD_SECONDS} seconds with every string ringing, ${CLEAR_AT} times.`} />
        </p>
      </div>

      <div className="flex flex-col gap-1" role="radiogroup" aria-label="Steps of the barre chord ladder">
        {rungs.map(({ stage, status: st, next }, i) => (
          <Tooltip text={GT.barreRung} key={stage.id}>
            <button type="button" role="radio" aria-checked={current.id === stage.id} onClick={() => choose(stage.id)}
              className="w-full text-left text-sm px-3 py-2 rounded-lg border flex items-center gap-2 hover:opacity-70 transition-opacity duration-200"
              style={current.id === stage.id ? { borderColor: 'var(--color-primary)', color: 'var(--color-text)' } : btnLine}>
              <span className="font-mono text-xs" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
              <span className="flex-1">{stage.name}</span>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {st.cleared ? 'Cleared ✓' : next ? `Next up · ${st.clean} of ${CLEAR_AT} clean holds` : `${st.clean} of ${CLEAR_AT} clean holds`}
              </span>
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="rounded-lg border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex flex-col items-center">
            <span className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{chord}</span>
            <ChordDiagram shape={shape} />
          </div>
          <div className="flex-1 min-w-[200px] flex flex-col gap-1">
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{current.name}</p>
            <p className="text-xs" style={{ color: 'var(--color-text)' }}><GlossText text={current.what} /></p>
            <p className="text-xs" style={{ color: 'var(--color-text)' }}><strong>Tip:</strong> <GlossText text={current.tip} /></p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Strings that must ring: {current.check.map(s => STRING_NAMES[s]).join(', ')}.
            </p>
          </div>
        </div>

        {slide && (
          <div className="flex items-center gap-2 flex-wrap">
            <Tooltip text={GT.barreSlideDown}>
              <button onClick={() => setSlideFret(f => Math.max(1, f - 1))} disabled={slideFret <= 1 || phase === 'holding'}
                className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200 disabled:opacity-40" style={btnLine}>Down a fret</button>
            </Tooltip>
            <span className="text-sm font-mono" style={{ color: 'var(--color-text)' }}>{slide.chord}, fret {slide.fret}</span>
            <Tooltip text={GT.barreSlideUp}>
              <button onClick={() => setSlideFret(f => Math.min(5, f + 1))} disabled={slideFret >= 5 || phase === 'holding'}
                className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200 disabled:opacity-40" style={btnLine}>Up a fret</button>
            </Tooltip>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap" aria-live="polite">
          {phase === 'ready' && (
            <Tooltip text={GT.barreStart}>
              <button onClick={startHold} className="text-sm px-4 py-2 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>
                Start a {HOLD_SECONDS}-second hold
              </button>
            </Tooltip>
          )}
          {phase === 'holding' && (
            <>
              <div className="flex flex-col gap-1 min-w-[160px]">
                <span className="text-2xl font-semibold font-mono" style={{ color: 'var(--color-text)' }}>{Math.ceil(left)}</span>
                <div className="h-1.5 rounded" style={{ background: 'var(--color-border)' }} aria-hidden="true">
                  <div className="h-1.5 rounded" style={{ width: `${Math.min(100, ((HOLD_SECONDS - left) / HOLD_SECONDS) * 100)}%`, background: 'var(--color-primary)' }} />
                </div>
              </div>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Hold the shape and keep breathing.</span>
              <Tooltip text={GT.barreStop}>
                <button onClick={stopHold} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={btnLine}>Stop (nothing is saved)</button>
              </Tooltip>
            </>
          )}
          {phase === 'judge' && (
            <>
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>Did every string ring clean?</span>
              <Tooltip text={GT.barreClean}>
                <button onClick={() => judge(true)} className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>Yes, every string rang</button>
              </Tooltip>
              <Tooltip text={GT.barreBuzz}>
                <button onClick={() => judge(false)} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={btnLine}>No, something buzzed</button>
              </Tooltip>
            </>
          )}
        </div>
        {message && <p className="text-xs" style={{ color: 'var(--color-text)' }}>{message}</p>}
        {!message && status.total > 0 && phase === 'ready' && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{status.clean} clean of {status.total} {status.total === 1 ? 'hold' : 'holds'} on this step.</p>
        )}
      </div>
    </section>
  );
}
