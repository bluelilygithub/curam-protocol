/**
 * Natural language date parser — pure frontend, no API calls.
 * All dates are local time.
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function setTime(date, hours, minutes) {
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function parseTimeString(timeStr) {
  // Returns { h, m } or null
  const t = timeStr.trim().toLowerCase();
  // 2pm / 2am
  const ampm = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = parseInt(ampm[2] || '0');
    if (ampm[3] === 'pm' && h < 12) h += 12;
    if (ampm[3] === 'am' && h === 12) h = 0;
    return { h, m };
  }
  // 14:30 / 9:00
  const hhmm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    return { h: parseInt(hhmm[1]), m: parseInt(hhmm[2]) };
  }
  return null;
}

function nextWeekday(dayIndex, fromDate) {
  // Returns next occurrence of dayIndex (0=Sun) after fromDate
  const d = new Date(fromDate);
  const current = d.getDay();
  let diff = dayIndex - current;
  if (diff <= 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * Parse a natural language date string into a Date object (local time), or null.
 */
export function parseNaturalDate(input) {
  if (!input || !input.trim()) return null;

  const raw = input.trim().toLowerCase();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Try to split off a time component at the end
  // e.g. "tomorrow 3pm", "next friday 14:30"
  let datePart = raw;
  let timePart = null;

  const timeAtEnd = raw.match(/\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})$/);
  if (timeAtEnd) {
    datePart = raw.slice(0, timeAtEnd.index).trim();
    timePart = timeAtEnd[1];
  }

  let result = null;

  if (datePart === 'today') {
    result = new Date(today);
  } else if (datePart === 'tomorrow') {
    result = new Date(today);
    result.setDate(result.getDate() + 1);
  } else if (datePart === 'yesterday') {
    result = new Date(today);
    result.setDate(result.getDate() - 1);
  } else if (datePart === 'end of week') {
    result = nextWeekday(0, today); // Sunday
  } else if (datePart === 'end of month') {
    result = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  } else if (datePart === 'next week') {
    // Monday of next week
    result = nextWeekday(1, today);
  } else if (datePart === 'next month') {
    result = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  // "in N days/weeks/months"
  } else {
    const inMatch = datePart.match(/^in\s+(\d+)\s+(day|days|week|weeks|month|months)$/);
    if (inMatch) {
      const n = parseInt(inMatch[1]);
      result = new Date(today);
      if (inMatch[2].startsWith('day')) result.setDate(result.getDate() + n);
      else if (inMatch[2].startsWith('week')) result.setDate(result.getDate() + n * 7);
      else if (inMatch[2].startsWith('month')) result.setMonth(result.getMonth() + n);
    }
  }

  if (!result) {
    // "next monday", "next friday", "this friday"
    const nextDay = datePart.match(/^(next|this)\s+(\w+)$/);
    if (nextDay) {
      const dayIdx = WEEKDAYS.indexOf(nextDay[2]);
      if (dayIdx !== -1) {
        if (nextDay[1] === 'next') {
          result = nextWeekday(dayIdx, today);
        } else {
          // "this X" — coming occurrence within current week (could be today or earlier = use next occurrence)
          const d = new Date(today);
          const diff = dayIdx - d.getDay();
          d.setDate(d.getDate() + (diff >= 0 ? diff : diff + 7));
          result = d;
        }
      }
    }
  }

  if (!result) {
    // bare weekday name "monday", "friday"
    const dayIdx = WEEKDAYS.indexOf(datePart);
    if (dayIdx !== -1) {
      result = nextWeekday(dayIdx, today);
    }
  }

  if (!result) {
    // "mar 15" / "15 mar" / "march 15" / "15 march"
    const monthDayA = datePart.match(/^([a-z]+)\s+(\d{1,2})$/);
    const monthDayB = datePart.match(/^(\d{1,2})\s+([a-z]+)$/);
    const md = monthDayA || monthDayB;
    if (md) {
      const [, a, b] = md;
      let monthStr, dayNum;
      if (monthDayA) { monthStr = a; dayNum = parseInt(b); }
      else { dayNum = parseInt(a); monthStr = b; }
      let monthIdx = MONTHS.indexOf(monthStr);
      if (monthIdx === -1) monthIdx = MONTHS_SHORT.indexOf(monthStr);
      if (monthIdx !== -1 && dayNum >= 1 && dayNum <= 31) {
        result = new Date(today.getFullYear(), monthIdx, dayNum);
        if (result < today) result.setFullYear(result.getFullYear() + 1);
      }
    }
  }

  if (!result) {
    // "15/03" or "03-15" (day/month ambiguity — treat first as day if ≤ 12, else month)
    const slashDash = datePart.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
    if (slashDash) {
      let d = parseInt(slashDash[1]);
      let m = parseInt(slashDash[2]);
      // Assume DD/MM
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        result = new Date(today.getFullYear(), m - 1, d);
        if (result < today) result.setFullYear(result.getFullYear() + 1);
      }
    }
  }

  if (!result) {
    // "15/03/2027" or "2027-03-15"
    const fullDate = datePart.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    const fullDateDMY = datePart.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (fullDate) {
      result = new Date(parseInt(fullDate[1]), parseInt(fullDate[2]) - 1, parseInt(fullDate[3]));
    } else if (fullDateDMY) {
      result = new Date(parseInt(fullDateDMY[3]), parseInt(fullDateDMY[2]) - 1, parseInt(fullDateDMY[1]));
    }
  }

  if (!result) return null;

  // Apply time component
  if (timePart) {
    const parsed = parseTimeString(timePart);
    if (parsed) {
      setTime(result, parsed.h, parsed.m);
    } else {
      setTime(result, 9, 0);
    }
  } else if (datePart === 'today') {
    // keep current time for 'today', set 9am for everything else
    setTime(result, now.getHours(), now.getMinutes());
  } else {
    setTime(result, 9, 0);
  }

  return result;
}

/**
 * Format a Date for human display: "Mar 15 2026 14:30" or "Mar 15 2026"
 */
export function formatDateForInput(date) {
  if (!date) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = date.getDate();
  const m = months[date.getMonth()];
  const y = date.getFullYear();
  const h = date.getHours();
  const min = date.getMinutes();
  const hasTime = h !== 9 || min !== 0;
  if (hasTime) {
    return `${m} ${d} ${y} ${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }
  return `${m} ${d} ${y}`;
}

/**
 * Format a Date as ISO string for API: "2026-03-15T14:30" or "2026-03-15"
 */
export function toISOForAPI(date) {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = date.getHours();
  const min = date.getMinutes();
  const hasTime = h !== 0 || min !== 0;
  if (hasTime) {
    return `${y}-${m}-${d}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }
  return `${y}-${m}-${d}`;
}
