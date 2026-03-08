import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const STATUS_LABEL = { todo: 'To Do', 'in-progress': 'In Progress', done: 'Done' };
const STATUS_COLOR = { todo: 'var(--color-muted)', 'in-progress': '#f59e0b', done: '#22c55e' };

function formatEffort(mins) {
  if (!mins) return null;
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

export default function SharedTaskPage() {
  const { token } = useParams();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return; }
    fetch(`/api/shared/task/${token}`)
      .then(async r => {
        if (r.status === 404) { setNotFound(true); return; }
        const data = await r.json();
        setTask(data);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#94a3b8', fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <h1 style={{ color: '#f1f5f9', fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Task not found</h1>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>This task is no longer shared or the link has expired.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 16px' }}>
      <div style={{ width: '100%', maxWidth: 560, background: '#1e293b', border: '1px solid #334155', borderRadius: 20, overflow: 'hidden', boxShadow: '0 25px 50px rgba(0,0,0,0.4)' }}>
        {/* Priority strip */}
        <div style={{ height: 4, background: PRIORITY_COLOR[task.priority] || '#6366f1' }} />

        <div style={{ padding: '28px 28px 24px' }}>
          {/* Status + Priority badges */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: PRIORITY_COLOR[task.priority] + '22', color: PRIORITY_COLOR[task.priority], border: `1px solid ${PRIORITY_COLOR[task.priority]}44` }}>
              {PRIORITY_LABEL[task.priority] || task.priority}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#334155', color: STATUS_COLOR[task.status] || '#94a3b8' }}>
              {STATUS_LABEL[task.status] || task.status}
            </span>
            {task.category && (
              <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#334155', color: '#94a3b8' }}>
                {task.category}
              </span>
            )}
          </div>

          {/* Title */}
          <h1 style={{ color: '#f1f5f9', fontSize: 22, fontWeight: 700, lineHeight: 1.3, marginBottom: 16, textDecoration: task.status === 'done' ? 'line-through' : 'none', opacity: task.status === 'done' ? 0.7 : 1 }}>
            {task.title}
          </h1>

          {/* Meta */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: task.notes ? 20 : 8 }}>
            {task.dueDate && (
              <div style={{ fontSize: 13, color: '#94a3b8' }}>
                📅 {new Date(task.dueDate.slice(0, 10) + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' })}
              </div>
            )}
            {task.estimatedMinutes > 0 && (
              <div style={{ fontSize: 13, color: '#94a3b8' }}>
                ⏱ ~{formatEffort(task.estimatedMinutes)}
              </div>
            )}
          </div>

          {/* Notes */}
          {task.notes && (
            <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
              <p style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>{task.notes}</p>
            </div>
          )}

          {/* Tags */}
          {task.tags && task.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
              {task.tags.map(tag => (
                <span key={tag} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#1e3a5f', color: '#93c5fd', border: '1px solid #1e40af' }}>
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Subtasks */}
          {task.subtasks && task.subtasks.length > 0 && (
            <div>
              <p style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                Subtasks ({task.subtasks.filter(s => s.status === 'done').length}/{task.subtasks.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {task.subtasks.map(sub => (
                  <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: '#0f172a', border: '1px solid #334155' }}>
                    <input
                      type="checkbox"
                      checked={sub.status === 'done'}
                      readOnly
                      disabled
                      style={{ accentColor: '#6366f1', width: 14, height: 14, flexShrink: 0 }}
                    />
                    <span style={{ color: '#cbd5e1', fontSize: 13, textDecoration: sub.status === 'done' ? 'line-through' : 'none', opacity: sub.status === 'done' ? 0.6 : 1 }}>
                      {sub.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 32, textAlign: 'center' }}>
        <p style={{ color: '#475569', fontSize: 12 }}>
          Shared with <a href="https://curam-ai.com.au" target="_blank" rel="noopener noreferrer" style={{ color: '#6366f1', textDecoration: 'none' }}>Curam Vault</a>
        </p>
      </div>
    </div>
  );
}
