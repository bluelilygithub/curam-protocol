import React from 'react';
import { useIcon } from '../providers/IconProvider';
import Tooltip from './Tooltip';

// The "What do you want to do?" job screen shared by Graphics and Video Tools. A job (goal) is DATA: a title, a blurb,
// an icon and ordered steps, each naming a real tool id and one line on what to do there (graphics/goals.mjs,
// videos/videoGoals.mjs). Picking a job opens its first tool and switches on JobBar. BackToJobs sits above every tool.

/** Index of `toolId` among the goal's steps, or -1. */
export function stepIndex(goal, toolId) {
  return goal ? goal.steps.findIndex((s) => s.tool === toolId) : -1;
}

export function JobStart({ goals, intro, onPick, labelFor, openOnLast, onToggleOpenOnLast, appName, tourId }) {
  const getIcon = useIcon();
  return (
    <section className="space-y-4" data-tour={tourId}>
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>What do you want to do?</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{intro}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {goals.map((goal) => (
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
      {onToggleOpenOnLast && (
        <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
          <Tooltip text={`Skip this screen from now on: ${appName} opens straight on the tool you used last. "Back to all jobs" at the top of any tool, or "What do you want to do?" at the top of the tool list, brings this screen back.`}>
            <input type="checkbox" checked={Boolean(openOnLast)} onChange={(e) => onToggleOpenOnLast(e.target.checked)} />
          </Tooltip>
          Next time, open on the tool I used last instead of this screen
        </label>
      )}
    </section>
  );
}

// Above every tool (not on the job screen): the way back to the job screen, plus where you are.
export function BackToJobs({ onBack, toolLabel, goal }) {
  const getIcon = useIcon();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Tooltip text="Go back to the job screen, “What do you want to do?”.">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition-opacity hover:opacity-70"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
        >
          {getIcon('arrow-left', { size: 14 })}
          Back to all jobs
        </button>
      </Tooltip>
      {toolLabel && (
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {goal ? `${goal.title} › ` : ''}{toolLabel}
        </span>
      )}
    </div>
  );
}

// Shown above a tool while a job is under way: the steps in order, the current one marked, and its one-line
// instruction. Clicking a step opens that tool. Hidden when the person opens a tool that is not a step.
// `carry` says how a result moves to the next tool (each app words it differently).
export function JobBar({ goal, mode, onStep, labelFor, carry }) {
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
      </div>
      <p className="text-sm" style={{ color: 'var(--color-text)' }}>
        <strong>Step {at + 1} of {goal.steps.length}:</strong> {goal.steps[at].note}
        {next && (
          <>
            {' '}When you are done, {carry}{' '}
            <button type="button" onClick={() => onStep(next.tool)} className="underline hover:opacity-60" style={{ color: 'var(--color-primary)' }}>{labelFor(next.tool)}</button>.
          </>
        )}
      </p>
    </div>
  );
}
