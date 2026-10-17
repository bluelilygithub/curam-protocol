'use strict';

// Finance statement review: read the lines of an uploaded bank statement (fin_documents) and let the
// person approve each as business or personal, with a suggested invoice/expense match to confirm.
// Mounted by finance.js at /api/finance/statements (behind requireFeature('finance')).
//
// Reading is plain rules (server/services/bankStatement/), no model. Nothing here posts to the
// journal and the uploaded file is never changed.

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { pool } = require('../db');
const { extractPdfTextFromBuffer } = require('../utils/pdfText');
const { parseAnzPlusStatement } = require('../services/bankStatement/anzPlus');
const { suggestMatch } = require('../services/bankStatement/match');

const router = express.Router();

const DOC_DIR = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'), 'finance-docs');
const fileOf = (userId, storedName) => {
  const dir = path.resolve(DOC_DIR, String(userId));
  const p = path.resolve(dir, storedName);
  return p.startsWith(dir + path.sep) ? p : null;
};
const httpError = (status, message, extra) => Object.assign(new Error(message), { statusCode: status, ...extra });
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (!res.headersSent) res.status(err.statusCode || 500).json({ error: err.message, ...(err.extra || {}) });
  }
};

const LINE_COLS = `l.id, l."statementId", l."lineNo", l.date::text AS date, l.description, l.amount::float AS amount, l.balance::float AS balance,
  l.decision, l."matchInvoiceId", l."matchExpenseId", l."matchStrength", l."matchNote",
  i.number AS "invoiceNumber", e.description AS "expenseDescription"`;
const LINE_FROM = `fin_statement_lines l LEFT JOIN fin_invoices i ON i.id = l."matchInvoiceId" LEFT JOIN fin_expenses e ON e.id = l."matchExpenseId"`;

async function loadStatement(userId, id) {
  const { rows: [s] } = await pool.query(
    `SELECT s.id, s."documentId", s.kind, s.bank, s.product, s.bsb, s."accountNumber", s."periodStart"::text AS "periodStart",
            s."periodEnd"::text AS "periodEnd", s."openingBalance"::float AS "openingBalance", s."closingBalance"::float AS "closingBalance",
            d.title, d."originalName"
     FROM fin_statements s JOIN fin_documents d ON d.id = s."documentId"
     WHERE s.id=$1 AND s."userId"=$2`, [id, userId]);
  if (!s) return null;
  const { rows: lines } = await pool.query(`SELECT ${LINE_COLS} FROM ${LINE_FROM} WHERE l."statementId"=$1 ORDER BY l."lineNo"`, [id]);
  return { ...s, lines };
}

// Statements that exist for a set of documents (the Documents tab shows "Review lines" or "n/m reviewed").
router.get('/', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s."documentId", s.kind, s."periodStart"::text AS "periodStart", s."periodEnd"::text AS "periodEnd",
            COUNT(l.id)::int AS lines, COUNT(l.id) FILTER (WHERE l.decision <> 'pending')::int AS reviewed
     FROM fin_statements s LEFT JOIN fin_statement_lines l ON l."statementId" = s.id
     WHERE s."userId"=$1 GROUP BY s.id ORDER BY s."periodStart" DESC NULLS LAST`, [req.user.id]);
  res.json({ statements: rows });
}));

// Read the lines out of an uploaded document. One statement per document; asking again returns it.
router.post('/from-document/:docId', wrap(async (req, res) => {
  const userId = req.user.id;
  const { rows: [doc] } = await pool.query(
    `SELECT id, "storedName", "mimeType", "originalName" FROM fin_documents WHERE id=$1 AND "userId"=$2`, [req.params.docId, userId]);
  if (!doc) throw httpError(404, 'Document not found');
  const { rows: [have] } = await pool.query(`SELECT id FROM fin_statements WHERE "documentId"=$1`, [doc.id]);
  if (have) return res.json(await loadStatement(userId, have.id));

  const p = fileOf(userId, doc.storedName);
  if (!p || !fs.existsSync(p)) throw httpError(404, 'The stored file is missing');
  if (!/pdf$/i.test(doc.mimeType || '') && path.extname(doc.originalName).toLowerCase() !== '.pdf') {
    throw httpError(400, 'Only PDF statements can be read');
  }
  let text;
  try { text = await extractPdfTextFromBuffer(fs.readFileSync(p)); } catch { throw httpError(400, 'Could not read any text from this PDF (a scanned image cannot be read yet)'); }
  const flat = Array.isArray(text) ? text.join(' ') : String(text || '');
  if (!flat.trim()) throw httpError(400, 'This PDF has no text to read (a scanned image cannot be read yet)');

  const r = parseAnzPlusStatement(flat);
  if (!r.ok) throw httpError(422, `Could not read this statement reliably: ${r.problems.join('; ')}`, { problems: r.problems });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const [{ rows: invoices }, { rows: expenses }] = await Promise.all([
      client.query(`SELECT id, number, total::float AS total FROM fin_invoices
                    WHERE "userId"=$1 AND COALESCE("docType",'invoice')='invoice' AND status IN ('sent','paid')`, [userId]),
      client.query(`SELECT e.id, e.date, e.description, e.amount::float AS amount, e.gst::float AS gst, e.supplier FROM fin_expenses e
                    WHERE e."userId"=$1 AND e.date BETWEEN ($2::date - 10) AND ($3::date + 10)`, [userId, r.periodStart, r.periodEnd]),
    ]);
    const { rows: [st] } = await client.query(
      `INSERT INTO fin_statements ("userId","documentId",kind,bank,product,bsb,"accountNumber","periodStart","periodEnd","openingBalance","closingBalance")
       VALUES ($1,$2,'bank',$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [userId, doc.id, r.bank, r.product, r.bsb, r.accountNumber, r.periodStart, r.periodEnd, r.openingBalance, r.closingBalance]);
    let no = 0;
    for (const l of r.lines) {
      const m = suggestMatch(l, invoices, expenses);
      await client.query(
        `INSERT INTO fin_statement_lines ("statementId","userId","lineNo",date,description,amount,balance,"matchInvoiceId","matchExpenseId","matchStrength","matchNote")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [st.id, userId, ++no, l.date, l.description, l.amount, l.balance, m?.invoiceId || null, m?.expenseId || null, m?.strength || null, m?.note || null]);
    }
    await client.query('COMMIT');
    res.status(201).json(await loadStatement(userId, st.id));
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

// Named routes before /:id.
router.patch('/lines/:lineId', wrap(async (req, res) => {
  const userId = req.user.id;
  const { rows: [line] } = await pool.query(`SELECT id, "statementId" FROM fin_statement_lines WHERE id=$1 AND "userId"=$2`, [req.params.lineId, userId]);
  if (!line) throw httpError(404, 'Line not found');
  const { decision } = req.body || {};
  if (!['pending', 'business', 'personal'].includes(decision)) throw httpError(400, 'decision must be pending, business or personal');
  // personal lines are not matched to anything; a changed match must be one of this person's own records
  let inv = null; let exp = null; let keepMatch = true;
  if (req.body.matchInvoiceId !== undefined || req.body.matchExpenseId !== undefined) {
    keepMatch = false;
    if (req.body.matchInvoiceId) {
      const { rows } = await pool.query(`SELECT id FROM fin_invoices WHERE id=$1 AND "userId"=$2`, [Number(req.body.matchInvoiceId), userId]);
      if (!rows[0]) throw httpError(400, 'That invoice does not exist');
      inv = rows[0].id;
    }
    if (req.body.matchExpenseId) {
      const { rows } = await pool.query(`SELECT id FROM fin_expenses WHERE id=$1 AND "userId"=$2`, [Number(req.body.matchExpenseId), userId]);
      if (!rows[0]) throw httpError(400, 'That expense does not exist');
      exp = rows[0].id;
    }
  }
  await pool.query(
    `UPDATE fin_statement_lines SET decision=$2, "decidedAt"=CASE WHEN $2='pending' THEN NULL ELSE NOW() END,
       "matchInvoiceId"=CASE WHEN $2='personal' THEN NULL WHEN $3::boolean THEN "matchInvoiceId" ELSE $4 END,
       "matchExpenseId"=CASE WHEN $2='personal' THEN NULL WHEN $3::boolean THEN "matchExpenseId" ELSE $5 END,
       "matchStrength"=CASE WHEN $2='personal' THEN NULL WHEN $3::boolean THEN "matchStrength" ELSE NULL END,
       "matchNote"=CASE WHEN $2='personal' THEN NULL WHEN $3::boolean THEN "matchNote" ELSE NULL END
     WHERE id=$1`, [line.id, decision, keepMatch, inv, exp]);
  const { rows: [out] } = await pool.query(`SELECT ${LINE_COLS} FROM ${LINE_FROM} WHERE l.id=$1`, [line.id]);
  res.json(out);
}));

// Approve every line still pending in one go (the bank account where everything is business).
router.post('/:id/approve-all', wrap(async (req, res) => {
  const decision = (req.body && req.body.decision) || 'business';
  if (!['business', 'personal'].includes(decision)) throw httpError(400, 'decision must be business or personal');
  const { rows: [s] } = await pool.query(`SELECT id FROM fin_statements WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
  if (!s) throw httpError(404, 'Statement not found');
  await pool.query(
    `UPDATE fin_statement_lines SET decision=$2, "decidedAt"=NOW(),
       "matchInvoiceId"=CASE WHEN $2='personal' THEN NULL ELSE "matchInvoiceId" END,
       "matchExpenseId"=CASE WHEN $2='personal' THEN NULL ELSE "matchExpenseId" END
     WHERE "statementId"=$1 AND decision='pending'`, [s.id, decision]);
  res.json(await loadStatement(req.user.id, s.id));
}));

router.get('/:id', wrap(async (req, res) => {
  const s = await loadStatement(req.user.id, req.params.id);
  if (!s) throw httpError(404, 'Statement not found');
  res.json(s);
}));

// Forget the reviewed lines (the document itself stays). Re-reading starts afresh.
router.delete('/:id', wrap(async (req, res) => {
  const { rowCount } = await pool.query(`DELETE FROM fin_statements WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
  if (!rowCount) throw httpError(404, 'Statement not found');
  res.json({ ok: true });
}));

module.exports = router;
