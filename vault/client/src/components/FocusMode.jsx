import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/apiClient';

const MODES = [
  { key: 'focus', label: 'Focus', defaultMin: 25 },
  { key: 'short', label: 'Short break', defaultMin: 5 },
  { key: 'long', label: 'Long break', defaultMin: 15 },
  { key: 'custom', label: 'Custom', defaultMin: null },
];

const STORAGE_KEY = 'pomodoroSettings';

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      focusMin: s.focusMin ?? 25,
      shortMin: s.shortMin ?? 5,
      longMin: s.longMin ?? 15,
      customMin: s.customMin ?? 20,
      autoStartBreak: s.autoStartBreak ?? false,
      autoStartFocus: s.autoStartFocus ?? false,
    };
  } catch {
    return { focusMin: 25, shortMin: 5, longMin: 15, customMin: 20, autoStartBreak: false, autoStartFocus: false };
  }
}

function saveSettings(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch { /* ignore if audio unavailable */ }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatMinutes(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export default function FocusMode({ task, onClose, onTaskUpdate }) {
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [modeKey, setModeKey] = useState('focus');
  const [secondsLeft, setSecondsLeft] = useState(() => loadSettings().focusMin * 60);
  const [running, setRunning] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [message, setMessage] = useState('');
  const [subtasks, setSubtasks] = useState([]);
  const [subtasksLoading, setSubtasksLoading] = useState(true);
  const [closingMsg, setClosingMsg] = useState('');

  const intervalRef = useRef(null);
  const elapsedFocusSeconds = useRef(0);
  const totalSecondsForMode = useRef(settings.focusMin * 60);

  // Fetch subtasks on mount
  useEffect(() => {
    api.get(`/api/tasks/${task.id}/subtasks`).then(data => {
      setSubtasks(Array.isArray(data) ? data : []);
    }).catch(() => {}).finally(() => setSubtasksLoading(false));
  }, [task.id]);

  // Set initial timer when mode or settings change
  useEffect(() => {
    const mins = getModeMinutes(modeKey, settings);
    totalSecondsForMode.current = mins * 60;
    setSecondsLeft(mins * 60);
    setRunning(false);
    clearInterval(intervalRef.current);
    setMessage('');
  }, [modeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function getModeMinutes(key, s) {
    if (key === 'focus') return s.focusMin;
    if (key === 'short') return s.shortMin;
    if (key === 'long') return s.longMin;
    return s.customMin;
  }

  // Timer tick
  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSecondsLeft(prev => {
          if (modeKey === 'focus') elapsedFocusSeconds.current += 1;
          if (prev <= 1) {
            clearInterval(intervalRef.current);
            setRunning(false);
            playBeep();
            setMessage("Time's up!");
            // Auto-start logic
            if (modeKey === 'focus') {
              const newCount = sessionCount + 1;
              setSessionCount(newCount);
              if (newCount % 4 === 0 && settings.autoStartBreak) {
                setModeKey('long');
                setTimeout(() => setRunning(true), 500);
              } else if (settings.autoStartBreak) {
                setModeKey('short');
                setTimeout(() => setRunning(true), 500);
              }
            } else if (settings.autoStartFocus) {
              setModeKey('focus');
              setTimeout(() => setRunning(true), 500);
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, modeKey, sessionCount, settings]);

  // Keyboard: Esc to close
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const logTimeIfNeeded = useCallback(async () => {
    const elapsedMin = Math.floor(elapsedFocusSeconds.current / 60);
    if (elapsedMin > 0) {
      const newTotal = (task.timeSpentMinutes || 0) + elapsedMin;
      try {
        const updated = await api.put(`/api/tasks/${task.id}`, { timeSpentMinutes: newTotal });
        onTaskUpdate && onTaskUpdate({ timeSpentMinutes: updated.timeSpentMinutes });
      } catch { /* ignore */ }
      return elapsedMin;
    }
    return 0;
  }, [task.id, task.timeSpentMinutes, onTaskUpdate]);

  async function handleClose() {
    clearInterval(intervalRef.current);
    const logged = await logTimeIfNeeded();
    if (logged > 0) {
      setClosingMsg(`Paused — ${formatMinutes(logged)} logged`);
      setTimeout(() => onClose(), 1500);
    } else {
      onClose();
    }
  }

  async function handleMarkDone() {
    clearInterval(intervalRef.current);
    await logTimeIfNeeded();
    try {
      const updated = await api.put(`/api/tasks/${task.id}`, { status: 'done' });
      onTaskUpdate && onTaskUpdate({ status: 'done', timeSpentMinutes: updated.timeSpentMinutes });
    } catch { /* ignore */ }
    onClose();
  }

  function handleReset() {
    clearInterval(intervalRef.current);
    setRunning(false);
    const mins = getModeMinutes(modeKey, settings);
    totalSecondsForMode.current = mins * 60;
    setSecondsLeft(mins * 60);
    setMessage('');
  }

  function handleSettingsChange(key, value) {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      // Update current timer if it matches the changed mode
      const mins = getModeMinutes(modeKey, next);
      if (!running) {
        totalSecondsForMode.current = mins * 60;
        setSecondsLeft(mins * 60);
      }
      return next;
    });
  }

  async function handleSubtaskToggle(sub) {
    const newStatus = sub.status === 'done' ? 'todo' : 'done';
    try {
      await api.put(`/api/tasks/${sub.id}`, { status: newStatus });
      setSubtasks(prev => prev.map(s => s.id === sub.id ? { ...s, status: newStatus } : s));
    } catch { /* ignore */ }
  }

  // SVG ring
  const totalSecs = totalSecondsForMode.current || 1;
  const progress = Math.max(0, secondsLeft / totalSecs);
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  const priorityColors = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div style={{ background: 'var(--bg-primary, #1a1a2e)', border: '1px solid var(--border, #333)', borderRadius: '1rem', width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary, #fff)', wordBreak: 'break-word' }}>{task.title}</span>
              <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '0.2rem 0.5rem', borderRadius: '999px', background: priorityColors[task.priority] + '22', color: priorityColors[task.priority], border: `1px solid ${priorityColors[task.priority]}44` }}>{task.priority}</span>
            </div>
            {task.dueDate && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginTop: '0.25rem' }}>
                Due {task.dueDate.slice(0, 10)}{task.dueDate.includes('T') ? ' at ' + task.dueDate.slice(11, 16) : ''}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginLeft: '0.75rem', flexShrink: 0 }}>
            <button onClick={() => setShowSettings(s => !s)} title="Settings" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted, #888)', fontSize: '1.1rem', padding: '0.25rem' }}>⚙</button>
            <button onClick={handleClose} title="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted, #888)', fontSize: '1.1rem', padding: '0.25rem' }}>✕</button>
          </div>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div style={{ background: 'var(--bg-secondary, #252542)', borderRadius: '0.5rem', padding: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.8rem' }}>
            {[
              { key: 'focusMin', label: 'Focus (min)' },
              { key: 'shortMin', label: 'Short break (min)' },
              { key: 'longMin', label: 'Long break (min)' },
              { key: 'customMin', label: 'Custom (min)' },
            ].map(({ key, label }) => (
              <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ color: 'var(--text-muted, #888)' }}>{label}</span>
                <input
                  type="number" min={1} max={120}
                  value={settings[key]}
                  onChange={e => handleSettingsChange(key, Math.max(1, parseInt(e.target.value) || 1))}
                  style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border, #333)', background: 'var(--bg-primary, #1a1a2e)', color: 'var(--text-primary, #fff)', fontSize: '0.8rem' }}
                />
              </label>
            ))}
            <label style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.autoStartBreak} onChange={e => handleSettingsChange('autoStartBreak', e.target.checked)} />
              <span style={{ color: 'var(--text-secondary, #ccc)' }}>Auto-start breaks</span>
            </label>
            <label style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.autoStartFocus} onChange={e => handleSettingsChange('autoStartFocus', e.target.checked)} />
              <span style={{ color: 'var(--text-secondary, #ccc)' }}>Auto-start focus after break</span>
            </label>
          </div>
        )}

        {/* Notes */}
        {task.notes && (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary, #bbb)', background: 'var(--bg-secondary, #252542)', borderRadius: '0.5rem', padding: '0.75rem', maxHeight: '80px', overflowY: 'auto', lineHeight: 1.5 }}>
            {task.notes}
          </div>
        )}

        {/* Subtasks */}
        {subtasksLoading ? null : subtasks.length > 0 && (
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted, #888)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subtasks</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {subtasks.map(sub => (
                <label key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.375rem 0.5rem', borderRadius: '0.375rem', background: 'var(--bg-secondary, #252542)' }}>
                  <input
                    type="checkbox"
                    checked={sub.status === 'done'}
                    onChange={() => handleSubtaskToggle(sub)}
                    style={{ width: '14px', height: '14px', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: '0.82rem', color: sub.status === 'done' ? 'var(--text-muted, #888)' : 'var(--text-primary, #fff)', textDecoration: sub.status === 'done' ? 'line-through' : 'none' }}>
                    {sub.title}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Pomodoro section */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border, #333)' }}>
          {/* Mode buttons */}
          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            {MODES.map(m => (
              <button
                key={m.key}
                onClick={() => setModeKey(m.key)}
                style={{
                  padding: '0.375rem 0.75rem',
                  borderRadius: '999px',
                  border: '1px solid',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  background: modeKey === m.key ? 'var(--accent, #6366f1)' : 'transparent',
                  borderColor: modeKey === m.key ? 'var(--accent, #6366f1)' : 'var(--border, #333)',
                  color: modeKey === m.key ? '#fff' : 'var(--text-muted, #888)',
                  transition: 'all 0.15s',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* SVG ring + timer */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={200} height={200} style={{ transform: 'rotate(-90deg)' }}>
              <circle cx={100} cy={100} r={radius} fill="none" stroke="var(--border, #333)" strokeWidth={8} />
              <circle
                cx={100} cy={100} r={radius} fill="none"
                stroke={modeKey === 'focus' ? 'var(--accent, #6366f1)' : modeKey === 'short' ? '#22c55e' : '#f59e0b'}
                strokeWidth={8}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{ transition: running ? 'stroke-dashoffset 1s linear' : 'none' }}
              />
            </svg>
            <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: '2.5rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary, #fff)', lineHeight: 1 }}>
                {formatTime(secondsLeft)}
              </span>
              {sessionCount > 0 && (
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #888)', marginTop: '0.25rem' }}>
                  Session {sessionCount % 4 || 4} of 4
                </span>
              )}
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button
              onClick={() => setRunning(r => !r)}
              style={{
                padding: '0.6rem 2rem',
                borderRadius: '0.5rem',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: 700,
                background: running ? '#f59e0b' : 'var(--accent, #6366f1)',
                color: '#fff',
              }}
            >
              {running ? 'Pause' : secondsLeft === 0 ? 'Restart' : 'Start'}
            </button>
            <button
              onClick={handleReset}
              style={{ padding: '0.6rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--border, #333)', cursor: 'pointer', fontSize: '0.85rem', background: 'transparent', color: 'var(--text-muted, #888)' }}
            >
              Reset
            </button>
          </div>

          {message && (
            <div style={{ fontSize: '0.85rem', color: '#22c55e', fontWeight: 600 }}>{message}</div>
          )}
        </div>

        {/* Mark done + time logged */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border, #333)', paddingTop: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)' }}>
            {(task.timeSpentMinutes > 0 || elapsedFocusSeconds.current > 0) && (
              <>⏱ {formatMinutes((task.timeSpentMinutes || 0) + Math.floor(elapsedFocusSeconds.current / 60))} logged</>
            )}
          </div>
          {task.status !== 'done' && (
            <button
              onClick={handleMarkDone}
              style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e44' }}
            >
              Mark task done
            </button>
          )}
        </div>

        {closingMsg && (
          <div style={{ textAlign: 'center', fontSize: '0.85rem', color: '#22c55e', fontWeight: 600, paddingBottom: '0.5rem' }}>{closingMsg}</div>
        )}
      </div>
    </div>
  );
}
