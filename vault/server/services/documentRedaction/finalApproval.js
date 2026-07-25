'use strict';

/**
 * Milestone 6 — final HITL₄ approval + INTERNAL-ONLY audit trail export.
 */

const {
  loadJob,
  saveJob,
  loadCandidates,
  loadEntityMap,
  loadAuditEvents,
  saveAuditTrailExport,
  hasSanitizedPdf,
  hasLocalPassDocx,
  loadRedactedDocx,
  appendAudit,
  hashSanitizedPdf,
} = require('./jobStore');
const { parseDocxBuffer } = require('./docxParse');
const { scanLeftoversInParagraphs } = require('./compareService');

async function approveFinal(jobId, userId, opts = {}) {
  const job = loadJob(jobId, userId);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }

  if (!(opts.confirm === true || opts.confirm === 'true' || opts.confirm === 1)) {
    const err = new Error('confirm must be true to approve the final document');
    err.status = 400;
    err.code = 'CONFIRM_REQUIRED';
    throw err;
  }

  if (!loadRedactedDocx(jobId)) {
    const err = new Error('No redacted.docx — apply redactions first');
    err.status = 400;
    err.code = 'NOT_APPLIED';
    throw err;
  }

  if (!hasSanitizedPdf(jobId)) {
    const err = new Error(
      'Cannot final-approve without sanitized.pdf. Retry PDF conversion first.',
    );
    err.status = 409;
    err.code = 'PDF_REQUIRED';
    throw err;
  }

  const entityMap = loadEntityMap(jobId);
  const redactedBuf = loadRedactedDocx(jobId);
  const ir = await parseDocxBuffer(redactedBuf);
  const leftovers = scanLeftoversInParagraphs(ir.paragraphs || [], entityMap);
  if (leftovers.length) {
    const err = new Error(
      `Cannot final-approve: ${leftovers.length} leftover real value(s) still in redacted.docx`,
    );
    err.status = 409;
    err.code = 'UNRESOLVED_LEFTOVERS';
    err.leftoverCount = leftovers.length;
    throw err;
  }

  const candidates = loadCandidates(jobId);
  const auditEvents = loadAuditEvents(jobId);
  const pdfSha256 = hashSanitizedPdf(jobId);
  const now = new Date().toISOString();

  const report = {
    label: 'INTERNAL-ONLY',
    warning:
      'This audit trail may contain original (real) entity values, decisions, and internal '
      + 'job metadata. Do not share outside the trusted local boundary. It is not a sanitized export.',
    kind: 'document_redaction_audit_trail_v1',
    generatedAt: now,
    job: {
      id: job.id,
      originalFilename: job.originalFilename,
      brief: job.brief,
      status: 'completed',
      createdAt: job.createdAt,
      lastApplyAt: job.lastApplyAt,
      lastApplyPass: job.lastApplyPass || null,
      frontierApprovedAt: job.frontierApprovedAt || null,
      frontierAnalysis: job.frontierAnalysis || null,
      localCompareApprovedAt: job.localCompareApprovedAt || null,
      finalApprovedAt: now,
      pdfSha256,
      hasLocalPassSnapshot: hasLocalPassDocx(jobId),
    },
    decisionSummary: job.decisionSummary || null,
    candidates: (candidates || []).map((c) => ({
      id: c.id,
      source: c.source,
      sourceLabel: c.sourceLabel,
      categoryLabel: c.categoryLabel,
      entityText: c.entityText,
      surfaceForms: c.surfaceForms,
      confidence: c.confidence,
      score: c.score,
      suggestedReplacement: c.suggestedReplacement,
      userReplacement: c.userReplacement || null,
      decision: c.decision,
      rationale: c.rationale || null,
      occurrenceCount: c.occurrenceCount,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      decidedAt: c.decidedAt || c.updatedAt || null,
    })),
    entityMap: entityMap
      ? {
          kind: entityMap.kind,
          createdAt: entityMap.createdAt,
          updatedAt: entityMap.updatedAt,
          lastApplyPass: entityMap.lastApplyPass,
          entries: entityMap.entries || [],
        }
      : null,
    auditEvents,
    exports: {
      finishedDocx: 'redacted.docx',
      finishedPdf: 'sanitized.pdf',
      auditTrail: 'INTERNAL-ONLY-audit-trail.json',
      note: 'redacted.docx and sanitized.pdf are the finished sanitized artifacts; this JSON is internal-only.',
    },
  };

  saveAuditTrailExport(jobId, report);

  const updated = saveJob({
    ...loadJob(jobId, userId),
    status: 'completed',
    pdfStatus: 'ready',
    sanitizedPdf: 'sanitized.pdf',
    redactedLocalDocx: 'redacted.docx',
    finalApprovedAt: now,
    finalAuditTrail: 'INTERNAL-ONLY-audit-trail.json',
  });

  appendAudit(jobId, {
    type: 'final_approved',
    approvedAt: now,
    pdfSha256,
    candidateCount: (candidates || []).length,
    entityMapEntries: entityMap?.entries?.length || 0,
    auditEventCount: auditEvents.length,
  });

  return {
    ok: true,
    approvedAt: now,
    job: {
      id: updated.id,
      status: updated.status,
      pdfStatus: updated.pdfStatus,
      finalApprovedAt: updated.finalApprovedAt,
      finalAuditTrail: updated.finalAuditTrail,
      redactedLocalDocx: updated.redactedLocalDocx,
      sanitizedPdf: updated.sanitizedPdf,
    },
    exports: {
      redactedDocx: 'redacted.docx',
      sanitizedPdf: 'sanitized.pdf',
      auditTrail: 'INTERNAL-ONLY-audit-trail.json',
      auditTrailLabel: 'INTERNAL-ONLY — may contain original values',
      downloadBase: `/api/document-redaction/jobs/${jobId}/download`,
    },
  };
}

module.exports = {
  approveFinal,
};
