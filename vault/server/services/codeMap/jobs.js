'use strict';

// Code Map runs as a background job, like server/services/pdfToHtmlJobs.js: POST starts it and answers at once with an id, the page polls
// GET /api/code-map/runs/:id, and the result is stored as JSONB in code_map_runs.
//
//   one run at a time across the workspace (checked here, and by a partial unique index in server/db.js for two clicks at once)
//   the analysis runs in a worker thread (worker.js) so requests are not held up; the current stage is kept in memory, not in the table
//   after a run succeeds: keep the last 30 runs (older ones are deleted outright: they are analysis output, not user content, so no recycle bin)
//   then raise each HIGH finding in the suggestions inbox, once per rule and tool (fingerprint codeMap:<ruleId>:<toolId>), so a finding
//   already in the inbox is refreshed, not raised again
//   a restart marks a queued or running run as failed (server/db.js)
//
// Runs are workspace-wide (Vault's own code), so rows are not filtered by "userId"; the routes are admin-only. "userId" records who ran it.
// Injectable (pool, analyze, capture, makeFingerprint) so tests need no database, worker or inbox.

const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const KEEP_RUNS = 30;
const EVIDENCE_IN_INBOX = 6;
const STAGE_LABELS = {
  queued: 'Waiting to start',
  files: 'Reading the source files',
  imports: 'Following the imports',
  tools: 'Finding the tools',
  mounts: 'Reading the API mounts',
  ownership: 'Working out which tool owns what',
  rules: 'Running the checks',
  security: 'Running the security checks',
  structure: 'Looking at the structure',
  findings: 'Ranking the findings',
  saving: 'Saving the results',
};
const STAGE_ORDER = Object.keys(STAGE_LABELS);
// inbox titles for the structural findings (rule findings use the rule's label); fixed words, because the inbox keeps the first title
const STRUCTURE_LABELS = {
  cronRequiresRoute: 'A cron job requires a route file',
  crossToolCycle: 'Import cycle across tools',
  housekeeping: 'Leftover backups and possibly unused files',
};

const parse = (v, fallback) => { if (v == null) return fallback; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return fallback; } };

/** The tile numbers kept beside each run, so the run list needs no full result. */
function summarize(result) {
  const s = result.summary || {};
  const tools = result.tools || [];
  const sev = { high: 0, medium: 0, low: 0 };
  for (const f of result.findings || []) if (f.sev in sev) sev[f.sev]++;
  return {
    tools: s.tools, files: s.files, tests: s.tests, mounts: s.mounts, cycles: s.cycles,
    lines: (s.locServer || 0) + (s.locClient || 0), locServer: s.locServer, locClient: s.locClient, locTests: s.locTests,
    gaps: s.gaps, findings: (result.findings || []).length, findingsBySeverity: sev,
    avgScore: tools.length ? Math.round(tools.reduce((n, t) => n + (t.score || 0), 0) / tools.length) : null,
  };
}

/** One inbox item per high finding per tool it names ("all" when it names none). */
function inboxItems(result, runId) {
  const label = Object.fromEntries((result.tools || []).map((t) => [t.id, t.label]));
  const ruleLabel = Object.fromEntries((result.rules || []).map((r) => [r.id, r.label]));
  const items = [];
  for (const f of result.findings || []) {
    const targets = f.tools && f.tools.length ? f.tools : ['all'];
    for (const toolId of targets) {
      const note = (f.toolNotes || []).find((n) => n.tool === toolId)?.note;
      const ev = (f.evidence || []).filter((e) => !e.tool || e.tool === toolId).slice(0, EVIDENCE_IN_INBOX);
      const what = ruleLabel[f.ruleId] || STRUCTURE_LABELS[f.ruleId] || f.title;
      items.push({
        high: f.sev === 'high',
        ruleId: f.ruleId,
        toolId,
        title: `Code Map: ${what}${toolId === 'all' ? '' : ` (${label[toolId] || toolId})`}`,
        body: [
          note || f.title,
          `${f.why || ''} ${f.fix || ''}`.trim(),
          ev.length ? `Evidence:\n${ev.map((e) => `- ${e.file}${e.line ? `:${e.line}` : ''}${e.text ? `  ${e.text}` : ''}`).join('\n')}` : '',
        ].filter(Boolean).join('\n\n'),
        context: `Code Map run #${runId}. Open Code Map (admin) for the full evidence.`,
      });
    }
  }
  // Security tab (security.js): a high-severity check that fails, once per check (secret values are already hidden in its items)
  for (const c of (result.security && result.security.checks) || []) {
    if (c.status !== 'fail') continue;
    const ev = (c.items || []).slice(0, EVIDENCE_IN_INBOX);
    items.push({
      high: c.severity === 'high',
      ruleId: `security:${c.id}`,
      toolId: 'all',
      title: `Code Map security: ${c.label}`,
      body: [c.note, `${c.why} ${c.fix}`, ev.length ? `Evidence:\n${ev.map((e) => `- ${e.file}${e.line ? `:${e.line}` : ''}  ${e.text}`).join('\n')}` : ''].filter(Boolean).join('\n\n'),
      context: `Code Map run #${runId}. Open Code Map → Security for the full list.`,
    });
  }
  return items;
}

function createJobs(deps = {}) {
  const d = {
    pool: deps.pool || (() => require('../../db').pool),
    analyze: deps.analyze || ((opts) => require('./worker').runInWorker(opts)),
    captureIf: deps.captureIf || ((cond, p) => require('../SuggestionService').captureIf(cond, p)),
    makeFingerprint: deps.makeFingerprint || ((s, k) => require('../SuggestionService').makeFingerprint(s, k)),
    log: deps.log || (() => require('../../middleware/requestContext').getLogger()),
    now: deps.now || (() => Date.now()),
    root: deps.root || ROOT,
    env: deps.env || process.env,
  };
  const db = () => (typeof d.pool === 'function' ? d.pool() : d.pool);
  const q = (sql, params) => db().query(sql, params);
  const log = () => (typeof d.log === 'function' && d.log.length === 0 ? d.log() : d.log);

  const active = new Map(); // run id -> { stage }
  const running = new Map(); // run id -> promise that settles when the run ends (tests wait on it)

  const busy = (runningId) => Object.assign(new Error('A Code Map analysis is already running. Wait for it to finish.'), { status: 409, runningId: runningId || null });

  /** Start a run for this admin. Returns the run id; the analysis carries on in the background. */
  async function start(userId) {
    if (active.size) throw busy([...active.keys()][0]);
    const { rows: open } = await q(`SELECT id FROM code_map_runs WHERE status IN ('queued', 'running') ORDER BY id DESC LIMIT 1`);
    if (open[0]) throw busy(open[0].id);
    let id;
    try {
      const { rows } = await q(`INSERT INTO code_map_runs ("userId", status, "commitHint") VALUES ($1, 'queued', $2) RETURNING id`,
        [userId, d.env.RAILWAY_GIT_COMMIT_SHA || null]);
      id = rows[0].id;
    } catch (err) {
      if (err.code === '23505') throw busy(); // the one-active-run index: another click got there first
      throw err;
    }
    active.set(id, { stage: 'queued' });
    const p = new Promise((r) => setImmediate(r))
      .then(() => run(id, userId))
      .catch((err) => log().error({ err, runId: id }, '[codeMap] run crashed'))
      .finally(() => { active.delete(id); running.delete(id); });
    running.set(id, p);
    return id;
  }

  async function run(id, userId) {
    const t0 = d.now();
    await q(`UPDATE code_map_runs SET status = 'running' WHERE id = $1`, [id]);
    let result;
    try {
      result = await d.analyze({ root: d.root, onStage: (stage) => { const a = active.get(id); if (a) a.stage = stage; } });
      const a = active.get(id);
      if (a) a.stage = 'saving';
      await q(`UPDATE code_map_runs SET status = 'done', summary = $2, result = $3, "durationMs" = $4, error = NULL, "finishedAt" = NOW() WHERE id = $1`,
        [id, JSON.stringify(summarize(result)), JSON.stringify(result), Math.round(d.now() - t0)]);
    } catch (err) {
      log().error({ err, runId: id }, '[codeMap] analysis failed');
      await q(`UPDATE code_map_runs SET status = 'failed', error = $2, "durationMs" = $3, "finishedAt" = NOW() WHERE id = $1`,
        [id, String((err && err.message) || 'The analysis failed.').slice(0, 1000), Math.round(d.now() - t0)]);
      return;
    }
    // the run is saved; neither of these may turn it into a failure
    try {
      await q(`DELETE FROM code_map_runs WHERE status NOT IN ('queued', 'running') AND id NOT IN (
                 SELECT id FROM code_map_runs ORDER BY "createdAt" DESC, id DESC LIMIT $1)`, [KEEP_RUNS]);
    } catch (err) {
      log().error({ err }, '[codeMap] trimming old runs failed');
    }
    try {
      for (const it of inboxItems(result, id)) {
        await d.captureIf(it.high, {
          userId, source: 'codeMap', category: 'alert',
          fingerprint: d.makeFingerprint('codeMap', `${it.ruleId}:${it.toolId}`),
          title: it.title, body: it.body, context: it.context,
        });
      }
    } catch (err) {
      log().error({ err }, '[codeMap] raising findings in the inbox failed');
    }
  }

  const withStage = (r) => {
    if (!r) return r;
    const a = active.get(r.id);
    const stage = a ? a.stage : (r.status === 'queued' || r.status === 'running' ? 'queued' : null);
    return {
      ...r,
      summary: parse(r.summary, null),
      ...(r.result !== undefined ? { result: parse(r.result, null) } : {}),
      stage,
      stageLabel: stage ? STAGE_LABELS[stage] || stage : null,
      stageStep: stage ? Math.max(0, STAGE_ORDER.indexOf(stage)) : null,
      stageCount: STAGE_ORDER.length - 1,
    };
  };

  /** Recent runs, newest first, without the full result. */
  async function list() {
    const { rows } = await q(`SELECT id, "userId", status, "commitHint", summary, error, "durationMs", "createdAt", "finishedAt"
                                FROM code_map_runs ORDER BY "createdAt" DESC, id DESC LIMIT $1`, [KEEP_RUNS]);
    return rows.map(withStage);
  }

  /** The newest finished run with its full result, or null. */
  async function latest() {
    const { rows } = await q(`SELECT id, "userId", status, "commitHint", summary, result, error, "durationMs", "createdAt", "finishedAt"
                                FROM code_map_runs WHERE status = 'done' ORDER BY "createdAt" DESC, id DESC LIMIT 1`);
    return withStage(rows[0] || null);
  }

  /** One run: status and stage while it runs (for polling), the full result once done. Null if not found. */
  async function get(id) {
    const { rows } = await q(`SELECT id, "userId", status, "commitHint", summary, result, error, "durationMs", "createdAt", "finishedAt"
                                FROM code_map_runs WHERE id = $1`, [id]);
    return withStage(rows[0] || null);
  }

  const whenDone = (id) => running.get(id) || Promise.resolve();

  return { start, list, latest, get, whenDone };
}

module.exports = { createJobs, summarize, inboxItems, KEEP_RUNS, STAGE_LABELS, ...createJobs() };
