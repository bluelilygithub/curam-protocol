import React from 'react';
import { heatCell } from '../charts/chartMath.mjs';
import { fmtPct } from '../charts/chartFormat.mjs';

// Daily % moves per holding: a scale from --chart-loss through the surface to --chart-gain, a signed figure in each cell,
// and a --chart-warn outline on a material move with no ticker news.
const fill = (c) => (c.tone === 'flat' ? 'var(--color-bg)' : `color-mix(in srgb, var(--chart-${c.tone}) ${c.strength}%, var(--color-surface))`);

export default function MoveHeatmap({ heatmap }) {
  const { symbols = [], dates = [], cells = [] } = heatmap || {};
  if (!symbols.length || !dates.length) {
    return <p className="text-xs py-4 text-center" style={{ color: 'var(--color-muted)' }}>Need more snapshot history for the move heatmap — check back after a few polling days.</p>;
  }
  const cellMap = new Map(cells.map((c) => [`${c.symbol}:${c.date}`, c]));
  const displayDates = dates.slice(-10);
  const displaySymbols = symbols.slice(0, 10);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="text-xs border-separate border-spacing-1 min-w-full" aria-label="Daily price move per holding">
          <thead>
            <tr>
              <th className="text-left pr-2 font-normal" />
              {displayDates.map((d) => (
                <th key={d} className="font-normal text-center whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>{d.slice(8)}/{d.slice(5, 7)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displaySymbols.map((sym) => (
              <tr key={sym}>
                <th scope="row" className="pr-2 text-left font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{sym}</th>
                {displayDates.map((date) => {
                  const cell = cellMap.get(`${sym}:${date}`);
                  if (!cell) return <td key={date}><div className="h-8 min-w-[2.75rem] rounded-lg" style={{ background: 'var(--color-bg)' }} aria-label="no data" /></td>;
                  const c = heatCell(cell.dayChangePct);
                  return (
                    <td key={date}>
                      <div
                        className="h-8 min-w-[2.75rem] px-1 rounded-lg flex items-center justify-center font-medium tabular-nums"
                        aria-label={`${sym} ${date} ${fmtPct(cell.dayChangePct)}${cell.unexplained ? ', unexplained' : ''}`}
                        style={{
                          background: fill(c),
                          color: c.strong ? 'var(--color-bg)' : 'var(--color-text)',
                          outline: cell.unexplained ? '2px solid var(--chart-warn)' : 'none',
                          outlineOffset: 1,
                        }}
                      >
                        {fmtPct(cell.dayChangePct)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs" style={{ color: 'var(--color-muted)' }}>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-3 rounded" style={{ background: fill(heatCell(-3)) }} />Fall</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-3 rounded" style={{ background: fill(heatCell(3)) }} />Rise</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-3 rounded" style={{ outline: '2px solid var(--chart-warn)' }} />Material move with no ticker news (from the observation log)</span>
      </div>
    </div>
  );
}
