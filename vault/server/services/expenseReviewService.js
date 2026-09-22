'use strict';

// Shared pipeline behind the invoice/bill review queue (expense_review_queue). Both
// server/scripts/backfillInvoiceReview.js (one-time, 6-month backfill) and
// server/cron/expenseReviewCron.js (hourly, incremental) call runPoll() so the two never
// diverge into separate implementations. Reuses Inbox Intel's classifier and PDF extraction
// from server/routes/gmail.js — this file does not reimplement Gmail auth, classification,
// or LLM extraction.

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const {
  getAuthClient,
  fetchAllInboxEmailsSince,
  classifyEmailBatch,
  findFirstPdfAttachment,
  extractInvoiceFromPdf,
} = require('../routes/gmail');
const { google } = require('googleapis');

const UPLOAD_DIR   = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const INVOICE_DIR  = path.join(UPLOAD_DIR, 'invoices');

function safeFilenamePart(s) {
  return String(s || 'invoice').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60) || 'invoice';
}

// Sender is typically "Name <billing@vendor.com>" or a bare address — pull the domain either way.
function senderDomain(sender) {
  const match = String(sender || '').match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return match ? match[1].toLowerCase() : null;
}

async function getPriorityDomains(userId) {
  const { rows } = await pool.query(
    `SELECT value FROM settings WHERE "userId"=$1 AND key='expense_review_priority_domains'`, [userId]
  ).catch(() => ({ rows: [] }));
  return String(rows[0]?.value || '')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
}

// Persists PDF bytes to UPLOAD_DIR/invoices/{year}/{month}/{vendor-or-id}.pdf and returns
// the path stored in expense_review_queue."s3Url". NOTE: this app has no S3 integration —
// the column is named s3Url only to match the original feature spec/FK naming; it always
// holds a local disk path under UPLOAD_DIR, not an actual S3 url. See db.js comment on
// the column itself.
function saveInvoicePdf(pdfBase64, { vendor, gmailMessageId, date }) {
  const d = date ? new Date(date) : new Date();
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const dir = path.join(INVOICE_DIR, year, month);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${safeFilenamePart(vendor || gmailMessageId)}-${gmailMessageId.slice(0, 8)}.pdf`;
  const fullPath = path.join(dir, filename);
  const standardBase64 = pdfBase64.replace(/-/g, '+').replace(/_/g, '/');
  fs.writeFileSync(fullPath, Buffer.from(standardBase64, 'base64'));
  // Store path relative to UPLOAD_DIR, same convention as fin_expenses.receipt_path.
  return path.relative(UPLOAD_DIR, fullPath).split(path.sep).join('/');
}

// Paginated sweep of inbox emails since `afterDate` ('YYYY-MM-DD', required), run through
// Inbox Intel's is_expense classifier, without touching anything that isn't already flagged.
// Uses fetchAllInboxEmailsSince (real Gmail pageToken pagination + server-side `after:` date
// filter) rather than a single-page fetch-then-filter — a single page silently misses history
// once the inbox has more threads than one page covers.
async function findInvoiceCandidates(userId, { afterDate }) {
  const logPrefix = `[expense-review] user=${userId}`;
  const emails = await fetchAllInboxEmailsSince(userId, afterDate);
  if (!emails.length) return [];

  const threadIds = emails.map(e => e.threadId);
  const { rows: stored } = await pool.query(
    `SELECT "threadId", "lastMessageId", category, "oneLine", actioned, "isExpense", acknowledged
     FROM gmail_classifications WHERE "userId"=$1 AND "threadId"=ANY($2)`,
    [userId, threadIds]
  ).catch(() => ({ rows: [] }));
  const storedMap = new Map(stored.map(r => [r.threadId, r]));

  const needsClassification = emails.filter(e => {
    const s = storedMap.get(e.threadId);
    return !s || s.lastMessageId !== e.id;
  });

  const { classificationFailed, classificationError } = await classifyEmailBatch(userId, needsClassification, storedMap, logPrefix);
  if (classificationFailed) {
    console.warn(`${logPrefix} classification batch failed: ${classificationError || 'no JSON in response'}`);
  }

  // Priority vendor domains (Settings → Inbox Intel) bypass the classifier's judgment call —
  // a borderline/ambiguous email from a known vendor is never silently skipped just because the
  // LLM called it noise/fyi. Domain match forces isExpense true and persists it, same as a real
  // classification, so subsequent runs don't need to re-check.
  const priorityDomains = await getPriorityDomains(userId);
  if (priorityDomains.length) {
    const forced = emails.filter(e => {
      const domain = senderDomain(e.sender);
      const s = storedMap.get(e.threadId);
      return domain && priorityDomains.includes(domain) && s && !s.isExpense;
    });
    if (forced.length) {
      await pool.query(
        `UPDATE gmail_classifications SET "isExpense"=TRUE WHERE "userId"=$1 AND "threadId"=ANY($2)`,
        [userId, forced.map(e => e.threadId)]
      ).catch(err => console.error(`${logPrefix} priority-domain override error:`, err.message));
      for (const e of forced) {
        const s = storedMap.get(e.threadId);
        storedMap.set(e.threadId, { ...s, isExpense: true });
      }
      console.log(`${logPrefix} priority-domain override forced isExpense on ${forced.length} thread(s)`);
    }
  }

  return emails.filter(e => storedMap.get(e.threadId)?.isExpense);
}

// Given one invoice-flagged email, dedupe/extract/save/queue it. Returns
// { inserted: bool, reason?: string, row? } — never throws (caller loops many emails).
async function extractAndQueue(userId, email) {
  const logPrefix = `[expense-review] user=${userId} msg=${email.id}`;
  try {
    const { rows: existing } = await pool.query(
      `SELECT id FROM expense_review_queue WHERE "userId"=$1 AND "gmailMessageId"=$2`,
      [userId, email.id]
    );
    if (existing.length) return { inserted: false, reason: 'duplicate' };

    const oauth2Client = await getAuthClient(userId);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const { pdfBase64 } = await findFirstPdfAttachment(gmail, email.threadId, logPrefix);
    if (!pdfBase64) return { inserted: false, reason: 'no_pdf_attachment' };

    const extraction = await extractInvoiceFromPdf(userId, pdfBase64, logPrefix);
    if (!extraction.extracted) return { inserted: false, reason: extraction.reason || extraction.error || 'extraction_failed' };

    const s3Url = saveInvoicePdf(pdfBase64, {
      vendor: extraction.supplier,
      gmailMessageId: email.id,
      date: extraction.invoiceDate,
    });

    const { rows } = await pool.query(
      `INSERT INTO expense_review_queue
         ("userId","gmailMessageId","threadId",vendor,amount,"invoiceDate",category,"s3Url","rawExtraction","reviewStatus")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
       ON CONFLICT ("userId","gmailMessageId") DO NOTHING
       RETURNING *`,
      [
        userId, email.id, email.threadId,
        extraction.supplier || null,
        // Foreign-currency invoices (USD, etc.) are NOT pre-filled into amount — the real AUD
        // figure only exists on the actual credit-card statement (FX rate + fees the invoice
        // itself doesn't show), so a raw USD number here would be silently wrong if approved
        // as-is. Left null to force a manual entry in the review UI; the extracted foreign
        // amount/currency is still visible via rawExtraction for reference.
        (extraction.currency === 'AUD' && extraction.amount) ? parseFloat(extraction.amount) : null,
        extraction.invoiceDate || null,
        extraction.category || null,
        s3Url,
        JSON.stringify(extraction),
      ]
    );
    if (!rows.length) return { inserted: false, reason: 'duplicate' };
    return { inserted: true, row: rows[0] };
  } catch (err) {
    console.error(`${logPrefix} extractAndQueue error:`, err.message);
    return { inserted: false, reason: err.message };
  }
}

// Orchestrates candidates -> extractAndQueue for one user. `afterDate` ('YYYY-MM-DD') is
// required — both the backfill script and the cron's first-run lookback compute it explicitly
// rather than relying on any implicit default here. Returns a summary used by both the
// backfill script (for its printed report) and the cron job (for logging).
async function runPoll(userId, { afterDate, dryRun = false }) {
  const candidates = await findInvoiceCandidates(userId, { afterDate });
  let inserted = 0;
  let skippedDuplicate = 0;
  let skippedOther = 0;
  const insertedRows = [];

  for (const email of candidates) {
    if (dryRun) {
      const { rows: existing } = await pool.query(
        `SELECT id FROM expense_review_queue WHERE "userId"=$1 AND "gmailMessageId"=$2`,
        [userId, email.id]
      );
      if (existing.length) { skippedDuplicate++; continue; }
      insertedRows.push({ id: email.id, subject: email.subject, sender: email.sender });
      inserted++;
      continue;
    }
    const result = await extractAndQueue(userId, email);
    if (result.inserted) { inserted++; insertedRows.push(result.row); }
    else if (result.reason === 'duplicate') skippedDuplicate++;
    else skippedOther++;
  }

  return { matched: candidates.length, inserted, skippedDuplicate, skippedOther, insertedRows };
}

module.exports = { runPoll, findInvoiceCandidates, extractAndQueue, saveInvoicePdf, INVOICE_DIR };
