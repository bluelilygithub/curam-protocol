import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';

export default function TasksTile() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showQuick, setShowQuick] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const getIcon = useIcon();

  const load = useCallback(() => {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const dueBefore = todayEnd.toISOString().slice(0, 10);
    api.get(`/api/tasks?status=todo&dueBefore=${dueBefore}`)
      .then(r => r.json())
      .then(data => { setTasks(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setTasks([]); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleQuickAdd = async (e) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/tasks', { title: quickTitle.trim(), status: 'todo' });
      setQuickTitle('');
      setShowQuick(false);
      load();
    } catch {}
    setSaving(false);
  };

  const markDone = async (task) => {
    await api.put(`/api/tasks/${task.id}`, { ...task, status: 'done' }).catch(() => {});
    load();
  };

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          {getIcon('list-checks', { size: 16, style: { color: 'var(--color-text)' } })}
          <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Tasks</span>
          {tasks.length > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full font-semibold"
              style={{ background: 'var(--color-primary)', color: 'white' }}
            >
              {tasks.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowQuick(v => !v)}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:opacity-60 transition-opacity"
          style={{ color: 'var(--color-primary)', background: 'var(--color-bg)' }}
          title="Quick add task"
        >
          {getIcon('plus', { size: 16 })}
        </button>
      </div>

      {showQuick && (
        <form
          onSubmit={handleQuickAdd}
          className="flex gap-2 px-4 py-2.5 border-b"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
        >
          <input
            autoFocus
            value={quickTitle}
            onChange={e => setQuickTitle(e.target.value)}
            placeholder="Task title..."
            className="flex-1 text-sm bg-transparent outline-none"
            style={{ color: 'var(--color-text)' }}
          />
          <button
            type="submit"
            disabled={saving || !quickTitle.trim()}
            className="text-xs px-3 py-1 rounded-lg font-medium hover:opacity-80 transition-opacity"
            style={{ background: 'var(--color-primary)', color: 'white', opacity: (saving || !quickTitle.trim()) ? 0.5 : 1 }}
          >
            Add
          </button>
        </form>
      )}

      <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
        {loading && (
          <div className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</div>
        )}
        {!loading && tasks.length === 0 && (
          <div className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted)' }}>No tasks due today</div>
        )}
        {tasks.map(task => (
          <div
            key={task.id}
            className="flex items-center gap-3 px-4 py-2.5 border-b"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <button
              onClick={() => markDone(task)}
              className="flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center hover:opacity-60 transition-opacity"
              style={{ borderColor: 'var(--color-border)', minWidth: 16 }}
              title="Mark done"
            />
            <span className="flex-1 text-sm truncate" style={{ color: 'var(--color-text)' }}>{task.title}</span>
            {task.priority === 'high' && (
              <span className="flex-shrink-0 text-xs px-1 rounded font-semibold" style={{ background: '#fee2e2', color: '#b91c1c' }}>!</span>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={() => navigate('/tasks')}
        className="w-full px-4 py-2.5 text-sm flex items-center justify-between hover:opacity-70 transition-opacity"
        style={{ color: 'var(--color-primary)', borderTop: '1px solid var(--color-border)' }}
      >
        View all tasks
        {getIcon('chevron-right', { size: 14 })}
      </button>
    </div>
  );
}
