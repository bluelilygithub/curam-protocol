import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useProcessingStore from '../../store/processingStore';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import { Card, Notice, PrimaryButton, SecondaryButton } from './ui';

const STATUS = {
  building: { label: 'Room to build', icon: 'trending-up' },
  in_range: { label: 'In the healthy range', icon: 'check' },
  above: { label: 'Above the range', icon: 'check' },
};

/** One row per domain: the 1-5 track, the healthy range shaded, a solid marker for now and a hollow one for before. */
function RangeBars({ rows, meta, beforeLabel }) {
  const getIcon = useIcon();
  const pct = (n) => ((n - 0.5) / 5) * 100;
  return (
    <div className="space-y-4" role="list" aria-label="Where you are compared with the healthy range for your age">
      {rows.map((r) => {
        const label = meta.domains.find((d) => d.id === r.domain)?.label || r.domain;
        const st = STATUS[r.status];
        return (
          <div key={r.domain} role="listitem">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span style={{ color: 'var(--color-text)' }}>{label}</span>
              <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                {getIcon(st.icon, { size: 12 })}{st.label}
              </span>
            </div>
            <div className="relative h-6 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <div
                className="absolute top-0 bottom-0 rounded-md"
                style={{ left: `${pct(r.low)}%`, width: `${pct(r.high + 1) - pct(r.low)}%`, background: 'color-mix(in srgb, var(--color-muted) 22%, transparent)' }}
                aria-hidden="true"
              />
              {r.before != null && (
                <span
                  className="absolute top-1/2 w-3.5 h-3.5 rounded-full border-2"
                  style={{ left: `${pct(r.before)}%`, transform: 'translate(-50%,-50%)', borderColor: 'var(--color-muted)', background: 'var(--color-bg)' }}
                  title={`${beforeLabel || 'Before'}: ${r.before}`}
                />
              )}
              <span
                className="absolute top-1/2 w-4 h-4 rounded-full"
                style={{ left: `${pct(r.now)}%`, transform: 'translate(-50%,-50%)', background: 'var(--color-text)' }}
                title={`Now: ${r.now}`}
              />
            </div>
            <div className="flex justify-between text-[10px] mt-1 px-1" style={{ color: 'var(--color-muted)' }} aria-hidden="true">
              {[1, 2, 3, 4, 5].map((n) => <span key={n}>{n}</span>)}
            </div>
            <p className="sr-only">{`${label}: now ${r.now}${r.before != null ? `, before ${r.before}` : ''}, healthy range ${r.low} to ${r.high}.`}</p>
          </div>
        );
      })}
      <p className="text-xs flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--color-muted)' }}>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1" style={{ background: 'var(--color-text)' }} />Now</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1 border-2" style={{ borderColor: 'var(--color-muted)' }} />{beforeLabel || 'Before'}</span>
        <span><span className="inline-block w-4 h-2.5 rounded align-middle mr-1" style={{ background: 'color-mix(in srgb, var(--color-muted) 22%, transparent)' }} />Healthy range for your age</span>
      </p>
    </div>
  );
}

export default function BaselineView({ meta, state, onContinue, compact = false }) {
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    if (refresh || !compact) startProcessing('Preparing your baseline…', 'Comparing where you are with what is healthy for your age.');
    try {
      const r = await api.post('/api/fitness/baseline', { refresh });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not build your baseline');
      setData(d);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
      setLoading(false);
    }
  }, [addToast, compact, startProcessing, stopProcessing]);

  useEffect(() => { load(false); }, [load, state.rating?.id]);

  if (!data) return loading ? <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Preparing your baseline…</p> : null;
  const n = data.narrative;

  return (
    <div className="space-y-5">
      <div data-tour="fitness-baseline">
      <Card title={n.headline}>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{n.whereYouAre}</p>
        <RangeBars rows={data.data.comparison} meta={meta} beforeLabel={data.data.previousLabel} />
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          These are your own 1-5 ratings. The healthy range is a guide for your age band, not a medical measure.
        </p>
      </Card>
      </div>

      <Card title={`What is healthy for your age (${state.profile.bandLabel})`}>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{n.whereYouShouldBe}</p>
        <h3 className="text-sm font-semibold pt-1" style={{ color: 'var(--color-text)' }}>A week that keeps you well</h3>
        <ul className="list-disc pl-5 space-y-1.5 text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
          {n.weeklyToMaintain.map((w) => <li key={w}>{w}</li>)}
        </ul>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{n.encouragement}</p>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Based on the <a href="https://www.who.int/europe/publications/i/item/9789240014886" target="_blank" rel="noreferrer" className="underline">WHO 2020 physical activity guidelines</a>.
        </p>
      </Card>

      {data.safety?.message && <Notice tone="care">{data.safety.message}</Notice>}
      {data.note && <Notice>{data.note}</Notice>}

      <div className="flex items-center gap-2">
        <SecondaryButton onClick={() => load(true)} disabled={loading}>Rewrite this summary</SecondaryButton>
        <div className="flex-1" />
        {onContinue && <PrimaryButton onClick={onContinue}>Set my 5-year goal</PrimaryButton>}
      </div>
    </div>
  );
}
