import React from 'react';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import { money, pct, shortDay } from './ponytailFormat.mjs';

const th = 'p-2 font-medium whitespace-nowrap';
const td = { color: 'var(--color-text)' };

// Commits per day from the admin Changelog next to that day's Ponytail cost and reuse, to see whether less code is being written.
export default function CodeWrittenPanel({ days }) {
  const totals = (days || []).reduce((s, d) => ({ commits: s.commits + d.commits, ins: s.ins + d.insertions, del: s.del + d.deletions, cost: s.cost + d.cost }), { commits: 0, ins: 0, del: 0, cost: 0 });
  return (
    <section className="rounded-2xl border p-5 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Code written</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Commits per day from the Changelog (changelog-only commits left out) beside that day&rsquo;s Ponytail cost and reuse. Tasks and commits are matched by day, not linked one to one: a commit on a day is not necessarily the work of that day&rsquo;s tasks. The project and model filters apply to the Ponytail columns only.
        </p>
      </div>
      {!days ? <Skeleton lines={5} label="Loading code written" /> : !days.length ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No commits or tasks in this range.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
              <tr>
                <th className={`${th} text-left`}>Day</th>
                <th className={`${th} text-right`}><Tooltip text="Commits with a Changelog entry that day (Brisbane time)."><span tabIndex={0}>Commits</span></Tooltip></th>
                <th className={`${th} text-right`}><Tooltip text="Lines added in those commits."><span tabIndex={0}>Added</span></Tooltip></th>
                <th className={`${th} text-right`}><Tooltip text="Lines removed in those commits."><span tabIndex={0}>Removed</span></Tooltip></th>
                <th className={`${th} text-right`}><Tooltip text="Lines added minus lines removed: below zero means the code got smaller."><span tabIndex={0}>Net</span></Tooltip></th>
                <th className={`${th} text-right`}><Tooltip text="Ponytail tasks that started that day."><span tabIndex={0}>Tasks</span></Tooltip></th>
                <th className={`${th} text-right`}><Tooltip text="What those tasks cost."><span tabIndex={0}>Cost</span></Tooltip></th>
                <th className={`${th} text-right`}><Tooltip text="Average reuse share of those tasks."><span tabIndex={0}>Reuse</span></Tooltip></th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const net = d.insertions - d.deletions;
                return (
                  <tr key={d.day} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="p-2 whitespace-nowrap" style={td}>{shortDay(d.day)} {d.day.slice(0, 4)}</td>
                    <td className="p-2 text-right" style={td}>{d.commits}</td>
                    <td className="p-2 text-right" style={{ color: d.commits ? '#16a34a' : 'var(--color-muted)' }}>{d.commits ? `+${d.insertions}` : '–'}</td>
                    <td className="p-2 text-right" style={{ color: d.commits ? '#ef4444' : 'var(--color-muted)' }}>{d.commits ? `−${d.deletions}` : '–'}</td>
                    <td className="p-2 text-right" style={td}>{!d.commits ? '–' : net > 0 ? `+${net}` : net}</td>
                    <td className="p-2 text-right" style={td}>{d.tasks}</td>
                    <td className="p-2 text-right" style={td}>{d.tasks ? money(d.cost) : '–'}</td>
                    <td className="p-2 text-right" style={td}>{pct(d.reuse)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot style={{ color: 'var(--color-muted)' }}>
              <tr className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="p-2">In all</td><td className="p-2 text-right">{totals.commits}</td><td className="p-2 text-right">+{totals.ins}</td>
                <td className="p-2 text-right">−{totals.del}</td><td className="p-2 text-right">{totals.ins - totals.del}</td><td /><td className="p-2 text-right">{money(totals.cost)}</td><td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
