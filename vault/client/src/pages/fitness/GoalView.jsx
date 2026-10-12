import React, { useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import { Card, Notice, PrimaryButton, SecondaryButton, formatDate } from './ui';
import AerobicChart from './AerobicChart';

const fmt1 = (n) => Number(n).toFixed(1);

// Short column names so all ten columns fit; the full names are in the tour and the info modal.
const SHORT = { cardio: 'Cardio', strength: 'Strength', flexibility: 'Flexibility', balance: 'Balance' };

function Milestones({ plan, meta, onAddMinutes }) {
  const cell = 'py-2 pr-3';
  const num = 'py-2 pr-3 tabular-nums';
  const text = { color: 'var(--color-text)' };
  const muted = { color: 'var(--color-muted)' };
  const entered = plan.now.minutesSource === 'entered';
  const group = 'pb-1 pr-3 text-xs font-medium border-b';
  return (
    // Scrolls inside its box on a narrow screen instead of being clipped; tabIndex lets the keyboard scroll it.
    <div className="overflow-x-auto scroll-x-obvious" data-tour="fitness-milestones" tabIndex={0} role="region" aria-label="Five year targets">
      <table className="w-full text-sm" style={{ ...text, minWidth: 720 }}>
        <thead>
          <tr className="text-left" style={muted}>
            <th rowSpan={2} className="pr-3 align-bottom text-xs font-medium">Year</th>
            <th rowSpan={2} className="pr-3 align-bottom text-xs font-medium">Focus</th>
            <th className={group} style={{ borderColor: 'var(--color-border)' }}>Aerobic</th>
            <th colSpan={3} className={group} style={{ borderColor: 'var(--color-border)' }}>Days per week</th>
            <th colSpan={4} className={group} style={{ borderColor: 'var(--color-border)' }}>Expected rating (1-5)</th>
          </tr>
          <tr className="text-left text-xs" style={muted}>
            <th className="py-1 pr-3 font-medium">min / week</th>
            <th className="py-1 pr-3 font-medium">Strength</th>
            <th className="py-1 pr-3 font-medium">Balance</th>
            <th className="py-1 pr-3 font-medium">Mobility</th>
            {meta.domains.map((d) => <th key={d.id} className="py-1 pr-3 font-medium">{SHORT[d.id] || d.label}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <td className={`${cell} font-medium`}>Now<span className="block text-xs font-normal" style={muted}>today</span></td>
            <td className={cell} style={muted}>Where you are</td>
            <td className={num}>
              {entered
                ? plan.now.aerobicModerateMin
                : (
                  <span style={muted}>
                    not entered
                    {onAddMinutes && (
                      <>
                        {' '}
                        <button type="button" onClick={onAddMinutes} className="underline hover:opacity-60 transition-opacity duration-200" style={text}>add</button>
                      </>
                    )}
                  </span>
                )}
            </td>
            <td className={cell} style={muted}>-</td>
            <td className={cell} style={muted}>-</td>
            <td className={cell} style={muted}>-</td>
            {meta.domains.map((d) => <td key={d.id} className={num}>{plan.now.ratings[d.id]}</td>)}
          </tr>
          {plan.milestones.map((m) => (
            <tr key={m.year} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
              <td className={`${cell} font-medium`}>Year {m.year}<span className="block text-xs font-normal" style={muted}>by {formatDate(m.by)}</span></td>
              <td className={cell}>{m.phase?.label}<span className="block text-xs" style={muted}>{m.phase?.focus}</span></td>
              <td className={num}>{m.weekly.aerobicModerateMin}</td>
              <td className={num}>{m.weekly.strengthDays}</td>
              <td className={num}>{m.weekly.balanceDays}</td>
              <td className={num}>{m.weekly.mobilityDays}</td>
              {meta.domains.map((d) => <td key={d.id} className={num}>{fmt1(m.ratings[d.id])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs leading-relaxed mt-3" style={muted}>
        Strength, balance and mobility days can be combined in the same session.
        Ratings are your expected level at the end of each year on the 1-5 scale; a decimal means partway between two levels.{' '}
        {entered
          ? "Today's aerobic minutes are what you told us."
          : 'You have not entered your weekly exercise minutes, so year one is based on your cardio rating. Add them in Profile for a more accurate starting point.'}
      </p>
    </div>
  );
}

/**
 * The 5-year goal. First time: propose and accept. Later ("revisit"): the same screen starting from the active
 * goal, and accepting replaces it (the old one stays in history). The dial is five labelled steps; every change
 * re-previews the plan and explains what moved, with nothing saved until "Use this goal".
 */
export default function GoalView({ meta, state, mode = 'first', onSaved, onCancel, onAddMinutes }) {
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const committed = state.goal?.ambition ?? meta.defaultAmbition;
  const [ambition, setAmbition] = useState(committed);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    const t = setTimeout(async () => {
      try {
        const r = await api.post('/api/fitness/goal/preview', { ambition, fromAmbition: committed });
        const d = await r.json();
        if (mine !== seq.current) return;
        if (!r.ok) throw new Error(d.error || 'Could not build the plan');
        setPlan(d.plan);
      } catch (err) {
        if (mine === seq.current) setError(err.message);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, plan ? 350 : 0);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambition]);

  const accept = async () => {
    startProcessing('Saving your goal…');
    try {
      const r = await api.post('/api/fitness/goal', { ambition });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save your goal');
      addToast(mode === 'first' ? 'Goal saved' : 'Goal updated. Your earlier goal is kept in history.', 'success');
      onSaved(d);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const unchanged = mode === 'revisit' && ambition === committed;

  return (
    <div className="space-y-5">
      <Card
        title={mode === 'first' ? 'Your 5-year goal' : 'Revisit your 5-year goal'}
        hint="Pick the pace that feels right. You can change it later, as often as you like."
      >
        <div role="radiogroup" aria-label="How ambitious" className="grid gap-2 sm:grid-cols-5" data-tour="fitness-pace">
          {meta.ambitions.map((a) => {
            const active = ambition === a.level;
            return (
              <button
                key={a.level}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setAmbition(a.level)}
                className="rounded-xl border p-3 text-left hover:opacity-70 transition-all duration-200"
                style={{
                  // Neutral on purpose: the theme accent sits too close to the amber "partly done" status colour.
                  borderColor: active ? 'var(--color-text)' : 'var(--color-border)',
                  background: active ? 'var(--color-text)' : 'var(--color-bg)',
                  color: active ? 'var(--color-bg)' : 'var(--color-text)',
                }}
              >
                <span className="block text-sm font-semibold">{a.label}{a.level === committed ? (mode === 'first' ? ' (suggested)' : ' (current)') : ''}</span>
                <span className="block text-xs mt-1 leading-snug" style={{ opacity: active ? 0.9 : 0.7 }}>{a.blurb}</span>
              </button>
            );
          })}
        </div>
        {error && <Notice>{error}</Notice>}
        {loading && !plan && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Preparing your plan…</p>}
      </Card>

      {plan && (
        <>
          <Card title="The shape of the five years">
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)', opacity: loading ? 0.5 : 1 }}>{plan.summary}</p>
            {plan.whatChanged && (
              <Notice><strong>What changes:</strong> {plan.whatChanged}</Notice>
            )}
            <Milestones plan={plan} meta={meta} onAddMinutes={onAddMinutes} />
            <AerobicChart plan={plan} />
            <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
              Easier weeks are built in along the way, and rest is part of the plan.
            </p>
            {plan.aiNote && <Notice>{plan.aiNote}</Notice>}
          </Card>

          <div className="flex items-center gap-2">
            {onCancel && <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>}
            <div className="flex-1" />
            <PrimaryButton onClick={accept} disabled={loading || unchanged}>
              {mode === 'first' ? 'Use this goal' : unchanged ? 'No change yet' : 'Update my goal'}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  );
}
