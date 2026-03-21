import React, { useState } from 'react';

// ── Constants ──────────────────────────────────────────────────────────────────

const LABEL_W    = 200;
const ROW_H      = 40;
const BAR_H      = 22;
const HEADER_H   = 48;
const MS_SIZE    = 12;   // milestone diamond px
const DAY_MINS   = 480;  // 8-hour work day
const DEF_DAYS   = 3;    // fallback duration when estimatedMinutes absent

const ZOOM = [
  { key: 'week',    label: 'Week',    ppd: 80 },
  { key: 'month',   label: 'Month',   ppd: 28 },
  { key: 'quarter', label: 'Quarter', ppd: 10 },
];

const STATUS_STYLE = {
  'todo':        { bg: '#3b82f614', border: '#3b82f6' },
  'in-progress': { bg: '#6366f114', border: '#6366f1' },
  'done':        { bg: '#22c55e14', border: '#22c55e' },
  'blocked':     { bg: '#ef444414', border: '#ef4444' },
};

// ── Sample data (used when no props are passed) ───────────────────────────────

const SAMPLE_TASKS = [
  { id: 1, title: 'Project kickoff',   status: 'done',        dueDate: '2026-03-10', estimatedMinutes: 480,  isMilestone: false, parentTaskId: null, blockerIds: [] },
  { id: 2, title: 'Design wireframes', status: 'in-progress', dueDate: '2026-03-24', estimatedMinutes: 2400, isMilestone: false, parentTaskId: null, blockerIds: [1] },
  { id: 3, title: 'Homepage mockup',   status: 'todo',        dueDate: '2026-03-22', estimatedMinutes: 720,  isMilestone: false, parentTaskId: 2,    blockerIds: [] },
  { id: 4, title: 'Dev sprint 1',      status: 'todo',        dueDate: '2026-04-04', estimatedMinutes: 4800, isMilestone: false, parentTaskId: null, blockerIds: [2] },
  { id: 5, title: 'Launch v1.0',       status: 'todo',        dueDate: '2026-04-15', estimatedMinutes: 60,   isMilestone: true,  parentTaskId: null, blockerIds: [4] },
  { id: 6, title: 'Write docs',        status: 'todo',        dueDate: null,         estimatedMinutes: 480,  isMilestone: false, parentTaskId: null, blockerIds: [] },
];

const SAMPLE_PROJECT = {
  startDate:     '2026-03-05',
  targetEndDate: '2026-04-20',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDate(str) {
  return str ? new Date(`${str}T12:00:00`) : null;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function diffDays(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function fmtTick(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function computeRange(tasks, project) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  if (project?.startDate && project?.targetEndDate) {
    return { start: parseDate(project.startDate), end: parseDate(project.targetEndDate) };
  }

  const sched = tasks.filter(t => t.dueDate);
  if (!sched.length) return { start: addDays(today, -7), end: addDays(today, 30) };

  let min = null, max = null;
  sched.forEach(t => {
    const due = parseDate(t.dueDate);
    if (!due || isNaN(due.getTime())) return; // skip unparseable dates
    const dur = t.estimatedMinutes ? Math.max(t.estimatedMinutes / DAY_MINS, 1) : DEF_DAYS;
    const s   = addDays(due, -Math.ceil(dur));
    if (!min || s < min) min = s;
    if (!max || due > max) max = due;
  });
  if (!min || !max) return { start: addDays(today, -7), end: addDays(today, 30) };
  return { start: addDays(min, -2), end: addDays(max, 2) };
}

// Walks tasks depth-first: each parent immediately followed by its children.
function buildRows(tasks) {
  const byParent = {};
  tasks.forEach(t => {
    const pid = t.parentTaskId ?? null;
    (byParent[pid] = byParent[pid] || []).push(t);
  });
  const rows = [];
  function walk(pid, depth) {
    (byParent[pid] || []).forEach(t => {
      rows.push({ task: t, depth });
      walk(t.id, depth + 1);
    });
  }
  walk(null, 0);
  return rows;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TaskTimeline({ tasks = SAMPLE_TASKS, project = SAMPLE_PROJECT, onEdit }) {
  const [zoomKey, setZoomKey] = useState('month');
  const { ppd } = ZOOM.find(z => z.key === zoomKey);

  const taskMap     = Object.fromEntries(tasks.map(t => [t.id, t]));
  const scheduled   = tasks.filter(t => t.dueDate);
  const unscheduled = tasks.filter(t => !t.dueDate);

  const range     = computeRange(tasks, project);
  const totalDays = Math.max(diffDays(range.start, range.end) || 30, 1);
  const totalW    = totalDays * ppd;

  const rows       = buildRows(scheduled);
  const rowIdxById = Object.fromEntries(rows.map(({ task }, i) => [task.id, i]));
  const totalRowsH = rows.length * ROW_H;

  // Today line
  const today  = new Date(); today.setHours(12, 0, 0, 0);
  const todayX = diffDays(range.start, today) * ppd;
  const showToday = todayX >= 0 && todayX <= totalW;

  // Date axis tick interval
  const tickEvery = ppd >= 50 ? 1 : ppd >= 20 ? 7 : 14;
  const ticks = [];
  for (let d = 0; d <= totalDays; d += tickEvery) ticks.push(d);

  // A task is "blocked" if any of its blockers are not done yet
  function resolveStatus(task) {
    if (task.blockerIds?.length) {
      const isBlocked = task.blockerIds.some(bid => taskMap[bid]?.status !== 'done');
      if (isBlocked) return 'blocked';
    }
    return task.status || 'todo';
  }

  // Bar spans from (dueDate - duration) to dueDate
  function geo(task) {
    if (!task.dueDate) return null;
    const due  = parseDate(task.dueDate);
    if (!due || isNaN(due.getTime())) return null;
    const dur  = task.estimatedMinutes ? Math.max(task.estimatedMinutes / DAY_MINS, 1) : DEF_DAYS;
    const endD = diffDays(range.start, due);
    const barW = Math.max(dur * ppd, ppd);
    return { x: endD * ppd - barW, w: barW, endX: endD * ppd };
  }

  const barTop = (ROW_H - BAR_H) / 2;

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>

      {/* ── Toolbar ── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Timeline</h2>
        <div
          className="flex items-center gap-0.5 p-0.5 rounded-lg border"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
        >
          {ZOOM.map(z => (
            <button
              key={z.key}
              onClick={() => setZoomKey(z.key)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-all"
              style={
                zoomKey === z.key
                  ? { background: 'var(--color-primary)', color: '#fff' }
                  : { color: 'var(--color-muted)' }
              }
            >
              {z.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Legend ── */}
      <div
        className="flex-shrink-0 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-6 py-2 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        {[['todo', 'To-do'], ['in-progress', 'In progress'], ['done', 'Done'], ['blocked', 'Blocked']].map(([s, label]) => (
          <div key={s} className="flex items-center gap-1.5">
            <div
              className="w-3 h-2 rounded-sm flex-shrink-0"
              style={{ background: STATUS_STYLE[s].border }}
            />
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div
            className="flex-shrink-0"
            style={{ width: MS_SIZE, height: MS_SIZE, background: '#94a3b8', transform: 'rotate(45deg)', borderRadius: 2 }}
          />
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Milestone</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-px h-3 flex-shrink-0" style={{ background: '#f59e0b' }} />
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Today</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="20" height="8">
            <line x1="0" y1="4" x2="14" y2="4" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 2" />
            <path d="M14,1 L20,4 L14,7 z" fill="#94a3b8" />
          </svg>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Dependency</span>
        </div>
      </div>

      {/* ── Scrollable timeline ── */}
      <div className="flex-1 overflow-auto">
        <div className="relative" style={{ minWidth: LABEL_W + totalW }}>

          {/* Date axis */}
          <div
            className="flex sticky top-0 z-20 border-b"
            style={{ height: HEADER_H, borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            {/* Label column header */}
            <div
              className="flex-shrink-0 sticky left-0 z-30 flex items-end pb-2 px-3 border-r"
              style={{ width: LABEL_W, borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Task</span>
            </div>
            {/* Tick labels */}
            <div className="relative flex-shrink-0" style={{ width: totalW }}>
              {ticks.map(d => (
                <React.Fragment key={d}>
                  <div
                    className="absolute inset-y-0"
                    style={{ left: d * ppd, width: 1, background: 'var(--color-border)', opacity: 0.5 }}
                  />
                  <span
                    className="absolute bottom-2 whitespace-nowrap"
                    style={{ left: d * ppd + 4, fontSize: 11, color: 'var(--color-muted)' }}
                  >
                    {fmtTick(addDays(range.start, d))}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Task rows */}
          {rows.map(({ task, depth }, i) => {
            const g      = geo(task);
            const status = resolveStatus(task);
            const sty    = STATUS_STYLE[status] || STATUS_STYLE.todo;
            const rowBg  = i % 2 === 0 ? 'var(--color-bg)' : 'var(--color-surface)';

            return (
              <div
                key={task.id}
                className="flex border-b"
                style={{ height: ROW_H, borderColor: 'var(--color-border)', background: rowBg }}
              >
                {/* Label */}
                <div
                  className="flex-shrink-0 sticky left-0 z-10 flex items-center gap-1.5 border-r"
                  style={{
                    width: LABEL_W,
                    paddingLeft: 12 + depth * 16,
                    paddingRight: 8,
                    borderColor: 'var(--color-border)',
                    background: rowBg,
                  }}
                >
                  {depth > 0 && (
                    <div
                      className="flex-shrink-0 rounded-full"
                      style={{ width: 5, height: 5, background: 'var(--color-border)' }}
                    />
                  )}
                  <span
                    className="truncate text-xs"
                    style={{
                      color: status === 'done' ? 'var(--color-muted)' : 'var(--color-text)',
                      textDecoration: status === 'done' ? 'line-through' : 'none',
                    }}
                    title={task.title}
                  >
                    {task.title}
                  </span>
                </div>

                {/* Bar area */}
                <div className="relative flex-shrink-0" style={{ width: totalW }}>
                  {g && !task.isMilestone && (
                    <div
                      className="absolute rounded"
                      title={`${task.title} — ${status}`}
                      onClick={() => onEdit?.(task.id)}
                      style={{
                        left: g.x,
                        width: g.w,
                        top: barTop,
                        height: BAR_H,
                        background: sty.bg,
                        border: `1.5px solid ${sty.border}`,
                        cursor: onEdit ? 'pointer' : 'default',
                      }}
                    />
                  )}
                  {g && task.isMilestone && (
                    <div
                      className="absolute"
                      title={`${task.title} — Milestone`}
                      onClick={() => onEdit?.(task.id)}
                      style={{
                        left: g.endX - MS_SIZE / 2,
                        top: (ROW_H - MS_SIZE) / 2,
                        width: MS_SIZE,
                        height: MS_SIZE,
                        transform: 'rotate(45deg)',
                        background: sty.border,
                        borderRadius: 2,
                        cursor: onEdit ? 'pointer' : 'default',
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {/* ── SVG overlay: grid lines, today line, dependency connectors ── */}
          <svg
            style={{
              position: 'absolute',
              top: HEADER_H,
              left: LABEL_W,
              width: totalW,
              height: Math.max(totalRowsH, 1),
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            <defs>
              <marker id="tl-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0.5 L5,3 L0,5.5 z" fill="#94a3b8" />
              </marker>
            </defs>

            {/* Vertical grid lines (extend down through all rows) */}
            {ticks.map(d => (
              <line
                key={`grid-${d}`}
                x1={d * ppd} y1={0} x2={d * ppd} y2={totalRowsH}
                stroke="var(--color-border)" strokeWidth={0.5} opacity={0.5}
              />
            ))}

            {/* Today line */}
            {showToday && (
              <line
                x1={todayX} y1={0} x2={todayX} y2={totalRowsH}
                stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3"
              />
            )}

            {/* Dependency connectors */}
            {rows.map(({ task }, toIdx) => {
              if (!task.blockerIds?.length) return null;
              const toG = geo(task);
              if (!toG) return null;
              const toY = toIdx * ROW_H + ROW_H / 2;

              return task.blockerIds.map(bid => {
                const fromIdx  = rowIdxById[bid];
                if (fromIdx == null) return null;
                const fromTask = taskMap[bid];
                if (!fromTask) return null;
                const fromG = geo(fromTask);
                if (!fromG) return null;

                const fromX = fromTask.isMilestone ? fromG.endX : fromG.x + fromG.w;
                const fromY = fromIdx * ROW_H + ROW_H / 2;
                // Elbow: exit right from blocker, turn, enter left on blocked task
                const midX  = fromX + (toG.x - fromX) * 0.55;

                return (
                  <path
                    key={`${bid}→${task.id}`}
                    d={`M ${fromX} ${fromY} H ${midX} V ${toY} H ${toG.x}`}
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    markerEnd="url(#tl-arrow)"
                  />
                );
              });
            })}
          </svg>

        </div>
      </div>

      {/* ── Unscheduled section ── */}
      {unscheduled.length > 0 && (
        <div
          className="flex-shrink-0 border-t px-6 py-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--color-muted)' }}
          >
            Unscheduled
          </p>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map(task => {
              const sty = STATUS_STYLE[task.status] || STATUS_STYLE.todo;
              return (
                <div
                  key={task.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs"
                  style={{ background: sty.bg, borderColor: sty.border, color: sty.border }}
                >
                  {task.isMilestone && (
                    <span
                      className="flex-shrink-0 inline-block"
                      style={{ width: 7, height: 7, background: sty.border, transform: 'rotate(45deg)', borderRadius: 1 }}
                    />
                  )}
                  {task.title}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
