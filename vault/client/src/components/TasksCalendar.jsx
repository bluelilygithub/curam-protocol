import React, { useState, useMemo } from 'react';
import { useIcon } from '../providers/IconProvider';

const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isStale(task) {
  if (task.status !== 'todo' || !task.createdAt) return false;
  return (Date.now() - new Date(task.createdAt)) / 86400000 > 7;
}

function toKey(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekStart(d) {
  const c = new Date(d);
  const dow = (c.getDay() + 6) % 7;
  c.setDate(c.getDate() - dow);
  c.setHours(0, 0, 0, 0);
  return c;
}

function getMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7;
  const days = [];
  for (let i = startDow - 1; i >= 0; i--) {
    days.push({ date: new Date(year, month, -i), inMonth: false });
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push({ date: new Date(year, month, d), inMonth: true });
  }
  const rem = days.length % 7;
  if (rem > 0) {
    for (let i = 1; i <= 7 - rem; i++) {
      days.push({ date: new Date(year, month + 1, i), inMonth: false });
    }
  }
  return days;
}

export default function TasksCalendar({ tasks, onEdit, onToggleStatus, onNew, onReschedule }) {
  const getIcon = useIcon();
  const [calView, setCalView] = useState('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedKey, setSelectedKey] = useState(null);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [dragOverDate, setDragOverDate] = useState(null);
  const [noteTooltip, setNoteTooltip] = useState(null);
  const todayKey = toKey(new Date());

  const showNoteTooltip = (e, notes) => {
    if (!notes) return;
    const r = e.currentTarget.getBoundingClientRect();
    setNoteTooltip({ notes, x: Math.min(r.left, window.innerWidth - 288), y: r.bottom + 6 });
  };
  const hideNoteTooltip = () => setNoteTooltip(null);

  const tasksByDate = useMemo(() => {
    const map = {};
    tasks.forEach(t => {
      if (!t.dueDate) return;
      const k = t.dueDate.slice(0, 10);
      if (!map[k]) map[k] = [];
      map[k].push(t);
    });
    return map;
  }, [tasks]);

  const navigate = (dir) => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (calView === 'day') d.setDate(d.getDate() + dir);
      else if (calView === 'week') d.setDate(d.getDate() + dir * 7);
      else if (calView === 'month') d.setMonth(d.getMonth() + dir);
      return d;
    });
    setSelectedKey(null);
  };

  const headerTitle = () => {
    if (calView === 'day') {
      return currentDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    if (calView === 'week') {
      const ws = getWeekStart(currentDate);
      const we = new Date(ws); we.setDate(ws.getDate() + 6);
      return `${ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${we.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    if (calView === 'month') {
      return currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    return 'Custom Range';
  };

  const handleCalendarDrop = (e, targetDateKey) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDate(null);
    const taskId = parseInt(e.dataTransfer.getData('taskId'), 10);
    const fromDate = e.dataTransfer.getData('fromDate');
    if (!taskId || fromDate === targetDateKey) return;
    onReschedule?.(taskId, targetDateKey);
  };

  const renderPill = (task, compact = false) => {
    const isDone = task.status === 'done';
    const hasTime = task.dueDate?.includes('T');
    const fromDate = task.dueDate?.slice(0, 10) || '';
    return (
      <button
        key={task.id}
        draggable
        onDragStart={e => {
          e.stopPropagation();
          e.dataTransfer.setData('taskId', String(task.id));
          e.dataTransfer.setData('fromDate', fromDate);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setDragOverDate(null)}
        onClick={e => { e.stopPropagation(); onEdit(task); }}
        onMouseEnter={(e) => showNoteTooltip(e, task.notes)}
        onMouseLeave={hideNoteTooltip}
        className="w-full text-left truncate rounded transition-opacity hover:opacity-75 cursor-grab active:cursor-grabbing"
        style={{
          background: PRIORITY_COLOR[task.priority] + '1a',
          borderLeft: `2px solid ${PRIORITY_COLOR[task.priority]}`,
          color: 'var(--color-text)',
          textDecoration: isDone ? 'line-through' : 'none',
          opacity: isDone ? 0.55 : 1,
          fontSize: compact ? 10 : 11,
          padding: compact ? '2px 5px' : '3px 6px',
          display: 'block',
          marginBottom: 2,
        }}
        title={task.title}
      >
        {hasTime && <span style={{ opacity: 0.6, marginRight: 3, fontSize: 9 }}>{task.dueDate.slice(11, 16)}</span>}
        {task.title}
        {isStale(task) && <span title="Stale — 7+ days in To Do" style={{ color: '#f59e0b', marginLeft: 3, fontSize: 9 }}>⏱</span>}
      </button>
    );
  };

  // Shared day detail panel shown below month/week grids
  const renderDayDetail = () => {
    if (!selectedKey) return null;
    const dayTasks = tasksByDate[selectedKey] || [];
    const d = new Date(selectedKey + 'T12:00:00');
    const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const isToday = selectedKey === todayKey;
    return (
      <div className="flex-shrink-0 border-t px-5 py-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{label}</span>
            {isToday && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary)', color: '#fff' }}>Today</span>}
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{dayTasks.length} task{dayTasks.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onNew(selectedKey)} className="text-xs px-2.5 py-1 rounded-lg border" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>+ Add</button>
            <button onClick={() => setSelectedKey(null)} className="hover:opacity-60" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 13 })}</button>
          </div>
        </div>
        {dayTasks.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No tasks due on this day.</p>
        ) : (
          <div className="flex gap-2 flex-wrap max-h-32 overflow-y-auto">
            {dayTasks.map(task => (
              <div key={task.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5 border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', borderLeft: `3px solid ${PRIORITY_COLOR[task.priority]}` }}>
                <button onClick={() => onToggleStatus(task)} style={{ color: task.status === 'done' ? '#22c55e' : 'var(--color-muted)', flexShrink: 0 }}>
                  {getIcon(task.status === 'done' ? 'check-circle' : 'circle', { size: 14 })}
                </button>
                <span className="text-sm" style={{ color: 'var(--color-text)', textDecoration: task.status === 'done' ? 'line-through' : 'none', opacity: task.status === 'done' ? 0.6 : 1, whiteSpace: 'nowrap' }}>{task.title}</span>
                {task.dueDate?.includes('T') && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{task.dueDate.slice(11, 16)}</span>}
                <button onClick={() => onEdit(task)} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('edit', { size: 12 })}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Month view
  const renderMonth = () => {
    const grid = getMonthGrid(currentDate.getFullYear(), currentDate.getMonth());
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="grid grid-cols-7 flex-shrink-0 border-b" style={{ borderColor: 'var(--color-border)' }}>
          {DAYS_SHORT.map(d => (
            <div key={d} className="text-center py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{d}</div>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-7" style={{ minHeight: 480 }}>
            {grid.map(({ date, inMonth }, i) => {
              const key = toKey(date);
              const dayTasks = tasksByDate[key] || [];
              const isToday = key === todayKey;
              const isSelected = key === selectedKey;
              const isDragOver = dragOverDate === key;
              const overflow = dayTasks.length - 3;
              return (
                <div
                  key={i}
                  onClick={() => setSelectedKey(isSelected ? null : key)}
                  onDragOver={e => { e.preventDefault(); setDragOverDate(key); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverDate(null); }}
                  onDrop={e => handleCalendarDrop(e, key)}
                  className="border-b border-r p-1.5 cursor-pointer transition-colors"
                  style={{
                    borderColor: isDragOver ? 'var(--color-primary)' : 'var(--color-border)',
                    background: isDragOver ? 'var(--color-primary)' + '18' : isSelected ? 'var(--color-primary)' + '12' : isToday ? 'var(--color-primary)' + '07' : 'transparent',
                    minHeight: 88,
                    opacity: inMonth ? 1 : 0.38,
                    outline: isDragOver ? '1px solid var(--color-primary)' : 'none',
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full"
                      style={{
                        background: isToday ? 'var(--color-primary)' : 'transparent',
                        color: isToday ? '#fff' : (inMonth ? 'var(--color-text)' : 'var(--color-muted)'),
                      }}
                    >
                      {date.getDate()}
                    </span>
                    {dayTasks.length > 0 && (
                      <span className="text-xs rounded-full px-1" style={{ background: 'var(--color-primary)' + '22', color: 'var(--color-primary)', fontSize: 9 }}>
                        {dayTasks.length}
                      </span>
                    )}
                  </div>
                  <div>
                    {dayTasks.slice(0, 3).map(t => renderPill(t, true))}
                    {overflow > 0 && (
                      <div className="pl-1.5 text-xs" style={{ color: 'var(--color-muted)', fontSize: 9 }}>+{overflow} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {renderDayDetail()}
      </div>
    );
  };

  // Week view
  const renderWeek = () => {
    const ws = getWeekStart(currentDate);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(ws); d.setDate(ws.getDate() + i); return d;
    });
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="grid grid-cols-7 flex-shrink-0 border-b" style={{ borderColor: 'var(--color-border)' }}>
          {days.map((d, i) => {
            const key = toKey(d);
            const isToday = key === todayKey;
            const isSelected = key === selectedKey;
            const count = (tasksByDate[key] || []).length;
            return (
              <div
                key={i}
                onClick={() => setSelectedKey(isSelected ? null : key)}
                className="text-center py-3 border-r last:border-r-0 cursor-pointer hover:opacity-80 transition-opacity"
                style={{ borderColor: 'var(--color-border)', background: isSelected ? 'var(--color-primary)' + '12' : isToday ? 'var(--color-primary)' + '07' : 'transparent' }}
              >
                <div className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--color-muted)' }}>{DAYS_SHORT[i]}</div>
                <div className="text-xl font-bold mt-0.5 w-10 h-10 mx-auto flex items-center justify-center rounded-full"
                  style={{ background: isToday ? 'var(--color-primary)' : 'transparent', color: isToday ? '#fff' : 'var(--color-text)' }}>
                  {d.getDate()}
                </div>
                {count > 0 && <div className="text-xs mt-0.5" style={{ color: 'var(--color-primary)', fontSize: 10 }}>{count} task{count !== 1 ? 's' : ''}</div>}
              </div>
            );
          })}
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-7 min-h-full">
            {days.map((d, i) => {
              const key = toKey(d);
              const dayTasks = tasksByDate[key] || [];
              const isToday = key === todayKey;
              const isSelected = key === selectedKey;
              const isDragOver = dragOverDate === key;
              return (
                <div
                  key={i}
                  onDragOver={e => { e.preventDefault(); setDragOverDate(key); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverDate(null); }}
                  onDrop={e => handleCalendarDrop(e, key)}
                  className="border-r last:border-r-0 p-2 transition-colors"
                  style={{
                    borderColor: isDragOver ? 'var(--color-primary)' : 'var(--color-border)',
                    background: isDragOver ? 'var(--color-primary)' + '12' : isSelected ? 'var(--color-primary)' + '08' : isToday ? 'var(--color-primary)' + '05' : 'transparent',
                    minHeight: 140,
                    outline: isDragOver ? '1px solid var(--color-primary)' : 'none',
                  }}
                >
                  <div className="space-y-1">
                    {dayTasks.map(t => renderPill(t))}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); onNew(key); }}
                    className="w-full mt-1.5 py-1 rounded text-xs hover:opacity-60 transition-opacity"
                    style={{ color: 'var(--color-muted)', border: '1px dashed var(--color-border)' }}
                  >+</button>
                </div>
              );
            })}
          </div>
        </div>
        {renderDayDetail()}
      </div>
    );
  };

  // Day view
  const renderDay = () => {
    const key = toKey(currentDate);
    const dayTasks = tasksByDate[key] || [];
    return (
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-xl mx-auto">
          <div className="flex items-center justify-between mb-5">
            <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
              {dayTasks.length > 0 ? `${dayTasks.length} task${dayTasks.length !== 1 ? 's' : ''} due` : 'No tasks due'}
            </span>
            <button onClick={() => onNew(key)} className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>
              + Add task
            </button>
          </div>
          {dayTasks.length === 0 ? (
            <div className="flex flex-col items-center py-20" style={{ color: 'var(--color-muted)' }}>
              <div style={{ opacity: 0.25 }}>{getIcon('calendar', { size: 42 })}</div>
              <p className="mt-3 text-sm">Nothing due on this day.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {dayTasks.map(task => (
                <div key={task.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', borderLeft: `3px solid ${PRIORITY_COLOR[task.priority]}` }}>
                  <button onClick={() => onToggleStatus(task)} style={{ color: task.status === 'done' ? '#22c55e' : 'var(--color-muted)', flexShrink: 0 }}>
                    {getIcon(task.status === 'done' ? 'check-circle' : 'circle', { size: 16 })}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)', textDecoration: task.status === 'done' ? 'line-through' : 'none', opacity: task.status === 'done' ? 0.6 : 1 }}>{task.title}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: PRIORITY_COLOR[task.priority] + '22', color: PRIORITY_COLOR[task.priority] }}>{PRIORITY_LABEL[task.priority]}</span>
                      {task.dueDate?.includes('T') && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{task.dueDate.slice(11, 16)}</span>}
                      {task.category && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{task.category}</span>}
                    </div>
                  </div>
                  <button onClick={() => onEdit(task)} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                    {getIcon('edit', { size: 14 })}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Range view
  const renderRange = () => {
    const rangeGroups = [];
    if (rangeStart && rangeEnd && rangeStart <= rangeEnd) {
      const d = new Date(rangeStart + 'T00:00:00');
      const end = new Date(rangeEnd + 'T00:00:00');
      while (d <= end) {
        const key = toKey(d);
        const ts = tasksByDate[key] || [];
        if (ts.length > 0) rangeGroups.push({ key, date: new Date(d), tasks: ts });
        d.setDate(d.getDate() + 1);
      }
    }
    const totalTasks = rangeGroups.reduce((s, g) => s + g.tasks.length, 0);
    return (
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-xl mx-auto">
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>From</label>
              <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
                className="text-sm px-3 py-1.5 rounded-lg border outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>To</label>
              <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
                className="text-sm px-3 py-1.5 rounded-lg border outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
            </div>
            {totalTasks > 0 && (
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{totalTasks} task{totalTasks !== 1 ? 's' : ''} across {rangeGroups.length} day{rangeGroups.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          {!rangeStart || !rangeEnd ? (
            <div className="text-center py-16 text-sm" style={{ color: 'var(--color-muted)' }}>Select a start and end date above.</div>
          ) : rangeGroups.length === 0 ? (
            <div className="text-center py-16 text-sm" style={{ color: 'var(--color-muted)' }}>No tasks scheduled in this range.</div>
          ) : (
            <div className="space-y-5">
              {rangeGroups.map(({ key, date, tasks: dayTasks }) => {
                const isToday = key === todayKey;
                return (
                  <div key={key}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold" style={{ color: isToday ? 'var(--color-primary)' : 'var(--color-text)' }}>
                        {date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                      {isToday && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary)', color: '#fff' }}>Today</span>}
                      <div className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{dayTasks.length}</span>
                    </div>
                    <div className="space-y-1.5">
                      {dayTasks.map(task => (
                        <div key={task.id} className="flex items-center gap-3 px-3 py-2 rounded-xl border"
                          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', borderLeft: `3px solid ${PRIORITY_COLOR[task.priority]}` }}>
                          <button onClick={() => onToggleStatus(task)} style={{ color: task.status === 'done' ? '#22c55e' : 'var(--color-muted)', flexShrink: 0 }}>
                            {getIcon(task.status === 'done' ? 'check-circle' : 'circle', { size: 14 })}
                          </button>
                          <span className="flex-1 text-sm min-w-0 truncate" style={{ color: 'var(--color-text)', textDecoration: task.status === 'done' ? 'line-through' : 'none', opacity: task.status === 'done' ? 0.6 : 1 }}>{task.title}</span>
                          {task.dueDate?.includes('T') && <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{task.dueDate.slice(11, 16)}</span>}
                          <button onClick={() => onEdit(task)} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('edit', { size: 12 })}</button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {noteTooltip && (
        <div
          className="fixed z-[9999] pointer-events-none w-64 rounded-xl border shadow-xl px-3 py-2.5"
          style={{
            left: noteTooltip.x,
            top: noteTooltip.y,
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
          }}
        >
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {noteTooltip.notes.length > 300 ? noteTooltip.notes.slice(0, 300) + '…' : noteTooltip.notes}
          </p>
        </div>
      )}
      {/* Calendar header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        {calView !== 'range' && (
          <>
            <button
              onClick={() => navigate(-1)}
              className="w-7 h-7 flex items-center justify-center rounded-lg border hover:opacity-70 transition-opacity"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              {getIcon('chevron-right', { size: 14, style: { transform: 'rotate(180deg)' } })}
            </button>
            <button
              onClick={() => { setCurrentDate(new Date()); setSelectedKey(null); }}
              className="text-xs px-3 py-1 rounded-lg border hover:opacity-70 transition-opacity"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              Today
            </button>
            <button
              onClick={() => navigate(1)}
              className="w-7 h-7 flex items-center justify-center rounded-lg border hover:opacity-70 transition-opacity"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              {getIcon('chevron-right', { size: 14 })}
            </button>
          </>
        )}
        <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{headerTitle()}</span>
        {/* View tabs */}
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {[
            { key: 'day', label: 'Day' },
            { key: 'week', label: 'Week' },
            { key: 'month', label: 'Month' },
            { key: 'range', label: 'Range' },
          ].map((v, i) => (
            <button
              key={v.key}
              onClick={() => { setCalView(v.key); setSelectedKey(null); }}
              className="px-3 py-1.5 text-xs font-medium transition-all border-l first:border-l-0"
              style={{
                background: calView === v.key ? 'var(--color-primary)' : 'transparent',
                color: calView === v.key ? '#fff' : 'var(--color-muted)',
                borderColor: 'var(--color-border)',
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Calendar body */}
      {calView === 'month' && renderMonth()}
      {calView === 'week' && renderWeek()}
      {calView === 'day' && renderDay()}
      {calView === 'range' && renderRange()}
    </div>
  );
}
