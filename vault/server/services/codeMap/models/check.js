'use strict';

// Code Map → Models, milestone 2: one check. Inventory (inventory.js) + last-30-day usage (usage.js) + rules (findings.js), saved to
// code_map_model_reports (last 30 kept), with high and medium findings raised in the suggestions inbox, fingerprinted so a finding that is
// still there next week refreshes its inbox item instead of adding another. Low findings stay on the report only (a "newer model" or
// "trial light" line every week would bury the inbox). It recommends only; it never changes Settings. Plain code: no model call here.
// Run weekly from cron/codeMapCron.js after the analysis, and from the Models tab (routes/codeMap.js /models). See docs/code-map.md "Models".

const { getLogger } = require('../../../middleware/requestContext');
const { THRESHOLDS, toolFindings, newerModelFindings, workspaceUnavailableFindings, sortFindings } = require('./findings');

const KEEP_REPORTS = 30;
const KEEP_ERROR_DAYS = 90;
const INBOX_SEVERITIES = new Set(['high', 'medium']);

// What the stored report keeps of a model: enough to read and re-check it, not the whole price table entry.
const slimModel = (m) => ({
  role: m.role, via: m.via, modelId: m.modelId, savedId: m.savedId ?? null, savedInList: m.savedInList ?? null, resolvedFrom: m.resolvedFrom, provider: m.provider,
  inList: m.inList, providerKey: m.providerKey,
  capabilities: m.info ? { vision: m.info.vision, context: m.info.context, json: m.info.json, source: m.info.capabilitySource } : null,
  price: m.info ? { ...m.info.price, priced: m.info.priced } : null,
});

/** Build the report from loaded parts. Pure. */
function buildReport({ inventory, usage, aggregate, thresholds = THRESHOLDS, known }) {
  const range = { from: usage.from, to: usage.to, days: usage.days };
  const agg = aggregate({ usageRows: usage.usageRows, errorRows: usage.errorRows, ownerOf: inventory.ownerOf, toolFiles: inventory.toolFiles });
  const rows = inventory.tools.map((row) => {
    const stats = agg.byTool[row.tool];
    const { findings, notEnoughData } = toolFindings({ row, stats, tiers: inventory.tiers, range, t: thresholds });
    return {
      tool: row.tool, label: row.label, needs: row.needs, needsDeclared: row.needsDeclared,
      models: row.models.map(slimModel), hardcoded: row.hardcoded, stats: stats || null, notEnoughData, findings: sortFindings(findings),
    };
  });
  const workspace = [...workspaceUnavailableFindings(inventory.tools, range), ...newerModelFindings(inventory.tools, range, known)];
  const all = sortFindings([...rows.flatMap((r) => r.findings), ...workspace]);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of all) counts[f.severity] += 1;
  return {
    generatedAt: new Date().toISOString(),
    range,
    thresholds,
    tiers: inventory.tiers,
    counts,
    tools: rows,
    workspaceFindings: workspace,
    findings: all,
    notes: {
      undeclared: inventory.undeclared, unknownNeeds: inventory.unknownNeeds,
      unmappedFeatures: agg.unmappedFeatures, unattributedErrors: agg.unattributedErrors,
    },
  };
}

const TOOL_LABEL = { newsDigest: 'News digest' };

/**
 * Attach model test results (testSet.js recent()) to the report, in place. Pure. Each tool row gets its newest test (row.test); a
 * "worth trialling the light model" or "newer model" finding for the same pair of models gets the result in its evidence and detail, so
 * the inbox, the summary (its figure check reads the evidence) and What to do can say "same quality" only when a test found it.
 */
function attachTests(report, tests = []) {
  const slim = (t) => ({ id: t.id, tool: t.tool, current: t.current, candidate: t.candidate, label: t.summary?.label, text: t.summary?.text, date: String(t.finishedAt instanceof Date ? t.finishedAt.toISOString() : t.finishedAt || '').slice(0, 10) });
  const newest = new Map();
  for (const t of tests) if (!newest.has(t.tool) || t.id > newest.get(t.tool).id) newest.set(t.tool, t);
  for (const row of report.tools || []) row.test = newest.has(row.tool) ? slim(newest.get(row.tool)) : null;
  for (const f of report.findings || []) {
    const e = f.evidence || {};
    const t = tests.filter((x) => (f.kind === 'cheaperTier' && x.tool === f.tool && x.current === e.standard && x.candidate === e.light)
      || (f.kind === 'newerModel' && x.current === e.current && x.candidate === e.candidate)).sort((a, b) => b.id - a.id)[0];
    if (!t || !t.summary) continue;
    const s = slim(t);
    f.evidence = { ...e, test: s };
    f.detail = `${f.detail} Test set on ${TOOL_LABEL[t.tool] || t.tool} (${s.date}): ${s.text}`;
  }
  return report;
}

/** Run the check now and store it. Returns { id, report }. Injectable for tests. */
async function runModelsCheck({
  userId = null,
  pool = require('../../../db').pool,
  loadInventory = require('./inventory').loadInventory,
  loadUsage = require('./usage').loadUsage,
  aggregate = require('./usage').aggregate,
  captureIf = (cond, p) => require('../../SuggestionService').captureIf(cond, p),
  makeFingerprint = (...a) => require('../../SuggestionService').makeFingerprint(...a),
  summarize = (...a) => require('./summary').summarize(...a),
  loadTests = (opts) => require('./testSet').createModelTests(opts).recent(), // with the same pool, so a test's stand-in pool is used
  summaryWithModel = false, // the button asks for the light model's write-up; the weekly cron makes no model call
  log = getLogger(),
} = {}) {
  const t0 = Date.now();
  const inventory = await loadInventory({ pool });
  const owner = userId || inventory.adminId;
  const usage = await loadUsage({ pool, days: THRESHOLDS.days });
  const report = buildReport({ inventory, usage, aggregate });
  try {
    attachTests(report, await loadTests({ pool }));
  } catch (err) {
    log.error({ err }, '[codeMapModels] loading model test results failed'); // the check goes on without them
  }
  try {
    report.summary = await summarize(report, { userId: owner, useModel: summaryWithModel });
  } catch (err) {
    // a summary problem never loses the check: fall back to the app's own text
    log.error({ err }, '[codeMapModels] summary failed');
    report.summary = await summarize(report, { userId: owner, useModel: false });
  }

  const ins = await pool.query(
    `INSERT INTO code_map_model_reports ("userId", result, "durationMs") VALUES ($1, $2::jsonb, $3) RETURNING id`,
    [owner, JSON.stringify(report), Date.now() - t0],
  );
  const id = ins.rows[0].id;
  try {
    await pool.query(`DELETE FROM code_map_model_reports WHERE id NOT IN (SELECT id FROM code_map_model_reports ORDER BY "createdAt" DESC, id DESC LIMIT $1)`, [KEEP_REPORTS]);
    await pool.query(`DELETE FROM model_call_errors WHERE created_at < NOW() - $1::interval`, [`${KEEP_ERROR_DAYS} days`]);
  } catch (err) {
    log.error({ err }, '[codeMapModels] trimming old reports or errors failed');
  }

  for (const f of report.findings) {
    try {
      // hardcoded ids are already raised by Code Map's own run (fingerprint codeMap:models:<tool>): no second inbox item for the same thing
      await captureIf(INBOX_SEVERITIES.has(f.severity) && f.kind !== 'hardcodedModel', {
        userId: inventory.adminId, source: 'codeMapModels', category: 'alert',
        fingerprint: makeFingerprint('codeMapModels', f.fingerprintKey),
        title: `Models: ${f.title}`,
        body: `${f.detail}\n\nEvidence (${report.range.from} to ${report.range.to}): ${JSON.stringify(f.evidence)}`,
        context: 'Code Map → Models. A recommendation only: nothing was changed. Swap the model in Settings if you agree.',
      });
    } catch (err) {
      log.error({ err, kind: f.kind, tool: f.tool }, '[codeMapModels] raising a finding in the inbox failed');
    }
  }
  log.info({ id, counts: report.counts, ms: Date.now() - t0 }, '[codeMapModels] check done');
  return { id, report };
}

/** The newest stored report: { id, createdAt, durationMs, result } or null. */
async function latestReport({ pool = require('../../../db').pool } = {}) {
  const { rows } = await pool.query(`SELECT id, "createdAt", "durationMs", result FROM code_map_model_reports ORDER BY "createdAt" DESC, id DESC LIMIT 1`);
  if (!rows[0]) return null;
  const r = rows[0];
  return { ...r, result: typeof r.result === 'string' ? JSON.parse(r.result) : r.result };
}

// shortcut: one check at a time per server process; two servers during a rolling deploy could each run one (two reports, same findings,
// the inbox de-duplicates). Move to a database lock if it ever matters.
let running = null;
/** The Models tab's Run check button: 409 while one is going. Returns the report in the same shape as latestReport. */
async function runNow(userId, deps = {}) {
  if (running) throw Object.assign(new Error('A models check is already running. It takes a few seconds.'), { status: 409 });
  running = (async () => {
    const t0 = Date.now();
    const { id, report } = await runModelsCheck({ userId, summaryWithModel: true, ...deps });
    return { id, createdAt: report.generatedAt, durationMs: Date.now() - t0, result: report };
  })();
  try { return await running; } finally { running = null; }
}

module.exports = { buildReport, attachTests, runModelsCheck, latestReport, runNow, KEEP_REPORTS, INBOX_SEVERITIES };
