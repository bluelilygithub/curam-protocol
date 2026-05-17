'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const marketData = require('../services/marketData');
const portfolio = require('../services/sharesPortfolio');

function normalizeSymbolInput(symbol, exchange) {
  const s = String(symbol || '').trim().toUpperCase();
  if (!s) return '';
  if (exchange === 'ASX') return s.replace(/\.AX$/i, '');
  return s.replace(/\.AX$/i, '');
}

// GET /api/shares/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const data = await portfolio.buildDashboard(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shares/charts
router.get('/charts', async (req, res) => {
  try {
    const data = await portfolio.getChartData(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shares/refresh — quotes + snapshot (today's chart points)
router.post('/refresh', async (req, res) => {
  try {
    const dash = await portfolio.recordSnapshots(req.user.id);
    res.json({ ok: true, dashboard: dash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shares/fx
router.get('/fx', async (req, res) => {
  try {
    const usdAud = await marketData.getUsdToAudRate();
    res.json({ usdAud });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shares/trades
router.get('/trades', async (req, res) => {
  try {
    const { trades } = await portfolio.getTradesAndLedger(req.user.id);
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shares/trades
router.post('/trades', async (req, res) => {
  try {
    const {
      symbol, exchange, side, quantity, pricePerShare,
      feesAud = 0, tradedAt, notes,
    } = req.body || {};

    const ex = exchange === 'NYSE' ? 'NYSE' : 'ASX';
    const sym = normalizeSymbolInput(symbol, ex);
    const sd = side === 'sell' ? 'sell' : 'buy';
    const qty = Number(quantity);
    const price = Number(pricePerShare);
    const fees = Number(feesAud) || 0;

    if (!sym || !qty || qty <= 0 || price < 0 || !tradedAt) {
      return res.status(400).json({ error: 'symbol, quantity, pricePerShare, and tradedAt are required' });
    }

    const currency = ex === 'NYSE' ? 'USD' : 'AUD';
    let fxRateToAud = null;
    if (currency === 'USD') {
      fxRateToAud = await marketData.getUsdToAudRate();
    }

    const { rows } = await pool.query(
      `INSERT INTO share_trades
        ("userId", symbol, exchange, side, quantity, "pricePerShare", currency, "fxRateToAud", "feesAud", "tradedAt", notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [req.user.id, sym, ex, sd, qty, price, currency, fxRateToAud, fees, tradedAt, notes || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/shares/trades/:id
router.delete('/trades/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM share_trades WHERE id=$1 AND "userId"=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shares/cash
router.get('/cash', async (req, res) => {
  try {
    const { ledger } = await portfolio.getTradesAndLedger(req.user.id);
    res.json(ledger);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shares/cash
router.post('/cash', async (req, res) => {
  try {
    const { type, amountAud, note } = req.body || {};
    const t = type === 'withdraw' ? 'withdraw' : 'deposit';
    const amt = Number(amountAud);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'amountAud must be positive' });

    const { rows } = await pool.query(
      `INSERT INTO share_cash_ledger ("userId", type, "amountAud", note)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, t, amt, note || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/shares/cash/:id
router.delete('/cash/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM share_cash_ledger WHERE id=$1 AND "userId"=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
