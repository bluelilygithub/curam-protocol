'use strict';

const express = require('express');
const router = express.Router();
const MemoryService = require('../services/MemoryService');
const { resolveEmbeddingConfig } = require('../services/embeddingResolver');

// GET /api/memory/stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await MemoryService.stats({ userId: req.user.id });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/memory/search?q=
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q ?? req.query.query;
    const results = await MemoryService.search({
      userId: req.user.id,
      query: q,
      limit: req.query.limit,
    });
    res.json({ results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/memory
router.get('/', async (req, res) => {
  try {
    const config = await resolveEmbeddingConfig(req.user.id);
    if (config.available) {
      MemoryService.backfillEmbeddings(req.user.id).catch((err) => {
        console.warn('[memory] backfill skipped:', err.message);
      });
    }
    const thoughts = await MemoryService.list({
      userId: req.user.id,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(thoughts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory
router.post('/', async (req, res) => {
  const { content, metadata } = req.body ?? {};
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });
  try {
    const result = await MemoryService.capture({
      userId: req.user.id,
      content,
      metadata,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/memory/:id
router.put('/:id', async (req, res) => {
  const { content, metadata } = req.body ?? {};
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });
  try {
    const row = await MemoryService.update({
      userId: req.user.id,
      id: req.params.id,
      content,
      metadata,
    });
    res.json(row);
  } catch (err) {
    const status = err.message === 'Memory not found.' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/memory/:id
router.delete('/:id', async (req, res) => {
  try {
    await MemoryService.remove({ userId: req.user.id, id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    const status = err.message === 'Memory not found.' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
