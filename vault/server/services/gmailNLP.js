'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const GMAIL_LIMITS = {
  count:   500,
  extract: 200,
  list:    50,
  prose:   50,
  default: 20,
};

/**
 * Calculate all relevant date ranges from a given ISO date string.
 * All output dates are formatted as YYYY/MM/DD for Gmail query syntax.
 */
function calculateDates(todayStr) {
  // Use noon UTC to avoid DST / timezone edge cases
  const d = new Date(todayStr + 'T12:00:00Z');

  const fmt = (dt) => {
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
  };

  const addDays = (dt, n) => {
    const x = new Date(dt);
    x.setUTCDate(x.getUTCDate() + n);
    return x;
  };

  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-indexed

  // This week's Monday (Sunday treated as day 7, i.e. last day of week)
  const dayOfWeek = d.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisWeekMonday = addDays(d, -daysFromMonday);
  const lastWeekMonday = addDays(thisWeekMonday, -7);

  // Month boundaries
  const thisMonthStart = new Date(Date.UTC(year, month, 1));
  const lastMonthStart = new Date(Date.UTC(year, month - 1, 1));

  // Year boundaries
  const thisYearStart = new Date(Date.UTC(year, 0, 1));
  const lastYearStart = new Date(Date.UTC(year - 1, 0, 1));
  const lastYearEnd   = new Date(Date.UTC(year, 0, 1));

  // Calendar quarters
  const quarterMonth = Math.floor(month / 3) * 3;
  const thisQStart   = new Date(Date.UTC(year, quarterMonth, 1));
  const lastQStart   = quarterMonth === 0
    ? new Date(Date.UTC(year - 1, 9,  1))
    : new Date(Date.UTC(year, quarterMonth - 3, 1));
  const lastQEnd     = quarterMonth === 0
    ? new Date(Date.UTC(year, 0, 1))
    : new Date(Date.UTC(year, quarterMonth, 1));

  // Australian FY: 1 July – 30 June
  // If we're in Jan–Jun, current FY started last year.
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

  // Most-recent January (could be this year or last year if we haven't reached it)
  const recentJanStart = month >= 1
    ? new Date(Date.UTC(year, 0, 1))
    : new Date(Date.UTC(year - 1, 0, 1));
  const recentJanEnd   = month >= 1
    ? new Date(Date.UTC(year, 1, 1))
    : new Date(Date.UTC(year - 1, 1, 1));

  return {
    today:          fmt(d),
    yesterday:      fmt(addDays(d, -1)),
    thisWeekMonday: fmt(thisWeekMonday),
    lastWeekMonday: fmt(lastWeekMonday),
    lastWeekSunday: fmt(addDays(thisWeekMonday, -1)),
    thisMonthStart: fmt(thisMonthStart),
    lastMonthStart: fmt(lastMonthStart),
    thisYearStart:  fmt(thisYearStart),
    lastYearStart:  fmt(lastYearStart),
    lastYearEnd:    fmt(lastYearEnd),
    ago7:           fmt(addDays(d, -7)),
    ago14:          fmt(addDays(d, -14)),
    ago30:          fmt(addDays(d, -30)),
    ago90:          fmt(addDays(d, -90)),
    thisQStart:     fmt(thisQStart),
    lastQStart:     fmt(lastQStart),
    lastQEnd:       fmt(lastQEnd),
    currentFYStart: fmt(currentFYStart),
    currentFYEnd:   fmt(currentFYEnd),
    lastFYStart:    fmt(lastFYStart),
    lastFYEnd:      fmt(lastFYEnd),
    recentJanStart: fmt(recentJanStart),
    recentJanEnd:   fmt(recentJanEnd),
  };
}

function buildSystemPrompt(dates) {
  return `You are a Gmail search query translator for an Australian professional services firm.

TODAY IS ${dates.today}. Use ONLY the pre-computed date ranges below — never invent your own dates.

PRE-COMPUTED DATE RANGES:
- today              → after:${dates.today}
- yesterday          → after:${dates.yesterday} before:${dates.today}
- this week          → after:${dates.thisWeekMonday}
- last week          → after:${dates.lastWeekMonday} before:${dates.thisWeekMonday}
- this month         → after:${dates.thisMonthStart}
- last month         → after:${dates.lastMonthStart} before:${dates.thisMonthStart}
- this year          → after:${dates.thisYearStart}
- last year          → after:${dates.lastYearStart} before:${dates.lastYearEnd}
- last 7 days        → after:${dates.ago7}
- last 14 days       → after:${dates.ago14}
- recently / lately  → after:${dates.ago14}
- last 30 days       → after:${dates.ago30}
- last 90 days       → after:${dates.ago90}
- this quarter       → after:${dates.thisQStart}
- last quarter       → after:${dates.lastQStart} before:${dates.lastQEnd}
- current Australian financial year → after:${dates.currentFYStart} before:${dates.currentFYEnd}
- last financial year / last FY     → after:${dates.lastFYStart} before:${dates.lastFYEnd}
- in January (most recent)          → after:${dates.recentJanStart} before:${dates.recentJanEnd}

DIRECTION RULES:
- "from X" / "X emailed me" / "X contacted me" / "X sent me"  → from:X
- "to X" / "I emailed X" / "I sent to X" / "I wrote to X"      → to:X
- "did I reply to X"                                            → to:X
- "correspondence with X" / "between me and X" / "back and forth with X" → from:X OR to:X
- No direction stated → from:X (assume received)

NAME RESOLUTION:
- Full name "First Last"  → from:"First Last"
- First name only         → from:First
- Company name            → from:company  (e.g. from:westpac, from:acme)
- Domain / email address  → from:@domain.com  or  from:email@domain.com
- "my accountant / lawyer / client / boss" → keyword search using the role word, do NOT hallucinate addresses
- Correct obvious misspellings (e.g. "Maddocks" → "Maddock", "Westpak" → "Westpac", "google" → "Google")

CONTENT KEYWORDS — always use subject: operator:
- invoices / tax invoices               → subject:invoice
- quotes / quotations                   → subject:quote OR subject:quotation
- contracts / agreements                → subject:contract OR subject:agreement
- purchase orders / POs                 → subject:"purchase order" OR subject:PO
- meetings / appointments               → subject:meeting OR subject:appointment
- follow-up / follow up                 → subject:"follow up"
- urgent / ASAP                         → subject:urgent
- complaints                            → subject:complaint
- specific project / topic names        → use as bare keyword (e.g. westgate)

ATTACHMENTS:
- has attachments    → has:attachment
- PDFs               → has:attachment filename:pdf
- spreadsheets/Excel → has:attachment filename:xlsx OR filename:csv
- images / photos    → has:attachment filename:jpg OR filename:png
- newsletters        → unsubscribe in:anywhere

STATUS:
- unread    → is:unread
- starred   → is:starred
- important → is:important

INTENT — set "intent" field:
- "count"   → how many, count, number of, how often, frequency, times, how much
- "list"    → default browsing / viewing (default)
- "read"    → want to read one specific email
- "extract" → extract, pull out, get all, all the amounts/dates/values
- "summary" → catch me up, overview, summary, what has X been saying, recent activity
- "thread"  → conversation, thread, back and forth, exchange

RESPONSE MODE — set "responseMode" field:
- "count" → count intent
- "table" → extract intent, or: table, spreadsheet, list all X, all the amounts, all the dates
- "prose" → summary intent, or: catch me up, overview, what has X been, summarise
- "list"  → default

MAX RESULTS:
- count intent   → ${GMAIL_LIMITS.count}
- extract/table  → ${GMAIL_LIMITS.extract}
- summary/prose  → ${GMAIL_LIMITS.prose}
- list/read      → ${GMAIL_LIMITS.list}

RESPOND WITH VALID JSON ONLY — no markdown fences, no explanation:
{"gmailQuery":"...","intent":"...","maxResults":${GMAIL_LIMITS.default},"responseMode":"..."}

EXAMPLES:
Input: how many times has Libby Barrett emailed me this month
Output: {"gmailQuery":"from:\\"Libby Barrett\\" after:${dates.thisMonthStart}","intent":"count","maxResults":${GMAIL_LIMITS.count},"responseMode":"count"}

Input: unread invoices from last week
Output: {"gmailQuery":"is:unread subject:invoice after:${dates.lastWeekMonday} before:${dates.thisWeekMonday}","intent":"list","maxResults":${GMAIL_LIMITS.list},"responseMode":"list"}

Input: catch me up on emails from the ATO
Output: {"gmailQuery":"from:ato.gov.au","intent":"summary","maxResults":${GMAIL_LIMITS.prose},"responseMode":"prose"}

Input: extract all invoice amounts from Acme Corp this month
Output: {"gmailQuery":"from:acme subject:invoice after:${dates.thisMonthStart}","intent":"extract","maxResults":${GMAIL_LIMITS.extract},"responseMode":"table"}

Input: conversation with Sarah about the contract
Output: {"gmailQuery":"from:Sarah OR to:Sarah subject:contract","intent":"thread","maxResults":${GMAIL_LIMITS.list},"responseMode":"list"}`;
}

/**
 * Translate a natural language email query into a Gmail search query + metadata.
 *
 * @param {string} userMessage  - Natural language query from the user
 * @param {string} [today]      - ISO date YYYY-MM-DD (defaults to current date)
 * @returns {Promise<{ gmailQuery: string, intent: string, maxResults: number, responseMode: string }>}
 */
async function translateToGmailQuery(userMessage, today) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { gmailQuery: userMessage, intent: 'list', maxResults: GMAIL_LIMITS.list, responseMode: 'list' };
  }

  const todayStr = today || new Date().toISOString().slice(0, 10);
  const dates = calculateDates(todayStr);
  const systemPrompt = buildSystemPrompt(dates);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = response.content[0]?.text?.trim() || '';

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object in response');
    const parsed = JSON.parse(match[0]);
    return {
      gmailQuery:   String(parsed.gmailQuery   || userMessage),
      intent:       String(parsed.intent       || 'list'),
      maxResults:   typeof parsed.maxResults === 'number' ? parsed.maxResults : GMAIL_LIMITS.default,
      responseMode: String(parsed.responseMode || 'list'),
    };
  } catch (err) {
    console.warn('[gmailNLP] Parse error:', err.message, '| Raw:', raw.slice(0, 120));
    return { gmailQuery: userMessage, intent: 'list', maxResults: GMAIL_LIMITS.default, responseMode: 'list' };
  }
}

module.exports = { translateToGmailQuery, calculateDates, GMAIL_LIMITS };
