'use strict';

// "Ask the changelog" (admin Changelog page): answer a question from the changelog entries only, citing commit hashes.
//
// Step 1, selectEntries(): pick the entries relevant to the question, without a model. Date words are read in Australia/Brisbane
// (UTC+10, no daylight saving): today, yesterday, this/last week (Monday start), this/last month, since Monday (any weekday), since 10 Nov,
// since 2026-11-10, last/past N days, in November, on 12 Nov. Area names (from the entries), file names ("db.js", "server/routes/x.js")
// and the words "concern", "risk", "untested" narrow the set; the remaining words score the entries. At most MAX_ENTRIES, newest first.
// Step 2, askChangelog(): send those entries to getModelsForUser(userId).standard through callModel (no hardcoded model id), log usage as
// changelog_ask, and keep only the [hash] citations that point at an entry the model was given.
// Injectable (listEntries, getModels, callModel, logUsage, now) so the test needs no database or model. Docs: docs/changelog.md.

const MAX_ENTRIES = 40;
const MAX_QUESTION = 500;
const FEATURE = 'changelog_ask';
const TZ_OFFSET_MS = 10 * 60 * 60 * 1000; // Australia/Brisbane has no daylight saving
const DAY_MS = 24 * 60 * 60 * 1000;

const httpError = (status, message) => Object.assign(new Error(message), { status });

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// ── Brisbane calendar helpers. A "day" is { y, m, d } (m 0-11); its start as an instant is Brisbane midnight. ──
const brisDay = (date) => { const x = new Date(new Date(date).getTime() + TZ_OFFSET_MS); return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), dow: x.getUTCDay() }; };
const dayStart = (y, m, d) => new Date(Date.UTC(y, m, d) - TZ_OFFSET_MS);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (date) => { const b = brisDay(date); return `${b.y}-${pad(b.m + 1)}-${pad(b.d)}`; };

/** Index of a month name or abbreviation ("nov", "November"), else -1. */
const monthIndex = (w) => (w && w.length >= 3 ? MONTHS.indexOf(w.slice(0, 3).toLowerCase()) : -1);

/** "10 nov", "nov 10", "10 november 2026", "2026-11-10" at the start of s → { y, m, d } (year defaults to this year, or last year if that would be in the future). */
function parseDate(s, today) {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(s);
  if (m) return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:\s+(\d{4}))?\b/i.exec(s) || null;
  let day; let mon; let year;
  if (m && monthIndex(m[2]) !== -1) { day = Number(m[1]); mon = monthIndex(m[2]); year = m[3] && Number(m[3]); } else {
    m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i.exec(s);
    if (!m || monthIndex(m[1]) === -1) return null;
    mon = monthIndex(m[1]); day = Number(m[2]); year = m[3] && Number(m[3]);
  }
  if (day < 1 || day > 31) return null;
  if (!year) { year = today.y; if (mon > today.m || (mon === today.m && day > today.d)) year -= 1; }
  return { y: year, m: mon, d: day };
}

/**
 * The date range a question names, in Brisbane time, or null. { from, to, label } where from/to are instants (to exclusive).
 * Only the first date phrase found is used.
 */
function parseDateRange(question, now = new Date()) {
  const q = String(question || '').toLowerCase();
  const t = brisDay(now);
  const today = dayStart(t.y, t.m, t.d);
  const end = new Date(today.getTime() + DAY_MS); // end of today
  const range = (from, to, label) => ({ from, to, label });
  const monday = new Date(today.getTime() - ((t.dow + 6) % 7) * DAY_MS);

  if (/\btoday\b/.test(q)) return range(today, end, 'today');
  if (/\byesterday\b/.test(q)) return range(new Date(today.getTime() - DAY_MS), today, 'yesterday');
  if (/\bthis week\b/.test(q)) return range(monday, end, 'this week');
  if (/\blast week\b/.test(q)) return range(new Date(monday.getTime() - 7 * DAY_MS), monday, 'last week');
  if (/\bthis month\b/.test(q)) return range(dayStart(t.y, t.m, 1), end, 'this month');
  if (/\blast month\b/.test(q)) return range(dayStart(t.y, t.m - 1, 1), dayStart(t.y, t.m, 1), 'last month');
  let m = /\b(?:last|past)\s+(\d{1,3})\s+days?\b/.exec(q);
  if (m) { const n = Math.max(1, Math.min(366, Number(m[1]))); return range(new Date(end.getTime() - n * DAY_MS), end, `the last ${n} days`); }
  m = /\b(?:last|past)\s+(\d{1,2})\s+weeks?\b/.exec(q);
  if (m) { const n = Math.max(1, Math.min(52, Number(m[1]))); return range(new Date(end.getTime() - n * 7 * DAY_MS), end, `the last ${n} weeks`); }
  m = /\bsince\s+(?:last\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(q);
  if (m) {
    const back = (t.dow - WEEKDAYS.indexOf(m[1]) + 7) % 7; // 0 = today
    return range(new Date(today.getTime() - back * DAY_MS), end, `since ${m[1][0].toUpperCase()}${m[1].slice(1)}`);
  }
  m = /\b(since|after|from|on)\s+(.+)$/.exec(q);
  if (m) {
    const d = parseDate(m[2].trim(), t);
    if (d) {
      const start = dayStart(d.y, d.m, d.d);
      if (m[1] === 'on') return range(start, new Date(start.getTime() + DAY_MS), `on ${ymd(start)}`);
      if (m[1] === 'after') return range(new Date(start.getTime() + DAY_MS), end, `after ${ymd(start)}`);
      return range(start, end, `since ${ymd(start)}`);
    }
  }
  m = /\b(?:in|during)\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/.exec(q);
  if (m) {
    const mon = monthIndex(m[1]);
    let y = m[2] ? Number(m[2]) : t.y;
    if (!m[2] && mon > t.m) y -= 1;
    return range(dayStart(y, mon, 1), dayStart(y, mon + 1, 1), `${m[1][0].toUpperCase()}${m[1].slice(1)} ${y}`);
  }
  return null;
}

/** The parts of an entry's area ("Graphics, Video Tools" and "Memory and SERP Tracker" have two). */
const areaParts = (area) => String(area || '').split(/\s*,\s*|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);

const hasConcern = (e) => { const c = String(e?.concerns || '').trim(); return !!c && !/^none noted/i.test(c); };

const STOP = new Set(('a an and any are as at be been by can changed change changes changelog commit commits did do does done entries entry for from get got had has have how i in into is it its last me my of on or our since so that the their them then there these they this those to update updates updated vault was we week were what when where which who why will with work worked you your today yesterday month months day days past about all after before show list tell give find everything anything something touched touch touching happen happened happening made make go went new any').split(' '));

// a keyword stem that also matches other wordings of the same idea
const SYNONYMS = {
  untest: ['untested', 'not tested', 'not been tested', 'not yet tested', 'not run', 'never run', 'unverified', 'not verified', 'nobody has run', 'not checked'],
  unverifi: ['unverified', 'not verified', 'untested', 'not tested'],
  pric: ['pric', 'cost table', 'per million'],
};

/** Lower-case word stems from the question for scoring (stop words, date words and short words left out). */
function keywords(question) {
  const words = String(question || '').toLowerCase().replace(/[^a-z0-9._/-]+/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (const w0 of words) {
    const w = w0.replace(/^[._/-]+|[._/-]+$/g, '');
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w) || isMonthWord(w) || WEEKDAYS.includes(w) || /[./]/.test(w)) continue; // paths are fileTerms
    const stem = w.replace(/(ing|ed|es|s)$/, '').replace(/e$/, '');
    const k = stem.length >= 3 ? stem : w;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}
const FULL_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function isMonthWord(w) { return FULL_MONTHS.includes(w) || MONTHS.includes(w); }

/** File names or paths in the question: words with a dot extension or a slash ("db.js", "server/routes/notes.js", "codeMap/"). */
function fileTerms(question) {
  const out = [];
  for (const m of String(question || '').matchAll(/[\w./-]*[\w-]+(?:\.(?:js|mjs|cjs|jsx|ts|tsx|json|md|css|html|sql|py|toml|yml|yaml|txt)\b|\/[\w./-]*)/gi)) {
    const f = m[0].toLowerCase().replace(/^\.\//, '');
    if (f.length >= 3 && !out.includes(f)) out.push(f);
  }
  return out;
}

/** Area names from the entries that the question mentions (whole words, case-insensitive). */
function areaTerms(question, entries) {
  const q = ` ${String(question || '').toLowerCase().replace(/[^a-z0-9&]+/g, ' ')} `;
  const all = new Set();
  for (const e of entries) for (const p of areaParts(e.area)) all.add(p);
  const hits = [];
  for (const a of all) {
    const norm = a.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim();
    if (norm && q.includes(` ${norm} `)) hits.push(a);
  }
  // a longer area that contains a shorter one ("Usage & Cost" vs "Usage") wins
  return hits.filter((a) => !hits.some((b) => b !== a && b.toLowerCase().includes(a.toLowerCase()) && b.length > a.length));
}

const CONCERN_RE = /\bconcern|\brisk|\buntested|\bunverified|\bnot (?:yet )?(?:tested|verified|run)\b|\bworr/i;

const entryText = (e) => [e.subject, e.area, e.goal, e.whatChanged, e.benefit, e.concerns, ...(Array.isArray(e.filesImpacted) ? e.filesImpacted : [])].join(' \n ').toLowerCase();

/**
 * The entries relevant to a question, newest first, at most `limit`.
 * Returns { entries, range, areas, files, concernsOnly, keywords, matched } (matched = how many passed the filters before the cap).
 */
function selectEntries(allEntries, question, { now = new Date(), limit = MAX_ENTRIES } = {}) {
  const entries = (Array.isArray(allEntries) ? allEntries : []).filter((e) => e && e.commit);
  const range = parseDateRange(question, now);
  const files = fileTerms(question);
  const areas = areaTerms(question, entries);
  const concernsOnly = CONCERN_RE.test(String(question || ''));
  const areaWords = new Set(areas.flatMap((a) => a.toLowerCase().split(/[^a-z0-9]+/)));
  const kws = keywords(question).filter((k) => !areaWords.has(k) && ![...areaWords].some((w) => w.startsWith(k)) && !/^concern/.test(k)); // every picked entry has a concern when asked about them, so the word ranks nothing

  let pool = entries;
  if (range) pool = pool.filter((e) => { const t = new Date(e.committedAt).getTime(); return t >= range.from.getTime() && t < range.to.getTime(); });
  if (areas.length) {
    const want = new Set(areas.map((a) => a.toLowerCase()));
    pool = pool.filter((e) => areaParts(e.area).some((p) => want.has(p.toLowerCase())));
  }
  if (files.length) {
    pool = pool.filter((e) => (e.filesImpacted || []).some((f) => files.some((t) => String(f).toLowerCase().includes(t))));
  }
  if (concernsOnly) pool = pool.filter(hasConcern);

  const newest = (a, b) => new Date(b.committedAt) - new Date(a.committedAt);
  let picked = [...pool].sort(newest);
  if (kws.length) {
    const scored = pool.map((e) => {
      const text = entryText(e);
      const subject = String(e.subject || '').toLowerCase();
      let score = 0;
      for (const k of kws) {
        const forms = SYNONYMS[k] || [k];
        if (forms.some((f) => text.includes(f))) score += forms.some((f) => subject.includes(f)) ? 3 : 1;
      }
      return { e, score };
    });
    // keywords only rank when no hard filter applied, or when the filtered set is still too big
    if (scored.some((s) => s.score > 0) && (!range && !areas.length && !files.length || pool.length > limit)) {
      picked = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || newest(a.e, b.e)).map((s) => s.e); // best first
    }
  }
  const out = picked.slice(0, limit).sort(newest);
  return {
    entries: out,
    matched: picked.length,
    range: range ? { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label } : null,
    areas, files, concernsOnly, keywords: kws,
  };
}

const SYSTEM = `You answer questions about Vault's admin changelog: one entry per code commit, saying what changed, the files it touched, the goal, the benefit and any concerns. The entries were written from each commit's message, so they say what a commit claims to have done, not proof that it works.

Rules:
- Answer ONLY from the entries given below. Do not use outside knowledge about Vault, the code or anything else.
- Cite every claim with the commit hash of the entry it comes from, in square brackets exactly as given, for example [abc1234]. Several sources: [abc1234] [def5678]. Never cite a hash that is not in the entries.
- If the entries do not answer the question, or only partly, say so plainly ("The entries given do not say ..."). Never guess.
- Never describe a concern as resolved, fixed or verified unless a later entry (by date) says so; then cite that later entry.
- Dates are in Australia/Brisbane time. Mention dates when they help.
- Plain words, short. Short paragraphs or a short bullet list. No headings. No preamble.`;

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function buildPrompt(question, selection, now) {
  const lines = [
    `Today in Brisbane: ${ymd(now)}.`,
    selection.range ? `The question was read as covering ${selection.range.label} (${ymd(selection.range.from)} to ${ymd(new Date(new Date(selection.range.to).getTime() - 1))}).` : '',
    selection.areas.length ? `Areas named: ${selection.areas.join(', ')}.` : '',
    selection.files.length ? `Files named: ${selection.files.join(', ')}.` : '',
    selection.concernsOnly ? 'Only entries with a concern were picked.' : '',
    selection.matched > selection.entries.length ? `${selection.matched} entries matched; only the ${selection.entries.length} given below were sent, so say the answer may be incomplete.` : '',
    '',
    `ENTRIES (${selection.entries.length}, newest first)`,
  ].filter((l, i) => l || i === 6);
  if (!selection.entries.length) lines.push('(none matched the question)');
  for (const e of selection.entries) {
    lines.push(
      '',
      `[${e.commit}] ${ymd(e.committedAt)} · ${e.area || 'no area'} · ${clip(e.subject, 200)}`,
      `What changed: ${clip(e.whatChanged, 1200)}`,
      `Goal: ${clip(e.goal, 400)}`,
      `Benefit: ${clip(e.benefit, 400)}`,
      `Concerns: ${clip(e.concerns, 800) || 'None noted.'}`,
      `Files: ${(e.filesImpacted || []).slice(0, 15).join(', ')}${(e.filesImpacted || []).length > 15 ? ` (+${e.filesImpacted.length - 15} more)` : ''}`,
    );
  }
  lines.push('', 'QUESTION', clip(question, MAX_QUESTION));
  return lines.join('\n');
}

/** Citations in the answer: those pointing at a sent entry, and any others (which the client shows as plain text). */
function checkCitations(text, sent) {
  const known = new Set(sent);
  const cited = [];
  const unknown = [];
  for (const m of String(text || '').matchAll(/\[([0-9a-f]{7,40})\]/gi)) {
    const h = m[1].toLowerCase();
    const hit = sent.find((s) => h.startsWith(s) || s.startsWith(h));
    if (hit && known.has(hit)) { if (!cited.includes(hit)) cited.push(hit); } else if (!unknown.includes(h)) unknown.push(h);
  }
  return { cited, unknown };
}

/**
 * Answer one question from the changelog.
 * @returns {{ answer, cited, unknownCitations, basedOn, matched, range, areas, files, concernsOnly, model }}
 */
async function askChangelog(userId, question, deps = {}) {
  const q = typeof question === 'string' ? question.trim() : '';
  if (q.length < 3) throw httpError(400, 'Type a question first.');
  if (q.length > MAX_QUESTION) throw httpError(400, `Keep the question under ${MAX_QUESTION} characters.`);
  const now = deps.now ? deps.now() : new Date();
  const list = deps.listEntries || require('./changelog').listChangelog;
  const selection = selectEntries(await list(), q, { now });
  const basedOn = selection.entries.map((e) => e.commit);
  const meta = { basedOn, matched: selection.matched, range: selection.range, areas: selection.areas, files: selection.files, concernsOnly: selection.concernsOnly };
  if (!selection.entries.length) {
    return { answer: 'No changelog entries match that question, so there is nothing to answer from. Try a wider date range or fewer filters.', cited: [], unknownCitations: [], model: null, ...meta };
  }
  const resolve = deps.getModels || require('./modelResolver').getModelsForUser;
  const call = deps.callModel || require('./callModel').callModel;
  const tiers = await resolve(userId);
  const modelId = tiers && tiers.standard;
  if (!modelId) throw httpError(503, 'No AI model is set up for this workspace yet.');
  const result = await call(modelId, buildPrompt(q, selection, now), { system: SYSTEM, maxTokens: 1200, returnUsage: true, timeoutMs: 60000 });
  (deps.logUsage || require('../utils/logUsage').logUsage)({ userId, model: result.model || modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: FEATURE });
  const answer = String(result.text || '').trim().slice(0, 8000) || 'The model gave no answer. Try again.';
  const { cited, unknown } = checkCitations(answer, basedOn);
  return { answer, cited, unknownCitations: unknown, model: result.model || modelId, ...meta };
}

module.exports = { askChangelog, selectEntries, parseDateRange, keywords, fileTerms, areaTerms, buildPrompt, checkCitations, SYSTEM, FEATURE, MAX_ENTRIES, MAX_QUESTION };
