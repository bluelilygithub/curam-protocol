'use strict';

const { callModel } = require('./callModel');

const CALENDAR_LIMITS = {
  list:    20,
  find:    10,
  check:   10,
  count:  250,
  default: 10,
};

/**
 * Pre-compute all relevant date ranges as ISO 8601 strings for the Calendar API.
 * All day boundaries are at UTC midnight to avoid DST issues.
 */
function calculateDates(todayStr) {
  const d = new Date(todayStr + 'T00:00:00Z');
  const iso = (dt) => dt.toISOString();
  const addDays = (dt, n) => {
    const x = new Date(dt);
    x.setUTCDate(x.getUTCDate() + n);
    return x;
  };

  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-indexed

  // Week: Mon–Sun
  const dayOfWeek      = d.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisWeekMon    = addDays(d, -daysFromMonday);
  const nextWeekMon    = addDays(thisWeekMon, 7);
  const nextWeekEnd    = addDays(nextWeekMon, 7);

  // Month
  const thisMonthStart = new Date(Date.UTC(year, month, 1));
  const nextMonthStart = new Date(Date.UTC(year, month + 1, 1));
  const lastMonthStart = new Date(Date.UTC(year, month - 1, 1));

  // Quarters
  const quarterMonth = Math.floor(month / 3) * 3;
  const thisQStart   = new Date(Date.UTC(year, quarterMonth, 1));
  const lastQStart   = quarterMonth === 0
    ? new Date(Date.UTC(year - 1, 9, 1))
    : new Date(Date.UTC(year, quarterMonth - 3, 1));
  const lastQEnd     = quarterMonth === 0
    ? new Date(Date.UTC(year, 0, 1))
    : new Date(Date.UTC(year, quarterMonth, 1));

  // Australian FY: Jul–Jun
  const currentFYStart = month >= 6
    ? new Date(Date.UTC(year,     6, 1))
    : new Date(Date.UTC(year - 1, 6, 1));
  const currentFYEnd   = month >= 6
    ? new Date(Date.UTC(year + 1, 6, 1))
    : new Date(Date.UTC(year,     6, 1));
  const lastFYStart    = month >= 6
    ? new Date(Date.UTC(year - 1, 6, 1))
    : new Date(Date.UTC(year - 2, 6, 1));
  const lastFYEnd      = month >= 6
    ? new Date(Date.UTC(year,     6, 1))
    : new Date(Date.UTC(year - 1, 6, 1));

  // Named days this week (index 0 = Monday)
  const weekDayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const weekDays = weekDayNames.reduce((acc, name, i) => {
    acc[name] = addDays(thisWeekMon, i);
    return acc;
  }, {});

  const tomorrow = addDays(d, 1);

  return {
    today:          todayStr,
    todayStart:     iso(d),
    todayEnd:       iso(addDays(d, 1)),
    tomorrowStart:  iso(tomorrow),
    tomorrowEnd:    iso(addDays(d, 2)),
    thisWeekStart:  iso(thisWeekMon),
    thisWeekEnd:    iso(nextWeekMon),
    nextWeekStart:  iso(nextWeekMon),
    nextWeekEnd:    iso(nextWeekEnd),
    thisMonthStart: iso(thisMonthStart),
    thisMonthEnd:   iso(nextMonthStart),
    lastMonthStart: iso(lastMonthStart),
    lastMonthEnd:   iso(thisMonthStart),
    ago7:           iso(addDays(d, -7)),
    ago30:          iso(addDays(d, -30)),
    ago90:          iso(addDays(d, -90)),
    future7:        iso(addDays(d, 7)),
    future14:       iso(addDays(d, 14)),
    future30:       iso(addDays(d, 30)),
    future90:       iso(addDays(d, 90)),
    thisQStart:     iso(thisQStart),
    lastQStart:     iso(lastQStart),
    lastQEnd:       iso(lastQEnd),
    currentFYStart: iso(currentFYStart),
    currentFYEnd:   iso(currentFYEnd),
    lastFYStart:    iso(lastFYStart),
    lastFYEnd:      iso(lastFYEnd),
    // Named week days
    mondayStart:    iso(weekDays.monday),    mondayEnd:    iso(addDays(weekDays.monday,    1)),
    tuesdayStart:   iso(weekDays.tuesday),   tuesdayEnd:   iso(addDays(weekDays.tuesday,   1)),
    wednesdayStart: iso(weekDays.wednesday), wednesdayEnd: iso(addDays(weekDays.wednesday, 1)),
    thursdayStart:  iso(weekDays.thursday),  thursdayEnd:  iso(addDays(weekDays.thursday,  1)),
    fridayStart:    iso(weekDays.friday),    fridayEnd:    iso(addDays(weekDays.friday,    1)),
    saturdayStart:  iso(weekDays.saturday),  saturdayEnd:  iso(addDays(weekDays.saturday,  1)),
    sundayStart:    iso(weekDays.sunday),    sundayEnd:    iso(addDays(weekDays.sunday,    1)),
  };
}

function buildSystemPrompt(dates) {
  // Helper to replace T00: with a time offset for time-of-day examples
  const atHour = (isoStr, h) => isoStr.replace('T00:00:00.000Z', `T${String(h).padStart(2,'0')}:00:00Z`);

  return `You are a Google Calendar query translator. Convert natural language into a structured Google Calendar API query.

TODAY IS ${dates.today} (UTC). Use ONLY the pre-computed date ranges below — never invent or calculate your own dates.

PRE-COMPUTED DATE RANGES (ISO 8601, UTC midnight boundaries):
- today                   → timeMin: ${dates.todayStart},     timeMax: ${dates.todayEnd}
- tomorrow                → timeMin: ${dates.tomorrowStart},  timeMax: ${dates.tomorrowEnd}
- this week (Mon–Sun)     → timeMin: ${dates.thisWeekStart},  timeMax: ${dates.thisWeekEnd}
- next week               → timeMin: ${dates.nextWeekStart},  timeMax: ${dates.nextWeekEnd}
- this month              → timeMin: ${dates.thisMonthStart}, timeMax: ${dates.thisMonthEnd}
- last month              → timeMin: ${dates.lastMonthStart}, timeMax: ${dates.lastMonthEnd}
- last 7 days             → timeMin: ${dates.ago7},           timeMax: ${dates.todayEnd}
- last 30 days            → timeMin: ${dates.ago30},          timeMax: ${dates.todayEnd}
- next 7 days             → timeMin: ${dates.todayStart},     timeMax: ${dates.future7}
- next 14 days            → timeMin: ${dates.todayStart},     timeMax: ${dates.future14}
- next 30 days            → timeMin: ${dates.todayStart},     timeMax: ${dates.future30}
- next 90 days            → timeMin: ${dates.todayStart},     timeMax: ${dates.future90}
- this quarter            → timeMin: ${dates.thisQStart}      (no timeMax needed)
- last quarter            → timeMin: ${dates.lastQStart},     timeMax: ${dates.lastQEnd}
- current financial year  → timeMin: ${dates.currentFYStart}, timeMax: ${dates.currentFYEnd}
- last financial year     → timeMin: ${dates.lastFYStart},    timeMax: ${dates.lastFYEnd}

THIS WEEK'S NAMED DAYS:
- Monday    → timeMin: ${dates.mondayStart},    timeMax: ${dates.mondayEnd}
- Tuesday   → timeMin: ${dates.tuesdayStart},   timeMax: ${dates.tuesdayEnd}
- Wednesday → timeMin: ${dates.wednesdayStart}, timeMax: ${dates.wednesdayEnd}
- Thursday  → timeMin: ${dates.thursdayStart},  timeMax: ${dates.thursdayEnd}
- Friday    → timeMin: ${dates.fridayStart},    timeMax: ${dates.fridayEnd}
- Saturday  → timeMin: ${dates.saturdayStart},  timeMax: ${dates.saturdayEnd}
- Sunday    → timeMin: ${dates.sundayStart},    timeMax: ${dates.sundayEnd}

TIME OF DAY — adjust T00:00:00Z on any day's start to the appropriate hour:
- morning   → 06:00–12:00 UTC  (e.g. Thursday morning: timeMin: ${atHour(dates.thursdayStart, 6)}, timeMax: ${atHour(dates.thursdayStart, 12)})
- afternoon → 12:00–17:00 UTC  (e.g. tomorrow afternoon: timeMin: ${atHour(dates.tomorrowStart, 12)}, timeMax: ${atHour(dates.tomorrowStart, 17)})
- evening   → 17:00–22:00 UTC  (e.g. Friday evening: timeMin: ${atHour(dates.fridayStart, 17)}, timeMax: ${atHour(dates.fridayStart, 22)})

DEFAULT RANGE (no time constraint specified):
- If searching for a specific event by name → timeMin: ${dates.ago90}, timeMax: ${dates.future90}  (search wide — event may be in the past or far future)
- General schedule/agenda queries with no keyword → timeMin: ${dates.todayStart}, timeMax: ${dates.future30}

SEARCH QUERY (searchQuery field):
- "meeting with John" → "John"
- "about the Henderson project" → "Henderson"
- "dentist appointment" → "dentist"
- "team standup" → "standup"
- "party time" → "party time"
- "find my gym session" → "gym"
- General schedule with no keyword → "" (empty string)

INTENT — set "intent" field:
- "list"  → show schedule, what do I have, agenda (default)
- "find"  → find a specific event, my next meeting with X
- "check" → am I free, do I have anything, availability check
- "count" → how many meetings, count events

MAX RESULTS:
- list/find → ${CALENDAR_LIMITS.list}
- check     → ${CALENDAR_LIMITS.check}
- count     → ${CALENDAR_LIMITS.count}

CALENDAR ID: always "primary" unless user names a specific calendar.

RESPOND WITH VALID JSON ONLY — no markdown fences, no explanation:
{"timeMin":"...","timeMax":"...","searchQuery":"","maxResults":${CALENDAR_LIMITS.default},"calendarId":"primary","intent":"list"}

EXAMPLES:
Input: What do I have tomorrow?
Output: {"timeMin":"${dates.tomorrowStart}","timeMax":"${dates.tomorrowEnd}","searchQuery":"","maxResults":${CALENDAR_LIMITS.list},"calendarId":"primary","intent":"list"}

Input: Show me my meetings this week
Output: {"timeMin":"${dates.thisWeekStart}","timeMax":"${dates.thisWeekEnd}","searchQuery":"","maxResults":${CALENDAR_LIMITS.list},"calendarId":"primary","intent":"list"}

Input: Find my next meeting with John
Output: {"timeMin":"${dates.todayStart}","timeMax":"${dates.future30}","searchQuery":"John","maxResults":${CALENDAR_LIMITS.find},"calendarId":"primary","intent":"find"}

Input: Am I free on Thursday morning?
Output: {"timeMin":"${atHour(dates.thursdayStart, 6)}","timeMax":"${atHour(dates.thursdayStart, 12)}","searchQuery":"","maxResults":${CALENDAR_LIMITS.check},"calendarId":"primary","intent":"check"}

Input: What meetings do I have about the Henderson project?
Output: {"timeMin":"${dates.todayStart}","timeMax":"${dates.future90}","searchQuery":"Henderson","maxResults":${CALENDAR_LIMITS.list},"calendarId":"primary","intent":"list"}

Input: What's my schedule for next week?
Output: {"timeMin":"${dates.nextWeekStart}","timeMax":"${dates.nextWeekEnd}","searchQuery":"","maxResults":${CALENDAR_LIMITS.list},"calendarId":"primary","intent":"list"}

Input: party time
Output: {"timeMin":"${dates.ago90}","timeMax":"${dates.future90}","searchQuery":"party time","maxResults":${CALENDAR_LIMITS.find},"calendarId":"primary","intent":"find"}

Input: find my dentist appointment
Output: {"timeMin":"${dates.ago90}","timeMax":"${dates.future90}","searchQuery":"dentist","maxResults":${CALENDAR_LIMITS.find},"calendarId":"primary","intent":"find"}`;
}

/**
 * Translate a natural language calendar query into Google Calendar API parameters.
 *
 * @param {string} userMessage  - Natural language query from the user
 * @param {string} [today]      - ISO date YYYY-MM-DD (defaults to current date)
 * @returns {Promise<{ timeMin, timeMax, searchQuery, maxResults, calendarId, intent }>}
 */
async function translateToCalendarQuery(userMessage, today, modelId = 'claude-haiku-4-5-20251001') {
  const todayStr = today || new Date().toISOString().slice(0, 10);
  const dates    = calculateDates(todayStr);

  let raw = '';
  try {
    raw = await callModel(modelId, userMessage, { maxTokens: 200, system: buildSystemPrompt(dates) });
  } catch {
    return { timeMin: dates.todayStart, timeMax: dates.future30, searchQuery: userMessage, maxResults: CALENDAR_LIMITS.default, calendarId: 'primary', intent: 'list' };
  }

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object in response');
    const parsed = JSON.parse(match[0]);
    return {
      timeMin:     String(parsed.timeMin     || dates.todayStart),
      timeMax:     parsed.timeMax ? String(parsed.timeMax) : dates.future30,
      searchQuery: String(parsed.searchQuery || ''),
      maxResults:  typeof parsed.maxResults === 'number' ? Math.min(parsed.maxResults, CALENDAR_LIMITS.count) : CALENDAR_LIMITS.default,
      calendarId:  String(parsed.calendarId  || 'primary'),
      intent:      String(parsed.intent      || 'list'),
    };
  } catch (err) {
    console.warn('[calendarNLP] Parse error:', err.message, '| Raw:', raw.slice(0, 120));
    return { timeMin: dates.todayStart, timeMax: dates.future30, searchQuery: userMessage, maxResults: CALENDAR_LIMITS.default, calendarId: 'primary', intent: 'list' };
  }
}

module.exports = { translateToCalendarQuery, calculateDates, CALENDAR_LIMITS };
