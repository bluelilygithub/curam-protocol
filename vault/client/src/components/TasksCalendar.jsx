import { useState, useEffect, useRef, useCallback } from 'react';

const HOUR_HEIGHT = 64; // px per hour
const DAY_WIDTH = 160;  // px per day column in week view
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SNAP_MINUTES = 15;
const CAL_VIEW_KEY = 'tasksCalendarSubView';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseTaskDate(task) {
  if (!task.dueDate) return null;
  return new Date(task.dueDate);
}

function getTaskMinutes(task) {
  if (!task.dueDate || !task.dueDate.includes('T')) return null;
  const d = new Date(task.dueDate);
  return d.getHours() * 60 + d.getMinutes();
}

function formatHour(h) {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function snapToSlot(minutes) {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

const priorityBorder = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
const priorityBg = { high: '#ef444420', medium: '#f59e0b20', low: '#22c55e20' };

function TaskPopover({ task, onClose, onEdit, onToggleStatus, style }) {
  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', zIndex: 100, background: 'var(--bg-primary, #1a1a2e)',
        border: '1px solid var(--border, #333)', borderRadius: '0.5rem',
        padding: '0.75rem', width: '220px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        ...style,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary, #fff)', flex: 1, marginRight: '0.5rem' }}>{task.title}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted, #888)', padding: 0, fontSize: '0.9rem' }}>✕</button>
      </div>
      {task.notes && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginBottom: '0.5rem', lineHeight: 1.4 }}>{task.notes.slice(0, 120)}{task.notes.length > 120 ? '…' : ''}</p>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={() => { onToggleStatus(task); onClose(); }}
          style={{ flex: 1, padding: '0.375rem', fontSize: '0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border, #333)', cursor: 'pointer', background: task.status === 'done' ? '#22c55e22' : 'transparent', color: task.status === 'done' ? '#22c55e' : 'var(--text-secondary, #ccc)' }}
        >
          {task.status === 'done' ? '✓ Done' : 'Mark done'}
        </button>
        <button
          onClick={() => { onEdit(task); onClose(); }}
          style={{ flex: 1, padding: '0.375rem', fontSize: '0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border, #333)', cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary, #ccc)' }}
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function TaskBlock({ task, top, height, onEdit, onToggleStatus, onResizeEnd, draggingId, setDraggingId }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const resizeRef = useRef(null);
  const startY = useRef(null);
  const startHeight = useRef(null);
  const blockRef = useRef(null);

  function handlePointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    startY.current = e.clientY;
    startHeight.current = height;
    resizeRef.current = true;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  function handlePointerMove(e) {
    if (!resizeRef.current) return;
    const delta = e.clientY - startY.current;
    const newMins = snapToSlot(Math.max(15, Math.round((startHeight.current + delta) / HOUR_HEIGHT * 60)));
    if (blockRef.current) {
      blockRef.current.style.height = `${Math.max(20, (newMins / 60) * HOUR_HEIGHT)}px`;
    }
  }

  function handlePointerUp(e) {
    resizeRef.current = false;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    const delta = e.clientY - startY.current;
    const newMins = snapToSlot(Math.max(15, Math.round((startHeight.current + delta) / HOUR_HEIGHT * 60)));
    onResizeEnd(task.id, newMins);
  }

  const done = task.status === 'done';

  return (
    <div
      ref={blockRef}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('taskId', String(task.id));
        setDraggingId(task.id);
      }}
      onDragEnd={() => setDraggingId(null)}
      onClick={e => { e.stopPropagation(); setPopoverOpen(p => !p); }}
      style={{
        position: 'absolute',
        top: `${top}px`,
        left: '4px',
        right: '4px',
        height: `${height}px`,
        minHeight: '20px',
        background: priorityBg[task.priority] || 'rgba(99,102,241,0.15)',
        borderLeft: `3px solid ${priorityBorder[task.priority] || '#6366f1'}`,
        borderRadius: '0 0.375rem 0.375rem 0',
        padding: '2px 4px',
        overflow: 'hidden',
        cursor: 'grab',
        opacity: done ? 0.5 : draggingId === task.id ? 0.4 : 1,
        userSelect: 'none',
        boxSizing: 'border-box',
        zIndex: popoverOpen ? 50 : 10,
      }}
    >
      <span style={{
        fontSize: '0.7rem',
        fontWeight: 600,
        color: 'var(--text-primary, #fff)',
        display: 'block',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        textDecoration: done ? 'line-through' : 'none',
      }}>
        {task.title}
      </span>
      {/* Resize handle */}
      <div
        onPointerDown={handlePointerDown}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: '6px', cursor: 's-resize',
          background: 'transparent',
        }}
      />
      {popoverOpen && (
        <TaskPopover
          task={task}
          onClose={() => setPopoverOpen(false)}
          onEdit={onEdit}
          onToggleStatus={onToggleStatus}
          style={{ top: `${height + 2}px`, left: 0 }}
        />
      )}
    </div>
  );
}

function TimeGrid({ days, tasks, onNew, onReschedule, onEdit, onToggleStatus, onUpdateEffort }) {
  const [dragOver, setDragOver] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const timedByDay = days.map(day =>
    tasks.filter(t => {
      const d = parseTaskDate(t);
      return d && isSameDay(d, day) && getTaskMinutes(t) !== null;
    })
  );
  const untimedByDay = days.map(day =>
    tasks.filter(t => {
      const d = parseTaskDate(t);
      return d && isSameDay(d, day) && getTaskMinutes(t) === null;
    })
  );

  function handleDrop(e, dayIdx, slotMin) {
    e.preventDefault();
    setDragOver(null);
    const taskId = parseInt(e.dataTransfer.getData('taskId'));
    if (!taskId) return;
    const day = days[dayIdx];
    const h = String(Math.floor(slotMin / 60)).padStart(2, '0');
    const m = String(slotMin % 60).padStart(2, '0');
    onReschedule(taskId, `${dateKey(day)}T${h}:${m}`);
  }

  const todayIdx = days.findIndex(d => isSameDay(d, now));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Unscheduled panel */}
      {days.some((_, i) => untimedByDay[i].length > 0) && (
        <div style={{ borderBottom: '1px solid var(--border, #333)', padding: '0.5rem 0', flexShrink: 0 }}>
          <div style={{ display: 'flex' }}>
            <div style={{ width: '48px', flexShrink: 0, fontSize: '0.65rem', color: 'var(--text-muted, #888)', paddingTop: '4px', textAlign: 'right', paddingRight: '8px' }}>no time</div>
            {days.map((day, dIdx) => (
              <div
                key={dIdx}
                style={{ width: `${DAY_WIDTH}px`, flexShrink: 0, minHeight: '32px', padding: '2px', borderLeft: '1px solid var(--border, #333)', display: 'flex', flexWrap: 'wrap', gap: '2px' }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const taskId = parseInt(e.dataTransfer.getData('taskId'));
                  if (taskId) onReschedule(taskId, dateKey(day));
                }}
              >
                {untimedByDay[dIdx].map(task => (
                  <span
                    key={task.id}
                    draggable
                    onDragStart={e => e.dataTransfer.setData('taskId', String(task.id))}
                    onClick={() => onEdit(task)}
                    title={task.title}
                    style={{
                      fontSize: '0.65rem', fontWeight: 600,
                      padding: '1px 6px', borderRadius: '999px',
                      background: priorityBg[task.priority] || 'rgba(99,102,241,0.15)',
                      borderLeft: `2px solid ${priorityBorder[task.priority] || '#6366f1'}`,
                      color: 'var(--text-primary, #fff)',
                      cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: '100%',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      textDecoration: task.status === 'done' ? 'line-through' : 'none',
                      opacity: task.status === 'done' ? 0.5 : 1,
                    }}
                  >
                    {task.title}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scrollable time grid */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
        <div style={{ display: 'flex', minWidth: `${48 + DAY_WIDTH * days.length}px` }}>
          {/* Hour labels */}
          <div style={{ width: '48px', flexShrink: 0 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ height: `${HOUR_HEIGHT}px`, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: '8px', paddingTop: '2px', boxSizing: 'border-box', borderTop: '1px solid var(--border, #333)' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted, #888)' }}>{formatHour(h)}</span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day, dIdx) => (
            <div key={dIdx} style={{ width: `${DAY_WIDTH}px`, flexShrink: 0, position: 'relative', borderLeft: '1px solid var(--border, #333)' }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  style={{ height: `${HOUR_HEIGHT}px`, boxSizing: 'border-box', borderTop: '1px solid var(--border, #333)', position: 'relative' }}
                  onDragOver={e => { e.preventDefault(); setDragOver({ dayIdx: dIdx, h }); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={e => handleDrop(e, dIdx, snapToSlot(h * 60))}
                  onClick={() => onNew(`${dateKey(day)}T${String(h).padStart(2,'0')}:00`)}
                >
                  {/* Half-hour dashed line */}
                  <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: '1px dashed var(--border, #333)', opacity: 0.3, pointerEvents: 'none' }} />
                  {/* Drag highlight */}
                  {dragOver && dragOver.dayIdx === dIdx && dragOver.h === h && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(99,102,241,0.15)', pointerEvents: 'none', borderRadius: '2px' }} />
                  )}
                </div>
              ))}

              {/* Current time indicator */}
              {todayIdx === dIdx && (
                <div style={{
                  position: 'absolute',
                  top: `${(nowMinutes / 60) * HOUR_HEIGHT}px`,
                  left: 0, right: 0,
                  borderTop: '2px solid #ef4444',
                  zIndex: 20,
                  pointerEvents: 'none',
                }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', position: 'absolute', top: '-4px', left: '-4px' }} />
                </div>
              )}

              {/* Task blocks */}
              {timedByDay[dIdx].map(task => {
                const mins = getTaskMinutes(task);
                const top = (mins / 60) * HOUR_HEIGHT;
                const durMins = Math.max(task.estimatedMinutes || 30, 30);
                const height = (durMins / 60) * HOUR_HEIGHT;
                return (
                  <TaskBlock
                    key={task.id}
                    task={task}
                    top={top}
                    height={height}
                    onEdit={onEdit}
                    onToggleStatus={onToggleStatus}
                    onResizeEnd={onUpdateEffort}
                    draggingId={draggingId}
                    setDraggingId={setDraggingId}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DayView({ date, tasks, onNew, onReschedule, onEdit, onToggleStatus, onUpdateEffort }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ display: 'flex', borderBottom: '2px solid var(--border, #333)', paddingLeft: '48px', flexShrink: 0 }}>
        <div style={{ width: `${DAY_WIDTH}px`, flexShrink: 0, padding: '0.5rem', textAlign: 'center', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary, #fff)' }}>
          {DAYS[date.getDay()]} {date.getDate()}
        </div>
      </div>
      <TimeGrid days={[date]} tasks={tasks} onNew={onNew} onReschedule={onReschedule} onEdit={onEdit} onToggleStatus={onToggleStatus} onUpdateEffort={onUpdateEffort} />
    </div>
  );
}

function WeekView({ weekStart, tasks, onNew, onReschedule, onEdit, onToggleStatus, onUpdateEffort }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ display: 'flex', borderBottom: '2px solid var(--border, #333)', paddingLeft: '48px', flexShrink: 0 }}>
        {days.map((day, i) => (
          <div key={i} style={{
            width: `${DAY_WIDTH}px`, flexShrink: 0, padding: '0.5rem', textAlign: 'center',
            fontSize: '0.8rem', fontWeight: 600,
            color: isSameDay(day, today) ? 'var(--accent, #6366f1)' : 'var(--text-secondary, #ccc)',
            borderLeft: '1px solid var(--border, #333)',
            background: isSameDay(day, today) ? 'rgba(99,102,241,0.05)' : 'transparent',
          }}>
            {DAYS[day.getDay()]} {day.getDate()}
          </div>
        ))}
      </div>
      <TimeGrid days={days} tasks={tasks} onNew={onNew} onReschedule={onReschedule} onEdit={onEdit} onToggleStatus={onToggleStatus} onUpdateEffort={onUpdateEffort} />
    </div>
  );
}

function MonthView({ year, month, tasks, onNew, onReschedule, onEdit }) {
  const [dayPopover, setDayPopover] = useState(null);
  const today = new Date();

  const firstDay = new Date(year, month, 1);
  const startPad = firstDay.getDay();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length < 42) cells.push(null);

  function getTasksForDay(day) {
    if (!day) return [];
    return tasks.filter(t => { const d = parseTaskDate(t); return d && isSameDay(d, day); });
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '0.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: '0.25rem' }}>
        {DAYS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted, #888)', padding: '0.25rem' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {cells.map((day, i) => {
          const dayTasks = getTasksForDay(day);
          const isToday = day && isSameDay(day, today);
          return (
            <div
              key={i}
              onClick={() => day && onNew(dateKey(day))}
              style={{
                minHeight: '80px', padding: '4px',
                background: isToday ? 'rgba(99,102,241,0.08)' : day ? 'var(--bg-secondary, #252542)' : 'transparent',
                borderRadius: '0.375rem',
                border: isToday ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
                cursor: day ? 'pointer' : 'default',
              }}
              onDragOver={e => day && e.preventDefault()}
              onDrop={e => {
                if (!day) return;
                e.preventDefault();
                const taskId = parseInt(e.dataTransfer.getData('taskId'));
                if (taskId) onReschedule(taskId, dateKey(day));
              }}
            >
              {day && (
                <>
                  <div style={{ fontSize: '0.72rem', fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--accent, #6366f1)' : 'var(--text-muted, #888)', marginBottom: '3px' }}>{day.getDate()}</div>
                  {dayTasks.slice(0, 3).map(task => (
                    <div
                      key={task.id}
                      onClick={e => { e.stopPropagation(); onEdit(task); }}
                      draggable
                      onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('taskId', String(task.id)); }}
                      style={{
                        fontSize: '0.65rem', padding: '1px 4px', marginBottom: '2px',
                        borderRadius: '3px',
                        background: priorityBg[task.priority] || 'rgba(99,102,241,0.15)',
                        borderLeft: `2px solid ${priorityBorder[task.priority] || '#6366f1'}`,
                        color: 'var(--text-primary, #fff)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        textDecoration: task.status === 'done' ? 'line-through' : 'none',
                        opacity: task.status === 'done' ? 0.5 : 1,
                        cursor: 'pointer',
                      }}
                    >{task.title}</div>
                  ))}
                  {dayTasks.length > 3 && (
                    <div
                      onClick={e => { e.stopPropagation(); setDayPopover(day); }}
                      style={{ fontSize: '0.65rem', color: 'var(--text-muted, #888)', cursor: 'pointer' }}
                    >+{dayTasks.length - 3} more</div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {dayPopover && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setDayPopover(null)}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-primary, #1a1a2e)', border: '1px solid var(--border, #333)', borderRadius: '0.75rem', padding: '1rem', maxWidth: '320px', width: '100%', maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary, #fff)', fontSize: '0.9rem' }}>
                {DAYS[dayPopover.getDay()]}, {dayPopover.toLocaleDateString('en-AU', { month: 'long', day: 'numeric' })}
              </span>
              <button onClick={() => setDayPopover(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted, #888)' }}>✕</button>
            </div>
            {getTasksForDay(dayPopover).map(task => (
              <div
                key={task.id}
                onClick={() => { onEdit(task); setDayPopover(null); }}
                style={{ padding: '0.5rem', borderRadius: '0.375rem', marginBottom: '0.375rem', background: 'var(--bg-secondary, #252542)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <div style={{ width: '3px', height: '24px', borderRadius: '2px', background: priorityBorder[task.priority] || '#6366f1', flexShrink: 0 }} />
                <span style={{ fontSize: '0.82rem', color: 'var(--text-primary, #fff)' }}>{task.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AgendaView({ tasks, onEdit, onToggleStatus }) {
  const today = startOfDay(new Date());
  const end = addDays(today, 30);

  const tasksByDay = [];
  for (let d = new Date(today); d <= end; d = addDays(d, 1)) {
    const dayTasks = tasks.filter(t => { const td = parseTaskDate(t); return td && isSameDay(td, d); });
    if (dayTasks.length > 0) tasksByDay.push({ date: new Date(d), tasks: dayTasks });
  }

  if (tasksByDay.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted, #888)', fontSize: '0.85rem' }}>
        No tasks in the next 30 days
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
      {tasksByDay.map(({ date, tasks: dayTasks }) => (
        <div key={dateKey(date)} style={{ marginBottom: '1.25rem' }}>
          <div style={{
            fontSize: '0.78rem', fontWeight: 700,
            color: isSameDay(date, new Date()) ? 'var(--accent, #6366f1)' : 'var(--text-muted, #888)',
            marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {isSameDay(date, new Date()) ? 'Today — ' : ''}{date.toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
          {dayTasks.map(task => (
            <div
              key={task.id}
              onClick={() => onEdit(task)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.5rem 0.75rem', borderRadius: '0.375rem', marginBottom: '0.375rem',
                background: 'var(--bg-secondary, #252542)', cursor: 'pointer',
                opacity: task.status === 'done' ? 0.5 : 1,
              }}
            >
              <button
                onClick={e => { e.stopPropagation(); onToggleStatus(task); }}
                style={{
                  width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${priorityBorder[task.priority] || '#6366f1'}`,
                  background: task.status === 'done' ? (priorityBorder[task.priority] || '#6366f1') : 'transparent',
                  cursor: 'pointer',
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-primary, #fff)', textDecoration: task.status === 'done' ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {task.title}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '2px' }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted, #888)' }}>{task.priority}</span>
                  {task.dueDate?.includes('T') && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted, #888)' }}>{task.dueDate.slice(11, 16)}</span>}
                  {task.category && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted, #888)' }}>{task.category}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function TasksCalendar({ tasks, projects, onEdit, onToggleStatus, onNew, onReschedule, onUpdateEffort }) {
  const [subView, setSubView] = useState(() => {
    try { return localStorage.getItem(CAL_VIEW_KEY) || 'week'; } catch { return 'week'; }
  });
  const [currentDate, setCurrentDate] = useState(new Date());

  useEffect(() => {
    try { localStorage.setItem(CAL_VIEW_KEY, subView); } catch { }
  }, [subView]);

  function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function navigate(dir) {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (subView === 'day') d.setDate(d.getDate() + dir);
      else if (subView === 'week') d.setDate(d.getDate() + dir * 7);
      else if (subView === 'month') d.setMonth(d.getMonth() + dir);
      return d;
    });
  }

  function getNavLabel() {
    if (subView === 'day') return currentDate.toLocaleDateString('en-AU', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (subView === 'week') {
      const ws = getWeekStart(currentDate);
      const we = addDays(ws, 6);
      if (ws.getMonth() === we.getMonth()) return `${ws.getDate()}–${we.getDate()} ${MONTH_NAMES[ws.getMonth()]} ${ws.getFullYear()}`;
      return `${ws.getDate()} ${MONTH_NAMES[ws.getMonth()].slice(0,3)} – ${we.getDate()} ${MONTH_NAMES[we.getMonth()].slice(0,3)} ${we.getFullYear()}`;
    }
    if (subView === 'month') return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    return 'Next 30 days';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-primary, #1a1a2e)' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border, #333)', flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--bg-secondary, #252542)', borderRadius: '0.5rem', padding: '2px' }}>
          {['day', 'week', 'month', 'agenda'].map(v => (
            <button
              key={v}
              onClick={() => setSubView(v)}
              style={{
                padding: '0.3rem 0.65rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer',
                fontSize: '0.75rem', fontWeight: 600, textTransform: 'capitalize',
                background: subView === v ? 'var(--accent, #6366f1)' : 'transparent',
                color: subView === v ? '#fff' : 'var(--text-muted, #888)',
                transition: 'all 0.15s',
              }}
            >
              {v}
            </button>
          ))}
        </div>

        {subView !== 'agenda' && (
          <>
            <button onClick={() => navigate(-1)} style={{ background: 'none', border: '1px solid var(--border, #333)', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--text-secondary, #ccc)', padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}>‹</button>
            <button onClick={() => setCurrentDate(new Date())} style={{ background: 'none', border: '1px solid var(--border, #333)', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--text-secondary, #ccc)', padding: '0.3rem 0.65rem', fontSize: '0.75rem', fontWeight: 600 }}>Today</button>
            <button onClick={() => navigate(1)} style={{ background: 'none', border: '1px solid var(--border, #333)', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--text-secondary, #ccc)', padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}>›</button>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary, #fff)' }}>{getNavLabel()}</span>
          </>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {subView === 'day' && (
          <DayView date={startOfDay(currentDate)} tasks={tasks} onNew={onNew} onReschedule={onReschedule} onEdit={onEdit} onToggleStatus={onToggleStatus} onUpdateEffort={onUpdateEffort} />
        )}
        {subView === 'week' && (
          <WeekView weekStart={getWeekStart(currentDate)} tasks={tasks} onNew={onNew} onReschedule={onReschedule} onEdit={onEdit} onToggleStatus={onToggleStatus} onUpdateEffort={onUpdateEffort} />
        )}
        {subView === 'month' && (
          <MonthView year={currentDate.getFullYear()} month={currentDate.getMonth()} tasks={tasks} onNew={onNew} onReschedule={onReschedule} onEdit={onEdit} />
        )}
        {subView === 'agenda' && (
          <AgendaView tasks={tasks} onEdit={onEdit} onToggleStatus={onToggleStatus} />
        )}
      </div>
    </div>
  );
}
