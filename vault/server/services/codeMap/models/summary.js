'use strict';

// Code Map → Models, milestone 4: a plain-English summary of a report, overall and per tool with findings. The app always writes one in
// code (codeSummary). When asked (the Run check button; the weekly cron makes no model call), the `light` model from getModelsForUser
// rewrites it from the report's evidence only. Every number in a model text must appear in that evidence (checkFigures, every digit);
// a text that fails, or a failed or unreadable model call, falls back to the app's text for that part, and the report says why.
// It recommends only; the prompt forbids saying anything was changed. See docs/code-map.md "Models".

const { checkFigures } = require('../../../utils/checkFigures');

const FEATURE = 'code_map_models_summary';
const MAX_TOOLS = 25; // tools with findings sent to the model; the rest keep the app's text

const SYSTEM = `You summarise an automated check of which AI models a software workspace uses and how they perform, for its admin.
Use ONLY the evidence JSON you are given. Every number you write must appear in the evidence exactly; never compute, round or estimate a new one. If you cannot say something without a new number, leave the number out.
It is a recommendation: never say a model was changed, switched or fixed. Say what to check or consider.
A "cheaperTier" finding is something to trial, never a sure saving. A "newerModel" finding is something to try on one tool first.
Plain words, short sentences, no headings, no lists, no markdown.
Reply with ONLY one JSON object: {"overall": "3 to 5 sentences on the whole workspace, most urgent first", "tools": {"<tool id>": "1 to 3 sentences on that tool's findings"}}
Include a "tools" entry only for the tool ids in the evidence.`;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The app's own summary, built in code from the report. Never fails. */
function codeSummary(report) {
  const c = report.counts || { high: 0, medium: 0, low: 0 };
  const tools = report.tools || [];
  const total = c.high + c.medium + c.low;
  const thin = tools.filter((t) => t.notEnoughData).length;
  const r = report.range || {};
  let overall;
  if (!total) overall = `No problems found across ${plural(tools.length, 'tool')} that call an AI model (usage ${r.from} to ${r.to}).`;
  else {
    const urgent = (report.findings || []).filter((f) => f.severity === 'high').slice(0, 3).map((f) => f.title);
    overall = `${c.high} high, ${c.medium} medium and ${c.low} low ${total === 1 ? 'finding' : 'findings'} across ${plural(tools.length, 'tool')} (usage ${r.from} to ${r.to}).`
      + (urgent.length ? ` Most urgent: ${urgent.join('; ')}.` : '');
  }
  if (thin) overall += ` ${plural(thin, 'tool')} had fewer than 20 calls, so ${thin === 1 ? 'it gets' : 'they get'} no error, backup or cost findings yet.`;
  overall += ' Nothing was changed: swap a model in Settings if you agree.';
  const byTool = {};
  for (const t of tools) {
    if (t.findings.length) byTool[t.tool] = `${t.findings.map((f) => f.title.replace(/^[^:]+: /, '')).join('; ')}.`;
  }
  return { overall, tools: byTool };
}

/** What the model may see and the figure check compares against. Pure. */
function buildEvidence(report) {
  const withFindings = (report.tools || []).filter((t) => t.findings.length).slice(0, MAX_TOOLS);
  return {
    range: report.range,
    counts: report.counts,
    thresholds: report.thresholds,
    toolsChecked: (report.tools || []).length,
    toolsWithTooFewCalls: (report.tools || []).filter((t) => t.notEnoughData).length,
    workspaceFindings: (report.workspaceFindings || []).map((f) => ({ kind: f.kind, severity: f.severity, title: f.title, evidence: f.evidence })),
    tools: withFindings.map((t) => ({
      id: t.tool, label: t.label,
      stats: t.stats ? { calls: t.stats.calls, errors: t.stats.errors, costUsd: t.stats.costUsd, medianMs: t.stats.medianMs, errorRate: t.stats.errorRate, backupRate: t.stats.backupRate } : null,
      findings: t.findings.map((f) => ({ kind: f.kind, severity: f.severity, title: f.title, evidence: f.evidence })),
    })),
  };
}

/** Read the model's JSON reply. Returns { overall, tools } with strings only, or null. Pure. */
function parseReply(text) {
  const raw = String(text || '');
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let obj;
  try { obj = JSON.parse(raw.slice(a, b + 1)); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  const tools = {};
  if (obj.tools && typeof obj.tools === 'object') for (const [k, v] of Object.entries(obj.tools)) if (clean(v)) tools[k] = clean(v);
  return { overall: clean(obj.overall), tools };
}

/**
 * Merge the model's texts into the app's, part by part: a model text is used only if it is there and every number in it is in the
 * evidence. Pure. Returns { overall: { text, source, unverified? }, tools: { id: { text, source, unverified? } } }.
 */
function mergeChecked({ app, model, evidenceText, toolIds }) {
  const pick = (modelText, appText) => {
    if (!modelText) return { text: appText, source: 'app' };
    const unverified = checkFigures(modelText, evidenceText, { minDigits: 1 });
    return unverified.length ? { text: appText, source: 'app', rejected: { text: modelText, unverified } } : { text: modelText, source: 'model' };
  };
  const tools = {};
  for (const id of toolIds) if (app.tools[id] || model?.tools?.[id]) tools[id] = pick(model?.tools?.[id], app.tools[id] || '');
  return { overall: pick(model?.overall, app.overall), tools };
}

/**
 * The summary for a report. useModel false (the weekly cron) = the app's text only, no model call.
 * deps: getModelsForUser, pickTextModel, callModel, logUsage (injectable for tests).
 */
async function summarize(report, { userId, useModel = false, deps = {} } = {}) {
  const app = codeSummary(report);
  const toolIds = Object.keys(app.tools);
  const asApp = (reason) => ({
    overall: { text: app.overall, source: 'app' },
    tools: Object.fromEntries(toolIds.map((id) => [id, { text: app.tools[id], source: 'app' }])),
    model: null, reason,
  });
  if (!useModel) return asApp('Written by the app (the weekly check makes no AI call).');

  const resolver = deps.getModelsForUser ? null : require('../../modelResolver');
  const getModels = deps.getModelsForUser || resolver.getModelsForUser;
  const pickModel = deps.pickTextModel || resolver.pickTextModel;
  const modelId = pickModel(await getModels(userId), 'light');
  if (!modelId) return asApp('Written by the app: no AI model is set up.');

  const evidence = buildEvidence(report);
  const evidenceText = JSON.stringify(evidence);
  let result;
  try {
    result = await (deps.callModel || require('../../callModel').callModel)(modelId, `EVIDENCE:\n${evidenceText}`, { system: SYSTEM, maxTokens: 2500, returnUsage: true, timeoutMs: 60000 });
  } catch (err) {
    return asApp(`Written by the app: the AI summary failed (${String(err.message || err).slice(0, 120)}).`);
  }
  (deps.logUsage || require('../../../utils/logUsage').logUsage)({
    userId, model: result.model || modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs: result.latencyMs, feature: FEATURE,
  });
  const parsed = parseReply(result.text);
  if (!parsed) return asApp('Written by the app: the AI reply could not be read.');
  const merged = mergeChecked({ app, model: parsed, evidenceText, toolIds });
  const parts = [merged.overall, ...Object.values(merged.tools)];
  const rejected = parts.filter((p) => p.rejected).length;
  const fromModel = parts.filter((p) => p.source === 'model').length;
  return {
    ...merged,
    model: result.model || modelId,
    reason: `Written by ${result.model || modelId}, every number checked against the evidence${rejected ? `; ${plural(rejected, 'part')} used a number not in the evidence, so the app's text is shown there` : ''}${fromModel ? '' : ' (no part passed the check)'}.`,
  };
}

module.exports = { FEATURE, SYSTEM, MAX_TOOLS, codeSummary, buildEvidence, parseReply, mergeChecked, summarize };
