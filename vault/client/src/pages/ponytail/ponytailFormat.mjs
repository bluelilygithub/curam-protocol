// Ponytail report: formatting and small calculations shared by the page's parts. Pure, so node can test it:
//   node client/src/pages/ponytail/ponytailFormat.test.mjs

export const money = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '–' : `$${Number(v).toFixed(2)}`);

/** 1234 -> "1.2K", 3400000 -> "3.4M". */
export function compact(v) {
  const n = Number(v) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export const minutes = (ms) => `${((Number(ms) || 0) / 60000).toFixed(1)} min`;

export const pct = (v) => (v === null || v === undefined ? '–' : `${Math.round(Number(v))}%`);

export const totalTokens = (t) => (t ? (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0) : 0);

/** Share of tasks whose tests passed, of those that ran tests at all; null when none did. */
export const testsShare = (passed, run) => (run > 0 ? Math.round((passed / run) * 100) : null);

const two = (n) => String(n).padStart(2, '0');
/** A Date -> "YYYY-MM-DD" in Brisbane time (UTC+10 all year). */
export function brisbaneDay(d = new Date()) {
  const b = new Date(d.getTime() + 10 * 3600 * 1000);
  return `${b.getUTCFullYear()}-${two(b.getUTCMonth() + 1)}-${two(b.getUTCDate())}`;
}
/** "YYYY-MM-DD" moved by n days. */
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}`;
}

/** Every day from..to (inclusive), each with the matching row or zeros, so a chart has no missing days. At most 400 days. */
export function fillDays(rows, from, to) {
  const byDay = new Map((rows || []).map((r) => [r.day, r]));
  const out = [];
  for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i += 1) {
    out.push(byDay.get(d) || { day: d, tasks: 0, cost: 0, reuse: null, input: 0, output: 0, cache: 0 });
  }
  return out;
}

/** "2026-11-19" -> "19 Nov". */
export function shortDay(day) {
  const [, m, d] = String(day).split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] || ''}`;
}

/** An ISO time -> "19 Nov 2026, 09:30" in Brisbane time. */
export function brisbaneTime(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  const day = brisbaneDay(d);
  const b = new Date(d.getTime() + 10 * 3600 * 1000);
  return `${shortDay(day)} ${day.slice(0, 4)}, ${two(b.getUTCHours())}:${two(b.getUTCMinutes())}`;
}

export const RANGES = [
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '365', label: 'Last 12 months', days: 365 },
];
