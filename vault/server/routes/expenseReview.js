'use strict';

// Invoice/bill review queue API (expense_review_queue). Additive to Gmail/Finance — reads
// Inbox Intel's classification output (via server/services/expenseReviewService.js) and
// writes Finance expenses only through finance.js's own createExpenseRecord helper, never
// by duplicating its insert/journal SQL here.

const express = require('express');
const router = express.Router();
const path = require('path');
const { pool } = require('../db');
const financeRouter = require('./finance');

const VALID_STATUSES = ['pending', 'approved', 'rejected', 'duplicate'];

// GET /api/expense-review?reviewStatus=pending
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { reviewStatus } = req.query;
    const params = [userId];
    let where = `"userId"=$1`;
    if (reviewStatus) {
      if (!VALID_STATUSES.includes(reviewStatus)) return res.status(400).json({ error: 'invalid reviewStatus' });
      params.push(reviewStatus);
      where += ` AND "reviewStatus"=$2`;
    }
    const { rows } = await pool.query(
      `SELECT * FROM expense_review_queue WHERE ${where} ORDER BY "createdAt" DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/expense-review/:id/reject — mark rejected, no side effects
router.post('/:id/reject', async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `UPDATE expense_review_queue SET "reviewStatus"='rejected', "updatedAt"=NOW()
       WHERE id=$1 AND "userId"=$2 RETURNING *`,
      [req.params.id, userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Creates the fin_expenses row for one queue row via finance.js's shared helper (same
// insert + journal-posting path as manual expense entry), applying any per-row edits the
// user made in the review UI before approving. Runs inside the caller's transaction.
async function createExpenseForQueueRow(dbClient, userId, queueRow, overrides = {}) {
  const vendor      = overrides.vendor ?? queueRow.vendor;
  const amount      = overrides.amount ?? queueRow.amount;
  const invoiceDate = overrides.invoiceDate ?? queueRow.invoiceDate;
  const category    = overrides.category ?? queueRow.category;

  const { expense } = await financeRouter.createExpenseRecord(dbClient, userId, {
    date: invoiceDate,
    description: vendor ? `Invoice: ${vendor}` : `Invoice review #${queueRow.id}`,
    amount: amount || 0,
    gstIncluded: false, // extracted "amount" is the total payable; no reliable GST split from a parsed PDF
    category,
    supplier: vendor,
  });

  await dbClient.query(
    `UPDATE expense_review_queue
     SET "expenseCreated"=TRUE, "expenseId"=$1, "reviewStatus"='approved',
         vendor=$2, amount=$3, "invoiceDate"=$4, category=$5, "updatedAt"=NOW()
     WHERE id=$6`,
    [expense.id, vendor || null, amount || null, invoiceDate || null, category || null, queueRow.id]
  );
  return expense;
}

// POST /api/expense-review/bulk-create-expenses  { items: [{ id, vendor?, amount?, invoiceDate?, category? }] }
router.post('/bulk-create-expenses', async (req, res) => {
  const userId = req.user.id;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'items required' });

  const results = [];
  for (const item of items) {
    const dbClient = await pool.connect();
    try {
      await dbClient.query('BEGIN');
      const { rows } = await dbClient.query(
        `SELECT * FROM expense_review_queue WHERE id=$1 AND "userId"=$2 FOR UPDATE`,
        [item.id, userId]
      );
      const queueRow = rows[0];
      if (!queueRow) { await dbClient.query('ROLLBACK'); results.push({ id: item.id, ok: false, error: 'not found' }); continue; }
      if (queueRow.expenseCreated) {
        await dbClient.query('ROLLBACK');
        results.push({ id: item.id, ok: true, expenseId: queueRow.expenseId, alreadyCreated: true });
        continue;
      }
      const expense = await createExpenseForQueueRow(dbClient, userId, queueRow, item);
      await dbClient.query('COMMIT');
      results.push({ id: item.id, ok: true, expenseId: expense.id });
    } catch (err) {
      await dbClient.query('ROLLBACK');
      results.push({ id: item.id, ok: false, error: err.message });
    } finally {
      dbClient.release();
    }
  }
  res.json({ results });
});

// POST /api/expense-review/bulk-mark-paid  { items: [ids], paidDate? }
//
// IMPORTANT — this "paid" flag is queue-local operational tracking only, not a general
// Finance "mark paid" hook:
//   - fin_expenses has no paid/paidDate concept at all — an expense row represents a
//     payable that was ALREADY paid at the moment it's entered (see createExpenseRecord's
//     journal entry: it posts a credit straight out of Bank/paidVia, same as any other
//     already-settled transaction). So "creating the expense" IS the accounting "paid" event.
//   - fin_invoices does have a paid lifecycle (status/"paidAt"), but that's for RECEIVABLES
//     (money owed TO this business) via POST /invoices/:id/mark-paid — unrelated to this
//     payable-side queue, so we do not call it.
//   - What's set here (expense_review_queue.paid/"paidDate") is purely "has whoever runs
//     bill-pay actually settled this bill outside the app" — visible only in this review
//     queue, never reflected back onto fin_expenses. If that needs to show inside Finance
//     itself later, it requires its own schema change to fin_expenses — out of scope here.
router.post('/bulk-mark-paid', async (req, res) => {
  const userId = req.user.id;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'items required' });
  const paidDate = req.body.paidDate || new Date().toISOString().slice(0, 10);

  const results = [];
  for (const id of items) {
    const dbClient = await pool.connect();
    try {
      await dbClient.query('BEGIN');
      const { rows } = await dbClient.query(
        `SELECT * FROM expense_review_queue WHERE id=$1 AND "userId"=$2 FOR UPDATE`,
        [id, userId]
      );
      const queueRow = rows[0];
      if (!queueRow) { await dbClient.query('ROLLBACK'); results.push({ id, ok: false, error: 'not found' }); continue; }

      let expenseId = queueRow.expenseId;
      if (!queueRow.expenseCreated) {
        const expense = await createExpenseForQueueRow(dbClient, userId, queueRow);
        expenseId = expense.id;
      }

      await dbClient.query(
        `UPDATE expense_review_queue SET paid=TRUE, "paidDate"=$1, "updatedAt"=NOW() WHERE id=$2`,
        [paidDate, id]
      );
      await dbClient.query('COMMIT');
      results.push({ id, ok: true, expenseId });
    } catch (err) {
      await dbClient.query('ROLLBACK');
      results.push({ id, ok: false, error: err.message });
    } finally {
      dbClient.release();
    }
  }
  res.json({ results });
});

// GET /api/expense-review/:id/attachment — serve the saved invoice PDF (local disk, see
// expenseReviewService.saveInvoicePdf / the "s3Url" column comment in db.js).
router.get('/:id/attachment', async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT "s3Url" FROM expense_review_queue WHERE id=$1 AND "userId"=$2`,
      [req.params.id, userId]
    );
    if (!rows.length || !rows[0].s3Url) return res.status(404).json({ error: 'not found' });
    const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
    res.sendFile(path.join(UPLOAD_DIR, rows[0].s3Url));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
