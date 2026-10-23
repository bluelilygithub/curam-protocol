// Reminder helpers for Notes: what state a note's reminder is in, how to word it, and the quick times offered when setting one.
// Pure (no React, no fetch) so it is unit-tested: node client/src/pages/notes/noteReminders.test.mjs
// Times are the person's own local clock; the browser sends the server an ISO instant, which the server stores.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const at = (d, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());

/** 'none' (no reminder) | 'upcoming' (still to come) | 'due' (time has come, not marked done) | 'done' (marked done). */
export function reminderState(note, now = new Date()) {
  if (!note || !note.remind_at) return 'none';
  if (note.reminder_done_at) return 'done';
  const when = new Date(note.remind_at);
  if (Number.isNaN(when.getTime())) return 'none';
  return when <= now ? 'due' : 'upcoming';
}

function clock(d) {
  const h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Today, 9:00 am", "Tomorrow, 9:00 am", "Yesterday, 9:00 am", "Fri 24 Oct, 9:00 am", or with the year when it is not this year. */
export function formatReminder(iso, now = new Date()) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  const days = Math.round((startOfDay(when) - startOfDay(now)) / 86400000);
  const time = clock(when);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days === -1) return `Yesterday, ${time}`;
  const date = `${WEEKDAYS[when.getDay()]} ${when.getDate()} ${MONTHS[when.getMonth()]}${when.getFullYear() !== now.getFullYear() ? ` ${when.getFullYear()}` : ''}`;
  return `${date}, ${time}`;
}

/**
 * The quick choices when setting a reminder: [{ id, label, at: Date }], all in the future.
 * "This evening" is only offered while 5 pm is still at least half an hour away.
 */
export function quickOptions(now = new Date()) {
  const out = [{ id: 'hour', label: 'In 1 hour', at: new Date(now.getTime() + 3600 * 1000) }];
  const evening = at(now, 17, 0);
  if (evening.getTime() - now.getTime() >= 30 * 60 * 1000) out.push({ id: 'evening', label: 'This evening, 5:00 pm', at: evening });
  out.push({ id: 'tomorrow', label: 'Tomorrow, 9:00 am', at: at(addDays(now, 1), 9, 0) });
  const untilMonday = ((8 - now.getDay()) % 7) || 7; // next Monday, never today
  out.push({ id: 'monday', label: 'Next Monday, 9:00 am', at: at(addDays(now, untilMonday), 9, 0) });
  return out;
}

/** A Date as the value of a <input type="datetime-local"> ('2026-10-24T09:00'), in local time. */
export function toLocalInput(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The Date for a datetime-local value, or null if it is blank or not a real moment. */
export function fromLocalInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

/** How many notes in a list have a reminder that is due now. */
export const dueCount = (notes, now = new Date()) => (Array.isArray(notes) ? notes : []).filter((n) => reminderState(n, now) === 'due').length;

/** How a reminder can repeat: what the server accepts (server/services/noteRepeat.js), and the words for the choice. */
export const REPEATS = [
  { id: 'none', label: 'Does not repeat', words: '' },
  { id: 'daily', label: 'Every day', words: 'daily' },
  { id: 'weekdays', label: 'Every weekday', words: 'on weekdays' },
  { id: 'weekly', label: 'Every week', words: 'weekly' },
  { id: 'fortnightly', label: 'Every 2 weeks', words: 'every 2 weeks' },
  { id: 'monthly', label: 'Every month', words: 'monthly' },
  { id: 'yearly', label: 'Every year', words: 'yearly' },
];

/** The repeat a note has, as one of the ids above ('none' for anything else). */
export const repeatOf = (note) => (REPEATS.some((r) => r.id === note?.remind_repeat) ? note.remind_repeat : 'none');

/** "Today, 9:00 am" for a one-off, "Today, 9:00 am, repeats weekly" for one that comes round again. */
export function reminderText(note, now = new Date()) {
  if (!note?.remind_at) return '';
  const base = formatReminder(note.remind_at, now);
  const words = REPEATS.find((r) => r.id === repeatOf(note))?.words;
  return base && words ? `${base}, repeats ${words}` : base;
}

/** The person's own time zone, so a repeat keeps its time of day when the clocks change ('' if the browser will not say). */
export function localZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
}
