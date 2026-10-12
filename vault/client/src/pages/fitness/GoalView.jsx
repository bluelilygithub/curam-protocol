import React, { useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import { Card, Notice, PrimaryButton, SecondaryButton, formatDate } from './ui';

/** Compact "3 → 4" text for a rating change; plain numbers so it never relies on colour. */
function RatingCell({ now, then }) {
  return <span>{then === now ? `${now}` : `${then} → ${now}`}</span>;
}

function Milestones({ plan, meta, startScores }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ color: 'var(--color-text)' }}>
        <thead>
          <tr className="text-left text-xs" style={{ color: 'var(--color-muted)' }}>
            <th className="py-2 pr-3 font-medium">Year</th>
            <th className="py-2 pr-3 font-medium">Aerobic / week</th>
            <th className="py-2 pr-3 font-medium">Strength days</th>
            <th className="py-2 pr-3 font-medium">Balance days</th>
            <th className="py-2 pr-3 font-medium">Mobility days</th>
            {meta.domains.map((d) => <th key={d.id} className="py-2 pr-3 font-medium">{d.label} (1-5)</th>)}
          </tr>
        </thead>
        <tbody>
          {plan.milestones.map((m) => (
            <React.Fragment key={m.year}>
              <tr className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="py-2 pr-3 whitespace-nowrap font-medium">Year {m.year}<span className="block text-xs font-normal" style={{ color: 'var(--color-muted)' }}>by {formatDate(m.by)}</span></td>
                <td className="py-2 pr-3 whitespace-nowrap">{m.weekly.aerobicModerateMin} min</td>
                <td className="py-2 pr-3">{m.weekly.strengthDays}</td>
                <td className="py-2 pr-3">{m.weekly.balanceDays}</td>
                <td className="py-2 pr-3">{m.weekly.mobilityDays}</td>
                {meta.domains.map((d) => <td key={d.id} className="py-2 pr-3 whitespace-nowrap"><RatingCell now={m.ratings[d.id]} then={startScores[d.id]} /></td>)}
              </tr>
              {m.note && (
                <tr><td colSpan={5 + meta.domains.length} className="pb-2 text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{m.note}</td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The 5-year goal. First time: propose and accept. Later ("revisit"): the same screen starting from the active
 * goal, and accepting replaces it (the old one stays in history). The dial is five labelled steps; every change
 * re-previews the plan and explains what moved, with nothing saved until "Use this goal".
 */
export default function GoalView({ meta, state, mode = 'first', onSaved, onCancel }) {
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

  const scores = state.rating.scores;
  const unchanged = mode === 'revisit' && ambition === committed;

  return (
    <div className="space-y-5">
      <Card
        title={mode === 'first' ? 'Your 5-year goal' : 'Revisit your 5-year goal'}
        hint="Pick the pace that feels right. You can change it later, as often as you like."
      >
        <div role="radiogroup" aria-label="How ambitious" className="grid gap-2 sm:grid-cols-5">
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
                  borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                  background: active ? 'var(--color-primary)' : 'var(--color-bg)',
                  color: active ? '#fff' : 'var(--color-text)',
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
            <Milestones plan={plan} meta={meta} startScores={scores} />
            <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
              Weekly aerobic minutes are moderate-intensity equivalents. Easier weeks are built in along the way, and rest is part of the plan.
              Ratings are your own 1-5 scale.
            </p>
            {plan.note && <Notice>{plan.note}</Notice>}
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
