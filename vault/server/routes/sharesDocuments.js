'use strict';

// Shares source documents: broker statements (e.g. the CMC end-of-financial-year statement) kept as
// evidence for the accountant pack. Mounted at /api/shares/documents (behind requireFeature('shares')).
// Private to the user, stored under UPLOAD_DIR/shares-docs/<userId>/. Kept apart from Finance → Documents
// on purpose: the private trading account is not part of the business books.

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { pool } = require('../db');
const { rejectIfDisguisedExecutable } = require('../utils/attachments');
const { finYearForDate } = require('../utils/finYear');

const router = express.Router();

const DOC_DIR   = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'), 'shares-docs');
const MAX_BYTES = (Number(process.env.FIN_DOC_MAX_MB) || 20) * 1024 * 1024;
const QUOTA     = (Number(process.env.FIN_DOC_QUOTA_MB) || 1000) * 1024 * 1024;
const EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.csv', '.xlsx', '.xls', '.txt'];
const MIME_BY_EXT = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.csv': 'text/csv', '.txt': 'text/plain',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel',
};
const COLS = `id, title, fy, "docDate"::text AS "docDate", notes, "originalName", "mimeType", "sizeBytes", "createdAt"`;

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

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isFy = (s) => {
  const m = /^(\d{4})-(\d{2})$/.exec(s || '');
  return !!m && ((parseInt(m[1], 10) + 1) % 100) === parseInt(m[2], 10);
};
const userDir = (userId) => path.join(DOC_DIR, String(userId));
const fileOf = (userId, storedName) => {
  const p = path.resolve(userDir(userId), storedName);
  return p.startsWith(path.resolve(userDir(userId)) + path.sep) ? p : null; // never leave the user's folder
};
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { if (!res.headersSent) res.status(err.statusCode || 500).json({ error: err.message }); }
};

// GET /api/shares/documents?fy=2025-26
router.get('/', wrap(async (req, res) => {
  const fy = req.query.fy;
  if (fy && !isFy(fy)) return res.status(400).json({ error: 'fy must look like 2025-26' });
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM share_documents WHERE "userId"=$1 ${fy ? 'AND fy=$2' : ''} ORDER BY COALESCE("docDate","createdAt"::date) DESC, id DESC`,
    fy ? [req.user.id, fy] : [req.user.id]);
  res.json(rows);
}));

// POST /api/shares/documents  (multipart: files, fy?, docDate?, title?, notes?)
router.post('/', (req, res) => {
  upload(req, res, async (uploadErr) => {
    const files = req.files || [];
    const discard = () => files.forEach((f) => { try { fs.unlinkSync(f.path); } catch { /* already gone */ } });
    try {
      if (uploadErr) {
        discard();
        const tooBig = uploadErr.code === 'LIMIT_FILE_SIZE';
        return res.status(tooBig ? 413 : 400).json({ error: tooBig ? `A file is larger than ${Math.round(MAX_BYTES / 1048576)} MB` : uploadErr.message });
      }
      if (!files.length) return res.status(400).json({ error: 'Choose at least one file' });
      const userId = req.user.id;
      const { notes, title } = req.body;
      let { docDate, fy } = req.body;
      if (docDate && !isDate(docDate)) { discard(); return res.status(400).json({ error: 'Document date must be YYYY-MM-DD' }); }
      if (!fy) fy = docDate ? finYearForDate(docDate) : finYearForDate(new Date().toISOString().slice(0, 10));
      if (!isFy(fy)) { discard(); return res.status(400).json({ error: 'fy must look like 2025-26' }); }

      const { rows: [usage] } = await pool.query(`SELECT COALESCE(SUM("sizeBytes"),0)::float AS used FROM share_documents WHERE "userId"=$1`, [userId]);
      if (usage.used + files.reduce((s, f) => s + f.size, 0) > QUOTA) {
        discard();
        return res.status(413).json({ error: `Document storage limit reached (${Math.round(QUOTA / 1048576)} MB)` });
      }

      const created = [], rejected = [];
      for (const f of files) {
        try { await rejectIfDisguisedExecutable(f.path); } // deletes the file when it is an executable in disguise
        catch (e) { rejected.push({ file: f.originalname, error: e.message }); continue; }
        const ext = path.extname(f.originalname).toLowerCase();
        const { rows: [d] } = await pool.query(
          `INSERT INTO share_documents ("userId", title, fy, "docDate", notes, "originalName", "storedName", "mimeType", "sizeBytes")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLS}`,
          [userId, (files.length === 1 && title ? String(title) : f.originalname).slice(0, 200), fy, docDate || null,
           notes ? String(notes).slice(0, 2000) : null, f.originalname, path.basename(f.path),
           MIME_BY_EXT[ext] || f.mimetype || 'application/octet-stream', f.size]);
        created.push(d);
      }
      res.status(created.length ? 201 : 400).json({ documents: created, rejected });
    } catch (err) {
      discard();
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
});

// GET /api/shares/documents/:id/file[?download=1]
router.get('/:id/file', wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT "storedName", "originalName", "mimeType" FROM share_documents WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const p = fileOf(req.user.id, rows[0].storedName);
  if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'The file is missing from storage' });
  res.setHeader('Content-Type', rows[0].mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${rows[0].originalName.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(p).pipe(res);
}));

// DELETE /api/shares/documents/:id  (removes the record and the file; the UI asks first)
router.delete('/:id', wrap(async (req, res) => {
  const { rows } = await pool.query(`DELETE FROM share_documents WHERE id=$1 AND "userId"=$2 RETURNING "storedName"`, [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const p = fileOf(req.user.id, rows[0].storedName);
  if (p) fs.unlink(p, () => {});
  res.json({ ok: true });
}));

module.exports = router;
module.exports.DOC_DIR = DOC_DIR;
