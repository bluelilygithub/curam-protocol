'use strict';

// Skill Scanner: saved SkillSpector scans (table skill_scans) and the background runs behind them. Admin only (mounted behind
// requireAdmin). A scan answers at once with a job id; the page polls GET /jobs/:id. See docs/skill-scan.md.

const runner = require('./runner');
const { explainScan, groupFindings } = require('./summary');
const { calculateCost } = require('../costCalculator');
// The in-memory job registry BIP uses (generic: id, progress, result; lost on restart, the saved row is not).
const jobs = require('../bip/jobs');

const MAX_RUNNING = 2; // scans are CPU-heavy subprocesses; at most two at once on the server
let running = 0;

const parse = (v, fallback = null) => {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

function createSkillScanService({ pool = require('../../db').pool, deps = {} } = {}) {
  // The model chosen for Skill Scanner in Settings -> AI & Chat (else the workspace default): services/skillScan/modelResolver.js
  const models = deps.models || require('./modelResolver').createModelResolver();

  async function config(userId) {
    const installed = await runner.isInstalled(deps.runnerDeps);
    const { modelId, anthropic } = await models.resolveModel(userId).catch(() => ({ modelId: null, anthropic: false }));
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    const deepReason = !modelId ? 'No AI model is set up yet. Add one under Settings -> AI & Chat.'
      : !anthropic ? `A Deep scan needs an Anthropic (Claude) model; Skill Scanner is set to ${modelId}. Choose a Claude model under Settings -> AI & Chat -> Skill Scanner model.`
        : !hasKey ? 'ANTHROPIC_API_KEY is not set on this server.' : null;
    return { installed, deepAvailable: !deepReason, deepReason, model: modelId, modelIsAnthropic: anthropic, maxZipMb: 20 };
  }

  // the explanation uses the same chosen model
  const summaryDeps = (userId) => deps.summaryDeps || { getModels: async () => ({ standard: (await models.resolveModel(userId)).modelId }) };

  async function list(userId) {
    const { rows } = await pool.query(
      `SELECT id, source, "sourceType", "fileName", mode, recursive, status, score, severity, recommendation, "issueCount", error, "durationMs", "skillCount", "costUsd", "createdAt", "finishedAt"
         FROM skill_scans WHERE "userId" = $1 ORDER BY "createdAt" DESC, id DESC LIMIT 200`, [userId]);
    return rows;
  }

  async function get(userId, id) {
    const { rows } = await pool.query('SELECT * FROM skill_scans WHERE id = $1 AND "userId" = $2', [Number(id) || 0, userId]);
    if (!rows[0]) return null;
    const report = parse(rows[0].report);
    // the same grouping the explanation uses, so the page and the export match it
    return { ...rows[0], report, summary: parse(rows[0].summary), groups: report ? groupFindings(report) : [] };
  }

  /** Write (or rewrite) the plain-English explanation of a finished scan and save it. */
  async function summarise(userId, id) {
    const scan = await get(userId, id);
    if (!scan) return null;
    const summary = await (deps.explainScan || explainScan)(userId, scan, summaryDeps(userId));
    const u = summary.usage || { input: 0, output: 0 };
    // every explanation (Regenerate too) is real spend, so it adds to the scan's tokens and cost
    await pool.query(
      `UPDATE skill_scans SET summary = $3::jsonb, "tokensIn" = COALESCE("tokensIn", 0) + $4, "tokensOut" = COALESCE("tokensOut", 0) + $5,
              "costUsd" = COALESCE("costUsd", 0) + $6 WHERE id = $1 AND "userId" = $2`,
      [scan.id, userId, JSON.stringify(summary), u.input, u.output, priced(summary.model, u)]);
    return summary;
  }

  /**
   * Seconds per skill from this person's last 10 finished scans of the same kind (median), for the estimate before and during a scan.
   * null until there is history.
   */
  async function secondsPerSkill(userId, mode) {
    const { rows } = await pool.query(
      `SELECT "durationMs", "skillCount" FROM skill_scans
        WHERE "userId" = $1 AND mode = $2 AND status = 'done' AND "durationMs" > 0 AND "skillCount" > 0
        ORDER BY "finishedAt" DESC LIMIT 10`, [userId, mode]);
    const rates = rows.map((r) => r.durationMs / 1000 / r.skillCount).sort((a, b) => a - b);
    return rates.length ? Math.round(rates[Math.floor(rates.length / 2)] * 10) / 10 : null;
  }

  const priced = (modelId, u) => (modelId && (u.input || u.output) ? calculateCost(modelId, u.input, u.output) : 0);

  /**
   * Estimated USD per skill for the next scan: the median tokens per skill of this person's last 10 finished scans of the same kind
   * (explanation included), priced at the model chosen now. null until there is history.
   */
  async function costPerSkill(userId, mode, modelId) {
    if (!modelId) return null;
    const { rows } = await pool.query(
      `SELECT "tokensIn", "tokensOut", "skillCount" FROM skill_scans
        WHERE "userId" = $1 AND mode = $2 AND status = 'done' AND "tokensIn" IS NOT NULL AND "skillCount" > 0
        ORDER BY "finishedAt" DESC LIMIT 10`, [userId, mode]);
    if (!rows.length) return null;
    const mid = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    return priced(modelId, { input: mid(rows.map((r) => Number(r.tokensIn) / r.skillCount)), output: mid(rows.map((r) => Number(r.tokensOut) / r.skillCount)) });
  }

  /** Start a scan (always skill by skill); resolves { jobId, scanId } at once. input: { url } or { zipBuffer, fileName }, plus deep. */
  async function start(userId, { url = null, zipBuffer = null, fileName = null, deep = false }) {
    const source = url ? runner.parseGithubUrl(url) : null;
    if (url && !source) throw Object.assign(new Error('Paste a public github.com link, e.g. https://github.com/owner/repo or a /tree/main/folder link.'), { status: 400 });
    if (!url && !zipBuffer) throw Object.assign(new Error('Paste a GitHub link or upload a zip.'), { status: 400 });
    let model = null;
    if (deep) {
      const c = await config(userId);
      if (!c.deepAvailable) throw Object.assign(new Error(c.deepReason), { status: 400 });
      model = c.model;
    }
    if (running >= MAX_RUNNING) throw Object.assign(new Error('Two scans are already running. Try again when one finishes.'), { status: 429 });
    const { rows } = await pool.query(
      `INSERT INTO skill_scans ("userId", source, "sourceType", "fileName", mode, recursive, model, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'running') RETURNING id`,
      [userId, source || fileName || 'upload.zip', url ? 'github' : 'zip', fileName ? String(fileName).slice(0, 200) : null, deep ? 'deep' : 'static', true, model]);
    const scanId = rows[0].id;
    running += 1;
    const rate = await secondsPerSkill(userId, deep ? 'deep' : 'static').catch(() => null);
    const priceModel = model || (await models.resolveModel(userId).catch(() => ({}))).modelId || null;
    const perSkillCost = await costPerSkill(userId, deep ? 'deep' : 'static', priceModel).catch(() => null);
    const label = `${deep ? 'Deep' : 'Static'} scan of ${source || fileName || 'the upload'}`;
    const jobId = jobs.startJob(userId, label, async (onProgress0) => {
      // a first deep scan has no history: give a floor, every file read once by the model (about 4 bytes a token), output not counted
      const onProgress = (p) => onProgress0(deep && perSkillCost == null && p.phase === 'scan' && p.bytes
        ? { ...p, costFloor: Math.round(calculateCost(model, p.bytes / 4, 0) * 100) / 100 } : p);
      onProgress({ phase: url ? 'download' : 'unpack', current: 0, total: null, module: null });
      try {
        const { exitCode, report, stats = {} } = await (deps.runScan || runner.runScan)({ url: source, zipBuffer, deep, model, secondsPerSkill: rate, costPerSkill: perSkillCost }, undefined, onProgress);
        const tok = stats.tokens || { input: 0, output: 0 };
        await pool.query(
          `UPDATE skill_scans SET status = 'done', score = $3, severity = $4, recommendation = $5, "issueCount" = $6, report = $7::jsonb,
                  "exitCode" = $8, "durationMs" = $9, "skillCount" = $10, "fileCount" = $11, "tokensIn" = $12, "tokensOut" = $13, "costUsd" = $14,
                  "finishedAt" = NOW() WHERE id = $1 AND "userId" = $2`,
          [scanId, userId, report.score, report.severity, report.recommendation, report.issueCount, JSON.stringify(report), exitCode,
            stats.durationMs ?? null, stats.skillCount ?? null, stats.fileCount ?? null, tok.input, tok.output, priced(model, tok)]);
        // SkillSpector's own calls (deep only) in the usage log; inference_usage is a list of records per skill, summed by runner.tokenUsage
        if (deep && (tok.input || tok.output)) {
          (deps.logUsage || require('../../utils/logUsage').logUsage)({ userId, model, inputTokens: tok.input, outputTokens: tok.output, feature: 'skill_scan_deep' });
        }
        // the explanation in context (summary.js); a failure leaves the scan done, and Regenerate can try again
        onProgress({ phase: 'summary', current: report.skillCount, total: report.skillCount, module: null });
        await summarise(userId, scanId).catch((err) => console.warn(`[skillScan] explanation for scan ${scanId} not written:`, err.message));
        return { scanId, score: report.score, recommendation: report.recommendation };
      } catch (err) {
        await pool.query(`UPDATE skill_scans SET status = 'failed', error = $3, "finishedAt" = NOW() WHERE id = $1 AND "userId" = $2`,
          [scanId, userId, String(err.message || err).slice(0, 1000)]).catch(() => {});
        throw err;
      } finally {
        running -= 1;
      }
    });
    return { jobId, scanId };
  }

  /** Delete into the shared recycle bin (adapter: recycleBin/adapters/skillScan.js). */
  async function remove(userId, id) {
    const { moveToBin } = require('../recycleBin');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM skill_scans WHERE id = $1 AND "userId" = $2 FOR UPDATE', [Number(id) || 0, userId]);
      const scan = rows[0];
      if (!scan) { await client.query('ROLLBACK'); return null; }
      if (scan.status === 'running') { await client.query('ROLLBACK'); throw Object.assign(new Error('That scan is still running.'), { status: 409 }); }
      const binId = await moveToBin(client, {
        userId, type: 'skill-scan', id: scan.id, title: scan.fileName || scan.source,
        detail: `Skill scan (${scan.mode}) ${scan.recommendation || scan.status}`, payload: { scan }, maxBytes: 20 * 1024 * 1024,
      });
      await client.query('DELETE FROM skill_scans WHERE id = $1 AND "userId" = $2', [scan.id, userId]);
      await client.query('COMMIT');
      return { binId };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }
  }

  return {
    config, list, get, start, remove, summarise, getJob: jobs.getJob,
    getModelConfig: (userId) => models.getModelConfig(userId),
    saveModel: (userId, modelId) => models.saveModel(userId, modelId),
  };
}

module.exports = { createSkillScanService, MAX_RUNNING };
