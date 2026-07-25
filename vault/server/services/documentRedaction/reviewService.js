'use strict';

/**
 * HITL review operations — decisions persist on disk with the job.
 */

const crypto = require('crypto');
const { loadJob, saveJob, loadCandidates, saveCandidates, loadIr, appendAudit } = require('./jobStore');
const { findOccurrences, locateInParagraph } = require('./docxParse');
const { extractLlmCandidates } = require('./llmCandidates');
const { mergeAndDeduplicateCandidates, expandOccurrencesWithIr, entityKeyFor, normalizeEntity } = require('./mergeCandidates');
const { resolveDocumentRedactionModels } = require('../documentRedactionModelResolver');
const { normalizeCategoryLabel } = require('./categories');

function decisionSummary(candidates) {
  const list = candidates || [];
  return {
    total: list.length,
    approved: list.filter((c) => c.decision === 'approved' || c.decision === 'edited').length,
    rejected: list.filter((c) => c.decision === 'rejected').length,
    pending: list.filter((c) => !c.decision || c.decision === 'pending').length,
  };
}

function requireJob(jobId, userId) {
  const job = loadJob(jobId, userId);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }
  return job;
}

function patchCandidate(jobId, userId, candidateId, patch = {}) {
  requireJob(jobId, userId);
  const candidates = loadCandidates(jobId);
  const idx = candidates.findIndex((c) => c.id === candidateId);
  if (idx < 0) {
    const err = new Error('Candidate not found');
    err.status = 404;
    throw err;
  }

  const prev = candidates[idx];
  const next = { ...prev, updatedAt: new Date().toISOString() };

  if (patch.decision != null) {
    const d = String(patch.decision).trim();
    if (!['pending', 'approved', 'rejected', 'edited'].includes(d)) {
      const err = new Error('decision must be pending|approved|rejected|edited');
      err.status = 400;
      throw err;
    }
    next.decision = d;
    next.decisionAt = new Date().toISOString();
    next.decidedBy = 'user';
  }

  if (patch.suggestedReplacement != null) {
    next.suggestedReplacement = String(patch.suggestedReplacement).trim();
    next.userReplacement = next.suggestedReplacement;
    if (next.decision === 'pending' || next.decision === 'approved') {
      next.decision = 'edited';
      next.decisionAt = new Date().toISOString();
      next.decidedBy = 'user';
    }
  }

  if (patch.categoryLabel != null) {
    const cat = normalizeCategoryLabel(patch.categoryLabel);
    if (!cat) {
      const err = new Error('categoryLabel cannot be empty');
      err.status = 400;
      throw err;
    }
    next.categoryLabel = cat;
    const primary = (next.surfaceForms && next.surfaceForms[0]) || next.entityText || '';
    next.entityKey = entityKeyFor(primary);
  }

  if (patch.rationale != null) {
    next.rationale = String(patch.rationale).trim();
  }

  candidates[idx] = next;
  saveCandidates(jobId, candidates);
  const summary = decisionSummary(candidates);
  saveJob({ ...loadJob(jobId, userId), status: 'hitl_candidates', decisionSummary: summary });
  appendAudit(jobId, {
    type: 'candidate_decision',
    candidateId: next.id,
    decision: next.decision,
    categoryLabel: next.categoryLabel,
    entityKey: next.entityKey,
    // real entity text stays in internal audit only
    entityText: next.entityText,
    suggestedReplacement: next.userReplacement || next.suggestedReplacement,
  });
  return { candidate: next, summary, candidates };
}

function addUserCandidate(jobId, userId, body = {}) {
  requireJob(jobId, userId);
  const ir = loadIr(jobId);
  if (!ir) {
    const err = new Error('Document IR missing for this job');
    err.status = 400;
    throw err;
  }

  const entityText = String(body.entityText || '').trim();
  if (!entityText) {
    const err = new Error('entityText is required');
    err.status = 400;
    throw err;
  }

  const categoryLabel = normalizeCategoryLabel(body.categoryLabel || 'user_added');
  const suggestedReplacement = String(body.suggestedReplacement || `REDACTED_${entityText.slice(0, 12)}`).trim();
  const paragraphId = body.paragraphId ? String(body.paragraphId).trim() : null;

  let locations = [];
  if (paragraphId && Number.isFinite(Number(body.startOffset)) && Number.isFinite(Number(body.endOffset))) {
    const p = (ir.paragraphs || []).find((x) => x.paragraphId === paragraphId);
    if (!p) {
      const err = new Error('paragraphId not found in document');
      err.status = 400;
      throw err;
    }
    const start = Number(body.startOffset);
    const end = Number(body.endOffset);
    locations = [locateInParagraph(p, start, end, entityText)];
  } else {
    locations = findOccurrences(ir, entityText);
  }

  if (!locations.length) {
    const err = new Error('Could not locate that text in the document');
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const candidate = {
    id: crypto.randomUUID(),
    jobId,
    source: 'user_added',
    sourceLabel: 'user-added-later',
    categoryLabel,
    entityKey: entityKeyFor(entityText, categoryLabel),
    entityText,
    surfaceForms: [entityText],
    locations,
    occurrenceCount: locations.length,
    confidence: 1,
    score: 1,
    scoreBreakdown: { user: 1 },
    suggestedReplacement,
    userReplacement: suggestedReplacement,
    decision: 'approved',
    decisionAt: now,
    decidedBy: 'user',
    rationale: String(body.rationale || 'Manually added from document preview').trim(),
    createdAt: now,
    updatedAt: now,
  };

  let candidates = loadCandidates(jobId);
  candidates = mergeAndDeduplicateCandidates([...candidates, candidate], jobId);
  candidates = expandOccurrencesWithIr(candidates, ir, findOccurrences);

  // Preserve approval on the user-added entity
  candidates = candidates.map((c) => {
    if (normalizeEntity(c.entityText || c.surfaceForms?.[0]) === normalizeEntity(entityText)
      && String(c.categoryLabel).toLowerCase() === categoryLabel.toLowerCase()) {
      return {
        ...c,
        decision: c.decision === 'rejected' ? 'rejected' : 'approved',
        decisionAt: now,
        decidedBy: 'user',
        source: c.source === 'user_added' ? 'user_added' : c.source,
        suggestedReplacement: c.userReplacement || suggestedReplacement,
      };
    }
    return c;
  });

  saveCandidates(jobId, candidates);
  saveJob({ ...loadJob(jobId, userId), status: 'hitl_candidates', decisionSummary: decisionSummary(candidates) });
  appendAudit(jobId, {
    type: 'candidate_added',
    candidateId: candidate.id,
    categoryLabel: candidate.categoryLabel,
    entityKey: candidate.entityKey,
    entityText: candidate.entityText,
    suggestedReplacement: candidate.suggestedReplacement,
  });
  return { candidate, summary: decisionSummary(candidates), candidates };
}

function buildFeedbackContext(candidates) {
  const approved = (candidates || []).filter((c) => c.decision === 'approved' || c.decision === 'edited');
  const rejected = (candidates || []).filter((c) => c.decision === 'rejected');

  const rejectedCategories = [...new Set(rejected.map((c) => c.categoryLabel).filter(Boolean))];
  const approvedCategories = [...new Set(approved.map((c) => c.categoryLabel).filter(Boolean))];

  const lines = [
    'HITL feedback from the reviewer (honour this strictly):',
    `- Approved entities (keep / prefer similar): ${approved.slice(0, 40).map((c) => `"${c.entityText || c.surfaceForms?.[0]}" [${c.categoryLabel}]`).join('; ') || '(none)'}`,
    `- Rejected entities (do NOT suggest these or near-duplicates again): ${rejected.slice(0, 40).map((c) => `"${c.entityText || c.surfaceForms?.[0]}" [${c.categoryLabel}]`).join('; ') || '(none)'}`,
  ];

  if (rejectedCategories.length) {
    const fullyRejectedCats = rejectedCategories.filter((cat) => {
      const inCat = (candidates || []).filter((c) => c.categoryLabel === cat);
      return inCat.length > 0 && inCat.every((c) => c.decision === 'rejected');
    });
    if (fullyRejectedCats.length) {
      lines.push(
        `- Categories fully rejected — do not propose more of these unless the user explicitly asks: ${fullyRejectedCats.join(', ')}`,
      );
    }
  }
  if (approvedCategories.length) {
    lines.push(`- Categories the reviewer cares about: ${approvedCategories.join(', ')}`);
  }
  lines.push('- Prefer gaps the reviewer has not covered yet that still match the original brief.');
  return lines.join('\n');
}

/**
 * Re-run local LLM with HITL feedback; merge new suggestions without wiping decisions.
 */
async function requestMoreSuggestions(jobId, userId, { extraBrief } = {}) {
  const job = requireJob(jobId, userId);
  const ir = loadIr(jobId);
  if (!ir) {
    const err = new Error('Document IR missing for this job');
    err.status = 400;
    throw err;
  }

  const resolved = await resolveDocumentRedactionModels({ userId, jobId });
  if (!resolved.ok || !resolved.local?.modelId) {
    const err = new Error(
      resolved.errors?.join('; ')
      || 'Local model not configured for document redaction',
    );
    err.status = 400;
    err.resolver = resolved;
    throw err;
  }

  const existing = loadCandidates(jobId);
  const feedback = buildFeedbackContext(existing);
  const baseBrief = job.brief?.rawText || '';
  const brief = [
    baseBrief,
    '',
    feedback,
    extraBrief ? `\nAdditional reviewer note:\n${extraBrief}` : '',
  ].filter(Boolean).join('\n');

  const rejectedKeys = new Set(
    existing
      .filter((c) => c.decision === 'rejected')
      .map((c) => c.entityKey || entityKeyFor(c.entityText || c.surfaceForms?.[0], c.categoryLabel)),
  );
  const fullyRejectedCats = [...new Set(
    existing
      .map((c) => c.categoryLabel)
      .filter(Boolean)
      .filter((cat) => {
        const inCat = existing.filter((c) => c.categoryLabel === cat);
        return inCat.length > 0 && inCat.every((c) => c.decision === 'rejected');
      }),
  )];

  const llmMeta = await extractLlmCandidates({
    ir,
    brief,
    modelId: resolved.local.modelId,
    jobId,
  });

  let fresh = (llmMeta.candidates || []).filter((c) => {
    const key = entityKeyFor(c.surfaceForms?.[0] || c.entityText, c.categoryLabel);
    if (rejectedKeys.has(key)) return false;
    if (fullyRejectedCats.includes(c.categoryLabel)) return false;
    return true;
  });

  // Snapshot decisions before merge
  const decisionByKey = new Map();
  for (const c of existing) {
    const key = c.entityKey || entityKeyFor(c.entityText || c.surfaceForms?.[0], c.categoryLabel);
    decisionByKey.set(key, {
      decision: c.decision,
      decisionAt: c.decisionAt,
      decidedBy: c.decidedBy,
      userReplacement: c.userReplacement,
      suggestedReplacement: c.suggestedReplacement,
      rationale: c.rationale,
    });
  }

  let merged = mergeAndDeduplicateCandidates([...existing, ...fresh], jobId);
  merged = expandOccurrencesWithIr(merged, ir, findOccurrences);

  merged = merged.map((c) => {
    const key = c.entityKey || entityKeyFor(c.entityText || c.surfaceForms?.[0], c.categoryLabel);
    const prev = decisionByKey.get(key);
    if (!prev) return c;
    return {
      ...c,
      decision: prev.decision || c.decision,
      decisionAt: prev.decisionAt || c.decisionAt,
      decidedBy: prev.decidedBy || c.decidedBy,
      userReplacement: prev.userReplacement || c.userReplacement,
      suggestedReplacement: prev.userReplacement || prev.suggestedReplacement || c.suggestedReplacement,
      rationale: c.rationale || prev.rationale,
    };
  });

  saveCandidates(jobId, merged);
  const summary = decisionSummary(merged);
  saveJob({
    ...job,
    status: 'hitl_candidates',
    decisionSummary: summary,
    lastResuggestAt: new Date().toISOString(),
    llm: {
      ...(job.llm || {}),
      lastResuggestModelId: resolved.local.modelId,
      lastResuggestErrors: llmMeta.errors || [],
      lastResuggestNewRaw: fresh.length,
    },
  });

  console.log('[document-redaction] Request more suggestions', JSON.stringify({
    jobId,
    newRaw: fresh.length,
    merged: merged.length,
    summary,
  }));

  return {
    ok: true,
    candidates: merged,
    summary,
    addedFromLlm: fresh.length,
    llm: { modelId: resolved.local.modelId, errors: llmMeta.errors || [] },
  };
}

module.exports = {
  decisionSummary,
  patchCandidate,
  addUserCandidate,
  requestMoreSuggestions,
  buildFeedbackContext,
};
