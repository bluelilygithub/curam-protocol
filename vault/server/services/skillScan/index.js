'use strict';

// Skill Scanner: saved SkillSpector scans (table skill_scans) and the background runs behind them. Admin only (mounted behind
// requireAdmin). A scan answers at once with a job id; the page polls GET /jobs/:id. See docs/skill-scan.md.

const runner = require('./runner');
const { explainScan, groupFindings } = require('./summary');
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
  const getModels = deps.getModels || ((userId) => require('../modelResolver').getModelsForUser(userId));

  async function config(userId) {
    const installed = await runner.isInstalled(deps.runnerDeps);
    const model = (await getModels(userId).catch(() => ({})))?.standard || null;
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    const deepReason = !hasKey ? 'ANTHROPIC_API_KEY is not set on this server.'
      : !/^claude/i.test(String(model || '')) ? 'A deep scan uses Anthropic: choose a Claude model as the standard model in Settings.' : null;
    return { installed, deepAvailable: !deepReason, deepReason, model: deepReason ? null : model, maxZipMb: 20 };
  }

  async function list(userId) {
    const { rows } = await pool.query(
      `SELECT id, source, "sourceType", "fileName", mode, recursive, status, score, severity, recommendation, "issueCount", error, "createdAt", "finishedAt"
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
    const summary = await (deps.explainScan || explainScan)(userId, scan, deps.summaryDeps);
    await pool.query('UPDATE skill_scans SET summary = $3::jsonb WHERE id = $1 AND "userId" = $2', [scan.id, userId, JSON.stringify(summary)]);
    return summary;
  }

  /** Start a scan; resolves { jobId, scanId } at once. input: { url } or { zipBuffer, fileName }, plus deep, recursive. */
  async function start(userId, { url = null, zipBuffer = null, fileName = null, deep = false, recursive = false }) {
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
      [userId, source || fileName || 'upload.zip', url ? 'github' : 'zip', fileName ? String(fileName).slice(0, 200) : null, deep ? 'deep' : 'static', !!recursive, model]);
    const scanId = rows[0].id;
    running += 1;
    const label = `${deep ? 'Deep' : 'Static'} scan of ${source || fileName || 'the upload'}`;
    const jobId = jobs.startJob(userId, label, async (onProgress) => {
      onProgress({ phase: deep ? 'deep' : 'static', current: 0, total: 1, module: null });
      try {
        const { exitCode, report, raw } = await (deps.runScan || runner.runScan)({ url: source, zipBuffer, deep, recursive, model });
        await pool.query(
          `UPDATE skill_scans SET status = 'done', score = $3, severity = $4, recommendation = $5, "issueCount" = $6, report = $7::jsonb,
                  "exitCode" = $8, "finishedAt" = NOW() WHERE id = $1 AND "userId" = $2`,
          [scanId, userId, report.score, report.severity, report.recommendation, report.issueCount, JSON.stringify(report), exitCode]);
        const usage = raw?.metadata?.inference_usage;
        if (deep && usage && (Number(usage.input_tokens) || Number(usage.output_tokens))) {
          (deps.logUsage || require('../../utils/logUsage').logUsage)({ userId, model, inputTokens: Number(usage.input_tokens) || 0, outputTokens: Number(usage.output_tokens) || 0, feature: 'skill_scan_deep' });
        }
        // the explanation in context (summary.js); a failure leaves the scan done, and Regenerate can try again
        onProgress({ phase: 'summary', current: 1, total: 1, module: null });
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

  return { config, list, get, start, remove, summarise, getJob: jobs.getJob };
}

module.exports = { createSkillScanService, MAX_RUNNING };
