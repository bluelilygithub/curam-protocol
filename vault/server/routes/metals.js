'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const marketData = require('../services/marketData');

// GET /api/metals/spot
router.get('/spot', async (req, res) => {
  try {
    const spot = await marketData.getGoldSpotAud({ force: req.query.force === 'true' });
    res.json(spot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/metals/purchases
router.get('/purchases', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM metal_purchases WHERE "userId"=$1 ORDER BY "purchasedAt" DESC, id DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/metals/purchases
router.post('/purchases', async (req, res) => {
  try {
    const { metal = 'XAU', description, weightOz, paidAud, spotAudPerOz, purchasedAt, notes } = req.body || {};
    const w = Number(weightOz);
    const p = Number(paidAud);
    if (!w || w <= 0 || !p || p <= 0 || !purchasedAt) {
      return res.status(400).json({ error: 'weightOz, paidAud, and purchasedAt are required' });
    }
    const spot = spotAudPerOz != null ? Number(spotAudPerOz) : null;
    const { rows } = await pool.query(
      `INSERT INTO metal_purchases
        ("userId", metal, description, "weightOz", "paidAud", "spotAudPerOz", "purchasedAt", notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [req.user.id, String(metal || 'XAU').toUpperCase(), description || null, w, p, spot, purchasedAt, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/metals/purchases/:id
router.put('/purchases/:id', async (req, res) => {
  try {
    const { metal = 'XAU', description, weightOz, paidAud, spotAudPerOz, purchasedAt, notes } = req.body || {};
    const w = Number(weightOz);
    const p = Number(paidAud);
    if (!w || w <= 0 || !p || p <= 0 || !purchasedAt) {
      return res.status(400).json({ error: 'weightOz, paidAud, and purchasedAt are required' });
    }
    const spot = spotAudPerOz != null ? Number(spotAudPerOz) : null;
    const { rows, rowCount } = await pool.query(
      `UPDATE metal_purchases SET
        metal=$1, description=$2, "weightOz"=$3, "paidAud"=$4, "spotAudPerOz"=$5, "purchasedAt"=$6, notes=$7
       WHERE id=$8 AND "userId"=$9
       RETURNING *`,
      [
        String(metal || 'XAU').toUpperCase(), description || null,
        w, p, spot, purchasedAt, notes || null,
        req.params.id, req.user.id,
      ]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/metals/purchases/:id
router.delete('/purchases/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM metal_purchases WHERE id=$1 AND "userId"=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
