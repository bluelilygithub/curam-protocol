'use strict';

// Shared admin-only HTTP layer for the two Compliance Advisory tools. The route factory keeps the Shares and
// Finance routers identical: check spend before a force, start the report in the background, and only serve
// markdown/PDF for reports owned by the signed-in admin. See docs/shares-compliance.md and
// docs/finance-compliance.md.

const express = require('express');
const { aiLimiter } = require('../../middleware/aiRateLimit');
const { createPdfBuilder } = require('./pdf');

function idOf(req) {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function createRoutes({ config, service, pdf = createPdfBuilder(config) } = {}) {
  const router = express.Router();
  const tag = config.logPrefix || config.app;
  const filename = `${config.app}-compliance-advisory.pdf`;

  router.get('/reports', async (req, res) => {
    try {
      res.json(await service.listReports(req.user.id));
    } catch (err) {
      console.error(`[${tag}/reports GET]`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // One model call, so it shares the AI request budget. The body is deliberately ignored: there are no
  // user-supplied URLs, prompts or rules in this feature.
  router.post('/reports', aiLimiter, async (req, res) => {
    try {
      await service.spend.assertWithinCap(req.user.id);
      const report = await service.startReports({ userIds: [req.user.id], trigger: 'manual' });
      res.status(202).json(report[0]);
    } catch (err) {
      console.error(`[${tag}/reports POST]`, err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  router.get('/reports/:id', async (req, res) => {
    const id = idOf(req);
    if (!id) return res.status(400).json({ error: 'bad id' });
    try {
      const report = await service.getReport(req.user.id, id);
      if (!report) return res.status(404).json({ error: 'Not found' });
      return res.json(report);
    } catch (err) {
      console.error(`[${tag}/reports/:id GET]`, err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  router.delete('/reports/:id', async (req, res) => {
    const id = idOf(req);
    if (!id) return res.status(400).json({ error: 'bad id' });
    try {
      const result = await service.deleteReport(req.user.id, id);
      if (!result) return res.status(404).json({ error: 'Not found' });
      return res.json(result);
    } catch (err) {
      console.error(`[${tag}/reports/:id DELETE]`, err.message);
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  router.get('/reports/:id/markdown', async (req, res) => {
    const id = idOf(req);
    if (!id) return res.status(400).json({ error: 'bad id' });
    try {
      const report = await service.getReport(req.user.id, id);
      if (!report) return res.status(404).json({ error: 'Not found' });
      if (report.status !== 'done') return res.status(409).json({ error: 'This report has not finished.' });
      const markdown = report.markdown || service.reports.markdownFor(report.report);
      return res.json({ markdown });
    } catch (err) {
      console.error(`[${tag}/reports/:id/markdown GET]`, err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/reports/:id/pdf', async (req, res) => {
    const id = idOf(req);
    if (!id) return res.status(400).json({ error: 'bad id' });
    try {
      const report = await service.getReport(req.user.id, id);
      if (!report) return res.status(404).json({ error: 'Not found' });
      if (report.status !== 'done') return res.status(409).json({ error: 'This report has not finished.' });
      const markdown = report.markdown || service.reports.markdownFor(report.report);
      const buffer = await pdf.buildCompliancePdfBuffer(markdown);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(Buffer.from(buffer));
    } catch (err) {
      console.error(`[${tag}/reports/:id/pdf GET]`, err.message);
      return res.status(500).json({ error: err.message || 'Failed to generate PDF' });
    }
  });

  return router;
}

module.exports = { createRoutes, idOf };
