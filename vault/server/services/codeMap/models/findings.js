'use strict';

// Code Map → Models, milestone 2: the rules. Each finding carries its evidence (numbers, sample size, date range) and a stable fingerprint
// key, so the same finding next week refreshes the inbox item instead of adding another. It recommends only; it never changes Settings.
// Pure: everything comes in as arguments. See docs/code-map.md "Models".

const { modelInfo, modelFamily, knownModelIds } = require('../../costCalculator');

const THRESHOLDS = {
  days: 30,               // the usage window
  minCalls: 20,           // fewer calls than this in the window: no quality or cost findings ("not enough data")
  backupRate: 0.10,       // backup answered more than this share of calls
  errorRate: 0.05,        // more than this share of attempts failed
  cheaperMaxAvgIn: 4000,  // a background tool on standard with prompts and replies this small could trial light
  cheaperMaxAvgOut: 1000,
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const TEXT_PROVIDERS = new Set(['anthropic', 'gemini', 'deepseek', 'ollama']);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

// The models a tool's capability needs apply to: its standard/light tier and any dedicated or backup model. An explicit gemini/deepseek/
// ollama tier is a deliberate provider choice for one job (often a cheap pass), so needs are not held against it.
const servesNeeds = (m) => m.modelId && TEXT_PROVIDERS.has(m.provider) && (m.role !== 'default' || m.via === 'tier:standard' || m.via === 'tier:light');

/** Findings for one tool. row = inventory row (with hardcoded); stats = usage stats for the tool or undefined. */
function toolFindings({ row, stats, tiers, range, t = THRESHOLDS }) {
  const out = [];
  const add = (kind, severity, title, detail, evidence, modelId = null) => out.push({
    tool: row.tool, label: row.label, kind, severity, title, detail, modelId,
    evidence: { ...evidence, range }, fingerprintKey: `${row.tool}:${kind}:${modelId || ''}`,
  });
  const needs = row.needs || {};

  // Capability mismatch (high)
  for (const m of row.models.filter(servesNeeds)) {
    const info = m.info || {};
    const gaps = [];
    if (needs.vision && info.vision === false) gaps.push('takes no images');
    if (needs.json && info.json === false) gaps.push('has no reliable JSON output');
    if (needs.minContext && info.context != null && info.context < needs.minContext) gaps.push(`accepts ${info.context} tokens, the tool needs ${needs.minContext}`);
    if (gaps.length) {
      add('capabilityMismatch', 'high', `${row.label}: ${m.modelId} ${gaps.join('; ')}`,
        `${row.label} declares it needs ${[needs.vision && 'vision', needs.json && 'JSON output', needs.minContext && `${needs.minContext} tokens of context`].filter(Boolean).join(', ')}. Pick a model that has it in Settings.`,
        { model: m.modelId, via: m.via, gaps, capabilitySource: info.capabilitySource, needs: { vision: needs.vision, json: needs.json, minContext: needs.minContext } }, m.modelId);
    }
  }

  // Hardcoded model id (high): Code Map's existing rule
  if (row.hardcoded) {
    add('hardcodedModel', 'high', `${row.label}: hardcoded model id`, `${row.hardcoded.note} Ids should come from Settings.`, { lines: row.hardcoded.evidence });
  }

  // Unavailable model (high). A workspace standard/light model that is not set, and a missing provider key, are one problem each, raised
  // once for the workspace (workspaceUnavailableFindings), not once per tool. A missing gemini/deepseek/ollama tier is not a finding:
  // tools use those as optional extras when one is set.
  for (const m of row.models) {
    if (m.savedId && m.savedInList === false) {
      // a dedicated/backup setting names a model that is no longer in the list; the tool quietly uses the default instead
      add('unavailableModel', 'high', `${row.label}: ${m.savedId} is not in the model list`, `Settings ${m.via.replace('setting:', '')} names ${m.savedId}, which is no longer connected, so ${row.label} falls back to ${m.modelId || 'nothing'}.`, { via: m.via, saved: m.savedId, usedInstead: m.modelId }, m.savedId);
    }
  }

  // Quality and cost findings need enough calls
  const enough = stats && stats.attempts >= t.minCalls;
  if (enough) {
    if (stats.calls && stats.backupRate > t.backupRate) {
      add('backupOften', 'medium', `${row.label}: backup used on ${pct(stats.backupRate)} of calls`, `The backup model answered ${stats.fallbacks} of ${stats.calls} calls in ${t.days} days (threshold ${pct(t.backupRate)}). The primary is failing often; check it.`,
        { fallbacks: stats.fallbacks, calls: stats.calls, rate: stats.backupRate, threshold: t.backupRate });
    }
    if (stats.errorRate > t.errorRate) {
      add('highErrorRate', 'medium', `${row.label}: ${pct(stats.errorRate)} of model calls failed`, `${stats.errors} of ${stats.attempts} calls failed in ${t.days} days (threshold ${pct(t.errorRate)}).`,
        { errors: stats.errors, attempts: stats.attempts, rate: stats.errorRate, threshold: t.errorRate, byModel: stats.byModel });
    }
    const usesStandard = row.models.some((m) => m.via === 'tier:standard');
    if (needs.mode === 'background' && usesStandard && tiers.light && tiers.light !== tiers.standard
      && stats.avgInputTokens <= t.cheaperMaxAvgIn && stats.avgOutputTokens <= t.cheaperMaxAvgOut) {
      add('cheaperTier', 'low', `${row.label}: worth trialling the light model`, `A background tool on ${tiers.standard} with small prompts and replies (about ${stats.avgInputTokens} tokens in, ${stats.avgOutputTokens} out, ${stats.calls} calls). Trial ${tiers.light} and compare the results before switching: this is something to test, not a sure saving.`,
        { standard: tiers.standard, light: tiers.light, avgInputTokens: stats.avgInputTokens, avgOutputTokens: stats.avgOutputTokens, calls: stats.calls, costUsd: stats.costUsd }, tiers.standard);
    }
  }
  return { findings: out, notEnoughData: !enough };
}

/** The newest model of the same family that costs the same or less, or null. */
function newerSameFamily(modelId, known = knownModelIds()) {
  const fam = modelFamily(modelId);
  if (!fam) return null;
  const cur = modelInfo(modelId);
  if (!cur.priced) return null; // no real price to compare with
  const newer = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  let best = null;
  for (const id of known) {
    const f = modelFamily(id);
    if (!f || f.provider !== fam.provider || f.family !== fam.family || !newer(f.version, fam.version)) continue;
    const cand = modelInfo(id);
    if (!cand.priced) continue; // a guessed family price is no basis for "same or lower price"
    if (cand.price.input > cur.price.input || cand.price.output > cur.price.output) continue;
    if (!best || newer(f.version, modelFamily(best).version)) best = id;
  }
  return best ? { candidate: best, current: cur.price, candidatePrice: modelInfo(best).price } : null;
}

/** "Newer model available" (low), once per model for the whole workspace, listing the tools that use it. */
function newerModelFindings(rows, range, known) {
  const users = new Map();
  for (const r of rows) for (const m of r.models) if (m.modelId && TEXT_PROVIDERS.has(m.provider)) {
    if (!users.has(m.modelId)) users.set(m.modelId, new Set());
    users.get(m.modelId).add(r.label);
  }
  const out = [];
  for (const [modelId, tools] of users) {
    const n = newerSameFamily(modelId, known);
    if (!n) continue;
    out.push({
      tool: '(workspace)', label: 'Workspace', kind: 'newerModel', severity: 'low', modelId,
      title: `${n.candidate} is newer than ${modelId} at the same or lower price`,
      detail: `${tools.size} tool${tools.size === 1 ? '' : 's'} use ${modelId}. ${n.candidate} is in the same family, newer, and costs $${n.candidatePrice.input}/$${n.candidatePrice.output} per million tokens in/out against $${n.current.input}/$${n.current.output}. Try it on one tool before swapping it in Settings.`,
      evidence: { current: modelId, candidate: n.candidate, currentPrice: n.current, candidatePrice: n.candidatePrice, tools: [...tools].sort(), range },
      fingerprintKey: `workspace:newerModel:${modelId}`,
    });
  }
  return out;
}

/**
 * Workspace-wide "Unavailable model" (high): a standard or light model that is not set (once per tier), and a model whose provider key is
 * not set on this server (once per model). Each lists the tools affected.
 */
function workspaceUnavailableFindings(rows, range) {
  const tiersMissing = new Map();
  const byModel = new Map();
  for (const r of rows) for (const m of r.models) {
    if (!m.modelId && (m.via === 'tier:standard' || m.via === 'tier:light')) {
      const tier = m.via.replace('tier:', '');
      if (!tiersMissing.has(tier)) tiersMissing.set(tier, new Set());
      tiersMissing.get(tier).add(r.label);
    }
    if (m.modelId && m.providerKey === false) {
      if (!byModel.has(m.modelId)) byModel.set(m.modelId, { provider: m.provider, tools: new Set() });
      byModel.get(m.modelId).tools.add(r.label);
    }
  }
  const noTier = [...tiersMissing].map(([tier, tools]) => ({
    tool: '(workspace)', label: 'Workspace', kind: 'unavailableModel', severity: 'high', modelId: null,
    title: `No ${tier} model is set`,
    detail: `${tools.size} tool${tools.size === 1 ? '' : 's'} use the workspace ${tier} model and none is set up, so their AI features cannot run. Add a model in Settings → Models. Tools: ${[...tools].sort().join(', ')}.`,
    evidence: { tier, tools: [...tools].sort(), range },
    fingerprintKey: `workspace:noTier:${tier}`,
  }));
  return [...noTier, ...[...byModel].map(([modelId, { provider, tools }]) => ({
    tool: '(workspace)', label: 'Workspace', kind: 'unavailableModel', severity: 'high', modelId,
    title: `No ${provider} key for ${modelId}`,
    detail: `${modelId} is in the model list but the ${provider} key is not set on this server, so calls to it fail. Used by ${tools.size} tool${tools.size === 1 ? '' : 's'}: ${[...tools].sort().join(', ')}.`,
    evidence: { model: modelId, provider, tools: [...tools].sort(), range },
    fingerprintKey: `workspace:missingKey:${modelId}`,
  }))];
}

const sortFindings = (list) => list.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.tool.localeCompare(b.tool));

module.exports = { THRESHOLDS, toolFindings, newerSameFamily, newerModelFindings, workspaceUnavailableFindings, sortFindings };
