import { useState, useEffect, useRef } from 'react';

const HOUR_HEIGHT = 64;
const TIME_COL_WIDTH = 56;
const SIDEBAR_WIDTH = 280;
const SNAP_MINUTES = 15;
const CAL_VIEW_KEY = 'tasksCalendarSubView';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ─── Utilities ────────────────────────────────────────────────────────────────

function startOfDay(d) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function isSameDay(a, b) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function parseTaskDate(task) { return task.dueDate ? new Date(task.dueDate) : null; }
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
function snapToSlot(min) { return Math.round(min / SNAP_MINUTES) * SNAP_MINUTES; }

const priorityBorder = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
const priorityBg    = { high: '#ef444420', medium: '#f59e0b20', low: '#22c55e20' };

// Greedy column-layout for overlapping timed events within a single day
function layoutTimedEvents(events) {
  if (!events.length) return [];
  const sorted = [...events].sort((a, b) => getTaskMinutes(a) - getTaskMinutes(b));
  const colEnds = [];
  const assigned = sorted.map(event => {
    const start = getTaskMinutes(event);
    const dur   = Math.max(event.estimatedMinutes || 30, 30);
    const end   = start + dur;
    let col = colEnds.findIndex(e => e <= start);
    if (col === -1) { col = colEnds.length; colEnds.push(end); }
    else colEnds[col] = end;
    return { event, col };
  });
  const totalCols = Math.max(colEnds.length, 1);
  return assigned.map(({ event, col }) => ({
    event,
    leftFrac:  col / totalCols,
    widthFrac: 1 / totalCols,
  }));
}

// ─── TaskPopover ──────────────────────────────────────────────────────────────

function TaskPopover({ task, onClose, onEdit, onToggleStatus, style }) {
  return (
    <div
      data-task-popover
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', zIndex: 300,
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: '0.5rem',
        padding: '0.75rem',
        width: '220px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        ...style,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--color-text)', flex: 1, marginRight: '0.5rem' }}>{task.title}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: 0, fontSize: '0.9rem' }}>✕</button>
      </div>
      {task.notes && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginBottom: '0.5rem', lineHeight: 1.4 }}>
          {task.notes.slice(0, 120)}{task.notes.length > 120 ? '…' : ''}
        </p>
      )}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={() => { onToggleStatus(task); onClose(); }}
          style={{ flex: 1, padding: '0.375rem', fontSize: '0.75rem', borderRadius: '0.375rem', border: '1px solid var(--color-border)', cursor: 'pointer', background: task.status === 'done' ? '#22c55e22' : 'transparent', color: task.status === 'done' ? '#22c55e' : 'var(--color-text)' }}
        >
          {task.status === 'done' ? '✓ Done' : 'Mark done'}
        </button>
        <button
          onClick={() => { onEdit(task); onClose(); }}
          style={{ flex: 1, padding: '0.375rem', fontSize: '0.75rem', borderRadius: '0.375rem', border: '1px solid var(--color-border)', cursor: 'pointer', background: 'transparent', color: 'var(--color-text)' }}
        >
          Edit
        </button>
      </div>
    </div>
  );
}

// ─── TaskBlock ────────────────────────────────────────────────────────────────

function TaskBlock({ task, top, height, leftPct, widthPct, onEdit, onToggleStatus, onResizeEnd, draggingId, setDraggingId }) {
  const [popoverPos, setPopoverPos] = useState(null);
  const resizingRef  = useRef(false);
  const startY       = useRef(0);
  const startHeight  = useRef(0);
  const blockRef     = useRef(null);

  useEffect(() => {
    if (!popoverPos) return;
    const handler = e => { if (!e.target.closest('[data-task-popover]')) setPopoverPos(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popoverPos]);

  function handlePointerDown(e) {
    e.preventDefault(); e.stopPropagation();
    resizingRef.current = true;
    startY.current = e.clientY;
    startHeight.current = height;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
  function onMove(e) {
    if (!resizingRef.current) return;
    const delta   = e.clientY - startY.current;
    const newMins = snapToSlot(Math.max(15, Math.round((startHeight.current + delta) / HOUR_HEIGHT * 60)));
    if (blockRef.current) blockRef.current.style.height = `${Math.max(20, newMins / 60 * HOUR_HEIGHT)}px`;
  }
  function onUp(e) {
    resizingRef.current = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const delta   = e.clientY - startY.current;
    const newMins = snapToSlot(Math.max(15, Math.round((startHeight.current + delta) / HOUR_HEIGHT * 60)));
    onResizeEnd(task.id, newMins);
  }

  const done = task.status === 'done';

  return (
    <div
      ref={blockRef}
      draggable
      onDragStart={e => { e.dataTransfer.setData('taskId', String(task.id)); setDraggingId(task.id); }}
      onDragEnd={() => setDraggingId(null)}
      onClick={e => {
        e.stopPropagation();
        if (popoverPos) { setPopoverPos(null); return; }
        const r = e.currentTarget.getBoundingClientRect();
        setPopoverPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 240) });
      }}
      style={{
        position:   'absolute',
        top:        `${top}px`,
        left:       `calc(${leftPct * 100}% + 2px)`,
        width:      `calc(${widthPct * 100}% - 4px)`,
        height:     `${height}px`,
        minHeight:  '20px',
        background: priorityBg[task.priority] || 'rgba(99,102,241,0.15)',
        borderLeft: `3px solid ${priorityBorder[task.priority] || '#6366f1'}`,
        borderRadius: '0 4px 4px 0',
        padding:    '2px 4px',
        cursor:     'grab',
        opacity:    done ? 0.5 : draggingId === task.id ? 0.4 : 1,
        userSelect: 'none',
        boxSizing:  'border-box',
        zIndex:     popoverPos ? 50 : 10,
        overflow:   'hidden',
      }}
    >
      <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: done ? 'line-through' : 'none' }}>
        {task.title}
      </span>
      <div
        onPointerDown={handlePointerDown}
        onClick={e => e.stopPropagation()}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '6px', cursor: 's-resize' }}
      />
      {popoverPos && (
        <TaskPopover
          task={task}
          onClose={() => setPopoverPos(null)}
          onEdit={t => { onEdit(t); setPopoverPos(null); }}
          onToggleStatus={t => { onToggleStatus(t); setPopoverPos(null); }}
          style={popoverPos}
        />
      )}
    </div>
  );
}

// ─── MiniCalendar ─────────────────────────────────────────────────────────────

function MiniCalendar({ viewDate, subView, onSelectDate, getWeekStart }) {
  const [miniYear,  setMiniYear]  = useState(viewDate.getFullYear());
  const [miniMonth, setMiniMonth] = useState(viewDate.getMonth());
  const today = new Date();

  useEffect(() => {
    setMiniYear(viewDate.getFullYear());
    setMiniMonth(viewDate.getMonth());
  }, [viewDate.getFullYear(), viewDate.getMonth()]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstDayOfWeek = new Date(miniYear, miniMonth, 1).getDay();
  const daysInMonth    = new Date(miniYear, miniMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(miniYear, miniMonth, d));
  while (cells.length % 7 !== 0) cells.push(null);

  function isHighlighted(day) {
    if (!day) return false;
    if (subView === 'day') return isSameDay(day, viewDate);
    if (subView === 'week') {
      const ws = startOfDay(getWeekStart(viewDate));
      const we = startOfDay(addDays(ws, 6));
      const sd = startOfDay(day);
      return sd >= ws && sd <= we;
    }
    if (subView === 'month') return day.getMonth() === viewDate.getMonth() && day.getFullYear() === viewDate.getFullYear();
    return false;
  }

  function prevMonth() {
    if (miniMonth === 0) { setMiniYear(y => y - 1); setMiniMonth(11); }
    else setMiniMonth(m => m - 1);
  }
  function nextMonth() {
    if (miniMonth === 11) { setMiniYear(y => y + 1); setMiniMonth(0); }
    else setMiniMonth(m => m + 1);
  }

  return (
    <div style={{ padding: '12px 10px 0', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text)' }}>
          {MONTH_NAMES[miniMonth].slice(0, 3)} {miniYear}
        </span>
        <div style={{ display: 'flex', gap: '2px' }}>
          <button onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: '2px 5px', fontSize: '0.85rem', borderRadius: '4px' }}>‹</button>
          <button onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: '2px 5px', fontSize: '0.85rem', borderRadius: '4px' }}>›</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: '2px' }}>
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-muted)', padding: '2px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((day, i) => {
          const isToday   = day && isSameDay(day, today);
          const highlight = isHighlighted(day);
          return (
            <div
              key={i}
              onClick={() => day && onSelectDate(day)}
              style={{ textAlign: 'center', padding: '1px 0', cursor: day ? 'pointer' : 'default' }}
            >
              {day && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '24px', height: '24px', borderRadius: '50%',
                  fontSize: '0.7rem', fontWeight: isToday ? 700 : 400,
                  background: isToday
                    ? 'var(--color-primary)'
                    : highlight
                    ? 'rgba(var(--color-primary-rgb,99,102,241),0.15)'
                    : 'transparent',
                  color: isToday ? '#fff' : highlight ? 'var(--color-primary)' : 'var(--color-text)',
                  transition: 'background 0.1s',
                }}>
                  {day.getDate()}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── UntimedList ──────────────────────────────────────────────────────────────

function UntimedList({ tasks, days, onEdit, onToggleStatus }) {
  const untimed = tasks.filter(t => {
    const d = parseTaskDate(t);
    return d && days.some(day => isSameDay(d, day)) && getTaskMinutes(t) === null;
  });

  if (untimed.length === 0) {
    return (
      <div style={{ padding: '8px 12px', fontSize: '0.7rem', color: 'var(--color-muted)', opacity: 0.6 }}>
        No tasks without a set time
      </div>
    );
  }

  return (
    <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {untimed.map(task => (
        <div
          key={task.id}
          onClick={() => onEdit(task)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '4px 6px', borderRadius: '6px',
            background: priorityBg[task.priority] || 'rgba(99,102,241,0.1)',
            borderLeft: `3px solid ${priorityBorder[task.priority] || '#6366f1'}`,
            cursor: 'pointer',
            opacity: task.status === 'done' ? 0.5 : 1,
          }}
        >
          <button
            onClick={e => { e.stopPropagation(); onToggleStatus(task); }}
            style={{
              width: '14px', height: '14px', borderRadius: '50%', flexShrink: 0,
              border: `1.5px solid ${priorityBorder[task.priority] || '#6366f1'}`,
              background: task.status === 'done' ? (priorityBorder[task.priority] || '#6366f1') : 'transparent',
              cursor: 'pointer', padding: 0,
            }}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: task.status === 'done' ? 'line-through' : 'none', flex: 1, minWidth: 0 }}>
            {task.title}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── CalendarSidebar ──────────────────────────────────────────────────────────

function CalendarSidebar({ viewDate, subView, tasks, days, onSelectDate, onEdit, onToggleStatus, getWeekStart }) {
  return (
    <div style={{
      width:      `${SIDEBAR_WIDTH}px`,
      flexShrink: 0,
      borderLeft: '1px solid var(--color-border)',
      display:    'flex',
      flexDirection: 'column',
      overflow:   'hidden',
      background: 'var(--color-surface)',
    }}>
      <MiniCalendar
        viewDate={viewDate}
        subView={subView}
        onSelectDate={onSelectDate}
        getWeekStart={getWeekStart}
      />
      <div style={{ margin: '12px 10px 6px', borderTop: '1px solid var(--color-border)', paddingTop: '10px' }}>
        <span style={{ fontSize: '0.67rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', paddingLeft: '4px' }}>
          No time set
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <UntimedList tasks={tasks} days={days} onEdit={onEdit} onToggleStatus={onToggleStatus} />
      </div>
    </div>
  );
}

// ─── TimeGrid ─────────────────────────────────────────────────────────────────
// Shared by DayView (days.length === 1) and WeekView (days.length === 7).
// Day view: no all-day row (untimed tasks live in sidebar).
// Week view: all-day row above the grid shows untimed pills (2 per column + overflow).

function TimeGrid({ days, tasks, onNew, onReschedule, onEdit, onToggleStatus, onUpdateEffort }) {
  const [dragOver,   setDragOver]   = useState(null); // { dayIdx, h }
  const [draggingId, setDraggingId] = useState(null);
  const [now,        setNow]        = useState(new Date());
  const scrollRef = useRef(null);

  useEffect(() => {
    // Scroll to 7 AM on mount
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_HEIGHT - 24;
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isDayView  = days.length === 1;
  const todayIdx   = days.findIndex(d => isSameDay(d, now));

  // Timed events per day
  const timedByDay   = days.map(day => tasks.filter(t => { const d = parseTaskDate(t); return d && isSameDay(d, day) && getTaskMinutes(t) !== null; }));
  // Untimed events per day (for the all-day row in week view)
  const untimedByDay = days.map(day => tasks.filter(t => { const d = parseTaskDate(t); return d && isSameDay(d, day) && getTaskMinutes(t) === null; }));
  const showAllDayRow = !isDayView && untimedByDay.some(a => a.length > 0);

  function handleDrop(e, dayIdx, slotMin) {
    e.preventDefault(); setDragOver(null);
    const taskId = parseInt(e.dataTransfer.getData('taskId'));
    if (!taskId) return;
    const day = days[dayIdx];
    onReschedule(taskId, `${dateKey(day)}T${String(Math.floor(slotMin/60)).padStart(2,'0')}:${String(slotMin%60).padStart(2,'0')}`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

      {/* All-day row (week view only) */}
      {showAllDayRow && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0, background: 'var(--color-surface)' }}>
          <div style={{ width: `${TIME_COL_WIDTH}px`, flexShrink: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', paddingRight: '8px', paddingBottom: '4px' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--color-muted)' }}>all day</span>
          </div>
          {days.map((day, dIdx) => (
            <div
              key={dIdx}
              style={{ flex: 1, minHeight: '30px', padding: '3px 2px', borderLeft: '1px solid var(--color-border)', display: 'flex', flexWrap: 'wrap', gap: '2px', alignContent: 'flex-start' }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const id = parseInt(e.dataTransfer.getData('taskId')); if (id) onReschedule(id, dateKey(day)); }}
            >
              {untimedByDay[dIdx].slice(0, 2).map(task => (
                <span
                  key={task.id}
                  draggable
                  onDragStart={e => e.dataTransfer.setData('taskId', String(task.id))}
                  onClick={e => { e.stopPropagation(); onEdit(task); }}
                  style={{
                    fontSize: '0.62rem', fontWeight: 600,
                    padding: '1px 5px', borderRadius: '999px',
                    background: priorityBg[task.priority] || 'rgba(99,102,241,0.15)',
                    borderLeft: `2px solid ${priorityBorder[task.priority] || '#6366f1'}`,
                    color: 'var(--color-text)',
                    cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: '98%',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    textDecoration: task.status === 'done' ? 'line-through' : 'none',
                    opacity: task.status === 'done' ? 0.5 : 1,
                  }}
                >{task.title}</span>
              ))}
              {untimedByDay[dIdx].length > 2 && (
                <span style={{ fontSize: '0.6rem', color: 'var(--color-muted)', padding: '1px 3px' }}>
                  +{untimedByDay[dIdx].length - 2}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Scrollable time grid */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ display: 'flex', height: `${24 * HOUR_HEIGHT}px` }}>

          {/* Time labels */}
          <div style={{ width: `${TIME_COL_WIDTH}px`, flexShrink: 0, position: 'relative', zIndex: 2 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                style={{ position: 'absolute', top: `${h * HOUR_HEIGHT}px`, left: 0, right: 0, height: `${HOUR_HEIGHT}px`, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: '8px', paddingTop: '2px', boxSizing: 'border-box' }}
              >
                {h > 0 && <span style={{ fontSize: '0.62rem', color: 'var(--color-muted)' }}>{formatHour(h)}</span>}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day, dIdx) => {
            const layouts = layoutTimedEvents(timedByDay[dIdx]);
            return (
              <div key={dIdx} style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--color-border)', minWidth: 0 }}>

                {/* Hour cells */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    style={{ position: 'absolute', top: `${h * HOUR_HEIGHT}px`, left: 0, right: 0, height: `${HOUR_HEIGHT}px`, borderTop: '1px solid var(--color-border)', boxSizing: 'border-box' }}
                  >
                    <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: '1px dashed var(--color-border)', opacity: 0.3, pointerEvents: 'none' }} />
                    <div
                      style={{ position: 'absolute', inset: 0, cursor: 'cell', background: dragOver?.dayIdx === dIdx && dragOver?.h === h ? 'rgba(var(--color-primary-rgb,99,102,241),0.1)' : 'transparent' }}
                      onDragOver={e => { e.preventDefault(); setDragOver({ dayIdx: dIdx, h }); }}
                      onDragLeave={() => setDragOver(null)}
                      onDrop={e => handleDrop(e, dIdx, snapToSlot(h * 60))}
                      onClick={() => onNew(`${dateKey(day)}T${String(h).padStart(2,'0')}:00`)}
                    />
                  </div>
                ))}

                {/* Current time indicator */}
                {todayIdx === dIdx && (
                  <div style={{ position: 'absolute', top: `${(nowMinutes / 60) * HOUR_HEIGHT}px`, left: 0, right: 0, zIndex: 20, pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', top: '-4px', left: '-4px', width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
                    <div style={{ borderTop: '2px solid #ef4444' }} />
                  </div>
                )}

                {/* Task blocks */}
                {layouts.map(({ event: task, leftFrac, widthFrac }) => {
                  const mins   = getTaskMinutes(task);
                  const top    = (mins / 60) * HOUR_HEIGHT;
                  const height = Math.max(20, (Math.max(task.estimatedMinutes || 30, 30) / 60) * HOUR_HEIGHT);
                  return (
                    <TaskBlock
                      key={task.id}
                      task={task}
                      top={top}
                      height={height}
                      leftPct={leftFrac}
                      widthPct={widthFrac}
                      onEdit={onEdit}
                      onToggleStatus={onToggleStatus}
                      onResizeEnd={onUpdateEffort}
                      draggingId={draggingId}
                      setDraggingId={setDraggingId}
                    />
                  );
                })}

              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── DayView ──────────────────────────────────────────────────────────────────

function DayView({ date, tasks, onNew, onReschedule, onEdit, onToggleStatus, onUpdateEffort }) {
  const isToday = isSameDay(date, new Date());
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Column header */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0, background: 'var(--color-surface)' }}>
        <div style={{ width: `${TIME_COL_WIDTH}px`, flexShrink: 0 }} />
        <div style={{ flex: 1, padding: '6px 0', textAlign: 'center', borderLeft: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: isToday ? 'var(--color-primary)' : 'var(--color-muted)' }}>
            {DAYS[date.getDay()]}
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '34px', height: '34px', borderRadius: '50%', margin: '2px auto 0',
            fontSize: '1.05rem', fontWeight: 700,
            background: isToday ? 'var(--color-primary)' : 'transparent',
            color: isToday ? '#fff' : 'var(--color-text)',
          }}>
            {date.getDate()}
          </div>
        </div>
      </div>
      <TimeGrid days={[date]} tasks={tasks} onNew={onNew} onReschedule={onReschedule} onEdit={onEdit} onToggleStatus={onToggleStatus} onUpdateEffort={onUpdateEffort} />
    </div>
  );
}

// ─── WeekView ─────────────────────────────────────────────────────────────────

function WeekView({ weekStart, tasks, onNew, onReschedule, onEdit, onToggleStatus, onUpdateEffort }) {
  const days  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Column headers */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0, background: 'var(--color-surface)' }}>
        <div style={{ width: `${TIME_COL_WIDTH}px`, flexShrink: 0 }} />
        {days.map((day, i) => {
          const isToday = isSameDay(day, today);
          return (
            <div key={i} style={{ flex: 1, padding: '6px 0', textAlign: 'center', borderLeft: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: isToday ? 'var(--color-primary)' : 'var(--color-muted)' }}>
                {DAYS[day.getDay()]}
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '28px', height: '28px', borderRadius: '50%', margin: '2px auto 0',
                fontSize: '0.88rem', fontWeight: isToday ? 700 : 400,
                background: isToday ? 'var(--color-primary)' : 'transparent',
                color: isToday ? '#fff' : 'var(--color-text)',
              }}>
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      <TimeGrid days={days} tasks={tasks} onNew={onNew} onReschedule={onReschedule} onEdit={onEdit} onToggleStatus={onToggleStatus} onUpdateEffort={onUpdateEffort} />
    </div>
  );
}

// ─── MonthView ────────────────────────────────────────────────────────────────

function MonthView({ year, month, tasks, onNew, onReschedule, onEdit, onToggleStatus }) {
  const [taskPopover, setTaskPopover] = useState(null); // { task, top, left }
  const [overflowDay, setOverflowDay] = useState(null); // Date
  const today = new Date();

  useEffect(() => {
    if (!taskPopover) return;
    const handler = e => { if (!e.target.closest('[data-task-popover]')) setTaskPopover(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [taskPopover]);

  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth    = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  function getTasksForDay(day) {
    if (!day) return [];
    return tasks.filter(t => { const d = parseTaskDate(t); return d && isSameDay(d, day); });
  }

  const MAX_VISIBLE = 3;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', flexShrink: 0, borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
        {DAYS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-muted)', padding: '6px 0' }}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: 'minmax(96px, auto)' }}>
          {cells.map((day, i) => {
            const dayTasks = getTasksForDay(day);
            const isToday  = day && isSameDay(day, today);
            const overflow = dayTasks.length - MAX_VISIBLE;
            return (
              <div
                key={i}
                onClick={() => day && onNew(dateKey(day))}
                style={{
                  borderRight:  '1px solid var(--color-border)',
                  borderBottom: '1px solid var(--color-border)',
                  padding:      '4px',
                  background:   isToday ? 'rgba(var(--color-primary-rgb,99,102,241),0.04)' : 'transparent',
                  cursor:       day ? 'pointer' : 'default',
                  overflow:     'hidden',
                }}
                onDragOver={e => day && e.preventDefault()}
                onDrop={e => {
                  if (!day) return; e.preventDefault();
                  const id = parseInt(e.dataTransfer.getData('taskId'));
                  if (id) onReschedule(id, dateKey(day));
                }}
              >
                {day && (
                  <>
                    <div style={{ marginBottom: '3px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: '22px', height: '22px', borderRadius: '50%',
                        fontSize: '0.72rem', fontWeight: isToday ? 700 : 400,
                        background: isToday ? 'var(--color-primary)' : 'transparent',
                        color:      isToday ? '#fff'                 : 'var(--color-text)',
                      }}>
                        {day.getDate()}
                      </span>
                    </div>
                    {dayTasks.slice(0, MAX_VISIBLE).map(task => (
                      <div
                        key={task.id}
                        onClick={e => {
                          e.stopPropagation();
                          const r = e.currentTarget.getBoundingClientRect();
                          setTaskPopover({ task, top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 240) });
                        }}
                        draggable
                        onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('taskId', String(task.id)); }}
                        style={{
                          fontSize: '0.65rem', padding: '1px 5px', marginBottom: '2px',
                          borderRadius: '3px',
                          background: priorityBg[task.priority] || 'rgba(99,102,241,0.15)',
                          borderLeft: `2px solid ${priorityBorder[task.priority] || '#6366f1'}`,
                          color: 'var(--color-text)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          textDecoration: task.status === 'done' ? 'line-through' : 'none',
                          opacity: task.status === 'done' ? 0.5 : 1,
                          cursor: 'pointer',
                        }}
                      >{task.title}</div>
                    ))}
                    {overflow > 0 && (
                      <div
                        onClick={e => { e.stopPropagation(); setOverflowDay(day); }}
                        style={{ fontSize: '0.65rem', color: 'var(--color-primary)', cursor: 'pointer', fontWeight: 500, padding: '0 2px' }}
                      >+{overflow} more</div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Task popover */}
      {taskPopover && (
        <div data-task-popover>
          <TaskPopover
            task={taskPopover.task}
            onClose={() => setTaskPopover(null)}
            onEdit={t => { onEdit(t); setTaskPopover(null); }}
            onToggleStatus={t => { onToggleStatus(t); setTaskPopover(null); }}
            style={{ top: taskPopover.top, left: taskPopover.left }}
          />
        </div>
      )}

      {/* Overflow day modal */}
      {overflowDay && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setOverflowDay(null)}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '0.75rem', padding: '1rem', maxWidth: '320px', width: '100%', maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: '0.9rem' }}>
                {DAYS[overflowDay.getDay()]}, {overflowDay.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
              </span>
              <button onClick={() => setOverflowDay(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)' }}>✕</button>
            </div>
            {getTasksForDay(overflowDay).map(task => (
              <div
                key={task.id}
                onClick={() => { onEdit(task); setOverflowDay(null); }}
                style={{ padding: '0.5rem', borderRadius: '0.375rem', marginBottom: '0.375rem', background: 'var(--color-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <div style={{ width: '3px', height: '24px', borderRadius: '2px', background: priorityBorder[task.priority] || '#6366f1', flexShrink: 0 }} />
                <span style={{ fontSize: '0.82rem', color: 'var(--color-text)' }}>{task.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AgendaView ───────────────────────────────────────────────────────────────

function AgendaView({ tasks, onEdit, onToggleStatus }) {
  const today = startOfDay(new Date());
  const end   = addDays(today, 30);
  const tasksByDay = [];
  for (let d = new Date(today); d <= end; d = addDays(d, 1)) {
    const dayTasks = tasks.filter(t => { const td = parseTaskDate(t); return td && isSameDay(td, d); });
    if (dayTasks.length > 0) tasksByDay.push({ date: new Date(d), tasks: dayTasks });
  }
  if (tasksByDay.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-muted)', fontSize: '0.85rem' }}>
        No tasks in the next 30 days
      </div>
    );
  }
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
      {tasksByDay.map(({ date, tasks: dayTasks }) => (
        <div key={dateKey(date)} style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: isSameDay(date, new Date()) ? 'var(--color-primary)' : 'var(--color-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {isSameDay(date, new Date()) ? 'Today — ' : ''}{date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
          {dayTasks.map(task => (
            <div
              key={task.id}
              onClick={() => onEdit(task)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', marginBottom: '0.375rem', background: 'var(--color-surface)', cursor: 'pointer', opacity: task.status === 'done' ? 0.5 : 1 }}
            >
              <button
                onClick={e => { e.stopPropagation(); onToggleStatus(task); }}
                style={{ width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0, border: `2px solid ${priorityBorder[task.priority] || '#6366f1'}`, background: task.status === 'done' ? (priorityBorder[task.priority] || '#6366f1') : 'transparent', cursor: 'pointer' }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--color-text)', textDecoration: task.status === 'done' ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '2px' }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--color-muted)' }}>{task.priority}</span>
                  {task.dueDate?.includes('T') && <span style={{ fontSize: '0.68rem', color: 'var(--color-muted)' }}>{task.dueDate.slice(11, 16)}</span>}
                  {task.category && <span style={{ fontSize: '0.68rem', color: 'var(--color-muted)' }}>{task.category}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── TasksCalendar (root export) ──────────────────────────────────────────────

export default function TasksCalendar({ tasks, projects, onEdit, onToggleStatus, onNew, onReschedule, onUpdateEffort }) {
  const [subView,     setSubView]     = useState(() => { try { return localStorage.getItem(CAL_VIEW_KEY) || 'week'; } catch { return 'week'; } });
  const [currentDate, setCurrentDate] = useState(new Date());
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => { try { localStorage.setItem(CAL_VIEW_KEY, subView); } catch {} }, [subView]);

  function getWeekStart(date) {
    const d   = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function navigate(dir) {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (subView === 'day')   d.setDate(d.getDate() + dir);
      if (subView === 'week')  d.setDate(d.getDate() + dir * 7);
      if (subView === 'month') d.setMonth(d.getMonth() + dir);
      return d;
    });
  }

  function getNavLabel() {
    if (subView === 'day')   return currentDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (subView === 'week') {
      const ws = getWeekStart(currentDate), we = addDays(ws, 6);
      if (ws.getMonth() === we.getMonth()) return `${ws.getDate()}–${we.getDate()} ${MONTH_NAMES[ws.getMonth()]} ${ws.getFullYear()}`;
      return `${ws.getDate()} ${MONTH_NAMES[ws.getMonth()].slice(0,3)} – ${we.getDate()} ${MONTH_NAMES[we.getMonth()].slice(0,3)} ${we.getFullYear()}`;
    }
    if (subView === 'month') return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    return 'Next 30 days';
  }

  // Days shown in the sidebar's UntimedList
  function getSidebarDays() {
    if (subView === 'day')   return [startOfDay(currentDate)];
    if (subView === 'week')  return Array.from({ length: 7 }, (_, i) => addDays(getWeekStart(currentDate), i));
    if (subView === 'month') {
      const n = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
      return Array.from({ length: n }, (_, i) => new Date(currentDate.getFullYear(), currentDate.getMonth(), i + 1));
    }
    return [];
  }

  function handleSelectDate(day) {
    setCurrentDate(day);
  }

  const showSidebar = subView !== 'agenda' && sidebarOpen;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--color-bg)' }}>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border)', flexShrink: 0, flexWrap: 'wrap' }}>
        {/* View switcher */}
        <div style={{ display: 'flex', gap: '2px', background: 'var(--color-surface)', borderRadius: '0.5rem', padding: '2px' }}>
          {['day','week','month','agenda'].map(v => (
            <button
              key={v}
              onClick={() => setSubView(v)}
              style={{ padding: '0.3rem 0.65rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, textTransform: 'capitalize', background: subView === v ? 'var(--color-primary)' : 'transparent', color: subView === v ? '#fff' : 'var(--color-muted)', transition: 'all 0.15s' }}
            >{v}</button>
          ))}
        </div>

        {subView !== 'agenda' && (
          <>
            <button onClick={() => navigate(-1)} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--color-text)', padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}>‹</button>
            <button onClick={() => setCurrentDate(new Date())} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--color-text)', padding: '0.3rem 0.65rem', fontSize: '0.75rem', fontWeight: 600 }}>Today</button>
            <button onClick={() => navigate(1)} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--color-text)', padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}>›</button>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text)' }}>{getNavLabel()}</span>
          </>
        )}

        {/* Sidebar toggle */}
        {subView !== 'agenda' && (
          <button
            onClick={() => setSidebarOpen(v => !v)}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--color-border)', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--color-muted)', padding: '0.3rem 0.55rem', fontSize: '0.8rem', lineHeight: 1 }}
          >
            {sidebarOpen ? '›' : '‹'}
          </button>
        )}
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Primary view */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {subView === 'day' && (
            <DayView date={startOfDay(currentDate)} tasks={tasks} onNew={onNew} onReschedule={onReschedule} onEdit={onEdit} onToggleStatus={onToggleStatus} onUpdateEffort={onUpdateEffort} />
          )}
          {subView === 'week' && (
            <WeekView weekStart={getWeekStart(currentDate)} tasks={tasks} onNew={onNew} onReschedule={onReschedule} onEdit={onEdit} onToggleStatus={onToggleStatus} onUpdateEffort={onUpdateEffort} />
          )}
          {subView === 'month' && (
            <MonthView year={currentDate.getFullYear()} month={currentDate.getMonth()} tasks={tasks} onNew={onNew} onReschedule={onReschedule} onEdit={onEdit} onToggleStatus={onToggleStatus} />
          )}
          {subView === 'agenda' && (
            <AgendaView tasks={tasks} onEdit={onEdit} onToggleStatus={onToggleStatus} />
          )}
        </div>

        {/* Sidebar */}
        {showSidebar && (
          <CalendarSidebar
            viewDate={currentDate}
            subView={subView}
            tasks={tasks}
            days={getSidebarDays()}
            onSelectDate={handleSelectDate}
            onEdit={onEdit}
            onToggleStatus={onToggleStatus}
            getWeekStart={getWeekStart}
          />
        )}
      </div>
    </div>
  );
}
