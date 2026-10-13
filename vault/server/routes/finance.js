'use strict';

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const UPLOAD_DIR   = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const RECEIPT_DIR  = path.join(UPLOAD_DIR, 'receipts');

// Load Curam logo once at startup for inline email embedding
const LOGO_PATH = path.join(__dirname, '../assets/curam-ai-logo.png');
const LOGO_DATA_URI = (() => {
  try {
    const data = fs.readFileSync(LOGO_PATH);
    console.log(`[finance] Logo loaded OK — ${LOGO_PATH} (${data.length} bytes)`);
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch (e) {
    console.warn(`[finance] Logo not found at ${LOGO_PATH} — email will render without it`);
    return null;
  }
})();

const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(RECEIPT_DIR, { recursive: true });
      cb(null, RECEIPT_DIR);
    },
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const ext    = path.extname(file.originalname).toLowerCase();
      cb(null, `${unique}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg','image/png','image/gif','image/webp','application/pdf'];
    cb(null, ok.includes(file.mimetype));
  },
});
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');
const { captureIf, makeFingerprint } = require('../services/SuggestionService');

async function getWorkspaceTimezone() {
  try {
    const { rows } = await pool.query(
      `SELECT s.value FROM settings s
       JOIN users u ON u.id = s."userId"
       WHERE s.key = 'user_timezone' AND u."isAdmin" = TRUE
       ORDER BY u.id ASC LIMIT 1`
    );
    return rows[0]?.value?.trim() || 'Australia/Sydney';
  } catch {
    return 'Australia/Sydney';
  }
}

function getDateInTz(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// "Today" as YYYY-MM-DD in the workspace timezone. new Date().toISOString() is UTC, which dates
// anything entered before ~10am in Brisbane as yesterday (and can land it in the wrong BAS quarter).
async function todayStr() {
  return getDateInTz(await getWorkspaceTimezone());
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function nextInvoiceNumber(userId, docType = 'invoice') {
  const year   = new Date().getFullYear();
  const prefix = docType === 'quote' ? `Q-${year}-` : `INV-${year}`;
  const { rows } = await pool.query(
    `SELECT number FROM fin_invoices WHERE "userId"=$1 AND number LIKE $2 ORDER BY id DESC LIMIT 1`,
    [userId, `${prefix}%`]
  );
  if (!rows.length) return `${prefix}001`;
  const seq = parseInt(rows[0].number.slice(prefix.length), 10) || 0;
  return `${prefix}${String(seq + 1).padStart(3, '0')}`;
}

// GST registration. Settings: fin_gst_registered ('false' = no longer registered), fin_gst_ended_on
// (the cancellation effective date from the ATO notice, optional) and fin_gst_unreg_since (set by the
// server the day the box was un-ticked, used when the real date isn't known yet). GST applies to a
// document or purchase dated before that date, or at any date while registered. While not registered:
// no GST is added to invoices, and no GST credit is claimed on purchases.
async function getGstRegistration(db, userId) {
  const { rows } = await db.query(
    `SELECT key, value FROM settings WHERE "userId"=$1 AND key IN ('fin_gst_registered','fin_gst_ended_on','fin_gst_unreg_since')`, [userId]);
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const registered = m.fin_gst_registered !== 'false';
  let effectiveFrom = (m.fin_gst_ended_on && /^\d{4}-\d{2}-\d{2}$/.test(m.fin_gst_ended_on)) ? m.fin_gst_ended_on : (m.fin_gst_unreg_since || null);
  if (!registered && !effectiveFrom) {
    // flag was switched off before the date was tracked: start from today rather than rewriting history
    effectiveFrom = await todayStr();
    await db.query(
      `INSERT INTO settings ("userId", key, value) VALUES ($1,'fin_gst_unreg_since',$2) ON CONFLICT ("userId", key) DO NOTHING`, [userId, effectiveFrom]);
  }
  return { registered, effectiveFrom };
}
// Does GST apply to something dated `date`?
function gstAppliesOn(reg, date) {
  if (reg.registered) return true;
  const d = dateOnly(date);
  return !!(reg.effectiveFrom && d && d < reg.effectiveFrom);
}

function calcItemGst(item) {
  const code = item.gstCode || (item.gstApplies === false ? 'NT' : 'GST');
  return code === 'GST';
}

const DEFAULT_ACCOUNTS = [
  { code: '1000', name: 'Bank / Cash',           type: 'asset'     },
  { code: '1100', name: 'Accounts Receivable',    type: 'asset'     },
  { code: '1200', name: 'GST Paid',               type: 'asset'     },
  { code: '2000', name: 'Accounts Payable',       type: 'liability' },
  { code: '2100', name: 'Credit Card',            type: 'liability' },
  { code: '2200', name: 'GST Collected',          type: 'liability' },
  { code: '2300', name: 'Super Payable',          type: 'liability' },
  { code: '2400', name: 'PAYG Withholding Payable', type: 'liability' },
  { code: '3000', name: "Owner's Equity",         type: 'equity'    },
  { code: '3100', name: "Owner's Drawings",       type: 'equity'    },
  { code: '4000', name: 'Income',                 type: 'income'    },
  { code: '4100', name: 'Interest Income',        type: 'income'    },
  { code: '1300', name: 'Accumulated Depreciation', type: 'asset'   },
  { code: '1400', name: 'Fixed Assets',           type: 'asset'     },
  { code: '5000', name: 'Expenses',               type: 'expense'   },
  { code: '6000', name: 'Wages',                  type: 'expense'   },
  { code: '6100', name: 'Superannuation Expense', type: 'expense'   },
];

async function ensureAccounts(userId) {
  for (const a of DEFAULT_ACCOUNTS) {
    await pool.query(
      `INSERT INTO fin_accounts ("userId", code, name, type, "isSystem") VALUES ($1,$2,$3,$4,true)
       ON CONFLICT ("userId", code) DO NOTHING`,
      [userId, a.code, a.name, a.type]
    );
  }
}

const DEFAULT_TX_CODES = [
  { code: 'INC-100', name: 'Consulting / Professional Services', type: 'income'  },
  { code: 'INC-200', name: 'Product Sales',                      type: 'income'  },
  { code: 'INC-900', name: 'Other Income',                       type: 'income'  },
  { code: 'EXP-100', name: 'Advertising & Marketing',            type: 'expense' },
  { code: 'EXP-110', name: 'Bank Charges',                       type: 'expense' },
  { code: 'EXP-120', name: 'Equipment & Hardware',               type: 'expense' },
  { code: 'EXP-130', name: 'Insurance',                          type: 'expense' },
  { code: 'EXP-140', name: 'Office Supplies',                    type: 'expense' },
  { code: 'EXP-150', name: 'Professional Services',              type: 'expense' },
  { code: 'EXP-160', name: 'Software & Subscriptions',           type: 'expense' },
  { code: 'EXP-170', name: 'Travel & Accommodation',             type: 'expense' },
  { code: 'EXP-180', name: 'Utilities',                          type: 'expense' },
  { code: 'EXP-190', name: 'Vehicle',                            type: 'expense' },
  { code: 'EXP-200', name: 'Home Office',                        type: 'expense' },
  { code: 'EXP-210', name: 'Depreciation',                       type: 'expense' },
  { code: 'EXP-900', name: 'Other Expenses',                     type: 'expense' },
];

async function ensureTxCodes(userId) {
  // Always attempt the full default set (ON CONFLICT DO NOTHING is idempotent) — not just on first
  // run — so codes added to DEFAULT_TX_CODES later (e.g. EXP-190/EXP-200) backfill for existing users.
  for (const c of DEFAULT_TX_CODES) {
    await pool.query(
      `INSERT INTO fin_tx_codes ("userId", code, name, type, "isSystem") VALUES ($1,$2,$3,$4,true)
       ON CONFLICT ("userId", code) DO NOTHING`,
      [userId, c.code, c.name, c.type]
    );
  }
}

async function accountByCode(userId, code) {
  const { rows } = await pool.query(
    'SELECT id FROM fin_accounts WHERE "userId"=$1 AND code=$2', [userId, code]
  );
  return rows[0]?.id;
}

// GST collected on assets sold in the period (and the ex-GST proceeds, for G1). A disposal is a one-off
// event, so it is recognised on the disposal date on either basis.
async function disposalSalesForRange(db, userId, from, to) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM("disposalGst"),0) AS gst, COALESCE(SUM("disposalAmount" - "disposalGst"),0) AS net
     FROM fin_assets WHERE "userId"=$1 AND "disposedDate" BETWEEN $2 AND $3 AND "disposalAmount" > 0`,
    [userId, from, to]
  );
  return { gst: parseFloat(rows[0].gst), net: parseFloat(rows[0].net) };
}

// GST basis for the BAS: 'cash' (default -- sales count when paid) or 'accrual' (when invoiced).
// Setting key fin_gst_basis. Purchases follow it too: supplier bills (paid via Accounts Payable) are
// claimed when paid on a cash basis, and when dated on an accrual basis.
async function getGstBasis(db, userId) {
  const { rows } = await db.query(`SELECT value FROM settings WHERE "userId"=$1 AND key='fin_gst_basis'`, [userId]);
  return rows[0]?.value === 'accrual' ? 'accrual' : 'cash';
}

// SQL predicate: the invoices whose sales/GST belong in the period [pFrom, pTo] (param placeholders).
function gstSalesSql(basis, alias, pFrom, pTo) {
  const t = alias ? `${alias}.` : '';
  return basis === 'accrual'
    ? `${t}status IN ('sent','paid') AND COALESCE(${t}"docType",'invoice')='invoice' AND ${t}"issueDate"::date BETWEEN ${pFrom} AND ${pTo}`
    : `${t}status='paid' AND ${t}"paidAt"::date BETWEEN ${pFrom} AND ${pTo}`;
}
// The date that decides which BAS quarter an invoice belongs to (and therefore when it locks).
const gstInvoiceDateSql = (basis, alias) => {
  const t = alias ? `${alias}.` : '';
  return basis === 'accrual' ? `${t}"issueDate"::date` : `${t}"paidAt"::date`;
};
// Purchases (alias e, with pa = their paid-via account joined) and the date each is claimed.
const PURCHASES_FROM = `fin_expenses e LEFT JOIN fin_accounts pa ON pa.id = e."paidViaId"`;
const purchaseClaimDateSql = (basis) =>
  basis === 'accrual' ? 'e.date' : `(CASE WHEN pa.code = '2000' THEN e."settledDate" ELSE e.date END)`;

// GST paid/claimed for a date range. Sums fin_expenses.gst (ordinary expenses AND immediate-
// deduction asset purchases, which post through fin_expenses too) PLUS the GST line on non-immediate
// asset purchases, which post straight to the journal (type='asset_purchase') and never touch
// fin_expenses. Single source of truth for every BAS/GST-summary endpoint.
async function gstPaidForRange(userId, from, to, basisArg) {
  const basis = basisArg || await getGstBasis(pool, userId);
  const gstPaidAccountId = await accountByCode(userId, '1200');
  const [expRows, assetRows] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(e.gst),0) AS gst FROM ${PURCHASES_FROM}
       WHERE e."userId"=$1 AND ${purchaseClaimDateSql(basis)} BETWEEN $2 AND $3`,
      [userId, from, to]
    ),
    gstPaidAccountId
      ? pool.query(
          `SELECT COALESCE(SUM(l.debit),0) AS gst
           FROM fin_journal_entries e
           JOIN fin_journal_lines l ON l."entryId" = e.id
           WHERE e."userId"=$1 AND e.type='asset_purchase' AND l."accountId"=$2 AND e.date BETWEEN $3 AND $4`,
          [userId, gstPaidAccountId, from, to]
        )
      : Promise.resolve({ rows: [{ gst: 0 }] }),
  ]);
  return parseFloat((parseFloat(expRows.rows[0].gst) + parseFloat(assetRows.rows[0].gst)).toFixed(2));
}

// Round to cents and sum debit/credit sides of a lines[] array. Returns { debits, credits, balanced }.
// Epsilon (0.005) absorbs floating-point noise from repeated toFixed(2)/parseFloat round-trips —
// anything larger than half a cent is a real imbalance, not float noise.
function checkJournalBalance(lines) {
  const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;
  const debits  = round2((lines || []).reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0));
  const credits = round2((lines || []).reduce((s, l) => s + (parseFloat(l.credit) || 0), 0));
  const balanced = Math.abs(debits - credits) < 0.005;
  return { debits, credits, balanced };
}

async function createJournalEntry(client, userId, { date, description, reference, type, sourceId, lines }) {
  // Defensive final check — no code path (invoices, expenses, wages, drawings, manual journal,
  // or any future caller) may ever write an unbalanced entry to fin_journal_entries/fin_journal_lines.
  // If this throws, the bug is upstream in whoever built `lines` — fail loudly rather than corrupt the books.
  const { debits, credits, balanced } = checkJournalBalance(lines);
  if (!balanced) {
    throw new Error(
      `Journal entry does not balance: debits $${debits.toFixed(2)}, credits $${credits.toFixed(2)} ` +
      `(entry: "${description || ''}"${type ? `, type: ${type}` : ''})`
    );
  }

  const { rows } = await client.query(
    `INSERT INTO fin_journal_entries ("userId", date, description, reference, type, "sourceId")
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [userId, date, description, reference || null, type, sourceId || null]
  );
  const entryId = rows[0].id;
  for (const line of lines) {
    await client.query(
      `INSERT INTO fin_journal_lines ("entryId", "accountId", debit, credit) VALUES ($1,$2,$3,$4)`,
      [entryId, line.accountId, line.debit || 0, line.credit || 0]
    );
  }
  return entryId;
}

// The BAS quarter (if any) that is reconciled/lodged/paid and contains this date. Money-affecting
// records dated inside one must not change, or a lodged return stops matching the books.
async function lockedQuarter(db, userId, date) {
  const d = dateOnly(date);
  if (!d) return null;
  const { rows } = await db.query(
    `SELECT from_date::text AS from_date, to_date::text AS to_date, status FROM fin_bas_quarters
     WHERE "userId"=$1 AND $2::date BETWEEN from_date AND to_date AND status <> 'open' LIMIT 1`,
    [userId, d]
  );
  return rows[0] || null;
}
const lockedMsg = (q) =>
  `That date is inside a ${q.status} BAS quarter (${q.from_date} to ${q.to_date}) and can't be changed.`;

// paidViaId / accountId must be one of this user's own accounts.
async function ownsAccount(db, userId, id) {
  if (id === undefined || id === null || id === '') return true;
  const n = Number(id);
  if (!Number.isInteger(n)) return false;
  const { rows } = await db.query(`SELECT 1 FROM fin_accounts WHERE id=$1 AND "userId"=$2`, [n, userId]);
  return rows.length > 0;
}

// Undo a credit-card settlement (DR Bank, CR card). The original settlement entry may be shared by
// a whole statement payment, so it is reversed with a new entry instead of deleted.
async function reverseCcSettlement(db, userId, { creditAccountId, total, description }) {
  await ensureAccounts(userId);
  const bankId = await accountByCode(userId, '1000');
  if (!bankId || !creditAccountId || !(total > 0)) return;
  await createJournalEntry(db, userId, {
    date:        await todayStr(),
    description: `Reversal of CC payment — ${description}`,
    type:        'manual',
    lines: [
      { accountId: bankId,         debit: total, credit: 0 },
      { accountId: creditAccountId, debit: 0,    credit: total },
    ],
  });
}

async function deleteJournalForSource(dbClient, userId, sourceId, type) {
  const { rows } = await dbClient.query(
    `SELECT id FROM fin_journal_entries WHERE "userId"=$1 AND "sourceId"=$2 AND type=$3`,
    [userId, sourceId, type]
  );
  for (const row of rows) {
    await dbClient.query(`DELETE FROM fin_journal_lines WHERE "entryId"=$1`, [row.id]);
    await dbClient.query(`DELETE FROM fin_journal_entries WHERE id=$1`, [row.id]);
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

router.get('/settings', async (req, res) => {
  try {
    const keys = ['fin_gst_ended_on','fin_gst_unreg_since','fin_gst_basis','fin_biz_name','fin_abn','fin_address','fin_website','fin_bank_name','fin_account_name','fin_bsb','fin_account_number','fin_gst_registered','fin_payment_terms','fin_admin_email','fin_reminder_hour','fin_export_history','fin_vehicle_rate_per_km','fin_home_office_rate_per_hour'];
    const { rows } = await pool.query(
      `SELECT key, value FROM settings WHERE "userId"=$1 AND key = ANY($2)`,
      [req.user.id, keys]
    );
    const result = {};
    for (const r of rows) result[r.key] = r.value;
    // ATO rates change yearly and must be editable, never hardcoded in calculation code —
    // these are just sensible current-year (2025-26) fallbacks when the user hasn't set one yet.
    if (result.fin_vehicle_rate_per_km === undefined) result.fin_vehicle_rate_per_km = '0.88';
    if (result.fin_home_office_rate_per_hour === undefined) result.fin_home_office_rate_per_hour = '0.70';
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const allowed = ['fin_gst_ended_on','fin_gst_basis','fin_biz_name','fin_abn','fin_address','fin_website','fin_bank_name','fin_account_name','fin_bsb','fin_account_number','fin_gst_registered','fin_payment_terms','fin_admin_email','fin_reminder_hour','fin_vehicle_rate_per_km','fin_home_office_rate_per_hour'];
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed.includes(key)) continue;
      if (key === 'fin_gst_ended_on' && value && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        return res.status(400).json({ error: 'The GST cancellation date must be YYYY-MM-DD' });
      }
      if (key === 'fin_gst_basis') {
        if (!['cash', 'accrual'].includes(value)) return res.status(400).json({ error: 'GST basis must be "cash" or "accrual"' });
        // Switching basis re-dates every invoice's GST, which would change the figures of a quarter that
        // has already been reconciled or lodged. Only allowed while every quarter is still open.
        if (value !== (await getGstBasis(pool, req.user.id))) {
          const { rows: locked } = await pool.query(`SELECT 1 FROM fin_bas_quarters WHERE "userId"=$1 AND status <> 'open' LIMIT 1`, [req.user.id]);
          if (locked.length) return res.status(400).json({ error: 'The GST basis can\'t be changed once a BAS quarter has been reconciled, lodged or paid — it would change the figures you already reported. Talk to your accountant about switching at the start of a new period.' });
        }
      }
      await pool.query(
        `INSERT INTO settings ("userId", key, value) VALUES ($1,$2,$3)
         ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`,
        [req.user.id, key, String(value)]
      );
    }
    // Keep the tracked "not registered since" date in step with the checkbox: stamp the day it was
    // un-ticked (if no real cancellation date is known yet), and clear both dates if re-registered.
    if (req.body.fin_gst_registered === 'false' || req.body.fin_gst_registered === false) {
      await getGstRegistration(pool, req.user.id);
    } else if (req.body.fin_gst_registered === 'true' || req.body.fin_gst_registered === true) {
      await pool.query(`DELETE FROM settings WHERE "userId"=$1 AND key IN ('fin_gst_unreg_since','fin_gst_ended_on')`, [req.user.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Accounts ──────────────────────────────────────────────────────────────────

router.get('/accounts', async (req, res) => {
  try {
    await ensureAccounts(req.user.id);
    const { rows } = await pool.query(
      `SELECT * FROM fin_accounts WHERE "userId"=$1 ORDER BY code`, [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/accounts', async (req, res) => {
  try {
    await ensureAccounts(req.user.id);
    const { code, name, type } = req.body;
    if (!code?.trim() || !name?.trim() || !type) return res.status(400).json({ error: 'Code, name and type required' });
    const validTypes = ['asset','liability','equity','income','expense'];
    if (!validTypes.includes(type)) return res.status(400).json({ error: `Type must be one of: ${validTypes.join(', ')}` });
    const { rows } = await pool.query(
      `INSERT INTO fin_accounts ("userId", code, name, type) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, code.trim(), name.trim(), type]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Account code already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/accounts/:id', async (req, res) => {
  try {
    const { code, name, type } = req.body;
    if (!code?.trim() || !name?.trim() || !type) return res.status(400).json({ error: 'Code, name and type required' });
    const { rows } = await pool.query(
      `UPDATE fin_accounts SET code=$1,name=$2,type=$3,"updatedAt"=NOW()
       WHERE id=$4 AND "userId"=$5 AND "isSystem"=false RETURNING *`,
      [code.trim(), name.trim(), type, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found or system account (cannot edit)' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Account code already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/accounts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM fin_accounts WHERE id=$1 AND "userId"=$2 AND "isSystem"=false RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found or system account (cannot delete)' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'Account has journal entries and cannot be deleted' });
    res.status(500).json({ error: err.message });
  }
});

// ── Clients ───────────────────────────────────────────────────────────────────

// Post-merge: these read/write the CRM `clients` table (+ its primary
// `client_contacts` row + `client_billing_details` extension) instead of the
// retired `fin_clients` table. See docs/crm-migration.md.
const CLIENT_SELECT = `
  SELECT c.id, c.name, pc.name AS "contactName", pc.email, pc.phone,
         b.address, b.abn, (c.status != 'archived') AS "isActive"
  FROM clients c
  LEFT JOIN client_contacts pc ON pc."clientId" = c.id AND pc."isPrimary" = TRUE
  LEFT JOIN client_billing_details b ON b."clientId" = c.id
`;

router.get('/clients', async (req, res) => {
  const activeOnly = req.query.activeOnly === 'true';
  try {
    const { rows } = await pool.query(
      `${CLIENT_SELECT} WHERE c."userId"=$1 ${activeOnly ? "AND c.status = 'active'" : ''} ORDER BY c.name`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Client management (create/edit/deactivate/delete) moved fully to the CRM
// module (server/routes/clients.js) — this route is now picker-only, used
// by the invoice/quote client dropdown. See docs/crm-migration.md.

// ── Suppliers ─────────────────────────────────────────────────────────────────

router.get('/suppliers', async (req, res) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const { rows } = await pool.query(
      `SELECT * FROM fin_suppliers WHERE "userId"=$1 ${activeOnly ? 'AND "isActive"=true' : ''} ORDER BY name`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/suppliers', async (req, res) => {
  try {
    const { name, email, phone, abn, website, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { rows } = await pool.query(
      `INSERT INTO fin_suppliers ("userId", name, email, phone, abn, website, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, name.trim(), email||null, phone||null, abn||null, website||null, notes||null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/suppliers/:id', async (req, res) => {
  try {
    const { name, email, phone, abn, website, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { rows } = await pool.query(
      `UPDATE fin_suppliers SET name=$1,email=$2,phone=$3,abn=$4,website=$5,notes=$6,"updatedAt"=NOW()
       WHERE id=$7 AND "userId"=$8 RETURNING *`,
      [name.trim(), email||null, phone||null, abn||null, website||null, notes||null, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/suppliers/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE fin_suppliers SET "isActive"=NOT "isActive","updatedAt"=NOW()
       WHERE id=$1 AND "userId"=$2 RETURNING "isActive"`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ isActive: rows[0].isActive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/suppliers/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM fin_suppliers WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Transaction Codes ──────────────────────────────────────────────────────────

router.get('/tx-codes', async (req, res) => {
  try {
    await ensureTxCodes(req.user.id);
    const { type } = req.query;
    const { rows } = await pool.query(
      `SELECT * FROM fin_tx_codes WHERE "userId"=$1 ${type ? 'AND type=$2' : ''} ORDER BY code`,
      type ? [req.user.id, type] : [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tx-codes', async (req, res) => {
  try {
    const { code, name, type, description } = req.body;
    if (!code?.trim() || !name?.trim() || !type) return res.status(400).json({ error: 'Code, name and type required' });
    if (!['income','expense'].includes(type)) return res.status(400).json({ error: 'Type must be income or expense' });
    const { rows } = await pool.query(
      `INSERT INTO fin_tx_codes ("userId", code, name, type, description)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, code.trim().toUpperCase(), name.trim(), type, description||null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Code already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/tx-codes/:id', async (req, res) => {
  try {
    const { code, name, type, description } = req.body;
    if (!code?.trim() || !name?.trim() || !type) return res.status(400).json({ error: 'Code, name and type required' });
    const { rows } = await pool.query(
      `UPDATE fin_tx_codes SET code=$1,name=$2,type=$3,description=$4,"updatedAt"=NOW()
       WHERE id=$5 AND "userId"=$6 AND "isSystem"=false RETURNING *`,
      [code.trim().toUpperCase(), name.trim(), type, description||null, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found or system code (cannot edit)' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Code already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/tx-codes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE fin_tx_codes SET "isActive"=NOT "isActive","updatedAt"=NOW()
       WHERE id=$1 AND "userId"=$2 RETURNING "isActive"`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ isActive: rows[0].isActive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/tx-codes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM fin_tx_codes WHERE id=$1 AND "userId"=$2 AND "isSystem"=false RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found or system code (cannot delete)' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Invoices ──────────────────────────────────────────────────────────────────

// Statuses a caller may set directly. 'paid' is deliberately absent: it only ever happens through
// POST /invoices/:id/mark-paid, which also posts the payment journal and stamps paidAt.
const SETTABLE_STATUSES = {
  invoice: ['draft', 'sent', 'void'],
  quote:   ['draft', 'sent', 'declined', 'accepted'],
};

// Journal for an issued invoice: DR AR, CR Income, CR GST Collected. Replaces any existing one.
async function postInvoiceJournal(dbClient, userId, inv, description) {
  await ensureAccounts(userId);
  const arId     = await accountByCode(userId, '1100');
  const incId    = await accountByCode(userId, '4000');
  const gstColId = await accountByCode(userId, '2200');
  await deleteJournalForSource(dbClient, userId, inv.id, 'invoice');
  if (!(arId && incId && gstColId)) return;
  await createJournalEntry(dbClient, userId, {
    date:        dateOnly(inv.issueDate) || await todayStr(),
    description: description || `Invoice ${inv.number}`,
    reference:   inv.number,
    type:        'invoice',
    sourceId:    inv.id,
    lines: [
      { accountId: arId,     debit: inv.total,    credit: 0 },
      { accountId: incId,    debit: 0,            credit: inv.subtotal },
      { accountId: gstColId, debit: 0,            credit: inv.gst },
    ],
  });
}

router.get('/invoices', async (req, res) => {
  try {
    const basis = await getGstBasis(pool, req.user.id);
    const { rows } = await pool.query(
      `SELECT i.*, cr.name AS "clientName",
              (SELECT cc.email FROM client_contacts cc
               WHERE cc."clientId" = cr.id AND cc.email IS NOT NULL
               ORDER BY cc."isPrimary" DESC, cc.id ASC LIMIT 1
              ) AS "clientEmail",
              EXISTS (
                SELECT 1 FROM fin_bas_quarters q
                WHERE q."userId" = i."userId"
                  AND ${gstInvoiceDateSql(basis, 'i')} BETWEEN q.from_date AND q.to_date
                  AND (i.status = 'paid' OR (${basis === 'accrual' ? 'TRUE' : 'FALSE'} AND i.status = 'sent'))
                  AND q.status != 'open'
              ) AS "isLocked"
       FROM fin_invoices i
       LEFT JOIN clients cr ON cr.id = i."clientRef"
       WHERE i."userId"=$1
       ORDER BY i."issueDate" DESC, i.id DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/invoices', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userId = req.user.id;
    await client.query('SELECT pg_advisory_xact_lock(7001, $1)', [userId]); // number allocation
    const { clientRef, issueDate, dueDate, notes, items = [], docType = 'invoice' } = req.body;

    let subtotal = 0, gst = 0;
    const gstOn = gstAppliesOn(await getGstRegistration(client, userId), issueDate || await todayStr());
    for (const item of items) {
      const qty     = parseFloat(item.qty) || 0;
      const up      = parseFloat(item.unitPrice) || 0;
      const amt     = parseFloat((qty * up).toFixed(2));
      const taxable = gstOn && calcItemGst(item);
      const itemGst = taxable ? parseFloat((amt * 0.1).toFixed(2)) : 0;
      item._qty     = qty;
      item._up      = up;
      item._amount  = amt;
      item._gst     = itemGst;
      item._gstCode = taxable ? 'GST' : (item.gstCode && item.gstCode !== 'GST' ? item.gstCode : 'NT');
      subtotal += amt;
      gst      += itemGst;
    }
    subtotal = parseFloat(subtotal.toFixed(2));
    gst      = parseFloat(gst.toFixed(2));
    const total = parseFloat((subtotal + gst).toFixed(2));

    const number = await nextInvoiceNumber(userId, docType);
    const { rows } = await client.query(
      `INSERT INTO fin_invoices ("userId","clientRef",number,status,"issueDate","dueDate",subtotal,gst,total,notes,"docType")
       VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [userId, clientRef||null, number, issueDate||await todayStr(), dueDate||null, subtotal, gst, total, notes||null, docType]
    );
    const invoice = rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO fin_invoice_items ("invoiceId", description, qty, "unitPrice", gst, amount, "txCodeId", "gstCode")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [invoice.id, item.description || '', item._qty, item._up, item._gst, item._amount, item.txCodeId||null, item._gstCode]
      );
    }

    // Quotes and draft invoices are not accounting transactions yet — journals post on send
    await client.query('COMMIT');
    res.json(invoice);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get('/invoices/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, cr.name AS "clientName",
              pc.email   AS "clientEmail",
              cb.address AS "clientAddress",
              cb.abn     AS "clientAbn"
       FROM fin_invoices i
       LEFT JOIN clients cr ON cr.id = i."clientRef"
       LEFT JOIN client_contacts pc ON pc."clientId" = cr.id AND pc."isPrimary" = TRUE
       LEFT JOIN client_billing_details cb ON cb."clientId" = cr.id
       WHERE i.id=$1 AND i."userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const invoice = rows[0];
    const { rows: items } = await pool.query(
      `SELECT * FROM fin_invoice_items WHERE "invoiceId"=$1 ORDER BY id`, [invoice.id]
    );
    invoice.items = items;
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/invoices/:id/pdf', async (req, res) => {
  try {
    const userId    = req.user.id;
    const invoiceId = req.params.id;

    const { rows } = await pool.query(
      `SELECT i.*, cr.name AS "clientName",
              pc.name    AS "clientContactName",
              pc.email   AS "clientEmail",
              cb.address AS "clientAddress",
              cb.abn     AS "clientAbn"
       FROM fin_invoices i
       LEFT JOIN clients cr ON cr.id = i."clientRef"
       LEFT JOIN client_contacts pc ON pc."clientId" = cr.id AND pc."isPrimary" = TRUE
       LEFT JOIN client_billing_details cb ON cb."clientId" = cr.id
       WHERE i.id=$1 AND i."userId"=$2`,
      [invoiceId, userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const invoice = rows[0];

    const { rows: items } = await pool.query(
      `SELECT * FROM fin_invoice_items WHERE "invoiceId"=$1 ORDER BY id`, [invoice.id]
    );

    const client = {
      name:        invoice.clientName,
      contactName: invoice.clientContactName,
      email:       invoice.clientEmail,
      address:     invoice.clientAddress,
      abn:         invoice.clientAbn,
    };

    const settingKeys = ['fin_biz_name','fin_abn','fin_address','fin_website','fin_bank_name','fin_account_name','fin_bsb','fin_account_number'];
    const { rows: settingRows } = await pool.query(
      `SELECT key, value FROM settings WHERE "userId"=$1 AND key = ANY($2)`,
      [userId, settingKeys]
    );
    const cfg = {};
    for (const r of settingRows) cfg[r.key] = r.value;

    const { generateInvoicePdf } = require('../services/invoicePdf');
    const buffer = await generateInvoicePdf(invoice, items, client, cfg);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.number}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error('[PDF]', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/invoices/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userId    = req.user.id;
    const invoiceId = req.params.id;
    const { clientRef, issueDate, dueDate, notes, status, paidAt, items = [], txCodeId } = req.body;

    const { rows: check } = await client.query(
      `SELECT id, number, status, "paidAt", "issueDate", "docType" FROM fin_invoices WHERE id=$1 AND "userId"=$2`, [invoiceId, userId]
    );
    if (!check[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }

    // An invoice is locked once the date that decides its BAS quarter (payment date on a cash basis,
    // issue date on an accrual basis) falls inside a reconciled/lodged/paid quarter.
    const putBasis = await getGstBasis(client, userId);
    if (check[0].docType !== 'quote' && ((putBasis === 'cash' && check[0].status === 'paid') || (putBasis === 'accrual' && ['sent', 'paid'].includes(check[0].status)))) {
      const dates = putBasis === 'accrual'
        ? [check[0].issueDate, issueDate]
        : [paidAt || check[0].paidAt];
      for (const d of dates) {
        const lq = await lockedQuarter(client, userId, d);
        if (lq) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Invoice is locked — ${putBasis === 'accrual' ? 'its issue date' : 'its payment date'} falls within a ${lq.status} BAS quarter` });
        }
      }
    }

    let subtotal = 0, gst = 0;
    const gstOn = gstAppliesOn(await getGstRegistration(client, userId), issueDate || check[0].issueDate);
    for (const item of items) {
      const qty     = parseFloat(item.qty) || 0;
      const up      = parseFloat(item.unitPrice) || 0;
      const amt     = parseFloat((qty * up).toFixed(2));
      const taxable = gstOn && calcItemGst(item);
      const itemGst = taxable ? parseFloat((amt * 0.1).toFixed(2)) : 0;
      item._qty     = qty;
      item._up      = up;
      item._amount  = amt;
      item._gst     = itemGst;
      item._gstCode = taxable ? 'GST' : (item.gstCode && item.gstCode !== 'GST' ? item.gstCode : 'NT');
      subtotal += amt;
      gst      += itemGst;
    }
    subtotal = parseFloat(subtotal.toFixed(2));
    gst      = parseFloat(gst.toFixed(2));
    const total = parseFloat((subtotal + gst).toFixed(2));

    const isPaid      = check[0].status === 'paid';
    const isQuoteDoc  = check[0].docType === 'quote';
    const allowed     = SETTABLE_STATUSES[isQuoteDoc ? 'quote' : 'invoice'];
    // A paid invoice stays paid here; anything else must be a settable status. 'paid' can't be
    // set via edit (use mark-paid) — it used to slip through with no paidAt and no payment journal.
    if (!isPaid && status && !allowed.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: status === 'paid'
          ? "Use \"Paid\" (mark-paid) to record a payment — it can't be set by editing."
          : `Invalid status "${status}"`,
      });
    }
    const newStatus   = isPaid ? 'paid' : (status || 'draft');
    const newPaidAt   = isPaid ? (paidAt || check[0].paidAt) : null;

    await client.query(
      `UPDATE fin_invoices
       SET "clientRef"=$1,"issueDate"=$2,"dueDate"=$3,subtotal=$4,gst=$5,total=$6,
           notes=$7,status=$8,"paidAt"=$9,"updatedAt"=NOW()
       WHERE id=$10 AND "userId"=$11`,
      [clientRef||null, issueDate, dueDate||null, subtotal, gst, total,
       notes||null, newStatus, newPaidAt, invoiceId, userId]
    );
    await client.query(`DELETE FROM fin_invoice_items WHERE "invoiceId"=$1`, [invoiceId]);
    for (const item of items) {
      await client.query(
        `INSERT INTO fin_invoice_items ("invoiceId", description, qty, "unitPrice", gst, amount, "txCodeId", "gstCode")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [invoiceId, item.description || '', item._qty, item._up, item._gst, item._amount, item.txCodeId||null, item._gstCode]
      );
    }

    const isQuote = check[0].docType === 'quote';
    const invNum  = check[0].number;

    if (!isQuote) {
      if (newStatus === 'sent' || newStatus === 'paid') {
        // Issued invoice: (re)build AR / Income / GST from the edited totals.
        await postInvoiceJournal(client, userId, {
          id: parseInt(invoiceId), number: invNum, issueDate, total, subtotal, gst,
        });
      } else {
        // Draft or void is not an accounting transaction: drop any journal left from an earlier
        // send (or from an old convert-from-quote) so edits/voids can't leave stale income/AR.
        await deleteJournalForSource(client, userId, parseInt(invoiceId), 'invoice');
      }

      // For paid invoices, also recreate the payment journal entry (Bank / AR)
      if (isPaid) {
        await ensureAccounts(userId);
        const bankId = await accountByCode(userId, '1000');
        const arId   = await accountByCode(userId, '1100');
        if (bankId && arId) {
          await deleteJournalForSource(client, userId, parseInt(invoiceId), 'payment');
          await createJournalEntry(client, userId, {
            date:        newPaidAt,
            description: `Payment received — ${invNum}`,
            reference:   invNum,
            type:        'payment',
            sourceId:    parseInt(invoiceId),
            lines: [
              { accountId: bankId, debit: total,  credit: 0 },
              { accountId: arId,   debit: 0,      credit: total },
            ],
          });
        }
      }
    }

    await client.query('COMMIT');
    const { rows } = await pool.query(`SELECT * FROM fin_invoices WHERE id=$1`, [invoiceId]);
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/invoices/:id/send', async (req, res) => {
  try {
    const userId    = req.user.id;
    const invoiceId = req.params.id;
    const overrideTo = req.body.to || null;
    const message    = (req.body.message || '').trim();
    if (overrideTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(overrideTo)) {
      return res.status(400).json({ error: 'Invalid email address in "to"' });
    }

    // Load invoice + items + client
    const { rows } = await pool.query(
      `SELECT i.*,
              cr.name AS "clientName",
              (SELECT cc.email FROM client_contacts cc
               WHERE cc."clientId" = cr.id AND cc.email IS NOT NULL
               ORDER BY cc."isPrimary" DESC, cc.id ASC LIMIT 1
              ) AS "clientEmail",
              cb.address AS "clientAddress",
              cb.abn     AS "clientAbn"
       FROM fin_invoices i
       LEFT JOIN clients cr ON cr.id = i."clientRef"
       LEFT JOIN client_billing_details cb ON cb."clientId" = cr.id
       WHERE i.id=$1 AND i."userId"=$2`,
      [invoiceId, userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const inv = rows[0];

    const { rows: items } = await pool.query(
      `SELECT * FROM fin_invoice_items WHERE "invoiceId"=$1 ORDER BY id`, [invoiceId]
    );

    const to = overrideTo || inv.clientEmail;
    if (!to) return res.status(400).json({ error: 'No email address — supply one in the request body' });

    // Load finance settings
    const settingKeys = ['fin_biz_name','fin_abn','fin_address','fin_website','fin_bank_name','fin_bsb','fin_account_number','fin_admin_email'];
    const { rows: settings } = await pool.query(
      `SELECT key, value FROM settings WHERE "userId"=$1 AND key = ANY($2)`,
      [userId, settingKeys]
    );
    const cfg = {};
    for (const r of settings) cfg[r.key] = r.value;

    const logoDataUri = LOGO_DATA_URI;

    const fmtAud = (n) =>
      new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n || 0);

    const escHtml = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');

    // Fix: pg returns date columns as JS Date objects — use UTC methods to avoid TZ shift
    const fmtDate = (d) => {
      if (!d) return '—';
      const dt = d instanceof Date ? d : new Date(d);
      if (isNaN(dt.getTime())) return '—';
      // Use UTC date parts to avoid DST/timezone shifting the day
      const utcStr = new Date(dt.getTime() + dt.getTimezoneOffset() * 60000)
        .toISOString().slice(0, 10);
      return new Date(utcStr + 'T00:00:00').toLocaleDateString('en-AU', {
        day: 'numeric', month: 'long', year: 'numeric',
      });
    };

    const itemRows = items.map(item => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#1f2937;white-space:pre-wrap;">${escHtml(item.description || '')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;color:#1f2937;">${item.qty}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;color:#1f2937;">${fmtAud(item.unitPrice)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;color:#1f2937;">${fmtAud(item.gst)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:600;color:#1f2937;">${fmtAud(item.amount)}</td>
      </tr>`).join('');

    const bankSection = (cfg.fin_bank_name || cfg.fin_bsb || cfg.fin_account_number) ? `
      <div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">Payment Details</p>
        ${cfg.fin_bank_name    ? `<p style="margin:0 0 4px;font-size:13px;color:#374151;">Bank: ${escHtml(cfg.fin_bank_name)}</p>` : ''}
        ${cfg.fin_bsb          ? `<p style="margin:0 0 4px;font-size:13px;color:#374151;">BSB: ${escHtml(cfg.fin_bsb)}</p>` : ''}
        ${cfg.fin_account_number ? `<p style="margin:0;font-size:13px;color:#374151;">Account: ${escHtml(cfg.fin_account_number)}</p>` : ''}
      </div>` : '';

    const isQuote    = inv.docType === 'quote';
    const showGst    = parseFloat(inv.gst) > 0 || items.some(i => (i.gstCode || 'GST') !== 'NT');
    const docLabel   = isQuote ? 'Quote' : 'Invoice';
    const addrLabel  = isQuote ? 'Quote For' : 'Bill To';
    const totalLabel = isQuote ? 'Total Value' : 'Total Due';

    const messageBlock = message ? `
      <div style="padding:16px 20px;background:#f0f9ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;margin-bottom:24px;">
        <p style="margin:0;font-size:14px;color:#1e40af;white-space:pre-wrap;">${escHtml(message)}</p>
      </div>` : '';

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f3f4f6;margin:0;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <!-- Header: table layout required for email client compatibility (no flex/grid support) -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#1f2937;">
      <tr>
        ${logoDataUri ? `<td width="64" valign="middle" style="padding:20px 0 20px 28px;">
          <img src="${logoDataUri}" alt="" width="48" height="48" border="0" style="display:block;width:48px;height:48px;object-fit:contain;">
        </td>` : ''}
        <td valign="middle" style="padding:20px 28px;">
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">${docLabel}: ${inv.number}</h1>
          ${cfg.fin_biz_name ? `<p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">${escHtml(cfg.fin_biz_name)}</p>` : ''}
        </td>
      </tr>
    </table>
    <div style="padding:28px 32px;">
      ${messageBlock}
      <!-- Row 1: who the document is for -->
      <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #e5e7eb;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">${addrLabel}</p>
        <p style="margin:0;font-size:16px;font-weight:600;color:#1f2937;">${escHtml(inv.clientName || '')}</p>
        ${inv.clientAddress ? `<p style="margin:2px 0 0;font-size:13px;color:#6b7280;">${escHtml(inv.clientAddress)}</p>` : ''}
        ${inv.clientAbn     ? `<p style="margin:2px 0 0;font-size:13px;color:#6b7280;">ABN ${escHtml(inv.clientAbn)}</p>` : ''}
      </div>
      <!-- Row 2: dates as labelled blocks in a horizontal strip -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td style="padding:12px 16px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb;width:33%;">
            <p style="margin:0 0 2px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">${isQuote ? 'Quote Date' : 'Issue Date'}</p>
            <p style="margin:0;font-size:14px;font-weight:600;color:#1f2937;">${fmtDate(inv.issueDate)}</p>
          </td>
          <td width="12"></td>
          ${inv.dueDate ? `<td style="padding:12px 16px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb;width:33%;">
            <p style="margin:0 0 2px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">${isQuote ? 'Valid Until' : 'Due Date'}</p>
            <p style="margin:0;font-size:14px;font-weight:600;color:#1f2937;">${fmtDate(inv.dueDate)}</p>
          </td>` : '<td></td>'}
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:left;border-bottom:2px solid #e5e7eb;">Description</th>
            <th style="padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:right;border-bottom:2px solid #e5e7eb;">Qty</th>
            <th style="padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:right;border-bottom:2px solid #e5e7eb;">Unit Price</th>
            <th style="padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:right;border-bottom:2px solid #e5e7eb;">GST</th>
            <th style="padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:right;border-bottom:2px solid #e5e7eb;">Amount</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;">
        <table style="width:220px;border-collapse:collapse;">
          ${showGst ? `          <tr>
            <td style="padding:4px 8px;font-size:13px;color:#6b7280;">Subtotal</td>
            <td style="padding:4px 8px;font-size:13px;text-align:right;color:#1f2937;">${fmtAud(inv.subtotal)}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px;font-size:13px;color:#6b7280;">GST (10%)</td>
            <td style="padding:4px 8px;font-size:13px;text-align:right;color:#1f2937;">${fmtAud(inv.gst)}</td>
          </tr>
          ` : ''}
          <tr style="border-top:2px solid #1f2937;">
            <td style="padding:8px 8px 4px;font-size:15px;font-weight:700;color:#1f2937;">${totalLabel}</td>
            <td style="padding:8px 8px 4px;font-size:15px;font-weight:700;text-align:right;color:#1f2937;">${fmtAud(inv.total)}</td>
          </tr>
        </table>
      </div>

      ${inv.notes ? `<p style="margin-top:20px;font-size:13px;color:#6b7280;">${escHtml(inv.notes)}</p>` : ''}
      ${bankSection}
    </div>
    <div style="padding:16px 32px;background:#f9fafb;font-size:11px;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;">
      ${escHtml(cfg.fin_biz_name || '')}${cfg.fin_address ? ` &nbsp;·&nbsp; ${escHtml(cfg.fin_address)}` : ''}
    </div>
  </div>
</body>
</html>`;

    const sendEmail = require('../utils/sendEmail');
    const adminEmail = cfg.fin_admin_email || null;

    // Generate PDF and attach it so clients receive it directly in the email
    let pdfAttachment;
    try {
      const { generateInvoicePdf } = require('../services/invoicePdf');
      const pdfBuffer = await generateInvoicePdf(inv, items, {
        name:    inv.clientName,
        address: inv.clientAddress,
        abn:     inv.clientAbn,
      }, cfg);
      pdfAttachment = {
        filename:    `${inv.number}.pdf`,
        content:     pdfBuffer,
        contentType: 'application/pdf',
      };
    } catch (pdfErr) {
      console.error('[finance] PDF generation for email attachment failed:', pdfErr.message);
    }

    let sendResult;
    try {
      sendResult = await sendEmail({
        to,
        cc: adminEmail || undefined,
        subject: `${docLabel} ${inv.number}${cfg.fin_biz_name ? ` from ${cfg.fin_biz_name}` : ''}`,
        html,
        attachments: pdfAttachment ? [pdfAttachment] : undefined,
      });
      await pool.query(
        `INSERT INTO fin_invoice_send_log
           ("invoiceId","userId","sentTo",cc,provider,"messageId","pdfAttached",ok)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`,
        [invoiceId, userId, to, adminEmail || null, sendResult?.provider || null, sendResult?.messageId || null, !!pdfAttachment]
      );
    } catch (sendErr) {
      await pool.query(
        `INSERT INTO fin_invoice_send_log
           ("invoiceId","userId","sentTo",cc,"pdfAttached",ok,error)
         VALUES ($1,$2,$3,$4,$5,FALSE,$6)`,
        [invoiceId, userId, to, adminEmail || null, !!pdfAttachment, sendErr.message]
      ).catch(() => {});

      // Repeated send failures for the same invoice are a real anomaly (bad client email,
      // provider outage) worth surfacing rather than only logging — check for a prior failure
      // in the last 24h before this one.
      const { rows: recentFails } = await pool.query(
        `SELECT COUNT(*) AS n FROM fin_invoice_send_log
         WHERE "invoiceId"=$1 AND "userId"=$2 AND ok=FALSE AND "sentAt" > NOW() - INTERVAL '24 hours'`,
        [invoiceId, userId]
      ).catch(() => ({ rows: [{ n: 0 }] }));
      await captureIf(Number(recentFails[0]?.n || 0) >= 2, {
        userId,
        source: 'financeInvoiceSend',
        category: 'alert',
        fingerprint: makeFingerprint('financeInvoiceSend', `repeated-fail:${invoiceId}`),
        title: `${docLabel} ${inv.number} has failed to send more than once`,
        body: `Send to ${to} keeps failing (latest error: ${sendErr.message}). Check the recipient address and email provider config.`,
        context: `Finance → ${isQuote ? 'Quotes' : 'Invoices'} → ${inv.number}`,
      });

      throw sendErr;
    }

    // Mark as sent and post the invoice journal (AR / Income / GST) if not already posted
    // A paid invoice that is re-sent (e.g. a receipt copy) must stay paid.
    if (inv.status === 'paid') return res.json({ ok: true, sentTo: to });
    await pool.query(
      `UPDATE fin_invoices SET status='sent',"updatedAt"=NOW() WHERE id=$1 AND "userId"=$2`,
      [invoiceId, userId]
    );

    let journalWarning = null;
    if (!isQuote) {
      // Delete any stale draft journal then write the definitive one
      const dbClient = await pool.connect();
      try {
        await dbClient.query('BEGIN');
        await postInvoiceJournal(dbClient, userId, inv);
        await dbClient.query('COMMIT');
      } catch (journalErr) {
        await dbClient.query('ROLLBACK');
        console.error('[finance] Invoice journal on send failed:', journalErr.message);
        journalWarning = `Email sent, but the invoice could not be posted to the books (${journalErr.message}). Mark it Sent again to retry.`;
      } finally {
        dbClient.release();
      }
    }

    res.json({ ok: true, sentTo: to, ...(journalWarning ? { warning: journalWarning } : {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/invoices/:id/send-log', async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT sl.* FROM fin_invoice_send_log sl
       JOIN fin_invoices i ON i.id = sl."invoiceId"
       WHERE sl."invoiceId"=$1 AND i."userId"=$2
       ORDER BY sl."sentAt" DESC`,
      [req.params.id, userId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/invoices/:id/status', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { status } = req.body;

    const { rows: cur } = await dbClient.query(
      `SELECT * FROM fin_invoices WHERE id=$1 AND "userId"=$2 FOR UPDATE`, [req.params.id, userId]
    );
    if (!cur[0]) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const isQuote = cur[0].docType === 'quote';
    if (!SETTABLE_STATUSES[isQuote ? 'quote' : 'invoice'].includes(status)) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({
        error: status === 'paid'
          ? "Use mark-paid to record a payment — status can't be set to paid directly."
          : `Invalid status "${status}"`,
      });
    }
    if (cur[0].status === 'paid') {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: "A paid invoice's status can't be changed." });
    }

    const { rows } = await dbClient.query(
      `UPDATE fin_invoices SET status=$1,"updatedAt"=NOW() WHERE id=$2 AND "userId"=$3 RETURNING *`,
      [status, req.params.id, userId]
    );
    const inv = rows[0];

    if (!isQuote) {
      if (status === 'sent') {
        await postInvoiceJournal(dbClient, userId, inv);
      } else {
        // draft / void: not (or no longer) an accounting transaction, so remove its AR/income.
        await deleteJournalForSource(dbClient, userId, inv.id, 'invoice');
      }
    }

    await dbClient.query('COMMIT');
    res.json(inv);
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.post('/invoices/:id/mark-paid', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId   = req.user.id;
    const paidDate = req.body.paidAt || await todayStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(paidDate))) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'paidAt must be YYYY-MM-DD' });
    }

    const { rows: cur } = await dbClient.query(
      `SELECT * FROM fin_invoices WHERE id=$1 AND "userId"=$2 FOR UPDATE`, [req.params.id, userId]
    );
    if (!cur[0] || cur[0].status === 'paid') {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Invoice not found or already paid' });
    }
    if (cur[0].docType === 'quote') {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: "A quote can't be marked paid — convert it to an invoice first." });
    }
    if (cur[0].status === 'void') {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: "A void invoice can't be marked paid." });
    }
    // On an accrual basis a payment doesn't move any GST, so only the cash basis locks on the payment date.
    const paidLock = (await getGstBasis(dbClient, userId)) === 'cash' ? await lockedQuarter(dbClient, userId, paidDate) : null;
    if (paidLock) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: lockedMsg(paidLock) });
    }

    const { rows } = await dbClient.query(
      `UPDATE fin_invoices SET status='paid',"paidAt"=$1,"updatedAt"=NOW()
       WHERE id=$2 AND "userId"=$3 RETURNING *`,
      [paidDate, req.params.id, userId]
    );
    const invoice = rows[0];

    // A draft has no AR/income yet. Post the invoice journal first, otherwise the payment below
    // (DR Bank, CR AR) drives AR negative and the income is never recorded.
    const { rows: existing } = await dbClient.query(
      `SELECT 1 FROM fin_journal_entries WHERE "userId"=$1 AND "sourceId"=$2 AND type='invoice' LIMIT 1`,
      [userId, invoice.id]
    );
    if (!existing.length) await postInvoiceJournal(dbClient, userId, invoice);

    // Journal: DR Bank, CR Accounts Receivable
    await ensureAccounts(userId);
    const bankId = await accountByCode(userId, '1000');
    const arId   = await accountByCode(userId, '1100');
    if (bankId && arId) {
      await createJournalEntry(dbClient, userId, {
        date:        paidDate,
        description: `Payment received — ${invoice.number}`,
        reference:   invoice.number,
        type:        'payment',
        sourceId:    invoice.id,
        lines: [
          { accountId: bankId, debit: invoice.total, credit: 0 },
          { accountId: arId,   debit: 0, credit: invoice.total },
        ],
      });
    }

    await dbClient.query('COMMIT');
    res.json(invoice);
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.post('/invoices/:id/convert', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId    = req.user.id;
    const quoteId   = req.params.id;
    await dbClient.query('SELECT pg_advisory_xact_lock(7001, $1)', [userId]); // number allocation

    const { rows: qRows } = await dbClient.query(
      `SELECT * FROM fin_invoices WHERE id=$1 AND "userId"=$2 AND "docType"='quote'`,
      [quoteId, userId]
    );
    if (!qRows[0]) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Quote not found' }); }
    const quote = qRows[0];
    if (quote.status === 'accepted') { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Quote already converted' }); }

    const { rows: qItems } = await dbClient.query(
      `SELECT * FROM fin_invoice_items WHERE "invoiceId"=$1 ORDER BY id`, [quoteId]
    );

    const number = await nextInvoiceNumber(userId, 'invoice');
    const today   = await todayStr();

    // Use the user's configured payment terms (default 7 days)
    const { rows: termRows } = await dbClient.query(
      `SELECT value FROM settings WHERE "userId"=$1 AND key='fin_payment_terms' LIMIT 1`, [userId]
    );
    const termDays = parseInt(termRows[0]?.value) || 7;
    const dueDate  = new Date(Date.now() + termDays * 86400000).toISOString().slice(0, 10);

    const quoteDate = quote.issueDate ? String(quote.issueDate).slice(0, 10) : today;
    const convertedNote = `Converted from quote ${quote.number} dated ${quoteDate}.`;
    const notes = quote.notes ? `${convertedNote}\n${quote.notes}` : convertedNote;

    const gstOnToday = gstAppliesOn(await getGstRegistration(dbClient, userId), today);
    const convItems = qItems.map(it => (!gstOnToday && (it.gstCode || 'GST') === 'GST')
      ? { ...it, gst: 0, gstCode: 'NT' } : it);
    const cSubtotal = round2(convItems.reduce((a, it) => a + parseFloat(it.amount), 0));
    const cGst      = round2(convItems.reduce((a, it) => a + parseFloat(it.gst || 0), 0));

    const { rows: invRows } = await dbClient.query(
      `INSERT INTO fin_invoices ("userId","clientRef",number,status,"issueDate","dueDate",subtotal,gst,total,notes,"docType")
       VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,'invoice') RETURNING *`,
      [userId, quote.clientRef, number, today, dueDate, cSubtotal, cGst, round2(cSubtotal + cGst), notes]
    );
    const invoice = invRows[0];

    for (const item of convItems) {
      await dbClient.query(
        `INSERT INTO fin_invoice_items ("invoiceId", description, qty, "unitPrice", gst, amount, "txCodeId", "gstCode")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [invoice.id, item.description, item.qty, item.unitPrice, item.gst, item.amount, item.txCodeId, item.gstCode || 'GST']
      );
    }

    // The new invoice is a draft: no journal until it is sent (matches POST /invoices).

    // Mark the quote as accepted
    await dbClient.query(
      `UPDATE fin_invoices SET status='accepted', "updatedAt"=NOW() WHERE id=$1`, [quoteId]
    );

    await dbClient.query('COMMIT');
    res.json({ quote: { ...quote, status: 'accepted' }, invoice });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.delete('/invoices/:id', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const id     = parseInt(req.params.id);
    const { rows: delInv } = await dbClient.query(`SELECT status, "paidAt", "issueDate", "docType" FROM fin_invoices WHERE id=$1 AND "userId"=$2`, [id, userId]);
    if (delInv[0] && delInv[0].docType !== 'quote') {
      const delBasis = await getGstBasis(dbClient, userId);
      const relevant = delBasis === 'accrual' ? ['sent', 'paid'].includes(delInv[0].status) : delInv[0].status === 'paid';
      const lq = relevant ? await lockedQuarter(dbClient, userId, delBasis === 'accrual' ? delInv[0].issueDate : delInv[0].paidAt) : null;
      if (lq) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: lockedMsg(lq) }); }
    }
    // Remove all journal entries linked to this invoice (AR/income and payment)
    await deleteJournalForSource(dbClient, userId, id, 'invoice');
    await deleteJournalForSource(dbClient, userId, id, 'payment');
    await dbClient.query(`DELETE FROM fin_invoices WHERE id=$1 AND "userId"=$2`, [id, userId]);
    await dbClient.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// ── Finance reminders (manual trigger) ───────────────────────────────────────

router.post('/reminders/test', async (req, res) => {
  try {
    const { runFinanceReminders } = require('../cron/financeRemindersCron');
    const result = await runFinanceReminders(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual trigger for the weekly digest (Suggestions + Tasks + Finance + CRM
// rollup) — lives here alongside the other admin-email test route rather than
// a new route file, same fin_admin_email settings surface.
router.post('/weekly-digest/test', async (req, res) => {
  try {
    const { runWeeklyDigest } = require('../cron/weeklyDigestCron');
    const result = await runWeeklyDigest(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Expenses ──────────────────────────────────────────────────────────────────

// Today's posted total per category — backs the "Today: $X across N entries" summary line on
// the Vehicle/Home Office cards. Vehicle/Home Office expenses carry no separate GST (see the
// route comments above), so `amount` is already the full deductible figure — no split needed.
router.get('/expenses/today-summary', async (req, res) => {
  try {
    const today = await todayStr();
    const { rows } = await pool.query(
      `SELECT category, COALESCE(SUM(amount),0)::float AS total, COUNT(*)::int AS count
       FROM fin_expenses WHERE "userId"=$1 AND date=$2 AND category IN ('Vehicle','Home Office')
       GROUP BY category`,
      [req.user.id, today]
    );
    const result = { Vehicle: { total: 0, count: 0 }, 'Home Office': { total: 0, count: 0 } };
    for (const r of rows) result[r.category] = { total: r.total, count: r.count };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/expenses/categories', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT category FROM fin_expenses WHERE "userId"=$1 AND category IS NOT NULL AND category != '' ORDER BY category`,
      [req.user.id]
    );
    res.json(rows.map(r => r.category));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ATO instant-deduction threshold — also used by the Assets register further below (moved here,
// ahead of both call sites, so it's never referenced before its own declaration).
const IMMEDIATE_DEDUCTION_THRESHOLD = 300;

// Expense rows created and owned by another feature. Editing/deleting them through the expense
// routes desyncs the asset register (accumulated depreciation, immediateExpenseId) from the books:
// a depreciation expense's journal has type 'depreciation', not 'expense', so an edit would post a
// duplicate and a delete would leave the original behind.
async function managedExpenseReason(db, exp) {
  if (exp.category === 'Depreciation' && /^Depreciation FY/.test(exp.description || '')) {
    return 'This is a depreciation entry created by the Assets register and can\'t be edited or deleted here.';
  }
  const { rows } = await db.query(`SELECT 1 FROM fin_assets WHERE "immediateExpenseId"=$1 LIMIT 1`, [exp.id]);
  if (rows.length) return 'This expense belongs to an asset in the Assets register — dispose of the asset instead.';
  return null;
}

router.get('/expenses', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM fin_expenses WHERE "userId"=$1 ORDER BY date DESC, id DESC`, [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Shared expense-create logic (insert + journal posting). Extracted so other features
// (e.g. server/routes/expenseReview.js) can create a fin_expenses row through the exact
// same accounting path instead of re-implementing the journal entry. Runs inside the
// caller-managed transaction on dbClient — caller must BEGIN/COMMIT/ROLLBACK.
async function createExpenseRecord(dbClient, userId, { date, description, amount, gstIncluded, category, supplier, txCodeId, paidViaId, isCapitalAsset, dueDate, inputTaxed }) {
  // amount = total paid (GST-inclusive when gstIncluded=true). A purchase made to produce input-taxed
  // sales (BAS label G13) earns no GST credit, so its GST is not split out.
  const totalPaid = parseFloat(amount) || 0;
  const claimGst  = gstAppliesOn(await getGstRegistration(dbClient, userId), date || await todayStr());
  const gstAmt    = gstIncluded && !inputTaxed && claimGst ? parseFloat((totalPaid / 11).toFixed(2)) : 0;
  const amt       = parseFloat((totalPaid - gstAmt).toFixed(2)); // ex-GST amount stored in amount col

  const { rows } = await dbClient.query(
    `INSERT INTO fin_expenses ("userId", date, description, amount, gst, category, supplier, "txCodeId", "paidViaId", "isCapitalAsset", "dueDate", "inputTaxed")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [userId, date||await todayStr(), description, amt, gstAmt, category||null, supplier||null, txCodeId||null, paidViaId||null, !!isCapitalAsset, dueDate || null, !!inputTaxed]
  );
  const expense = rows[0];

  // Journal: DR Expenses (ex-GST), DR GST Paid, CR <paidVia account, defaults to Bank>
  await ensureAccounts(userId);
  const expId    = await accountByCode(userId, '5000');
  const gstPaid  = await accountByCode(userId, '1200');
  const bankId   = await accountByCode(userId, '1000');
  const creditId = paidViaId || bankId;
  if (expId && creditId) {
    const lines = [
      { accountId: expId,    debit: amt,      credit: 0 },
      { accountId: creditId, debit: 0,        credit: totalPaid },
    ];
    if (gstAmt > 0 && gstPaid) lines.splice(1, 0, { accountId: gstPaid, debit: gstAmt, credit: 0 });
    await createJournalEntry(dbClient, userId, {
      date:        expense.date,
      description: `Expense: ${description}`,
      type:        'expense',
      sourceId:    expense.id,
      lines,
    });
  }

  return { expense, amt, gstAmt, totalPaid };
}

router.post('/expenses', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { date, description, amount, gstIncluded, category, supplier, txCodeId, paidViaId, isCapitalAsset, dueDate, inputTaxed } = req.body;
    if (!description || !String(description).trim()) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Description is required' }); }
    if (!(parseFloat(amount) > 0)) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Amount must be greater than zero' }); }
    if (!(await ownsAccount(dbClient, userId, paidViaId))) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Unknown "paid via" account' }); }
    const postLock = await lockedQuarter(dbClient, userId, date || await todayStr());
    if (postLock) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: lockedMsg(postLock) }); }
    const { expense, amt } = await createExpenseRecord(dbClient, userId, { date, description, amount, gstIncluded, category, supplier, txCodeId, paidViaId, isCapitalAsset, dueDate, inputTaxed });

    await dbClient.query('COMMIT');

    // Split-purchase check: identical items bought together (same date, same description) that
    // individually sit under $300 but collectively don't, may need treating as one capital
    // purchase rather than several immediate deductions — a real ATO "matching set" rule, not
    // just a nicety. This can't be verified automatically (same description could be unrelated
    // items) so it's a warning, not a block — the user still decides.
    let warning;
    if (!isCapitalAsset && amt <= IMMEDIATE_DEDUCTION_THRESHOLD) {
      const { rows: matchRows } = await pool.query(
        `SELECT COALESCE(SUM(amount),0)::float AS total, COUNT(*)::int AS count
         FROM fin_expenses WHERE "userId"=$1 AND date=$2 AND LOWER(description)=LOWER($3)`,
        [userId, expense.date, description]
      );
      const { total, count } = matchRows[0];
      if (count > 1 && total > IMMEDIATE_DEDUCTION_THRESHOLD) {
        warning = `You've now entered ${count} expenses dated ${expense.date} with the description "${description}", totaling $${total.toFixed(2)} — if these are identical/matching items bought as a set, the ATO may require treating them as one $${total.toFixed(2)} capital purchase rather than separate immediate deductions. Consider deleting these and re-entering as a single Capital Asset expense instead.`;
      }
    }

    res.json({ ...expense, warning });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.post('/expenses/cc-statement-pay', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { accountId, date, expenseIds } = req.body;

    if (!accountId || !Array.isArray(expenseIds) || !expenseIds.length) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'accountId and expenseIds required' });
    }

    const { rows: expenses } = await dbClient.query(
      `SELECT id, amount, gst FROM fin_expenses
       WHERE id = ANY($1) AND "userId"=$2 AND "paidViaId"=$3 AND "ccSettled"=false`,
      [expenseIds, userId, parseInt(accountId)]
    );

    if (!expenses.length) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'No eligible unsettled expenses found' });
    }

    const total = parseFloat(
      expenses.reduce((s, e) => s + parseFloat(e.amount) + parseFloat(e.gst || 0), 0).toFixed(2)
    );

    await ensureAccounts(userId);
    const bankId = await accountByCode(userId, '1000');
    if (!bankId) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Bank / Cash account not found' }); }

    await createJournalEntry(dbClient, userId, {
      date:        date || await todayStr(),
      description: `CC statement payment — ${expenses.length} item${expenses.length > 1 ? 's' : ''}`,
      type:        'manual',
      lines: [
        { accountId: parseInt(accountId), debit: total, credit: 0 },
        { accountId: bankId,              debit: 0,     credit: total },
      ],
    });

    await dbClient.query(
      `UPDATE fin_expenses SET "ccSettled"=true, "settledDate"=$3 WHERE id = ANY($1) AND "userId"=$2`,
      [expenses.map(e => e.id), userId, date || await todayStr()]
    );

    await dbClient.query('COMMIT');
    res.json({ ok: true, count: expenses.length, total });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.put('/expenses/:id', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId    = req.user.id;
    const expenseId = req.params.id;
    const { date, description, amount, gstIncluded, category, supplier, txCodeId, paidViaId, isCapitalAsset, dueDate, inputTaxed } = req.body;
    const totalPaid = parseFloat(amount) || 0;
    const claimGst  = date ? gstAppliesOn(await getGstRegistration(dbClient, userId), date) : true;
    const gstAmt    = gstIncluded && !inputTaxed && claimGst ? parseFloat((totalPaid / 11).toFixed(2)) : 0;
    const amt       = parseFloat((totalPaid - gstAmt).toFixed(2));

    if (!date) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Date is required' }); }
    if (!description || !String(description).trim()) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Description is required' }); }
    if (!(totalPaid > 0)) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Amount must be greater than zero' }); }
    if (!(await ownsAccount(dbClient, userId, paidViaId))) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Unknown "paid via" account' }); }

    const { rows: before } = await dbClient.query(`SELECT * FROM fin_expenses WHERE id=$1 AND "userId"=$2 FOR UPDATE`, [expenseId, userId]);
    if (!before[0]) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const managed = await managedExpenseReason(dbClient, before[0]);
    if (managed) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: managed }); }
    for (const d of [before[0].date, date]) {
      const lq = await lockedQuarter(dbClient, userId, d);
      if (lq) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: lockedMsg(lq) }); }
    }
    if (before[0].ccSettled) {
      const oldTotal = round2(parseFloat(before[0].amount) + parseFloat(before[0].gst || 0));
      if (Math.abs(oldTotal - round2(totalPaid)) >= 0.005 || String(before[0].paidViaId || '') !== String(paidViaId || '')) {
        await dbClient.query('ROLLBACK');
        return res.status(400).json({ error: 'This expense has already been paid off the card. Unsettle it before changing its amount or card.' });
      }
    }

    const { rows } = await dbClient.query(
      `UPDATE fin_expenses SET date=$1,description=$2,amount=$3,gst=$4,category=$5,supplier=$6,"txCodeId"=$7,"paidViaId"=$8,"isCapitalAsset"=$9,"dueDate"=$12,"inputTaxed"=$13,"updatedAt"=NOW()
       WHERE id=$10 AND "userId"=$11 RETURNING *`,
      [date, description, amt, gstAmt, category||null, supplier||null, txCodeId||null, paidViaId||null, !!isCapitalAsset, expenseId, userId, dueDate || null, !!inputTaxed]
    );
    if (!rows[0]) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const expense = rows[0];

    // Reverse old journal, recreate with correct amounts and payment account
    await deleteJournalForSource(dbClient, userId, parseInt(expenseId), 'expense');
    await ensureAccounts(userId);
    const expAccId = await accountByCode(userId, '5000');
    const gstPaid  = await accountByCode(userId, '1200');
    const bankId   = await accountByCode(userId, '1000');
    const creditId = paidViaId || bankId;
    if (expAccId && creditId) {
      const lines = [
        { accountId: expAccId, debit: amt,      credit: 0 },
        { accountId: creditId, debit: 0,        credit: totalPaid },
      ];
      if (gstAmt > 0 && gstPaid) lines.splice(1, 0, { accountId: gstPaid, debit: gstAmt, credit: 0 });
      await createJournalEntry(dbClient, userId, {
        date:        expense.date,
        description: `Expense: ${description}`,
        type:        'expense',
        sourceId:    parseInt(expenseId),
        lines,
      });
    }

    await dbClient.query('COMMIT');
    res.json(expense);
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.delete('/expenses/:id', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const id     = parseInt(req.params.id);
    const { rows: gone } = await dbClient.query(`SELECT * FROM fin_expenses WHERE id=$1 AND "userId"=$2 FOR UPDATE`, [id, userId]);
    if (gone[0]) {
      const managed = await managedExpenseReason(dbClient, gone[0]);
      if (managed) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: managed }); }
      const lq = await lockedQuarter(dbClient, userId, gone[0].date);
      if (lq) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: lockedMsg(lq) }); }
      // A card-settled expense also has a settlement (DR card, CR bank). Deleting only the expense
      // would strand that payment and leave the card liability negative, so reverse it.
      if (gone[0].ccSettled && gone[0].paidViaId) {
        await reverseCcSettlement(dbClient, userId, {
          creditAccountId: gone[0].paidViaId,
          total: round2(parseFloat(gone[0].amount) + parseFloat(gone[0].gst || 0)),
          description: `deleted expense ${gone[0].description}`,
        });
      }
    }
    await deleteJournalForSource(dbClient, userId, id, 'expense');
    await dbClient.query(`DELETE FROM fin_expenses WHERE id=$1 AND "userId"=$2`, [id, userId]);
    await dbClient.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// POST /finance/expenses/:id/cc-pay — settle the CC charge and mark expense as settled
router.post('/expenses/:id/cc-pay', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { date } = req.body;

    const { rows } = await dbClient.query(
      `SELECT e.*, a.id AS "creditAccountId", a.code AS "creditCode", a.name AS "creditName"
       FROM fin_expenses e
       JOIN fin_accounts a ON a.id = e."paidViaId"
       WHERE e.id=$1 AND e."userId"=$2`,
      [req.params.id, userId]
    );
    if (!rows[0]) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Expense not found' }); }
    const exp = rows[0];
    if (exp.ccSettled) { await dbClient.query('ROLLBACK'); return res.status(409).json({ error: 'CC already settled for this expense' }); }

    const bankId = await accountByCode(userId, '1000');
    if (!bankId) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Bank / Cash account (1000) not found' }); }

    const total = parseFloat(exp.amount) + parseFloat(exp.gst || 0);
    await createJournalEntry(dbClient, userId, {
      date:        date || await todayStr(),
      description: `CC payment — ${exp.description}`,
      type:        'manual',
      lines: [
        { accountId: exp.creditAccountId, debit: total, credit: 0 },
        { accountId: bankId,              debit: 0,     credit: total },
      ],
    });

    await dbClient.query(`UPDATE fin_expenses SET "ccSettled"=true, "settledDate"=$3 WHERE id=$1 AND "userId"=$2`, [req.params.id, userId, date || await todayStr()]);
    await dbClient.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// ── Expense receipts ──────────────────────────────────────────────────────────

router.post('/expenses/:id/cc-unsettle', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { rows } = await dbClient.query(
      `UPDATE fin_expenses SET "ccSettled"=false, "settledDate"=NULL WHERE id=$1 AND "userId"=$2 AND "ccSettled"=true RETURNING *`,
      [req.params.id, userId]
    );
    if (!rows[0]) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Expense not found or not settled' }); }
    // Without this the bank payment stayed in the books, so settling again paid the card twice.
    await reverseCcSettlement(dbClient, userId, {
      creditAccountId: rows[0].paidViaId,
      total: round2(parseFloat(rows[0].amount) + parseFloat(rows[0].gst || 0)),
      description: rows[0].description,
    });
    await dbClient.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// ── Expense receipts ──────────────────────────────────────────────────────────

router.post('/expenses/:id/receipt', receiptUpload.single('receipt'), async (req, res) => {
  try {
    const userId    = req.user.id;
    const expenseId = req.params.id;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Delete old receipt file if one exists
    const { rows } = await pool.query(
      `SELECT receipt_path FROM fin_expenses WHERE id=$1 AND "userId"=$2`, [expenseId, userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    if (rows[0].receipt_path) {
      const old = path.join(RECEIPT_DIR, rows[0].receipt_path);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }

    const filename = req.file.filename;
    await pool.query(
      `UPDATE fin_expenses SET receipt_path=$1,"updatedAt"=NOW() WHERE id=$2 AND "userId"=$3`,
      [filename, expenseId, userId]
    );
    res.json({ ok: true, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/expenses/:id/receipt', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT receipt_path FROM fin_expenses WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]
    );
    if (!rows[0] || !rows[0].receipt_path) return res.status(404).json({ error: 'No receipt' });
    const filePath = path.join(RECEIPT_DIR, rows[0].receipt_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/expenses/:id/receipt', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT receipt_path FROM fin_expenses WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    if (rows[0].receipt_path) {
      const filePath = path.join(RECEIPT_DIR, rows[0].receipt_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await pool.query(
      `UPDATE fin_expenses SET receipt_path=NULL,"updatedAt"=NOW() WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Home office expense-type evidence ────────────────────────────────────────
// One document per running-cost category (electricity/internet/phone/stationery) —
// the ATO fixed-rate method needs proof the cost genuinely exists, not one bill per
// claim. Uploading again for a category replaces the previous file for it.

const HOME_OFFICE_EVIDENCE_CATEGORIES = ['electricity', 'internet', 'phone', 'stationery'];

router.get('/home-office-evidence', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT category, "fileName", "uploadedAt" FROM fin_home_office_evidence WHERE "userId"=$1`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/home-office-evidence/:category', receiptUpload.single('file'), async (req, res) => {
  try {
    const userId = req.user.id;
    const category = req.params.category;
    if (!HOME_OFFICE_EVIDENCE_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${HOME_OFFICE_EVIDENCE_CATEGORIES.join(', ')}` });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { rows } = await pool.query(
      `SELECT "fileName" FROM fin_home_office_evidence WHERE "userId"=$1 AND category=$2`,
      [userId, category]
    );
    if (rows[0]?.fileName) {
      const old = path.join(RECEIPT_DIR, rows[0].fileName);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }

    await pool.query(
      `INSERT INTO fin_home_office_evidence ("userId", category, "fileName")
       VALUES ($1,$2,$3)
       ON CONFLICT ("userId", category) DO UPDATE SET "fileName"=EXCLUDED."fileName", "uploadedAt"=NOW()`,
      [userId, category, req.file.filename]
    );
    res.json({ ok: true, category, fileName: req.file.filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/home-office-evidence/:category/file', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT "fileName" FROM fin_home_office_evidence WHERE "userId"=$1 AND category=$2`,
      [req.user.id, req.params.category]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No file for this category' });
    const filePath = path.join(RECEIPT_DIR, rows[0].fileName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/home-office-evidence/:category', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT "fileName" FROM fin_home_office_evidence WHERE "userId"=$1 AND category=$2`,
      [req.user.id, req.params.category]
    );
    if (rows[0]?.fileName) {
      const filePath = path.join(RECEIPT_DIR, rows[0].fileName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await pool.query(
      `DELETE FROM fin_home_office_evidence WHERE "userId"=$1 AND category=$2`,
      [req.user.id, req.params.category]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Home office daily WFH hours log (diary/substantiation only, no journal impact) ───────────
// SEPARATE from fin_home_office_expenses above: this is a pure daily diary record for ATO
// contemporaneous-record substantiation of the fixed-rate method. It never posts a journal entry
// and has no interaction with fin_expenses/fin_journal_entries — the existing periodic "Save
// Hours" flow (POST /expenses/home-office above) is what actually posts the deduction, unchanged.
// Backs the global daily popup (client/src/components/WfhHoursPrompt.jsx, mounted in Layout.jsx).

// Weekdays (Mon–Fri) in the last 14 calendar days (excluding today, since a day isn't "unfilled"
// until it's over) that have no fin_home_office_daily_log row for this user, but only for dates
// whose financial year has `fixed_rate` locked as the home-office method — if no method is locked,
// or the locked method is actual_cost, the diary is irrelevant and gaps is always [].
router.get('/home-office-daily-log/gaps', async (req, res) => {
  try {
    const userId = req.user.id;
    const methodMap = await getMethodByYearMap(userId, 'fin_home_office_method_by_year');

    // Build the last 14 calendar days (excluding today), oldest first, then keep weekdays only.
    const candidates = [];
    for (let i = 14; i >= 1; i--) {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - i);
      const dow = d.getUTCDay(); // 0=Sun, 6=Sat
      if (dow === 0 || dow === 6) continue;
      const dateStr = d.toISOString().slice(0, 10);
      if (methodMap[finYearForDate(dateStr)] !== 'fixed_rate') continue;
      candidates.push(dateStr);
    }
    if (!candidates.length) return res.json([]);

    const { rows } = await pool.query(
      `SELECT date::text AS date FROM fin_home_office_daily_log WHERE "userId"=$1 AND date = ANY($2::date[])`,
      [userId, candidates]
    );
    const logged = new Set(rows.map(r => r.date));
    res.json(candidates.filter(d => !logged.has(d)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/home-office-daily-log', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, date::text AS date, hours, source, "postedExpenseId", "createdAt", "updatedAt"
       FROM fin_home_office_daily_log WHERE "userId"=$1 AND date >= (CURRENT_DATE - INTERVAL '60 days')
       ORDER BY date DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Diary hours not yet rolled into a posted deduction (postedExpenseId IS NULL) — this, not a
// date comparison, is the source of truth for what the periodic "Save Hours" card should
// pre-fill, since it correctly counts a backdated diary entry even if it's older than the last
// posted date. Read-only, no side effects.
router.get('/home-office-daily-log/pending', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(hours),0)::float AS hours, COUNT(*)::int AS count, MIN(date)::text AS "oldestDate"
       FROM fin_home_office_daily_log WHERE "userId"=$1 AND "postedExpenseId" IS NULL`,
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full-history CSV of the daily diary — the actual document to hand an accountant/ATO if asked
// to substantiate hours worked from home, since the card UI only ever shows a rolled-up summary.
router.get('/home-office-daily-log/export', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT date::text AS date, hours, source, "postedExpenseId", "createdAt"
       FROM fin_home_office_daily_log WHERE "userId"=$1 ORDER BY date ASC`,
      [req.user.id]
    );
    const header = 'Date,Hours,Source,Posted,LoggedAt';
    const lines = rows.map(r => [
      r.date,
      r.hours,
      r.source,
      r.postedExpenseId ? 'Yes' : 'No',
      new Date(r.createdAt).toISOString(),
    ].join(','));
    const csv = [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="home-office-hours-diary.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/home-office-daily-log', async (req, res) => {
  try {
    const userId = req.user.id;
    const { date, hours, source } = req.body;
    if (!date) return res.status(400).json({ error: 'date is required' });
    const hoursNum = parseFloat(hours);
    if (!Number.isFinite(hoursNum) || hoursNum < 0) {
      return res.status(400).json({ error: 'hours must be a number >= 0 (0 is valid — it means logged, no WFH that day)' });
    }
    const { rows } = await pool.query(
      `INSERT INTO fin_home_office_daily_log ("userId", date, hours, source)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT ("userId", date) DO UPDATE SET hours=EXCLUDED.hours, source=EXCLUDED.source, "updatedAt"=NOW()
       RETURNING id, date::text AS date, hours, source, "createdAt", "updatedAt"`,
      [userId, date, hoursNum, source === 'popup' ? 'popup' : 'manual']
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Wages ─────────────────────────────────────────────────────────────────────

router.get('/wages', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM fin_wages WHERE "userId"=$1 ORDER BY date DESC, id DESC`, [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/wages', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId  = req.user.id;
    const { date, employee, gross, tax, superAmount, net } = req.body;
    const grossAmt = parseFloat(gross) || 0;
    const taxAmt   = parseFloat(tax) || 0;
    const superAmt = parseFloat(superAmount) || 0;
    // net defaults to gross - tax when the client doesn't supply one. If it IS supplied, it must
    // equal gross - tax (to the cent) or the wage journal (DR gross, CR net, CR tax [+ super pair])
    // cannot balance — see A1's createJournalEntry() guard. Give a wages-specific explanation here
    // rather than letting the generic journal-balance error surface on what looks like a simple form.
    if (!employee || !String(employee).trim()) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Employee is required' }); }
    if (!(grossAmt > 0) || taxAmt < 0 || superAmt < 0) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Gross must be greater than zero; tax and super can\'t be negative' }); }
    const wageLock = await lockedQuarter(dbClient, userId, date || await todayStr());
    if (wageLock) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: lockedMsg(wageLock) }); }
    const expectedNet = Math.round((grossAmt - taxAmt) * 100) / 100;
    const netAmt = (net === undefined || net === null || net === '')
      ? expectedNet
      : parseFloat(net);
    if (Math.abs(netAmt - expectedNet) >= 0.005) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({
        error: `Net pay must equal gross minus tax withheld. Gross $${grossAmt.toFixed(2)} − Tax $${taxAmt.toFixed(2)} = $${expectedNet.toFixed(2)}, but $${netAmt.toFixed(2)} was entered.`,
      });
    }

    const { rows } = await dbClient.query(
      `INSERT INTO fin_wages ("userId", date, employee, gross, tax, superannuation, net)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [userId, date||await todayStr(), employee, grossAmt, taxAmt, superAmt, netAmt]
    );
    const wage = rows[0];

    // Journal: DR Wages (gross), DR Super Expense, CR Bank (net), CR PAYG Withholding Payable (tax), CR Super Payable
    await ensureAccounts(userId);
    const wagesId = await accountByCode(userId, '6000');
    const superExpId = await accountByCode(userId, '6100');
    const bankId  = await accountByCode(userId, '1000');
    const paygId  = await accountByCode(userId, '2400');
    const superLiabId = await accountByCode(userId, '2300');
    if (wagesId && bankId) {
      const lines = [
        { accountId: wagesId, debit: grossAmt, credit: 0 },
        { accountId: bankId,  debit: 0,        credit: netAmt },
      ];
      if (taxAmt > 0 && paygId)      lines.push({ accountId: paygId,      debit: 0, credit: taxAmt });
      if (superAmt > 0 && superExpId && superLiabId) {
        lines.push({ accountId: superExpId,  debit: superAmt, credit: 0 });
        lines.push({ accountId: superLiabId, debit: 0,        credit: superAmt });
      }
      await createJournalEntry(dbClient, userId, {
        date:        wage.date,
        description: `Wages: ${employee}`,
        type:        'wage',
        sourceId:    wage.id,
        lines,
      });
    }

    await dbClient.query('COMMIT');
    res.json(wage);
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.delete('/wages/:id', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const id     = parseInt(req.params.id);
    const { rows: wRow } = await dbClient.query(`SELECT date FROM fin_wages WHERE id=$1 AND "userId"=$2`, [id, userId]);
    if (wRow[0]) {
      const lq = await lockedQuarter(dbClient, userId, wRow[0].date);
      if (lq) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: lockedMsg(lq) }); }
    }
    await deleteJournalForSource(dbClient, userId, id, 'wage');
    await dbClient.query(`DELETE FROM fin_wages WHERE id=$1 AND "userId"=$2`, [id, userId]);
    await dbClient.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// ── Owner's Drawings ──────────────────────────────────────────────────────────
// A sole trader's own withdrawal from the business — NOT wages: no PAYG withholding, no super
// guarantee. It reduces equity (account 3100), it is not a business expense.

router.get('/drawings', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM fin_drawings WHERE "userId"=$1 ORDER BY date DESC, id DESC`, [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/drawings', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { date, description, amount, paidViaId } = req.body;
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Valid amount required' }); }
    if (!(await ownsAccount(dbClient, userId, paidViaId))) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Unknown "paid via" account' }); }

    await ensureAccounts(userId);
    const drawingsId = await accountByCode(userId, '3100');
    const bankId      = await accountByCode(userId, '1000');
    const creditId    = paidViaId || bankId;
    if (!drawingsId || !creditId) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Required accounts not found' });
    }

    const { rows } = await dbClient.query(
      `INSERT INTO fin_drawings ("userId", date, description, amount, "paidViaId")
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [userId, date || await todayStr(), description || null, amt, paidViaId || null]
    );
    const drawing = rows[0];

    // Journal: DR Owner's Drawings, CR Bank/whatever paidViaId account — simple two-line balanced entry
    await createJournalEntry(dbClient, userId, {
      date:        drawing.date,
      description: `Drawings${description ? `: ${description}` : ''}`,
      type:        'drawing',
      sourceId:    drawing.id,
      lines: [
        { accountId: drawingsId, debit: amt, credit: 0 },
        { accountId: creditId,   debit: 0,   credit: amt },
      ],
    });

    await dbClient.query('COMMIT');
    res.json(drawing);
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.put('/drawings/:id', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const drawingId = req.params.id;
    const { date, description, amount, paidViaId } = req.body;
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Valid amount required' }); }
    if (!date) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Date is required' }); }
    if (!(await ownsAccount(dbClient, userId, paidViaId))) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Unknown "paid via" account' }); }

    const { rows } = await dbClient.query(
      `UPDATE fin_drawings SET date=$1, description=$2, amount=$3, "paidViaId"=$4, "updatedAt"=NOW()
       WHERE id=$5 AND "userId"=$6 RETURNING *`,
      [date, description || null, amt, paidViaId || null, drawingId, userId]
    );
    if (!rows[0]) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const drawing = rows[0];

    await deleteJournalForSource(dbClient, userId, parseInt(drawingId), 'drawing');
    await ensureAccounts(userId);
    const drawingsId = await accountByCode(userId, '3100');
    const bankId      = await accountByCode(userId, '1000');
    const creditId    = paidViaId || bankId;
    if (drawingsId && creditId) {
      await createJournalEntry(dbClient, userId, {
        date:        drawing.date,
        description: `Drawings${description ? `: ${description}` : ''}`,
        type:        'drawing',
        sourceId:    drawing.id,
        lines: [
          { accountId: drawingsId, debit: amt, credit: 0 },
          { accountId: creditId,   debit: 0,   credit: amt },
        ],
      });
    }

    await dbClient.query('COMMIT');
    res.json(drawing);
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.delete('/drawings/:id', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const id     = parseInt(req.params.id);
    await deleteJournalForSource(dbClient, userId, id, 'drawing');
    await dbClient.query(`DELETE FROM fin_drawings WHERE id=$1 AND "userId"=$2`, [id, userId]);
    await dbClient.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// ── Vehicle & Home Office expense calculators ────────────────────────────────
// Thin layer on top of the normal expense journal (DR Expenses, CR Bank) so the calculated
// deductible amount still flows into P&L/BAS correctly. The method-specific detail (km, rate,
// business-use %, actual cost) is stored alongside for the accountant / substantiation record.
//
// ATO rule: the claim method (cents-per-km vs logbook; fixed-rate vs actual-cost) is chosen
// ONCE PER AUSTRALIAN FINANCIAL YEAR per claim type, never per entry. The locked method for a
// given FY is stored as a JSON map in the `settings` table (same row/key convention as the rate
// settings below) — `fin_vehicle_method_by_year` / `fin_home_office_method_by_year`, e.g.
// { "2025-26": "cents_per_km" }. Every save re-validates the entry's date resolves to a FY that
// already has a locked method, and that the requested method (if the caller sent one) matches —
// this guards against any client-side bypass or direct API call.

const { finYearForDate } = require('../utils/finYear');

async function getSettingValue(userId, key, fallback) {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE "userId"=$1 AND key=$2`, [userId, key]);
  return rows.length && rows[0].value !== null && rows[0].value !== '' ? rows[0].value : fallback;
}

async function getMethodByYearMap(userId, key) {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE "userId"=$1 AND key=$2`, [userId, key]);
  if (!rows.length) return {};
  try { return JSON.parse(rows[0].value) || {}; } catch { return {}; }
}

async function setMethodForYear(userId, key, year, method) {
  const map = await getMethodByYearMap(userId, key);
  map[year] = method;
  await pool.query(
    `INSERT INTO settings ("userId", key, value) VALUES ($1,$2,$3)
     ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, key, JSON.stringify(map)]
  );
  return map;
}

const FY_RE = /^\d{4}-\d{2}$/;

router.get('/vehicle-method', async (req, res) => {
  try {
    const map = await getMethodByYearMap(req.user.id, 'fin_vehicle_method_by_year');
    const { year } = req.query;
    if (year) return res.json({ year, method: map[year] || null });
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/vehicle-method', async (req, res) => {
  try {
    const { year, method } = req.body;
    if (!year || !FY_RE.test(year)) return res.status(400).json({ error: 'year must be like "2025-26"' });
    if (!['cents_per_km', 'logbook'].includes(method)) return res.status(400).json({ error: "method must be 'cents_per_km' or 'logbook'" });
    const map = await setMethodForYear(req.user.id, 'fin_vehicle_method_by_year', year, method);
    res.json({ year, method, all: map });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Odometer readings at the start and end of each financial year — required substantiation
// for the logbook method (business-use % is applied against total km travelled in the
// year, which needs a start/end reading on record, separate from the method choice itself).
// Same settings-row JSON-map-by-year pattern as the method locks above, just storing an
// { start, end } object per year instead of a string.
router.get('/vehicle-odometer', async (req, res) => {
  try {
    const map = await getMethodByYearMap(req.user.id, 'fin_vehicle_odometer_by_year');
    const { year } = req.query;
    if (year) return res.json({ year, ...(map[year] || { start: null, end: null }) });
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/vehicle-odometer', async (req, res) => {
  try {
    const { year, start, end } = req.body;
    if (!year || !FY_RE.test(year)) return res.status(400).json({ error: 'year must be like "2025-26"' });
    const startNum = start === '' || start == null ? null : parseFloat(start);
    const endNum   = end   === '' || end   == null ? null : parseFloat(end);
    if (startNum != null && !(startNum >= 0)) return res.status(400).json({ error: 'start odometer must be a non-negative number' });
    if (endNum != null && !(endNum >= 0)) return res.status(400).json({ error: 'end odometer must be a non-negative number' });
    if (startNum != null && endNum != null && endNum < startNum) {
      return res.status(400).json({ error: 'End-of-year odometer cannot be less than the start-of-year reading' });
    }
    const map = await getMethodByYearMap(req.user.id, 'fin_vehicle_odometer_by_year');
    const existing = map[year] || {};
    map[year] = {
      start: startNum != null ? startNum : (existing.start ?? null),
      end:   endNum   != null ? endNum   : (existing.end ?? null),
    };
    await pool.query(
      `INSERT INTO settings ("userId", key, value) VALUES ($1,'fin_vehicle_odometer_by_year',$2)
       ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`,
      [req.user.id, JSON.stringify(map)]
    );
    res.json({ year, ...map[year] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/home-office-method', async (req, res) => {
  try {
    const map = await getMethodByYearMap(req.user.id, 'fin_home_office_method_by_year');
    const { year } = req.query;
    if (year) return res.json({ year, method: map[year] || null });
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/home-office-method', async (req, res) => {
  try {
    const { year, method } = req.body;
    if (!year || !FY_RE.test(year)) return res.status(400).json({ error: 'year must be like "2025-26"' });
    if (!['fixed_rate', 'actual_cost'].includes(method)) return res.status(400).json({ error: "method must be 'fixed_rate' or 'actual_cost'" });
    const map = await setMethodForYear(req.user.id, 'fin_home_office_method_by_year', year, method);
    res.json({ year, method, all: map });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Short list of common ATO-accepted sole-trader business-travel purposes — for description/
// organization only; the ATO logbook/diary substantiation record is still the user's own.
const VEHICLE_PURPOSES = [
  'Client meeting/visit',
  'Travel between two places of work',
  'Delivering or collecting goods/supplies',
  'Bank, post office, or supplier errand (business purpose)',
  'Attending a work-related course/conference',
  'Travel to see an accountant/bookkeeper/tax agent',
  'Vehicle servicing/repairs (business vehicle)',
  'Other (describe)',
];

router.post('/expenses/vehicle', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    // NOTE: the client no longer sends `method` or a rate at all — the entry screen only offers
    // date/purpose/km-or-cost fields (see docs/finance.md). The server resolves the FY's locked
    // method and the current ATO rate itself, so there is structurally no way for a request to
    // apply a different method to an entry than the one locked for its financial year. The
    // `method` check below is kept only as defense-in-depth against a direct/legacy API call.
    const { date, description, purpose, method, km, businessUsePercent, actualCost, paidViaId } = req.body;
    const expenseDate = date || await todayStr();
    const fy = finYearForDate(expenseDate);

    const methodMap = await getMethodByYearMap(userId, 'fin_vehicle_method_by_year');
    const lockedMethod = methodMap[fy];
    if (!lockedMethod) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: `No vehicle claim method set for FY${fy} yet. Go to Finance → Settings → Vehicle & Home Office to lock one (cents-per-km or logbook) before saving — the ATO requires one method per financial year, not per entry.`, fy, needsMethodLock: 'vehicle' });
    }
    if (method && method !== lockedMethod) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: `FY${fy} is locked to '${lockedMethod}'. You cannot use '${method}' for an entry dated in this financial year — the ATO does not allow mixing vehicle claim methods within the same financial year.` });
    }
    const useMethod = lockedMethod;
    const ratePerKm = await getSettingValue(userId, 'fin_vehicle_rate_per_km', '0.88');

    let deductible;
    if (useMethod === 'cents_per_km') {
      const kmNum   = parseFloat(km) || 0;
      const rateNum = parseFloat(ratePerKm) || 0;
      deductible = parseFloat((kmNum * rateNum).toFixed(2));
    } else {
      const pct  = parseFloat(businessUsePercent) || 0;
      const cost = parseFloat(actualCost) || 0;
      deductible = parseFloat((cost * (pct / 100)).toFixed(2));
    }
    if (deductible <= 0) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Calculated deductible amount must be greater than zero' }); }

    const finalDescription = description || purpose || 'Vehicle expense';

    await ensureAccounts(userId);
    await ensureTxCodes(userId);
    const expId  = await accountByCode(userId, '5000');
    const bankId = await accountByCode(userId, '1000');
    const creditId = paidViaId || bankId;
    const { rows: vehTx } = await pool.query(`SELECT id FROM fin_tx_codes WHERE "userId"=$1 AND code='EXP-190'`, [userId]);

    // Vehicle deductions are ATO cents-per-km / logbook claims — no GST is separately claimed here.
    const { rows } = await dbClient.query(
      `INSERT INTO fin_expenses ("userId", date, description, amount, gst, category, "txCodeId", "paidViaId")
       VALUES ($1,$2,$3,$4,0,'Vehicle',$5,$6) RETURNING *`,
      [userId, expenseDate, finalDescription, deductible, vehTx[0]?.id || null, paidViaId || null]
    );
    const expense = rows[0];

    await dbClient.query(
      `INSERT INTO fin_vehicle_expenses ("userId","expenseId",method,km,"ratePerKm","businessUsePercent","actualCost",purpose)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId, expense.id, useMethod, km ? parseFloat(km) : null, ratePerKm ? parseFloat(ratePerKm) : null,
       businessUsePercent ? parseFloat(businessUsePercent) : null, actualCost ? parseFloat(actualCost) : null, purpose || null]
    );

    if (expId && creditId) {
      await createJournalEntry(dbClient, userId, {
        date:        expense.date,
        description: `Vehicle expense: ${finalDescription}`,
        type:        'expense',
        sourceId:    expense.id,
        lines: [
          { accountId: expId,    debit: deductible, credit: 0 },
          { accountId: creditId, debit: 0,           credit: deductible },
        ],
      });
    }

    // Mark every currently-pending trip-log row as rolled into this posting — same traceability
    // pattern as the home-office daily log, so a posted km deduction can be traced back to the
    // specific logged trips behind it.
    if (useMethod === 'cents_per_km') {
      await dbClient.query(
        `UPDATE fin_vehicle_trip_log SET "postedExpenseId"=$1 WHERE "userId"=$2 AND "postedExpenseId" IS NULL`,
        [expense.id, userId]
      );
    }

    await dbClient.query('COMMIT');
    res.json({ ...expense, deductible, method: useMethod, purpose: purpose || null });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// ── Vehicle trip diary ──────────────────────────────────────────────────────
// Substantiation record for the cents_per_km method — logging a trip here has zero
// journal/accounting impact; nothing here touches fin_expenses or fin_journal_entries.
// Same two-layer pattern as the home office daily log (see docs/finance.md).

router.get('/vehicle-trip-log', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, "tripDate"::text AS "tripDate", km, purpose, description, "postedExpenseId", "createdAt"
       FROM fin_vehicle_trip_log WHERE "userId"=$1 AND "tripDate" >= (CURRENT_DATE - INTERVAL '60 days')
       ORDER BY "tripDate" DESC, id DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Diary km not yet rolled into a posted deduction (postedExpenseId IS NULL) — source of truth
// for what the periodic Vehicle card pre-fills into Business km. Read-only, no side effects.
router.get('/vehicle-trip-log/pending', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(km),0)::float AS km, COUNT(*)::int AS count, MIN("tripDate")::text AS "oldestDate"
       FROM fin_vehicle_trip_log WHERE "userId"=$1 AND "postedExpenseId" IS NULL`,
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full-history CSV — the actual document to hand an accountant/produce under audit.
router.get('/vehicle-trip-log/export', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT "tripDate"::text AS "tripDate", km, purpose, description, "postedExpenseId", "createdAt"
       FROM fin_vehicle_trip_log WHERE "userId"=$1 ORDER BY "tripDate" ASC, id ASC`,
      [req.user.id]
    );
    const header = 'Date,Km,Purpose,Description,Posted,LoggedAt';
    const lines = rows.map(r => [
      r.tripDate,
      r.km,
      JSON.stringify(r.purpose || ''),
      JSON.stringify(r.description || ''),
      r.postedExpenseId ? 'Yes' : 'No',
      new Date(r.createdAt).toISOString(),
    ].join(','));
    const csv = [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="vehicle-trip-diary.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/vehicle-trip-log', async (req, res) => {
  try {
    const userId = req.user.id;
    const { tripDate, km, purpose, description } = req.body;
    if (!tripDate) return res.status(400).json({ error: 'tripDate is required' });
    const kmNum = parseFloat(km);
    if (!Number.isFinite(kmNum) || kmNum < 0) {
      return res.status(400).json({ error: 'km must be a number >= 0' });
    }
    // No UNIQUE per date — multiple trips per day are normal, so always insert, never upsert.
    const { rows } = await pool.query(
      `INSERT INTO fin_vehicle_trip_log ("userId", "tripDate", km, purpose, description)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, "tripDate"::text AS "tripDate", km, purpose, description, "createdAt"`,
      [userId, tripDate, kmNum, purpose || null, description || null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit an unposted trip — same restriction as delete (postedExpenseId IS NULL): once a trip's
// km has been rolled into a posted deduction it's part of that journal entry's substantiation
// record and must not silently change under it.
router.put('/vehicle-trip-log/:id', async (req, res) => {
  try {
    const { tripDate, km, purpose, description } = req.body;
    if (!tripDate) return res.status(400).json({ error: 'tripDate is required' });
    const kmNum = parseFloat(km);
    if (!Number.isFinite(kmNum) || kmNum < 0) {
      return res.status(400).json({ error: 'km must be a number >= 0' });
    }
    const { rows } = await pool.query(
      `UPDATE fin_vehicle_trip_log SET "tripDate"=$1, km=$2, purpose=$3, description=$4
       WHERE id=$5 AND "userId"=$6 AND "postedExpenseId" IS NULL
       RETURNING id, "tripDate"::text AS "tripDate", km, purpose, description, "createdAt"`,
      [tripDate, kmNum, purpose || null, description || null, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found, or already posted (posted trips cannot be edited)' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/vehicle-trip-log/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM fin_vehicle_trip_log WHERE id=$1 AND "userId"=$2 AND "postedExpenseId" IS NULL`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/expenses/home-office', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    // See note above the vehicle route — the client no longer sends `method` or a rate.
    const { date, description, method, hours, businessUsePercent, actualCost, paidViaId } = req.body;
    const expenseDate = date || await todayStr();
    const fy = finYearForDate(expenseDate);

    const methodMap = await getMethodByYearMap(userId, 'fin_home_office_method_by_year');
    const lockedMethod = methodMap[fy];
    if (!lockedMethod) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: `No home office claim method set for FY${fy} yet. Go to Finance → Settings → Vehicle & Home Office to lock one (fixed-rate or actual-cost) before saving — the ATO requires one method per financial year, not per entry.`, fy, needsMethodLock: 'homeOffice' });
    }
    if (method && method !== lockedMethod) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: `FY${fy} is locked to '${lockedMethod}'. You cannot use '${method}' for an entry dated in this financial year — the ATO does not allow mixing home office claim methods within the same financial year.` });
    }
    const useMethod = lockedMethod;
    const ratePerHour = await getSettingValue(userId, 'fin_home_office_rate_per_hour', '0.70');

    let deductible;
    if (useMethod === 'fixed_rate') {
      const hrs  = parseFloat(hours) || 0;
      const rate = parseFloat(ratePerHour) || 0;
      deductible = parseFloat((hrs * rate).toFixed(2));
    } else {
      const pct  = parseFloat(businessUsePercent) || 0;
      const cost = parseFloat(actualCost) || 0;
      deductible = parseFloat((cost * (pct / 100)).toFixed(2));
    }
    if (deductible <= 0) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Calculated deductible amount must be greater than zero' }); }

    await ensureAccounts(userId);
    await ensureTxCodes(userId);
    const expId  = await accountByCode(userId, '5000');
    const bankId = await accountByCode(userId, '1000');
    const creditId = paidViaId || bankId;
    const { rows: hoTx } = await pool.query(`SELECT id FROM fin_tx_codes WHERE "userId"=$1 AND code='EXP-200'`, [userId]);

    const { rows } = await dbClient.query(
      `INSERT INTO fin_expenses ("userId", date, description, amount, gst, category, "txCodeId", "paidViaId")
       VALUES ($1,$2,$3,$4,0,'Home Office',$5,$6) RETURNING *`,
      [userId, expenseDate, description || 'Home office expense', deductible, hoTx[0]?.id || null, paidViaId || null]
    );
    const expense = rows[0];

    await dbClient.query(
      `INSERT INTO fin_home_office_expenses ("userId","expenseId",method,hours,"ratePerHour","businessUsePercent","actualCost")
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, expense.id, useMethod, hours ? parseFloat(hours) : null, ratePerHour ? parseFloat(ratePerHour) : null,
       businessUsePercent ? parseFloat(businessUsePercent) : null, actualCost ? parseFloat(actualCost) : null]
    );

    if (expId && creditId) {
      await createJournalEntry(dbClient, userId, {
        date:        expense.date,
        description: `Home office expense: ${description || useMethod}`,
        type:        'expense',
        sourceId:    expense.id,
        lines: [
          { accountId: expId,    debit: deductible, credit: 0 },
          { accountId: creditId, debit: 0,           credit: deductible },
        ],
      });
    }

    // Mark every currently-pending diary row as rolled into this posting, so the deduction can
    // be traced back to specific diary entries later (an audit question, or just curiosity about
    // "what did this $X cover") — not just a lump total with no link to the substantiation record.
    if (useMethod === 'fixed_rate') {
      await dbClient.query(
        `UPDATE fin_home_office_daily_log SET "postedExpenseId"=$1 WHERE "userId"=$2 AND "postedExpenseId" IS NULL`,
        [expense.id, userId]
      );
    }

    await dbClient.query('COMMIT');
    res.json({ ...expense, deductible, method: useMethod });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// ── Assets register ───────────────────────────────────────────────────────────
// One table, one form, regardless of how many assets exist — see fin_assets in db.js. Amount
// <= $300 auto-routes to an immediate deduction; amount > $300 needs a method (+ effective life
// for prime_cost/diminishing_value, not low_value_pool). Annual depreciation is a generic loop
// over every active asset for a given FY, not a one-off per-item calculation.

// ATO "low-cost asset" pool-eligibility threshold — an asset costing $1,000+ (ex-GST) can never
// go into the low-value pool, election or not; only assets in the $300-$999.99 band are ever
// eligible. Once the pool is elected for one such asset, ATO rules require every future
// low-cost asset to be pooled too — this is enforced structurally below, not left to memory.
const LOW_VALUE_POOL_MAX = 1000;

async function getLowValuePoolElection(userId) {
  const raw = await getSettingValue(userId, 'fin_low_value_pool_election', null);
  if (!raw) return { elected: false };
  try { return JSON.parse(raw); } catch { return { elected: false }; }
}

async function setLowValuePoolElection(userId, { assetId, description, date }) {
  const value = JSON.stringify({ elected: true, assetId, description, date });
  await pool.query(
    `INSERT INTO settings ("userId", key, value) VALUES ($1,'fin_low_value_pool_election',$2)
     ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, value]
  );
}

function daysBetweenInclusive(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
}

// Simplified ATO decline-in-value calc: real depreciation has edge cases (pooling elections,
// balancing adjustments, mixed-use assets) this does not attempt to fully model — treat as a
// starting figure for the accountant to review, same disclaimer this app already carries for
// other calculators. Returns { decline, deduction } for the given FY, or null if the asset isn't
// depreciable that year (immediate method, not yet in use, disposed before the FY, or fully
// written down already).
// pg returns DATE columns as JS Date objects (local midnight); comparing one to a 'YYYY-MM-DD'
// string is always false, which silently dropped the pro-rata and disposal cut-offs below.
// Normalise to a plain string here so callers can pass raw rows or ::text-cast rows.
function dateOnly(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

function computeAssetYearDepreciation(asset, fy) {
  if (asset.method === 'immediate' || !asset.method) return null;
  const fyStartYear = parseInt(fy.slice(0, 4), 10);
  const fyStart = `${fyStartYear}-07-01`;
  const fyEnd = `${fyStartYear + 1}-06-30`;
  const firstUsed = dateOnly(asset.dateFirstUsed);
  const disposed = dateOnly(asset.disposedDate);
  if (!firstUsed) return null;
  if (disposed && disposed < fyStart) return null;
  if (firstUsed > fyEnd) return null;

  const effectiveStart = firstUsed > fyStart ? firstUsed : fyStart;
  const effectiveEnd = disposed && disposed < fyEnd ? disposed : fyEnd;
  if (effectiveStart > effectiveEnd) return null;

  const daysHeld = daysBetweenInclusive(effectiveStart, effectiveEnd);
  const daysInYear = daysBetweenInclusive(fyStart, fyEnd);
  const cost = parseFloat(asset.amount) || 0;
  const accumulated = parseFloat(asset.accumulatedDepreciation) || 0;
  const openingValue = round2(cost - accumulated);
  if (openingValue <= 0) return null;

  let rate, base;
  if (asset.method === 'prime_cost') {
    const life = parseFloat(asset.effectiveLifeYears) || 0;
    if (life <= 0) return null;
    rate = 100 / life;
    base = cost;
  } else if (asset.method === 'diminishing_value') {
    const life = parseFloat(asset.effectiveLifeYears) || 0;
    if (life <= 0) return null;
    rate = 200 / life;
    base = openingValue;
  } else { // low_value_pool
    rate = accumulated === 0 ? 18.75 : 37.5;
    base = openingValue;
  }

  let decline = round2(base * (daysHeld / daysInYear) * (rate / 100));
  decline = Math.min(decline, openingValue);
  if (decline <= 0) return null;
  const businessUsePercent = parseFloat(asset.businessUsePercent) || 100;
  const deduction = round2(decline * (businessUsePercent / 100));
  return { decline, deduction };
}

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

router.get('/assets/low-value-pool-election', async (req, res) => {
  try {
    res.json(await getLowValuePoolElection(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit Settings-page toggle — the election otherwise only ever fires implicitly the first
// time someone picks "Low-value pool" on a qualifying asset. This lets it be decided upfront,
// same pattern as the Vehicle/Home Office method locks. Turning it ON just records the election
// (no asset needed). Turning it OFF is only allowed if no asset has actually been pooled yet —
// once one has, the ATO election is real and permanent, not a preference to flip back.
router.post('/assets/low-value-pool-election', async (req, res) => {
  try {
    const userId = req.user.id;
    const { elected } = req.body;
    if (elected) {
      await setLowValuePoolElection(userId, { assetId: null, description: 'Elected in Settings', date: await todayStr() });
      return res.json(await getLowValuePoolElection(userId));
    }
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM fin_assets WHERE "userId"=$1 AND method='low_value_pool'`, [userId]);
    if (rows[0].count > 0) {
      return res.status(400).json({ error: 'Cannot un-elect the low-value pool — at least one asset has already been pooled, and the ATO election is permanent once used.' });
    }
    await pool.query(
      `INSERT INTO settings ("userId", key, value) VALUES ($1,'fin_low_value_pool_election',$2)
       ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`,
      [userId, JSON.stringify({ elected: false })]
    );
    res.json({ elected: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/assets', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, "datePurchased"::text AS "datePurchased", "dateFirstUsed"::text AS "dateFirstUsed",
              description, amount, gst, "businessUsePercent", method, "effectiveLifeYears",
              "accumulatedDepreciation", "lastDepreciatedFy", "immediateExpenseId", "paidViaId", "ccSettled",
              "disposedDate"::text AS "disposedDate", "disposalAmount", "createdAt"
       FROM fin_assets WHERE "userId"=$1 ORDER BY "datePurchased" DESC, id DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settle a credit-card-purchased asset — same pattern as POST /expenses/:id/cc-pay, just against
// fin_assets since a non-immediate asset purchase never creates a fin_expenses row (it hits
// Fixed Assets, not Expenses).
router.post('/assets/:id/cc-pay', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { date } = req.body;
    const { rows } = await dbClient.query(
      `SELECT ast.*, a.id AS "creditAccountId", a.name AS "creditName"
       FROM fin_assets ast JOIN fin_accounts a ON a.id = ast."paidViaId"
       WHERE ast.id=$1 AND ast."userId"=$2`,
      [req.params.id, userId]
    );
    if (!rows[0]) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Asset not found, or not paid via a credit card account' }); }
    const asset = rows[0];
    if (asset.ccSettled) { await dbClient.query('ROLLBACK'); return res.status(409).json({ error: 'CC already settled for this asset' }); }

    const bankId = await accountByCode(userId, '1000');
    if (!bankId) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Bank / Cash account (1000) not found' }); }

    // Settle the full amount actually charged (ex-GST cost + GST), not just the ex-GST "amount"
    // column — that mismatch was the exact bug this whole fix addresses.
    const totalCharged = round2((parseFloat(asset.amount) || 0) + (parseFloat(asset.gst) || 0));
    await createJournalEntry(dbClient, userId, {
      date: date || await todayStr(),
      description: `CC payment — ${asset.description}`,
      type: 'manual',
      lines: [
        { accountId: asset.creditAccountId, debit: totalCharged, credit: 0 },
        { accountId: bankId, debit: 0, credit: totalCharged },
      ],
    });
    await dbClient.query(`UPDATE fin_assets SET "ccSettled"=true, "settledDate"=$3, "updatedAt"=NOW() WHERE id=$1 AND "userId"=$2`, [asset.id, userId, date || await todayStr()]);
    await dbClient.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.post('/assets', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    // `amount` is the total actually paid (GST-inclusive when gstIncluded, matching the same
    // contract as POST /expenses) — the server splits it, not the client, so there's one
    // consistent GST calculation instead of the client pre-computing an ex-GST figure that then
    // silently drops the GST from the purchase journal (the exact bug this fixes: a $1,099
    // charge recorded as a $999.09 asset with nothing crediting the missing $99.91 anywhere).
    const { datePurchased, dateFirstUsed, description, amount, gstIncluded, businessUsePercent, method, effectiveLifeYears, paidViaId } = req.body;
    if (!datePurchased || !dateFirstUsed) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Date purchased and date first used are required' }); }
    if (!description || !description.trim()) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Description is required' }); }
    const totalPaid = parseFloat(amount);
    if (!(totalPaid > 0)) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Amount must be greater than zero' }); }
    const gstAmt = gstIncluded && gstAppliesOn(await getGstRegistration(dbClient, userId), datePurchased) ? round2(totalPaid / 11) : 0;
    const amountNum = round2(totalPaid - gstAmt); // ex-GST cost basis — used for thresholds, capitalization, and depreciation
    const pctNum = businessUsePercent === undefined || businessUsePercent === '' ? 100 : parseFloat(businessUsePercent);
    if (!(pctNum > 0 && pctNum <= 100)) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Business-use % must be between 0 and 100' }); }
    if (!(await ownsAccount(dbClient, userId, paidViaId))) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Unknown "paid via" account' }); }

    let useMethod, lifeNum = null;
    let triggersPoolElection = false;
    if (amountNum <= IMMEDIATE_DEDUCTION_THRESHOLD) {
      useMethod = 'immediate';
    } else {
      const poolEligible = amountNum < LOW_VALUE_POOL_MAX;
      const election = poolEligible ? await getLowValuePoolElection(userId) : { elected: false };

      if (poolEligible && election.elected) {
        // Structural, not a default: once the pool is elected, every future low-cost asset
        // MUST be pooled — the client can't send a different method for this amount band at
        // all, same "server resolves it, client can't override" pattern as the FY method locks.
        useMethod = 'low_value_pool';
      } else if (!poolEligible && method === 'low_value_pool') {
        await dbClient.query('ROLLBACK');
        return res.status(400).json({ error: `The low-value pool only applies to assets under $${LOW_VALUE_POOL_MAX} (ex-GST) — this asset needs prime cost or diminishing value` });
      } else {
        if (!['low_value_pool', 'prime_cost', 'diminishing_value'].includes(method) || (!poolEligible && method === 'low_value_pool')) {
          await dbClient.query('ROLLBACK');
          return res.status(400).json({ error: `Assets over $${IMMEDIATE_DEDUCTION_THRESHOLD} need a depreciation method (${poolEligible ? 'low-value pool, ' : ''}prime cost, or diminishing value)` });
        }
        useMethod = method;
        if (poolEligible && useMethod === 'low_value_pool') triggersPoolElection = true; // first-ever election
      }
      if (useMethod !== 'low_value_pool') {
        lifeNum = parseFloat(effectiveLifeYears);
        if (!(lifeNum > 0)) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Effective life (years) is required for prime cost / diminishing value' }); }
      }
    }

    const { rows } = await dbClient.query(
      `INSERT INTO fin_assets ("userId","datePurchased","dateFirstUsed",description,amount,gst,"businessUsePercent",method,"effectiveLifeYears","paidViaId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [userId, datePurchased, dateFirstUsed, description.trim(), amountNum, gstAmt, pctNum, useMethod, lifeNum, paidViaId || null]
    );
    let asset = rows[0];

    if (triggersPoolElection) {
      await setLowValuePoolElection(userId, { assetId: asset.id, description: asset.description, date: datePurchased });
    }

    await ensureAccounts(userId);
    await ensureTxCodes(userId);
    const bankId = await accountByCode(userId, '1000');
    const gstPaidId = await accountByCode(userId, '1200');
    const creditId = paidViaId || bankId;

    // Immediate deduction (<= threshold) posts straight away, same pattern as any other
    // capital-asset expense — full cost (adjusted for business-use %) claimed now, no schedule.
    // GST claimed is also business-use-adjusted, same as the ex-GST deduction.
    if (useMethod === 'immediate') {
      const deductible = round2(amountNum * (pctNum / 100));
      const gstClaim = round2(gstAmt * (pctNum / 100));
      const expId = await accountByCode(userId, '5000');
      const { rows: depTx } = await pool.query(`SELECT id FROM fin_tx_codes WHERE "userId"=$1 AND code='EXP-210'`, [userId]);
      const { rows: expRows } = await dbClient.query(
        `INSERT INTO fin_expenses ("userId", date, description, amount, gst, category, "txCodeId", "paidViaId", "isCapitalAsset")
         VALUES ($1,$2,$3,$4,$5,'Assets',$6,$7,true) RETURNING *`,
        [userId, datePurchased, `Asset (immediate deduction): ${description.trim()}`, deductible, gstClaim, depTx[0]?.id || null, paidViaId || null]
      );
      const expense = expRows[0];
      const creditAmt = round2(deductible + gstClaim);
      if (expId && creditId) {
        const lines = [{ accountId: expId, debit: deductible, credit: 0 }];
        if (gstClaim > 0 && gstPaidId) lines.push({ accountId: gstPaidId, debit: gstClaim, credit: 0 });
        lines.push({ accountId: creditId, debit: 0, credit: creditAmt });
        await createJournalEntry(dbClient, userId, {
          date: expense.date, description: `Asset immediate deduction: ${description.trim()}`, type: 'expense', sourceId: expense.id,
          lines,
        });
      }
      const { rows: updated } = await dbClient.query(
        `UPDATE fin_assets SET "accumulatedDepreciation"=$1, "immediateExpenseId"=$2, "updatedAt"=NOW() WHERE id=$3 RETURNING *`,
        [amountNum, expense.id, asset.id]
      );
      asset = updated[0];
    } else {
      // Every other method still incurs the full purchase cost NOW — that's a balance-sheet
      // event (Fixed Assets) independent of the depreciation schedule, which only ever affects
      // book value later. Capitalized at the FULL ex-GST cost regardless of business-use % —
      // apportionment happens when depreciation is later claimed, not at purchase. GST is
      // claimed in full here too (input tax credits aren't spread over the depreciation
      // schedule). Credits the exact total actually paid/charged — this, plus the missing GST
      // line, is what fixes a CC settlement not matching the real card charge.
      const fixedAssetsId = await accountByCode(userId, '1400');
      if (fixedAssetsId && creditId) {
        const lines = [{ accountId: fixedAssetsId, debit: amountNum, credit: 0 }];
        if (gstAmt > 0 && gstPaidId) lines.push({ accountId: gstPaidId, debit: gstAmt, credit: 0 });
        lines.push({ accountId: creditId, debit: 0, credit: totalPaid });
        await createJournalEntry(dbClient, userId, {
          date: datePurchased, description: `Asset purchase: ${description.trim()}`, type: 'asset_purchase', sourceId: asset.id,
          lines,
        });
      }
    }

    await dbClient.query('COMMIT');
    res.json(asset);
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.put('/assets/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows: existingRows } = await pool.query(`SELECT * FROM fin_assets WHERE id=$1 AND "userId"=$2`, [req.params.id, userId]);
    if (!existingRows.length) return res.status(404).json({ error: 'Asset not found' });
    const existing = existingRows[0];
    if (existing.immediateExpenseId || existing.lastDepreciatedFy) {
      return res.status(400).json({ error: 'This asset already has a posted deduction/depreciation — dispose it instead of editing its cost/method' });
    }
    // Every non-immediate asset posts an 'asset_purchase' journal entry the moment it's created
    // (see POST /assets) — its date/description would silently drift from that entry if this
    // route changed datePurchased/description without also updating or blocking the journal.
    // No client UI currently calls this route, but block it structurally rather than leave a
    // latent inconsistency for whenever an edit screen is built.
    const { rows: purchaseJournal } = await pool.query(
      `SELECT id FROM fin_journal_entries WHERE "userId"=$1 AND "sourceId"=$2 AND type='asset_purchase'`,
      [userId, existing.id]
    );
    const { datePurchased, dateFirstUsed, description, businessUsePercent } = req.body;
    const dateOrDescChanged = (datePurchased && datePurchased !== String(existing.datePurchased).slice(0, 10))
      || (description && description.trim() !== existing.description);
    if (purchaseJournal.length && dateOrDescChanged) {
      return res.status(400).json({ error: 'This asset already has a posted purchase journal entry — date and description can no longer be changed here (dispose the asset instead if it was entered wrong).' });
    }
    const pctNum = businessUsePercent === undefined || businessUsePercent === '' ? existing.businessUsePercent : parseFloat(businessUsePercent);
    if (!(pctNum > 0 && pctNum <= 100)) return res.status(400).json({ error: 'Business-use % must be between 0 and 100' });
    const { rows } = await pool.query(
      `UPDATE fin_assets SET "datePurchased"=$1,"dateFirstUsed"=$2,description=$3,"businessUsePercent"=$4,"updatedAt"=NOW()
       WHERE id=$5 AND "userId"=$6 RETURNING *`,
      [datePurchased || existing.datePurchased, dateFirstUsed || existing.dateFirstUsed, (description || existing.description).trim(), pctNum, req.params.id, userId]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/assets/:id', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { rows } = await dbClient.query(`SELECT * FROM fin_assets WHERE id=$1 AND "userId"=$2`, [req.params.id, userId]);
    if (!rows.length) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Asset not found' }); }
    if (rows[0].immediateExpenseId || rows[0].lastDepreciatedFy) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'This asset already has a posted deduction/depreciation — dispose it instead of deleting it' });
    }
    // Every asset (any method) posts an 'asset_purchase' journal entry at creation now — deleting
    // the fin_assets row without also removing that journal entry (a real bug: this previously
    // left orphaned Fixed Assets/GST Paid lines in the books forever) leaves the books wrong.
    if (rows[0].ccSettled && rows[0].paidViaId) {
      await reverseCcSettlement(dbClient, userId, {
        creditAccountId: rows[0].paidViaId,
        total: round2(parseFloat(rows[0].amount) + parseFloat(rows[0].gst || 0)),
        description: `deleted asset ${rows[0].description}`,
      });
    }
    await deleteJournalForSource(dbClient, userId, rows[0].id, 'asset_purchase');
    await dbClient.query(`DELETE FROM fin_assets WHERE id=$1 AND "userId"=$2`, [req.params.id, userId]);
    await dbClient.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// Disposal — balancing adjustment between sale proceeds and the asset's written-down value
// (cost minus accumulated depreciation). Profit posts to Other Income, loss posts as an expense.
// - Depreciation is first brought up to the disposal date for the disposal year (a partial-year
//   deduction), so the written-down value isn't overstated by the months the asset was held.
// - When the sale price includes GST (gstIncluded), 1/11 is GST collected (2200) and only the
//   remainder is sale proceeds; that GST is reported on the BAS on the disposal date.
router.post('/assets/:id/dispose', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { disposedDate, disposalAmount, gstIncluded } = req.body;
    if (!disposedDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(disposedDate))) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'A valid disposal date is required' }); }
    const disposalNum = parseFloat(disposalAmount) || 0;
    if (disposalNum < 0) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Proceeds can\'t be negative' }); }
    const { rows } = await dbClient.query(`SELECT * FROM fin_assets WHERE id=$1 AND "userId"=$2 FOR UPDATE`, [req.params.id, userId]);
    if (!rows.length) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Asset not found' }); }
    let asset = rows[0];
    if (asset.disposedDate) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Asset already disposed' }); }
    const lq = await lockedQuarter(dbClient, userId, disposedDate);
    if (lq) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: lockedMsg(lq) }); }
    if (dateOnly(asset.datePurchased) > disposedDate) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'The disposal date is before the purchase date' }); }

    await ensureAccounts(userId);
    await ensureTxCodes(userId);
    const bankId = await accountByCode(userId, '1000');
    const incId = await accountByCode(userId, '4100');
    const expId = await accountByCode(userId, '5000');
    const gstColId = await accountByCode(userId, '2200');
    const accDepId = await accountByCode(userId, '1300');

    // ---- depreciation up to the disposal date (non-immediate methods only)
    let finalYearDeduction = 0;
    if (asset.method !== 'immediate') {
      const fy = finYearForDate(disposedDate);
      const startYear = parseInt(fy.slice(0, 4), 10);
      const prevFy = `${startYear - 1}-${String(startYear % 100).padStart(2, '0')}`;
      if (asset.lastDepreciatedFy && asset.lastDepreciatedFy > fy) {
        await dbClient.query('ROLLBACK');
        return res.status(400).json({ error: `This asset was already depreciated to FY${asset.lastDepreciatedFy}, after the disposal date.` });
      }
      if (asset.lastDepreciatedFy !== prevFy && asset.lastDepreciatedFy !== fy && computeAssetYearDepreciation(asset, prevFy)) {
        await dbClient.query('ROLLBACK');
        return res.status(400).json({ error: `Run depreciation for FY${prevFy} first, then dispose of the asset (its value at the disposal date depends on it).` });
      }
      if (asset.lastDepreciatedFy !== fy) {
        const calc = computeAssetYearDepreciation({ ...asset, disposedDate }, fy);
        if (calc && expId && accDepId) {
          const { rows: depTx } = await dbClient.query(`SELECT id FROM fin_tx_codes WHERE "userId"=$1 AND code='EXP-210'`, [userId]);
          const label = `Depreciation FY${fy}: ${asset.description}`;
          const { rows: expRows } = await dbClient.query(
            `INSERT INTO fin_expenses ("userId", date, description, amount, gst, category, "txCodeId")
             VALUES ($1,$2,$3,$4,0,'Depreciation',$5) RETURNING *`,
            [userId, disposedDate, label, calc.deduction, depTx[0]?.id || null]
          );
          await createJournalEntry(dbClient, userId, {
            date: disposedDate, description: label, type: 'depreciation', sourceId: expRows[0].id,
            lines: [{ accountId: expId, debit: calc.deduction, credit: 0 }, { accountId: accDepId, debit: 0, credit: calc.deduction }],
          });
          const { rows: upd } = await dbClient.query(
            `UPDATE fin_assets SET "accumulatedDepreciation"="accumulatedDepreciation"+$1,"lastDepreciatedFy"=$2 WHERE id=$3 RETURNING *`,
            [calc.decline, fy, asset.id]
          );
          asset = upd[0];
          finalYearDeduction = calc.deduction;
        }
      }
    }

    const cost = parseFloat(asset.amount) || 0;
    const accumulated = parseFloat(asset.accumulatedDepreciation) || 0;
    const writtenDownValue = round2(cost - accumulated);
    const gstAmt = gstIncluded && disposalNum > 0 && gstAppliesOn(await getGstRegistration(dbClient, userId), disposedDate) ? round2(disposalNum / 11) : 0;
    const proceedsExGst = round2(disposalNum - gstAmt);
    const adjustment = round2(proceedsExGst - writtenDownValue);

    if (gstAmt > 0 && !gstColId) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'GST Collected account missing' }); }

    if (asset.method === 'immediate') {
      // Already fully expensed at purchase -- never capitalized, so nothing to derecognize on the
      // balance sheet. Any proceeds are pure profit.
      if (disposalNum > 0 && bankId && incId) {
        const lines = [{ accountId: bankId, debit: disposalNum, credit: 0 }, { accountId: incId, debit: 0, credit: proceedsExGst }];
        if (gstAmt > 0) lines.push({ accountId: gstColId, debit: 0, credit: gstAmt });
        await createJournalEntry(dbClient, userId, {
          date: disposedDate, description: `Profit on disposal: ${asset.description}`, type: 'asset_disposal', sourceId: asset.id, lines,
        });
      }
    } else {
      // Real depreciation methods were capitalized to Fixed Assets at purchase -- disposal must fully
      // derecognize both the original cost and its accumulated depreciation, not just post a
      // standalone profit/loss line, or the balance sheet would carry a phantom asset forever.
      const fixedAssetsId = await accountByCode(userId, '1400');
      if (fixedAssetsId && accDepId && bankId) {
        const lines = [
          { accountId: accDepId, debit: accumulated, credit: 0 },
          { accountId: bankId, debit: disposalNum, credit: 0 },
          { accountId: fixedAssetsId, debit: 0, credit: cost },
        ];
        if (gstAmt > 0) lines.push({ accountId: gstColId, debit: 0, credit: gstAmt });
        if (adjustment > 0 && incId) lines.push({ accountId: incId, debit: 0, credit: adjustment });
        else if (adjustment < 0 && expId) lines.push({ accountId: expId, debit: Math.abs(adjustment), credit: 0 });
        await createJournalEntry(dbClient, userId, {
          date: disposedDate, description: `Disposal: ${asset.description}`, type: 'asset_disposal', sourceId: asset.id, lines,
        });
      }
    }

    const { rows: updated } = await dbClient.query(
      `UPDATE fin_assets SET "disposedDate"=$1,"disposalAmount"=$2,"disposalGst"=$4,"updatedAt"=NOW() WHERE id=$3 RETURNING *`,
      [disposedDate, disposalNum, asset.id, gstAmt]
    );
    await dbClient.query('COMMIT');
    res.json({ ...updated[0], writtenDownValue, adjustment, gstOnSale: gstAmt, finalYearDeduction });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// Preview what running depreciation for a FY would post, without posting — a generic loop over
// every asset, not a one-off calc. Named before /assets/depreciation/run per route-ordering.
// One-off cleanup for journal entries orphaned by a bug in an earlier version of DELETE
// /assets/:id (fixed above) that removed the fin_assets row without removing its posted
// 'asset_purchase' journal entry. Safe by construction: only ever deletes an asset-sourced
// journal entry whose sourceId has NO matching fin_assets row left — a still-valid asset's
// entries are never touched, regardless of how many times this is called.
// Maintenance-only: deletes journal entries left behind when an asset (or, for
// depreciation, the expense row it posted) was removed without its journal entry
// being cleaned up in the same transaction. 'asset_purchase'/'asset_disposal' entries
// carry sourceId = fin_assets.id; 'depreciation' entries carry sourceId = fin_expenses.id
// (the depreciation expense row created alongside it) — these two source tables must
// never be conflated, or every depreciation entry reads as orphaned the moment no asset
// happens to share that numeric id. Every asset/disposal create-or-delete path already
// deletes its own journal entry directly (see deleteJournalForSource); this endpoint only
// mops up rows from before that guarantee existed. Deleted rows are logged (date/description/
// sourceId) before removal since there is no other audit trail for this delete.
router.post('/assets/cleanup-orphaned-journal-entries', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { rows: orphaned } = await dbClient.query(
      `SELECT id, date, description, type, "sourceId" FROM fin_journal_entries
       WHERE "userId"=$1 AND (
         (type IN ('asset_purchase','asset_disposal') AND "sourceId" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM fin_assets fa WHERE fa.id = fin_journal_entries."sourceId"))
         OR
         (type = 'depreciation' AND "sourceId" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM fin_expenses fe WHERE fe.id = fin_journal_entries."sourceId"))
       )`,
      [userId]
    );
    if (orphaned.length) {
      getLogger().warn(
        { userId, deleted: orphaned.map(r => ({ id: r.id, date: r.date, description: r.description, type: r.type, sourceId: r.sourceId })) },
        'finance: cleanup-orphaned-journal-entries deleting rows'
      );
    }
    for (const row of orphaned) {
      await dbClient.query(`DELETE FROM fin_journal_lines WHERE "entryId"=$1`, [row.id]);
      await dbClient.query(`DELETE FROM fin_journal_entries WHERE id=$1`, [row.id]);
    }
    await dbClient.query('COMMIT');
    res.json({ deleted: orphaned.length });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.get('/assets/depreciation/preview', async (req, res) => {
  try {
    const { fy } = req.query;
    if (!fy || !FY_RE.test(fy)) return res.status(400).json({ error: 'fy must be like "2025-26"' });
    const { rows } = await pool.query(
      `SELECT id, description, "dateFirstUsed"::text AS "dateFirstUsed", amount, "businessUsePercent", method,
              "effectiveLifeYears", "accumulatedDepreciation", "lastDepreciatedFy", "disposedDate"::text AS "disposedDate"
       FROM fin_assets WHERE "userId"=$1`,
      [req.user.id]
    );
    const preview = rows
      .filter(a => a.lastDepreciatedFy !== fy)
      .map(a => ({ asset: a, calc: computeAssetYearDepreciation(a, fy) }))
      .filter(r => r.calc)
      .map(r => ({ id: r.asset.id, description: r.asset.description, decline: r.calc.decline, deduction: r.calc.deduction }));

    // If the queried FY ended more than 90 days ago and there's still unposted depreciation
    // for it, the annual run was likely forgotten — flag it rather than only showing a preview
    // nobody asked to see proactively.
    const fyEnd = new Date(`${parseInt(fy.slice(0, 4), 10) + 1}-06-30T00:00:00Z`);
    const daysPastFyEnd = Math.floor((Date.now() - fyEnd.getTime()) / 86400000);
    await captureIf(preview.length > 0 && daysPastFyEnd > 90, {
      userId: req.user.id,
      source: 'financeDepreciation',
      category: 'alert',
      fingerprint: makeFingerprint('financeDepreciation', `unposted:${fy}`),
      title: `${preview.length} asset${preview.length === 1 ? '' : 's'} missing FY${fy} depreciation`,
      body: `FY${fy} ended over ${daysPastFyEnd} days ago and ${preview.length} asset${preview.length === 1 ? '' : 's'} still ${preview.length === 1 ? 'has' : 'have'} no depreciation posted for it. Go to Finance → Assets and run depreciation for FY${fy}.`,
      context: 'Finance → Assets',
    });

    res.json(preview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/assets/depreciation/run', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { fy } = req.body;
    if (!fy || !FY_RE.test(fy)) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'fy must be like "2025-26"' }); }

    const { rows: assets } = await dbClient.query(`SELECT * FROM fin_assets WHERE "userId"=$1`, [userId]);
    await ensureAccounts(userId);
    await ensureTxCodes(userId);
    const expId = await accountByCode(userId, '5000');
    const accDepId = await accountByCode(userId, '1300');
    const { rows: depTx } = await pool.query(`SELECT id FROM fin_tx_codes WHERE "userId"=$1 AND code='EXP-210'`, [userId]);
    const fyEnd = `${parseInt(fy.slice(0, 4), 10) + 1}-06-30`;

    // Years must be posted in order. Running 2027-28 while 2026-27 is unposted (or running an old
    // year after a later one) leaves accumulatedDepreciation and every later year wrong.
    const startYear = parseInt(fy.slice(0, 4), 10);
    const prevFy = `${startYear - 1}-${String(startYear % 100).padStart(2, '0')}`;
    const outOfOrder = [];
    for (const asset of assets) {
      if (asset.lastDepreciatedFy && asset.lastDepreciatedFy > fy) {
        outOfOrder.push(`${asset.description} (already depreciated to FY${asset.lastDepreciatedFy})`);
      } else if (asset.lastDepreciatedFy !== prevFy && asset.lastDepreciatedFy !== fy && computeAssetYearDepreciation(asset, prevFy)) {
        outOfOrder.push(`${asset.description} (FY${prevFy} not posted yet)`);
      }
    }
    if (outOfOrder.length) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: `Run depreciation in order, one financial year at a time. Can't run FY${fy} yet: ${outOfOrder.join('; ')}.` });
    }

    const posted = [];
    for (const asset of assets) {
      if (asset.lastDepreciatedFy === fy) continue; // already run for this FY — never double-post
      const calc = computeAssetYearDepreciation(asset, fy);
      if (!calc) continue;

      const { rows: expRows } = await dbClient.query(
        `INSERT INTO fin_expenses ("userId", date, description, amount, gst, category, "txCodeId")
         VALUES ($1,$2,$3,$4,0,'Depreciation',$5) RETURNING *`,
        [userId, fyEnd, `Depreciation FY${fy}: ${asset.description}`, calc.deduction, depTx[0]?.id || null]
      );
      const expense = expRows[0];
      if (expId && accDepId) {
        await createJournalEntry(dbClient, userId, {
          date: expense.date, description: `Depreciation FY${fy}: ${asset.description}`, type: 'depreciation', sourceId: expense.id,
          lines: [{ accountId: expId, debit: calc.deduction, credit: 0 }, { accountId: accDepId, debit: 0, credit: calc.deduction }],
        });
      }
      await dbClient.query(
        `UPDATE fin_assets SET "accumulatedDepreciation"="accumulatedDepreciation"+$1,"lastDepreciatedFy"=$2,"updatedAt"=NOW() WHERE id=$3`,
        [calc.decline, fy, asset.id]
      );
      posted.push({ id: asset.id, description: asset.description, deduction: calc.deduction });
    }

    await dbClient.query('COMMIT');
    res.json({ fy, posted });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// ── Recurring invoices & expenses ────────────────────────────────────────────

router.get('/recurring', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM fin_recurring WHERE "userId"=$1 ORDER BY "nextDate" ASC, id ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/recurring', async (req, res) => {
  try {
    const { type, label, frequency, nextDate, template } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO fin_recurring ("userId", type, label, frequency, "nextDate", template)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, type, label||'', frequency, nextDate, JSON.stringify(template||{})]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/recurring/:id', async (req, res) => {
  try {
    const { label, frequency, nextDate, active, template } = req.body;
    const { rows } = await pool.query(
      `UPDATE fin_recurring SET label=$1, frequency=$2, "nextDate"=$3, active=$4, template=$5, "updatedAt"=NOW()
       WHERE id=$6 AND "userId"=$7 RETURNING *`,
      [label||'', frequency, nextDate, active !== false, JSON.stringify(template||{}), req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/recurring/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM fin_recurring WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/recurring/run-now', async (req, res) => {
  try {
    const { runRecurring } = require('../cron/recurringCron');
    await runRecurring();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Journal ───────────────────────────────────────────────────────────────────

router.get('/journal', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*,
        json_agg(
          json_build_object(
            'accountId', l."accountId",
            'accountName', a.name,
            'code', a.code,
            'debit', l.debit,
            'credit', l.credit
          ) ORDER BY l.id
        ) AS lines
       FROM fin_journal_entries e
       JOIN fin_journal_lines l ON l."entryId" = e.id
       JOIN fin_accounts a ON a.id = l."accountId"
       WHERE e."userId"=$1
       GROUP BY e.id
       ORDER BY e.date DESC, e.id DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/journal', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const { date, description, lines = [] } = req.body;
    if (!Array.isArray(lines) || !lines.length) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Lines required' }); }
    if (!description || !String(description).trim()) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Description is required' }); }
    for (const l of lines) {
      const dr = parseFloat(l.debit) || 0, cr = parseFloat(l.credit) || 0;
      if (dr < 0 || cr < 0 || (dr > 0 && cr > 0) || (dr === 0 && cr === 0)) {
        await dbClient.query('ROLLBACK');
        return res.status(400).json({ error: 'Each line needs either a debit or a credit (not both, not negative, not empty)' });
      }
      if (!Number.isInteger(Number(l.accountId)) || !(await ownsAccount(dbClient, req.user.id, l.accountId))) {
        await dbClient.query('ROLLBACK');
        return res.status(400).json({ error: 'A journal line uses an unknown account' });
      }
    }
    const { debits, credits, balanced } = checkJournalBalance(lines);
    if (!balanced) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({
        error: `Journal entry does not balance: debits $${debits.toFixed(2)}, credits $${credits.toFixed(2)}`,
      });
    }
    const entryId = await createJournalEntry(dbClient, req.user.id, {
      date:        date || await todayStr(),
      description,
      type:        'manual',
      lines,
    });
    await dbClient.query('COMMIT');
    res.json({ id: entryId });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.delete('/journal/:id', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const { rows } = await dbClient.query(
      `SELECT id FROM fin_journal_entries WHERE id=$1 AND "userId"=$2 AND type='manual'`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Not found or not a manual entry' }); }
    await dbClient.query(`DELETE FROM fin_journal_lines WHERE "entryId"=$1`, [req.params.id]);
    await dbClient.query(`DELETE FROM fin_journal_entries WHERE id=$1`, [req.params.id]);
    await dbClient.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// ── BAS ───────────────────────────────────────────────────────────────────────

router.get('/bas', async (req, res) => {
  try {
    const userId = req.user.id;
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    const basis = await getGstBasis(pool, userId);

    const [invRows, expRows, wageRows, gstPaid] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(subtotal),0) AS income, COALESCE(SUM(gst),0) AS "gstCollected"
         FROM fin_invoices WHERE "userId"=$1 AND ${gstSalesSql(basis, '', '$2', '$3')}`,
        [userId, from, to]
      ),
      pool.query(
        `SELECT COALESCE(SUM(e.amount),0) AS expenses
         FROM ${PURCHASES_FROM} WHERE e."userId"=$1 AND ${purchaseClaimDateSql(basis)} BETWEEN $2 AND $3`,
        [userId, from, to]
      ),
      pool.query(
        `SELECT COALESCE(SUM(gross),0) AS wages, COALESCE(SUM(tax),0) AS "withholdingTax"
         FROM fin_wages WHERE "userId"=$1 AND date BETWEEN $2 AND $3`,
        [userId, from, to]
      ),
      gstPaidForRange(userId, from, to, basis),
    ]);

    const sold = await disposalSalesForRange(pool, userId, from, to);
    const gstCollected = round2(parseFloat(invRows.rows[0].gstCollected) + sold.gst);

    // Upsert the quarter record so we can track status
    const { rows: qRows } = await pool.query(
      `INSERT INTO fin_bas_quarters ("userId", from_date, to_date, status)
       VALUES ($1,$2,$3,'open')
       ON CONFLICT ("userId", from_date) DO UPDATE SET to_date=EXCLUDED.to_date
       RETURNING id, status, reconciled_at, lodged_at, paid_at, "paygInstalment"`,
      [userId, from, to]
    );
    const quarter = qRows[0];

    // A BAS-lodgement deadline is 28 days after quarter end. Flag a quarter still 'open'
    // (never even reconciled) once that's passed — the one place this route can detect the
    // anomaly itself, per the mandatory SuggestionService rule.
    const daysPastDue = Math.floor((Date.now() - new Date(`${to}T00:00:00Z`).getTime()) / 86400000) - 28;
    const reg = await getGstRegistration(pool, userId);
    const quarterNeedsBas = gstAppliesOn(reg, from);
    await captureIf(quarterNeedsBas && quarter.status === 'open' && daysPastDue > 0, {
      userId,
      source: 'financeBas',
      category: 'alert',
      fingerprint: makeFingerprint('financeBas', `unreconciled:${quarter.id}`),
      title: `BAS quarter ${from} to ${to} is overdue and unreconciled`,
      body: `Quarter ended ${to}, lodgement due 28 days later. It is ${daysPastDue} day${daysPastDue === 1 ? '' : 's'} past that deadline and still hasn't been reconciled. Go to Finance → BAS to review and reconcile.`,
      context: 'Finance → BAS',
    });

    res.json({
      from,
      to,
      quarterId:       quarter.id,
      basis,
      gstRegistered:   reg.registered,
      gstEffectiveTo:  reg.registered ? null : reg.effectiveFrom,
      quarterNeedsBas,
      paygInstalment:  parseFloat(quarter.paygInstalment) || 0,
      status:          quarter.status,
      reconciledAt:    quarter.reconciled_at,
      lodgedAt:        quarter.lodged_at,
      paidAt:          quarter.paid_at,
      income:          round2(parseFloat(invRows.rows[0].income) + sold.net),
      gstCollected,
      expenses:        parseFloat(expRows.rows[0].expenses),
      gstPaid,
      netGst:          parseFloat((gstCollected - gstPaid).toFixed(2)),
      wages:           parseFloat(wageRows.rows[0].wages),
      withholdingTax:  parseFloat(wageRows.rows[0].withholdingTax),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lodging and paying a BAS are real-world events with their own dates. Accept the actual date (so a
// quarter lodged/paid long ago can be recorded without dating the payment "today"); default today.
// Must not be in the future or before the quarter ended.
async function basStepDate(req, quarterRow) {
  const today = await todayStr();
  const d = req.body && req.body.date ? String(req.body.date) : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: 'date must be YYYY-MM-DD' };
  if (d > today) return { error: 'The date can\'t be in the future' };
  if (quarterRow && d < dateOnly(quarterRow.to_date)) return { error: `The date can't be before the quarter ended (${dateOnly(quarterRow.to_date)})` };
  return { date: d };
}

router.post('/bas/:quarterId/reconcile', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE fin_bas_quarters SET status='reconciled', reconciled_at=NOW(), "updatedAt"=NOW()
       WHERE id=$1 AND "userId"=$2 AND status='open' RETURNING *`,
      [req.params.quarterId, req.user.id]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Quarter not found or not in open status' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bas/:quarterId/lodge', async (req, res) => {
  try {
    const { rows: qr } = await pool.query(`SELECT to_date FROM fin_bas_quarters WHERE id=$1 AND "userId"=$2`, [req.params.quarterId, req.user.id]);
    const step = await basStepDate(req, qr[0]);
    if (step.error) return res.status(400).json({ error: step.error });
    const { rows } = await pool.query(
      `UPDATE fin_bas_quarters SET status='lodged', lodged_at=($3::date + interval '12 hours'), "updatedAt"=NOW()
       WHERE id=$1 AND "userId"=$2 AND status='reconciled' RETURNING *`,
      [req.params.quarterId, req.user.id, step.date]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Quarter not found or not in reconciled status' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// T7: PAYG income-tax instalment for the quarter. Entered by the user (the ATO sets the amount);
// editable until the quarter is lodged, because it is part of what gets paid with the BAS.
router.post('/bas/:quarterId/payg-instalment', async (req, res) => {
  try {
    const amount = Math.round((parseFloat(req.body.amount) || 0) * 100) / 100;
    if (amount < 0) return res.status(400).json({ error: 'Amount can\'t be negative' });
    const { rows } = await pool.query(
      `UPDATE fin_bas_quarters SET "paygInstalment"=$1, "updatedAt"=NOW()
       WHERE id=$2 AND "userId"=$3 AND status IN ('open','reconciled') RETURNING *`,
      [amount, req.params.quarterId, req.user.id]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Quarter not found, or already lodged' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bas/:quarterId/paid', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;

    const { rows: qPre } = await dbClient.query(`SELECT to_date FROM fin_bas_quarters WHERE id=$1 AND "userId"=$2`, [req.params.quarterId, userId]);
    const step = await basStepDate(req, qPre[0]);
    if (step.error) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: step.error }); }
    const { rows: qRows } = await dbClient.query(
      `UPDATE fin_bas_quarters SET status='paid', paid_at=($3::date + interval '12 hours'), "updatedAt"=NOW()
       WHERE id=$1 AND "userId"=$2 AND status='lodged' RETURNING *`,
      [req.params.quarterId, userId, step.date]
    );
    if (!qRows[0]) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Quarter not found or not in lodged status' });
    }
    const quarter = qRows[0];
    const basis = await getGstBasis(dbClient, userId);

    // Recalculate what the BAS covers: GST on sales/purchases, PAYG withheld from wages (W2), and the
    // PAYG instalment (T7).
    const [invRows, wageRows, gstPaid] = await Promise.all([
      dbClient.query(
        `SELECT COALESCE(SUM(gst),0) AS "gstCollected" FROM fin_invoices WHERE "userId"=$1 AND ${gstSalesSql(basis, '', '$2', '$3')}`,
        [userId, quarter.from_date, quarter.to_date]
      ),
      dbClient.query(
        `SELECT COALESCE(SUM(tax),0) AS w2 FROM fin_wages WHERE "userId"=$1 AND date BETWEEN $2 AND $3`,
        [userId, quarter.from_date, quarter.to_date]
      ),
      gstPaidForRange(userId, quarter.from_date, quarter.to_date, basis),
    ]);
    const soldAssets   = await disposalSalesForRange(dbClient, userId, quarter.from_date, quarter.to_date);
    const gstCollected = round2(parseFloat(invRows.rows[0].gstCollected) + soldAssets.gst);
    const w2           = Math.round(parseFloat(wageRows.rows[0].w2) * 100) / 100;
    const t7           = Math.round((parseFloat(quarter.paygInstalment) || 0) * 100) / 100;

    // Journal: DR GST Collected, CR GST Paid, DR PAYG Withholding Payable (W2, clears what wages
    // accrued), DR Owner's Drawings (T7: a sole trader's instalment is personal income tax), and the
    // balancing Bank payment (or refund). Posted whenever any piece is non-zero so those accounts
    // clear even when the GST happens to net to $0.
    if (gstCollected > 0 || gstPaid > 0 || w2 > 0 || t7 > 0) {
      await ensureAccounts(userId);
      const gstColId  = await accountByCode(userId, '2200');
      const gstPaidId = await accountByCode(userId, '1200');
      const paygId    = await accountByCode(userId, '2400');
      const drawId    = await accountByCode(userId, '3100');
      const bankId    = await accountByCode(userId, '1000');
      if (gstColId && gstPaidId && paygId && drawId && bankId) {
        const lines = [];
        if (gstCollected > 0) lines.push({ accountId: gstColId,  debit: gstCollected, credit: 0 });
        if (gstPaid > 0)      lines.push({ accountId: gstPaidId, debit: 0, credit: gstPaid });
        if (w2 > 0)           lines.push({ accountId: paygId,    debit: w2, credit: 0 });
        if (t7 > 0)           lines.push({ accountId: drawId,    debit: t7, credit: 0 });
        const payable = Math.round((gstCollected - gstPaid + w2 + t7) * 100) / 100;
        if (payable > 0)      lines.push({ accountId: bankId,    debit: 0, credit: payable });
        else if (payable < 0) lines.push({ accountId: bankId,    debit: Math.abs(payable), credit: 0 });
        await createJournalEntry(dbClient, userId, {
          date:        step.date,
          description: `BAS payment — ${dateOnly(quarter.from_date)} to ${dateOnly(quarter.to_date)}`,
          type:        'bas',
          sourceId:    quarter.id,
          lines,
        });
      }
    }

    await dbClient.query('COMMIT');
    res.json(qRows[0]);
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// ── BAS — annual summary & warnings ───────────────────────────────────────────

router.get('/bas/annual', async (req, res) => {
  try {
    const userId = req.user.id;
    const year   = parseInt(req.query.year) || new Date().getFullYear();
    const prev   = year - 1;

    const quarterDefs = [
      { q: 1, label: `Q1 Jul–Sep ${prev}`, from: `${prev}-07-01`, to: `${prev}-09-30` },
      { q: 2, label: `Q2 Oct–Dec ${prev}`, from: `${prev}-10-01`, to: `${prev}-12-31` },
      { q: 3, label: `Q3 Jan–Mar ${year}`, from: `${year}-01-01`, to: `${year}-03-31` },
      { q: 4, label: `Q4 Apr–Jun ${year}`, from: `${year}-04-01`, to: `${year}-06-30` },
    ];

    const annualBasis = await getGstBasis(pool, userId);
    const quarters = await Promise.all(quarterDefs.map(async (qd) => {
      const [invRow, gstCredits, qRow] = await Promise.all([
        pool.query(
          `SELECT COALESCE(SUM(subtotal),0) AS income, COALESCE(SUM(gst),0) AS "gstCollected"
           FROM fin_invoices
           WHERE "userId"=$1 AND ${gstSalesSql(annualBasis, '', '$2', '$3')}`,
          [userId, qd.from, qd.to]
        ),
        gstPaidForRange(userId, qd.from, qd.to, annualBasis),
        pool.query(
          `SELECT id, status FROM fin_bas_quarters WHERE "userId"=$1 AND from_date=$2`,
          [userId, qd.from]
        ),
      ]);

      const soldAnnual = await disposalSalesForRange(pool, userId, qd.from, qd.to);
      const income     = round2(parseFloat(invRow.rows[0].income) + soldAnnual.net);
      const gstOnSales = round2(parseFloat(invRow.rows[0].gstCollected) + soldAnnual.gst);
      const g1         = parseFloat((income + gstOnSales).toFixed(2));
      const netGst     = parseFloat((gstOnSales - gstCredits).toFixed(2));
      const qRecord    = qRow.rows[0] || null;

      return {
        quarterId:   qRecord ? qRecord.id : null,
        quarter:     qd.q,
        label:       qd.label,
        periodStart: qd.from,
        periodEnd:   qd.to,
        g1,
        gstOnSales,
        gstCredits,
        netGst,
        status: qRecord ? qRecord.status : null,
      };
    }));

    const totals = {
      g1:         parseFloat(quarters.reduce((s, q) => s + q.g1, 0).toFixed(2)),
      gstOnSales: parseFloat(quarters.reduce((s, q) => s + q.gstOnSales, 0).toFixed(2)),
      gstCredits: parseFloat(quarters.reduce((s, q) => s + q.gstCredits, 0).toFixed(2)),
      netGst:     parseFloat(quarters.reduce((s, q) => s + q.netGst, 0).toFixed(2)),
    };

    res.json({ financialYear: `${prev}-${year}`, quarters, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/bas/:quarterId/warnings', async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows: qRows } = await pool.query(
      `SELECT from_date, to_date FROM fin_bas_quarters WHERE id=$1 AND "userId"=$2`,
      [req.params.quarterId, userId]
    );
    if (!qRows[0]) return res.status(404).json({ error: 'Quarter not found' });

    const { from_date, to_date } = qRows[0];
    const { rows: unpaidInvoices } = await pool.query(
      `SELECT i.id, i.number, c.name AS "clientName", i.total, i.status, i."dueDate"
       FROM fin_invoices i
       LEFT JOIN clients c ON c.id = i."clientRef"
       WHERE i."userId"=$1 AND i."issueDate"::date BETWEEN $2 AND $3
         AND i."docType" != 'quote' AND i.status IN ('draft','sent')
       ORDER BY i."issueDate", i.id`,
      [userId, from_date, to_date]
    );

    res.json({ unpaidInvoices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  try {
    const userId    = req.user.id;
    const tz        = await getWorkspaceTimezone();
    const today     = getDateInTz(tz);
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const from      = req.query.from || yearStart;
    const to        = req.query.to   || today;

    const [paid, outstanding, overdue, quotes, expenses, wages] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total
         FROM fin_invoices WHERE "userId"=$1 AND status='paid' AND "paidAt"::date BETWEEN $2 AND $3`,
        [userId, from, to]
      ),
      pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total
         FROM fin_invoices WHERE "userId"=$1 AND "docType" != 'quote'
           AND (status='draft' OR (status='sent' AND ("dueDate" IS NULL OR "dueDate"::date >= $2)))`,
        [userId, today]
      ),
      pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total
         FROM fin_invoices WHERE "userId"=$1 AND "docType" != 'quote' AND status='sent' AND "dueDate"::date < $2`,
        [userId, today]
      ),
      pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total
         FROM fin_invoices WHERE "userId"=$1 AND "docType"='quote' AND status IN ('draft','sent')`,
        [userId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount),0) AS total FROM fin_expenses WHERE "userId"=$1 AND date BETWEEN $2 AND $3`,
        [userId, from, to]
      ),
      pool.query(
        `SELECT COALESCE(SUM(gross),0) AS total FROM fin_wages WHERE "userId"=$1 AND date BETWEEN $2 AND $3`,
        [userId, from, to]
      ),
    ]);

    res.json({
      yearRevenue:       parseFloat(paid.rows[0].total),
      paidInvoices:      parseInt(paid.rows[0].count),
      outstandingAmount: parseFloat(outstanding.rows[0].total),
      outstandingCount:  parseInt(outstanding.rows[0].count),
      overdueAmount:     parseFloat(overdue.rows[0].total),
      overdueCount:      parseInt(overdue.rows[0].count),
      quotesAmount:      parseFloat(quotes.rows[0].total),
      quotesCount:       parseInt(quotes.rows[0].count),
      yearExpenses:      parseFloat(expenses.rows[0].total),
      yearWages:         parseFloat(wages.rows[0].total),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Exports ───────────────────────────────────────────────────────────────────

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(...cells) {
  return cells.map(csvEscape).join(',');
}

function fmtDateAU(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  const day = String(dt.getUTCDate()).padStart(2, '0');
  const mon = String(dt.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${mon}/${dt.getUTCFullYear()}`;
}

function fmtNum(n) {
  return (parseFloat(n) || 0).toFixed(2);
}

// ── Export history helpers ─────────────────────────────────────────────────────
function addOneDayStr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function readExportHistory(userId) {
  const { rows } = await pool.query(
    `SELECT value FROM settings WHERE "userId"=$1 AND key='fin_export_history' LIMIT 1`,
    [userId]
  );
  try { return rows[0] ? JSON.parse(rows[0].value) : {}; }
  catch { return {}; }
}

async function writeExportHistory(userId, history) {
  await pool.query(
    `INSERT INTO settings ("userId", key, value) VALUES ($1,'fin_export_history',$2)
     ON CONFLICT ("userId", key) DO UPDATE SET value=$2`,
    [userId, JSON.stringify(history)]
  );
}

function validateExportCutoff(history, typeKey, from) {
  const typeHistory = history[typeKey] || null;
  if (!typeHistory?.lastTo || !from) return null;
  const minFrom = addOneDayStr(typeHistory.lastTo);
  if (from < minFrom) {
    return {
      error: `This date range overlaps a previous ${typeKey.toUpperCase()} export (data up to ${typeHistory.lastTo} was already exported). The earliest allowed start date is ${minFrom}.`,
      cutoff: minFrom,
      lastTo: typeHistory.lastTo,
    };
  }
  return null;
}

// ── Export account mapping ──────────────────────────────────────────────────
// Internal chart-of-accounts codes (DEFAULT_ACCOUNTS) are arbitrary — they don't match a real
// accountant's MYOB/Xero file. Rather than re-typing the accountant's actual codes/tax types
// into an export wizard every single time, the mapping is entered once here and reused on
// every future myob/xero export automatically. Missing entries fall back to the internal code
// and the existing auto-detected tax code/type (current behaviour, unchanged).
async function getExportAccountMap(userId) {
  const { rows } = await pool.query(
    `SELECT value FROM settings WHERE "userId"=$1 AND key='fin_export_account_map' LIMIT 1`,
    [userId]
  );
  try { return rows[0] ? JSON.parse(rows[0].value) : {}; }
  catch { return {}; }
}

router.get('/export/account-map', async (req, res) => {
  try {
    const map = await getExportAccountMap(req.user.id);
    res.json({ accounts: DEFAULT_ACCOUNTS, map });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/export/account-map', async (req, res) => {
  try {
    const { map } = req.body;
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      return res.status(400).json({ error: 'map must be an object keyed by internal account code' });
    }
    const validCodes = new Set(DEFAULT_ACCOUNTS.map(a => a.code));
    const cleaned = {};
    for (const [code, entry] of Object.entries(map)) {
      if (!validCodes.has(code) || !entry || typeof entry !== 'object') continue;
      const row = {};
      if (entry.code && String(entry.code).trim())     row.code    = String(entry.code).trim();
      if (entry.name && String(entry.name).trim())     row.name    = String(entry.name).trim();
      if (entry.myobTax && String(entry.myobTax).trim()) row.myobTax = String(entry.myobTax).trim();
      if (entry.xeroTax && String(entry.xeroTax).trim()) row.xeroTax = String(entry.xeroTax).trim();
      if (Object.keys(row).length) cleaned[code] = row;
    }
    await pool.query(
      `INSERT INTO settings ("userId", key, value) VALUES ($1,'fin_export_account_map',$2)
       ON CONFLICT ("userId", key) DO UPDATE SET value=$2`,
      [req.user.id, JSON.stringify(cleaned)]
    );
    res.json({ ok: true, map: cleaned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset export history (allows any future export range — deliberate override)
router.delete('/export/history', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM settings WHERE "userId"=$1 AND key='fin_export_history'`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Nuclear option — set a specific cutoff date for one or all export formats
router.put('/export/history', async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, lastTo } = req.body; // type: 'myob'|'xero'|'excel'|'sheets'|'all', lastTo: 'YYYY-MM-DD'|null
    const VALID_TYPES = ['myob', 'xero', 'excel', 'sheets'];

    const history = await readExportHistory(userId);

    if (type === 'all') {
      // Clear every format
      for (const t of VALID_TYPES) delete history[t];
    } else if (VALID_TYPES.includes(type)) {
      if (lastTo) {
        history[type] = { lastTo, exportedAt: new Date().toISOString(), manualOverride: true };
      } else {
        delete history[type];
      }
    } else {
      return res.status(400).json({ error: 'Invalid export type' });
    }

    await writeExportHistory(userId, history);
    res.json({ ok: true, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MYOB General Journal format
router.get('/export/myob', async (req, res) => {
  try {
    const userId = req.user.id;
    const { from, to } = req.query;

    const history  = await readExportHistory(userId);
    const cutoffErr = validateExportCutoff(history, 'myob', from);
    if (cutoffErr) return res.status(409).json(cutoffErr);

    const accountMap = await getExportAccountMap(userId);

    let where = `e."userId"=$1`;
    const params = [userId];
    if (from) { params.push(from); where += ` AND e.date >= $${params.length}`; }
    if (to)   { params.push(to);   where += ` AND e.date <= $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT e.date, e.description, e.type,
        json_agg(
          json_build_object(
            'code',   a.code,
            'name',   a.name,
            'atype',  a.type,
            'debit',  l.debit,
            'credit', l.credit
          ) ORDER BY l.id
        ) AS lines
       FROM fin_journal_entries e
       JOIN fin_journal_lines l ON l."entryId" = e.id
       JOIN fin_accounts a ON a.id = l."accountId"
       WHERE ${where}
       GROUP BY e.id
       ORDER BY e.date ASC, e.id ASC`,
      params
    );

    const lines = ['Date,Memo,Tax Code,Account Number,Debit Amount,Credit Amount'];
    for (const entry of rows) {
      const hasGst = entry.lines.some(l => l.name && l.name.toUpperCase().includes('GST'));
      for (const line of entry.lines) {
        const mapped = accountMap[line.code] || {};
        const isGstAccount = line.name && line.name.toUpperCase().includes('GST');
        const autoTaxCode = (isGstAccount || (hasGst && (line.atype === 'expense' || line.atype === 'income')))
          ? 'GST'
          : 'N-T';
        const taxCode = mapped.myobTax || autoTaxCode;
        const accountNumber = mapped.code || line.code;
        lines.push(csvRow(
          fmtDateAU(entry.date),
          entry.description,
          taxCode,
          accountNumber,
          fmtNum(line.debit),
          fmtNum(line.credit)
        ));
      }
    }

    const today = await todayStr();
    history.myob = { lastTo: to || today, exportedAt: new Date().toISOString() };
    await writeExportHistory(userId, history).catch(e => console.error('[export/myob] history write failed:', e.message));

    const from2 = from ? from.replace(/-/g, '') : 'all';
    const to2   = to   ? to.replace(/-/g, '')   : 'all';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="myob-journal-${from2}-${to2}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Xero Manual Journal CSV export
// Format: *Narration,*Date,*AccountCode,*Description,*TaxType,*LineAmount
// LineAmount: positive = debit, negative = credit
// TaxType mapping: income → OUTPUT, expense → INPUT, everything else → BASEXCLUDED
router.get('/export/xero', async (req, res) => {
  try {
    const userId = req.user.id;
    const { from, to } = req.query;

    const history   = await readExportHistory(userId);
    const cutoffErr = validateExportCutoff(history, 'xero', from);
    if (cutoffErr) return res.status(409).json(cutoffErr);

    const accountMap = await getExportAccountMap(userId);

    let where = `e."userId"=$1`;
    const params = [userId];
    if (from) { params.push(from); where += ` AND e.date >= $${params.length}`; }
    if (to)   { params.push(to);   where += ` AND e.date <= $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT e.date, e.description, e.type,
        json_agg(
          json_build_object(
            'code',   a.code,
            'name',   a.name,
            'atype',  a.type,
            'debit',  l.debit,
            'credit', l.credit
          ) ORDER BY l.id
        ) AS lines
       FROM fin_journal_entries e
       JOIN fin_journal_lines l ON l."entryId" = e.id
       JOIN fin_accounts a ON a.id = l."accountId"
       WHERE ${where}
       GROUP BY e.id
       ORDER BY e.date ASC, e.id ASC`,
      params
    );

    function xeroTaxType(line, entryHasGst) {
      if (!entryHasGst) return 'BASEXCLUDED';
      if (line.atype === 'income')  return 'OUTPUT';
      if (line.atype === 'expense') return 'INPUT';
      return 'BASEXCLUDED';
    }

    const csvLines = ['*Narration,*Date,*AccountCode,*Description,*TaxType,*LineAmount'];
    for (const entry of rows) {
      const hasGst = entry.lines.some(l => l.name && l.name.toUpperCase().includes('GST'));
      const dateStr = fmtDateAU(entry.date);
      for (const line of entry.lines) {
        const mapped = accountMap[line.code] || {};
        const taxType = mapped.xeroTax || xeroTaxType(line, hasGst);
        const accountCode = mapped.code || line.code;
        const accountName = mapped.name || line.name;
        const lineAmt = parseFloat(line.debit || 0) - parseFloat(line.credit || 0);
        csvLines.push(csvRow(
          entry.description,
          dateStr,
          accountCode,
          accountName,
          taxType,
          fmtNum(lineAmt)
        ));
      }
    }

    const today = await todayStr();
    history.xero = { lastTo: to || today, exportedAt: new Date().toISOString() };
    await writeExportHistory(userId, history).catch(e => console.error('[export/xero] history write failed:', e.message));

    const from2 = from ? from.replace(/-/g, '') : 'all';
    const to2   = to   ? to.replace(/-/g, '')   : 'all';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="xero-journals-${from2}-${to2}.csv"`);
    res.send('\uFEFF' + csvLines.join('\r\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Excel (comprehensive transaction) export — real .xlsx using the xlsx library
router.get('/export/excel', async (req, res) => {
  try {
    const userId = req.user.id;
    const { from, to } = req.query;
    const XLSX = require('xlsx');

    const history   = await readExportHistory(userId);
    const cutoffErr = validateExportCutoff(history, 'excel', from);
    if (cutoffErr) return res.status(409).json(cutoffErr);

    const expParams = [userId];
    let expWhere = `e."userId"=$1`;
    if (from) { expParams.push(from); expWhere += ` AND e.date >= $${expParams.length}`; }
    if (to)   { expParams.push(to);   expWhere += ` AND e.date <= $${expParams.length}`; }

    const invParams = [userId];
    let invWhere = `i."userId"=$1 AND i."docType"='invoice'`;
    if (from) { invParams.push(from); invWhere += ` AND i."issueDate" >= $${invParams.length}`; }
    if (to)   { invParams.push(to);   invWhere += ` AND i."issueDate" <= $${invParams.length}`; }

    const wageParams = [userId];
    let wageWhere = `"userId"=$1`;
    if (from) { wageParams.push(from); wageWhere += ` AND date >= $${wageParams.length}`; }
    if (to)   { wageParams.push(to);   wageWhere += ` AND date <= $${wageParams.length}`; }

    const assetParams = [userId];
    let assetWhere = `"userId"=$1`;
    if (from) { assetParams.push(from); assetWhere += ` AND "datePurchased" >= $${assetParams.length}`; }
    if (to)   { assetParams.push(to);   assetWhere += ` AND "datePurchased" <= $${assetParams.length}`; }

    const drawParams = [userId];
    let drawWhere = `"userId"=$1`;
    if (from) { drawParams.push(from); drawWhere += ` AND date >= $${drawParams.length}`; }
    if (to)   { drawParams.push(to);   drawWhere += ` AND date <= $${drawParams.length}`; }

    // Manual journal entries + bank interest + BAS settlement — the entries that never land in
    // fin_expenses/fin_invoices/fin_wages/fin_assets/fin_drawings at all, so without this sheet
    // they'd export nowhere.
    const journalParams = [userId];
    let journalWhere = `e."userId"=$1 AND e.type IN ('manual','interest','bas')`;
    if (from) { journalParams.push(from); journalWhere += ` AND e.date >= $${journalParams.length}`; }
    if (to)   { journalParams.push(to);   journalWhere += ` AND e.date <= $${journalParams.length}`; }

    const [expenses, invoices, wages, assets, drawings, journalOther] = await Promise.all([
      pool.query(
        `SELECT e.date, e.description, e.supplier, e.amount, e.gst, e.category, e."ccSettled",
                a.code AS "accountCode", a.name AS "accountName", t.code AS "txCode"
         FROM fin_expenses e
         LEFT JOIN fin_accounts a ON a.id = e."paidViaId"
         LEFT JOIN fin_tx_codes t ON t.id = e."txCodeId"
         WHERE ${expWhere} ORDER BY e.date ASC, e.id ASC`, expParams),
      pool.query(
        `SELECT i.number, i."issueDate", i."dueDate", i.status, i.subtotal, i.gst, i.total,
                cr.name AS "clientName"
         FROM fin_invoices i
         LEFT JOIN clients cr ON cr.id = i."clientRef"
         WHERE ${invWhere} ORDER BY i."issueDate" ASC, i.id ASC`, invParams),
      pool.query(
        `SELECT date, employee, gross, tax, superannuation, net
         FROM fin_wages WHERE ${wageWhere} ORDER BY date ASC, id ASC`, wageParams),
      pool.query(
        `SELECT "datePurchased", description, amount, gst, "businessUsePercent", method,
                "effectiveLifeYears", "accumulatedDepreciation", "disposedDate", "disposalAmount"
         FROM fin_assets WHERE ${assetWhere} ORDER BY "datePurchased" ASC, id ASC`, assetParams),
      pool.query(
        `SELECT date, description, amount
         FROM fin_drawings WHERE ${drawWhere} ORDER BY date ASC, id ASC`, drawParams),
      pool.query(
        `SELECT e.date, e.description, e.type, SUM(l.debit) AS amount
         FROM fin_journal_entries e
         JOIN fin_journal_lines l ON l."entryId" = e.id
         WHERE ${journalWhere}
         GROUP BY e.id, e.date, e.description, e.type
         ORDER BY e.date ASC, e.id ASC`, journalParams),
    ]);

    const wb = XLSX.utils.book_new();

    // Helper: convert a pg Date/string to a JS Date for xlsx date cells
    const toDate = (d) => {
      if (!d) return '';
      const dt = d instanceof Date ? d : new Date(String(d).slice(0, 10) + 'T00:00:00');
      return isNaN(dt) ? '' : dt;
    };
    const num = (v) => parseFloat(v) || 0;

    // ── Sheet 1: Expenses ──────────────────────────────────────────────────
    const expRows = [['Date', 'Description', 'Supplier', 'Ex-GST', 'GST', 'Total', 'Category', 'Payment Account', 'Tx Code', 'CC Settled']];
    for (const e of expenses.rows) {
      expRows.push([
        toDate(e.date), e.description, e.supplier || '',
        num(e.amount), num(e.gst), num(e.amount) + num(e.gst),
        e.category || '',
        e.accountCode ? `${e.accountCode} — ${e.accountName}` : 'Bank / Cash',
        e.txCode || '', e.ccSettled ? 'Yes' : 'No',
      ]);
    }
    const wsExp = XLSX.utils.aoa_to_sheet(expRows);
    wsExp['!cols'] = [{ wch: 12 }, { wch: 36 }, { wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 22 }, { wch: 12 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsExp, 'Expenses');

    // ── Sheet 2: Invoices ──────────────────────────────────────────────────
    const invRows = [['Date', 'Due Date', 'Invoice No.', 'Client', 'Subtotal', 'GST', 'Total', 'Status']];
    for (const i of invoices.rows) {
      invRows.push([
        toDate(i.issueDate), toDate(i.dueDate), i.number,
        i.clientName || '', num(i.subtotal), num(i.gst), num(i.total),
        i.status,
      ]);
    }
    const wsInv = XLSX.utils.aoa_to_sheet(invRows);
    wsInv['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 28 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsInv, 'Invoices');

    // ── Sheet 3: Wages ─────────────────────────────────────────────────────
    const wageRows = [['Date', 'Employee', 'Gross', 'Tax Withheld', 'Superannuation', 'Net Pay']];
    for (const w of wages.rows) {
      wageRows.push([toDate(w.date), w.employee, num(w.gross), num(w.tax), num(w.superannuation), num(w.net)]);
    }
    const wsWage = XLSX.utils.aoa_to_sheet(wageRows);
    wsWage['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsWage, 'Wages');

    // ── Sheet 4: Assets ────────────────────────────────────────────────────
    const assetRows = [['Date Purchased', 'Description', 'Ex-GST Cost', 'GST', 'Business Use %', 'Method', 'Effective Life (yrs)', 'Accum. Depreciation', 'Disposed Date', 'Disposal Amount']];
    for (const a of assets.rows) {
      assetRows.push([
        toDate(a.datePurchased), a.description, num(a.amount), num(a.gst), num(a.businessUsePercent),
        a.method || '', a.effectiveLifeYears ? num(a.effectiveLifeYears) : '',
        num(a.accumulatedDepreciation), toDate(a.disposedDate), a.disposalAmount != null ? num(a.disposalAmount) : '',
      ]);
    }
    const wsAsset = XLSX.utils.aoa_to_sheet(assetRows);
    wsAsset['!cols'] = [{ wch: 12 }, { wch: 32 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsAsset, 'Assets');

    // ── Sheet 5: Drawings ──────────────────────────────────────────────────
    const drawRows = [['Date', 'Description', 'Amount']];
    for (const d of drawings.rows) {
      drawRows.push([toDate(d.date), d.description || '', num(d.amount)]);
    }
    const wsDraw = XLSX.utils.aoa_to_sheet(drawRows);
    wsDraw['!cols'] = [{ wch: 12 }, { wch: 32 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsDraw, 'Drawings');

    // ── Sheet 6: Other Journal (manual entries, bank interest, BAS settlements) ────────────
    const journalRows = [['Date', 'Type', 'Description', 'Amount']];
    for (const j of journalOther.rows) {
      journalRows.push([toDate(j.date), j.type, j.description || '', num(j.amount)]);
    }
    const wsJournal = XLSX.utils.aoa_to_sheet(journalRows);
    wsJournal['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 36 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsJournal, 'Other Journal');

    const today = await todayStr();
    history.excel = { lastTo: to || today, exportedAt: new Date().toISOString() };
    await writeExportHistory(userId, history).catch(e => console.error('[export/excel] history write failed:', e.message));

    const from2 = from ? from.replace(/-/g, '') : 'all';
    const to2   = to   ? to.replace(/-/g, '')   : 'all';
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="finance-export-${from2}-${to2}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Google Sheets — combined single-sheet CSV, all transactions in date order
router.get('/export/sheets', async (req, res) => {
  try {
    const userId = req.user.id;
    const { from, to } = req.query;

    const history   = await readExportHistory(userId);
    const cutoffErr = validateExportCutoff(history, 'sheets', from);
    if (cutoffErr) return res.status(409).json(cutoffErr);

    // Each query needs its own independent params array to avoid cross-contamination
    const makeParams = () => {
      const p = [userId];
      let where = `"userId"=$1`;
      if (from) { p.push(from); where += ` AND %COL% >= $${p.length}`; }
      if (to)   { p.push(to);   where += ` AND %COL% <= $${p.length}`; }
      return { p, where };
    };

    const exp   = makeParams();
    const inv   = makeParams();
    const wage  = makeParams();
    const asset = makeParams();
    const draw  = makeParams();
    const jnl   = makeParams();

    const [expRows, invRows, wageRows, assetRows, drawRows, jnlRows] = await Promise.all([
      pool.query(
        `SELECT e.date, e.description, e.supplier AS party, e.amount, e.gst,
                e.amount + e.gst AS total, e.category AS notes, 'Expense' AS type
         FROM fin_expenses e
         WHERE ${exp.where.replace(/%COL%/g, 'e.date').replace('"userId"', 'e."userId"')}
         ORDER BY e.date ASC, e.id ASC`,
        exp.p
      ),
      pool.query(
        `SELECT i."issueDate" AS date,
                cr.name AS party,
                i.number AS description, i.subtotal AS amount, i.gst,
                i.total, i.notes,
                CASE WHEN i."docType"='quote' THEN 'Quote' ELSE 'Invoice' END AS type
         FROM fin_invoices i
         LEFT JOIN clients cr ON cr.id = i."clientRef"
         WHERE ${inv.where.replace(/%COL%/g, 'i."issueDate"').replace('"userId"', 'i."userId"')}
         ORDER BY i."issueDate" ASC, i.id ASC`,
        inv.p
      ),
      pool.query(
        `SELECT date, employee AS party, 'Wages — ' || employee AS description,
                gross AS amount, 0 AS gst, net AS total,
                'Tax: ' || tax || '  Super: ' || superannuation AS notes,
                'Wage' AS type
         FROM fin_wages
         WHERE ${wage.where.replace(/%COL%/g, 'date')}
         ORDER BY date ASC, id ASC`,
        wage.p
      ),
      pool.query(
        `SELECT "datePurchased" AS date, '' AS party, description,
                amount, gst, amount + gst AS total,
                'Method: ' || COALESCE(method,'') || '  Business use: ' || "businessUsePercent" || '%' AS notes,
                'Asset' AS type
         FROM fin_assets
         WHERE ${asset.where.replace(/%COL%/g, '"datePurchased"')}
         ORDER BY "datePurchased" ASC, id ASC`,
        asset.p
      ),
      pool.query(
        `SELECT date, '' AS party, COALESCE(description, 'Drawing') AS description,
                amount, 0 AS gst, amount AS total, '' AS notes,
                'Drawing' AS type
         FROM fin_drawings
         WHERE ${draw.where.replace(/%COL%/g, 'date')}
         ORDER BY date ASC, id ASC`,
        draw.p
      ),
      pool.query(
        `SELECT e.date, '' AS party, e.description,
                SUM(l.debit) AS amount, 0 AS gst, SUM(l.debit) AS total, '' AS notes,
                INITCAP(e.type) AS type
         FROM fin_journal_entries e
         JOIN fin_journal_lines l ON l."entryId" = e.id
         WHERE ${jnl.where.replace(/%COL%/g, 'e.date').replace('"userId"', 'e."userId"')} AND e.type IN ('manual','interest','bas')
         GROUP BY e.id, e.date, e.description, e.type
         ORDER BY e.date ASC, e.id ASC`,
        jnl.p
      ),
    ]);

    const allRows = [
      ...expRows.rows,
      ...invRows.rows,
      ...wageRows.rows,
      ...assetRows.rows,
      ...drawRows.rows,
      ...jnlRows.rows,
    ].sort((a, b) => String(a.date).slice(0,10).localeCompare(String(b.date).slice(0,10)));

    const lines = ['Date,Type,Description,Party,Amount (ex GST),GST,Total,Notes'];
    for (const r of allRows) {
      lines.push(csvRow(
        fmtDateAU(r.date),
        r.type,
        r.description || '',
        r.party || '',
        fmtNum(r.amount),
        fmtNum(r.gst),
        fmtNum(r.total),
        r.notes || ''
      ));
    }

    const today = await todayStr();
    history.sheets = { lastTo: to || today, exportedAt: new Date().toISOString() };
    await writeExportHistory(userId, history).catch(e => console.error('[export/sheets] history write failed:', e.message));

    const from2 = from ? from.replace(/-/g, '') : 'all';
    const to2   = to   ? to.replace(/-/g, '')   : 'all';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="finance-sheets-${from2}-${to2}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



router.get('/interest', async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [req.user.id];
    let dateWhere = '';
    if (from) { params.push(from); dateWhere += ` AND e.date >= $${params.length}`; }
    if (to)   { params.push(to);   dateWhere += ` AND e.date <= $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT e.id, e.date, e.description,
              SUM(l.debit) AS amount
       FROM fin_journal_entries e
       JOIN fin_journal_lines l ON l."entryId" = e.id
       WHERE e."userId"=$1 AND e.type='interest'${dateWhere}
       GROUP BY e.id, e.date, e.description
       ORDER BY e.date DESC, e.id DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/interest', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { date, amount, description } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Valid amount required' }); }

    await ensureAccounts(userId);
    const bankId     = await accountByCode(userId, '1000');
    const interestId = await accountByCode(userId, '4100');
    if (!bankId || !interestId) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'Required accounts not found' }); }

    const entryId = await createJournalEntry(dbClient, userId, {
      date:        date || await todayStr(),
      description: description?.trim() || 'Bank interest',
      type:        'interest',
      lines: [
        { accountId: bankId,     debit: amt, credit: 0 },
        { accountId: interestId, debit: 0,   credit: amt },
      ],
    });

    await dbClient.query('COMMIT');
    res.json({ id: entryId });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

router.delete('/interest/:id', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const { rows } = await dbClient.query(
      `SELECT id FROM fin_journal_entries WHERE id=$1 AND "userId"=$2 AND type='interest'`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    await dbClient.query(`DELETE FROM fin_journal_lines WHERE "entryId"=$1`, [req.params.id]);
    await dbClient.query(`DELETE FROM fin_journal_entries WHERE id=$1`, [req.params.id]);
    await dbClient.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// ── Trial Balance ─────────────────────────────────────────────────────────────

router.get('/trial-balance', async (req, res) => {
  try {
    await ensureAccounts(req.user.id);
    const { rows } = await pool.query(
      `SELECT
         a.id, a.code, a.name, a.type,
         COALESCE(SUM(l.debit),  0) AS "totalDebit",
         COALESCE(SUM(l.credit), 0) AS "totalCredit"
       FROM fin_accounts a
       LEFT JOIN fin_journal_lines l ON l."accountId" = a.id
       LEFT JOIN fin_journal_entries e ON e.id = l."entryId" AND e."userId" = $1
       WHERE a."userId" = $1
       GROUP BY a.id, a.code, a.name, a.type
       ORDER BY a.code`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reports: Profit & Loss / Balance Sheet / GST summary / Trial Balance ─────
// All four are derived from fin_journal_entries/fin_journal_lines (the journal is the source of
// truth) — NOT by re-summing fin_invoices/fin_expenses/fin_wages separately, so manual journal
// entries flow into them correctly, which summing the source tables would miss.

router.get('/reports/profit-loss', async (req, res) => {
  try {
    const userId = req.user.id;
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    await ensureAccounts(userId);

    const { rows } = await pool.query(
      `SELECT a.id, a.code, a.name, a.type,
              COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit ELSE 0 END),0)  AS "totalDebit",
              COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit ELSE 0 END),0) AS "totalCredit"
       FROM fin_accounts a
       LEFT JOIN fin_journal_lines l ON l."accountId" = a.id
       LEFT JOIN fin_journal_entries e ON e.id = l."entryId" AND e."userId" = a."userId"
         AND e.date BETWEEN $2 AND $3
       WHERE a."userId" = $1 AND a.type IN ('income','expense')
       GROUP BY a.id, a.code, a.name, a.type
       ORDER BY a.code`,
      [userId, from, to]
    );

    const income = [];
    const expenses = [];
    let totalIncome = 0, totalExpense = 0;
    for (const r of rows) {
      const debit = Number(r.totalDebit), credit = Number(r.totalCredit);
      if (r.type === 'income') {
        const amount = parseFloat((credit - debit).toFixed(2));
        if (amount !== 0) { income.push({ code: r.code, name: r.name, amount }); totalIncome += amount; }
      } else {
        const amount = parseFloat((debit - credit).toFixed(2));
        if (amount !== 0) { expenses.push({ code: r.code, name: r.name, amount }); totalExpense += amount; }
      }
    }
    totalIncome  = parseFloat(totalIncome.toFixed(2));
    totalExpense = parseFloat(totalExpense.toFixed(2));

    // Capital-asset-flagged expenses in the period — called out separately per B3, not lumped
    // into ordinary expenses (still counted in totalExpense above; this is informational only).
    const { rows: capitalRows } = await pool.query(
      `SELECT id, date, description, amount, gst, category
       FROM fin_expenses
       WHERE "userId"=$1 AND "isCapitalAsset"=true AND date BETWEEN $2 AND $3
       ORDER BY date`,
      [userId, from, to]
    );

    res.json({
      from, to,
      income,
      expenses,
      totalIncome,
      totalExpense,
      netProfit: parseFloat((totalIncome - totalExpense).toFixed(2)),
      capitalAssetPurchases: capitalRows.map(r => ({
        id: r.id, date: r.date, description: r.description,
        amount: Number(r.amount), gst: Number(r.gst), category: r.category,
      })),
      capitalAssetNote: 'Capital purchases below (not automatically depreciated — provide to your accountant for the asset register / instant-asset-write-off assessment).',
      cashBasisNote: 'GST is calculated on a cash basis (recognized when paid/received). If you report GST on an accrual basis, these figures will not match your actual BAS.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/balance-sheet', async (req, res) => {
  try {
    const userId = req.user.id;
    const asOf = req.query.asOf || await todayStr();
    await ensureAccounts(userId);

    const { rows } = await pool.query(
      `SELECT a.id, a.code, a.name, a.type,
              COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit ELSE 0 END),0)  AS "totalDebit",
              COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit ELSE 0 END),0) AS "totalCredit"
       FROM fin_accounts a
       LEFT JOIN fin_journal_lines l ON l."accountId" = a.id
       LEFT JOIN fin_journal_entries e ON e.id = l."entryId" AND e."userId" = a."userId"
         AND e.date <= $2
       WHERE a."userId" = $1 AND a.type IN ('asset','liability','equity')
       GROUP BY a.id, a.code, a.name, a.type
       ORDER BY a.code`,
      [userId, asOf]
    );

    // Also fold in the period's net profit as a movement in retained earnings (equity),
    // computed the same journal-derived way as the P&L report — required for
    // Assets = Liabilities + Equity to hold, since income/expense accounts aren't on the
    // balance sheet themselves; their net effect closes to equity.
    const { rows: peRows } = await pool.query(
      `SELECT a.type,
              COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit ELSE 0 END),0)  AS "totalDebit",
              COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit ELSE 0 END),0) AS "totalCredit"
       FROM fin_accounts a
       LEFT JOIN fin_journal_lines l ON l."accountId" = a.id
       LEFT JOIN fin_journal_entries e ON e.id = l."entryId" AND e."userId" = a."userId"
         AND e.date <= $2
       WHERE a."userId" = $1 AND a.type IN ('income','expense')
       GROUP BY a.type`,
      [userId, asOf]
    );
    let retainedEarnings = 0;
    for (const r of peRows) {
      const debit = Number(r.totalDebit), credit = Number(r.totalCredit);
      retainedEarnings += r.type === 'income' ? (credit - debit) : -(debit - credit);
    }
    retainedEarnings = parseFloat(retainedEarnings.toFixed(2));

    const assets = [], liabilities = [], equity = [];
    let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;
    for (const r of rows) {
      const debit = Number(r.totalDebit), credit = Number(r.totalCredit);
      if (r.type === 'asset') {
        const balance = parseFloat((debit - credit).toFixed(2));
        assets.push({ code: r.code, name: r.name, balance }); totalAssets += balance;
      } else if (r.type === 'liability') {
        const balance = parseFloat((credit - debit).toFixed(2));
        liabilities.push({ code: r.code, name: r.name, balance }); totalLiabilities += balance;
      } else {
        const balance = parseFloat((credit - debit).toFixed(2));
        equity.push({ code: r.code, name: r.name, balance }); totalEquity += balance;
      }
    }
    equity.push({ code: '—', name: 'Retained Earnings (current profit/loss)', balance: retainedEarnings });
    totalEquity = parseFloat((totalEquity + retainedEarnings).toFixed(2));
    totalAssets = parseFloat(totalAssets.toFixed(2));
    totalLiabilities = parseFloat(totalLiabilities.toFixed(2));

    const balances = parseFloat((totalAssets - (totalLiabilities + totalEquity)).toFixed(2));
    // Verified internally, not papered over — if this is ever non-zero, it is a real bug in a
    // journal-posting code path (see brief B/Balance Sheet), not something to plug here.
    const isBalanced = Math.abs(balances) < 0.005;

    res.json({
      asOf,
      assets, liabilities, equity,
      totalAssets, totalLiabilities, totalEquity,
      isBalanced,
      difference: balances,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/gst-summary', async (req, res) => {
  try {
    const userId = req.user.id;
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    // Reuses the same calculation as /bas (the chosen GST basis) -- adds a breakdown by tx code on top
    // rather than reimplementing the totals.
    const basis = await getGstBasis(pool, userId);
    const [totalsInv, totalsExp, gstPaid, byIncomeCode, byExpenseCode] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(subtotal),0) AS income, COALESCE(SUM(gst),0) AS "gstCollected"
         FROM fin_invoices WHERE "userId"=$1 AND ${gstSalesSql(basis, '', '$2', '$3')}`,
        [userId, from, to]
      ),
      pool.query(
        `SELECT COALESCE(SUM(e.amount),0) AS expenses
         FROM ${PURCHASES_FROM} WHERE e."userId"=$1 AND ${purchaseClaimDateSql(basis)} BETWEEN $2 AND $3`,
        [userId, from, to]
      ),
      gstPaidForRange(userId, from, to, basis),
      pool.query(
        `SELECT COALESCE(t.code,'(none)') AS code, COALESCE(t.name,'Uncategorised') AS name,
                COALESCE(SUM(ii.amount),0) AS amount, COALESCE(SUM(ii.gst),0) AS gst
         FROM fin_invoice_items ii
         JOIN fin_invoices i ON i.id = ii."invoiceId"
         LEFT JOIN fin_tx_codes t ON t.id = ii."txCodeId"
         WHERE i."userId"=$1 AND ${gstSalesSql(basis, 'i', '$2', '$3')}
         GROUP BY t.code, t.name ORDER BY t.code NULLS LAST`,
        [userId, from, to]
      ),
      pool.query(
        `SELECT COALESCE(t.code,'(none)') AS code, COALESCE(t.name,'Uncategorised') AS name,
                COALESCE(SUM(e.amount),0) AS amount, COALESCE(SUM(e.gst),0) AS gst
         FROM ${PURCHASES_FROM}
         LEFT JOIN fin_tx_codes t ON t.id = e."txCodeId"
         WHERE e."userId"=$1 AND ${purchaseClaimDateSql(basis)} BETWEEN $2 AND $3
         GROUP BY t.code, t.name ORDER BY t.code NULLS LAST`,
        [userId, from, to]
      ),
    ]);

    const soldSummary = await disposalSalesForRange(pool, userId, from, to);
    const gstCollected = round2(parseFloat(totalsInv.rows[0].gstCollected) + soldSummary.gst);

    res.json({
      from, to,
      income:         round2(parseFloat(totalsInv.rows[0].income) + soldSummary.net),
      gstCollected,
      expenses:       parseFloat(totalsExp.rows[0].expenses),
      gstPaid,
      netGst:         parseFloat((gstCollected - gstPaid).toFixed(2)),
      byIncomeCode:   byIncomeCode.rows.map(r => ({ code: r.code, name: r.name, amount: Number(r.amount), gst: Number(r.gst) })),
      byExpenseCode:  byExpenseCode.rows.map(r => ({ code: r.code, name: r.name, amount: Number(r.amount), gst: Number(r.gst) })),
      basis,
      cashBasisNote:  basis === 'accrual'
        ? 'GST is calculated on an accrual basis (recognized when invoiced / when the bill is dated), as set in Finance → Settings.'
        : 'GST is calculated on a cash basis (recognized when paid/received). If you report GST on an accrual basis, switch the GST basis in Finance → Settings.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/trial-balance', async (req, res) => {
  try {
    const userId = req.user.id;
    const asOf = req.query.asOf || await todayStr();
    await ensureAccounts(userId);

    const { rows } = await pool.query(
      `SELECT a.id, a.code, a.name, a.type,
              COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit ELSE 0 END),0)  AS "totalDebit",
              COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit ELSE 0 END),0) AS "totalCredit"
       FROM fin_accounts a
       LEFT JOIN fin_journal_lines l ON l."accountId" = a.id
       LEFT JOIN fin_journal_entries e ON e.id = l."entryId" AND e."userId" = a."userId"
         AND e.date <= $2
       WHERE a."userId" = $1
       GROUP BY a.id, a.code, a.name, a.type
       ORDER BY a.code`,
      [userId, asOf]
    );

    let totalDebit = 0, totalCredit = 0;
    const accounts = rows.map(r => {
      const debit = Number(r.totalDebit), credit = Number(r.totalCredit);
      const net = parseFloat((debit - credit).toFixed(2));
      // Normal-balance presentation: assets/expenses show a debit balance, liabilities/
      // equity/income show a credit balance (matches trial-balance convention).
      const debitBalance  = net >= 0 ? Math.abs(net) : 0;
      const creditBalance = net < 0 ? Math.abs(net) : 0;
      totalDebit  += debitBalance;
      totalCredit += creditBalance;
      return { code: r.code, name: r.name, type: r.type, debitBalance, creditBalance };
    });
    totalDebit  = parseFloat(totalDebit.toFixed(2));
    totalCredit = parseFloat(totalCredit.toFixed(2));

    res.json({
      asOf,
      accounts,
      totalDebit,
      totalCredit,
      // Direct consequence of A1's balance guarantee — every entry that was ever posted balanced,
      // so summed across all accounts these two totals must match. This is a verification, not new logic.
      isBalanced: Math.abs(totalDebit - totalCredit) < 0.005,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Charts data ───────────────────────────────────────────────────────────────

router.get('/reports/chart-income-expense', async (req, res) => {
  try {
    const userId = req.user.id;
    await ensureAccounts(userId);
    const { rows } = await pool.query(
      `SELECT to_char(e.date, 'YYYY-MM') AS month, a.type,
              COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit
       FROM fin_journal_entries e
       JOIN fin_journal_lines l ON l."entryId" = e.id
       JOIN fin_accounts a ON a.id = l."accountId"
       WHERE e."userId"=$1 AND a.type IN ('income','expense')
         AND e.date >= (CURRENT_DATE - INTERVAL '12 months')
       GROUP BY month, a.type
       ORDER BY month`,
      [userId]
    );
    const byMonth = {};
    for (const r of rows) {
      byMonth[r.month] = byMonth[r.month] || { month: r.month, income: 0, expense: 0 };
      const debit = Number(r.debit), credit = Number(r.credit);
      if (r.type === 'income')  byMonth[r.month].income  += (credit - debit);
      else                      byMonth[r.month].expense += (debit - credit);
    }
    const points = Object.values(byMonth)
      .map(p => ({ month: p.month, income: parseFloat(p.income.toFixed(2)), expense: parseFloat(p.expense.toFixed(2)) }))
      .sort((a, b) => a.month.localeCompare(b.month));
    res.json({ points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/chart-cash-flow', async (req, res) => {
  try {
    const userId = req.user.id;
    await ensureAccounts(userId);
    const bankId = await accountByCode(userId, '1000');
    if (!bankId) return res.json({ points: [] });

    const { rows } = await pool.query(
      `SELECT e.date, COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0) AS "netMove"
       FROM fin_journal_entries e
       JOIN fin_journal_lines l ON l."entryId" = e.id
       WHERE e."userId"=$1 AND l."accountId"=$2
         AND e.date >= (CURRENT_DATE - INTERVAL '12 months')
       GROUP BY e.date
       ORDER BY e.date`,
      [userId, bankId]
    );
    // Opening balance = bank account balance strictly before the 12-month window
    const { rows: openingRows } = await pool.query(
      `SELECT COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0) AS balance
       FROM fin_journal_entries e
       JOIN fin_journal_lines l ON l."entryId" = e.id
       WHERE e."userId"=$1 AND l."accountId"=$2 AND e.date < (CURRENT_DATE - INTERVAL '12 months')`,
      [userId, bankId]
    );
    let running = Number(openingRows[0]?.balance || 0);
    const points = rows.map(r => {
      running += Number(r.netMove);
      return { date: String(r.date).slice(0, 10), balance: parseFloat(running.toFixed(2)) };
    });
    res.json({ points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/chart-gst-quarters', async (req, res) => {
  try {
    const userId = req.user.id;
    const gstPaidAccountId = await accountByCode(userId, '1200');
    const basis = await getGstBasis(pool, userId);
    const { rows } = await pool.query(
      `SELECT q.id AS "quarterId", q.from_date AS "from", q.to_date AS "to",
              COALESCE((SELECT SUM(gst) FROM fin_invoices WHERE "userId"=$1
                        AND ${gstSalesSql(basis, '', 'q.from_date', 'q.to_date')}), 0)
              + COALESCE((SELECT SUM("disposalGst") FROM fin_assets WHERE "userId"=$1
                          AND "disposedDate" BETWEEN q.from_date AND q.to_date), 0) AS "gstCollected",
              COALESCE((SELECT SUM(e.gst) FROM ${PURCHASES_FROM} WHERE e."userId"=$1
                        AND ${purchaseClaimDateSql(basis)} BETWEEN q.from_date AND q.to_date), 0)
              + COALESCE((SELECT SUM(l.debit) FROM fin_journal_entries e
                          JOIN fin_journal_lines l ON l."entryId" = e.id
                          WHERE e."userId"=$1 AND e.type='asset_purchase' AND l."accountId"=$2
                            AND e.date BETWEEN q.from_date AND q.to_date), 0) AS "gstPaid"
       FROM fin_bas_quarters q
       WHERE q."userId"=$1
       ORDER BY q.from_date DESC
       LIMIT 8`,
      [userId, gstPaidAccountId || 0]
    );
    const points = rows.reverse().map(r => ({
      quarterId: r.quarterId,
      label: `${String(r.from).slice(0, 7)}`,
      gstCollected: parseFloat(Number(r.gstCollected).toFixed(2)),
      gstPaid: parseFloat(Number(r.gstPaid).toFixed(2)),
    }));
    res.json({ points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Extra reports (aged receivables/payables, general ledger, cash flow statement, comparisons,
// BAS worksheet, budgets, statements, ...) live in their own file to keep this one manageable.
// Mounted after the four original /reports/* routes above, which never overlap with its paths.
router.use('/reports', require('./financeReports')({ gstPaidForRange, disposalSalesForRange, getGstBasis, gstSalesSql, purchaseClaimDateSql, PURCHASES_FROM }));

// Exposed for server/routes/expenseReview.js so bulk expense creation from the invoice
// review queue reuses the exact same insert+journal path as manual expense entry, and
// (RECEIPT_DIR) so it can drop the already-downloaded invoice PDF straight into Finance's
// existing receipt storage instead of inventing a second file location.
router.createExpenseRecord = createExpenseRecord;
// Exposed for server/cron/recurringCron.js (recurring expenses must post a journal) and tests.
router.createJournalEntry = createJournalEntry;
router.ensureAccounts = ensureAccounts;
router.accountByCode = accountByCode;
router.computeAssetYearDepreciation = computeAssetYearDepreciation;
router.todayStr = todayStr;
router.getGstBasis = getGstBasis;
router.getGstRegistration = getGstRegistration;
router.gstAppliesOn = gstAppliesOn;
router.disposalSalesForRange = disposalSalesForRange;
router.deleteJournalForSource = deleteJournalForSource;
router.postInvoiceJournal = postInvoiceJournal;
router.RECEIPT_DIR = RECEIPT_DIR;

module.exports = router;
