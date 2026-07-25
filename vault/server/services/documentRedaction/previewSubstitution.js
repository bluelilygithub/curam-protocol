'use strict';

/**
 * Sample before/after preview for a substitution target — does not write DOCX/PDF.
 * Uses heuristics only (no LLM) so preview stays interactive.
 */

const { loadJob, loadCandidates, loadIr } = require('./jobStore');
const { entityKeyFor } = require('./mergeCandidates');
const { generateSubstitutions, UI_STYLE_TO_TARGET, listStrategies } = require('./substitution');

function throwIfCancelled(cancelState) {
  if (cancelState?.cancelled) {
    const err = new Error('Cancelled');
    err.status = 499;
    err.code = 'CANCELLED';
    throw err;
  }
}

/**
 * Apply map replacements to a plain text string (longest-first to avoid partial overlaps).
 */
function applyMapToText(text, entries) {
  let out = String(text || '');
  const sorted = [...entries].sort((a, b) => String(b.realValue).length - String(a.realValue).length);
  for (const e of sorted) {
    if (!e.realValue || e.realValue === e.syntheticValue) continue;
    out = out.split(e.realValue).join(e.syntheticValue);
  }
  return out;
}

/**
 * @param {string} jobId
 * @param {number|string} userId
 * @param {object} opts
 * @param {{ consumer: string, requirement: string }} [opts.target]
 * @param {string} [opts.strategyOverride]
 * @param {string} [opts.applyPass]
 * @param {object} [opts.cancelState]
 */
async function previewSubstitution(jobId, userId, opts = {}) {
  throwIfCancelled(opts.cancelState);
  const job = loadJob(jobId, userId);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }
  const ir = loadIr(jobId);
  if (!ir) {
    const err = new Error('Document IR missing');
    err.status = 400;
    throw err;
  }
  const candidates = loadCandidates(jobId);
  const applyPass = opts.applyPass === 'frontier' ? 'frontier' : 'local';
  // Soft gate: allow preview even with pending highs, but only use approved
  const approved = (candidates || []).filter((c) => {
    const isFrontier = c.source === 'frontier_suggested' || c.sourceLabel === 'frontier';
    if (applyPass === 'frontier' ? !isFrontier : isFrontier) return false;
    return c.decision === 'approved' || c.decision === 'edited';
  });
  if (!approved.length) {
    const err = new Error('Approve at least one candidate to preview substitution style');
    err.status = 400;
    throw err;
  }

  const sample = approved.slice(0, Math.min(12, approved.length));
  const entities = sample.map((c) => {
    const realValue = c.entityText || c.surfaceForms?.[0] || '';
    return {
      entityKey: c.entityKey || entityKeyFor(realValue, c.categoryLabel),
      realValue,
      categoryLabel: c.categoryLabel,
      seedReplacement: c.userReplacement || c.suggestedReplacement || '',
      userLocked: Boolean(c.userReplacement) || c.decision === 'edited',
    };
  });

  throwIfCancelled(opts.cancelState);
  const syn = await generateSubstitutions({
    modelId: null, // preview always fast — heuristics / strategy only
    entities,
    target: opts.target,
    strategyOverride: opts.strategyOverride,
  });

  const pairs = entities.map((e) => ({
    entityKey: e.entityKey,
    realValue: e.realValue,
    categoryLabel: e.categoryLabel,
    syntheticValue: syn.map.get(e.entityKey) || e.seedReplacement || '—',
  }));

  // Pick the paragraph that contains the most sample real values
  let bestPara = null;
  let bestHits = 0;
  for (const p of ir.paragraphs || []) {
    const text = p.text || '';
    let hits = 0;
    for (const e of pairs) {
      if (e.realValue && text.includes(e.realValue)) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestPara = p;
    }
  }
  if (!bestPara && (ir.paragraphs || []).length) {
    bestPara = ir.paragraphs[0];
  }

  const before = bestPara?.text || '';
  const after = applyMapToText(before, pairs);
  const clipped = (s) => {
    const t = String(s || '');
    if (t.length <= 900) return t;
    return `${t.slice(0, 900)}…`;
  };

  return {
    ok: true,
    plan: syn.plan,
    arithmetic: syn.arithmetic,
    styleOptions: UI_STYLE_TO_TARGET,
    strategies: listStrategies(),
    samplePairs: pairs,
    preview: {
      paragraphId: bestPara?.paragraphId || null,
      hitCount: bestHits,
      before: clipped(before),
      after: clipped(after),
    },
    note: 'Preview uses fast heuristics (no LLM). Full apply may still call the local model if you enable higher-quality realistic mode.',
  };
}

module.exports = {
  previewSubstitution,
  applyMapToText,
};
