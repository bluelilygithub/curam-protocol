import React, { useEffect, useMemo, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import { guideDays, clock, isOnNow } from './liveTvHelpers.mjs';

// One channel's TV guide, a day at a time (docs/live-tv.md, "TV guide"). The star on a programme adds the SHOW to My shows.
// Status colour is deliberately outside the theme (see client/DESIGN.md).
const GOOD = '#16a34a';
const WARN = '#f59e0b';

export function ShowStar({ title, on, onToggle }) {
  const getIcon = useIcon();
  const tip = on ? `Take "${title}" off My shows` : `Add "${title}" to My shows: see every time it is on`;
  return (
    <Tooltip text={tip}>
      <button
        type="button" onClick={onToggle} aria-pressed={on} aria-label={tip}
        className="shrink-0 p-1 rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ color: on ? WARN : 'var(--color-muted)' }}
      >
        {getIcon('star', { size: 14, fill: on ? WARN : 'none' })}
      </button>
    </Tooltip>
  );
}

export default function ChannelGuide({ channel, showKeys, onToggleShow, initialDay = 0 }) {
  const days = useMemo(() => guideDays(new Date()), []);
  const [day, setDay] = useState(initialDay);
  const [programmes, setProgrammes] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => { setDay(initialDay); }, [channel?.id, initialDay]);

  useEffect(() => {
    if (!channel) return undefined;
    let gone = false;
    setProgrammes(null); setError('');
    const d = days[day];
    const qs = new URLSearchParams({ from: d.from.toISOString(), to: d.to.toISOString() });
    api.get(`/api/live-tv/guide/channel/${encodeURIComponent(channel.id)}?${qs}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'The guide could not be loaded.');
        if (!gone) setProgrammes(body.programmes);
      })
      .catch((e) => { if (!gone) setError(e.message); });
    return () => { gone = true; };
  }, [channel?.id, day, days]); // eslint-disable-line react-hooks/exhaustive-deps -- the id, not the object: a play result replaces the object

  // keep "On now" right while the page stays open
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (day !== 0 || !programmes) return;
    document.querySelector('[data-guide-now="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [programmes, day]);

  if (!channel) return null;
  const now = new Date();

  return (
    <div className="space-y-2" data-tour="live-tv-guide">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>TV guide</p>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Guide day">
        {days.map((d, i) => (
          <button
            key={d.key} type="button" role="tab" aria-selected={day === i} onClick={() => setDay(i)}
            className="shrink-0 px-2.5 py-1 rounded-lg border text-xs font-medium hover:opacity-70 transition-opacity duration-200"
            style={{ borderColor: day === i ? 'var(--color-primary)' : 'var(--color-border)', color: day === i ? 'var(--color-primary)' : 'var(--color-muted)', background: 'transparent' }}
          >{d.label}</button>
        ))}
      </div>
      {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
      {!programmes && !error && <Skeleton lines={4} className="h-8" label="Loading the guide" />}
      {programmes && programmes.length === 0 && (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          No guide for this channel{day === 0 ? '' : ' on this day'}. The free guide covers Australian free-to-air channels and some streaming channels; starring a channel adds it if a guide exists for it.
        </p>
      )}
      {programmes && programmes.length > 0 && (
        <ul className="max-h-80 overflow-y-auto space-y-1 pr-1">
          {programmes.map((p) => {
            const live = isOnNow(p, now);
            const past = new Date(p.stop) <= now;
            const id = `${p.start}-${p.title}`;
            const expanded = open === id;
            return (
              <li
                key={id} data-guide-now={live ? '1' : undefined}
                className="rounded-lg border px-2.5 py-1.5"
                style={{ borderColor: live ? GOOD : 'var(--color-border)', background: 'var(--color-bg)', opacity: past ? 0.6 : 1 }}
              >
                <div className="flex items-start gap-2">
                  <span className="shrink-0 w-16 text-xs pt-0.5 tabular-nums" style={{ color: 'var(--color-muted)' }}>{clock(p.start)}</span>
                  <button
                    type="button" onClick={() => setOpen(expanded ? null : id)} aria-expanded={expanded}
                    className="flex-1 min-w-0 text-left hover:opacity-70 transition-opacity duration-200"
                  >
                    <span className="block text-sm" style={{ color: 'var(--color-text)' }}>
                      {p.title}
                      {live && <span className="ml-2 text-[11px] font-semibold" style={{ color: GOOD }}>ON NOW · until {clock(p.stop)}</span>}
                    </span>
                    {(p.subTitle || p.episode) && (
                      <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{[p.episode, p.subTitle].filter(Boolean).join(' · ')}</span>
                    )}
                    {expanded && (
                      <span className="block text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-text)' }}>
                        {p.description || 'No description given.'}
                        {p.category && <span style={{ color: 'var(--color-muted)' }}> · {p.category}</span>}
                        <span style={{ color: 'var(--color-muted)' }}> · {clock(p.start)} to {clock(p.stop)}</span>
                      </span>
                    )}
                  </button>
                  <ShowStar title={p.title} on={showKeys.has(p.titleKey)} onToggle={() => onToggleShow(p)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
