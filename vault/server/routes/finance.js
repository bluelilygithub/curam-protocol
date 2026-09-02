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
  { code: '3000', name: "Owner's Equity",         type: 'equity'    },
  { code: '4000', name: 'Income',                 type: 'income'    },
  { code: '4100', name: 'Interest Income',        type: 'income'    },
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
  { code: 'EXP-900', name: 'Other Expenses',                     type: 'expense' },
];

async function ensureTxCodes(userId) {
  const { rows } = await pool.query(
    'SELECT id FROM fin_tx_codes WHERE "userId"=$1 LIMIT 1', [userId]
  );
  if (rows.length) return;
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

async function createJournalEntry(client, userId, { date, description, reference, type, sourceId, lines }) {
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
    const keys = ['fin_biz_name','fin_abn','fin_address','fin_bank_name','fin_account_name','fin_bsb','fin_account_number','fin_gst_registered','fin_payment_terms','fin_admin_email','fin_reminder_hour','fin_export_history'];
    const { rows } = await pool.query(
      `SELECT key, value FROM settings WHERE "userId"=$1 AND key = ANY($2)`,
      [req.user.id, keys]
    );
    const result = {};
    for (const r of rows) result[r.key] = r.value;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const allowed = ['fin_biz_name','fin_abn','fin_address','fin_bank_name','fin_account_name','fin_bsb','fin_account_number','fin_gst_registered','fin_payment_terms','fin_admin_email','fin_reminder_hour'];
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed.includes(key)) continue;
      await pool.query(
        `INSERT INTO settings ("userId", key, value) VALUES ($1,$2,$3)
         ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`,
        [req.user.id, key, String(value)]
      );
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

router.get('/clients', async (req, res) => {
  const activeOnly = req.query.activeOnly === 'true';
  try {
    let query = `
      SELECT id, name, "contactName", email, phone, address, abn, "isActive", 'fin' AS source FROM fin_clients WHERE "userId"=$1
        ${activeOnly ? 'AND "isActive" = TRUE' : ''}
      UNION ALL
      SELECT id, name, NULL AS "contactName", NULL AS email, NULL AS phone, NULL AS address, NULL AS abn, TRUE AS "isActive", 'crm' AS source
        FROM clients WHERE "userId"=$1 ${activeOnly ? "AND status = 'active'" : ''}
      ORDER BY name`;
    const { rows } = await pool.query(query, [req.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clients', async (req, res) => {
  try {
    const { name, contactName, email, phone, address, abn } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { rows } = await pool.query(
      `INSERT INTO fin_clients ("userId", name, "contactName", email, phone, address, abn) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, name.trim(), contactName||null, email||null, phone||null, address||null, abn||null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/clients/:id', async (req, res) => {
  try {
    const { name, contactName, email, phone, address, abn } = req.body;
    const { rows } = await pool.query(
      `UPDATE fin_clients SET name=$1, "contactName"=$2, email=$3, phone=$4, address=$5, abn=$6, "updatedAt"=NOW()
       WHERE id=$7 AND "userId"=$8 RETURNING *`,
      [name, contactName||null, email||null, phone||null, address||null, abn||null, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/clients/:id', async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be boolean' });
    const { rows } = await pool.query(
      `UPDATE fin_clients SET "isActive"=$1, "updatedAt"=NOW() WHERE id=$2 AND "userId"=$3 RETURNING *`,
      [isActive, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/clients/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM fin_clients WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

router.get('/invoices', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, COALESCE(fc.name, cr.name) AS "clientName",
              COALESCE(fc.email,
                (SELECT cc.email FROM client_contacts cc
                 WHERE cc."clientId" = cr.id AND cc.email IS NOT NULL
                 ORDER BY cc."isPrimary" DESC, cc.id ASC LIMIT 1)
              ) AS "clientEmail",
              EXISTS (
                SELECT 1 FROM fin_bas_quarters q
                WHERE q."userId" = i."userId"
                  AND i."paidAt"::date BETWEEN q.from_date AND q.to_date
                  AND q.status != 'open'
              ) AS "isLocked"
       FROM fin_invoices i
       LEFT JOIN fin_clients fc ON fc.id = i."clientId"
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
    const { clientId, clientRef, issueDate, dueDate, notes, items = [], docType = 'invoice' } = req.body;

    let subtotal = 0, gst = 0;
    for (const item of items) {
      const qty     = parseFloat(item.qty) || 0;
      const up      = parseFloat(item.unitPrice) || 0;
      const amt     = parseFloat((qty * up).toFixed(2));
      const taxable = calcItemGst(item);
      const itemGst = taxable ? parseFloat((amt * 0.1).toFixed(2)) : 0;
      item._qty     = qty;
      item._up      = up;
      item._amount  = amt;
      item._gst     = itemGst;
      item._gstCode = taxable ? 'GST' : (item.gstCode || 'NT');
      subtotal += amt;
      gst      += itemGst;
    }
    subtotal = parseFloat(subtotal.toFixed(2));
    gst      = parseFloat(gst.toFixed(2));
    const total = parseFloat((subtotal + gst).toFixed(2));

    const number = await nextInvoiceNumber(userId, docType);
    const { rows } = await client.query(
      `INSERT INTO fin_invoices ("userId","clientId","clientRef",number,status,"issueDate","dueDate",subtotal,gst,total,notes,"docType")
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [userId, clientId||null, clientRef||null, number, issueDate||new Date().toISOString().slice(0,10), dueDate||null, subtotal, gst, total, notes||null, docType]
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
      `SELECT i.*, COALESCE(fc.name, cr.name) AS "clientName",
              COALESCE(fc.email, NULL) AS "clientEmail",
              COALESCE(fc.address, NULL) AS "clientAddress",
              COALESCE(fc.abn, NULL) AS "clientAbn"
       FROM fin_invoices i
       LEFT JOIN fin_clients fc ON fc.id = i."clientId"
       LEFT JOIN clients cr ON cr.id = i."clientRef"
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
      `SELECT i.*, COALESCE(fc.name, cr.name) AS "clientName",
              fc."contactName"                  AS "clientContactName",
              COALESCE(fc.email, NULL)           AS "clientEmail",
              COALESCE(fc.address, NULL)         AS "clientAddress",
              COALESCE(fc.abn, NULL)             AS "clientAbn"
       FROM fin_invoices i
       LEFT JOIN fin_clients fc ON fc.id = i."clientId"
       LEFT JOIN clients cr ON cr.id = i."clientRef"
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

    const settingKeys = ['fin_biz_name','fin_abn','fin_address','fin_bank_name','fin_account_name','fin_bsb','fin_account_number'];
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
    const { clientId, clientRef, issueDate, dueDate, notes, status, paidAt, items = [], txCodeId } = req.body;

    const { rows: check } = await client.query(
      `SELECT id, number, status, "paidAt", "docType" FROM fin_invoices WHERE id=$1 AND "userId"=$2`, [invoiceId, userId]
    );
    if (!check[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }

    // Paid invoices can be edited until their payment date falls within a reconciled BAS quarter
    if (check[0].status === 'paid') {
      const effectivePaidAt = paidAt || check[0].paidAt;
      const { rows: lockCheck } = await client.query(
        `SELECT 1 FROM fin_bas_quarters
         WHERE "userId"=$1 AND $2::date BETWEEN from_date AND to_date AND status != 'open'`,
        [userId, effectivePaidAt]
      );
      if (lockCheck.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invoice is locked — its payment date falls within a reconciled BAS quarter' });
      }
    }

    let subtotal = 0, gst = 0;
    for (const item of items) {
      const qty     = parseFloat(item.qty) || 0;
      const up      = parseFloat(item.unitPrice) || 0;
      const amt     = parseFloat((qty * up).toFixed(2));
      const taxable = calcItemGst(item);
      const itemGst = taxable ? parseFloat((amt * 0.1).toFixed(2)) : 0;
      item._qty     = qty;
      item._up      = up;
      item._amount  = amt;
      item._gst     = itemGst;
      item._gstCode = taxable ? 'GST' : (item.gstCode || 'NT');
      subtotal += amt;
      gst      += itemGst;
    }
    subtotal = parseFloat(subtotal.toFixed(2));
    gst      = parseFloat(gst.toFixed(2));
    const total = parseFloat((subtotal + gst).toFixed(2));

    const isPaid      = check[0].status === 'paid';
    const newStatus   = isPaid ? 'paid' : (status || 'draft');
    const newPaidAt   = isPaid ? (paidAt || check[0].paidAt) : null;

    await client.query(
      `UPDATE fin_invoices
       SET "clientId"=$1,"clientRef"=$2,"issueDate"=$3,"dueDate"=$4,subtotal=$5,gst=$6,total=$7,
           notes=$8,status=$9,"paidAt"=$10,"updatedAt"=NOW()
       WHERE id=$11 AND "userId"=$12`,
      [clientId||null, clientRef||null, issueDate, dueDate||null, subtotal, gst, total,
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
    await ensureAccounts(userId);
    const arId     = await accountByCode(userId, '1100');
    const incId    = await accountByCode(userId, '4000');
    const gstColId = await accountByCode(userId, '2200');
    const bankId   = await accountByCode(userId, '1000');
    const invNum   = check[0].number;

    // Recreate invoice journal entry (AR / Income / GST collected) only when sent/paid — drafts have no journal
    if (!isQuote && newStatus !== 'draft') {
      await deleteJournalForSource(client, userId, parseInt(invoiceId), 'invoice');
      if (arId && incId && gstColId) {
        await createJournalEntry(client, userId, {
          date:        issueDate || new Date().toISOString().slice(0, 10),
          description: `Invoice ${invNum}`,
          reference:   invNum,
          type:        'invoice',
          sourceId:    parseInt(invoiceId),
          lines: [
            { accountId: arId,     debit: total,    credit: 0 },
            { accountId: incId,    debit: 0,        credit: subtotal },
            { accountId: gstColId, debit: 0,        credit: gst },
          ],
        });
      }

      // For paid invoices, also recreate the payment journal entry (Bank / AR)
      if (isPaid && bankId && arId) {
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

    // Load invoice + items + client
    const { rows } = await pool.query(
      `SELECT i.*,
              COALESCE(fc.name, cr.name) AS "clientName",
              COALESCE(fc.email,
                (SELECT cc.email FROM client_contacts cc
                 WHERE cc."clientId" = cr.id AND cc.email IS NOT NULL
                 ORDER BY cc."isPrimary" DESC, cc.id ASC LIMIT 1)
              ) AS "clientEmail",
              COALESCE(fc.address, cr.address) AS "clientAddress",
              COALESCE(fc.abn, NULL) AS "clientAbn"
       FROM fin_invoices i
       LEFT JOIN fin_clients fc ON fc.id = i."clientId"
       LEFT JOIN clients cr ON cr.id = i."clientRef"
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
    const settingKeys = ['fin_biz_name','fin_abn','fin_address','fin_bank_name','fin_bsb','fin_account_number','fin_admin_email'];
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
        ${cfg.fin_bank_name    ? `<p style="margin:0 0 4px;font-size:13px;color:#374151;">Bank: ${cfg.fin_bank_name}</p>` : ''}
        ${cfg.fin_bsb          ? `<p style="margin:0 0 4px;font-size:13px;color:#374151;">BSB: ${cfg.fin_bsb}</p>` : ''}
        ${cfg.fin_account_number ? `<p style="margin:0;font-size:13px;color:#374151;">Account: ${cfg.fin_account_number}</p>` : ''}
      </div>` : '';

    const isQuote    = inv.docType === 'quote';
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
          ${cfg.fin_biz_name ? `<p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">${cfg.fin_biz_name}</p>` : ''}
        </td>
      </tr>
    </table>
    <div style="padding:28px 32px;">
      ${messageBlock}
      <!-- Row 1: who the document is for -->
      <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #e5e7eb;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">${addrLabel}</p>
        <p style="margin:0;font-size:16px;font-weight:600;color:#1f2937;">${inv.clientName || ''}</p>
        ${inv.clientAddress ? `<p style="margin:2px 0 0;font-size:13px;color:#6b7280;">${inv.clientAddress}</p>` : ''}
        ${inv.clientAbn     ? `<p style="margin:2px 0 0;font-size:13px;color:#6b7280;">ABN ${inv.clientAbn}</p>` : ''}
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
          <tr>
            <td style="padding:4px 8px;font-size:13px;color:#6b7280;">Subtotal</td>
            <td style="padding:4px 8px;font-size:13px;text-align:right;color:#1f2937;">${fmtAud(inv.subtotal)}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px;font-size:13px;color:#6b7280;">GST (10%)</td>
            <td style="padding:4px 8px;font-size:13px;text-align:right;color:#1f2937;">${fmtAud(inv.gst)}</td>
          </tr>
          <tr style="border-top:2px solid #1f2937;">
            <td style="padding:8px 8px 4px;font-size:15px;font-weight:700;color:#1f2937;">${totalLabel}</td>
            <td style="padding:8px 8px 4px;font-size:15px;font-weight:700;text-align:right;color:#1f2937;">${fmtAud(inv.total)}</td>
          </tr>
        </table>
      </div>

      ${inv.notes ? `<p style="margin-top:20px;font-size:13px;color:#6b7280;">${inv.notes}</p>` : ''}
      ${bankSection}
    </div>
    <div style="padding:16px 32px;background:#f9fafb;font-size:11px;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;">
      ${cfg.fin_biz_name || ''}${cfg.fin_address ? ` &nbsp;·&nbsp; ${cfg.fin_address}` : ''}
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

    await sendEmail({
      to,
      cc: adminEmail || undefined,
      subject: `${docLabel} ${inv.number}${cfg.fin_biz_name ? ` from ${cfg.fin_biz_name}` : ''}`,
      html,
      attachments: pdfAttachment ? [pdfAttachment] : undefined,
    });

    // Mark as sent and post the invoice journal (AR / Income / GST) if not already posted
    await pool.query(
      `UPDATE fin_invoices SET status='sent',"updatedAt"=NOW() WHERE id=$1 AND "userId"=$2`,
      [invoiceId, userId]
    );

    if (!isQuote) {
      await ensureAccounts(userId);
      const arId     = await accountByCode(userId, '1100');
      const incId    = await accountByCode(userId, '4000');
      const gstColId = await accountByCode(userId, '2200');
      // Delete any stale draft journal then write the definitive one
      const dbClient = await pool.connect();
      try {
        await dbClient.query('BEGIN');
        await deleteJournalForSource(dbClient, userId, parseInt(invoiceId), 'invoice');
        if (arId && incId && gstColId) {
          await createJournalEntry(dbClient, userId, {
            date:        String(inv.issueDate || new Date()).slice(0, 10),
            description: `Invoice ${inv.number}`,
            reference:   inv.number,
            type:        'invoice',
            sourceId:    parseInt(invoiceId),
            lines: [
              { accountId: arId,     debit: inv.total,    credit: 0 },
              { accountId: incId,    debit: 0,            credit: inv.subtotal },
              { accountId: gstColId, debit: 0,            credit: inv.gst },
            ],
          });
        }
        await dbClient.query('COMMIT');
      } catch (journalErr) {
        await dbClient.query('ROLLBACK');
        console.error('[finance] Invoice journal on send failed:', journalErr.message);
      } finally {
        dbClient.release();
      }
    }

    res.json({ ok: true, sentTo: to });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/invoices/:id/status', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { status } = req.body;
    const { rows } = await dbClient.query(
      `UPDATE fin_invoices SET status=$1,"updatedAt"=NOW() WHERE id=$2 AND "userId"=$3 RETURNING *`,
      [status, req.params.id, userId]
    );
    if (!rows[0]) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const inv = rows[0];

    // When manually marking as sent, post the invoice journal if not already present
    if (status === 'sent' && inv.docType !== 'quote') {
      await ensureAccounts(userId);
      const arId     = await accountByCode(userId, '1100');
      const incId    = await accountByCode(userId, '4000');
      const gstColId = await accountByCode(userId, '2200');
      if (arId && incId && gstColId) {
        await deleteJournalForSource(dbClient, userId, inv.id, 'invoice');
        await createJournalEntry(dbClient, userId, {
          date:        String(inv.issueDate || new Date()).slice(0, 10),
          description: `Invoice ${inv.number}`,
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
    const paidDate = req.body.paidAt || new Date().toISOString().slice(0, 10);

    const { rows } = await dbClient.query(
      `UPDATE fin_invoices SET status='paid',"paidAt"=$1,"updatedAt"=NOW()
       WHERE id=$2 AND "userId"=$3 AND status != 'paid' RETURNING *`,
      [paidDate, req.params.id, userId]
    );
    if (!rows[0]) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Invoice not found or already paid' });
    }
    const invoice = rows[0];

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
    const today   = new Date().toISOString().slice(0, 10);

    // Use the user's configured payment terms (default 7 days)
    const { rows: termRows } = await dbClient.query(
      `SELECT value FROM settings WHERE "userId"=$1 AND key='fin_payment_terms' LIMIT 1`, [userId]
    );
    const termDays = parseInt(termRows[0]?.value) || 7;
    const dueDate  = new Date(Date.now() + termDays * 86400000).toISOString().slice(0, 10);

    const quoteDate = quote.issueDate ? String(quote.issueDate).slice(0, 10) : today;
    const convertedNote = `Converted from quote ${quote.number} dated ${quoteDate}.`;
    const notes = quote.notes ? `${convertedNote}\n${quote.notes}` : convertedNote;

    const { rows: invRows } = await dbClient.query(
      `INSERT INTO fin_invoices ("userId","clientId","clientRef",number,status,"issueDate","dueDate",subtotal,gst,total,notes,"docType")
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,'invoice') RETURNING *`,
      [userId, quote.clientId, quote.clientRef, number, today, dueDate, quote.subtotal, quote.gst, quote.total, notes]
    );
    const invoice = invRows[0];

    for (const item of qItems) {
      await dbClient.query(
        `INSERT INTO fin_invoice_items ("invoiceId", description, qty, "unitPrice", gst, amount, "txCodeId", "gstCode")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [invoice.id, item.description, item.qty, item.unitPrice, item.gst, item.amount, item.txCodeId, item.gstCode || 'GST']
      );
    }

    // Create journal entry for the new invoice
    await ensureAccounts(userId);
    const arId     = await accountByCode(userId, '1100');
    const incId    = await accountByCode(userId, '4000');
    const gstColId = await accountByCode(userId, '2200');
    if (arId && incId && gstColId) {
      await createJournalEntry(dbClient, userId, {
        date:        today,
        description: `Invoice ${number} (from quote ${quote.number})`,
        reference:   number,
        type:        'invoice',
        sourceId:    invoice.id,
        lines: [
          { accountId: arId,     debit: invoice.total,    credit: 0 },
          { accountId: incId,    debit: 0,                credit: invoice.subtotal },
          { accountId: gstColId, debit: 0,                credit: invoice.gst },
        ],
      });
    }

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

// ── Expenses ──────────────────────────────────────────────────────────────────

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

router.post('/expenses', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId = req.user.id;
    const { date, description, amount, gstIncluded, category, supplier, txCodeId, paidViaId } = req.body;
    // amount = total paid (GST-inclusive when gstIncluded=true)
    const totalPaid = parseFloat(amount) || 0;
    const gstAmt    = gstIncluded ? parseFloat((totalPaid / 11).toFixed(2)) : 0;
    const amt       = parseFloat((totalPaid - gstAmt).toFixed(2)); // ex-GST amount stored in amount col

    const { rows } = await dbClient.query(
      `INSERT INTO fin_expenses ("userId", date, description, amount, gst, category, supplier, "txCodeId", "paidViaId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [userId, date||new Date().toISOString().slice(0,10), description, amt, gstAmt, category||null, supplier||null, txCodeId||null, paidViaId||null]
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

    await dbClient.query('COMMIT');
    res.json(expense);
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
      date:        date || new Date().toISOString().slice(0, 10),
      description: `CC statement payment — ${expenses.length} item${expenses.length > 1 ? 's' : ''}`,
      type:        'manual',
      lines: [
        { accountId: parseInt(accountId), debit: total, credit: 0 },
        { accountId: bankId,              debit: 0,     credit: total },
      ],
    });

    await dbClient.query(
      `UPDATE fin_expenses SET "ccSettled"=true WHERE id = ANY($1) AND "userId"=$2`,
      [expenses.map(e => e.id), userId]
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
    const { date, description, amount, gstIncluded, category, supplier, txCodeId, paidViaId } = req.body;
    const totalPaid = parseFloat(amount) || 0;
    const gstAmt    = gstIncluded ? parseFloat((totalPaid / 11).toFixed(2)) : 0;
    const amt       = parseFloat((totalPaid - gstAmt).toFixed(2));

    const { rows } = await dbClient.query(
      `UPDATE fin_expenses SET date=$1,description=$2,amount=$3,gst=$4,category=$5,supplier=$6,"txCodeId"=$7,"paidViaId"=$8,"updatedAt"=NOW()
       WHERE id=$9 AND "userId"=$10 RETURNING *`,
      [date, description, amt, gstAmt, category||null, supplier||null, txCodeId||null, paidViaId||null, expenseId, userId]
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
      date:        date || new Date().toISOString().slice(0, 10),
      description: `CC payment — ${exp.description}`,
      type:        'manual',
      lines: [
        { accountId: exp.creditAccountId, debit: total, credit: 0 },
        { accountId: bankId,              debit: 0,     credit: total },
      ],
    });

    await dbClient.query(`UPDATE fin_expenses SET "ccSettled"=true WHERE id=$1`, [req.params.id]);
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
  try {
    const { rows } = await pool.query(
      `UPDATE fin_expenses SET "ccSettled"=false WHERE id=$1 AND "userId"=$2 AND "ccSettled"=true RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Expense not found or not settled' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    const netAmt   = parseFloat(net) || parseFloat((grossAmt - taxAmt).toFixed(2));

    const { rows } = await dbClient.query(
      `INSERT INTO fin_wages ("userId", date, employee, gross, tax, superannuation, net)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [userId, date||new Date().toISOString().slice(0,10), employee, grossAmt, taxAmt, superAmt, netAmt]
    );
    const wage = rows[0];

    // Journal: DR Wages (gross), DR Super Expense, CR Bank (net), CR AP (tax), CR Super Payable
    await ensureAccounts(userId);
    const wagesId = await accountByCode(userId, '6000');
    const superExpId = await accountByCode(userId, '6100');
    const bankId  = await accountByCode(userId, '1000');
    const apId    = await accountByCode(userId, '2000');
    const superLiabId = await accountByCode(userId, '2300');
    if (wagesId && bankId) {
      const lines = [
        { accountId: wagesId, debit: grossAmt, credit: 0 },
        { accountId: bankId,  debit: 0,        credit: netAmt },
      ];
      if (taxAmt > 0 && apId)        lines.push({ accountId: apId,        debit: 0, credit: taxAmt });
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
    if (!lines.length) return res.status(400).json({ error: 'Lines required' });
    const entryId = await createJournalEntry(dbClient, req.user.id, {
      date:        date || new Date().toISOString().slice(0, 10),
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
    if (!rows[0]) return res.status(404).json({ error: 'Not found or not a manual entry' });
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

    const [invRows, expRows, wageRows] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(subtotal),0) AS income, COALESCE(SUM(gst),0) AS "gstCollected"
         FROM fin_invoices WHERE "userId"=$1 AND status = 'paid' AND "paidAt"::date BETWEEN $2 AND $3`,
        [userId, from, to]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount),0) AS expenses, COALESCE(SUM(gst),0) AS "gstPaid"
         FROM fin_expenses WHERE "userId"=$1 AND date BETWEEN $2 AND $3`,
        [userId, from, to]
      ),
      pool.query(
        `SELECT COALESCE(SUM(gross),0) AS wages, COALESCE(SUM(tax),0) AS "withholdingTax"
         FROM fin_wages WHERE "userId"=$1 AND date BETWEEN $2 AND $3`,
        [userId, from, to]
      ),
    ]);

    const gstCollected = parseFloat(invRows.rows[0].gstCollected);
    const gstPaid      = parseFloat(expRows.rows[0].gstPaid);

    // Upsert the quarter record so we can track status
    const { rows: qRows } = await pool.query(
      `INSERT INTO fin_bas_quarters ("userId", from_date, to_date, status)
       VALUES ($1,$2,$3,'open')
       ON CONFLICT ("userId", from_date) DO UPDATE SET to_date=EXCLUDED.to_date
       RETURNING id, status, reconciled_at, lodged_at, paid_at`,
      [userId, from, to]
    );
    const quarter = qRows[0];

    res.json({
      from,
      to,
      quarterId:       quarter.id,
      status:          quarter.status,
      reconciledAt:    quarter.reconciled_at,
      lodgedAt:        quarter.lodged_at,
      paidAt:          quarter.paid_at,
      income:          parseFloat(invRows.rows[0].income),
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
    const { rows } = await pool.query(
      `UPDATE fin_bas_quarters SET status='lodged', lodged_at=NOW(), "updatedAt"=NOW()
       WHERE id=$1 AND "userId"=$2 AND status='reconciled' RETURNING *`,
      [req.params.quarterId, req.user.id]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Quarter not found or not in reconciled status' });
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

    const { rows: qRows } = await dbClient.query(
      `UPDATE fin_bas_quarters SET status='paid', paid_at=NOW(), "updatedAt"=NOW()
       WHERE id=$1 AND "userId"=$2 AND status='lodged' RETURNING *`,
      [req.params.quarterId, userId]
    );
    if (!qRows[0]) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Quarter not found or not in lodged status' });
    }
    const quarter = qRows[0];

    // Recalculate net GST for journal entry
    const [invRows, expRows] = await Promise.all([
      dbClient.query(
        `SELECT COALESCE(SUM(gst),0) AS "gstCollected"
         FROM fin_invoices WHERE "userId"=$1 AND status='paid' AND "paidAt"::date BETWEEN $2 AND $3`,
        [userId, quarter.from_date, quarter.to_date]
      ),
      dbClient.query(
        `SELECT COALESCE(SUM(gst),0) AS "gstPaid"
         FROM fin_expenses WHERE "userId"=$1 AND date BETWEEN $2 AND $3`,
        [userId, quarter.from_date, quarter.to_date]
      ),
    ]);
    const gstCollected = parseFloat(invRows.rows[0].gstCollected);
    const gstPaid      = parseFloat(expRows.rows[0].gstPaid);
    const netGst       = parseFloat((gstCollected - gstPaid).toFixed(2));

    // Journal: DR GST Collected, CR GST Paid, CR Bank (net settlement)
    if (netGst !== 0) {
      await ensureAccounts(userId);
      const gstColId  = await accountByCode(userId, '2200');
      const gstPaidId = await accountByCode(userId, '1200');
      const bankId    = await accountByCode(userId, '1000');
      if (gstColId && gstPaidId && bankId) {
        const lines = [];
        if (gstCollected > 0) lines.push({ accountId: gstColId,  debit: gstCollected, credit: 0 });
        if (gstPaid > 0)      lines.push({ accountId: gstPaidId, debit: 0, credit: gstPaid });
        if (netGst > 0)       lines.push({ accountId: bankId,    debit: 0, credit: netGst });
        else                  lines.push({ accountId: bankId,    debit: Math.abs(netGst), credit: 0 });
        await createJournalEntry(dbClient, userId, {
          date:        new Date().toISOString().slice(0, 10),
          description: `BAS payment — ${quarter.from_date} to ${quarter.to_date}`,
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

    const quarters = await Promise.all(quarterDefs.map(async (qd) => {
      const [invRow, expRow, qRow] = await Promise.all([
        pool.query(
          `SELECT COALESCE(SUM(subtotal),0) AS income, COALESCE(SUM(gst),0) AS "gstCollected"
           FROM fin_invoices
           WHERE "userId"=$1 AND status='paid' AND "paidAt"::date BETWEEN $2 AND $3`,
          [userId, qd.from, qd.to]
        ),
        pool.query(
          `SELECT COALESCE(SUM(gst),0) AS "gstPaid"
           FROM fin_expenses WHERE "userId"=$1 AND date BETWEEN $2 AND $3`,
          [userId, qd.from, qd.to]
        ),
        pool.query(
          `SELECT id, status FROM fin_bas_quarters WHERE "userId"=$1 AND from_date=$2`,
          [userId, qd.from]
        ),
      ]);

      const income     = parseFloat(invRow.rows[0].income);
      const gstOnSales = parseFloat(invRow.rows[0].gstCollected);
      const gstCredits = parseFloat(expRow.rows[0].gstPaid);
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
       LEFT JOIN fin_clients c ON c.id = i."clientId"
       WHERE i."userId"=$1 AND i."issueDate"::date BETWEEN $2 AND $3
         AND i.status IN ('draft','sent')
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
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const today     = new Date().toISOString().slice(0, 10);
    const from      = req.query.from || yearStart;
    const to        = req.query.to   || today;

    const [paid, outstanding, overdue, expenses, wages] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total
         FROM fin_invoices WHERE "userId"=$1 AND status='paid' AND "paidAt"::date BETWEEN $2 AND $3`,
        [userId, from, to]
      ),
      pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total
         FROM fin_invoices WHERE "userId"=$1
           AND (status='draft' OR (status='sent' AND ("dueDate" IS NULL OR "dueDate"::date >= $2)))`,
        [userId, today]
      ),
      pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total
         FROM fin_invoices WHERE "userId"=$1 AND status='sent' AND "dueDate"::date < $2`,
        [userId, today]
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
        const isGstAccount = line.name && line.name.toUpperCase().includes('GST');
        const taxCode = (isGstAccount || (hasGst && (line.atype === 'expense' || line.atype === 'income')))
          ? 'GST'
          : 'N-T';
        lines.push(csvRow(
          fmtDateAU(entry.date),
          entry.description,
          taxCode,
          line.code,
          fmtNum(line.debit),
          fmtNum(line.credit)
        ));
      }
    }

    const today = new Date().toISOString().slice(0, 10);
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
        const taxType = xeroTaxType(line, hasGst);
        const lineAmt = parseFloat(line.debit || 0) - parseFloat(line.credit || 0);
        csvLines.push(csvRow(
          entry.description,
          dateStr,
          line.code,
          line.name,
          taxType,
          fmtNum(lineAmt)
        ));
      }
    }

    const today = new Date().toISOString().slice(0, 10);
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

    const [expenses, invoices, wages] = await Promise.all([
      pool.query(
        `SELECT e.date, e.description, e.supplier, e.amount, e.gst, e.category, e."ccSettled",
                a.code AS "accountCode", a.name AS "accountName", t.code AS "txCode"
         FROM fin_expenses e
         LEFT JOIN fin_accounts a ON a.id = e."paidViaId"
         LEFT JOIN fin_tx_codes t ON t.id = e."txCodeId"
         WHERE ${expWhere} ORDER BY e.date ASC, e.id ASC`, expParams),
      pool.query(
        `SELECT i.number, i."issueDate", i."dueDate", i.status, i.subtotal, i.gst, i.total,
                COALESCE(fc.name, cr.name) AS "clientName"
         FROM fin_invoices i
         LEFT JOIN fin_clients fc ON fc.id = i."clientId"
         LEFT JOIN clients cr ON cr.id = i."clientRef"
         WHERE ${invWhere} ORDER BY i."issueDate" ASC, i.id ASC`, invParams),
      pool.query(
        `SELECT date, employee, gross, tax, superannuation, net
         FROM fin_wages WHERE ${wageWhere} ORDER BY date ASC, id ASC`, wageParams),
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

    const today = new Date().toISOString().slice(0, 10);
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

    const exp  = makeParams();
    const inv  = makeParams();
    const wage = makeParams();

    const [expRows, invRows, wageRows] = await Promise.all([
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
                COALESCE(fc.name, cr.name) AS party,
                i.number AS description, i.subtotal AS amount, i.gst,
                i.total, i.notes,
                CASE WHEN i."docType"='quote' THEN 'Quote' ELSE 'Invoice' END AS type
         FROM fin_invoices i
         LEFT JOIN fin_clients fc ON fc.id = i."clientId"
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
    ]);

    const allRows = [
      ...expRows.rows,
      ...invRows.rows,
      ...wageRows.rows,
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

    const today = new Date().toISOString().slice(0, 10);
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
      date:        date || new Date().toISOString().slice(0, 10),
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

module.exports = router;
