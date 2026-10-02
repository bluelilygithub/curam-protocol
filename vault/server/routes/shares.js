'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const marketData = require('../services/marketData');
const portfolio = require('../services/sharesPortfolio');
const { checkDailyDropAlerts } = require('../cron/sharesCron');
const { generateObservation, getWorkspaceTimezone, getDateInTz } = require('../services/sharesNewsService');
const { getDividendSummary, resolveDividendEdit } = require('../services/sharesDividends');
const { buildCgt, summariseDisposals, fyLabel, DISCOUNT_RATE } = require('../services/sharesCgt');
const { answerSharesQuestion, listQa, deleteQa } = require('../services/sharesAskService');

const VALID_EXCHANGES = ['ASX', 'NYSE', 'NASDAQ'];

function parseExchange(exchange) {
  const u = String(exchange || '').trim().toUpperCase();
  if (u === 'NYE' || u === 'NY') return 'NYSE';
  if (VALID_EXCHANGES.includes(u)) return u;
  return 'ASX';
}

function normalizeSymbolInput(symbol, exchange) {
  const s = String(symbol || '').trim().toUpperCase();
  if (!s) return '';
  if (exchange === 'ASX') return s.replace(/\.AX$/i, '');
  return s.replace(/\.AX$/i, '');
}

function parseTradeBody(body) {
  const {
    symbol, exchange, side, quantity, pricePerShare,
    feesAud = 0, tradedAt, notes,
  } = body || {};

  const ex = parseExchange(exchange);
  const sym = normalizeSymbolInput(symbol, ex);
  const sd = side === 'sell' ? 'sell' : 'buy';
  const qty = Number(quantity);
  const price = Number(pricePerShare);
  const fees = Number(feesAud) || 0;

  if (!sym || !qty || qty <= 0 || price < 0 || !tradedAt) {
    return { error: 'symbol, quantity, pricePerShare (AUD), and tradedAt are required' };
  }

  return {
    sym,
    ex,
    sd,
    qty,
    price,
    fees,
    tradedAt,
    notes: notes || null,
  };
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

// GET /api/shares/ask — archived Q&A for this user
router.get('/ask', async (req, res) => {
  try {
    const rows = await listQa(req.user.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shares/ask — Q&A grounded in portfolio / news / trades dataset
router.post('/ask', async (req, res) => {
  try {
    const { question, history } = req.body || {};
    const result = await answerSharesQuestion(req.user.id, question, { history });
    res.json({
      id: result.id,
      answer: result.answer,
      model: result.model,
      createdAt: result.createdAt,
    });
  } catch (err) {
    const status = /required|too long/i.test(err.message || '') ? 400 : 500;
    console.error('[shares] ask error:', err.message);
    res.status(status).json({ error: err.message || 'Ask failed' });
  }
});

// DELETE /api/shares/ask — body { ids: number[] } delete archived Q&A
router.delete('/ask', async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const result = await deleteQa(req.user.id, ids);
    res.json({ ok: true, deleted: result.deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shares/charts?days=30
router.get('/charts', async (req, res) => {
  try {
    const chartData = require('../services/sharesChartData');
    // ?range=today|7d|30d|90d|12m|fy|all (the older ?days=1|7|30|90 still works)
    const data = await chartData.getChartData(req.user.id, req.query.range ?? req.query.days);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shares/refresh
router.post('/refresh', async (req, res) => {
  try {
    const dash = await portfolio.recordSnapshots(req.user.id);
    res.json({ ok: true, dashboard: dash });
    // Let admins verify the drop-alert without waiting for a market-hours poll.
    // Honours the configured threshold (only emails in test mode or on a real drop).
    if (req.user?.isAdmin) {
      checkDailyDropAlerts().catch((err) =>
        console.error('[shares] manual drop-alert check failed:', err.message)
      );
    }
    // Also regenerate + email the portfolio observation for this user. Fire-and-forget:
    // it runs a multi-step LLM pipeline (~slow) and must never block or fail the refresh.
    generateObservation(req.user.id).catch((err) =>
      console.error('[shares] manual observation generation failed:', err.message)
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shares/cgt?fy=2025-26|all — capital gains by parcel (FIFO), docs/shares-cgt.md.
// Named route, before any /:id-shaped route in this file. Read-only: nothing is stored.
router.get('/cgt', async (req, res) => {
  try {
    const requested = req.query.fy == null || req.query.fy === '' ? null : String(req.query.fy);
    if (requested && requested !== 'all' && !/^\d{4}-\d{2}$/.test(requested)) {
      return res.status(400).json({ error: "fy must look like 2025-26, or 'all'" });
    }
    const tz = await getWorkspaceTimezone();
    const today = getDateInTz(tz);
    const { trades } = await portfolio.getTradesAndLedger(req.user.id);
    const { disposals, openParcels, warnings } = buildCgt(trades, tz, { today });

    const currentFy = fyLabel(today);
    const fys = [...new Set([currentFy, ...disposals.map((d) => d.fy)])].sort().reverse();
    const fy = requested || currentFy;
    const selected = fy === 'all' ? disposals : disposals.filter((d) => d.fy === fy);

    res.json({
      timezone: tz,
      today,
      fy,
      fys,
      discountRatePct: DISCOUNT_RATE * 100,
      summary: summariseDisposals(selected),
      fySummaries: fys.map((f) => ({ fy: f, ...summariseDisposals(disposals.filter((d) => d.fy === f)) })),
      disposals: selected,
      openParcels,
      warnings,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shares/dividends/summary — aggregate + per-symbol + monthly
// dividend income (docs/shares-statement-import.md). Named route, before
// any /:id-shaped route in this file.
router.get('/dividends/summary', async (req, res) => {
  try {
    const tz = await getWorkspaceTimezone();
    const today = getDateInTz(tz);
    res.json(await getDividendSummary(req.user.id, today));
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
    const parsed = parseTradeBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const { rows } = await pool.query(
      `INSERT INTO share_trades
        ("userId", symbol, exchange, side, quantity, "pricePerShare", currency, "fxRateToAud", "feesAud", "tradedAt", notes)
       VALUES ($1,$2,$3,$4,$5,$6,'AUD',NULL,$7,$8,$9)
       RETURNING *`,
      [
        req.user.id,
        parsed.sym,
        parsed.ex,
        parsed.sd,
        parsed.qty,
        parsed.price,
        parsed.fees,
        parsed.tradedAt,
        parsed.notes,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/shares/trades/:id
router.put('/trades/:id', async (req, res) => {
  try {
    const parsed = parseTradeBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const { rows, rowCount } = await pool.query(
      `UPDATE share_trades SET
        symbol=$1, exchange=$2, side=$3, quantity=$4, "pricePerShare"=$5,
        currency='AUD', "fxRateToAud"=NULL, "feesAud"=$6, "tradedAt"=$7, notes=$8
       WHERE id=$9 AND "userId"=$10
       RETURNING *`,
      [
        parsed.sym,
        parsed.ex,
        parsed.sd,
        parsed.qty,
        parsed.price,
        parsed.fees,
        parsed.tradedAt,
        parsed.notes,
        req.params.id,
        req.user.id,
      ]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
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

// PUT /api/shares/cash/:id
// The manual-entry form only offers deposit/withdraw, but rows created by
// the statement-import feature can be dividend/interest/fee — this route
// used to force type to 'deposit' for anything else it didn't recognise,
// which would silently reclassify an imported dividend row the moment
// someone clicked Edit on it without even changing the type dropdown.
// Fixed: only overwrite type when the caller actually sent a valid one;
// otherwise keep whatever the row already had.
const VALID_CASH_LEDGER_TYPES = ['deposit', 'withdraw', 'dividend', 'interest', 'fee'];
router.put('/cash/:id', async (req, res) => {
  try {
    const { type, amountAud, note, grossAud, withholdingRatePct } = req.body || {};
    const hasPaidOn = Object.prototype.hasOwnProperty.call(req.body || {}, 'paidOn');
    const amt = Number(amountAud);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'amountAud must be positive' });

    const { rows: existingRows } = await pool.query(
      // paidOnText: keep the date as a plain string — a DATE read back as a JS Date and re-sent
      // as a query parameter can shift by a day in a non-UTC server timezone.
      `SELECT *, "paidOn"::text AS "paidOnText" FROM share_cash_ledger WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]
    );
    if (!existingRows.length) return res.status(404).json({ error: 'Not found' });
    const existing = existingRows[0];
    const t = VALID_CASH_LEDGER_TYPES.includes(type) ? type : existing.type;

    // Dividend tax figures. amountAud is always the NET cash received; gross / withholding /
    // rate ride alongside it (server/services/sharesDividends.js). Only dividends carry them.
    let tax = { grossAud: null, withholdingTaxAud: null, withholdingRatePct: null, grossDerived: false };
    if (t === 'dividend') {
      const keep = {
        grossAud: existing.grossAud != null ? Number(existing.grossAud) : null,
        withholdingTaxAud: existing.withholdingTaxAud != null ? Number(existing.withholdingTaxAud) : null,
        withholdingRatePct: existing.withholdingRatePct != null ? Number(existing.withholdingRatePct) : null,
        grossDerived: !!existing.grossDerived,
      };
      const edited = resolveDividendEdit(amt, { grossAud, withholdingRatePct });
      if (edited) {
        tax = edited;
      } else if (keep.grossAud == null) {
        tax = keep; // nothing known, nothing invented
      } else if (Math.abs(Number(existing.amountAud) - amt) < 0.005) {
        tax = keep; // net unchanged — leave the tax figures exactly as they were
      } else if (keep.grossDerived && keep.withholdingRatePct != null) {
        // Net changed on a derived row: re-derive at the same rate.
        tax = resolveDividendEdit(amt, { withholdingRatePct: keep.withholdingRatePct });
      } else {
        // Net changed on a user-entered gross: keep the gross, recompute the tax withheld.
        tax = resolveDividendEdit(amt, { grossAud: keep.grossAud });
      }
    }

    // Payment date. Only imported-style cash rows (dividend/interest/fee) carry one; omit the key
    // to keep the current value, send ''/null to clear it (summaries then fall back to the date
    // the row was added). Must be a real calendar date — 2026-02-30 is rejected, not rolled over.
    let paidOn = existing.paidOnText;
    if (!['dividend', 'interest', 'fee'].includes(t)) {
      paidOn = null;
    } else if (hasPaidOn) {
      const raw = req.body.paidOn;
      if (raw == null || raw === '') {
        paidOn = null;
      } else {
        const s = String(raw);
        const d = new Date(`${s}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
          return res.status(400).json({ error: 'paidOn must be a real date (YYYY-MM-DD)' });
        }
        paidOn = s;
      }
    }

    const { rows } = await pool.query(
      `UPDATE share_cash_ledger SET type=$1, "amountAud"=$2, note=$3,
              "grossAud"=$4, "withholdingTaxAud"=$5, "withholdingRatePct"=$6, "grossDerived"=$7, "paidOn"=$8
       WHERE id=$9 AND "userId"=$10 RETURNING *, "paidOn"::text AS "paidOnText"`,
      [t, amt, note || null, tax.grossAud, tax.withholdingTaxAud, tax.withholdingRatePct, tax.grossDerived, paidOn, req.params.id, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
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
