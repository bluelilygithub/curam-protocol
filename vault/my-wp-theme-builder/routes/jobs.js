const express = require('express');
const { getJob, initJob, cancelJob } = require('../utils/jobProgress');

const router = express.Router();

router.post('/', (req, res) => {
  const { jobId, type } = req.body || {};

  if (!jobId || !type) {
    return res.status(400).json({ error: 'jobId and type are required' });
  }

  if (!['stage1', 'stage1-home', 'stage1-iterate', 'stage2'].includes(type)) {
    return res.status(400).json({ error: 'type must be stage1, stage1-home, stage1-iterate, or stage2' });
  }

  const job = initJob(jobId, type);
  res.status(201).json(job);
});

router.get('/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

router.post('/:jobId/cancel', (req, res) => {
  const job = cancelJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({ ok: true, job });
});

module.exports = router;
