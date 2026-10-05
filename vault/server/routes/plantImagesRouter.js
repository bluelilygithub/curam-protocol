'use strict';

// Plant photos: GET /api/plant-images/:plantId, GET /api/plant-images/credits?ids=..., and the admin curator tools. The service does the work
// (services/plantImages.js); this only checks input and who is asking. Mounted behind auth and the gardenPlanner flag; `adminOnly` guards the
// curator routes. A client can only ask about plant ids the server knows, so it can never make the server search for an arbitrary name.
const express = require('express');
const { getLogger } = require('../middleware/requestContext');

const PLANT_ID = /^[a-z0-9-]{1,80}$/;
const IMAGE_ID = /^\d{1,10}$/;

function createRouter(service, adminOnly = (_req, _res, next) => next()) {
  const router = express.Router();
  const fail = (res, err, what) => { getLogger().error({ err }, `plant images ${what} failed`); res.status(500).json({ error: 'Could not load plant photos.' }); };

  // GET /credits?ids=a,b,c : the credit for every photo that could be shown for those plants (the Credits page and credits export)
  router.get('/credits', async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0 || ids.length > 300 || ids.some((i) => !PLANT_ID.test(i))) return res.status(400).json({ error: 'Send up to 300 plant ids.' });
    try { res.json({ credits: await service.credits(ids) }); } catch (err) { fail(res, err, 'credits'); }
  });

  // curator overview (admin): counts per plant, and a bulk "fetch the ones never looked up". Named routes sit before /:plantId.
  router.get('/summary', adminOnly, async (_req, res) => {
    try { res.set('Cache-Control', 'no-store'); res.json({ plants: await service.summary() }); } catch (err) { fail(res, err, 'summary'); }
  });
  router.post('/refresh-missing', adminOnly, async (_req, res) => {
    try { res.status(202).json({ queued: await service.refreshMissing() }); } catch (err) { fail(res, err, 'refresh-missing'); }
  });

  // curator tools (admin)
  router.post('/images/:id/hide', adminOnly, async (req, res) => {
    if (!IMAGE_ID.test(req.params.id) || typeof req.body?.hidden !== 'boolean') return res.status(400).json({ error: 'Send { hidden: true | false }.' });
    try {
      const ok = await service.setHidden(req.params.id, req.body.hidden);
      res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'That photo was not found.' });
    } catch (err) { fail(res, err, 'hide'); }
  });
  router.post('/images/:id/role', adminOnly, async (req, res) => {
    if (!IMAGE_ID.test(req.params.id)) return res.status(404).json({ error: 'That photo was not found.' });
    try {
      const ok = await service.setRole(req.params.id, String(req.body?.role));
      res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'That photo was not found.' });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /:plantId : the cached photos (curated defaults first). Never waits on the network: "pending" while a background fetch runs.
  router.get('/:plantId', async (req, res) => {
    if (!PLANT_ID.test(req.params.plantId)) return res.status(404).json({ error: 'Unknown plant.' });
    try {
      const r = await service.images(req.params.plantId);
      if (r.status === 'unknown_plant') return res.status(404).json({ error: 'Unknown plant.' });
      res.set('Cache-Control', 'no-store');
      res.json(r);
    } catch (err) { fail(res, err, 'list'); }
  });

  router.get('/:plantId/all', adminOnly, async (req, res) => {
    if (!PLANT_ID.test(req.params.plantId)) return res.status(404).json({ error: 'Unknown plant.' });
    try { res.json({ images: await service.allImages(req.params.plantId) }); } catch (err) { fail(res, err, 'all'); }
  });
  router.post('/:plantId/default', adminOnly, async (req, res) => {
    if (!PLANT_ID.test(req.params.plantId)) return res.status(404).json({ error: 'Unknown plant.' });
    const { role, imageId } = req.body ?? {};
    if (imageId !== null && imageId !== undefined && !IMAGE_ID.test(String(imageId))) return res.status(400).json({ error: 'imageId must be a photo id or null.' });
    try {
      const ok = await service.setDefault(req.params.plantId, String(role), imageId ?? null);
      res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'That photo is not available for this plant.' });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  router.post('/:plantId/refresh', adminOnly, async (req, res) => {
    if (!PLANT_ID.test(req.params.plantId)) return res.status(404).json({ error: 'Unknown plant.' });
    service.startRefresh(req.params.plantId);
    res.status(202).json({ ok: true });
  });

  return router;
}

module.exports = { createRouter, PLANT_ID };
