'use strict';

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const UPLOAD_DIR   = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const RECEIPT_DIR  = path.join(UPLOAD_DIR, 'receipts');

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

async function nextInvoiceNumber(userId) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}`;
  const { rows } = await pool.query(
    `SELECT number FROM fin_invoices WHERE "userId"=$1 AND number LIKE $2 ORDER BY id DESC LIMIT 1`,
    [userId, `${prefix}%`]
  );
  if (!rows.length) return `${prefix}001`;
  const seq = parseInt(rows[0].number.slice(prefix.length), 10) || 0;
  return `${prefix}${String(seq + 1).padStart(3, '0')}`;
}

const DEFAULT_ACCOUNTS = [
  { code: '1000', name: 'Bank / Cash',         type: 'asset'     },
  { code: '1100', name: 'Accounts Receivable',  type: 'asset'     },
  { code: '1200', name: 'GST Paid',             type: 'asset'     },
  { code: '2000', name: 'Accounts Payable',     type: 'liability' },
  { code: '2200', name: 'GST Collected',        type: 'liability' },
  { code: '3000', name: "Owner's Equity",       type: 'equity'    },
  { code: '4000', name: 'Income',               type: 'income'    },
  { code: '5000', name: 'Expenses',             type: 'expense'   },
  { code: '6000', name: 'Wages',                type: 'expense'   },
];

async function ensureAccounts(userId) {
  const { rows } = await pool.query(
    'SELECT id FROM fin_accounts WHERE "userId"=$1 LIMIT 1', [userId]
  );
  if (rows.length) return;
  for (const a of DEFAULT_ACCOUNTS) {
    await pool.query(
      `INSERT INTO fin_accounts ("userId", code, name, type, "isSystem") VALUES ($1,$2,$3,$4,true)`,
      [userId, a.code, a.name, a.type]
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
    const keys = ['fin_biz_name','fin_abn','fin_address','fin_bank_name','fin_account_name','fin_bsb','fin_account_number','fin_gst_registered','fin_payment_terms'];
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
    const allowed = ['fin_biz_name','fin_abn','fin_address','fin_bank_name','fin_account_name','fin_bsb','fin_account_number','fin_gst_registered','fin_payment_terms'];
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

// ── Invoices ──────────────────────────────────────────────────────────────────

router.get('/invoices', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, COALESCE(fc.name, cr.name) AS "clientName"
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
    const { clientId, clientRef, issueDate, dueDate, notes, items = [] } = req.body;

    let subtotal = 0, gst = 0;
    for (const item of items) {
      const qty = parseFloat(item.qty) || 0;
      const up  = parseFloat(item.unitPrice) || 0;
      const amt = parseFloat((qty * up).toFixed(2));
      const itemGst = item.gstApplies ? parseFloat((amt * 0.1).toFixed(2)) : 0;
      item._amount = amt;
      item._gst    = itemGst;
      subtotal += amt;
      gst      += itemGst;
    }
    subtotal = parseFloat(subtotal.toFixed(2));
    gst      = parseFloat(gst.toFixed(2));
    const total = parseFloat((subtotal + gst).toFixed(2));

    const number = await nextInvoiceNumber(userId);
    const { rows } = await client.query(
      `INSERT INTO fin_invoices ("userId","clientId","clientRef",number,status,"issueDate","dueDate",subtotal,gst,total,notes)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10) RETURNING *`,
      [userId, clientId||null, clientRef||null, number, issueDate||new Date().toISOString().slice(0,10), dueDate||null, subtotal, gst, total, notes||null]
    );
    const invoice = rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO fin_invoice_items ("invoiceId", description, qty, "unitPrice", gst, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [invoice.id, item.description, item.qty, item.unitPrice, item._gst, item._amount]
      );
    }

    // Journal: DR Accounts Receivable, CR Income, CR GST Collected
    await ensureAccounts(userId);
    const arId     = await accountByCode(userId, '1100');
    const incId    = await accountByCode(userId, '4000');
    const gstColId = await accountByCode(userId, '2200');
    if (arId && incId && gstColId) {
      const lines = [
        { accountId: arId,     debit: total,    credit: 0 },
        { accountId: incId,    debit: 0,        credit: subtotal },
        { accountId: gstColId, debit: 0,        credit: gst },
      ];
      await createJournalEntry(client, userId, {
        date:        issueDate || new Date().toISOString().slice(0, 10),
        description: `Invoice ${number}`,
        reference:   number,
        type:        'invoice',
        sourceId:    invoice.id,
        lines,
      });
    }

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
    const { clientId, clientRef, issueDate, dueDate, notes, status, items = [] } = req.body;

    const { rows: check } = await client.query(
      `SELECT id, number, status FROM fin_invoices WHERE id=$1 AND "userId"=$2`, [invoiceId, userId]
    );
    if (!check[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (check[0].status === 'paid') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Cannot edit a paid invoice' }); }

    let subtotal = 0, gst = 0;
    for (const item of items) {
      const qty = parseFloat(item.qty) || 0;
      const up  = parseFloat(item.unitPrice) || 0;
      const amt = parseFloat((qty * up).toFixed(2));
      const itemGst = item.gstApplies ? parseFloat((amt * 0.1).toFixed(2)) : 0;
      item._amount = amt;
      item._gst    = itemGst;
      subtotal += amt;
      gst      += itemGst;
    }
    subtotal = parseFloat(subtotal.toFixed(2));
    gst      = parseFloat(gst.toFixed(2));
    const total = parseFloat((subtotal + gst).toFixed(2));

    await client.query(
      `UPDATE fin_invoices
       SET "clientId"=$1,"clientRef"=$2,"issueDate"=$3,"dueDate"=$4,subtotal=$5,gst=$6,total=$7,notes=$8,status=$9,"updatedAt"=NOW()
       WHERE id=$10 AND "userId"=$11`,
      [clientId||null, clientRef||null, issueDate, dueDate||null, subtotal, gst, total, notes||null, status||'draft', invoiceId, userId]
    );
    await client.query(`DELETE FROM fin_invoice_items WHERE "invoiceId"=$1`, [invoiceId]);
    for (const item of items) {
      await client.query(
        `INSERT INTO fin_invoice_items ("invoiceId", description, qty, "unitPrice", gst, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [invoiceId, item.description, item.qty, item.unitPrice, item._gst, item._amount]
      );
    }

    // Delete old invoice journal entry and recreate with updated amounts
    await deleteJournalForSource(client, userId, parseInt(invoiceId), 'invoice');
    await ensureAccounts(userId);
    const arId     = await accountByCode(userId, '1100');
    const incId    = await accountByCode(userId, '4000');
    const gstColId = await accountByCode(userId, '2200');
    const invNum   = check[0].number;
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
    const overrideTo = req.body.to || null; // caller may supply an email if client has none

    // Load invoice + items + client
    const { rows } = await pool.query(
      `SELECT i.*, COALESCE(fc.name, cr.name) AS "clientName",
              COALESCE(fc.email, NULL) AS "clientEmail",
              COALESCE(fc.address, NULL) AS "clientAddress",
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
    const settingKeys = ['fin_biz_name','fin_abn','fin_address','fin_bank_name','fin_bsb','fin_account_number'];
    const { rows: settings } = await pool.query(
      `SELECT key, value FROM settings WHERE "userId"=$1 AND key = ANY($2)`,
      [userId, settingKeys]
    );
    const cfg = {};
    for (const r of settings) cfg[r.key] = r.value;

    const fmtAud = (n) =>
      new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n || 0);
    const fmtDate = (d) =>
      d ? new Date(String(d).slice(0,10) + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

    const itemRows = items.map(item => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#1f2937;">${item.description}</td>
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

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f3f4f6;margin:0;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1f2937;padding:28px 32px;">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">${inv.number}</h1>
      <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">${cfg.fin_biz_name || ''}${cfg.fin_abn ? ` &nbsp;·&nbsp; ABN ${cfg.fin_abn}` : ''}</p>
    </div>
    <div style="padding:28px 32px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:16px;">
        <div>
          <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">Bill To</p>
          <p style="margin:0;font-size:15px;font-weight:600;color:#1f2937;">${inv.clientName || ''}</p>
          ${inv.clientAddress ? `<p style="margin:2px 0 0;font-size:13px;color:#6b7280;">${inv.clientAddress}</p>` : ''}
          ${inv.clientAbn     ? `<p style="margin:2px 0 0;font-size:13px;color:#6b7280;">ABN ${inv.clientAbn}</p>` : ''}
        </div>
        <div style="text-align:right;">
          <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">Issued: <strong style="color:#1f2937;">${fmtDate(inv.issueDate)}</strong></p>
          ${inv.dueDate ? `<p style="margin:0;font-size:13px;color:#6b7280;">Due: <strong style="color:#1f2937;">${fmtDate(inv.dueDate)}</strong></p>` : ''}
        </div>
      </div>

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
            <td style="padding:8px 8px 4px;font-size:15px;font-weight:700;color:#1f2937;">Total</td>
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
    await sendEmail({
      to,
      subject: `Invoice ${inv.number}${cfg.fin_biz_name ? ` from ${cfg.fin_biz_name}` : ''}`,
      html,
    });

    // Mark as sent
    await pool.query(
      `UPDATE fin_invoices SET status='sent',"updatedAt"=NOW() WHERE id=$1 AND "userId"=$2`,
      [invoiceId, userId]
    );

    res.json({ ok: true, sentTo: to });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/invoices/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const { rows } = await pool.query(
      `UPDATE fin_invoices SET status=$1,"updatedAt"=NOW() WHERE id=$2 AND "userId"=$3 RETURNING *`,
      [status, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/invoices/:id/resend', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT status FROM fin_invoices WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    if (rows[0].status === 'paid') return res.status(400).json({ error: 'Invoice already paid' });
    // Delegate actual send to the send route logic — just re-use by forwarding internally
    // Mark as sent (already sent, but reset if needed) — real send happens client-side via /send
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

router.delete('/invoices/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM fin_invoices WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
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
    const { date, description, amount, gstIncluded, category, supplier } = req.body;
    // amount = total paid (GST-inclusive when gstIncluded=true)
    const totalPaid = parseFloat(amount) || 0;
    const gstAmt    = gstIncluded ? parseFloat((totalPaid / 11).toFixed(2)) : 0;
    const amt       = parseFloat((totalPaid - gstAmt).toFixed(2)); // ex-GST amount stored in amount col

    const { rows } = await dbClient.query(
      `INSERT INTO fin_expenses ("userId", date, description, amount, gst, category, supplier)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [userId, date||new Date().toISOString().slice(0,10), description, amt, gstAmt, category||null, supplier||null]
    );
    const expense = rows[0];

    // Journal: DR Expenses (ex-GST), DR GST Paid, CR Bank (total paid)
    await ensureAccounts(userId);
    const expId    = await accountByCode(userId, '5000');
    const gstPaid  = await accountByCode(userId, '1200');
    const bankId   = await accountByCode(userId, '1000');
    if (expId && bankId) {
      const lines = [
        { accountId: expId,  debit: amt,      credit: 0 },
        { accountId: bankId, debit: 0,        credit: totalPaid },
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

router.put('/expenses/:id', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const userId    = req.user.id;
    const expenseId = req.params.id;
    const { date, description, amount, gstIncluded, category, supplier } = req.body;
    const totalPaid = parseFloat(amount) || 0;
    const gstAmt    = gstIncluded ? parseFloat((totalPaid / 11).toFixed(2)) : 0;
    const amt       = parseFloat((totalPaid - gstAmt).toFixed(2));

    const { rows } = await dbClient.query(
      `UPDATE fin_expenses SET date=$1,description=$2,amount=$3,gst=$4,category=$5,supplier=$6,"updatedAt"=NOW()
       WHERE id=$7 AND "userId"=$8 RETURNING *`,
      [date, description, amt, gstAmt, category||null, supplier||null, expenseId, userId]
    );
    if (!rows[0]) { await dbClient.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const expense = rows[0];

    // Reverse old journal, recreate with correct amounts
    await deleteJournalForSource(dbClient, userId, parseInt(expenseId), 'expense');
    await ensureAccounts(userId);
    const expAccId = await accountByCode(userId, '5000');
    const gstPaid  = await accountByCode(userId, '1200');
    const bankId   = await accountByCode(userId, '1000');
    if (expAccId && bankId) {
      const lines = [
        { accountId: expAccId, debit: amt,      credit: 0 },
        { accountId: bankId,   debit: 0,        credit: totalPaid },
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
  try {
    await pool.query(`DELETE FROM fin_expenses WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    // Journal: DR Wages, CR Bank (net), CR Accounts Payable (tax withheld)
    await ensureAccounts(userId);
    const wagesId = await accountByCode(userId, '6000');
    const bankId  = await accountByCode(userId, '1000');
    const apId    = await accountByCode(userId, '2000');
    if (wagesId && bankId) {
      const lines = [
        { accountId: wagesId, debit: grossAmt, credit: 0 },
        { accountId: bankId,  debit: 0,        credit: netAmt },
      ];
      if (taxAmt > 0 && apId) lines.push({ accountId: apId, debit: 0, credit: taxAmt });
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
  try {
    await pool.query(`DELETE FROM fin_wages WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

    const [paid, outstanding, overdue, expenses, wages] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total
         FROM fin_invoices WHERE "userId"=$1 AND status='paid' AND "paidAt">=$2`,
        [userId, yearStart]
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
        `SELECT COALESCE(SUM(amount),0) AS total FROM fin_expenses WHERE "userId"=$1 AND date>=$2`,
        [userId, yearStart]
      ),
      pool.query(
        `SELECT COALESCE(SUM(gross),0) AS total FROM fin_wages WHERE "userId"=$1 AND date>=$2`,
        [userId, yearStart]
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

module.exports = router;
