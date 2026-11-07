// SERP Tracker, Keywords tab: the small pure helpers (text for a position, the Change column, the chart's smoothing and axis). Pure, so
// `node client/src/pages/serpTracker/keywordsHelpers.test.mjs` checks them.

/** 4.256 -> "4.3", nothing -> a dash. */
export function positionText(p) {
  return p == null || !Number.isFinite(Number(p)) ? '—' : Number(p).toFixed(1);
}

/** The Change column. `change` is the earlier position minus the current one, so a positive number means it moved UP Google (a smaller number is better). */
export function changeText(change) {
  if (change == null || !Number.isFinite(Number(change))) return { text: '—', dir: 'none' };
  const c = Number(change);
  if (Math.abs(c) < 0.05) return { text: '0.0', dir: 'none' };
  return c > 0 ? { text: `▲ ${c.toFixed(1)}`, dir: 'up' } : { text: `▼ ${Math.abs(c).toFixed(1)}`, dir: 'down' };
}

export function periodLabel(days) {
  return ({ 7: 'Last 7 days', 28: 'Last 28 days', 90: 'Last 3 months', 180: 'Last 6 months', all: 'All history' })[days] || 'This period';
}

/**
 * A trailing average of position over `n` days, weighted by impressions (a day with 2 impressions should not count as much as one with 200).
 * One value per input day; null where no day in the window had a position.
 */
export function movingAverage(days, n = 7) {
  return days.map((_, i) => {
    let sum = 0;
    let weight = 0;
    for (let j = Math.max(0, i - n + 1); j <= i; j++) {
      const d = days[j];
      if (d.position == null) continue;
      const w = d.impressions > 0 ? d.impressions : 1;
      sum += d.position * w;
      weight += w;
    }
    return weight ? Number((sum / weight).toFixed(2)) : null;
  });
}

/** The position axis: just past the best and worst day, never above position 1. @returns [min, max] */
export function chartDomain(series) {
  const ps = series.map((d) => d.position).filter((p) => p != null);
  if (!ps.length) return [1, 10];
  return [Math.max(1, Math.floor(Math.min(...ps)) - 1), Math.ceil(Math.max(...ps)) + 1];
}
