import React from 'react';
import { useIcon } from '../../providers/IconProvider';

export default function TaskStatsBar({
  totalIncomplete,
  completedThisWeek,
  overdueCount,
  highPriorityCount,
  totalEffortFormatted,
  timeLoggedFormatted,
  showChart,
  onToggleChart,
  onFilterOverdue,
  onFilterHigh,
  chartData,
  chartMax,
  todayStr,
}) {
  const getIcon = useIcon();

  return (
    <>
      <div className="flex-shrink-0 flex gap-3 px-6 py-3 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        {[
          { label: 'Total Active', value: totalIncomplete, icon: 'list-checks', action: null },
          { label: 'Done This Week', value: completedThisWeek, icon: 'check-circle', action: onToggleChart },
          { label: 'Overdue', value: overdueCount, icon: 'calendar', action: onFilterOverdue, color: overdueCount > 0 ? '#ef4444' : undefined },
          { label: 'High Priority', value: highPriorityCount, icon: 'tag', action: onFilterHigh, color: highPriorityCount > 0 ? '#ef4444' : undefined },
          { label: 'Total Effort', value: totalEffortFormatted, icon: 'clock', action: null },
          { label: 'Time Logged', value: timeLoggedFormatted, icon: 'clock', action: null },
        ].map(stat => (
          <button
            key={stat.label}
            onClick={stat.action || undefined}
            disabled={!stat.action}
            className={`flex-1 flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all ${stat.action ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
          >
            <span style={{ color: stat.color || 'var(--color-primary)' }}>{getIcon(stat.icon, { size: 16 })}</span>
            <div className="text-left">
              <div className="text-lg font-bold leading-none" style={{ color: stat.color || 'var(--color-text)' }}>{stat.value}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{stat.label}</div>
            </div>
          </button>
        ))}
      </div>
      {/* 14-day completion chart */}
      {showChart && (
        <div className="flex-shrink-0 px-6 py-4 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Completion trend — last 14 days</span>
            <button onClick={onToggleChart} className="hover:opacity-60" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 12 })}</button>
          </div>
          <div className="flex items-end gap-1" style={{ height: 64 }}>
            {chartData.map(({ day, count }, i) => {
              const isToday = day === todayStr;
              const barH = Math.max(Math.round((count / chartMax) * 56), count > 0 ? 4 : 2);
              return (
                <div key={day} className="flex-1 flex flex-col items-center justify-end" style={{ height: 64 }}>
                  {count > 0 && <span className="text-xs leading-none mb-0.5" style={{ color: 'var(--color-muted)', fontSize: 9 }}>{count}</span>}
                  <div
                    className="w-full rounded-t"
                    style={{ height: barH, background: isToday ? 'var(--color-primary)' : 'var(--color-border)', opacity: count > 0 ? 1 : 0.4 }}
                    title={`${day}: ${count} completed`}
                  />
                  {(i === 0 || i === 6 || i === 13) && (
                    <span className="text-xs mt-1 leading-none" style={{ color: 'var(--color-muted)', fontSize: 9 }}>
                      {new Date(day + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
