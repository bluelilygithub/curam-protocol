import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/apiClient';
import EmotionWheel from '../components/mood/EmotionWheel';
import CheckinModal from '../components/mood/CheckinModal';
import InquirySession from '../components/mood/InquirySession';
import useToastStore from '../store/toastStore';

const EMOTION_COLOURS = {
  joy: '#C9A84C', trust: '#6B9E70', fear: '#507A60', surprise: '#6B97B5',
  sadness: '#5B6FAD', disgust: '#8A5C8A', anger: '#A85C5C', anticipation: '#C48B3C',
};

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week',  label: 'Week'  },
  { id: 'month', label: 'Month' },
  { id: 'custom', label: 'Custom' },
];

const ENTITY_TYPE_FILTERS = [
  { id: 'project', label: 'Projects', types: ['project'] },
  { id: 'task',    label: 'Tasks',    types: ['task'] },
  { id: 'goal',    label: 'Goals',    types: ['goal', 'key_result'] },
  { id: 'note',    label: 'Notes',    types: ['note'] },
  { id: 'session', label: 'Sessions', types: ['session'] },
  { id: 'general', label: 'General',  types: ['general'] },
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
        to:   customTo   ? new Date(customTo + 'T23:59:59').toISOString() : iso(now),
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

function formatSessionDate(dt) {
  return new Date(dt).toLocaleString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const mins = Math.round(seconds / 60);
  if (mins < 1) return 'Under a minute';
  return `${mins} minute${mins !== 1 ? 's' : ''}`;
}

function daysAgo(isoString) {
  const days = Math.floor((Date.now() - new Date(isoString).getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function parseJsonField(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
  return [];
}

export default function MoodPage() {
  const addToast = useToastStore(s => s.addToast);

  // ── Main tabs ──────────────────────────────────────────────────────────────
  const [mainTab, setMainTab] = useState('overview'); // 'overview' | 'sessions'

  // ── Overview state ─────────────────────────────────────────────────────────
  const [period,      setPeriod]      = useState('month');
  const [customFrom,  setCustomFrom]  = useState('');
  const [customTo,    setCustomTo]    = useState('');
  const [summary,     setSummary]     = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [loadError,   setLoadError]   = useState(false);
  const [filterProject,     setFilterProject]     = useState('');
  const [filterEntityTypes, setFilterEntityTypes] = useState([]);
  const [projects,          setProjects]          = useState([]);

  // ── Modals ─────────────────────────────────────────────────────────────────
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [showInquiry,      setShowInquiry]      = useState(false);

  // ── Sessions tab ───────────────────────────────────────────────────────────
  const [sessions,        setSessions]        = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsLoaded,  setSessionsLoaded]  = useState(false);
  const [expandedSession, setExpandedSession] = useState(null); // session id
  const [sessionDetails,  setSessionDetails]  = useState({});  // { [id]: full row }

  // ── Pattern Insights ───────────────────────────────────────────────────────
  const [insightsOpen,        setInsightsOpen]        = useState(false);
  const [insights,            setInsights]            = useState(null);  // array | null
  const [insightsGeneratedAt, setInsightsGeneratedAt] = useState(null);
  const [insightsCacheLoaded, setInsightsCacheLoaded] = useState(false);
  const [insightsCacheLoading, setInsightsCacheLoading] = useState(false);
  const [generating,          setGenerating]          = useState(false);

  // ── Effects ────────────────────────────────────────────────────────────────

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
  }, [period, customFrom, customTo, filterProject, resolvedEntityTypes.join(',')]); // eslint-disable-line

  useEffect(() => { loadSummary(); }, [loadSummary]);

  // Load sessions on tab switch (once)
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res  = await api.get('/api/mood/sessions');
      const data = await res.json();
      setSessions(data.sessions || []);
      setSessionsLoaded(true);
    } catch { /* silent */ } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mainTab === 'sessions' && !sessionsLoaded) loadSessions();
  }, [mainTab, sessionsLoaded, loadSessions]);

  // Load insights cache when section opens
  useEffect(() => {
    if (!insightsOpen || insightsCacheLoaded) return;
    setInsightsCacheLoading(true);
    api.get('/api/settings').then(r => r.json()).then(data => {
      if (data.mood_insights_cache) {
        try { setInsights(JSON.parse(data.mood_insights_cache)); } catch {}
      }
      if (data.mood_insights_generated) setInsightsGeneratedAt(data.mood_insights_generated);
      setInsightsCacheLoaded(true);
    }).catch(() => {
      setInsightsCacheLoaded(true);
    }).finally(() => setInsightsCacheLoading(false));
  }, [insightsOpen, insightsCacheLoaded]);

  // ── Session detail ─────────────────────────────────────────────────────────
  const loadSessionDetail = async (id) => {
    if (sessionDetails[id]) return;
    try {
      const res  = await api.get(`/api/mood/sessions/${id}`);
      const data = await res.json();
      setSessionDetails(prev => ({ ...prev, [id]: data }));
    } catch {}
  };

  // ── Generate insights ──────────────────────────────────────────────────────
  const generateInsights = async () => {
    setGenerating(true);
    setInsights(null);
    const { from, to } = getPeriodDates(period, customFrom, customTo);
    try {
      const res     = await api.stream('/api/mood/insights', { from, to });
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', accumulated = '';

      loop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break loop;
          try { accumulated += JSON.parse(payload); } catch {}
        }
      }

      const cleaned = accumulated.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      try {
        const parsed = JSON.parse(cleaned);
        setInsights(parsed);
        setInsightsGeneratedAt(new Date().toISOString());
      } catch {
        addToast('Could not generate insights. Try again.', 'error');
      }
    } catch {
      addToast('Could not generate insights. Try again.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const maxCount = summary ? Math.max(...(summary.emotions || []).map(e => e.count), 1) : 1;

  const dailyMap = {};
  if (summary?.dailySeries) {
    for (const d of summary.dailySeries) {
      if (!dailyMap[d.date]) dailyMap[d.date] = [];
      dailyMap[d.date].push(d);
    }
  }
  const dailyDates = Object.keys(dailyMap).sort();

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>Mood</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>Track how you feel across your work</p>
          </div>
          <div className="flex gap-2">
            <button
              data-tour="mood-checkin-btn"
              onClick={() => setShowCheckinModal(true)}
              className="px-4 py-2 rounded-xl text-sm font-medium border transition-opacity hover:opacity-80"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }}
            >
              Quick check-in
            </button>
            <button
              data-tour="mood-inquiry-btn"
              onClick={() => setShowInquiry(true)}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: 'var(--color-primary)' }}
            >
              Begin inquiry
            </button>
          </div>
        </div>

        {/* Modals */}
        {showCheckinModal && (
          <CheckinModal
            entityType="general"
            entityId={null}
            entityTitle="General check-in"
            onClose={() => setShowCheckinModal(false)}
            onSave={() => { setShowCheckinModal(false); loadSummary(); addToast('Feeling logged', 'success'); }}
          />
        )}
        {showInquiry && (
          <InquirySession
            onClose={() => setShowInquiry(false)}
            onComplete={() => {
              loadSummary();
              setSessionsLoaded(false);
              addToast('Inquiry session saved', 'success');
            }}
          />
        )}

        {/* Main tab bar */}
        <div data-tour="mood-tabs" className="flex gap-0 border-b" style={{ borderColor: 'var(--color-border)' }}>
          {['overview', 'sessions'].map(t => (
            <button
              key={t}
              onClick={() => setMainTab(t)}
              className="px-4 py-2 text-sm font-medium capitalize transition-colors"
              style={{
                color:        mainTab === t ? 'var(--color-primary)' : 'var(--color-muted)',
                borderBottom: mainTab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
                marginBottom: -1,
                background:   'transparent',
              }}
            >
              {t === 'overview' ? 'Overview' : 'Sessions'}
            </button>
          ))}
        </div>

        {/* ── Overview tab ─────────────────────────────────────────────────── */}
        {mainTab === 'overview' && (
          <div className="space-y-6">

            {/* Period tabs */}
            <div className="flex gap-1 rounded-xl p-1 border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              {PERIODS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id)}
                  className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: period === p.id ? 'var(--color-primary)' : 'transparent',
                    color:      period === p.id ? '#fff' : 'var(--color-muted)',
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
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                    className="w-full text-sm px-3 py-1.5 rounded-lg border outline-none"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-muted)' }}>To</label>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                    className="w-full text-sm px-3 py-1.5 rounded-lg border outline-none"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="space-y-3">
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
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-muted)' }}>Source</label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setFilterEntityTypes([])}
                    className="px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
                    style={{
                      background:  filterEntityTypes.length === 0 ? 'var(--color-primary)' : 'transparent',
                      color:       filterEntityTypes.length === 0 ? '#fff' : 'var(--color-muted)',
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
                          background:  active ? 'var(--color-primary)' : 'transparent',
                          color:       active ? '#fff' : 'var(--color-muted)',
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
                    : 'No check-ins in this period. Use the dot buttons on tasks, notes, and goals to log feelings, or click "Quick check-in" above.'}
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
                        ? 'No feelings logged for this project yet.'
                        : 'No check-ins in this period.'}
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

                {/* ── Patterns & Insights (collapsible) ── */}
                <div data-tour="mood-insights" className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                  <button
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:opacity-80 transition-opacity"
                    onClick={() => setInsightsOpen(v => !v)}
                  >
                    <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Patterns & Insights</span>
                    <span
                      className="text-base transition-transform duration-200"
                      style={{ color: 'var(--color-muted)', transform: insightsOpen ? 'rotate(90deg)' : 'none', display: 'inline-block' }}
                    >
                      ›
                    </span>
                  </button>

                  {insightsOpen && (
                    <div className="border-t px-5 pb-5 pt-4" style={{ borderColor: 'var(--color-border)' }}>

                      {insightsCacheLoading && (
                        <p className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>Loading…</p>
                      )}

                      {!insightsCacheLoading && insights && !generating && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                              {insightsGeneratedAt ? `Last generated ${daysAgo(insightsGeneratedAt)}` : ''}
                            </span>
                            <button
                              onClick={generateInsights}
                              className="text-xs hover:opacity-70 transition-opacity"
                              style={{ color: 'var(--color-muted)' }}
                            >
                              Regenerate
                            </button>
                          </div>
                          {insights.map((item, i) =>
                            item.type === 'question' ? (
                              <div key={i} className="text-center py-3 px-4">
                                <p className="text-sm italic leading-relaxed" style={{ color: 'var(--color-text)' }}>
                                  {item.question}
                                </p>
                              </div>
                            ) : (
                              <div
                                key={i}
                                className="pl-4 py-0.5 text-sm leading-relaxed"
                                style={{ borderLeft: '2px solid var(--color-border)', color: 'var(--color-text)' }}
                              >
                                {item.insight}
                              </div>
                            )
                          )}
                        </div>
                      )}

                      {!insightsCacheLoading && !insights && !generating && (
                        <div className="text-center">
                          <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
                            Generate an AI analysis of your emotional patterns for the selected period.
                          </p>
                          <button
                            onClick={generateInsights}
                            className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                            style={{ background: 'var(--color-primary)' }}
                          >
                            Generate insights
                          </button>
                        </div>
                      )}

                      {generating && (
                        <p className="text-xs text-center animate-pulse" style={{ color: 'var(--color-muted)' }}>
                          Analysing your patterns…
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Daily timeline */}
                {dailyDates.length > 0 && (
                  <div className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                    <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Daily timeline</h2>
                    <div className="space-y-2">
                      {dailyDates.map(dateKey => {
                        const entries  = dailyMap[dateKey];
                        const dominant = [...entries].sort((a, b) => parseFloat(b.avgIntensity) - parseFloat(a.avgIntensity))[0];
                        const color    = EMOTION_COLOURS[dominant?.coreEmotion] || '#888';
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

                {/* Project breakdown */}
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
        )}

        {/* ── Sessions tab ──────────────────────────────────────────────────── */}
        {mainTab === 'sessions' && (
          <div className="space-y-3">

            {sessionsLoading && (
              <div className="py-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
            )}

            {!sessionsLoading && sessions.length === 0 && (
              <div className="rounded-2xl border p-8 text-center" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
                  No inquiry sessions yet. Begin your first guided inquiry from the button above.
                </p>
                <button
                  onClick={() => setShowInquiry(true)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                  style={{ background: 'var(--color-primary)' }}
                >
                  Begin inquiry
                </button>
              </div>
            )}

            {!sessionsLoading && sessions.map(session => {
              const isExpanded = expandedSession === session.id;
              const detail     = sessionDetails[session.id];
              const emotions   = parseJsonField(session.dominant_emotions);

              return (
                <div
                  key={session.id}
                  className="rounded-2xl border overflow-hidden"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
                >
                  {/* Card header */}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs mb-0.5" style={{ color: 'var(--color-muted)' }}>
                          {formatSessionDate(session.completed_at)}
                        </p>
                        {session.duration_seconds > 0 && (
                          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                            {formatDuration(session.duration_seconds)}
                          </p>
                        )}
                        {emotions.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-2">
                            {emotions.slice(0, 3).map(em => (
                              <span
                                key={em}
                                className="w-3 h-3 rounded-full flex-shrink-0"
                                style={{ background: EMOTION_COLOURS[em] || '#888' }}
                                title={em}
                              />
                            ))}
                            {emotions.length > 3 && (
                              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>+{emotions.length - 3}</span>
                            )}
                          </div>
                        )}
                        {session.user_summary && (
                          <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--color-text)' }}>
                            {session.user_summary.length >= 150
                              ? session.user_summary.substring(0, 150) + '…'
                              : session.user_summary}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          if (isExpanded) {
                            setExpandedSession(null);
                          } else {
                            setExpandedSession(session.id);
                            loadSessionDetail(session.id);
                          }
                        }}
                        className="flex-shrink-0 text-xs flex items-center gap-0.5 hover:opacity-70 transition-opacity"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        {isExpanded ? 'Close' : 'Read session'}
                        <span style={{
                          display: 'inline-block',
                          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                          transition: 'transform 0.15s',
                        }}>›</span>
                      </button>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      {!detail ? (
                        <p className="text-xs py-4 text-center" style={{ color: 'var(--color-muted)' }}>Loading…</p>
                      ) : (
                        <div className="px-4 pt-4 pb-5 space-y-4">
                          {detail.user_summary && (
                            <blockquote
                              className="border-l-2 pl-3 text-sm italic leading-relaxed"
                              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-text)' }}
                            >
                              {detail.user_summary}
                            </blockquote>
                          )}
                          {detail.user_summary && parseJsonField(detail.conversation).length > 0 && (
                            <hr style={{ borderColor: 'var(--color-border)' }} />
                          )}
                          {parseJsonField(detail.conversation).filter(m => m.content).map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div
                                className="max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
                                style={
                                  msg.role === 'user'
                                    ? { background: 'var(--color-primary)', color: '#fff' }
                                    : { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
                                }
                              >
                                {msg.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
