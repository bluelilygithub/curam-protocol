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
    const { status, search } = req.query || {};
    const contracts = await ContractService.listContracts(req.user.id, { status, search });
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

// ── Reviews ──────────────────────────────────────────────────────────────────

router.post('/documents/:id/review', async (req, res) => {
  try {
    const result = await ContractService.startReview(req.user.id, Number(req.params.id));
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
