import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/apiClient';
import EmotionWheel from '../components/mood/EmotionWheel';
import CheckinModal from '../components/mood/CheckinModal';
import useToastStore from '../store/toastStore';

const EMOTION_COLOURS = {
  joy: '#C9A84C', trust: '#6B9E70', fear: '#507A60', surprise: '#6B97B5',
  sadness: '#5B6FAD', disgust: '#8A5C8A', anger: '#A85C5C', anticipation: '#C48B3C',
};

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'custom', label: 'Custom' },
];

const ENTITY_TYPE_FILTERS = [
  { id: 'project', label: 'Projects', types: ['project'] },
  { id: 'task', label: 'Tasks', types: ['task'] },
  { id: 'goal', label: 'Goals', types: ['goal', 'key_result'] },
  { id: 'note', label: 'Notes', types: ['note'] },
  { id: 'session', label: 'Sessions', types: ['session'] },
  { id: 'general', label: 'General', types: ['general'] },
];

function getPeriodDates(period, customFrom, customTo) {
  const now = new Date();
  const iso = (d) => d.toISOString();
  switch (period) {
    case 'today': {
      const s = new Date(now); s.setHours(0, 0, 0, 0);
      const e = new Date(now); e.setHours(23, 59, 59, 999);
      return { from: iso(s), to: iso(e) };
    }
    case 'week': {
      const s = new Date(now); s.setDate(s.getDate() - 7); s.setHours(0, 0, 0, 0);
      return { from: iso(s), to: iso(now) };
    }
    case 'month': {
      const s = new Date(now); s.setDate(s.getDate() - 30); s.setHours(0, 0, 0, 0);
      return { from: iso(s), to: iso(now) };
    }
    case 'custom':
      return {
        from: customFrom ? new Date(customFrom).toISOString() : new Date(now.getTime() - 30 * 86400000).toISOString(),
        to: customTo ? new Date(customTo + 'T23:59:59').toISOString() : iso(now),
      };
    default:
      return { from: new Date(now.getTime() - 30 * 86400000).toISOString(), to: iso(now) };
  }
}

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.max(4, (value / max) * 100) : 4;
  return (
    <div className="w-full rounded-full h-2" style={{ background: 'var(--color-border)' }}>
      <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: color || 'var(--color-primary)' }} />
    </div>
  );
}

export default function MoodPage() {
  const addToast = useToastStore(s => s.addToast);
  const [period, setPeriod] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [filterProject, setFilterProject] = useState('');
  const [filterEntityTypes, setFilterEntityTypes] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    api.get('/api/projects').then(r => r.json()).then(setProjects).catch(() => {});
  }, []);

  const resolvedEntityTypes = filterEntityTypes.flatMap(id =>
    ENTITY_TYPE_FILTERS.find(f => f.id === id)?.types || []
  );

  const toggleEntityType = (id) => {
    setFilterEntityTypes(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const loadSummary = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    const { from, to } = getPeriodDates(period, customFrom, customTo);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const params = new URLSearchParams({ from, to, tz });
    if (filterProject) params.set('projectId', filterProject);
    if (resolvedEntityTypes.length > 0) params.set('entityTypes', resolvedEntityTypes.join(','));
    api.get(`/api/mood/summary/overall?${params}`)
      .then(r => r.json())
      .then(d => { setSummary(d.emotions ? d : null); if (!d.emotions) setLoadError(true); })
      .catch(() => { setSummary(null); setLoadError(true); })
      .finally(() => setLoading(false));
  }, [period, customFrom, customTo, filterProject, resolvedEntityTypes.join(',')]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const maxCount = summary
    ? Math.max(...(summary.emotions || []).map(e => e.count), 1)
    : 1;

  // Group dailySeries by date for the mini timeline
  // d.date is already a YYYY-MM-DD string (local date from server)
  const dailyMap = {};
  if (summary?.dailySeries) {
    for (const d of summary.dailySeries) {
      const dateKey = d.date; // "YYYY-MM-DD" — no UTC conversion needed
      if (!dailyMap[dateKey]) dailyMap[dateKey] = [];
      dailyMap[dateKey].push(d);
    }
  }
  const dailyDates = Object.keys(dailyMap).sort();

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>Mood</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>Track how you feel across your work</p>
          </div>
          <button
            onClick={() => setShowCheckinModal(true)}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-primary)' }}
          >
            Log a feeling
          </button>
        </div>

        {/* Quick log panel */}
        {showCheckinModal && (
          <CheckinModal
            entityType="general"
            entityId={null}
            entityTitle="General check-in"
            onClose={() => setShowCheckinModal(false)}
            onSave={() => { setShowCheckinModal(false); loadSummary(); addToast('Feeling logged', 'success'); }}
          />
        )}

        {/* Period tabs */}
        <div className="flex gap-1 rounded-xl p-1 border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: period === p.id ? 'var(--color-primary)' : 'transparent',
                color: period === p.id ? '#fff' : 'var(--color-muted)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>From</label>
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="w-full text-sm px-3 py-1.5 rounded-lg border outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>To</label>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="w-full text-sm px-3 py-1.5 rounded-lg border outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="space-y-3">
          {/* Project filter */}
          {projects.length > 0 && (
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>Project</label>
              <select
                value={filterProject}
                onChange={e => setFilterProject(e.target.value)}
                className="w-full text-sm px-3 py-1.5 rounded-lg border outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="">All projects</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {/* Entity type filter */}
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-muted)' }}>Source</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setFilterEntityTypes([])}
                className="px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
                style={{
                  background: filterEntityTypes.length === 0 ? 'var(--color-primary)' : 'transparent',
                  color: filterEntityTypes.length === 0 ? '#fff' : 'var(--color-muted)',
                  borderColor: filterEntityTypes.length === 0 ? 'var(--color-primary)' : 'var(--color-border)',
                }}
              >
                All
              </button>
              {ENTITY_TYPE_FILTERS.map(et => {
                const active = filterEntityTypes.includes(et.id);
                return (
                  <button
                    key={et.id}
                    onClick={() => toggleEntityType(et.id)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
                    style={{
                      background: active ? 'var(--color-primary)' : 'transparent',
                      color: active ? '#fff' : 'var(--color-muted)',
                      borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                    }}
                  >
                    {et.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {loading && (
          <div className="py-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
        )}

        {!loading && !summary && (
          <div className="rounded-2xl border p-8 text-center" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              {filterProject
                ? 'No feelings logged for this project yet. Use the dot buttons on tasks and notes within this project, or the feeling button in the project header.'
                : 'No check-ins in this period. Use the dot buttons on tasks, notes, and goals to log feelings, or click "Log a feeling" above.'}
            </p>
          </div>
        )}

        {!loading && summary && (
          <>
            {/* Emotion density wheel */}
            <div className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Your emotional picture</h2>
              {summary.emotions.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>
                  {filterProject
                    ? 'No feelings logged for this project yet. Use the dot buttons on tasks and notes within this project, or click the feeling button in the project header.'
                    : 'No check-ins in this period. Use the dot buttons on tasks, notes, and goals to log feelings.'}
                </p>
              ) : (
                <div className="flex flex-col items-center">
                  <EmotionWheel mode="density" emotions={summary.emotions} />
                </div>
              )}
            </div>

            {/* Emotion breakdown list */}
            {summary.emotions.length > 0 && (
              <div className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Breakdown</h2>
                <div className="space-y-3">
                  {summary.emotions.map(e => (
                    <div key={e.emotion} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: EMOTION_COLOURS[e.emotion] || '#888' }} />
                          <span className="text-sm capitalize font-medium" style={{ color: 'var(--color-text)' }}>{e.emotion}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--color-muted)' }}>
                          <span>avg {e.avgIntensity}/10</span>
                          <span className="font-medium" style={{ color: 'var(--color-text)' }}>×{e.count}</span>
                        </div>
                      </div>
                      <MiniBar value={e.count} max={maxCount} color={EMOTION_COLOURS[e.emotion]} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Daily timeline */}
            {dailyDates.length > 0 && (
              <div className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Daily timeline</h2>
                <div className="space-y-2">
                  {dailyDates.map(dateKey => {
                    const entries = dailyMap[dateKey];
                    const dominant = [...entries].sort((a, b) => parseFloat(b.avgIntensity) - parseFloat(a.avgIntensity))[0];
                    const color = EMOTION_COLOURS[dominant?.coreEmotion] || '#888';
                    return (
                      <div key={dateKey} className="flex items-center gap-3">
                        <span className="text-xs w-20 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                          {new Date(dateKey + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                        <div className="flex items-center gap-1.5 flex-1 flex-wrap">
                          {entries.map(e => (
                            <span
                              key={e.coreEmotion}
                              className="text-xs px-2 py-0.5 rounded-full capitalize"
                              style={{
                                background: (EMOTION_COLOURS[e.coreEmotion] || '#888') + '33',
                                color: 'var(--color-text)',
                                border: `1px solid ${(EMOTION_COLOURS[e.coreEmotion] || '#888')}66`,
                              }}
                            >
                              {e.coreEmotion}
                            </span>
                          ))}
                        </div>
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Project breakdown — hidden when already filtered to a specific project */}
            {!filterProject && summary.projectBreakdown && summary.projectBreakdown.length > 0 && (
              <div className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Most active projects</h2>
                <div className="space-y-3">
                  {summary.projectBreakdown.map(p => (
                    <div key={p.projectId} className="flex items-center gap-3">
                      {p.dominantEmotion && (
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: EMOTION_COLOURS[p.dominantEmotion] || '#888' }} />
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate block" style={{ color: 'var(--color-text)' }}>{p.projectName}</span>
                        {p.dominantEmotion && (
                          <span className="text-xs capitalize" style={{ color: 'var(--color-muted)' }}>{p.dominantEmotion}</span>
                        )}
                      </div>
                      <span className="text-xs font-medium flex-shrink-0" style={{ color: 'var(--color-muted)' }}>×{p.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
