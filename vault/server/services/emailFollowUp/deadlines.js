'use strict';

// Deadline reading (case model §5). The tool routes deadlines; it never owns them.
// A deadline is either exact (with the arithmetic inputs kept, Rule 5.2) or needs_review with the raw text preserved
// and the missing input named (Rule 5.3). Nothing is ever guessed. Pure: the clock is always passed in.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

/** Calendar date of an instant in a zone (never the viewer's zone, Rule 5.4). */
function localDate(iso, tz) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) throw new Error(`bad instant: ${iso}`);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(dt);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return ymd(get('year'), get('month'), get('day'));
}

function toUtc(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromUtc(ms) {
  const dt = new Date(ms);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
function addDays(s, n) { return fromUtc(toUtc(s) + n * 86400000); }
function daysBetween(a, b) { return Math.round((toUtc(b) - toUtc(a)) / 86400000); }
function weekdayOf(s) { return new Date(toUtc(s)).getUTCDay(); }
function validDay(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function review(raw, tz, missing, why) {
  return { status: 'needs_review', date: null, raw, tz, missing: missing || [], why: why || null };
}
function exact(raw, tz, date, how, startRef) {
  return { status: 'exact', date, raw, tz, how, startRef: startRef || null, missing: [] };
}

/** The date a bare day of month ("the 23rd") means: this month, or next month if that day has already passed. */
function nextDayOfMonth(sent, dom) {
  let y = +sent.slice(0, 4);
  let mo = +sent.slice(5, 7);
  if (dom < +sent.slice(8, 10)) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
  return validDay(y, mo, dom) ? ymd(y, mo, dom) : null;
}

/**
 * Read a deadline phrase.
 * @param {string} raw the person's own words ("by Friday the 23rd", "early next week")
 * @param {{sentAt: string, tz: string, startDate?: string}} ctx sentAt = when the message was sent (ISO); startDate = a stated start for "within N days" rules
 */
function parseDeadline(raw, ctx) {
  const tz = ctx.tz;
  const text = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return review(raw, tz, ['deadline wording'], 'no deadline wording');
  const sent = ctx.sentAt ? localDate(ctx.sentAt, tz) : null;

  // within N (business) days of <something>: needs a stated start, and business days need a pinned holiday calendar
  const within = text.match(/within (\d+) (business |working )?days?(?: of| from| after)?\s*([a-z ]*)/);
  if (within) {
    if (within[2]) return review(raw, tz, ['pinned holiday calendar for the jurisdiction'], 'business days need a pinned calendar (Rule 5.4)');
    if (!ctx.startDate) {
      const what = (within[3] || '').trim() || 'start';
      return review(raw, tz, [`${what} date not stated`], 'implied start date (Rule 5.3)');
    }
    return exact(raw, tz, addDays(ctx.startDate, Number(within[1])), `${within[1]} days after ${ctx.startDate}`, ctx.startDate);
  }

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso && validDay(+iso[1], +iso[2], +iso[3])) return exact(raw, tz, iso[0], 'stated ISO date');

  const monthRe = MONTHS.join('|');
  let m = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (${monthRe})(?:,? (\\d{4}))?\\b`));
  let day; let month; let year;
  if (m) { day = +m[1]; month = MONTHS.indexOf(m[2]) + 1; year = m[3] ? +m[3] : null; }
  if (!m) {
    m = text.match(new RegExp(`\\b(${monthRe}) (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b`));
    if (m) { month = MONTHS.indexOf(m[1]) + 1; day = +m[2]; year = m[3] ? +m[3] : null; }
  }
  if (m) {
    if (!year) {
      if (!sent) return review(raw, tz, ['year (message date unknown)']);
      year = +sent.slice(0, 4);
      if (ymd(year, month, day) < sent) year += 1;
    }
    if (!validDay(year, month, day)) return review(raw, tz, [], 'not a real calendar date');
    return exact(raw, tz, ymd(year, month, day), 'stated date');
  }

  // "next friday" is ambiguous in everyday speech: refuse to pick a reading
  if (new RegExp(`\\bnext (${WEEKDAYS.join('|')})\\b`).test(text)) {
    return review(raw, tz, ['which day is meant ("next <weekday>" is ambiguous)'], 'ambiguous weekday');
  }

  // weekday, optionally with "the 23rd": "by friday the 23rd"
  const wd = text.match(new RegExp(`\\b(${WEEKDAYS.join('|')})\\b(?:,? (?:the )?(\\d{1,2})(?:st|nd|rd|th)?)?`));
  if (wd) {
    if (!sent) return review(raw, tz, ['message sent date']);
    const wdIndex = WEEKDAYS.indexOf(wd[1]);
    if (wd[2]) {
      const date = nextDayOfMonth(sent, +wd[2]);
      if (!date) return review(raw, tz, [], 'not a real calendar date');
      if (weekdayOf(date) !== wdIndex) return review(raw, tz, [`${wd[1]} and the ${wd[2]}th do not agree`], 'weekday and day of month disagree');
      return exact(raw, tz, date, 'weekday plus day of month');
    }
    const delta = (wdIndex - weekdayOf(sent) + 7) % 7;
    return exact(raw, tz, addDays(sent, delta), `first ${wd[1]} on or after the message date ${sent}`);
  }

  const dayOnly = text.match(/\bthe (\d{1,2})(?:st|nd|rd|th)\b/);
  if (dayOnly && sent) {
    const date = nextDayOfMonth(sent, +dayOnly[1]);
    if (!date) return review(raw, tz, [], 'not a real calendar date');
    return exact(raw, tz, date, 'day of month');
  }

  if (/\btoday\b/.test(text) && sent) return exact(raw, tz, sent, 'today');
  if (/\btomorrow\b/.test(text) && sent) return exact(raw, tz, addDays(sent, 1), 'tomorrow');

  // "early next week", "end of month", "soon", "asap": never invent a date
  return review(raw, tz, ['a stated date'], 'vague wording');
}

module.exports = { parseDeadline, localDate, addDays, daysBetween, weekdayOf, MONTHS, WEEKDAYS };
