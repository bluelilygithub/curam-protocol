'use strict';

// /api/shares/compliance — the admin-only Shares Compliance Advisory tab. Mounted with requireFeature('shares')
// and requireAdmin BEFORE /api/shares in server/index.js. See docs/shares-compliance.md.

const express = require('express');
const router = express.Router();
const svc = require('../services/sharesCompliance/service');
const { markdownFor } = require('../services/sharesCompliance/report');
const { buildSharesCompliancePdfBuffer } = require('../services/sharesCompliance/pdf');
const { aiLimiter } = require('../middleware/aiRateLimit');

function idOf(req) {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

router.get('/reports', async (req, res) => {
  try {
    res.json(await svc.listReports(req.user.id));
  } catch (err) {
    console.error('[shares-compliance/reports GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// One model call, so it shares the AI request budget. The body is deliberately ignored: there are no
// user-supplied URLs, prompts or rules in this feature.
router.post('/reports', aiLimiter, async (req, res) => {
  try {
    const report = await svc.startReports({ userIds: [req.user.id], trigger: 'manual' });
    res.status(202).json(report[0]);
  } catch (err) {
    console.error('[shares-compliance/reports POST]', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/reports/:id', async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: 'bad id' });
  try {
    const report = await svc.getReport(req.user.id, id);
    if (!report) return res.status(404).json({ error: 'Not found' });
    return res.json(report);
  } catch (err) {
    console.error('[shares-compliance/reports/:id GET]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/reports/:id', async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: 'bad id' });
  try {
    const result = await svc.deleteReport(req.user.id, id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    return res.json(result);
  } catch (err) {
    console.error('[shares-compliance/reports/:id DELETE]', err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/reports/:id/markdown', async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: 'bad id' });
  try {
    const report = await svc.getReport(req.user.id, id);
    if (!report) return res.status(404).json({ error: 'Not found' });
    if (report.status !== 'done') return res.status(409).json({ error: 'This report has not finished.' });
    return res.json({ markdown: markdownFor(report.report) });
  } catch (err) {
    console.error('[shares-compliance/reports/:id/markdown GET]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/reports/:id/pdf', async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: 'bad id' });
  try {
    const report = await svc.getReport(req.user.id, id);
    if (!report) return res.status(404).json({ error: 'Not found' });
    if (report.status !== 'done') return res.status(409).json({ error: 'This report has not finished.' });
    const buffer = await buildSharesCompliancePdfBuffer(markdownFor(report.report));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="shares-compliance-advisory.pdf"');
    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[shares-compliance/reports/:id/pdf GET]', err.message);
    return res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

module.exports = router;
