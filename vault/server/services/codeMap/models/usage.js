'use strict';

// Code Map → Models, milestone 2: how each tool's model calls went in the last N days, worked out in plain code from usage_logs (successful
// calls: count, cost, tokens, latency, backup used) and model_call_errors (failed calls). Workspace-wide: this is an admin check of the app,
// not of one person. Successful calls reach a tool by their feature name (modelNeeds.js toolForFeature); failed calls by the files on their
// call stack (the first one a tool owns, or that only one tool reaches). See docs/code-map.md "Models".

const { toolForFeature } = require('../../../config/modelNeeds');

/** p-th percentile (0..1) of a list of numbers, linear between ranks like Postgres percentile_cont. null for an empty list. */
function percentile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = (v.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return Math.round(v[lo] + (v[hi] - v[lo]) * (rank - lo));
}

/** The tool a failed call belongs to, from its "a>b>c" caller files. Pure. */
function attributeCallers(callers, { ownerOf, toolFiles }) {
  const files = String(callers || '').split('>').filter(Boolean);
  for (const f of files) if (ownerOf.has(f)) return ownerOf.get(f);
  for (const f of files) {
    const tools = Object.keys(toolFiles).filter((t) => toolFiles[t].includes(f));
    if (tools.length === 1) return tools[0];
  }
  return null;
}

/**
 * Per-tool stats. usageRows: { feature, modelId, calls, cost, sumIn, sumOut, latencies: number[], fallbacks }; errorRows: { modelId, callers }.
 * Returns { byTool: { [tool]: stats }, unmappedFeatures, unattributedErrors }. Pure.
 */
function aggregate({ usageRows = [], errorRows = [], ownerOf = new Map(), toolFiles = {}, mapFeature = toolForFeature }) {
  const byTool = {};
  const blank = () => ({ calls: 0, cost: 0, sumIn: 0, sumOut: 0, latencies: [], fallbacks: 0, errors: 0, byModel: {} });
  const unmapped = new Set();
  for (const r of usageRows) {
    const tool = mapFeature(r.feature);
    if (!tool) { unmapped.add(r.feature); continue; }
    const s = byTool[tool] || (byTool[tool] = blank());
    s.calls += Number(r.calls) || 0;
    s.cost += Number(r.cost) || 0;
    s.sumIn += Number(r.sumIn) || 0;
    s.sumOut += Number(r.sumOut) || 0;
    s.fallbacks += Number(r.fallbacks) || 0;
    for (const l of r.latencies || []) s.latencies.push(Number(l));
    const m = s.byModel[r.modelId] || (s.byModel[r.modelId] = { calls: 0, cost: 0, errors: 0 });
    m.calls += Number(r.calls) || 0;
    m.cost += Number(r.cost) || 0;
  }
  let unattributed = 0;
  for (const e of errorRows) {
    const tool = attributeCallers(e.callers, { ownerOf, toolFiles });
    if (!tool) { unattributed += 1; continue; }
    const s = byTool[tool] || (byTool[tool] = blank());
    s.errors += 1;
    const m = s.byModel[e.modelId] || (s.byModel[e.modelId] = { calls: 0, cost: 0, errors: 0 });
    m.errors += 1;
  }
  const out = {};
  for (const [tool, s] of Object.entries(byTool)) {
    const attempts = s.calls + s.errors;
    out[tool] = {
      calls: s.calls,
      errors: s.errors,
      attempts,
      costUsd: Number(s.cost.toFixed(6)),
      avgCostUsd: s.calls ? Number((s.cost / s.calls).toFixed(6)) : null,
      avgInputTokens: s.calls ? Math.round(s.sumIn / s.calls) : null,
      avgOutputTokens: s.calls ? Math.round(s.sumOut / s.calls) : null,
      timedCalls: s.latencies.length,
      medianMs: percentile(s.latencies, 0.5),
      p90Ms: percentile(s.latencies, 0.9),
      errorRate: attempts ? Number((s.errors / attempts).toFixed(4)) : null,
      fallbacks: s.fallbacks,
      backupRate: s.calls ? Number((s.fallbacks / s.calls).toFixed(4)) : null,
      byModel: s.byModel,
    };
  }
  return { byTool: out, unmappedFeatures: [...unmapped].sort(), unattributedErrors: unattributed };
}

/** Read the last `days` days from the database. */
async function loadUsage({ pool, days = 30 }) {
  const since = `${Number(days)} days`;
  const [usage, errors, range] = await Promise.all([
    // shortcut: latencies come back as one array per feature and model; fine at this app's volume, switch to SQL percentiles if it grows large.
    pool.query(
      `SELECT feature, model_id AS "modelId", COUNT(*)::int AS calls, COALESCE(SUM(estimated_cost_usd), 0)::float AS cost,
              COALESCE(SUM(input_tokens), 0)::float AS "sumIn", COALESCE(SUM(output_tokens), 0)::float AS "sumOut",
              COALESCE(array_agg(latency_ms) FILTER (WHERE latency_ms IS NOT NULL), '{}') AS latencies,
              COUNT(*) FILTER (WHERE fallback)::int AS fallbacks
         FROM usage_logs WHERE created_at >= NOW() - $1::interval GROUP BY feature, model_id`,
      [since],
    ),
    pool.query(`SELECT model_id AS "modelId", callers FROM model_call_errors WHERE created_at >= NOW() - $1::interval`, [since]),
    pool.query(`SELECT (NOW() - $1::interval)::date::text AS "from", NOW()::date::text AS "to"`, [since]),
  ]);
  return { usageRows: usage.rows, errorRows: errors.rows, from: range.rows[0].from, to: range.rows[0].to, days: Number(days) };
}

module.exports = { percentile, attributeCallers, aggregate, loadUsage };
