'use strict';

const express = require('express');
const { getJob, cancelJob, resumeJob, getResult } = require('../../services/presentations/jobs');
const { sendError } = require('./shared');

const router = express.Router();

router.get('/jobs/:id', (req, res) => {
  const job = getJob(req.user.id, req.params.id);
  if (!job) return res.status(404).json({ error: 'That job was not found.' });
  return res.json(job);
});

router.post('/jobs/:id/cancel', (req, res) => {
  const ok = cancelJob(req.user.id, req.params.id);
  if (!ok) return res.status(404).json({ error: 'That job is not running.' });
  return res.json({ ok: true });
});

router.post('/jobs/:id/resume', (req, res) => {
  try {
    const job = resumeJob(req.user.id, req.params.id);
    if (!job) return res.status(404).json({ error: 'That job was not found.' });
    return res.status(202).json({ jobId: job.id });
  } catch (err) { return sendError(res, err, 'That job could not be resumed.'); }
});

router.get('/jobs/:id/result', (req, res) => {
  try {
    const out = getResult(req.user.id, req.params.id);
    if (!out) return res.status(404).json({ error: 'That job was not found.' });
    const { filePath, ...safeResult } = out.result || {}; // never expose a server path to the browser
    return res.json({ kind: out.kind, ...safeResult });
  } catch (err) { return sendError(res, err, 'That result is not ready.'); }
});

module.exports = router;
