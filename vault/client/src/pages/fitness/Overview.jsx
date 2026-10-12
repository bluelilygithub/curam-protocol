import React from 'react';
import { Card, Notice, SecondaryButton, formatDate } from './ui';
import BaselineView from './BaselineView';
import RatingProgress from './RatingProgress';

/** Landing view once onboarding is done. Today/week views join here in the next stage. */
export default function Overview({ meta, state, goTo }) {
  const goal = state.goal;
  const last = goal?.milestones?.[goal.milestones.length - 1];
  const due = state.ratingDue;

  return (
    <div className="max-w-3xl mx-auto w-full space-y-5">
      {due.due && (
        <Notice>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-[200px]">
              {due.level === 'firm'
                ? `It has been ${due.weeks} weeks since you last rated your fitness. A quick re-rate keeps your plan honest.`
                : `About ${due.weeks} weeks since your last rating. Want to re-rate? It takes a minute.`}
            </span>
            <SecondaryButton onClick={() => goTo('profile', { rerate: true })}>Re-rate now</SecondaryButton>
          </div>
        </Notice>
      )}

      {state.safety?.message && state.lifestyle?.easeRequested && (
        <Notice tone="care">{state.safety.message} Your first weeks will be kept gentle.</Notice>
      )}

      {goal && (
        <div data-tour="fitness-goal-card">
        <Card title="Your 5-year goal">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{goal.summary?.summary}</p>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Pace: <strong style={{ color: 'var(--color-text)' }}>{goal.summary?.ambitionLabel}</strong>
            {last && <> · by {formatDate(last.by)}: about {last.weekly.aerobicModerateMin} min a week, strength on {last.weekly.strengthDays} days</>}
          </p>
          <div className="flex gap-2">
            <SecondaryButton onClick={() => goTo('goal')}>See the five years</SecondaryButton>
          </div>
        </Card>
        </div>
      )}

      <Card title="This week">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          Your program is made fresh each week: the same targets, with the exercises changing. Rest days and a flexible rest budget are built in.
          Logging what you did, charts and reminders arrive in the next updates.
        </p>
        <div className="flex gap-2">
          <SecondaryButton onClick={() => goTo('today')}>Today</SecondaryButton>
          <SecondaryButton onClick={() => goTo('week')}>See the week</SecondaryButton>
        </div>
      </Card>

      <RatingProgress meta={meta} due={due.due} onRerate={() => goTo('profile', { rerate: true })} />

      <BaselineView meta={meta} state={state} compact />
    </div>
  );
}

