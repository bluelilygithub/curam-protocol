import React from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { ShowStar } from './ChannelGuide';
import { whenText, clock, isOnNow } from './liveTvHelpers.mjs';

// Programme search results and My shows (docs/live-tv.md, "TV guide"): one card per show with its upcoming airings. "Watch" opens the
// channel (and plays it when the show is on now); otherwise it opens the channel's guide on that day.
const GOOD = '#16a34a';

export default function ShowResults({ shows, showKeys, onToggleShow, onOpenAiring }) {
  const getIcon = useIcon();
  const now = new Date();
  return (
    <div className="space-y-2">
      {shows.map((s) => (
        <div key={s.titleKey} className="rounded-xl border p-3 space-y-1.5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <div className="flex items-start gap-2">
            <p className="flex-1 min-w-0 text-sm font-medium" style={{ color: 'var(--color-text)' }}>{s.title}</p>
            <ShowStar title={s.title} on={showKeys.has(s.titleKey)} onToggle={() => onToggleShow(s)} />
          </div>
          {s.airings.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Not on any channel in the guide over the next week.</p>
          )}
          {s.airings.map((a) => {
            const live = isOnNow(a, now);
            return (
              <div key={`${a.channelId}-${a.start}`} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0 tabular-nums" style={{ color: live ? GOOD : 'var(--color-muted)' }}>
                  {live ? `On now, till ${clock(a.stop)}` : whenText(a.start, now)}
                </span>
                <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--color-text)' }}>
                  {a.channelName}{a.subTitle || a.episode ? <span style={{ color: 'var(--color-muted)' }}> · {[a.episode, a.subTitle].filter(Boolean).join(' · ')}</span> : null}
                </span>
                <Tooltip text={live ? `Play ${a.channelName} now` : `Open ${a.channelName} and its guide for that day`}>
                  <button
                    type="button" onClick={() => onOpenAiring(a, live)}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border hover:opacity-70 transition-opacity duration-200"
                    style={{ borderColor: live ? GOOD : 'var(--color-border)', color: live ? GOOD : 'var(--color-text)' }}
                  >
                    {getIcon(live ? 'play' : 'calendar', { size: 12 })}{live ? 'Watch' : 'Guide'}
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
