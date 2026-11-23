'use strict';

// Skill Scanner API (/api/skill-scan, mounted behind requireAdmin). Scans run in the background; the page polls /jobs/:id.
// A deep scan (AI model) goes through aiLimiter; a static scan makes no model call. See docs/skill-scan.md.

const express = require('express');
const multer = require('multer');
const { aiLimiter } = require('../middleware/aiRateLimit');
const { getLogger } = require('../middleware/requestContext');

const MAX_ZIP_BYTES = 20 * 1024 * 1024;

function createSkillScanRouter({ service, limiter } = {}) {
  const router = express.Router();
  let svc = service || null;
  const S = () => svc || (svc = require('../services/skillScan').createSkillScanService());
  const limit = limiter || aiLimiter;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ZIP_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!/\.zip$/i.test(file.originalname || '')) return cb(Object.assign(new Error('Upload a .zip of the skill or plugin folder.'), { status: 400 }));
      cb(null, true);
    },
  });

  const fail = (res, err, where) => {
    const status = err?.status || (err?.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    if (status === 500) getLogger().error({ err }, `[skillScan] ${where}`);
    const message = err?.code === 'LIMIT_FILE_SIZE' ? `The zip is over ${MAX_ZIP_BYTES / 1024 / 1024} MB.` : err.message;
    res.status(status).json({ error: status === 500 ? 'Skill Scanner could not complete that request.' : message });
  };

  router.get('/config', async (req, res) => {
    try { res.json(await S().config(req.user.id)); } catch (err) { fail(res, err, 'config'); }
  });

  router.get('/scans', async (req, res) => {
    try { res.json({ scans: await S().list(req.user.id) }); } catch (err) { fail(res, err, 'list'); }
  });

  // multipart (file) or JSON ({ url }); deep=true goes through the AI rate limit
  router.post('/scans',
    (req, res, next) => upload.single('file')(req, res, (err) => (err ? fail(res, err, 'upload') : next())),
    (req, res, next) => (String(req.body?.deep) === 'true' ? limit(req, res, next) : next()),
    async (req, res) => {
      try {
        const deep = String(req.body?.deep) === 'true';
        const recursive = String(req.body?.recursive) === 'true';
        const url = typeof req.body?.url === 'string' && req.body.url.trim() ? req.body.url.trim() : null;
        if (url && req.file) return res.status(400).json({ error: 'Send a GitHub link or a zip, not both.' });
        const out = await S().start(req.user.id, { url, zipBuffer: req.file?.buffer || null, fileName: req.file?.originalname || null, deep, recursive });
        res.status(202).json(out);
      } catch (err) { fail(res, err, 'start'); }
    });

  router.get('/scans/:id', async (req, res) => {
    if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: 'Scan not found.' });
    try {
      const scan = await S().get(req.user.id, req.params.id);
      if (!scan) return res.status(404).json({ error: 'Scan not found.' });
      res.json({ scan });
    } catch (err) { fail(res, err, 'get'); }
  });

  // Write the plain-English explanation again (also written after every scan). One model call, so behind the AI limit.
  router.post('/scans/:id/summary', (req, res, next) => limit(req, res, next), async (req, res) => {
    if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: 'Scan not found.' });
    try {
      const summary = await S().summarise(req.user.id, req.params.id);
      if (!summary) return res.status(404).json({ error: 'Scan not found.' });
      res.json({ summary });
    } catch (err) { fail(res, err, 'summary'); }
  });

  router.delete('/scans/:id', async (req, res) => {
    if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: 'Scan not found.' });
    try {
      const out = await S().remove(req.user.id, req.params.id);
      if (!out) return res.status(404).json({ error: 'Scan not found.' });
      res.json({ deleted: true, binId: out.binId });
    } catch (err) { fail(res, err, 'delete'); }
  });

  router.get('/jobs/:jobId', (req, res) => {
    const job = S().getJob(req.params.jobId, req.user.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    res.json({ job });
  });

  return router;
}

const router = createSkillScanRouter();
module.exports = router;
module.exports.createSkillScanRouter = createSkillScanRouter;
