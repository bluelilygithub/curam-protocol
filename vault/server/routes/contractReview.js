'use strict';

// Contract Review API (docs/contract-review-spec.md). Mounted at
// /api/contract-review in server/index.js, behind requireFeature('contractReview').
// All reads/writes go through ContractService — no ad-hoc "WHERE userId=..."
// here, per the spec's single-choke-point access rule.

const express = require('express');
const multer = require('multer');
const router = express.Router();
const ContractService = require('../services/contractReview/contractService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(pdf|docx)$/i.test(file.originalname) ||
      ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimetype);
    if (!ok) return cb(new Error('Unsupported file type. Upload a .pdf or .docx contract.'));
    cb(null, true);
  },
});

function handleError(res, err) {
  if (err instanceof ContractService.ContractAccessError) {
    return res.status(err.statusCode || 404).json({ error: err.message });
  }
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  console.error('[contract-review]', err);
  res.status(500).json({ error: err.message || 'Contract Review request failed' });
}

// ── Contracts ────────────────────────────────────────────────────────────────

router.post('/contracts', async (req, res) => {
  try {
    const { title, contractType } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
    const contract = await ContractService.createContract(req.user.id, { title: String(title).trim(), contractType });
    res.json(contract);
  } catch (err) { handleError(res, err); }
});

router.get('/contracts', async (req, res) => {
  try {
    const { status, search, crmClientId } = req.query || {};
    const contracts = await ContractService.listContracts(req.user.id, { status, search, crmClientId: crmClientId ? Number(crmClientId) : null });
    res.json({ contracts });
  } catch (err) { handleError(res, err); }
});

router.get('/contracts/:id', async (req, res) => {
  try {
    const contract = await ContractService.getContract(req.user.id, Number(req.params.id));
    res.json(contract);
  } catch (err) { handleError(res, err); }
});

router.delete('/contracts/:id', async (req, res) => {
  try {
    await ContractService.deleteContract(req.user.id, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
});

router.post('/contracts/:id/hold', async (req, res) => {
  try {
    await ContractService.setLegalHold(req.user.id, Number(req.params.id), !!req.body?.hold);
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
});

router.post('/contracts/:id/status', async (req, res) => {
  try {
    await ContractService.setContractStatus(req.user.id, Number(req.params.id), req.body?.status);
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
});

router.post('/contracts/:id/link-client', async (req, res) => {
  try {
    const { clientId } = req.body || {};
    await ContractService.linkContractToClient(req.user.id, Number(req.params.id), clientId ? Number(clientId) : null);
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
});

router.post('/contracts/:id/title', async (req, res) => {
  try {
    await ContractService.updateContractTitle(req.user.id, Number(req.params.id), req.body?.title);
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
});

// Every review across every document under this contract — "the contract
// is the project" — not just the latest document's latest review.
router.get('/contracts/:id/reviews', async (req, res) => {
  try {
    const reviews = await ContractService.listContractReviews(req.user.id, Number(req.params.id));
    res.json({ reviews });
  } catch (err) { handleError(res, err); }
});

// ── Documents ────────────────────────────────────────────────────────────────

router.post('/contracts/:id/documents', upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'file is required (.pdf or .docx)' });
    const { kind, parentDocumentId } = req.body || {};
    const doc = await ContractService.addDocument(req.user.id, Number(req.params.id), {
      file: { buffer: req.file.buffer, filename: req.file.originalname, mimeType: req.file.mimetype },
      kind: kind || 'base',
      parentDocumentId: parentDocumentId ? Number(parentDocumentId) : null,
    });
    res.json(doc);
  } catch (err) { handleError(res, err); }
});

router.delete('/documents/:id', async (req, res) => {
  try {
    await ContractService.deleteDocument(req.user.id, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
});

router.post('/documents/:id/execute', async (req, res) => {
  try {
    await ContractService.markDocumentExecuted(req.user.id, Number(req.params.id), req.body?.executedAt || null);
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
});

router.post('/contracts/:id/parties/:partyId/confirm', async (req, res) => {
  try {
    const party = await ContractService.confirmParty(req.user.id, Number(req.params.id), Number(req.params.partyId));
    res.json(party);
  } catch (err) { handleError(res, err); }
});

router.post('/contracts/:id/parties', async (req, res) => {
  try {
    const { name, role, isUser } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    const party = await ContractService.addParty(req.user.id, Number(req.params.id), { name: String(name).trim(), role, isUser });
    res.json(party);
  } catch (err) { handleError(res, err); }
});

router.post('/contracts/:id/parties/:partyId/link-client', async (req, res) => {
  try {
    const { clientId } = req.body || {};
    const party = await ContractService.linkPartyToClient(req.user.id, Number(req.params.id), Number(req.params.partyId), clientId ? Number(clientId) : null);
    res.json(party);
  } catch (err) { handleError(res, err); }
});

// ── Reviews ──────────────────────────────────────────────────────────────────

router.post('/documents/:id/review', async (req, res) => {
  try {
    const { asPartyId } = req.body || {};
    const result = await ContractService.startReview(req.user.id, Number(req.params.id), {
      asPartyId: asPartyId ? Number(asPartyId) : null,
    });
    res.json(result);
  } catch (err) { handleError(res, err); }
});

// "What changed" against the previous version — computed fresh per
// request, not a stored lineage (see compareReviews.js's own header note).
router.get('/documents/:id/compare', async (req, res) => {
  try {
    await ContractService.assertDocumentAccess(req.user.id, Number(req.params.id));
    const { compareToPreviousVersion } = require('../services/contractReview/compareReviews');
    const result = await compareToPreviousVersion(Number(req.params.id), req.user.id);
    res.json(result);
  } catch (err) { handleError(res, err); }
});

router.post('/reviews/:id/resume', async (req, res) => {
  try {
    const result = await ContractService.resumeReview(req.user.id, Number(req.params.id));
    res.json(result);
  } catch (err) { handleError(res, err); }
});

router.get('/reviews/:id', async (req, res) => {
  try {
    const review = await ContractService.getReview(req.user.id, Number(req.params.id));
    res.json(review);
  } catch (err) { handleError(res, err); }
});

router.get('/documents/:id/reviews', async (req, res) => {
  try {
    const reviews = await ContractService.listReviews(req.user.id, Number(req.params.id));
    res.json({ reviews });
  } catch (err) { handleError(res, err); }
});

router.post('/reviews/:id/corrections', async (req, res) => {
  try {
    const { contractId, clauseId, obligationId, partyId, definitionId, field, userValue, action, note } = req.body || {};
    if (!contractId) return res.status(400).json({ error: 'contractId is required' });
    if (!field || !action) return res.status(400).json({ error: 'field and action are required' });
    const correction = await ContractService.recordCorrection(req.user.id, {
      contractId: Number(contractId),
      clauseId: clauseId ? Number(clauseId) : null,
      obligationId: obligationId ? Number(obligationId) : null,
      partyId: partyId ? Number(partyId) : null,
      definitionId: definitionId ? Number(definitionId) : null,
      field, userValue, action, note,
    });
    res.json(correction);
  } catch (err) { handleError(res, err); }
});

// ── Obligations ──────────────────────────────────────────────────────────────

router.get('/obligations', async (req, res) => {
  try {
    const { contractId, upcoming, obligorPartyId } = req.query || {};
    const obligations = await ContractService.listObligations(req.user.id, {
      contractId: contractId ? Number(contractId) : null,
      upcoming: upcoming === '1' || upcoming === 'true',
      obligorPartyId: obligorPartyId ? Number(obligorPartyId) : null,
    });
    res.json({ obligations });
  } catch (err) { handleError(res, err); }
});

router.post('/obligations/:id/state', async (req, res) => {
  try {
    await ContractService.setObligationState(req.user.id, Number(req.params.id), req.body?.state);
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
});

router.post('/obligations/:id/task', async (req, res) => {
  try {
    if (!req.body?.taskId) return res.status(400).json({ error: 'taskId is required' });
    await ContractService.linkObligationToTask(req.user.id, Number(req.params.id), Number(req.body.taskId));
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
});

router.get('/export.ics', async (req, res) => {
  try {
    const { contractId } = req.query || {};
    const ics = await ContractService.exportIcs(req.user.id, { contractId: contractId ? Number(contractId) : null });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contract-obligations${contractId ? `-${contractId}` : ''}.ics"`);
    res.send(ics);
  } catch (err) { handleError(res, err); }
});

// ── Q&A ──────────────────────────────────────────────────────────────────────

// Contract-scoped (not review-scoped): searches every document/revision
// under the contract, not just one review — "the contract is the project".
router.post('/contracts/:id/ask', async (req, res) => {
  try {
    const { question } = req.body || {};
    await ContractService.assertContractAccess(req.user.id, Number(req.params.id));
    const { askAboutContract } = require('../services/contractReview/qa');
    const result = await askAboutContract(Number(req.params.id), question, req.user.id);
    res.json(result);
  } catch (err) { handleError(res, err); }
});

// ── Report ───────────────────────────────────────────────────────────────────

async function buildReportInputs(userId, contractId, reviewId) {
  const contract = await ContractService.getContract(userId, contractId);
  const review = reviewId ? await ContractService.getReview(userId, reviewId) : null;
  const obligations = await ContractService.listObligations(userId, { contractId });
  const { buildContractReviewPdfBuffer } = require('../services/contractReview/reportPdf');
  const pdfBytes = await buildContractReviewPdfBuffer(contract, review, obligations, review?.userPartyId || null);
  return { contract, pdfBytes };
}

router.get('/contracts/:id/report/pdf', async (req, res) => {
  try {
    const { reviewId } = req.query || {};
    const { contract, pdfBytes } = await buildReportInputs(req.user.id, Number(req.params.id), reviewId ? Number(reviewId) : null);
    const safeTitle = String(contract.title || 'contract').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}-review.pdf"`);
    res.setHeader('Content-Length', pdfBytes.length);
    res.end(Buffer.from(pdfBytes));
  } catch (err) { handleError(res, err); }
});

router.post('/contracts/:id/report/email', async (req, res) => {
  try {
    const { reviewId, to } = req.body || {};
    if (!to || !String(to).trim()) return res.status(400).json({ error: 'to is required' });
    const { contract, pdfBytes } = await buildReportInputs(req.user.id, Number(req.params.id), reviewId ? Number(reviewId) : null);
    const sendEmail = require('../utils/sendEmail');
    const safeTitle = String(contract.title || 'contract').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
    const sendResult = await sendEmail({
      to: String(to).trim(),
      subject: `Contract Review report — ${contract.title || 'Untitled contract'}`,
      html: `<p>Attached is the Contract Review report for <strong>${contract.title || 'Untitled contract'}</strong>.</p><p style="color:#92400e">Informational only — not legal advice. Always confirm important decisions with a qualified lawyer.</p>`,
      attachments: [{ filename: `${safeTitle}-review.pdf`, content: Buffer.from(pdfBytes), contentType: 'application/pdf' }],
    });
    res.json({ ok: true, provider: sendResult?.provider || null });
  } catch (err) { handleError(res, err); }
});

// ── Search ───────────────────────────────────────────────────────────────────

router.get('/search', async (req, res) => {
  try {
    const { q, includeAllDrafts } = req.query || {};
    if (!q || !String(q).trim()) return res.status(400).json({ error: 'q is required' });
    const clauses = await ContractService.searchClauses(req.user.id, {
      query: String(q).trim(),
      includeAllDrafts: includeAllDrafts === '1' || includeAllDrafts === 'true',
    });
    res.json({ clauses });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
