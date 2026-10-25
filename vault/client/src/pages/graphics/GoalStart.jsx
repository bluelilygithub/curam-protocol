import React from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { GOALS, stepIndex } from './goals.mjs';

// The Graphics landing view: "What do you want to do?" Each tile opens the first tool of that goal and
// switches on the step bar (GoalBar) so the person can see where they are in the job. See goals.mjs.
export function GoalStart({ onPick, labelFor }) {
  const getIcon = useIcon();
  return (
    <section className="space-y-4" data-tour="graphics-goals">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>What do you want to do?</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          Pick a job and Graphics opens the tools for it, one step at a time. Or describe it in the box above, or browse every tool in the list on the left.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {GOALS.map((goal) => (
          <Tooltip key={goal.id} text={`Opens: ${goal.steps.map((s) => labelFor(s.tool)).join(' → ')}`}>
            <button
              type="button"
              onClick={() => onPick(goal)}
              className="text-left rounded-2xl border p-4 transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <span className="flex items-center gap-2 mb-1.5" style={{ color: 'var(--color-primary)' }}>
                {getIcon(goal.icon, { size: 16 })}
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{goal.title}</span>
              </span>
              <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>{goal.blurb}</span>
              <span className="block text-[11px] mt-2" style={{ color: 'var(--color-muted)' }}>
                {goal.steps.length} steps · {goal.steps.map((s) => labelFor(s.tool)).join(', ')}
              </span>
            </button>
          </Tooltip>
        ))}
      </div>
    </section>
  );
}

// Shown above a tool while a goal is under way: the steps in order, the current one marked, and its one-line
// instruction. Clicking a step opens that tool. It disappears when the person opens a tool that is not a step.
export function GoalBar({ goal, mode, onStep, onLeave, labelFor }) {
  const getIcon = useIcon();
  const at = stepIndex(goal, mode);
  if (!goal || at < 0) return null;
  const next = goal.steps[at + 1];
  return (
    <div className="rounded-2xl border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{goal.title}</span>
        <span className="flex flex-wrap items-center gap-1.5 flex-1">
          {goal.steps.map((s, i) => (
            <Tooltip key={s.tool} text={s.note}>
              <button
                type="button"
                onClick={() => onStep(s.tool)}
                className="text-xs px-2.5 py-1 rounded-full border transition-opacity hover:opacity-70"
                style={{
                  borderColor: i === at ? 'var(--color-primary)' : 'var(--color-border)',
                  color: i === at ? 'var(--color-primary)' : 'var(--color-muted)',
                  background: i === at ? 'var(--color-bg)' : 'transparent',
                  fontWeight: i === at ? 600 : 400,
                }}
              >
                {i + 1}. {labelFor(s.tool)}
              </button>
            </Tooltip>
          ))}
        </span>
        <Tooltip text="Close this guide and go back to the list of jobs.">
          <button type="button" onClick={onLeave} className="text-xs hover:opacity-60 inline-flex items-center gap-1" style={{ color: 'var(--color-muted)' }}>
            {getIcon('x', { size: 12 })} All jobs
          </button>
        </Tooltip>
      </div>
      <p className="text-sm" style={{ color: 'var(--color-text)' }}>
        <strong>Step {at + 1} of {goal.steps.length}:</strong> {goal.steps[at].note}
        {next && (
          <>
            {' '}When you are done, use <em>Use in…</em> on the result to carry the picture to{' '}
            <button type="button" onClick={() => onStep(next.tool)} className="underline hover:opacity-60" style={{ color: 'var(--color-primary)' }}>{labelFor(next.tool)}</button>.
          </>
        )}
      </p>
    </div>
  );
}
