// Groups changelog entries by day, week (Monday start), month or year, newest first. Pure, so it is tested without a browser.
// Dates are read in the viewer's own time zone, so "today" means the viewer's today.

export const GROUPINGS = ['day', 'week', 'month', 'year'];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Monday of the week containing d (local time). */
export function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const back = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - back);
  return x;
}

export function groupKey(date, mode) {
  const d = new Date(date);
  if (mode === 'year') return String(d.getFullYear());
  if (mode === 'month') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  if (mode === 'week') return ymd(weekStart(d));
  return ymd(d);
}

export function groupLabel(key, mode) {
  if (mode === 'year') return key;
  const [y, m, dd] = key.split('-').map(Number);
  if (mode === 'month') return new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  const d = new Date(y, m - 1, dd);
  if (mode === 'week') {
    const end = new Date(y, m - 1, dd + 6);
    const f = (x, withYear) => x.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
    return `Week of ${f(d, false)} to ${f(end, true)}`;
  }
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** [{ key, label, entries }] newest group first; entries inside a group newest first. */
export function groupEntries(entries, mode) {
  const m = GROUPINGS.includes(mode) ? mode : 'day';
  const sorted = [...(entries || [])].sort((a, b) => new Date(b.committedAt) - new Date(a.committedAt));
  const groups = [];
  const index = new Map();
  for (const e of sorted) {
    const key = groupKey(e.committedAt, m);
    if (!index.has(key)) { const g = { key, label: groupLabel(key, m), entries: [] }; index.set(key, g); groups.push(g); }
    index.get(key).entries.push(e);
  }
  return groups;
}

/** True when an entry carries a real concern (not an empty field or "None noted..."). */
export function hasConcern(entry) {
  const c = String(entry?.concerns || '').trim();
  return !!c && !/^none noted/i.test(c);
}
