// Shared Recharts styling from the theme vars (DESIGN.md "Chart tokens"). Pure, no React, nothing tool-specific.
export const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
export const seriesColor = (i) => SERIES[((i % SERIES.length) + SERIES.length) % SERIES.length];

const TICK = { fontSize: 12, fill: 'var(--color-muted)' };
export const xAxisProps = { tick: TICK, axisLine: false, tickLine: false, tickMargin: 8 };
export const yAxisProps = { tick: TICK, axisLine: false, tickLine: false, width: 56 };
export const gridProps = { stroke: 'var(--chart-grid)', strokeDasharray: '0', vertical: false };

export function reducedMotion() {
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
/** Spread onto a Recharts series: no animation when the person asked for reduced motion. */
export const animationProps = () => (reducedMotion() ? { isAnimationActive: false } : { animationDuration: 200 });
