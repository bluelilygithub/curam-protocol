'use strict';

const express = require('express');
const {
  listAudits,
  getAudit,
  createAudit,
  deleteAudit,
} = require('../services/seo/seoAuditService');
const { getProject } = require('../services/seo/seoProjectService');

const router = express.Router();

router.get('/audits', async (req, res) => {
  try {
    res.json(await listAudits(req.user.id));
  } catch (err) {
    console.error('[seo/audits GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/audits', async (req, res) => {
  try {
    const audit = await createAudit(req.user.id, {
      url: req.body?.url,
      name: req.body?.name,
    });
    res.status(201).json(audit);
  } catch (err) {
    console.error('[seo/audits POST]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/audits/:id', async (req, res) => {
  try {
    const audit = await getAudit(req.user.id, Number(req.params.id));
    if (audit) return res.json(audit);
    const ads = await getProject(req.user.id, Number(req.params.id));
    if (ads) return res.json({ redirectTo: `/google-ads/${ads.id}` });
    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('[seo/audits/:id GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/audits/:id', async (req, res) => {
  try {
    const ok = await deleteAudit(req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[seo/audits/:id DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
