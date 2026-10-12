import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { Card, Notice, SecondaryButton, Segmented, formatDate } from './ui';
import BaselineView from './BaselineView';
import RatingProgress from './RatingProgress';
import ReflectionTile from './ReflectionTile';
import AerobicChart from './AerobicChart';
import { ActivityChart, BalanceChart, ChartHeading, ConsistencyCalendar, GlanceTile } from './DashboardCharts';
import { TIPS } from './tips';
import { addDays, mondayOf } from './useWeek';

const RANGES = [
  { id: '4', label: 'Last 4 weeks' },
  { id: '12', label: 'Last 12 weeks' },
  { id: 'all', label: 'All' },
];
const RANGE_KEY = 'vault:fitness:dashRange';
const DISMISS_KEY = 'vault:fitness:rerateDismissed';
const DISMISS_DAYS = 7;

const read = (k) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* private mode: it just will not be remembered */ } };

/** The dashboard: where you are this week, how the weeks have gone, and where the five years are heading. */
export default function Overview({ meta, state, goTo }) {
  const goal = state.goal;
  const last = goal?.milestones?.[goal.milestones.length - 1];
  const due = state.ratingDue;
  const entered = state.lifestyle?.weeklyMinutes;
  // the same shape the goal screen's preview gives, from what is saved
  const plan = goal ? {
    now: { aerobicModerateMin: entered ?? null, minutesSource: entered != null ? 'entered' : 'not_entered' },
    milestones: goal.milestones,
  } : null;

  const [range, setRange] = useState(() => (RANGES.some((r) => r.id === read(RANGE_KEY)) ? read(RANGE_KEY) : '12'));
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [dismissedOn, setDismissedOn] = useState(() => read(DISMISS_KEY));

  useEffect(() => {
    let live = true;
    setFailed(false);
    api.get(`/api/fitness/dashboard?range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('dashboard'))))
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [range]);

  const pickRange = (id) => { setRange(id); write(RANGE_KEY, id); };
  const dismissed = dismissedOn && state.today && addDays(dismissedOn, DISMISS_DAYS) > state.today;
  const dismiss = () => { write(DISMISS_KEY, state.today); setDismissedOn(state.today); };

  return (
    <div className="max-w-6xl mx-auto w-full space-y-5" data-tour="fitness-dashboard">
      {due.due && !dismissed && (
        <Notice>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-[200px]">
              {due.level === 'firm'
                ? `It has been ${due.weeks} weeks since you last rated your fitness. A quick re-rate keeps your plan honest.`
                : `About ${due.weeks} weeks since your last rating. Want to re-rate? It takes a minute.`}
            </span>
            <SecondaryButton onClick={() => goTo('profile', { rerate: true })}>Re-rate now</SecondaryButton>
            <SecondaryButton onClick={dismiss}>Not now</SecondaryButton>
          </div>
        </Notice>
      )}

      {state.safety?.message && state.lifestyle?.easeRequested && (
        <Notice tone="care">{state.safety.message} Your first weeks will be kept gentle.</Notice>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold m-0" style={{ color: 'var(--color-text)' }}>Dashboard</h2>
        <Segmented label="Time range" options={RANGES} value={range} onChange={pickRange} />
      </div>

      {failed && <Notice tone="care">The charts could not load just now. Your plan and logs are safe; try again in a moment.</Notice>}

      <div className="grid gap-5 lg:grid-cols-2">
        {goal && (
          <div data-tour="fitness-goal-card">
            <Card title="Your 5-year goal" icon="target" className="h-full">
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

        <Card title="This week so far" icon="calendar" className="h-full">
          {data ? <GlanceTile week={data.thisWeek} /> : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
          <div className="flex gap-2">
            <SecondaryButton onClick={() => goTo('today')}>Today</SecondaryButton>
            <SecondaryButton onClick={() => goTo('week')}>See the week</SecondaryButton>
          </div>
        </Card>

        {goal && (
          <Card className="lg:col-span-2">
            <ChartHeading title="Your five years, and where you are heading" tip={TIPS.dashProjection} />
            <AerobicChart plan={plan} projection={data?.projection || null} />
          </Card>
        )}

        <Card>
          <ChartHeading title="Planned and done, week by week" tip={TIPS.dashActivity} />
          {data ? <ActivityChart weeks={data.weeks} /> : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
        </Card>

        <Card>
          <ChartHeading title="Balance across the four kinds of work" tip={TIPS.dashBalance} />
          {data ? <BalanceChart balance={data.balance} /> : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
        </Card>

        <Card className="lg:col-span-2">
          <ChartHeading title="Your days" tip={TIPS.dashCalendar} />
          {data ? <ConsistencyCalendar calendar={data.calendar} /> : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
        </Card>

        <ReflectionTile weekStart={addDays(mondayOf(state.today), -7)} title="Last week" />

        <RatingProgress meta={meta} due={due.due} onRerate={() => goTo('profile', { rerate: true })} />

        <div className="lg:col-span-2">
          <BaselineView meta={meta} state={state} compact />
        </div>
      </div>
    </div>
  );
}
