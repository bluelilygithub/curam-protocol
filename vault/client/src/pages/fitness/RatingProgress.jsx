import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { Card, InfoTip, SecondaryButton, formatDate } from './ui';
import { TIPS } from './tips';

function change(first, latest) {
  const d = latest - first;
  if (d === 0) return 'same';
  return d > 0 ? `up ${d}` : `down ${Math.abs(d)}`;
}

/**
 * Your own ratings over time: first rating against the latest. This is what the app tracks of your self-reported progress
 * today; what you actually do (logging, effort) arrives with Stage 3 and the charts with Stage 4.
 */
export default function RatingProgress({ meta, onRerate, due }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/api/fitness/ratings/history').then((r) => r.json()).then((d) => { if (live) setRows(d.history || []); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, []);
  if (!rows) return null;
  if (!rows.length) return null;

  const first = rows[0];
  const latest = rows[rows.length - 1];
  const single = rows.length < 2;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Your self-ratings over time</h2>
        <InfoTip tip={TIPS.ratings} />
      </div>
      {single ? (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          You have rated yourself once, on {formatDate(first.ratedOn)}. Re-rate every 4 to 6 weeks and the change shows up here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ color: 'var(--color-text)' }}>
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--color-muted)' }}>
                <th className="py-1 pr-3 font-medium"> </th>
                <th className="py-1 pr-3 font-medium">First ({formatDate(first.ratedOn)})</th>
                <th className="py-1 pr-3 font-medium">Latest ({formatDate(latest.ratedOn)})</th>
                <th className="py-1 pr-3 font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {meta.domains.map((d) => (
                <tr key={d.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="py-2 pr-3">{d.label}</td>
                  <td className="py-2 pr-3 tabular-nums">{first.scores[d.id]}</td>
                  <td className="py-2 pr-3 tabular-nums">{latest.scores[d.id]}</td>
                  <td className="py-2 pr-3">{change(first.scores[d.id], latest.scores[d.id])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
        {rows.length} rating{rows.length === 1 ? '' : 's'} so far. These are your own ratings on a 1 to 5 scale. A chart and what you actually did each week arrive in later updates.
      </p>
      {onRerate && <SecondaryButton onClick={onRerate}>{due ? 'Re-rate now' : 'Re-rate'}</SecondaryButton>}
    </Card>
  );
}
