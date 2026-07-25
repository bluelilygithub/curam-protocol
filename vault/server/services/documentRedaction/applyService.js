'use strict';

/**
 * Milestone 3 (+6) — apply approved redactions via one shared pipeline.
 * applyPass=local  → original.docx → redacted.docx (+ local-pass snapshot)
 * applyPass=frontier → redacted.docx base → update redacted + merge entity map
 */

const crypto = require('crypto');
const {
  loadJob,
  saveJob,
  loadCandidates,
  loadOriginalDocx,
  loadRedactedDocx,
  loadIr,
  loadEntityMap,
  saveEntityMap,
  saveRedactedDocx,
  saveLocalPassDocx,
  hasLocalPassDocx,
  saveSanitizedPdf,
  appendAudit,
} = require('./jobStore');
const { findOccurrences, parseDocxBuffer } = require('./docxParse');
const { entityKeyFor } = require('./mergeCandidates');
const { resolveDocumentRedactionModels } = require('../documentRedactionModelResolver');
const { generateSyntheticReplacements } = require('./syntheticReplacements');
const { applyReplacementsToDocx } = require('./applyDocx');
const { exportSanitizedPdf } = require('./pdfExport');
const { decisionSummary } = require('./reviewService');
const { assertReadyToApply, DEFAULT_PENDING_SCORE_THRESHOLD } = require('./applyGate');

function buildEntityMapEntries(approved, syntheticByKey, appliedPass) {
  return approved.map((c) => {
    const realValue = c.entityText || c.surfaceForms?.[0] || '';
    const entityKey = c.entityKey || entityKeyFor(realValue, c.categoryLabel);
    const syntheticValue = syntheticByKey.get(entityKey)
      || c.userReplacement
      || c.suggestedReplacement
      || realValue;
    return {
      id: crypto.randomUUID(),
      entityKey,
      realValue,
      syntheticValue,
      categoryLabel: c.categoryLabel,
      occurrenceCount: c.occurrenceCount || c.locations?.length || 0,
      candidateIds: [c.id],
      surfaceForms: c.surfaceForms || [realValue],
      decision: c.decision,
      appliedPass: appliedPass === 'frontier' ? 'frontier' : 'local',
      source: c.source || null,
    };
  });
}

function mergeEntityMapEntries(existingEntries, incoming) {
  const byKey = new Map();
  for (const e of existingEntries || []) {
    if (e?.entityKey) byKey.set(e.entityKey, e);
  }
  for (const e of incoming || []) {
    const prev = byKey.get(e.entityKey);
    if (prev) {
      byKey.set(e.entityKey, {
        ...prev,
        ...e,
        candidateIds: [...new Set([...(prev.candidateIds || []), ...(e.candidateIds || [])])],
        id: prev.id || e.id,
      });
    } else {
      byKey.set(e.entityKey, e);
    }
  }
  return [...byKey.values()];
}

function collectReplacementOps(approved, entityMapEntries, ir) {
  const byKey = new Map(entityMapEntries.map((e) => [e.entityKey, e]));
  const ops = [];

  for (const c of approved) {
    const realValue = c.entityText || c.surfaceForms?.[0] || '';
    const entityKey = c.entityKey || entityKeyFor(realValue, c.categoryLabel);
    const entry = byKey.get(entityKey);
    if (!entry) continue;
    const synthetic = entry.syntheticValue;

    let locations = Array.isArray(c.locations) ? [...c.locations] : [];
    if ((!locations.length || locations.length < (c.occurrenceCount || 0)) && ir) {
      const forms = new Set([...(c.surfaceForms || []), realValue].filter(Boolean));
      for (const form of forms) {
        for (const loc of findOccurrences(ir, form)) {
          locations.push(loc);
        }
      }
    }

    const seen = new Set();
    for (const loc of locations) {
      const key = `${loc.paragraphId}|${loc.startOffset}|${loc.endOffset}|${loc.quote || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ops.push({
        paragraphId: loc.paragraphId,
        xmlPath: loc.xmlPath,
        part: loc.part,
        startOffset: loc.startOffset,
        endOffset: loc.endOffset,
        quote: loc.quote || realValue,
        synthetic,
        entityKey,
      });
    }
  }

  return ops;
}

/**
 * Apply approved redactions for a job.
 * @param {{ confirmApply?: boolean, applyPass?: 'local'|'frontier', pendingScoreThreshold?: number, acceptTrackedChanges?: boolean }} opts
 */
async function applyRedactions(jobId, userId, opts = {}) {
  const job = loadJob(jobId, userId);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }

  const applyPass = opts.applyPass === 'frontier' ? 'frontier' : 'local';
  const candidates = loadCandidates(jobId);
  const gate = assertReadyToApply(candidates, {
    confirmApply: opts.confirmApply === true || opts.confirmApply === 'true' || opts.confirmApply === 1,
    pendingScoreThreshold: opts.pendingScoreThreshold != null
      ? Number(opts.pendingScoreThreshold)
      : DEFAULT_PENDING_SCORE_THRESHOLD,
    applyPass,
  });

  let baseBuf;
  let ir;
  if (applyPass === 'frontier') {
    baseBuf = loadRedactedDocx(jobId);
    if (!baseBuf) {
      const err = new Error('No redacted.docx yet — complete the local apply pass first');
      err.status = 400;
      err.code = 'NOT_APPLIED';
      throw err;
    }
    // Freeze local-pass snapshot before first frontier write
    if (!hasLocalPassDocx(jobId)) {
      saveLocalPassDocx(jobId, baseBuf);
    }
    ir = await parseDocxBuffer(baseBuf);
  } else {
    baseBuf = loadOriginalDocx(jobId);
    if (!baseBuf) {
      const err = new Error('Original .docx missing for this job');
      err.status = 400;
      throw err;
    }
    ir = loadIr(jobId);
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

  saveJob({
    ...job,
    status: applyPass === 'frontier' ? 'applying_frontier' : 'applying_local',
  });

  const priorMap = applyPass === 'frontier' ? loadEntityMap(jobId) : null;
  const priorByKey = new Map((priorMap?.entries || []).map((e) => [e.entityKey, e]));

  const entities = gate.approved.map((c) => {
    const realValue = c.entityText || c.surfaceForms?.[0] || '';
    const entityKey = c.entityKey || entityKeyFor(realValue, c.categoryLabel);
    const prior = priorByKey.get(entityKey);
    // Prefer user edits; then prior map synthetic; then suggested
    const seed = c.userReplacement
      || prior?.syntheticValue
      || c.suggestedReplacement
      || '';
    return {
      entityKey,
      realValue,
      categoryLabel: c.categoryLabel,
      seedReplacement: seed,
      userLocked: Boolean(c.userReplacement) || c.decision === 'edited' || Boolean(prior?.syntheticValue && applyPass === 'frontier' && c.suggestedReplacement === prior.syntheticValue),
    };
  });

  // For frontier: lock seeds that already have a suggestedReplacement from the model
  for (const e of entities) {
    const c = gate.approved.find((x) => (x.entityKey || entityKeyFor(x.entityText, x.categoryLabel)) === e.entityKey);
    if (applyPass === 'frontier' && c && (c.userReplacement || c.suggestedReplacement)) {
      e.userLocked = true;
      e.seedReplacement = c.userReplacement || c.suggestedReplacement;
    }
  }

  const syn = await generateSyntheticReplacements({
    modelId: resolved.local.modelId,
    entities,
    // Chain-ready input: callers (UI later, agents later) supply target — not a bare style string.
    // Default remains realistic / human-review when omitted.
    target: opts.target || undefined,
    strategyOverride: opts.strategyOverride || undefined,
  });

  const newEntries = buildEntityMapEntries(gate.approved, syn.map, applyPass);
  let entityMapEntries;
  if (applyPass === 'frontier') {
    entityMapEntries = mergeEntityMapEntries(priorMap?.entries || [], newEntries);
  } else {
    entityMapEntries = newEntries;
  }

  const entityMap = {
    kind: 'entity_map_v1',
    jobId,
    createdAt: priorMap?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    localModelId: resolved.local.modelId,
    lastApplyPass: applyPass,
    entries: entityMapEntries,
  };
  saveEntityMap(jobId, entityMap);

  // Ops only for this pass's approved set (newEntries keys)
  const ops = collectReplacementOps(gate.approved, newEntries, ir);
  const acceptTrackedChanges = opts.acceptTrackedChanges === true
    || opts.acceptTrackedChanges === 'true'
    || opts.acceptTrackedChanges === 1;

  let redactedBuf;
  let metadataReport;
  let paragraphsTouched;
  try {
    ({ buffer: redactedBuf, metadataReport, paragraphsTouched } = await applyReplacementsToDocx(
      baseBuf,
      ops,
      { acceptTrackedChanges },
    ));
  } catch (err) {
    if (err.code === 'TRACKED_CHANGES') {
      saveJob({
        ...loadJob(jobId, userId),
        status: applyPass === 'frontier' ? 'hitl_frontier' : 'hitl_candidates',
        lastApplyError: {
          code: 'TRACKED_CHANGES',
          message: err.message,
          parts: err.parts || [],
        },
      });
      appendAudit(jobId, {
        type: 'redaction_apply_blocked',
        reason: 'TRACKED_CHANGES',
        applyPass,
        parts: err.parts || [],
      });
    }
    throw err;
  }

  saveRedactedDocx(jobId, redactedBuf);
  if (applyPass === 'local') {
    // Refresh local-pass snapshot to match this local apply
    saveLocalPassDocx(jobId, redactedBuf);
  }

  const pdfResult = await exportSanitizedPdf(redactedBuf);
  const pdfOk = Boolean(pdfResult.buffer);
  if (pdfOk) saveSanitizedPdf(jobId, pdfResult.buffer);

  const pdfStatus = pdfOk ? 'ready' : 'pending';
  let jobStatus;
  if (applyPass === 'frontier') {
    jobStatus = pdfOk ? 'ready_for_final' : 'docx_ready_pdf_pending';
  } else {
    jobStatus = pdfOk ? 'pdf_ready' : 'docx_ready_pdf_pending';
  }

  const summary = decisionSummary(candidates);
  const auditEvent = {
    type: applyPass === 'frontier' ? 'redaction_apply_frontier' : 'redaction_apply',
    jobId,
    applyPass,
    baseDocument: applyPass === 'frontier' ? 'redacted.docx' : 'original.docx',
    candidatesApplied: gate.approved.length,
    candidatesRejected: gate.rejected.length,
    candidatesPendingSkipped: gate.pendingLow.length,
    pendingScoreThreshold: gate.pendingScoreThreshold,
    replacementsWritten: ops.length,
    paragraphsTouched,
    metadataFieldsScrubbed: metadataReport.stripped || [],
    metadataFound: (metadataReport.found || []).map((f) => ({
      field: f.field,
      part: f.part,
      value: f.value,
    })),
    trackedChangesAccepted: Boolean(metadataReport.trackedChangesAccepted),
    pdfStatus,
    pdfExported: pdfOk,
    pdfError: pdfResult.error,
    localModelId: resolved.local.modelId,
    syntheticErrors: syn.errors || [],
    entityMapEntryCount: entityMapEntries.length,
    substitution: {
      target: syn.plan?.target || null,
      strategyId: syn.plan?.strategyId || null,
      arithmeticConsistent: syn.plan?.arithmeticConsistent || false,
      arithmetic: syn.arithmetic || null,
    },
  };
  appendAudit(jobId, auditEvent);

  const updated = saveJob({
    ...loadJob(jobId, userId),
    status: jobStatus,
    pdfStatus,
    redactedLocalDocx: 'redacted.docx',
    localPassDocx: 'local-pass.docx',
    substitutionPlan: syn.plan || null,
    substitutionArithmetic: syn.arithmetic || null,
    sanitizedPdf: pdfOk ? 'sanitized.pdf' : null,
    frontierApprovedAt: null,
    frontierApprovedPdfSha256: null,
    finalApprovedAt: null,
    lastApplyAt: new Date().toISOString(),
    lastApplyPass: applyPass,
    lastApplyError: null,
    apply: {
      applyPass,
      candidatesApplied: gate.approved.length,
      candidatesRejected: gate.rejected.length,
      replacementsWritten: ops.length,
      paragraphsTouched,
      pdfStatus,
      pdfExported: pdfOk,
      pdfError: pdfResult.error || null,
      trackedChangesAccepted: Boolean(metadataReport.trackedChangesAccepted),
      localModelId: resolved.local.modelId,
    },
    decisionSummary: summary,
  });

  return {
    ok: true,
    pdfStatus,
    applyPass,
    job: {
      id: updated.id,
      status: updated.status,
      pdfStatus: updated.pdfStatus,
      lastApplyAt: updated.lastApplyAt,
      lastApplyPass: updated.lastApplyPass,
      apply: updated.apply,
      decisionSummary: summary,
      redactedLocalDocx: updated.redactedLocalDocx,
      localPassDocx: updated.localPassDocx,
      sanitizedPdf: updated.sanitizedPdf,
      finalApprovedAt: null,
    },
    artifacts: {
      redactedDocx: 'redacted.docx',
      localPassDocx: 'local-pass.docx',
      sanitizedPdf: pdfOk ? 'sanitized.pdf' : null,
      downloadBase: `/api/document-redaction/jobs/${jobId}/download`,
    },
    metadataScrub: {
      stripped: metadataReport.stripped || [],
      removedParts: metadataReport.removedParts || [],
      trackedChangesAccepted: metadataReport.trackedChangesAccepted,
      foundFields: (metadataReport.found || []).map((f) => ({
        field: f.field,
        part: f.part,
        hadValue: Boolean(f.value),
      })),
    },
    pdfMetaScrub: pdfResult.pdfMetaScrub
      ? { stripped: pdfResult.pdfMetaScrub.stripped }
      : null,
    pdfError: pdfResult.error,
    warning: pdfOk
      ? null
      : `DOCX written, but PDF conversion failed (${pdfResult.error || 'LibreOffice unavailable'}). `
        + 'Job status is docx_ready_pdf_pending — frontier / final steps need PDF when required.',
    stats: {
      applyPass,
      candidatesApplied: gate.approved.length,
      candidatesRejected: gate.rejected.length,
      candidatesPendingSkipped: gate.pendingLow.length,
      replacementsWritten: ops.length,
      paragraphsTouched,
      entityMapEntries: entityMapEntries.length,
      entityMapStoredInternally: true,
      pdfStatus,
    },
    synthetic: {
      modelId: resolved.local.modelId,
      errors: syn.errors || [],
    },
  };
}

module.exports = {
  applyRedactions,
  assertReadyToApply,
  DEFAULT_PENDING_SCORE_THRESHOLD,
  mergeEntityMapEntries,
  buildEntityMapEntries,
};
