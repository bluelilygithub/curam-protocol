'use strict';

// Finance document library: statements, invoices, receipts and notices kept as evidence for the books.
// Mounted by finance.js at /api/finance/documents (behind requireFeature('finance')).
//
// A document is uploaded once and can be linked to many expenses/assets (a monthly provider statement
// covering twenty charges), and an expense can have several documents. The older single per-expense
// receipt (fin_expenses.receipt_path) still counts as evidence in the "missing evidence" list.
// Files are private to the logged-in user, stored under UPLOAD_DIR/finance-docs/<userId>/, and deleting
// one needs an explicit confirmation (the ATO wants business records kept for five years).

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { pool } = require('../db');
const { rejectIfDisguisedExecutable } = require('../utils/attachments');
const { finYearForDate } = require('../utils/finYear');

const router = express.Router();

const DOC_DIR   = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'), 'finance-docs');
const MAX_BYTES = (Number(process.env.FIN_DOC_MAX_MB) || 20) * 1024 * 1024;
const QUOTA     = (Number(process.env.FIN_DOC_QUOTA_MB) || 1000) * 1024 * 1024;
const KINDS = ['invoice', 'receipt', 'statement', 'bank_statement', 'ato_notice', 'other'];
// Kept as records in their own right: they don't back one expense or asset, so "not linked" is not a gap.
const STANDALONE_KINDS = ['bank_statement', 'ato_notice'];
const EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.csv', '.xlsx', '.xls', '.txt', '.docx', '.doc'];
const MIME_BY_EXT = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.csv': 'text/csv', '.txt': 'text/plain',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.doc': 'application/msword',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(DOC_DIR, String(req.user.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
    },
  }),
  limits: { fileSize: MAX_BYTES, files: 20 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!EXTENSIONS.includes(ext)) return cb(new Error(`File type not accepted (${ext || 'no extension'}). Allowed: ${EXTENSIONS.join(' ')}`));
    cb(null, true);
  },
}).array('files', 20);

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const isFy = (s) => {
  const m = /^(\d{4})-(\d{2})$/.exec(s || '');
  return !!m && ((parseInt(m[1], 10) + 1) % 100) === parseInt(m[2], 10);
};
const fyBounds = (fy) => { const y = parseInt(fy.slice(0, 4), 10); return { from: `${y}-07-01`, to: `${y + 1}-06-30` }; };
const currentFy = () => finYearForDate(new Date().toISOString().slice(0, 10));
const userDir = (userId) => path.join(DOC_DIR, String(userId));
const fileOf = (userId, storedName) => {
  const p = path.resolve(userDir(userId), storedName);
  return p.startsWith(path.resolve(userDir(userId)) + path.sep) ? p : null; // never leave the user's folder
};
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { if (!res.headersSent) res.status(err.statusCode || 500).json({ error: err.message }); }
};

// ---- helpers ---------------------------------------------------------------------------------

async function ownedExpenseIds(userId, ids) {
  const clean = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!clean.length) return [];
  const { rows } = await pool.query(`SELECT id FROM fin_expenses WHERE "userId"=$1 AND id = ANY($2::int[])`, [userId, clean]);
  if (rows.length !== clean.length) { const e = new Error('One of the linked expenses does not exist'); e.statusCode = 400; throw e; }
  return clean;
}
async function ownedAssetIds(userId, ids) {
  const clean = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!clean.length) return [];
  const { rows } = await pool.query(`SELECT id FROM fin_assets WHERE "userId"=$1 AND id = ANY($2::int[])`, [userId, clean]);
  if (rows.length !== clean.length) { const e = new Error('One of the linked assets does not exist'); e.statusCode = 400; throw e; }
  return clean;
}
async function setLinks(db, docId, expenseIds, assetIds) {
  await db.query(`DELETE FROM fin_document_links WHERE "documentId"=$1`, [docId]);
  for (const id of expenseIds) await db.query(`INSERT INTO fin_document_links ("documentId","expenseId") VALUES ($1,$2)`, [docId, id]);
  for (const id of assetIds)   await db.query(`INSERT INTO fin_document_links ("documentId","assetId") VALUES ($1,$2)`, [docId, id]);
}

async function withLinks(userId, docs) {
  if (!docs.length) return [];
  const { rows } = await pool.query(
    `SELECT l."documentId", l."expenseId", l."assetId",
            e.date::text AS "expDate", e.description AS "expDesc", (e.amount + e.gst) AS "expTotal",
            a."datePurchased"::text AS "assetDate", a.description AS "assetDesc", (a.amount + a.gst) AS "assetTotal"
     FROM fin_document_links l
     LEFT JOIN fin_expenses e ON e.id = l."expenseId"
     LEFT JOIN fin_assets a ON a.id = l."assetId"
     WHERE l."documentId" = ANY($1::int[])`, [docs.map(d => d.id)]);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.documentId)) by.set(r.documentId, []);
    by.get(r.documentId).push(r.expenseId
      ? { type: 'expense', id: r.expenseId, date: r.expDate, label: r.expDesc, total: Number(r.expTotal) }
      : { type: 'asset', id: r.assetId, date: r.assetDate, label: r.assetDesc, total: Number(r.assetTotal) });
  }
  return docs.map(d => ({ ...d, links: by.get(d.id) || [] }));
}

const COLS_D = `d.id, d.kind, d.title, d.supplier, d.fy, d."docDate"::text AS "docDate", d.notes, d."originalName", d."mimeType", d."sizeBytes", d."createdAt", d."redactedFromId"`;
const COLS = `id, kind, title, supplier, fy, "docDate"::text AS "docDate", notes, "originalName", "storedName", "mimeType", "sizeBytes", "createdAt", "redactedFromId"`;

// A supplier named on a document joins the Suppliers directory if it is not there yet (any case, active or
// not, so one the person switched off is not brought back).
async function ensureSupplier(userId, name) {
  const clean = name ? String(name).trim().slice(0, 200) : '';
  if (!clean) return;
  await pool.query(
    `INSERT INTO fin_suppliers ("userId", name)
     SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM fin_suppliers WHERE "userId"=$1 AND LOWER(TRIM(name)) = LOWER($2))`,
    [userId, clean]);
}

// ---- routes (named routes before /:id) -------------------------------------------------------

router.get('/', wrap(async (req, res) => {
  const { fy, kind, q, unlinked, expenseId } = req.query;
  const where = [`d."userId"=$1`]; const params = [req.user.id];
  if (fy) { if (!isFy(fy)) return res.status(400).json({ error: 'fy must look like 2025-26' }); params.push(fy); where.push(`d.fy=$${params.length}`); }
  if (kind) { if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Unknown kind' }); params.push(kind); where.push(`d.kind=$${params.length}`); }
  if (q) { params.push(`%${String(q).toLowerCase()}%`); where.push(`(LOWER(d.title) LIKE $${params.length} OR LOWER(COALESCE(d.supplier,'')) LIKE $${params.length} OR LOWER(d."originalName") LIKE $${params.length})`); }
  if (unlinked === '1') { params.push(STANDALONE_KINDS); where.push(`d.kind <> ALL($${params.length}::text[]) AND NOT EXISTS (SELECT 1 FROM fin_document_links l WHERE l."documentId" = d.id)`); }
  if (expenseId) { params.push(Number(expenseId)); where.push(`EXISTS (SELECT 1 FROM fin_document_links l WHERE l."documentId" = d.id AND l."expenseId" = $${params.length})`); }
  const { rows } = await pool.query(
    `SELECT ${COLS_D}
     FROM fin_documents d WHERE ${where.join(' AND ')} ORDER BY COALESCE(d."docDate", d."createdAt"::date) DESC, d.id DESC LIMIT 1000`, params);
  const { rows: [usage] } = await pool.query(`SELECT COALESCE(SUM("sizeBytes"),0)::float AS used FROM fin_documents WHERE "userId"=$1`, [req.user.id]);
  // every supplier name used on a document before (any year), plus the Suppliers directory, for the picker
  const { rows: names } = await pool.query(
    `SELECT name FROM (
       SELECT TRIM(supplier) AS name FROM fin_documents WHERE "userId"=$1 AND TRIM(COALESCE(supplier,'')) <> ''
       UNION SELECT TRIM(name) FROM fin_suppliers WHERE "userId"=$1 AND "isActive"=true
     ) s WHERE name <> '' GROUP BY name ORDER BY LOWER(name)`, [req.user.id]);
  res.json({ documents: await withLinks(req.user.id, rows), suppliers: names.map((r) => r.name), usedBytes: usage.used, quotaBytes: QUOTA, maxFileBytes: MAX_BYTES, kinds: KINDS });
}));

// Expenses (and depreciating assets) in a financial year with no evidence at all. Calculated claims
// (cents-per-km vehicle, fixed-rate home office) and posted depreciation have no receipt by nature.
router.get('/missing', wrap(async (req, res) => {
  const fy = req.query.fy || currentFy();
  if (!isFy(fy)) return res.status(400).json({ error: 'fy must look like 2025-26' });
  const min = Number.isFinite(parseFloat(req.query.min)) ? Math.max(0, parseFloat(req.query.min)) : 0;
  const b = fyBounds(fy);
  const [exp, ast] = await Promise.all([
    pool.query(
      `SELECT e.id, e.date::text AS date, e.description, e.supplier, e.category, (e.amount + e.gst)::float AS total
       FROM fin_expenses e
       WHERE e."userId"=$1 AND e.date BETWEEN $2::date AND $3::date AND (e.amount + e.gst) >= $4
         AND e.receipt_path IS NULL
         AND NOT EXISTS (SELECT 1 FROM fin_document_links l WHERE l."expenseId" = e.id)
         AND e.description NOT LIKE 'Depreciation FY%'
         AND NOT EXISTS (SELECT 1 FROM fin_vehicle_expenses v WHERE v."expenseId" = e.id AND v.method = 'cents_per_km')
         AND NOT EXISTS (SELECT 1 FROM fin_home_office_expenses h WHERE h."expenseId" = e.id AND h.method = 'fixed_rate')
       ORDER BY e.date, e.id`, [req.user.id, b.from, b.to, min]),
    pool.query(
      `SELECT a.id, a."datePurchased"::text AS date, a.description, (a.amount + a.gst)::float AS total
       FROM fin_assets a
       WHERE a."userId"=$1 AND a."datePurchased" BETWEEN $2::date AND $3::date AND (a.amount + a.gst) >= $4
         AND NOT EXISTS (SELECT 1 FROM fin_document_links l WHERE l."assetId" = a.id)
       ORDER BY a."datePurchased", a.id`, [req.user.id, b.from, b.to, min]),
  ]);
  res.json({ fy, minTotal: min, expenses: exp.rows, assets: ast.rows });
}));

router.post('/', (req, res) => {
  upload(req, res, async (uploadErr) => {
    const files = req.files || [];
    const discard = () => files.forEach(f => { try { fs.unlinkSync(f.path); } catch { /* already gone */ } });
    try {
      if (uploadErr) {
        discard();
        const tooBig = uploadErr.code === 'LIMIT_FILE_SIZE';
        return res.status(tooBig ? 413 : 400).json({ error: tooBig ? `A file is larger than ${Math.round(MAX_BYTES / 1048576)} MB` : uploadErr.message });
      }
      if (!files.length) return res.status(400).json({ error: 'Choose at least one file' });

      const userId = req.user.id;
      const { kind = 'other', supplier, notes, title } = req.body;
      let { docDate, fy } = req.body;
      if (!KINDS.includes(kind)) { discard(); return res.status(400).json({ error: 'Unknown document type' }); }
      if (docDate && !isDate(docDate)) { discard(); return res.status(400).json({ error: 'Document date must be YYYY-MM-DD' }); }
      if (!fy) fy = docDate ? finYearForDate(docDate) : currentFy();
      if (!isFy(fy)) { discard(); return res.status(400).json({ error: 'fy must look like 2025-26' }); }

      const toLinkExp = await ownedExpenseIds(userId, [].concat(req.body.expenseId || req.body.expenseIds || []));
      const toLinkAst = await ownedAssetIds(userId, [].concat(req.body.assetId || req.body.assetIds || []));

      const { rows: [usage] } = await pool.query(`SELECT COALESCE(SUM("sizeBytes"),0)::float AS used FROM fin_documents WHERE "userId"=$1`, [userId]);
      const incoming = files.reduce((s, f) => s + f.size, 0);
      if (usage.used + incoming > QUOTA) {
        discard();
        return res.status(413).json({ error: `Document storage limit reached (${Math.round(QUOTA / 1048576)} MB)` });
      }

      const created = [], rejected = [];
      for (const f of files) {
        try { await rejectIfDisguisedExecutable(f.path); } // deletes the file when it is an executable in disguise
        catch (e) { rejected.push({ file: f.originalname, error: e.message }); continue; }
        const ext = path.extname(f.originalname).toLowerCase();
        const { rows: [d] } = await pool.query(
          `INSERT INTO fin_documents ("userId", kind, title, supplier, fy, "docDate", notes, "originalName", "storedName", "mimeType", "sizeBytes")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${COLS}`,
          [userId, kind, (files.length === 1 && title ? String(title) : f.originalname).slice(0, 200), supplier ? String(supplier).slice(0, 200) : null,
           fy, docDate || null, notes ? String(notes).slice(0, 2000) : null, f.originalname, path.basename(f.path),
           MIME_BY_EXT[ext] || f.mimetype || 'application/octet-stream', f.size]);
        await setLinks(pool, d.id, toLinkExp, toLinkAst);
        const { storedName, ...pub } = d;
        created.push(pub);
      }
      if (created.length) await ensureSupplier(userId, supplier);
      res.status(created.length ? 201 : 400).json({ documents: await withLinks(userId, created), rejected });
    } catch (err) {
      discard();
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
});

router.get('/:id/file', wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT "storedName", "originalName", "mimeType" FROM fin_documents WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const p = fileOf(req.user.id, rows[0].storedName);
  if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'The file is missing from storage' });
  res.setHeader('Content-Type', rows[0].mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${rows[0].originalName.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(p).pipe(res);
}));

router.patch('/:id', wrap(async (req, res) => {
  const { title, kind, supplier, fy, docDate, notes } = req.body;
  if (kind !== undefined && !KINDS.includes(kind)) return res.status(400).json({ error: 'Unknown document type' });
  if (fy !== undefined && !isFy(fy)) return res.status(400).json({ error: 'fy must look like 2025-26' });
  if (docDate && !isDate(docDate)) return res.status(400).json({ error: 'Document date must be YYYY-MM-DD' });
  if (title !== undefined && !String(title).trim()) return res.status(400).json({ error: 'Title can\'t be empty' });
  const { rows } = await pool.query(
    `UPDATE fin_documents SET title=COALESCE($3,title), kind=COALESCE($4,kind), supplier=CASE WHEN $5::boolean THEN $6 ELSE supplier END,
            fy=COALESCE($7,fy), "docDate"=CASE WHEN $8::boolean THEN $9::date ELSE "docDate" END,
            notes=CASE WHEN $10::boolean THEN $11 ELSE notes END
     WHERE id=$1 AND "userId"=$2 RETURNING ${COLS}`,
    [req.params.id, req.user.id, title !== undefined ? String(title).slice(0, 200) : null, kind ?? null,
     supplier !== undefined, supplier ? String(supplier).slice(0, 200) : null, fy ?? null,
     docDate !== undefined, docDate || null, notes !== undefined, notes ? String(notes).slice(0, 2000) : null]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  if (supplier) await ensureSupplier(req.user.id, supplier);
  const { storedName, ...pub } = rows[0];
  res.json((await withLinks(req.user.id, [pub]))[0]);
}));

// Replace the set of expenses/assets a document is linked to.
router.put('/:id/links', wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT id FROM fin_documents WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const exp = await ownedExpenseIds(req.user.id, req.body.expenseIds);
  const ast = await ownedAssetIds(req.user.id, req.body.assetIds);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setLinks(client, rows[0].id, exp, ast);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  const { rows: [d] } = await pool.query(`SELECT ${COLS} FROM fin_documents WHERE id=$1`, [rows[0].id]);
  const { storedName, ...pub } = d;
  res.json((await withLinks(req.user.id, [pub]))[0]);
}));

router.delete('/:id', wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, title, "storedName", "docDate"::text AS "docDate", fy FROM fin_documents WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  if (req.query.confirm !== '1') {
    const { rows: [lk] } = await pool.query(`SELECT COUNT(*)::int AS n FROM fin_document_links WHERE "documentId"=$1`, [rows[0].id]);
    return res.status(409).json({
      needsConfirm: true,
      message: `Business records should be kept for five years. “${rows[0].title}” ${lk.n ? `is linked to ${lk.n} record${lk.n === 1 ? '' : 's'} and ` : ''}will be permanently deleted.`,
    });
  }
  const p = fileOf(req.user.id, rows[0].storedName);
  await pool.query(`DELETE FROM fin_documents WHERE id=$1 AND "userId"=$2`, [rows[0].id, req.user.id]); // links cascade
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { console.warn('[finance-docs] unlink failed:', e.message); }
  res.json({ ok: true });
}));

module.exports = router;
