// Grouping and date ranges for the Notes list. Pure (no React, no fetch) so it is unit-tested:
//   node client/src/pages/notes/noteGroups.test.mjs
// Dates are the person's local calendar days, not UTC, so "Today" starts at their midnight.

export const DATE_PRESETS = [
  { id: 'all', label: 'Any time' },
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Pick dates' },
];

export const GROUP_MODES = [
  { id: 'date', label: 'Date' },
  { id: 'project', label: 'Project' },
  { id: 'client', label: 'Client' },
];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** 'YYYY-MM-DD' (from a date input) as local midnight, or null if it is not a real date. */
export function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

/**
 * The { from, to } the server wants (ISO instants, `to` exclusive) for a preset, or {} for none.
 * Custom takes 'YYYY-MM-DD' strings; either end may be left blank, and a from after the to are swapped so a slip still finds notes.
 */
export function rangeFor(preset, custom = {}, now = new Date()) {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  switch (preset) {
    case 'today': return { from: today.toISOString(), to: tomorrow.toISOString() };
    case '7d': return { from: addDays(today, -6).toISOString(), to: tomorrow.toISOString() };
    case '30d': return { from: addDays(today, -29).toISOString(), to: tomorrow.toISOString() };
    case 'year': return { from: new Date(today.getFullYear(), 0, 1).toISOString(), to: tomorrow.toISOString() };
    case 'custom': {
      let a = parseDay(custom.from);
      let b = parseDay(custom.to);
      if (a && b && a > b) [a, b] = [b, a];
      const out = {};
      if (a) out.from = a.toISOString();
      if (b) out.to = addDays(b, 1).toISOString(); // the "to" day is included
      return out;
    }
    default: return {};
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Which date section a timestamp falls in: Today, Yesterday, Previous 7 days, Previous 30 days, then "Month Year". */
export function dateBucket(value, now = new Date()) {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return { key: 'unknown', label: 'Undated', order: -1 };
  const today = startOfDay(now);
  const day = startOfDay(when);
  if (day >= today) return { key: 'today', label: 'Today', order: 0 };
  if (day >= addDays(today, -1)) return { key: 'yesterday', label: 'Yesterday', order: 1 };
  if (day >= addDays(today, -7)) return { key: '7d', label: 'Previous 7 days', order: 2 };
  if (day >= addDays(today, -30)) return { key: '30d', label: 'Previous 30 days', order: 3 };
  const label = `${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
  return { key: `m${day.getFullYear()}-${String(day.getMonth()).padStart(2, '0')}`, label, order: 10 };
}

/**
 * Split notes (already newest-first) into sections for display. Order inside a section is kept.
 *   Pinned notes (pinned_at set) always come first, in one "Pinned" section, whatever the mode.
 *   mode 'date'    -> by `field` (updated_at / created_at) as Today, Yesterday, ... then months
 *   mode 'project' -> by project name, busiest-recent first, "No project" last
 *   mode 'client'  -> by client name, same, "No client" last
 * Returns [{ key, label, notes }].
 */
export function groupNotes(notes, { mode = 'date', field = 'updated', now = new Date() } = {}) {
  const all = Array.isArray(notes) ? notes : [];
  const pinned = all.filter((n) => n.pinned_at);
  const list = pinned.length ? all.filter((n) => !n.pinned_at) : all;
  const dateKey = field === 'created' ? 'created_at' : 'updated_at';
  const sections = new Map();
  const put = (key, label, note, meta = {}) => {
    if (!sections.has(key)) sections.set(key, { key, label, notes: [], ...meta });
    sections.get(key).notes.push(note);
  };

  for (const note of list) {
    if (mode === 'project' || mode === 'client') {
      const name = mode === 'project' ? note.project_name : note.client_name;
      const id = mode === 'project' ? note.project_id : note.client_id;
      if (name && id != null) put(`${mode}:${id}`, name, note);
      else put(`${mode}:none`, mode === 'project' ? 'No project' : 'No client', note, { last: true });
    } else {
      const b = dateBucket(note[dateKey], now);
      put(b.key, b.label, note, { order: b.order });
    }
  }

  const out = [...sections.values()];
  const head = pinned.length ? [{ key: 'pinned', label: 'Pinned', notes: pinned }] : [];
  if (mode === 'date') return [...head, ...out.map(({ order, ...s }) => s)]; // already newest-first, so insertion order is date order
  // named groups keep the order their newest note first appeared in; the catch-all goes last
  return [...head, ...out.map(({ last, ...s }) => ({ ...s, _last: !!last })).sort((a, b) => Number(a._last) - Number(b._last)).map(({ _last, ...s }) => s)];
}

/** A short label for the active filters, for the "N notes" line and the empty state. */
export function filtersSummary({ preset, custom, search, project, client }) {
  const parts = [];
  if (search) parts.push(`matching "${search}"`);
  if (preset && preset !== 'all') {
    const p = DATE_PRESETS.find((x) => x.id === preset);
    if (preset === 'custom') {
      const bits = [custom?.from, custom?.to].filter(Boolean);
      if (bits.length) parts.push(bits.length === 2 ? `${bits[0]} to ${bits[1]}` : custom?.from ? `from ${custom.from}` : `up to ${custom.to}`);
    } else if (p) parts.push(p.label.toLowerCase());
  }
  if (project) parts.push('in this project');
  if (client) parts.push('for this client');
  return parts.join(', ');
}
