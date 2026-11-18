import React from 'react';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import { money, compact, pct, testsShare } from './ponytailFormat.mjs';

// The six figures at the top of the Ponytail report, for the chosen range and filters.
export default function SummaryTiles({ totals }) {
  if (!totals) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="rounded-2xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}><Skeleton lines={2} /></div>)}
      </div>
    );
  }
  const share = testsShare(totals.testsPassed, totals.testsRun);
  const tiles = [
    ['Total cost', money(totals.cost), 'What these tasks cost, as Ponytail totals each session (since it started or since the last /clear).'],
    ['Tasks', String(totals.tasks), 'Ponytail tasks in the range. A task is one Claude Code session, or the part of one after a /clear.'],
    ['Average per task', money(totals.avgCost), 'Total cost divided by the number of tasks.'],
    ['Tokens', compact(totals.tokens), 'Input, output and cache tokens together. Rows imported from the CSV only know the total and the output.'],
    ['Average reuse', pct(totals.avgReuse), 'The average of each task\'s reuse share: functions it used that already existed, out of those it used or wrote. Tasks that touched fewer than 3 functions have no share and are left out.'],
    ['Tests passing', share === null ? '–' : `${share}%`, `Tasks whose last test run passed, of the ${totals.testsRun} task${totals.testsRun === 1 ? '' : 's'} that ran tests at all ("not run" and "stale" are left out).`],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      {tiles.map(([label, value, tip]) => (
        <Tooltip key={label} text={tip}>
          <div className="rounded-2xl border p-4 h-full" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} tabIndex={0}>
            <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</div>
            <div className="text-xl font-semibold mt-1" style={{ color: 'var(--color-text)' }}>{value}</div>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}
