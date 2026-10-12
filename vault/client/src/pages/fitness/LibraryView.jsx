import React, { useEffect, useMemo, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import { Card, Chip, FIELD, inputCls, Notice, SecondaryButton } from './ui';

const PATTERN_LABELS = {
  squat: 'Squat', hinge: 'Hinge', lunge: 'Lunge', push: 'Push', pull: 'Pull', core: 'Core', carry: 'Carry',
  cardio: 'Cardio', balance: 'Balance', mobility: 'Mobility',
};
const SETTING_LABELS = { gym: 'Gym', pool: 'Pool', outdoor: 'Outdoors', home: 'Home' };
const LEVEL_LABELS = ['', 'Gentle', 'Moderate', 'Challenging', 'Advanced'];

function Detail({ slug, onOpen, onBack }) {
  const getIcon = useIcon();
  const [ex, setEx] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setEx(null);
    api.get(`/api/fitness/library/${encodeURIComponent(slug)}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Not found'); if (live) setEx(d); })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [slug]);

  if (error) return <Notice>{error}</Notice>;
  if (!ex) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;

  return (
    <div className="max-w-3xl mx-auto w-full space-y-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
        {getIcon('arrow-left', { size: 14 })}All exercises
      </button>
      <Card>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{ex.name}</h2>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            {PATTERN_LABELS[ex.pattern]} · {LEVEL_LABELS[ex.level]} · {ex.equipment} · {ex.settings.map((s) => SETTING_LABELS[s]).join(', ')}
          </p>
        </div>
        {!ex.available && <Notice>You did not list the equipment this needs, so it will not appear in your weekly program. You can still read how it is done.</Notice>}
        {ex.safety && <Notice tone="care">{ex.safety}</Notice>}
        <section>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>How to do it</h3>
          <ol className="list-decimal pl-5 space-y-1.5 text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
            {ex.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </section>
        <section>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Common mistakes</h3>
          <ul className="space-y-2 text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
            {ex.mistakes.map((m) => (
              <li key={m.mistake}><strong>{m.mistake}.</strong> <span style={{ color: 'var(--color-muted)' }}>{m.fix}</span></li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Why form matters</h3>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>{ex.whyFormMatters}</p>
        </section>
        <section>
          <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>How much</h3>
          <dl className="text-sm grid grid-cols-[auto,1fr] gap-x-4 gap-y-1" style={{ color: 'var(--color-text)' }}>
            {['beginner', 'intermediate', 'advanced'].map((l) => (
              <React.Fragment key={l}>
                <dt style={{ color: 'var(--color-muted)' }} className="capitalize">{l}</dt>
                <dd>{ex.dosage[l]}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
        {(ex.easier.length > 0 || ex.harder.length > 0) && (
          <section>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Easier and harder versions</h3>
            <div className="flex flex-wrap gap-2">
              {ex.easier.map((x) => <Chip key={x.slug} onClick={() => onOpen(x.slug)}>Easier: {x.name}</Chip>)}
              {ex.harder.map((x) => <Chip key={x.slug} onClick={() => onOpen(x.slug)}>Harder: {x.name}</Chip>)}
            </div>
          </section>
        )}
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Stop and rest if something hurts, you feel dizzy, or you notice chest symptoms. See your GP if it does not settle.
        </p>
      </Card>
    </div>
  );
}

/** Browse every exercise. Defaults to what you can do with the equipment you listed. */
export default function LibraryView({ slug, onOpen, onBack }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [pattern, setPattern] = useState('');
  const [setting, setSetting] = useState('');
  const [mineOnly, setMineOnly] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/fitness/library').then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setData(d); }).catch((e) => setError(e.message));
  }, []);

  const list = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.exercises
      .filter((e) => (!needle || e.name.toLowerCase().includes(needle)))
      .filter((e) => !pattern || e.pattern === pattern)
      .filter((e) => !setting || e.settings.includes(setting))
      .filter((e) => !mineOnly || e.available);
  }, [data, q, pattern, setting, mineOnly]);

  if (slug) return <Detail slug={slug} onOpen={onOpen} onBack={onBack} />;
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;

  return (
    <div className="max-w-4xl mx-auto w-full space-y-4" data-tour="fitness-library-list">
      <Card title="Exercise library" hint="Every exercise in your program comes from here, with how to do it properly and why form matters.">
        <div className="grid gap-3 sm:grid-cols-3">
          <input className={inputCls} style={FIELD} placeholder="Search" aria-label="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className={inputCls} style={FIELD} aria-label="Movement" value={pattern} onChange={(e) => setPattern(e.target.value)}>
            <option value="">All movements</option>
            {data.patterns.map((p) => <option key={p} value={p}>{PATTERN_LABELS[p]}</option>)}
          </select>
          <select className={inputCls} style={FIELD} aria-label="Where" value={setting} onChange={(e) => setSetting(e.target.value)}>
            <option value="">Anywhere</option>
            {data.settings.map((s) => <option key={s} value={s}>{SETTING_LABELS[s]}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          Only what I can do with my equipment
        </label>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{list.length} exercise{list.length === 1 ? '' : 's'}</p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((e) => (
          <button
            key={e.slug}
            type="button"
            onClick={() => onOpen(e.slug)}
            className="rounded-2xl border p-4 text-left hover:opacity-70 transition-all duration-200"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <span className="block text-sm font-medium">{e.name}</span>
            <span className="block text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              {PATTERN_LABELS[e.pattern]} · {LEVEL_LABELS[e.level]} · {e.equipment}
            </span>
          </button>
        ))}
      </div>
      {!list.length && <Notice>Nothing matches. Try clearing the filters{mineOnly ? ' or untick the equipment box' : ''}.</Notice>}
      {(q || pattern || setting) && <SecondaryButton onClick={() => { setQ(''); setPattern(''); setSetting(''); }}>Clear filters</SecondaryButton>}
    </div>
  );
}
