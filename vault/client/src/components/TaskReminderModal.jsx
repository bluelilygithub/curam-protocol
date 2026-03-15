import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';

const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };

function formatTime(time24) {
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayH}:${String(m).padStart(2, '0')} ${period}`;
}

export default function TaskReminderModal({ time, overdue, today, onDismiss }) {
  const navigate = useNavigate();
  const getIcon = useIcon();

  const overdueCount = overdue?.length || 0;
  const todayCount = today?.length || 0;
  const total = overdueCount + todayCount;

  if (!total) return null;

  const handleGoToTasks = () => {
    onDismiss();
    navigate('/tasks');
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-full max-w-xl rounded-2xl border shadow-2xl flex flex-col"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b flex items-start justify-between" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>
              Task Reminder — {formatTime(time)}
            </h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
              {total} task{total !== 1 ? 's' : ''} need{total === 1 ? 's' : ''} your attention
            </p>
          </div>
          <button onClick={onDismiss} className="hover:opacity-60 p-1 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
            {getIcon('x', { size: 16 })}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {overdueCount > 0 && (
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full mb-3"
                style={{ background: '#ef444420', color: '#ef4444' }}>
                {getIcon('alert-circle', { size: 12 })} Overdue — {overdueCount}
              </span>
              <div className="space-y-1.5">
                {overdue.map(t => (
                  <button
                    key={t.id}
                    onClick={handleGoToTasks}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left hover:opacity-80 transition-opacity"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', borderLeft: `3px solid ${PRIORITY_COLOR[t.priority] || '#ef4444'}` }}
                  >
                    <span className="flex-1 text-sm" style={{ color: 'var(--color-text)' }}>{t.title}</span>
                    {t.dueDate && (
                      <span className="text-xs flex-shrink-0" style={{ color: '#ef4444' }}>{t.dueDate.slice(0, 10)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {todayCount > 0 && (
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full mb-3"
                style={{ background: '#f59e0b20', color: '#f59e0b' }}>
                {getIcon('clock', { size: 12 })} Due today — {todayCount}
              </span>
              <div className="space-y-1.5">
                {today.map(t => (
                  <button
                    key={t.id}
                    onClick={handleGoToTasks}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left hover:opacity-80 transition-opacity"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', borderLeft: `3px solid ${PRIORITY_COLOR[t.priority] || '#f59e0b'}` }}
                  >
                    <span className="flex-1 text-sm" style={{ color: 'var(--color-text)' }}>{t.title}</span>
                    {t.dueDate?.includes('T') && (
                      <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{t.dueDate.slice(11, 16)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-3" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={onDismiss}
            className="px-4 py-2 rounded-xl text-sm border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Dismiss
          </button>
          <button
            onClick={handleGoToTasks}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-primary)' }}
          >
            Go to Tasks
          </button>
        </div>
      </div>
    </div>
  );
}
