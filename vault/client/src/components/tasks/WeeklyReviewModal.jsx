import React, { useState, useEffect, useRef } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';

const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };

function formatEffort(mins) {
  if (!mins) return null;
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function toDateKey(d) {
  return d.toISOString().slice(0, 10);
}

function getLastWeekRange() {
  const now = new Date();
  // Monday of current week
  const thisMonday = new Date(now);
  thisMonday.setHours(0, 0, 0, 0);
  thisMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  // Last week Mon–Sun
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);
  return { lastMonday: toDateKey(lastMonday), lastSunday: toDateKey(lastSunday) };
}

function getNextSevenDays() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return toDateKey(d);
  });
}

export default function WeeklyReview({ tasks, onClose, onTasksChanged }) {
  const getIcon = useIcon();
  const [step, setStep] = useState(1);

  // Mission statement banner
  const [missionStatement, setMissionStatement] = useState(null);

  // Step 1: last week completed
  const [lastWeekDone, setLastWeekDone] = useState([]);
  const [step1Loading, setStep1Loading] = useState(true);

  // Step 2: overdue
  const [overdue, setOverdue] = useState([]);
  const [step2Loading, setStep2Loading] = useState(true);

  // Step 3: Claude suggestions
  const [suggestion, setSuggestion] = useState('');
  const [suggestionDone, setSuggestionDone] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [quickAdding, setQuickAdding] = useState(false);
  const suggestionRef = useRef('');

  // Step 3: Goals
  const [goals, setGoals] = useState([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [krEditValues, setKrEditValues] = useState({}); // krId -> string value being edited
  const [krSaving, setKrSaving] = useState({});

  const todayStr = toDateKey(new Date());

  // Fetch mission statement on mount
  useEffect(() => {
    api.get('/api/goals/mission').then(r => r.json()).then(data => {
      setMissionStatement(data.statement || null);
    }).catch(() => {});
  }, []);

  // Fetch step 1 data
  useEffect(() => {
    const { lastMonday, lastSunday } = getLastWeekRange();
    setStep1Loading(true);
    api.get(`/api/tasks?status=done&dueAfter=${lastMonday}&dueBefore=${lastSunday}`)
      .then(r => r.json())
      .then(data => setLastWeekDone(Array.isArray(data) ? data : []))
      .catch(() => setLastWeekDone([]))
      .finally(() => setStep1Loading(false));
  }, []);

  // Fetch step 2 data
  useEffect(() => {
    setStep2Loading(true);
    api.get(`/api/tasks?status=todo&dueBefore=${todayStr}`)
      .then(r => r.json())
      .then(data => setOverdue(Array.isArray(data) ? data : []))
      .catch(() => setOverdue([]))
      .finally(() => setStep2Loading(false));
  }, [todayStr]);

  // Stream step 3 suggestions when entering step 3
  useEffect(() => {
    if (step !== 3 || suggestionDone) return;
    setSuggestion('');
    suggestionRef.current = '';
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post('/api/tasks/weekly-review-suggestions', {});
        if (res.headers.get('content-type')?.includes('text/event-stream')) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { value, done } = await reader.read();
            if (done || cancelled) break;
            const text = decoder.decode(value);
            const lines = text.split('\n').filter(l => l.startsWith('data: '));
            for (const line of lines) {
              const payload = line.slice(6);
              if (payload === '[DONE]') { setSuggestionDone(true); break; }
              try {
                const token = JSON.parse(payload);
                suggestionRef.current += token;
                setSuggestion(suggestionRef.current);
              } catch {}
            }
          }
        } else {
          // Non-streaming fallback
          const data = await res.json();
          if (data.text) { setSuggestion(data.text); setSuggestionDone(true); }
        }
      } catch (err) {
        console.error(err);
        setSuggestionDone(true);
      }
    })();
    return () => { cancelled = true; };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch goals when entering step 3
  useEffect(() => {
    if (step !== 3 || goals.length > 0) return;
    setGoalsLoading(true);
    api.get('/api/goals').then(r => r.json()).then(data => setGoals(Array.isArray(data) ? data.filter(o => o.status === 'active') : [])).catch(() => {}).finally(() => setGoalsLoading(false));
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveKrValue = async (krId, currentVal) => {
    const val = parseFloat(krEditValues[krId]);
    if (isNaN(val) || val === currentVal) { setKrEditValues(prev => ({ ...prev, [krId]: undefined })); return; }
    setKrSaving(prev => ({ ...prev, [krId]: true }));
    try {
      const updated = await api.put(`/api/goals/key-results/${krId}`, { currentValue: val }).then(r => r.json());
      setGoals(prev => prev.map(obj => ({
        ...obj,
        keyResults: obj.keyResults.map(kr => kr.id === updated.id ? updated : kr),
        overallProgress: obj.keyResults.some(kr => kr.id === updated.id)
          ? Math.round([...obj.keyResults.map(kr => kr.id === updated.id ? updated.progress : kr.progress)].reduce((a, b) => a + b, 0) / obj.keyResults.length)
          : obj.overallProgress,
      })));
    } catch { }
    setKrSaving(prev => ({ ...prev, [krId]: false }));
    setKrEditValues(prev => ({ ...prev, [krId]: undefined }));
  };

  // Step 2 actions
  const markDone = async (task) => {
    try {
      await api.put(`/api/tasks/${task.id}`, { status: 'done' });
      setOverdue(prev => prev.filter(t => t.id !== task.id));
      onTasksChanged?.();
    } catch (err) { console.error(err); }
  };

  const reschedule = async (task, newDate) => {
    try {
      await api.put(`/api/tasks/${task.id}`, { dueDate: newDate });
      setOverdue(prev => prev.map(t => t.id === task.id ? { ...t, dueDate: newDate } : t));
      onTasksChanged?.();
    } catch (err) { console.error(err); }
  };

  const removeDueDate = async (task) => {
    try {
      await api.put(`/api/tasks/${task.id}`, { dueDate: null });
      setOverdue(prev => prev.filter(t => t.id !== task.id));
      onTasksChanged?.();
    } catch (err) { console.error(err); }
  };

  // Step 3: quick add task
  const handleQuickAdd = async () => {
    if (!quickAddTitle.trim()) return;
    setQuickAdding(true);
    try {
      await api.post('/api/tasks', { title: quickAddTitle.trim(), status: 'todo' });
      document.dispatchEvent(new CustomEvent('vault:task-created'));
      setQuickAddTitle('');
      onTasksChanged?.();
    } catch (err) { console.error(err); }
    finally { setQuickAdding(false); }
  };

  // Step 3: next 7 days tasks from parent's tasks prop
  const nextDays = getNextSevenDays();
  const weekAheadTasks = tasks.filter(t => t.dueDate && nextDays.includes(t.dueDate.slice(0, 10)) && t.status !== 'done');
  const weekEffort = weekAheadTasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
  const weekAheadByDay = nextDays.reduce((acc, day) => {
    const dayTasks = weekAheadTasks.filter(t => t.dueDate?.slice(0, 10) === day);
    if (dayTasks.length > 0) acc[day] = dayTasks;
    return acc;
  }, {});

  // Group step 1 by category
  const lastWeekByCategory = lastWeekDone.reduce((acc, t) => {
    const key = t.category || 'Uncategorised';
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  const STEPS = ['Last Week', 'Carry Forward', 'Week Ahead'];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Weekly Review</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <button onClick={onClose} className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 16 })}</button>
        </div>

        {/* Progress steps */}
        <div className="flex px-6 py-3 gap-2 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          {STEPS.map((label, i) => (
            <button
              key={i}
              onClick={() => setStep(i + 1)}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: step === i + 1 ? 'var(--color-primary)' : 'transparent',
                color: step === i + 1 ? '#fff' : step > i + 1 ? 'var(--color-primary)' : 'var(--color-muted)',
                border: `1px solid ${step === i + 1 ? 'var(--color-primary)' : step > i + 1 ? 'var(--color-primary)' : 'var(--color-border)'}`,
              }}
            >
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-xs font-bold" style={{ background: step > i + 1 ? 'var(--color-primary)' : 'transparent', color: step > i + 1 ? '#fff' : 'inherit' }}>
                {step > i + 1 ? '✓' : i + 1}
              </span>
              {label}
            </button>
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* STEP 1 */}
          {step === 1 && (
            <>
              {/* Mission statement north star banner */}
              {missionStatement && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                  <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}>{getIcon('compass', { size: 13 })}</span>
                  <span className="text-xs font-medium flex-shrink-0" style={{ color: 'var(--color-muted)' }}>North star:</span>
                  <span className="text-xs flex-1 truncate" style={{ color: 'var(--color-text)', fontStyle: 'italic' }} title={missionStatement}>
                    {missionStatement}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Last week recap</h3>
                {!step1Loading && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
                    {lastWeekDone.length} completed
                  </span>
                )}
              </div>
              {step1Loading ? (
                <div className="flex justify-center py-8" style={{ color: 'var(--color-muted)' }}>{getIcon('loader', { size: 20 })}</div>
              ) : lastWeekDone.length === 0 ? (
                <div className="text-center py-10">
                  <div className="text-3xl mb-3">🌱</div>
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No completed tasks from last week. A new week is a fresh start!</p>
                </div>
              ) : (
                <>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    You completed <strong style={{ color: 'var(--color-text)' }}>{lastWeekDone.length} tasks</strong> across <strong style={{ color: 'var(--color-text)' }}>{Object.keys(lastWeekByCategory).length}</strong> categories last week.
                  </p>
                  {Object.entries(lastWeekByCategory).map(([cat, catTasks]) => (
                    <div key={cat}>
                      <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>{cat}</div>
                      <div className="space-y-1.5">
                        {catTasks.map(t => (
                          <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                            <span style={{ color: '#22c55e', flexShrink: 0 }}>{getIcon('check-circle', { size: 14 })}</span>
                            <span className="flex-1 text-sm" style={{ color: 'var(--color-text)', textDecoration: 'line-through', opacity: 0.7 }}>{t.title}</span>
                            {t.updatedAt && (
                              <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                                {new Date(t.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Overdue & carry-forward</h3>
                {!step2Loading && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: overdue.length > 0 ? '#ef444422' : 'var(--color-bg)', color: overdue.length > 0 ? '#ef4444' : 'var(--color-muted)', border: `1px solid ${overdue.length > 0 ? '#ef4444' : 'var(--color-border)'}` }}>
                    {overdue.length} unresolved
                  </span>
                )}
              </div>
              {step2Loading ? (
                <div className="flex justify-center py-8" style={{ color: 'var(--color-muted)' }}>{getIcon('loader', { size: 20 })}</div>
              ) : overdue.length === 0 ? (
                <div className="text-center py-10">
                  <div className="text-3xl mb-3">🎉</div>
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No overdue tasks — you're all caught up!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {overdue.map(t => (
                    <OverdueTaskRow key={t.id} task={t} onDone={() => markDone(t)} onReschedule={(d) => reschedule(t, d)} onRemoveDue={() => removeDueDate(t)} getIcon={getIcon} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Week ahead</h3>

              {/* Scheduled tasks */}
              {Object.keys(weekAheadByDay).length > 0 ? (
                <div className="space-y-3">
                  {nextDays.filter(d => weekAheadByDay[d]).map(day => (
                    <div key={day}>
                      <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                        {day === todayStr ? 'Today' : new Date(day + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                      </div>
                      <div className="space-y-1">
                        {weekAheadByDay[day].map(t => (
                          <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PRIORITY_COLOR[t.priority] }} />
                            <span className="flex-1 text-sm" style={{ color: 'var(--color-text)' }}>{t.title}</span>
                            {t.estimatedMinutes > 0 && (
                              <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>~{formatEffort(t.estimatedMinutes)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {weekEffort > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                      {getIcon('clock', { size: 13 })}
                      <span>Total estimated effort this week: <strong style={{ color: 'var(--color-text)' }}>{formatEffort(weekEffort)}</strong></span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No tasks scheduled for the next 7 days.</p>
              )}

              {/* Claude suggestions */}
              <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-primary)', borderOpacity: 0.5 }}>
                <div className="flex items-center gap-2 mb-2">
                  {getIcon('sparkles', { size: 14, style: { color: 'var(--color-primary)' } })}
                  <span className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>Claude suggests</span>
                  {!suggestionDone && <span style={{ color: 'var(--color-muted)' }}>{getIcon('loader', { size: 12 })}</span>}
                </div>
                {suggestion ? (
                  <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{suggestion}</p>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Generating suggestions…</p>
                )}
              </div>

              {/* Quick add */}
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-muted)' }}>Add a task for this week</label>
                <div className="flex gap-2">
                  <input
                    value={quickAddTitle}
                    onChange={e => setQuickAddTitle(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleQuickAdd()}
                    placeholder="Task title…"
                    className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                  <button
                    onClick={handleQuickAdd}
                    disabled={quickAdding || !quickAddTitle.trim()}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    {quickAdding ? '…' : 'Add'}
                  </button>
                </div>
              </div>

              {/* Goals section */}
              {(goalsLoading || goals.length > 0) && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    {getIcon('target', { size: 14, style: { color: 'var(--color-primary)' } })}
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Your Goals</span>
                  </div>
                  {goalsLoading ? (
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading goals…</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {goals.map(obj => {
                        const today = toDateKey(new Date());
                        const relevantMilestones = (obj.milestones || [])
                          .filter(m => m.status !== 'done' && m.dueDate)
                          .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
                          .slice(0, 2);
                        return (
                        <div key={obj.id} className="rounded-xl p-3" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: obj.color || 'var(--color-primary)' }} />
                              <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{obj.title}</span>
                              {obj.timeframe && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>{obj.timeframe}</span>}
                            </div>
                            <span className="text-xs font-bold" style={{ color: obj.overallProgress >= 70 ? '#22c55e' : obj.overallProgress >= 30 ? '#f59e0b' : '#ef4444' }}>{obj.overallProgress}%</span>
                          </div>
                          {obj.keyResults.length > 0 && (
                            <div className="flex flex-col gap-1.5">
                              {obj.keyResults.map(kr => (
                                <div key={kr.id} className="flex items-center gap-2">
                                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--color-border)', overflow: 'hidden' }}>
                                    <div style={{ width: `${kr.progress}%`, height: '100%', background: obj.color || 'var(--color-primary)', borderRadius: 2 }} />
                                  </div>
                                  <span className="text-xs truncate" style={{ color: 'var(--color-muted)', maxWidth: 120 }}>{kr.title}</span>
                                  {krEditValues[kr.id] !== undefined ? (
                                    <input
                                      autoFocus
                                      type="number"
                                      value={krEditValues[kr.id]}
                                      onChange={e => setKrEditValues(prev => ({ ...prev, [kr.id]: e.target.value }))}
                                      onBlur={() => saveKrValue(kr.id, kr.currentValue)}
                                      onKeyDown={e => { if (e.key === 'Enter') saveKrValue(kr.id, kr.currentValue); if (e.key === 'Escape') setKrEditValues(prev => ({ ...prev, [kr.id]: undefined })); }}
                                      style={{ width: 52, fontSize: 11, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--color-primary)', background: 'var(--color-surface)', color: 'var(--color-text)', outline: 'none' }}
                                    />
                                  ) : (
                                    <button
                                      onClick={() => setKrEditValues(prev => ({ ...prev, [kr.id]: String(kr.currentValue) }))}
                                      style={{ fontSize: 11, color: obj.color || 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' }}
                                    >
                                      {krSaving[kr.id] ? '…' : `${kr.currentValue}/${kr.targetValue} ${kr.unit}`}
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Milestone awareness */}
                          {relevantMilestones.length > 0 && (
                            <div className="mt-2 flex flex-col gap-1">
                              {relevantMilestones.map(m => {
                                const isOverdue = m.dueDate.slice(0, 10) < today;
                                const dateLabel = m.dueDate ? new Date(m.dueDate.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '';
                                return (
                                  <span key={m.id} className="text-xs" style={{ color: isOverdue ? '#ef4444' : '#f59e0b' }}>
                                    🏁 {m.title}{dateLabel ? (isOverdue ? ` — overdue` : ` — due ${dateLabel}`) : ''}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Renewal this week */}
              {(() => {
                const RDIMS = [
                  { key: 'physical', label: '🏃', name: 'Physical', color: '#3b82f6' },
                  { key: 'mental', label: '📚', name: 'Mental', color: '#22c55e' },
                  { key: 'social', label: '🤝', name: 'Social', color: '#f59e0b' },
                  { key: 'spiritual', label: '🌱', name: 'Spiritual', color: '#8b5cf6' },
                ];
                const dimCounts = {};
                lastWeekDone.forEach(t => {
                  if (t.renewalDimension) dimCounts[t.renewalDimension] = (dimCounts[t.renewalDimension] || 0) + 1;
                });
                return (
                  <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>🌱 Renewal This Week</span>
                    </div>
                    <div className="flex gap-2">
                      {RDIMS.map(d => (
                        <div
                          key={d.key}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-1 justify-center"
                          style={{
                            background: dimCounts[d.key] ? d.color + '18' : 'var(--color-surface)',
                            border: `1px solid ${dimCounts[d.key] ? d.color : 'var(--color-border)'}`,
                            color: dimCounts[d.key] ? d.color : 'var(--color-muted)',
                          }}
                          title={d.name}
                        >
                          {d.label}
                          {dimCounts[d.key] ? (
                            <span>{dimCounts[d.key]}</span>
                          ) : (
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#ef4444', display: 'inline-block', marginLeft: 2 }} title="None this week" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between px-6 py-4 border-t flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={step === 1}
            className="px-4 py-2 rounded-lg text-sm border disabled:opacity-30 transition-all"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            ← Back
          </button>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Step {step} of 3</span>
          {step < 3 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: 'var(--color-primary)' }}
            >
              Next →
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: 'var(--color-primary)' }}
            >
              Done ✓
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function OverdueTaskRow({ task, onDone, onReschedule, onRemoveDue, getIcon }) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const today = toDateKey(new Date());
  const tomorrow = toDateKey(new Date(Date.now() + 86400000));
  const nextWeek = toDateKey(new Date(Date.now() + 7 * 86400000));

  return (
    <div className="px-3 py-2.5 rounded-xl border space-y-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-start gap-2">
        <span className="flex-shrink-0 w-2 h-2 rounded-full mt-1.5" style={{ background: PRIORITY_COLOR[task.priority] }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{task.title}</p>
          <p className="text-xs" style={{ color: '#ef4444' }}>Due {task.dueDate?.slice(0, 10)}</p>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={onDone}
            className="text-xs px-2 py-1 rounded border font-medium transition-all hover:opacity-80"
            style={{ borderColor: '#22c55e', color: '#22c55e', background: '#22c55e11' }}
          >
            Done ✓
          </button>
          <button
            onClick={() => setShowDatePicker(v => !v)}
            className="text-xs px-2 py-1 rounded border transition-all hover:opacity-80"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            {getIcon('calendar', { size: 11 })}
          </button>
          <button
            onClick={onRemoveDue}
            className="text-xs px-2 py-1 rounded border transition-all hover:opacity-80"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            title="Remove due date"
          >
            ✕
          </button>
        </div>
      </div>
      {showDatePicker && (
        <div className="flex flex-wrap gap-1.5 pl-4">
          {[
            { label: 'Today', date: today },
            { label: 'Tomorrow', date: tomorrow },
            { label: 'Next week', date: nextWeek },
          ].map(opt => (
            <button
              key={opt.date}
              onClick={() => { onReschedule(opt.date); setShowDatePicker(false); }}
              className="text-xs px-2 py-1 rounded-lg border"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              {opt.label}
            </button>
          ))}
          <input
            type="date"
            min={today}
            className="text-xs px-2 py-1 rounded-lg border outline-none"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            onChange={e => { if (e.target.value) { onReschedule(e.target.value); setShowDatePicker(false); } }}
          />
        </div>
      )}
    </div>
  );
}
