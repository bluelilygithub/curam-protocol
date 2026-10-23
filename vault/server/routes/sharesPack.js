'use strict';

// Shares accountant pack for one financial year: a PDF and an Excel workbook, and a zip with both plus the
// source documents (e.g. the broker's end-of-year statement). Mounted at /api/shares/pack (behind
// requireFeature('shares')). Reuses the Finance pack's PDF and Excel renderers; figures come from
// services/sharesPack/collect.js, which uses the same code as the Shares tabs. One build per user at a time.

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const archiver = require('archiver');
const { pool } = require('../db');
const { collectSharesPack } = require('../services/sharesPack/collect');
const { renderPackPdf } = require('../services/financePack/pdf');
const { renderPackXlsx } = require('../services/financePack/xlsx');
const { finYearForDate } = require('../utils/finYear');
const { DOC_DIR } = require('./sharesDocuments');

const router = express.Router();
const busy = new Set();

const parseFy = (req, res) => {
  const fy = req.query.fy || finYearForDate(new Date().toISOString().slice(0, 10));
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m || (parseInt(m[1], 10) + 1) % 100 !== parseInt(m[2], 10)) { res.status(400).json({ error: 'fy must look like 2025-26' }); return null; }
  return fy;
};
const guarded = (fn) => async (req, res) => {
  const fy = parseFy(req, res); if (!fy) return;
  const userId = req.user.id;
  if (busy.has(userId)) return res.status(429).json({ error: 'A pack is already being built — wait for it to finish.' });
  busy.add(userId);
  try { await fn(req, res, fy, userId); }
  catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); else res.end(); }
  finally { busy.delete(userId); }
};
const stem = (fy) => `Shares-FY${fy}`;

// What the pack will contain, without rendering the files.
router.get('/preview', guarded(async (req, res, fy, userId) => {
  const pack = await collectSharesPack(userId, fy);
  const { rows: [d] } = await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM("sizeBytes"),0)::float AS bytes FROM share_documents WHERE "userId"=$1 AND fy=$2`, [userId, fy]);
  res.json({ fy, period: pack.cover.period, reports: pack.reports.map((r) => ({ key: r.key, group: r.group, title: r.title })), summary: pack.reports[0].summary, documents: { count: d.n, bytes: d.bytes } });
}));

router.get('/pdf', guarded(async (req, res, fy, userId) => {
  const buf = await renderPackPdf(await collectSharesPack(userId, fy));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${stem(fy)}.pdf"`);
  res.send(buf);
}));

router.get('/xlsx', guarded(async (req, res, fy, userId) => {
  const buf = await renderPackXlsx(await collectSharesPack(userId, fy), userId);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${stem(fy)}.xlsx"`);
  res.send(buf);
}));

// PDF + Excel, plus (documents=1) the source documents for the year.
router.get('/zip', guarded(async (req, res, fy, userId) => {
  const pack = await collectSharesPack(userId, fy);
  const [pdf, xlsx] = await Promise.all([renderPackPdf(pack), renderPackXlsx(pack, userId)]);
  const withDocs = req.query.documents === '1';
  const docs = withDocs
    ? (await pool.query(`SELECT id, title, "docDate"::text AS "docDate", "originalName", "storedName" FROM share_documents WHERE "userId"=$1 AND fy=$2 ORDER BY COALESCE("docDate","createdAt"::date), id`, [userId, fy])).rows
    : [];

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${stem(fy)}.zip"`);
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.on('error', (e) => { try { res.destroy(e); } catch { /* socket gone */ } });
  zip.pipe(res);
  zip.append(pdf, { name: `${stem(fy)}.pdf` });
  zip.append(xlsx, { name: `${stem(fy)}.xlsx` });
  const missing = [], names = [];
  const base = path.resolve(DOC_DIR, String(userId));
  for (const d of docs) {
    const file = path.resolve(base, d.storedName);
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) { missing.push(d.title); continue; }
    const ext = path.extname(d.originalName).toLowerCase();
    const slug = d.title.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'document';
    const name = `documents/${d.docDate || fy}_${slug}_${d.id}${ext}`;
    zip.file(file, { name });
    names.push(`${name}  <-  ${d.originalName}`);
  }
  if (withDocs) {
    zip.append(`Source documents for FY ${fy}\r\n\r\n${names.join('\r\n') || '(none uploaded)'}\r\n${missing.length ? `\r\nFiles missing from storage: ${missing.join(', ')}\r\n` : ''}`, { name: 'documents/README.txt' });
  }
  await zip.finalize();
}));

module.exports = router;
