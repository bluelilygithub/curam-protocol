import React, { useState, useCallback } from 'react';
import { useIcon } from '../../providers/IconProvider';

const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

function dueInfo(dateStr) {
  if (!dateStr) return null;
  const hasTime = dateStr.includes('T');
  const datePart = hasTime ? dateStr.slice(0, 10) : dateStr;
  const timePart = hasTime ? dateStr.slice(11, 16) : null;
  const d = new Date(datePart + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  const timeStr = timePart ? ` ${timePart}` : '';
  if (diff < 0) return { label: `Overdue${timeStr}`, color: '#ef4444' };
  if (diff === 0) return { label: `Due today${timeStr}`, color: '#f59e0b' };
  if (diff === 1) return { label: `Tomorrow${timeStr}`, color: 'var(--color-muted)' };
  return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + timeStr, color: 'var(--color-muted)' };
}

export default function TasksTree({
  tasks,
  subtasksCache,
  onFetchSubtasks,
  onToggleStatus,
  onEdit,
  onExpand,
  activeTimerTaskId,
}) {
  const getIcon = useIcon();
  const [expandedIds, setExpandedIds] = useState(new Set());

  const handleToggleExpand = useCallback((task) => {
    const willExpand = !expandedIds.has(task.id);
    if (willExpand) onFetchSubtasks?.(task.id);
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(task.id) ? next.delete(task.id) : next.add(task.id);
      return next;
    });
  }, [expandedIds, onFetchSubtasks]);

  const renderRow = (task, depth = 0) => {
    const isDone = task.status === 'done';
    const isExpanded = expandedIds.has(task.id);
    const subtasks = subtasksCache[task.id] || [];
    const hasChildren = task.subtaskCount > 0 || subtasks.length > 0;
    const due = dueInfo(task.dueDate);
    const isTimerRunning = activeTimerTaskId === task.id;

    return (
      <div key={task.id}>
        <div
          className="group flex items-center gap-2 py-2 border-b hover:opacity-90 transition-opacity"
          style={{
            paddingLeft: `${12 + depth * 20}px`,
            paddingRight: '12px',
            borderColor: 'var(--color-border)',
            borderLeft: depth === 0
              ? `3px solid ${PRIORITY_COLOR[task.priority]}`
              : '2px solid var(--color-border)',
          }}
        >
          {/* Expand / collapse */}
          <button
            onClick={() => hasChildren && handleToggleExpand(task)}
            className="flex-shrink-0 flex items-center justify-center"
            style={{
              width: 16,
              color: hasChildren ? 'var(--color-muted)' : 'transparent',
              cursor: hasChildren ? 'pointer' : 'default',
            }}
          >
            {hasChildren
              ? getIcon(isExpanded ? 'chevron-down' : 'chevron-right', { size: 12 })
              : <span className="w-1 h-1 rounded-full inline-block" style={{ background: 'var(--color-border)' }} />}
          </button>

          {/* Completion circle */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleStatus(task); }}
            style={{ color: isDone ? '#22c55e' : 'var(--color-muted)', flexShrink: 0 }}
          >
            {getIcon(isDone ? 'check-circle' : 'circle', { size: 14 })}
          </button>

          {/* Title */}
          <button
            onClick={() => onExpand(task.id)}
            className="flex-1 text-left min-w-0"
          >
            <span
              className="text-sm"
              style={{
                color: 'var(--color-text)',
                textDecoration: isDone ? 'line-through' : 'none',
                opacity: isDone ? 0.6 : 1,
              }}
            >
              {depth > 0 && <span style={{ color: 'var(--color-muted)', marginRight: 4 }}>↳</span>}
              {task.isMilestone === 1 && <span style={{ marginRight: 4 }} title="Milestone">🏁</span>}
              {task.title}
            </span>
          </button>

          {/* Timer pulse */}
          {isTimerRunning && (
            <span
              className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse"
              style={{ background: '#f59e0b' }}
              title="Timer running"
            />
          )}

          {/* Hover metadata */}
          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <span
              className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
              style={{
                background: PRIORITY_COLOR[task.priority] + '22',
                color: PRIORITY_COLOR[task.priority],
                border: `1px solid ${PRIORITY_COLOR[task.priority]}55`,
              }}
            >
              {PRIORITY_LABEL[task.priority]}
            </span>
            {task.isUrgent === 1 && !isDone && (
              <span className="text-xs" style={{ color: '#f59e0b' }} title="Urgent">⚡</span>
            )}
            {due && (
              <span className="text-xs font-medium flex-shrink-0" style={{ color: due.color }}>
                {due.label}
              </span>
            )}
            {hasChildren && (
              <span
                className="text-xs px-1.5 py-0.5 rounded-full"
                style={{
                  background: 'var(--color-surface)',
                  color: 'var(--color-muted)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {task.subtaskDone}/{task.subtaskCount}
              </span>
            )}
          </div>

          {/* Edit */}
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(task); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            style={{ color: 'var(--color-muted)' }}
          >
            {getIcon('edit', { size: 12 })}
          </button>
        </div>

        {/* Children */}
        {isExpanded && subtasks.map(sub => renderRow(sub, depth + 1))}
      </div>
    );
  };

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-xs" style={{ color: 'var(--color-muted)' }}>
        No tasks match the current filters
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-4">
      {tasks.map(task => renderRow(task, 0))}
    </div>
  );
}
