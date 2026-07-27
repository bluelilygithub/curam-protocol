'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { proposeRedactionCandidates } = require('../services/documentRedaction/proposeCandidates');
const {
  loadJob,
  loadCandidates,
  loadIr,
  listJobsForUser,
  saveJob,
  deleteJob,
  deleteJobs,
  EXPORTABLE_ARTIFACTS,
} = require('../services/documentRedaction/jobStore');
const {
  patchCandidate,
  addUserCandidate,
  requestMoreSuggestions,
  decisionSummary,
} = require('../services/documentRedaction/reviewService');
const { createDownloadHandler } = require('../services/documentRedaction/exportDownload');
const { isAcceptedUpload } = require('../services/documentRedaction/ingestNormalize');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!isAcceptedUpload(file.originalname, file.mimetype)) {
      return cb(new Error(
        'Unsupported file type. Upload .docx, .doc, .pdf, .txt, .odt, .rtf, .md, .csv, .json, or .html.',
      ));
    }
    cb(null, true);
  },
});

function publicJobView(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    pdfStatus: job.pdfStatus || null,
    originalFilename: job.originalFilename,
    sourceExt: job.sourceExt || null,
    ingestConverted: job.ingestConverted || false,
    ingestNote: job.ingestNote || null,
    brief: job.brief,
    candidateCount: job.candidateCount,
    decisionSummary: job.decisionSummary,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    lastApplyAt: job.lastApplyAt,
    lastApplyPass: job.lastApplyPass || null,
    lastRedactionStyle: job.lastRedactionStyle || null,
    apply: job.apply || null,
    redactedLocalDocx: job.redactedLocalDocx || null,
    localPassDocx: job.localPassDocx || null,
    sanitizedPdf: job.sanitizedPdf || null,
    frontierApprovedAt: job.frontierApprovedAt || null,
    frontierAnalysis: job.frontierAnalysis || null,
    finalApprovedAt: job.finalApprovedAt || null,
    finalAuditTrail: job.finalAuditTrail || null,
    coherence: job.coherence
      ? { ranAt: job.coherence.ranAt, summary: job.coherence.summary, flagCount: (job.coherence.flags || []).length, error: job.coherence.error || null }
      : null,
    localModelId: job.localModelId,
    sources: job.sources,
    documentStats: job.documentStats,
  };
}

/**
 * POST /api/document-redaction/propose
 * multipart: file (.docx/.doc/.pdf/.txt/…), brief (text), optional skipLlm=1 for pattern-only debug
 */
router.post('/propose', upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'file is required (.docx, .doc, .pdf, .txt, …)' });
    }
    const brief = req.body?.brief || req.body?.context || '';
    const skipLlm = String(req.body?.skipLlm || '') === '1' || req.body?.skipLlm === true;

    const result = await proposeRedactionCandidates({
      userId: req.user.id,
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      brief,
      skipLlm,
    });

    const summary = decisionSummary(result.candidates || []);
    saveJob({ ...result.job, status: 'hitl_candidates', decisionSummary: summary });

    res.json({ ...result, job: publicJobView({ ...result.job, status: 'hitl_candidates', decisionSummary: summary }), summary });
  } catch (err) {
    console.error('[document-redaction] propose failed:', err.message);
    res.status(err.status || 500).json({
      error: err.message || 'Proposal failed',
      resolver: err.resolver || undefined,
    });
  }
});

/** GET /api/document-redaction/jobs — recent jobs for this user */
router.get('/jobs', (req, res) => {
  try {
    const jobs = listJobsForUser(req.user.id, 30).map((j) => ({
      id: j.id,
      status: j.status,
      pdfStatus: j.pdfStatus || null,
      originalFilename: j.originalFilename,
      brief: j.brief?.rawText?.slice(0, 160) || '',
      candidateCount: j.candidateCount,
      decisionSummary: j.decisionSummary,
      lastApplyAt: j.lastApplyAt,
      redactedLocalDocx: j.redactedLocalDocx || null,
      sanitizedPdf: j.sanitizedPdf || null,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
    }));
    res.json({ ok: true, jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/document-redaction/jobs/delete
 * Body: { ids: string[] } — bulk delete (named route before /:id)
 */
router.post('/jobs/delete', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const result = deleteJobs(ids, req.user.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** DELETE /api/document-redaction/jobs/:id */
router.delete('/jobs/:id', (req, res) => {
  try {
    const result = deleteJob(req.params.id, req.user.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** GET /api/document-redaction/jobs/:id */
router.get('/jobs/:id', (req, res) => {
  try {
    const job = loadJob(req.params.id, req.user.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const candidates = loadCandidates(job.id);
    const ir = loadIr(job.id);
    res.json({
      ok: true,
      job: publicJobView(job),
      candidates,
      summary: decisionSummary(candidates),
      exportableArtifacts: EXPORTABLE_ARTIFACTS,
      document: ir
        ? {
          paragraphCount: ir.paragraphCount,
          charCount: ir.charCount,
          paragraphs: (ir.paragraphs || []).map((p) => ({
            paragraphId: p.paragraphId,
            part: p.part,
            text: p.text,
          })),
        }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/document-redaction/jobs/:id/candidates/:candidateId */
router.patch('/jobs/:id/candidates/:candidateId', (req, res) => {
  try {
    const result = patchCandidate(req.params.id, req.user.id, req.params.candidateId, req.body || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** POST /api/document-redaction/jobs/:id/candidates — user-added from preview selection */
router.post('/jobs/:id/candidates', (req, res) => {
  try {
    const result = addUserCandidate(req.params.id, req.user.id, req.body || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** POST /api/document-redaction/jobs/:id/resuggest — local LLM only, with HITL feedback */
router.post('/jobs/:id/resuggest', async (req, res) => {
  try {
    const result = await requestMoreSuggestions(req.params.id, req.user.id, {
      extraBrief: req.body?.extraBrief || req.body?.note || '',
    });
    res.json(result);
  } catch (err) {
    console.error('[document-redaction] resuggest failed:', err.message);
    res.status(err.status || 500).json({
      error: err.message,
      resolver: err.resolver || undefined,
    });
  }
});

/**
 * POST /api/document-redaction/jobs/:id/apply
 * Body: { confirmApply: true, applyPass?, pendingScoreThreshold?, acceptTrackedChanges?,
 *         target?: { consumer, requirement }, strategyOverride?, skipLlm? }
 * `target` is the chain-ready apply input. Human UI maps style dropdown → target.
 */
router.post('/jobs/:id/apply', async (req, res) => {
  const cancelState = { cancelled: false };
  const onClose = () => { cancelState.cancelled = true; };
  req.on('close', onClose);
  try {
    const { applyRedactions } = require('../services/documentRedaction/applyService');
    const result = await applyRedactions(req.params.id, req.user.id, {
      ...(req.body || {}),
      cancelState,
    });
    res.json(result);
  } catch (err) {
    console.error('[document-redaction] apply failed:', err.message);
    res.status(err.status || 500).json({
      error: err.message,
      code: err.code,
      blocking: err.blocking,
      parts: err.parts,
      resolver: err.resolver || undefined,
    });
  } finally {
    req.off?.('close', onClose);
  }
});

/**
 * POST /api/document-redaction/jobs/:id/preview-substitution
 * Fast before/after sample for a style target — does not write DOCX/PDF.
 */
router.post('/jobs/:id/preview-substitution', async (req, res) => {
  try {
    const { previewSubstitution } = require('../services/documentRedaction/previewSubstitution');
    const result = await previewSubstitution(req.params.id, req.user.id, req.body || {});
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/** GET /api/document-redaction/jobs/:id/compare — aligned original vs redacted (docx), client-safe highlights */
router.get('/jobs/:id/compare', async (req, res) => {
  try {
    const { getComparePayload } = require('../services/documentRedaction/compareService');
    const result = await getComparePayload(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/** POST /api/document-redaction/jobs/:id/coherence — local LLM only */
router.post('/jobs/:id/coherence', async (req, res) => {
  try {
    const { runCoherenceCheck } = require('../services/documentRedaction/compareService');
    const result = await runCoherenceCheck(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    console.error('[document-redaction] coherence failed:', err.message);
    res.status(err.status || 500).json({
      error: err.message,
      code: err.code,
      resolver: err.resolver || undefined,
    });
  }
});

/** POST /api/document-redaction/jobs/:id/retry-pdf — convert redacted.docx only */
router.post('/jobs/:id/retry-pdf', async (req, res) => {
  try {
    const { retryPdfConversion } = require('../services/documentRedaction/compareService');
    const result = await retryPdfConversion(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    console.error('[document-redaction] retry-pdf failed:', err.message);
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/** POST /api/document-redaction/jobs/:id/fix-leftovers — targeted patch of redacted.docx from entity map */
router.post('/jobs/:id/fix-leftovers', async (req, res) => {
  try {
    const { fixLeftovers } = require('../services/documentRedaction/compareService');
    const result = await fixLeftovers(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    console.error('[document-redaction] fix-leftovers failed:', err.message);
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/**
 * POST /api/document-redaction/jobs/:id/approve-frontier
 * Body: { confirm: true }. Requires sanitized.pdf AND zero leftovers. No frontier API call — gate only.
 */
router.post('/jobs/:id/approve-frontier', async (req, res) => {
  try {
    const { approveForFrontier } = require('../services/documentRedaction/compareService');
    const confirm = req.body?.confirm === true || req.body?.confirm === 'true';
    const result = await approveForFrontier(req.params.id, req.user.id, { confirm });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      code: err.code,
      leftoverCount: err.leftoverCount,
      leftovers: err.leftovers,
    });
  }
});

/**
 * POST /api/document-redaction/jobs/:id/frontier-analyze
 * Body: { instructions?: string }
 * Sends sanitized.pdf only to the agent-card frontier model. Never original / entity map.
 */
router.post('/jobs/:id/frontier-analyze', async (req, res) => {
  try {
    const { runFrontierAnalysis } = require('../services/documentRedaction/frontierAnalysis');
    const result = await runFrontierAnalysis(req.params.id, req.user.id, {
      instructions: req.body?.instructions || req.body?.analysisInstructions || '',
    });
    res.json(result);
  } catch (err) {
    console.error('[document-redaction] frontier-analyze failed:', err.message);
    res.status(err.status || 500).json({
      error: err.message,
      code: err.code,
      hits: err.hits,
      leftoverCount: err.leftoverCount,
      resolver: err.resolver || undefined,
    });
  }
});

/**
 * POST /api/document-redaction/jobs/:id/approve-final
 * Body: { confirm: true }. Requires PDF + zero leftovers. Writes INTERNAL-ONLY audit trail.
 */
router.post('/jobs/:id/approve-final', async (req, res) => {
  try {
    const { approveFinal } = require('../services/documentRedaction/finalApproval');
    const confirm = req.body?.confirm === true || req.body?.confirm === 'true';
    const result = await approveFinal(req.params.id, req.user.id, { confirm });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      code: err.code,
      leftoverCount: err.leftoverCount,
    });
  }
});

/**
 * GET /api/document-redaction/jobs/:id/download/:artifact
 * Also catches multi-segment probes (…/download/internal/entity-map.json) → 403.
 * Served: redacted.docx | sanitized.pdf | INTERNAL-ONLY-audit-trail.json (after final approve).
 */
const downloadHandler = createDownloadHandler();
router.get('/jobs/:id/download/:artifact', downloadHandler);
router.get('/jobs/:id/download/*', (req, res) => {
  req.params.artifact = req.params[0];
  return downloadHandler(req, res);
});

module.exports = router;
