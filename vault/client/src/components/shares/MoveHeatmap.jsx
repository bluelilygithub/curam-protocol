import React from 'react';

function cellColor(pct) {
  const v = Number(pct) || 0;
  if (v >= 2) return '#16a34a';
  if (v >= 0.5) return '#86efac';
  if (v <= -2) return '#dc2626';
  if (v <= -0.5) return '#fca5a5';
  return 'var(--color-border)';
}

export default function MoveHeatmap({ heatmap }) {
  const { symbols = [], dates = [], cells = [] } = heatmap || {};
  if (!symbols.length || !dates.length) {
    return (
      <p className="text-xs py-6 text-center" style={{ color: 'var(--color-muted)' }}>
        Need more snapshot history for the move heatmap — check back after a few polling days.
      </p>
    );
  }

  const cellMap = new Map(cells.map((c) => [`${c.symbol}:${c.date}`, c]));
  const displayDates = dates.slice(-10);
  const displaySymbols = symbols.slice(0, 10);

  return (
    <div className="overflow-x-auto">
      <table className="text-[10px] border-collapse min-w-full">
        <thead>
          <tr>
            <th className="text-left py-1 pr-2 font-medium" style={{ color: 'var(--color-muted)' }} />
            {displayDates.map((d) => (
              <th key={d} className="px-1 py-1 font-normal text-center whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                {d.slice(5)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displaySymbols.map((sym) => (
            <tr key={sym}>
              <td className="py-1 pr-2 font-medium whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{sym}</td>
              {displayDates.map((date) => {
                const cell = cellMap.get(`${sym}:${date}`);
                if (!cell) {
                  return (
                    <td key={date} className="p-0.5">
                      <div className="w-8 h-6 rounded" style={{ background: 'var(--color-bg)' }} />
                    </td>
                  );
                }
                return (
                  <td key={date} className="p-0.5" title={`${cell.dayChangePct}%${cell.unexplained ? ' · unexplained' : ''}`}>
                    <div
                      className="w-8 h-6 rounded flex items-center justify-center text-[8px] font-medium"
                      style={{
                        background: cellColor(cell.dayChangePct),
                        color: Math.abs(cell.dayChangePct) >= 1 ? '#fff' : 'var(--color-muted)',
                        outline: cell.unexplained ? '2px solid #f59e0b' : 'none',
                      }}
                    >
                      {Math.abs(cell.dayChangePct) >= 0.5 ? `${cell.dayChangePct > 0 ? '+' : ''}${cell.dayChangePct}` : ''}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] mt-2" style={{ color: 'var(--color-muted)' }}>
        Amber outline = material move with no ticker news (from observation log).
      </p>
    </div>
  );
}
