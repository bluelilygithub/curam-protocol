'use strict';

const express = require('express');
const {
  runAudit,
  listAudits,
  getAudit,
  deleteAudit,
  markdownFor,
} = require('../services/aiVisibility/aiVisibilityService');
const { buildAiVisibilityPdfBuffer } = require('../services/aiVisibility/pdf');
const { aiLimiter } = require('../middleware/aiRateLimit');

const router = express.Router();

function safeFilename(name) {
  return String(name || 'ai-visibility')
    .trim()
    .slice(0, 60)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'ai-visibility';
}

router.get('/audits', async (req, res) => {
  try {
    res.json(await listAudits(req.user.id));
  } catch (err) {
    console.error('[ai-visibility/audits GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// A run can take a minute or two (real search + model answers + one Chromium render),
// so the client shows a processing state and this answers once, with the saved report.
router.post('/audits', aiLimiter, async (req, res) => {
  try {
    const audit = await runAudit(req.user.id, {
      url: req.body?.url,
      name: req.body?.name,
      brand: req.body?.brand,
      queries: req.body?.queries,
      facts: req.body?.facts,
      modelId: req.body?.modelId,
    });
    res.status(201).json(audit);
  } catch (err) {
    console.error('[ai-visibility/audits POST]', err.message);
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.get('/audits/:id', async (req, res) => {
  try {
    const audit = await getAudit(req.user.id, Number(req.params.id));
    if (!audit) return res.status(404).json({ error: 'Not found' });
    return res.json(audit);
  } catch (err) {
    console.error('[ai-visibility/audits/:id GET]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/audits/:id', async (req, res) => {
  try {
    const ok = await deleteAudit(req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[ai-visibility/audits/:id DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/audits/:id/markdown', async (req, res) => {
  try {
    const audit = await getAudit(req.user.id, Number(req.params.id));
    if (!audit) return res.status(404).json({ error: 'Not found' });
    res.json({ markdown: markdownFor(audit) });
  } catch (err) {
    console.error('[ai-visibility/audits/:id/markdown GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/audits/:id/pdf', async (req, res) => {
  try {
    const audit = await getAudit(req.user.id, Number(req.params.id));
    if (!audit) return res.status(404).json({ error: 'Not found' });
    const buffer = await buildAiVisibilityPdfBuffer(markdownFor(audit));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(audit.name || audit.hostname)}-ai-visibility.pdf"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[ai-visibility/audits/:id/pdf GET]', err.message);
    res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

module.exports = router;
