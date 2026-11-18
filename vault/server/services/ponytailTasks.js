'use strict';

// Ponytail report: checking what the Ponytail plugin sends (docs/ponytail-report.md). Pure functions, no database.
//   cleanSnapshot(body)  one webhook body (the plugin's `Snapshot`, hooks/band/metrics.ts) -> { task } or { error }
//   parseCsv(text)       one ledger file (~/.config/ponytail/band/<project>.csv) -> { tasks, problems }
// Unknown fields are ignored, so a newer plugin that adds a field still gets in.
// Test: node server/services/ponytailTasks.test.js

const STARTED_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;
const LIMITS = { name: 300, project: 200, model: 100, tests: 50, session: 100, level: 20 };

const CSV_HEADER = 'key,started,project,name,cost_usd,turns,agent_minutes,tokens_total,tokens_output,reuse_pct,reused,new,callers_open,tests,level,model';
const MAX_CSV_ROWS = 20000;

/** A non-negative finite number (integer when asked), else undefined. */
function num(v, { int = false } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined;
  if (int && !Number.isInteger(v)) return undefined;
  return v;
}

/** A started stamp that is a real date and time ("2026-02-30 25:00" is refused). */
function validStarted(s) {
  if (typeof s !== 'string' || !STARTED_RE.test(s)) return false;
  const [d, t] = s.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, day, h, min));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === day && h < 24 && min < 60;
}

/**
 * One webhook body -> { task } (column names as stored) or { error: 'short reason' }.
 * `started` stays the plugin's local-time text; the database reads it as Australia/Brisbane.
 */
function cleanSnapshot(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body must be a JSON object.' };
  const b = body;
  if (typeof b.key !== 'string' || !KEY_RE.test(b.key)) return { error: 'key is required (letters, numbers, - or _, up to 80).' };
  if (!validStarted(b.started)) return { error: 'started must be "YYYY-MM-DD HH:MM".' };

  const task = { key: b.key, started: b.started, source: 'webhook' };
  for (const [field, max] of Object.entries(LIMITS)) {
    const v = b[field];
    if (v === undefined || v === null) { task[field] = field === 'session' ? null : ''; continue; }
    if (typeof v !== 'string') return { error: `${field} must be text.` };
    if (v.length > max) return { error: `${field} is longer than ${max} characters.` };
    task[field] = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  }

  const numbers = [
    ['cost', 'cost', false], ['turns', 'turns', true], ['agentMs', 'agentMs', true],
    ['reused', 'reused', true], ['created', 'created', true], ['callersOpen', 'callersOpen', true],
  ];
  for (const [field, col, int] of numbers) {
    const v = b[field] === undefined ? 0 : num(b[field], { int });
    if (v === undefined) return { error: `${field} must be a number of 0 or more${int ? ' (whole)' : ''}.` };
    task[col] = v;
  }
  if (b.lastTurn === undefined || b.lastTurn === null) task.lastTurn = null;
  else if ((task.lastTurn = num(b.lastTurn)) === undefined) return { error: 'lastTurn must be a number of 0 or more, or null.' };
  if (b.reuse === undefined || b.reuse === null) task.reuse = null;
  else if ((task.reuse = num(b.reuse, { int: true })) === undefined || task.reuse > 100) return { error: 'reuse must be a whole number from 0 to 100, or null.' };

  const t = b.tokens === undefined ? {} : b.tokens;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return { error: 'tokens must be an object.' };
  for (const [field, col] of [['input', 'tokensInput'], ['output', 'tokensOutput'], ['cacheRead', 'tokensCacheRead'], ['cacheWrite', 'tokensCacheWrite']]) {
    const v = t[field] === undefined ? 0 : num(t[field], { int: true });
    if (v === undefined) return { error: `tokens.${field} must be a whole number of 0 or more.` };
    task[col] = v;
  }
  return { task };
}

/** CSV text -> rows of fields (quotes, doubled quotes, commas and newlines inside quotes). */
function splitCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** A CSV number cell: empty -> fallback, else a non-negative number or undefined. */
function cell(v, { int = false, empty = 0 } = {}) {
  if (v === '' || v === undefined) return empty;
  const n = Number(v);
  return num(int ? Math.round(n) : n, { int });
}

/** One CSV row (an object by header name) -> { task } or { error }. Shares cleanSnapshot's checks. */
function csvRowToTask(r) {
  const total = cell(r.tokens_total, { int: true });
  const output = cell(r.tokens_output, { int: true });
  const minutes = cell(r.agent_minutes);
  const cost = cell(r.cost_usd);
  const numbers = { cost, turns: cell(r.turns, { int: true }), reused: cell(r.reused, { int: true }), created: cell(r.new, { int: true }), callersOpen: cell(r.callers_open, { int: true }) };
  for (const [k, v] of Object.entries({ ...numbers, tokens_total: total, tokens_output: output, agent_minutes: minutes })) {
    if (v === undefined) return { error: `${k} is not a number of 0 or more.` };
  }
  const reuse = cell(r.reuse_pct, { int: true, empty: null });
  if (reuse === undefined) return { error: 'reuse_pct is not a number from 0 to 100.' };
  const out = cleanSnapshot({
    key: r.key, started: r.started, project: r.project, name: r.name, level: r.level, model: r.model, tests: r.tests,
    ...numbers, agentMs: Math.round(minutes * 60000), reuse, lastTurn: null,
    // The ledger keeps only the total and the output: the rest is booked as input (the plugin's own resume() does the same).
    tokens: { input: Math.max(0, total - output), output, cacheRead: 0, cacheWrite: 0 },
  });
  if (out.task) { out.task.source = 'csv'; out.task.session = null; }
  return out;
}

/** A ledger file -> { tasks, problems: [{ line, reason }] }. A wrong header is one problem and no tasks. */
function parseCsv(text) {
  const rows = splitCsv(text);
  if (!rows.length) return { tasks: [], problems: [{ line: 1, reason: 'The file is empty.' }] };
  const header = rows[0].map((h) => h.trim());
  if (header.join(',') !== CSV_HEADER) return { tasks: [], problems: [{ line: 1, reason: 'This is not a Ponytail ledger file (the first line does not match).' }] };
  const tasks = [];
  const problems = [];
  rows.slice(1, MAX_CSV_ROWS + 1).forEach((fields, i) => {
    const line = i + 2;
    if (fields.length !== header.length) { problems.push({ line, reason: `Expected ${header.length} fields, found ${fields.length}.` }); return; }
    const r = Object.fromEntries(header.map((h, j) => [h, fields[j]]));
    const out = csvRowToTask(r);
    if (out.error) problems.push({ line, reason: out.error }); else tasks.push(out.task);
  });
  if (rows.length - 1 > MAX_CSV_ROWS) problems.push({ line: MAX_CSV_ROWS + 2, reason: `Only the first ${MAX_CSV_ROWS} rows are read.` });
  return { tasks, problems };
}

/** 'pass' | 'fail' | 'none' from the plugin's tests label ("12 passed", "1 failed", "stale", "not run"). */
function testsState(label) {
  const s = String(label || '');
  if (/passed$/.test(s)) return 'pass';
  if (/failed$/.test(s)) return 'fail';
  return 'none';
}

module.exports = { CSV_HEADER, LIMITS, cleanSnapshot, parseCsv, splitCsv, csvRowToTask, testsState, validStarted };
